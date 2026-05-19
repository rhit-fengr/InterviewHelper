# Source-Specific Transcription Release Checklist

## Purpose

Pre-release checklist for the `micProvider` / `systemProvider` refactor so the release can be validated and handed off without reopening the migration.

## Automated checks

Run and record these commands:

```bash
cd desktop
npx react-scripts test --watchAll=false
npm run react-build
npm run test:electron-smoke
npm run test:mic-only-scenarios
npm run test:windows-live-captions-scenarios

cd ../server
npx jest --forceExit
```

Expected result:

- all commands exit `0`
- Electron screenshots are written under `output/playwright/`

## Compatibility sanity

Confirm the current request shape is understood and the legacy one is rejected clearly:

- current field: `transcribeProvider`
- removed legacy field: `sttProvider`

Expected result:

- `server/__tests__/ai.route.test.js` includes a passing breaking-release case for removed `sttProvider`
- `server/routes/ai.js` rejects legacy `sttProvider` with a clear migration response

## Desktop behavior

Confirm these behaviors match docs:

- `InterviewSetup` shows source-specific provider controls
- non-Windows path does not keep Windows Live Captions selected as an active system route
- `MoreSettings` only shows WLC-specific controls when relevant
- `UndetectableMode` still streams transcript and answer content through the socket layer

## Windows release smoke

Use `desktop/RELEASE_WINDOWS.md` for the Windows-specific installer and runtime smoke checklist.

For this refactor specifically, confirm:

- `Mic only` works with the default `webspeech` route
- `Mic + System` works with `Mic=Browser Speech`, `System=Windows Live Captions`
- transcript lanes do not collapse into one route during normal smoke coverage

## Release handoff artifacts

Before sign-off, ensure these maintained docs exist and are current:

- `docs/source-specific-transcription-acceptance.md`
- `docs/source-specific-transcription-compatibility.md`
- `docs/source-specific-transcription-release-note.md`
- `README.md`

## Breaking-change trigger reminder

This release **is** the breaking-change release for `sttProvider`.

Any caller still sending `sttProvider` must be migrated to `transcribeProvider` before rollout.
