#!/usr/bin/env python3
"""Local Whisper transcription service for Interview AI Hamburger.

Exposes:
  - GET /health
  - POST /transcribe (multipart/form-data with `audio` file, optional `language`)

Response shape:
  {"text": "..."}
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


APP_NAME = "Interview AI Hamburger Local Whisper Service"
MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "").strip()
DEVICE = os.getenv("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

app = FastAPI(title=APP_NAME, version="1.0.0")
_model: Optional[WhisperModel] = None


def _normalize_language_hint(language: str) -> Optional[str]:
    value = (language or "").strip().lower()
    if not value:
        return None
    # Convert BCP-47 style hints (e.g. zh-CN, en-US) into Whisper language tags.
    return value.split("-")[0]


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        model_source = MODEL_PATH if MODEL_PATH else MODEL_NAME
        _model = WhisperModel(
            model_source,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
    return _model


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

    suffix = Path(audio.filename or "chunk.webm").suffix or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        model = _get_model()
        lang = _normalize_language_hint(language or "")
        segments, _info = model.transcribe(
            tmp_path,
            language=lang,
            task="transcribe",
            beam_size=BEAM_SIZE,
            vad_filter=VAD_FILTER,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return JSONResponse({"text": text})
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"transcription failed: {exc}") from exc
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
