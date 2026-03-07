# Local Whisper Service

Local STT service for Interview AI Hamburger.

This folder now supports two modes:
- Bundled runtime mode (recommended for release `.exe`): Python runtime + dependencies + model are prebuilt during packaging.
- Dev/manual mode: use system Python as before.

## 1. Create venv and install

```bash
cd local-whisper-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Run service

```bash
uvicorn app:app --host 127.0.0.1 --port 8765
```

Windows one-click launcher:

```bash
start_local_whisper.bat
```

If bundled runtime exists (`runtime/service/local-whisper-service/local-whisper-service.exe`), this launcher uses that executable directly and does not require system Python.
If bundled Python venv exists (`runtime/venv/...`), it uses bundled Python directly.
If bundled runtime does not exist, it falls back to system Python and installs dependencies on first run.

## 3. Server env wiring

In `server/.env`:

```bash
LOCAL_TRANSCRIBE_URL=http://127.0.0.1:8765/transcribe
```

Desktop `Interview Setup -> Transcription Provider`:
- `Auto` (OpenAI -> Local -> Gemini), or
- `Local Whisper Service`.

## 4. Optional model tuning

Environment variables:

- `WHISPER_MODEL` (default: `small`)
- `WHISPER_DEVICE` (default: `cpu`)
- `WHISPER_COMPUTE_TYPE` (default: `int8`)
- `WHISPER_BEAM_SIZE` (default: `4`)
- `WHISPER_BEST_OF` (default: `3`)
- `WHISPER_LOG_PROB_THRESHOLD` (default: `-0.8`)
- `WHISPER_NO_SPEECH_THRESHOLD` (default: `0.45`)
- `WHISPER_COMPRESSION_RATIO_THRESHOLD` (default: `2.2`)
- `WHISPER_TEMPERATURES` (default: `0.0,0.2`)
- `WHISPER_VAD_FILTER` (default: `false`)
- `LOCAL_WHISPER_PORT` (default: `8765`)

`WHISPER_MODEL_PATH` can point to a local model directory (takes precedence over `WHISPER_MODEL`).

Example:

```bash
set WHISPER_MODEL=medium
set WHISPER_DEVICE=cpu
set LOCAL_WHISPER_PORT=3625
uvicorn app:app --host 127.0.0.1 --port %LOCAL_WHISPER_PORT%
```

## 5. Quick check

```bash
curl http://127.0.0.1:8765/health
```

Should return JSON with `status: "ok"`.

## Electron auto start/stop

When running in packaged Electron app and using `Mic + System` with `Transcription Provider = Auto/Local`:

- Start listening: app tries to ensure local-whisper service is running.
- Stop listening / end session: app releases service lease and auto-stops managed local service.

Notes:
- If local service is already running outside the app, Electron reuses it and will not force-kill your external process.

## Build bundled runtime for installer

From `desktop/`:

```bash
npm run prepare:local-whisper-runtime
```

This creates:

- `local-whisper-service/runtime/service/local-whisper-service/local-whisper-service.exe` (bundled runtime executable), or `runtime/venv` depending on build mode
- `local-whisper-service/runtime/models/<model>`
- `local-whisper-service/runtime/default_model.txt`

Model selection:

```bash
set WHISPER_BUNDLE_MODEL=small
npm run prepare:local-whisper-runtime
```

Supported bundled models:
- `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`
- `medium`, `medium.en`
- `large-v1`, `large-v2`, `large-v3`
- `distil-large-v2`, `distil-large-v3`
