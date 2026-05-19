# Source-Specific Transcription Acceptance

## Scope

Acceptance closeout for the `micProvider` / `systemProvider` refactor across desktop UI, Electron audio flows, legacy field compatibility, and release-readiness evidence.

## Environment

- Repository: `D:\Github\InterviewHelper`
- Platform used for acceptance execution: Windows / `win32` OpenCode environment
- Desktop runtime under test: Electron + React build from `desktop/`
- Server runtime under test: Express app from `server/`

## Compatibility conclusion

Decision: **remove legacy compatibility** for `sttProvider` on the server in this major release.

Reason:

- Current desktop runtime has already moved to source-specific `micProvider` / `systemProvider`.
- Persisted desktop state now migrates away from `sttProvider`.
- Desktop/runtime clients already use `transcribeProvider`, so the server shim is no longer needed for maintained clients.
- Legacy callers now receive an explicit migration error instead of compatibility remapping.

Evidence:

- `server/routes/ai.js` accepts `transcribeProvider` only and rejects legacy `sttProvider` clearly.
- `server/__tests__/ai.route.test.js` includes a dedicated test that proves `sttProvider` is rejected with a migration error.
- This pass is the declared breaking change for the legacy request field.

Related policy/docs:

- `docs/source-specific-transcription-compatibility.md`
- `docs/source-specific-transcription-release-note.md`
- `docs/source-specific-transcription-release-checklist.md`

## Automated acceptance results

### Desktop unit / component coverage

Passed:

- `desktop/src/components/InterviewSetup/InterviewSetup.test.js`
- `desktop/src/components/MoreSettings/MoreSettings.test.js`
- `desktop/src/components/UndetectableMode/UndetectableMode.test.js`
- existing desktop suite including store/util/component coverage

Command evidence:

- `cd desktop && npx react-scripts test --watchAll=false`
- Result: `11 passed, 11 total`, `149 passed, 149 total`

What these tests prove:

- `InterviewSetup` renders source-specific provider controls and normalizes non-Windows WLC selection.
- `MoreSettings` renders source-specific provider controls, shows non-Windows disable guidance, and profile sync still works.
- `UndetectableMode` renders disconnected state, shows transcript preview after start, and streams answer deltas to the connected client hook.

### Server acceptance

Command evidence:

- `cd server && npx jest --forceExit`
- Result: `7 passed, 7 total`, `73 passed, 73 total`

What this proves:

- current transcription routing still works
- source-specific fallback order remains intact
- removed legacy `sttProvider` request path is covered and green

### Desktop build

Command evidence:

- `cd desktop && npm run react-build`
- Result: build completed successfully

### Electron smoke / audio chains

Command evidence:

- `cd desktop && npm run test:electron-smoke`
- Result: passed, screenshot written to `output/playwright/electron-smoke.png`

- `cd desktop && npm run test:mic-only-scenarios`
- Result: passed

- `cd desktop && npm run test:windows-live-captions-scenarios`
- Result: passed, screenshot written to `output/playwright/electron-wlc-mic-system.png`

These satisfy the required audio-chain acceptance:

- `webspeech` mic route
- `windows-live-captions` system route

Additional overlap regression coverage also exists in `desktop/scripts/electron-audio-scenarios.cjs` and was kept aligned with the refactor.

## Windows / non-Windows behavior check

### Windows behavior

Validated in the Windows environment through the actual Electron smoke and audio scenario runs above.

Observed acceptable outcomes:

- Electron app launches from build output
- Windows Live Captions route remains available on Windows
- Mic-only and Mic + System flows both execute under Electron

### Non-Windows behavior

Validated through component tests by simulating a non-Windows platform in the renderer.

Observed acceptable outcomes:

- `InterviewSetup` does not keep Windows Live Captions as the active system route on non-Windows
- non-Windows guidance text is shown
- `MoreSettings` hides WLC-only controls unless they are relevant

Note:

- Non-Windows UI behavior was test-validated, not manually executed in a macOS runtime during this acceptance pass.

## Failed scenarios

No open failures remain in the final acceptance pass.

Transient failures encountered during the closure work and resolved before final acceptance:

- outdated scenario assertions tied to the pre-refactor combined WLC path
- overlap scenario assumptions from the old shared-provider model
- one brittle UndetectableMode test assertion tied to pre-toggle text

None of those remain in the final verified state.

## Merge-ready summary

This change set is merge-ready.

Delivered:

- source-specific desktop UI tested at component level
- Windows and simulated non-Windows behavior aligned with docs
- Electron smoke + at least two key audio chains green
- server compatibility decision made and implemented
- legacy `sttProvider` request field removed, with breaking-release tests and migration docs

Risk that remains:

- Windows Live Captions is still inherently Windows-only and best-effort; this pass does not change that platform constraint.
