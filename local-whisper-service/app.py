#!/usr/bin/env python3
"""Local Whisper transcription service for Interview AI Hamburger.

Exposes:
  - GET /health
  - POST /transcribe (multipart/form-data with `audio` file, optional `language`)

Response shape:
  {"text": "..."}
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import uvicorn


APP_NAME = "Interview AI Hamburger Local Whisper Service"
# "base" provides a better default latency/quality tradeoff for CPU real-time usage.
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "").strip()
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
BEST_OF = int(os.getenv("WHISPER_BEST_OF", "1"))
LOG_PROB_THRESHOLD = float(os.getenv("WHISPER_LOG_PROB_THRESHOLD", "-1.2"))
NO_SPEECH_THRESHOLD = float(os.getenv("WHISPER_NO_SPEECH_THRESHOLD", "0.6"))
COMPRESSION_RATIO_THRESHOLD = float(os.getenv("WHISPER_COMPRESSION_RATIO_THRESHOLD", "2.6"))
VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
RAW_TEMPERATURES = os.getenv("WHISPER_TEMPERATURES", "0.0")
TEMPERATURES = tuple(
    float(item.strip())
    for item in RAW_TEMPERATURES.split(",")
    if item.strip()
)
PRELOAD_MODEL = os.getenv("WHISPER_PRELOAD_MODEL", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

app = FastAPI(title=APP_NAME, version="1.0.0")
_model: Optional[WhisperModel] = None
_model_ready = False
_model_error = ""
LOGGER = logging.getLogger("local-whisper")


def _is_cuda_runtime_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "cuda",
            "cublas",
            "cudnn",
            "libcublas",
        )
    )


def _is_recoverable_chunk_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "tuple index out of range",
            "invalid data found when processing input",
            "error while decoding stream",
            "could not find codec parameters",
            "end of file",
            "input contains nan",
        )
    )


def _normalize_language_hint(language: str) -> Optional[str]:
    value = (language or "").strip().lower()
    if not value:
        return None
    # Convert BCP-47 style hints (e.g. zh-CN, en-US) into Whisper language tags.
    return value.split("-")[0]


def _get_model() -> WhisperModel:
    global _model, _model_ready, _model_error
    if _model is None:
        model_source = MODEL_PATH if MODEL_PATH else MODEL_NAME
        try:
            _model = WhisperModel(
                model_source,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
            )
            _model_ready = True
            _model_error = ""
        except Exception as exc:
            if DEVICE.lower() != "cpu" and _is_cuda_runtime_error(exc):
                LOGGER.warning("CUDA runtime unavailable, falling back to CPU: %s", exc)
                _model = WhisperModel(
                    model_source,
                    device="cpu",
                    compute_type="int8",
                )
                _model_ready = True
                _model_error = ""
            else:
                _model_error = str(exc)
                raise
    return _model


@app.on_event("startup")
def preload_model_on_startup() -> None:
    global _model_ready, _model_error
    if not PRELOAD_MODEL:
        return
    try:
        _get_model()
        _model_ready = True
        _model_error = ""
        LOGGER.info("Local Whisper model preloaded: %s", MODEL_PATH or MODEL_NAME)
    except Exception as exc:  # pragma: no cover
        _model_ready = False
        _model_error = str(exc)
        LOGGER.exception("Local Whisper model preload failed")


def _transcribe_once(model: WhisperModel, tmp_path: str, language: Optional[str], vad_filter: bool) -> str:
    options = {
        "language": language,
        "task": "transcribe",
        "beam_size": max(1, BEAM_SIZE),
        "best_of": max(1, BEST_OF),
        "vad_filter": vad_filter,
        # Chunk-by-chunk mode: avoid carrying prior chunk hallucinations forward.
        "condition_on_previous_text": False,
        "compression_ratio_threshold": COMPRESSION_RATIO_THRESHOLD,
        "log_prob_threshold": LOG_PROB_THRESHOLD,
        "no_speech_threshold": NO_SPEECH_THRESHOLD,
    }
    if TEMPERATURES:
        options["temperature"] = list(TEMPERATURES) if len(TEMPERATURES) > 1 else TEMPERATURES[0]

    try:
        segments, _info = model.transcribe(tmp_path, **options)
    except TypeError:
        # Backward compatibility for older faster-whisper builds that may not support all options.
        fallback_options = {
            "language": language,
            "task": "transcribe",
            "beam_size": max(1, BEAM_SIZE),
            "vad_filter": vad_filter,
            "condition_on_previous_text": False,
        }
        segments, _info = model.transcribe(tmp_path, **fallback_options)

    return " ".join(segment.text.strip() for segment in segments).strip()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "service": APP_NAME,
            "model": MODEL_NAME,
            "modelPath": MODEL_PATH,
            "device": DEVICE,
            "computeType": COMPUTE_TYPE,
            "ready": _model_ready,
            "error": _model_error,
            "preloadModel": PRELOAD_MODEL,
        }
    )


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
) -> JSONResponse:
    if audio is None:
        raise HTTPException(status_code=400, detail="audio is required")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio is empty")
    # Very small chunks are usually container fragments; skip to avoid noisy decoder failures.
    if len(content) < 1024:
        return JSONResponse({"text": ""})

    suffix = Path(audio.filename or "chunk.webm").suffix or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        model = _get_model()
        lang = _normalize_language_hint(language or "")

        attempts = [
            (lang, VAD_FILTER),
            (None, False),
        ]

        last_error: Optional[Exception] = None
        for attempt_lang, attempt_vad in attempts:
            try:
                text = _transcribe_once(
                    model,
                    tmp_path,
                    attempt_lang,
                    attempt_vad,
                )
                return JSONResponse({"text": text})
            except Exception as exc:
                last_error = exc
                # For broken/incomplete chunks, skip instead of interrupting the session.
                if _is_recoverable_chunk_error(exc):
                    LOGGER.warning("Skipping undecodable chunk: %s", exc)
                    return JSONResponse({"text": ""})
                LOGGER.warning(
                    "Transcribe attempt failed (lang=%s, vad=%s): %s",
                    attempt_lang,
                    attempt_vad,
                    exc,
                )

        raise last_error or RuntimeError("transcription failed")
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        if _is_recoverable_chunk_error(exc):
            LOGGER.warning("Skipping chunk after fallback attempts: %s", exc)
            return JSONResponse({"text": ""})
        LOGGER.exception("Unhandled transcription error")
        raise HTTPException(status_code=500, detail=f"transcription failed: {exc}") from exc
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("LOCAL_WHISPER_PORT", "8765")))
