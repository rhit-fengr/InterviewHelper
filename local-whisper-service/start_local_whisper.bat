@echo off
setlocal

cd /d %~dp0

if not exist .venv (
  echo [local-whisper] Creating virtual environment...
  python -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

if "%WHISPER_MODEL%"=="" set WHISPER_MODEL=small
if "%WHISPER_DEVICE%"=="" set WHISPER_DEVICE=auto
if "%WHISPER_COMPUTE_TYPE%"=="" set WHISPER_COMPUTE_TYPE=int8
if "%WHISPER_BEAM_SIZE%"=="" set WHISPER_BEAM_SIZE=1
if "%WHISPER_VAD_FILTER%"=="" set WHISPER_VAD_FILTER=true

echo [local-whisper] Starting on http://127.0.0.1:8765 ...
uvicorn app:app --host 127.0.0.1 --port 8765

