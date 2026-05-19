# Source-Specific Transcription Compatibility Policy

## Status

Current runtime model:

- Desktop settings use `micProvider` and `systemProvider`.
- Desktop chunk-transcription requests use `transcribeProvider`.
- Legacy `sttProvider` is **not** a current desktop/runtime field.

Legacy compatibility removed:

- The server no longer accepts `sttProvider` as a backward-compatibility alias for `transcribeProvider`.
- Requests that still send `sttProvider` now fail explicitly so callers cannot silently drift onto the wrong runtime behavior.

## Precedence and behavior

The server now applies these rules:

1. If `transcribeProvider` is present, it is used.
2. If legacy `sttProvider` is present, the server returns `400` and instructs the caller to use `transcribeProvider`.
3. If neither explicit field is present, the server uses the current source-specific auto-chain behavior.

Breaking-release response shape for removed legacy input:

```json
{
  "error": "sttProvider has been removed in this major release; use transcribeProvider.",
  "code": "stt_provider_removed",
  "removedField": "sttProvider",
  "replacementField": "transcribeProvider"
}
```

This means `sttProvider` is no longer supported as an API field.

## Scope of compatibility

Breaking-change enforcement is intentionally narrow:

- enforced in `server/routes/ai.js`
- covered by `server/__tests__/ai.route.test.js`
- documented in `README.md`

Compatibility is **not** kept in desktop persisted state. Desktop migration rewrites old saved `sttProvider` values into `micProvider` / `systemProvider` and removes `sttProvider` from current saved state.

## Breaking-change status

This is the breaking-change state.

- `sttProvider` removal is now active.
- Older callers must rename the field to `transcribeProvider`.
- Desktop persisted-state migration still exists only to rewrite older local setup state; it is not an API compatibility promise.

## Maintainer guidance

- Do not add new product behavior on top of `sttProvider`.
- Do not reintroduce `sttProvider` into desktop UI, persisted state, or server request handling.
- If a caller still depends on it, migrate the caller to `transcribeProvider`; do not restore the shim silently.
