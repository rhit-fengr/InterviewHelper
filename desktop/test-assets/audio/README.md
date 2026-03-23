# Audio Test Fixtures

This folder stores deterministic spoken audio fixtures used by the Electron E2E harness.

## Commands

```bash
cd desktop
npm run test:generate-audio-fixtures
```

## What gets generated

- `system-question-stereo.wav`
- `mic-leakage-mono.wav`
- `mic-answer-mono.wav`
- `system-followup-stereo.wav`
- `manifest.json`

## Why these fixtures exist

- Keep audio automation fully repeatable across machines.
- Use actual spoken phrases instead of synthetic tones, so fixtures better match real interview audio cadence.
- Model separate mic vs system sources.
- Model mono vs stereo channel layouts.
- Provide stable source material IDs that future virtual-microphone tests can reuse.

## Current usage

- `npm run test:mic-only-scenarios` covers Electron `Mic only` with the default `webspeech` route.
- `npm run test:windows-live-captions-scenarios` covers `Mic + System` with `Mic=webspeech` and `System=windows-live-captions`.
- `npm run test:audio-scenarios` uses the manifest plus a virtual capture harness.
- The harness plays real spoken `.wav` fixtures through `AudioContext` and `MediaStreamDestination`.
- The app records those streams with the native `MediaRecorder` path.
- Network calls for transcription and answering are mocked for stability.
- The app still exercises its own transcript merge, source labeling, question detection trigger, and answer rendering paths.
- The Electron WLC path is also checked against empty-caption warning regressions once transcript text is flowing.
- The split WLC route is also checked to ensure the mic lane stays separate from the system caption lane.

## Next step

- Reuse the same `.wav` fixtures with a real virtual microphone / loopback device runner for OS-level medium-strength automation.
