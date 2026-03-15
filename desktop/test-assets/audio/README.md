# Audio Test Fixtures

This folder stores deterministic audio fixtures used by the Electron E2E harness.

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
- Model separate mic vs system sources.
- Model mono vs stereo channel layouts.
- Provide stable source material IDs that future virtual-microphone tests can reuse.

## Current usage

- `npm run test:audio-scenarios` uses the manifest plus a virtual capture harness.
- Network calls for transcription and answering are mocked for stability.
- The app still exercises its own transcript merge, source labeling, question detection trigger, and answer rendering paths.

## Next step

- Reuse the same `.wav` fixtures with a real virtual microphone / loopback device runner for OS-level medium-strength automation.
