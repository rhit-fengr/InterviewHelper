# Troubleshooting Guide

This guide covers the desktop, mobile, server, and local transcription paths used by Interview AI Hamburger.

## Desktop Audio Modes

### Mic Only

- Uses the desktop app microphone flow.
- Defaults to Browser Speech for microphone transcription.
- Requires microphone permission in Electron.
- Does not use Windows Live Captions unless microphone assist is explicitly enabled through the system provider path.

### Mic + System

- Captures microphone and system audio as separate sources.
- Uses `micProvider` for microphone transcription and `systemProvider` for system audio transcription.
- Supports source labels in transcript history so answers can distinguish candidate speech from interviewer/system speech.
- Windows Live Captions is available only on Windows and is a best-effort OS accessibility integration.

## Common Issues

### Desktop Cannot Connect To Server

Start the backend from the server project:

```bash
cd server
npm run dev
```

If you changed `server/.env`, restart the server. Provider keys and defaults are read at process startup.

### Legacy `sttProvider` Requests Fail

This release removed `sttProvider` from the server transcription API. Current callers must send `transcribeProvider`.

Expected failure shape for old callers:

```json
{
  "code": "stt_provider_removed",
  "removedField": "sttProvider",
  "replacementField": "transcribeProvider"
}
```

Desktop persisted settings still migrate old saved `sttProvider` values into `micProvider` and `systemProvider`.

### Windows Live Captions Is Missing

- It is only selectable on Windows.
- It depends on the Windows accessibility surface, not an official transcript API.
- On macOS or Linux, use Browser Speech for microphone input and OpenAI, Gemini, or Local Whisper for system audio.

### Local Whisper Service Will Not Start

Check the health endpoint:

```bash
curl http://127.0.0.1:8765/health
```

Manual start on Windows:

```bash
cd local-whisper-service
start_local_whisper.bat
```

If the error mentions CUDA, cuBLAS, or cuDNN, run on CPU:

```bash
set WHISPER_DEVICE=cpu
local-whisper-service\start_local_whisper.bat
```

For packaged Windows builds, run this before building so the runtime is embedded:

```bash
cd desktop
npm run prepare:local-whisper-runtime
```

### Local Whisper Health Check Times Out

- Confirm port `8765` is free or set `LOCAL_WHISPER_HEALTH_URL` to the correct local service URL.
- Run `start_local_whisper.bat` manually to see Python/runtime errors.
- Temporarily switch the affected source provider to OpenAI or Gemini to keep testing the desktop flow.

### Mobile Cannot Join A Session

- Confirm the mobile device can reach the server LAN URL, for example `http://192.168.1.10:4000`.
- Set `EXPO_PUBLIC_SERVER_URL` for the mobile app when the default `localhost` is not valid from the device.
- Confirm the desktop host is still in Undetectable Mode and the session code has not expired.

## Verification Commands

```bash
cd server && npx jest --forceExit
cd desktop && npx react-scripts test --watchAll=false
cd desktop && npm run react-build
cd mobile && npx jest --watchAll=false
```

Desktop smoke and audio scenarios:

```bash
cd desktop
npm run test:electron-smoke
npm run test:mic-only-scenarios
npm run test:windows-live-captions-scenarios
```
