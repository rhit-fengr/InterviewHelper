# Transcription Feasibility Note

This note captures the practical direction for the current dual-route transcription architecture.

## Current shipping recommendation

- **Microphone**: `webspeech`
- **System audio**: `windows-live-captions`
- **Windows Live Captions microphone assist**: optional, default off, experimental / compatibility only

This keeps the candidate microphone route separate from the system route instead of trying to force both through one caption provider.

## Chrome / Web Speech

### What it can do well

- Good default path for **microphone input** in Chromium/Electron-style environments
- Continuous microphone dictation is already supported by the current desktop app through `useTranscript`
- Low-friction for users because it does not require separate server credentials

### What it cannot do well

- It is **not baseline** across all browsers and environments
- In Chromium-family implementations, recognition may rely on a server-backed engine and may not work offline
- It is **not a real system-audio transcription solution**
- It should not be treated as a formal cross-platform system-caption provider

### Recommendation

Use Chrome / Web Speech as the default **mic** provider, not as a replacement for system-audio capture.

## Google Cloud Speech-to-Text

### Why it is feasible

- The current app already uploads audio chunks to the Node server through `/api/ai/transcribe-chunk`
- That server-side chunk pipeline is a natural integration point for a future `google-stt` provider
- System audio captured in Electron can be forwarded to a cloud STT provider without changing the overall product model

### Constraints

- Requires Google Cloud credentials and billing
- Introduces cloud cost and deployment complexity
- Would be a formal provider integration project, not a small UI tweak
- For this convergence pass, it is better treated as a documented future option than a rushed runtime addition

### Recommendation

If a formal cloud system-audio provider is needed later, add it server-side as a dedicated provider route alongside the existing chunk-transcription architecture.

## Local Whisper

- Local Whisper remains useful for explicit experimental/offline workflows
- It should **not** remain in the default automatic chain
- It should only be activated when the user explicitly selects it for a source

## What we should not do

- Do **not** treat “scraping Chrome translation/caption UI text” as the formal production solution
- Do **not** rely on Windows Live Captions to reliably separate microphone and system speakers; that separation is not exposed in a trustworthy way
- Do **not** keep piling more providers into Auto without a clear source-specific strategy

## Formal direction

### Ship now

- Mic: `webspeech`
- System: `windows-live-captions`
- Optional WLC microphone assist: off by default

### Future formal extension

- Add a dedicated cloud system-audio provider such as `google-stt` through the existing server chunk-upload path
- Keep the routing source-specific rather than returning to one shared STT selector
