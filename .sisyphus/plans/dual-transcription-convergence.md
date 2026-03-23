## Goal

Converge dual-route transcription around stable source-specific behavior instead of adding more provider sprawl.

This plan covers three coordinated workstreams:

1. **Workstream A — Windows Live Captions UX/Settings convergence**
2. **Workstream B — Source-specific mic/system strategy refactor**
3. **Workstream C — Remove local whisper from the main auto path and ship a feasibility note for Chrome/Google directions**

## Non-Goals

- Do **not** attempt true microphone-vs-system separation inside Windows Live Captions.
- Do **not** add new transcription providers to the shipping runtime unless the integration is already fully credible in this repo.
- Do **not** break mic-only mode.
- Do **not** add dependencies unless absolutely required.

## Current Findings

### Workstream A

- `setup.autoHideWindowsLiveCaptions` and `setup.windowsLiveCaptionsIncludeMicrophoneAudio` already exist and are persisted in `desktop/src/store/interviewStore.js`.
- `InterviewSetup` already exposes those settings behind “Show Live Captions options”.
- `MoreSettings` does not currently expose them.
- `useDualAudioTranscript` already consumes `autoHideWindowsLiveCaptions` before listening starts via `ensureWindowsLiveCaptions({ autoHide, deferAutoHide: true })`.
- Transcript noise filtering is centralized in `desktop/src/utils/interviewTranscript.js`, but some menu phrases are still only handled as whole-segment noise.

### Workstream B

- The current design still uses one `setup.sttProvider` for both sources with special cases, especially around `windows-live-captions`.
- `StandardMode` currently treats `windows-live-captions + mic-assist` as a combined path in Mic + System mode.
- `useTranscript` already provides a strong mic-only browser-native path.
- `speakerFromSourceMode('mic') => Candidate` and `speakerFromSourceMode('system') => Interviewer` already exist.
- Export currently includes speaker and language, but not explicit source tags.

### Workstream C

- Server auto transcription chain is currently:
  - system: `openai -> local -> gemini -> windows-live-captions`
  - mic: `openai -> local -> gemini`
- Local Whisper is still on the main auto path.
- `InterviewSetup` still presents `local` as a first-class provider in the main dropdown.
- Chrome/Web Speech is already implemented for microphone capture via `useTranscript`, but it is “limited availability” and often server-backed in Chromium.
- Google Cloud STT is feasible in the current server architecture as a future system-audio/cloud path, but it is a **future design direction**, not a ship-now runtime dependency for this pass.

## Implementation Plan

### 1. Introduce source-specific persisted setup

Update `desktop/src/store/interviewStore.js` to add persisted source-specific setup fields:

- `micProvider` — default: `webspeech`
- `systemProvider` — default: `windows-live-captions`
- `windowsLiveCaptionsMicrophoneAssist` — default: `false`

Keep legacy `sttProvider` readable for migration only. On hydration or first use, map legacy values into the new fields conservatively:

- legacy `windows-live-captions` → `systemProvider='windows-live-captions'`, `micProvider='webspeech'`, `windowsLiveCaptionsMicrophoneAssist=true`
- legacy `local` → `micProvider='local'`, `systemProvider='local'`
- legacy `openai` / `gemini` → both sources set to that provider
- legacy `auto` or missing → `micProvider='webspeech'`, `systemProvider='windows-live-captions'`

Also migrate the already-persisted legacy field:

- legacy `setup.windowsLiveCaptionsIncludeMicrophoneAudio === true` → `windowsLiveCaptionsMicrophoneAssist=true`
- legacy `setup.windowsLiveCaptionsIncludeMicrophoneAudio === false` → `windowsLiveCaptionsMicrophoneAssist=false`
- after migration, keep reading the legacy field defensively but treat the new field as canonical

Acceptance:

- new settings are persisted
- older stored sessions still land on a sane setup

### 2. Refactor Interview Setup UX for source-specific strategy

Update `desktop/src/components/InterviewSetup/index.jsx` and `InterviewSetup.css`:

- Replace the single “Transcription Provider” selector with:
  - `Microphone Provider`
  - `System Audio Provider`
- Default values:
  - Mic → `Browser Speech (Recommended)`
  - System → `Windows Live Captions (Recommended on Windows)`
- Keep `Local Whisper` out of the primary system path and mark it `Experimental`.
- Expose `Use Windows Live Captions microphone assist` as a separate checkbox:
  - default off
  - labeled `Experimental / Compatibility`
- Keep `Auto-hide Live Captions after text starts flowing` visible before interview start and concise.

User-facing copy should be shorter and calmer than today.

### 3. Mirror WLC settings in More Settings

Update `desktop/src/components/MoreSettings/index.jsx` and `.css` to expose the persisted WLC settings there too:

- `Auto-hide Windows Live Captions after text starts`
- `Use Windows Live Captions microphone assist (Experimental)`

These controls must update the same persisted `setup` fields, not duplicate local state.

### 4. Refactor Standard Mode to choose mic and system independently

Update `desktop/src/components/StandardMode/index.jsx` so Mic + System mode is composed from source-specific routes instead of one shared STT selection.

**Chosen implementation path (explicit):** do **not** refactor `useDualAudioTranscript` into a full two-provider orchestration hook in this pass. Instead, `StandardMode` will explicitly orchestrate separate source routes:

- use `useTranscript` for the mic route when `micProvider === 'webspeech'`
- use `useDualAudioTranscript` for the system route with `captureMic=false`, `captureSystem=true`, `transcribeProvider=systemProvider`
- when `micProvider !== 'webspeech'`, instantiate a second `useDualAudioTranscript` for mic-only with `captureMic=true`, `captureSystem=false`, `transcribeProvider=micProvider`

This keeps the source-specific strategy visible in `StandardMode` and avoids turning `useDualAudioTranscript` into a second architecture project.

Target behavior:

- **mic-only mode**
  - default: `useTranscript` (browser-native Web Speech)
  - no regression from current mic-only mode
- **mic + system mode**
  - mic default: `useTranscript`
  - system default: `useDualAudioTranscript` with `captureSystem=true`, `captureMic=false`, `systemProvider='windows-live-captions'`
  - if explicit advanced mic provider is not `webspeech`, allow mic to use `useDualAudioTranscript` for mic only

Important behavior changes:

- `windowsLiveCaptionsMicrophoneAssist` should only influence WLC startup as a compatibility option.
- Turning microphone assist on must **not** disable or replace the native mic route.
- Runtime labels should become source-specific and clearer, e.g.:
  - `Mic=webspeech | System=windows-live-captions`
  - if assist enabled: add a small compatibility note rather than redefining the whole mode

### 5. Prefer mic over system when WLC microphone assist is enabled

Adjust duplicate handling in `desktop/src/hooks/useDualAudioTranscript.js` so WLC system text does not suppress actual mic speech in the common dual-route setup.

Required logic:

- when a system segment overlaps with recent mic content, it is acceptable to drop the system duplicate
- do **not** drop real mic segments just because a system WLC segment arrived first
- preserve Candidate/MIC and Interviewer/SYSTEM source labels in transcript entries

This is the core protection against candidate speech being swallowed by system captions.

### 6. Keep WLC hide failures non-blocking

In `useDualAudioTranscript` and any related UI state:

- failure to hide Windows Live Captions must not abort listening
- show at most a lightweight warning/status line
- keep transcript capture running

### 7. Tighten transcript noise removal

Update `desktop/src/utils/interviewTranscript.js` to better remove Windows Live Captions menu/UI noise.

Required changes:

- keep existing whole-segment noise removal
- additionally strip known embedded fragments such as:
  - `Change language`
  - `Include microphone audio`
  - `Preferences`
  - `Address and search bar`
  - localized equivalents already present in the codebase
- do not over-strip normal transcript text

Update tests in `desktop/src/utils/interviewTranscript.test.js` to cover embedded-noise cases, not only whole-noise segments.

### 8. Add source tag to export

Update `desktop/src/utils/interviewTranscript.js` export builder so transcript export contains both speaker and source labels, e.g.:

`[timestamp] [Candidate] [mic] [en-US] ...`

This satisfies the requirement that export preserves speaker/source structure.

Update any tests covering export formatting.

### 9. Remove local whisper from the default auto path

Update `server/routes/ai.js`:

- remove `local` from the default auto provider chain
- target auto chain becomes:
  - system: `windows-live-captions -> openai -> gemini`
  - mic: `openai -> gemini`

Rationale:

- Local Whisper remains available only when explicitly chosen
- Auto mode should no longer be slowed down by the local service

Also update desktop labeling and UI copy to reflect the new default routing.

### 10. Demote Local Whisper to experimental UI placement

Update desktop setup UI so `Local Whisper` is either:

- an advanced option within source-specific provider controls, and/or
- explicitly labeled `Experimental`

It must no longer read as the normal default path.

### 11. Stop auto-managing Local Whisper unless explicitly selected

Update `desktop/src/hooks/useDualAudioTranscript.js` so Local Whisper health/startup is only ensured when a selected source explicitly uses `local`, not because a generic `auto` chain might fall through to it.

This prevents Local Whisper from slowing the default path.

### 12. Add feasibility note for Chrome / Google direction

Create a concise repo note, e.g. `docs/transcription-feasibility.md`, covering:

- **Chrome / Web Speech**
  - good for microphone input
  - limited browser availability
  - may rely on cloud/server-side recognition in Chromium
  - not a real system-audio transcription solution
- **Google Cloud STT**
  - feasible through current Node server chunk-upload architecture
  - requires credentials/billing
  - suitable as a future formal cloud/system provider option
  - not necessary to ship this convergence pass
- **Recommendation**
  - ship now: Mic=`webspeech`, System=`windows-live-captions`
  - future optional cloud system provider: `google-stt`-style server route if needed
  - do not use Chrome UI scraping as a formal solution

### 13. Tests and verification

Minimum required verification per workstream:

#### Workstream A

- **Task A1 — persisted setup migration**
  - Tool: desktop Jest
  - Files: `desktop/src/store/interviewStore.js`
  - Steps:
    1. Add/extend store tests to seed legacy persisted setup values including `sttProvider` and `windowsLiveCaptionsIncludeMicrophoneAudio`
    2. Rehydrate the store
    3. Assert `micProvider`, `systemProvider`, and `windowsLiveCaptionsMicrophoneAssist` are migrated correctly
  - Expected result:
    - migrated sessions preserve prior WLC mic-assist intent

- **Task A2 — setup/settings UI and persistence**
  - Tool: desktop Jest or existing component test style
  - Files: `desktop/src/components/InterviewSetup/index.jsx`, `desktop/src/components/MoreSettings/index.jsx`
  - Steps:
    1. Render setup/settings surfaces
    2. Toggle WLC hide and microphone-assist options
    3. Assert the shared persisted store updates the same canonical setup fields
  - Expected result:
    - user can configure WLC behavior before listening and from More Settings without duplicated state

- **Task A3 — transcript noise removal**
  - Tool: desktop Jest
  - Files: `desktop/src/utils/interviewTranscript.js`, `desktop/src/utils/interviewTranscript.test.js`
  - Steps:
    1. Add cases for standalone noise strings and embedded noise strings
    2. Verify real transcript text survives while menu phrases are removed
  - Expected result:
    - transcript no longer contains `Change language`, `Include microphone audio`, `Preferences`, or `Address and search bar`

- **Task A4 — WLC UX scenario**
  - Tool: Electron scenario script
  - Files: `desktop/scripts/electron-windows-live-captions-scenarios.cjs`
  - Steps:
    1. Update scenario expectations for new setup copy and runtime labels
    2. Verify listening starts even if hide/show controls report non-blocking issues
  - Expected result:
    - WLC path still starts and does not block listening on hide failure

#### Workstream B

- **Task B1 — source-specific routing in StandardMode**
  - Tool: desktop Jest and targeted code review
  - Files: `desktop/src/components/StandardMode/index.jsx`
  - Steps:
    1. Verify the chosen implementation path is used: `useTranscript` for `micProvider='webspeech'`, separate `useDualAudioTranscript` instances for system and any non-webspeech mic provider
    2. Verify mic-only mode still routes through `useTranscript` by default
  - Expected result:
    - no hidden combined-provider path remains as the default dual-route strategy

- **Task B2 — transcript/source labeling and export**
  - Tool: desktop Jest
  - Files: `desktop/src/components/StandardMode/index.jsx`, `desktop/src/utils/interviewTranscript.js`
  - Steps:
    1. Add/extend tests for transcript entry speaker/source fields
    2. Add/extend export tests to assert `[speaker] [source] [language]` output
  - Expected result:
    - Candidate/MIC and Interviewer/SYSTEM labels remain correct in UI and export

- **Task B3 — mic-only and dual-route scenario coverage**
  - Tool: Electron scenario scripts
  - Files: `desktop/scripts/electron-mic-only-scenarios.cjs`, `desktop/scripts/electron-windows-live-captions-scenarios.cjs`
  - Steps:
    1. Update provider-label expectations to the new source-specific strings
    2. Verify mic-only still works without WLC dominance
    3. Verify Mic + System no longer assumes `windows-live-captions + mic-assist` as the main mode
  - Expected result:
    - mic-only remains healthy and dual-route labels match the new strategy

#### Workstream C

- **Task C1 — server auto-chain update**
  - Tool: server Jest
  - Files: `server/routes/ai.js`, `server/__tests__/ai.route.test.js`
  - Steps:
    1. Update provider-chain tests for mic and system auto behavior
    2. Assert `local` is no longer in the default auto chain
    3. Assert explicit `local` selection still works
  - Expected result:
    - auto no longer prefers or falls through to local whisper as part of the normal path

- **Task C2 — desktop local-whisper demotion**
  - Tool: desktop Jest or component test style
  - Files: `desktop/src/components/InterviewSetup/index.jsx`, `desktop/src/store/interviewStore.js`, `desktop/src/hooks/useDualAudioTranscript.js`
  - Steps:
    1. Verify default setup uses `micProvider='webspeech'` and `systemProvider='windows-live-captions'`
    2. Verify `local` is labeled experimental or moved into advanced configuration
    3. Verify local service is only ensured when an explicit source selects `local`
  - Expected result:
    - local whisper no longer slows the default path

- **Task C3 — feasibility note**
  - Tool: file review
  - Files: `docs/transcription-feasibility.md`
  - Steps:
    1. Verify note includes Chrome/Web Speech capabilities and limits
    2. Verify note includes Google STT integration point and recommendation
    3. Verify note explicitly rejects Chrome UI scraping as the formal solution
  - Expected result:
    - repo contains a practical recommendation, not just vague future ideas

#### Final verification

- `cd desktop && npx react-scripts test --watchAll=false`
- `cd desktop && npm run react-build`
- `cd server && npx jest --forceExit`

## Atomic Commit Breakdown

1. `migrate desktop setup to source-specific transcription fields`
2. `update setup and more-settings for wlc configuration convergence`
3. `refactor standard mode to separate mic and system routes`
4. `tighten transcript noise filtering and export source labels`
5. `remove local whisper from default auto chain and add feasibility note`

## Files Expected To Change

### Desktop

- `desktop/src/store/interviewStore.js`
- `desktop/src/components/InterviewSetup/index.jsx`
- `desktop/src/components/InterviewSetup/InterviewSetup.css`
- `desktop/src/components/MoreSettings/index.jsx`
- `desktop/src/components/MoreSettings/MoreSettings.css`
- `desktop/src/components/StandardMode/index.jsx`
- `desktop/src/hooks/useDualAudioTranscript.js`
- `desktop/src/utils/interviewTranscript.js`
- `desktop/src/utils/interviewTranscript.test.js`
- desktop scenario scripts that assert provider labels

### Server

- `server/routes/ai.js`
- `server/__tests__/ai.route.test.js`

### Docs

- `docs/transcription-feasibility.md` (new)

## Acceptance Criteria

- WLC hide setting is visible before interview start and persisted
- More Settings can also adjust the same WLC settings
- entering Listening applies the persisted WLC hide behavior
- hide failure does not interrupt listening
- transcript no longer contains menu noise like `Change language`, `Include microphone audio`, `Preferences`, `Address and search bar`
- mic + system mode defaults to Mic=`webspeech`, System=`windows-live-captions`
- WLC microphone assist is explicit, experimental, and defaults off
- candidate speech is not routinely swallowed by the system route in dual mode
- mic-only mode still works
- export includes correct speaker/source labels
- auto mode no longer defaults/falls through to local whisper first
- local whisper is clearly experimental or advanced-only
- feasibility note is added with Chrome/Google guidance and formal recommendation
