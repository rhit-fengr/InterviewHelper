# Subtitle Plugin Roadmap (Desktop + Mobile)

This document defines the next-step plan to evolve Interview AI Hamburger from interview assistant into a reusable bilingual subtitle helper.

## Goals

- Reliable low-latency transcription for both mic and system audio.
- Optional real-time translation (e.g., zh <-> en) with glossary/domain terms.
- Reusable overlay widget that can run independently of interview answer generation.
- Export pipeline for notes, class recordings, and meeting summaries.

## Product Modes

1. Interview Mode
- Current behavior (question detection + answer generation).
- Transcript is structured and exportable.

2. Subtitle Mode (new)
- No answer generation required.
- Focus on live transcript + translation + quick note capture.
- Supports desktop overlay and mobile mirrored stream.

## STT Architecture (recommended)

1. Decouple providers:
- LLM provider (`setup.aiProvider`) for answer generation.
- STT provider (`setup.sttProvider`) for transcription.

2. Provider strategy:
- `OpenAI Whisper` for stable chunk transcription (default when configured).
- `Gemini` as best-effort fallback.
- `Browser-native Web Speech` for mic-only lightweight mode.
- `Local Whisper Service` adapter (`LOCAL_TRANSCRIBE_URL`) for no-cloud/offline-friendly setups.
- Optional future provider adapters:
  - Azure Speech (Windows-friendly enterprise option)
  - Google Cloud Speech-to-Text (dedicated STT engine)
  - Local/offline model for privacy-first mode

3. Transport:
- Keep chunk upload pipeline (`/api/ai/transcribe-chunk`) with provider selection.
- Add per-chunk metrics (latency, empty-rate, error-rate) for observability.

## Subtitle Widget Plan

1. Overlay widget
- Floating mini-panel
- Start/Stop
- Source selector (Mic / Mic+System)
- Language/translation selector
- Pin/opacity/font-size shortcuts

2. Transcript controls
- Rolling window (last N lines)
- Speaker labels (heuristic now, diarization later)
- One-click copy recent 30s/60s transcript

3. Export
- Raw transcript
- Transcript + translation
- Session summary (bullet points + action items)

## Technical Phases

Phase 1 (now):
- Stabilize dual audio transcription and provider fallback behavior.
- Ensure deterministic error messages and retry/cooldown handling.

Phase 2:
- Add `Subtitle Mode` entry in desktop UI and mobile mirror view.
- Add translation stream endpoint and dual-language render.

Phase 3:
- Add provider adapters for dedicated STT services.
- Add per-session analytics + quality dashboard.

Phase 4:
- Package a lightweight standalone subtitle assistant build profile.

## External References to Evaluate

- Recall-style meeting capture workflows: https://www.recall.ai/
- Local transcription utility patterns: https://github.com/zackees/transcribe-anything
- Live caption translation UX patterns: https://github.com/SakiRinn/LiveCaptions-Translator
