# Local Whisper Service

Local STT service for Interview AI Hamburger.

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

If it exits immediately, run it from an existing `cmd` window so you can see the exact error (usually Python missing or pip install failure).

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
- `WHISPER_DEVICE` (default: `auto`)
- `WHISPER_COMPUTE_TYPE` (default: `int8`)
- `WHISPER_BEAM_SIZE` (default: `1`)
- `WHISPER_VAD_FILTER` (default: `true`)
- `LOCAL_WHISPER_PORT` (default: `8765`)

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
- Python dependencies are still required on the machine unless you later bundle a full Python runtime + models.
