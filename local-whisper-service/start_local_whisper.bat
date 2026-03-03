@echo off
setlocal

cd /d %~dp0

set QUIET=0
if /I "%~1"=="--quiet" set QUIET=1

set BUNDLED_RUNTIME=0
set PYTHON_EXE=%~dp0runtime\venv\Scripts\python.exe
if exist "%PYTHON_EXE%" (
  set BUNDLED_RUNTIME=1
)

if "%BUNDLED_RUNTIME%"=="1" goto :runtime_ready

set PYTHON_CMD=
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 set PYTHON_CMD=py -3
if not defined PYTHON_CMD (
  where python >nul 2>&1
  if %ERRORLEVEL% EQU 0 set PYTHON_CMD=python
)
if not defined PYTHON_CMD (
  echo [local-whisper] ERROR: Python was not found. Install Python 3.10+ and retry.
  goto :fail
)

if not exist .venv (
  echo [local-whisper] Creating virtual environment...
  %PYTHON_CMD% -m venv .venv
  if %ERRORLEVEL% NEQ 0 goto :fail
)

call .venv\Scripts\activate.bat
if %ERRORLEVEL% NEQ 0 goto :fail

python -m pip install --upgrade pip
if %ERRORLEVEL% NEQ 0 goto :fail
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 goto :fail

:runtime_ready
if "%WHISPER_DEVICE%"=="" set WHISPER_DEVICE=auto
if "%WHISPER_COMPUTE_TYPE%"=="" set WHISPER_COMPUTE_TYPE=int8
if "%WHISPER_BEAM_SIZE%"=="" set WHISPER_BEAM_SIZE=1
if "%WHISPER_VAD_FILTER%"=="" set WHISPER_VAD_FILTER=true
if "%LOCAL_WHISPER_PORT%"=="" set LOCAL_WHISPER_PORT=8765

if "%WHISPER_MODEL%"=="" if exist "%~dp0runtime\default_model.txt" set /p WHISPER_MODEL=<"%~dp0runtime\default_model.txt"
if "%WHISPER_MODEL%"=="" set WHISPER_MODEL=small
if "%WHISPER_MODEL_PATH%"=="" if exist "%~dp0runtime\models\%WHISPER_MODEL%\model.bin" set WHISPER_MODEL_PATH=%~dp0runtime\models\%WHISPER_MODEL%

echo [local-whisper] Starting on http://127.0.0.1:%LOCAL_WHISPER_PORT% ...
if "%BUNDLED_RUNTIME%"=="1" (
  "%PYTHON_EXE%" -m uvicorn app:app --host 127.0.0.1 --port %LOCAL_WHISPER_PORT%
) else (
  uvicorn app:app --host 127.0.0.1 --port %LOCAL_WHISPER_PORT%
)
if %ERRORLEVEL% NEQ 0 goto :fail
goto :eof

:fail
if "%QUIET%"=="0" (
  echo [local-whisper] Startup failed. Check the error above.
  pause
)
exit /b 1
