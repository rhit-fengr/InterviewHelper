# Source-Specific Transcription Release Note

## Summary

This release finalizes the move from a shared transcription selector to a source-specific model:

- microphone uses `micProvider`
- system audio uses `systemProvider`
- desktop requests use `transcribeProvider`

## What shipped

- Source-specific desktop setup and settings flow
- Desktop runtime split for mic and system transcription
- Windows Live Captions kept as a Windows-only system-audio route
- Local whisper removed from the default auto path and retained as an explicit experimental option
- New acceptance coverage for `InterviewSetup`, `MoreSettings`, and `UndetectableMode`
- Electron smoke and key audio-chain automation aligned with the refactor

## Compatibility policy

- `sttProvider` is no longer a current desktop/runtime field
- the server no longer accepts legacy `sttProvider`; callers must use `transcribeProvider`
- legacy payloads now fail explicitly with a migration error instead of being silently remapped

## Maintainer note

Do not treat `sttProvider` as unfinished cleanup. This release is the breaking removal for the legacy request field. Desktop persisted-state migration may remain for old local settings, but the server request contract is now `transcribeProvider` only.
