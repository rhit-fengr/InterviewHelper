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

Example:

```bash
set WHISPER_MODEL=medium
set WHISPER_DEVICE=cpu
uvicorn app:app --host 127.0.0.1 --port 8765
```

## 5. Quick check

```bash
curl http://127.0.0.1:8765/health
```

Should return JSON with `status: "ok"`.

