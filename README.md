# Interview AI Hamburger

An AI-powered interview assistant desktop application that provides real-time answer generation during interviews. Built with Electron, React, Node.js, and provider-flexible AI backends (OpenAI or Google Gemini).

---

## Features

- **Live Transcript** — Real-time speech-to-text via Web Speech API, resizable transcript panel, and auto-scroll to the latest line
- **AI Answer Generation** — Streaming answers powered by OpenAI or Google Gemini, personalised with your resume and background
- **Standard Mode** — Overlay window with screen-capture protection
- **Undetectable Mode** — Desktop stays hidden; answers stream to your phone via a session code
- **Configurable Settings** — STAR/CAR/PAR/SOAR structure, response style, answer length, detection sensitivity
- **Conversation Context Controls** — Conversation history panel can be expanded, collapsed, or hidden without affecting export/context memory
- **Cross-Platform** — Windows and macOS via Electron

---

## Project Structure

```
interview-ai-hamburger/
├── desktop/                   # Electron + React desktop app
│   ├── electron/
│   │   ├── main.js            # Main process (window management, screen protection)
│   │   └── preload.js         # Context bridge for renderer
│   ├── src/
│   │   ├── components/
│   │   │   ├── InterviewSetup/
│   │   │   ├── SessionSettings/
│   │   │   ├── MoreSettings/
│   │   │   ├── StandardMode/
│   │   │   └── UndetectableMode/
│   │   ├── hooks/
│   │   │   ├── useTranscript.js
│   │   │   ├── useAIAnswer.js
│   │   │   └── useSocketSync.js
│   │   └── store/
│   │       └── interviewStore.js
│   └── package.json
├── server/                    # Node.js + Express API
│   ├── routes/
│   │   ├── ai.js
│   │   ├── session.js
│   │   ├── user.js
│   │   └── billing.js
│   ├── services/
│   │   ├── openai.service.js
│   │   └── socket.service.js
│   ├── app.js
│   └── index.js
└── mobile/                    # React Native (Expo) companion app
    ├── screens/
    │   ├── ConnectScreen.js   # Enter server URL + session code
    │   └── SessionScreen.js   # Live answer streaming display
    ├── hooks/
    │   └── useSocketClient.js # Socket.io client lifecycle
    ├── App.js
    └── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys) or a [Google Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)
- **Chrome or Chromium-based browser / Electron** — Web Speech API is only available in Chromium. The desktop app runs inside Electron (which bundles Chromium), so speech recognition works out of the box. If you open the React app in Firefox or Safari without Electron, the `useTranscript` hook will display an error and disable the mic button.

### 1. Start the server

```bash
cd server
cp .env.example .env          # Set AI_PROVIDER + matching API key
npm install
npm run dev
```

The server starts on `http://localhost:4000`.

### 2. Start the desktop app

```bash
cd desktop
cp .env.example .env.local    # Set REACT_APP_SERVER_URL if needed
npm install
npm start
```

This launches the React dev server on port 3000, then opens the Electron window.

### 3. Start the mobile companion app (Undetectable Mode)

```bash
cd mobile
cp .env.example .env          # Set EXPO_PUBLIC_SERVER_URL if needed
npm install
npm start
```

Open the Expo Go app on your phone and scan the QR code, or run `npm run ios` / `npm run android` for a native build.

---

## Configuration

### Interview Setup

| Field | Description |
|---|---|
| AI Provider | `OpenAI` or `Google Gemini` |
| Transcription Provider | `Auto` (OpenAI -> Gemini -> Local), `OpenAI`, `Gemini`, or `Local Whisper Service` |
| Topic | Interview category (Software Engineering, Behavioral, etc.) |
| Interview Language | One or more interviewer languages (auto-cycled when multiple are selected) |
| Answer Language | Language for AI-generated answers |
| Additional Instructions | Your background / custom prompt additions |

### Answer Settings

| Setting | Options |
|---|---|
| Behavioral Structure | STAR, CAR, PAR, SOAR |
| Response Style | Conversational, Structured, Concise, Detailed |
| Answer Length | Short (~30s), Medium (~1min), Long (~2min) |
| Detection Sensitivity | Low, Medium, High |

### Advanced Settings

| Setting | Description |
|---|---|
| Hide from Screen Sharing | Uses `setContentProtection` (macOS) to prevent capture (Electron runtime only) |
| Hide App Icon | Removes app from taskbar/dock (Electron runtime only) |

If you run only the web preview (`localhost:3000`) without Electron, desktop-only controls (opacity / always-on-top / hide-from-screen-sharing / hide-app-icon) are intentionally shown as disabled to avoid false expectations.

---

## How It Works

### Speech Recognition (`useTranscript.js`)

Speech-to-text is powered by the browser's native [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) (`SpeechRecognition` / `webkitSpeechRecognition`). The hook:

- Runs continuously with `interimResults: true` so you see words as you speak.
- Automatically restarts if the browser ends the session (e.g. after a short pause) — the restart is guarded by a ref so it won't fire after the user has explicitly stopped.
- Supports multi-language mode by rotating recognition language across selected interview languages when no finalized speech is detected for a short interval.
- Exposes an `error` state for any `SpeechRecognitionError` except `no-speech` (brief silence is normal and should not surface as a user-visible error).
- Sets `recognition.lang` from the selected interview languages, so the API can capture bilingual interview flows better than single-language mode.

Speaker labels in the transcript are heuristic (`Interviewer` / `Candidate`) and are intended for readability/export organization. Web Speech API itself does not provide true speaker diarization.

### AI Prompt Engineering (`openai.service.js`)

Every answer request builds a personalised system prompt that includes:

- **Candidate profile** — name, current role, company, years of experience, skills, work history, education.
- **Answer structure** — the chosen behavioral framework (STAR / CAR / PAR / SOAR).
- **Style & length** — conversational, structured, concise, or detailed; token budget maps to short (~200 tokens), medium (~500 tokens), or long (~1,000 tokens).
- **Answer language** — instructs the selected model provider to reply in the chosen language.
- **Additional context** — anything you add in the *Additional Instructions* field.

The model is told to respond naturally as the candidate (no "As an AI…" preamble).

### Detection Sensitivity

Detection Sensitivity controls how aggressively `POST /api/ai/detect-question` classifies incoming transcript text as an interview question. The setting maps to a natural-language instruction sent to the selected provider's detection model:

| Level | Behaviour |
|---|---|
| **Low** | Triggers only on explicit questions with a question mark. |
| **Medium** (default) | Triggers on clear questions and reasonably implied questions. |
| **High** | Triggers on explicit questions, implicit questions, and subtle prompts like "tell me about…" or "walk me through…". |

The result is `{ isQuestion: boolean, question: string | null }`. If `isQuestion` is `true` the extracted question is sent to `POST /api/ai/answer` for streaming generation.

### Duplicate Auto-Answer Guard

To avoid duplicated answers from repeated detection callbacks, both Standard and Undetectable mode apply question deduplication before auto-triggering generation:

- Normalizes question text (`case`, punctuation, repeated spaces) into a stable key.
- Skips retrigger if the same normalized question is already in-flight.
- Skips retrigger if the same normalized question was auto-answered within a short cooldown window.

Manual `Answer Current Transcript` remains available even when `Auto Answer` is ON, so you can force a retry when needed.

---

## Error Handling

### AI Provider API

| Situation | What happens |
|---|---|
| Provider key not set | Server starts with a warning; `/api/ai/*` routes return `503` with provider-specific key hint (`OPENAI_API_KEY` or `GEMINI_API_KEY`). |
| Network error / timeout | The AI client is configured with a **30-second timeout** and **3 automatic retries** (with exponential back-off). If all retries fail the SSE stream sends `{"error":"Failed to start answer generation"}` and closes. |
| Rate limit (HTTP 429) | Caught as a distinct error class; the SSE stream sends `{"error":"Rate limit reached. Please wait a moment and try again."}` so the user sees an actionable message instead of a generic failure. |
| Streaming error mid-response | Caught in the `for await` loop; sends `{"error":"Answer generation failed"}` and closes the stream. |

### Speech Recognition

| Situation | What happens |
|---|---|
| Browser does not support Web Speech API | `useTranscript` sets `error` to "Speech recognition is not supported in this browser." The mic button is disabled. |
| `no-speech` error | Silently ignored — brief silence is not treated as an error. |
| Other `SpeechRecognitionError` | Surfaced via the `error` state and displayed in the UI error box. |
| Recognition session ends unexpectedly | The `onend` handler restarts automatically as long as listening is still enabled. |

### Network / WebSocket

| Situation | What happens |
|---|---|
| Server unreachable (mobile) | `useSocketClient` reports `connect_error`; `sessionStatus` → `'error'`; `onSessionError` is called with a human-readable message including the underlying OS error. |
| Reconnection | Socket.io is configured with `reconnectionAttempts: 5` and `reconnectionDelay: 2000 ms`. |
| Host desktop disconnects | Mobile receives `host-disconnected`; `sessionStatus` → `'error'`; the UI shows a reconnect prompt. |
| Session code expired (> 2 hours) | Both host and mobile receive `session-error` with "Session expired" message. The TTL is configurable via the `SESSION_TTL_MS` environment variable. |

### Billing

| Situation | What happens |
|---|---|
| `STRIPE_SECRET_KEY` not set | Billing routes return `503` with a clear error. |
| Stripe API error | Caught and logged server-side; client receives `{"error":"Failed to ..."}` with no internal detail leaked. |

---

## Stripe Billing Integration

Billing is a **real Stripe integration**, not a placeholder. The server (`routes/billing.js`) implements:

- `POST /api/billing/create-customer` — creates a Stripe Customer object.
- `POST /api/billing/create-subscription` — attaches a payment method and creates a `$30/month` subscription using the configured `STRIPE_PRICE_ID`.
- `POST /api/billing/cancel-subscription` — schedules cancellation at period end.
- `POST /api/billing/webhook` — verifies Stripe webhook signatures and handles `customer.subscription.deleted` and `invoice.payment_succeeded` events.

To enable billing, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` in `server/.env`. Use [Stripe test mode](https://stripe.com/docs/testing) keys during development.

---

## Undetectable Mode

1. Open the desktop app and navigate to **Undetectable Mode**
2. Note the session code (e.g. `IRON-7842`)
3. Open the mobile companion app and tap **Connect to Session**
4. Enter the session code — answers stream to your phone in real time
5. Optionally click **Hide App** to hide the desktop window

---

## Automated Tests

```bash
cd server && npm test    # 29 Jest tests (routes, services, socket integration)
cd mobile && npm test    # Jest + React Native Testing Library (hooks + screens)
```

The server test suite covers:

- AI streaming route — happy path, generic errors, and HTTP 429 rate-limit errors.
- `buildSystemPrompt` — candidate name, missing fields, behavioral structure, answer language.
- Socket service — session creation, mobile join, transcript/answer forwarding, spoofing prevention, host disconnect notification, session expiry.
- Health, session, user, AI, and billing routes (all with and without credentials).

---

## Building for Production

```bash
cd desktop
npm run build     # Builds React app + packages with electron-builder
```

Output is in `desktop/out/`.

Windows-specific release helpers:

```bash
cd desktop
npm run build:win             # NSIS installer (.exe)
npm run build:win:unsigned    # NSIS installer without sign/edit (dev fallback)
npm run build:win:portable    # Portable .exe
npm run release:win:unsigned  # Build + hashes (unsigned smoke)
npm run release:win           # Build + hashes + signature verification
```

Detailed signing and installer acceptance checklist:
- `desktop/RELEASE_WINDOWS.md`

Subtitle-plugin evolution plan:
- `docs/SUBTITLE_PLUGIN_ROADMAP.md`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 27, React 18 |
| UI | Custom CSS (dark overlay aesthetic) |
| State | Zustand (persisted) |
| Backend | Node.js, Express |
| Real-time | Socket.io |
| AI | OpenAI / Google Gemini (streaming via OpenAI-compatible API) |
| Payments | Stripe |
| Mobile | React Native (Expo) |

---

## Troubleshooting

**No speech is being recognised**
- Make sure you are running the app through Electron (not a non-Chromium browser).
- Check that your OS microphone permission is granted for Electron.
- Verify the **Interview Language** setting matches the language you are speaking.
- `Mic only` mode already uses browser-native Web Speech API (Chrome/Edge runtime speech engine), no cloud STT required.

**Mic + System has no transcript output**
- In `Interview Setup`, set **Transcription Provider** to `Auto` or `OpenAI` for stable real-time chunks.
- Gemini chunk transcription is "best effort" and can return empty segments on short windows; this is not as reliable as Whisper-style STT.
- If using `OpenAI` transcription, set `OPENAI_API_KEY` in `server/.env`.
- If you intentionally use `Gemini` transcription, set `GEMINI_API_KEY` and increase spoken segment length (very short bursts may return empty text).
- For non-cloud setup, configure `LOCAL_TRANSCRIBE_URL` and choose `Local Whisper Service`.

**App feels laggy or buttons are unresponsive in Chrome**
- Chrome's Web Speech API sends audio to Google's servers, which can introduce latency and cause brief UI stalls during heavy speech recognition activity. Microsoft Edge uses a local Windows speech recognition engine which is typically smoother.
- If Chrome performance is a concern, try Microsoft Edge — the app is fully supported in both browsers.
- Running the app as a packaged Electron app (`npm run build`) instead of in the browser dev server also reduces overhead.

**Why are some settings disabled in localhost web preview?**
- `Window Opacity`, `Always On Top`, `Hide from Screen Sharing`, and `Hide App Icon` require Electron APIs and are disabled in pure web preview mode by design.
- Use `npm start` in `desktop/` (which launches Electron after the dev server) or a packaged build to validate those settings end-to-end.

**"Failed to fetch" or "Cannot connect to server" error**
- The backend server is not running. Start it with `cd server && npm run dev`.
- Make sure `server/.env` exists and the selected provider key is set (`OPENAI_API_KEY` or `GEMINI_API_KEY`).
- If the desktop React app is served on a different port/host than the default `http://localhost:4000`, update `REACT_APP_SERVER_URL` in `desktop/.env.local`.

**"AI service is not configured" error**
- The selected provider key is missing in `server/.env`.
- If `AI_PROVIDER=openai`, set `OPENAI_API_KEY`.
- If `AI_PROVIDER=gemini`, set `GEMINI_API_KEY`.

**Microphone permission denied ("Microphone access denied" error)**
- Click the camera/microphone icon in your browser's address bar and allow microphone access for this page.
- In Chrome: go to **Settings → Privacy and security → Site settings → Microphone** and ensure the site is not blocked.
- In Edge: go to **Settings → Cookies and site permissions → Microphone** and allow the site.
- After granting permission, refresh the page and try again.

**"Rate limit reached" error**
- Your OpenAI account has hit its per-minute token limit. Wait a few seconds and try again, or upgrade your OpenAI usage tier.
- The server now applies provider-level cooldown (`AI_RATE_LIMIT_COOLDOWN_MS`, default 60s) after a 429 to avoid repeatedly hammering the API.
- During cooldown, question detection automatically falls back to heuristic parsing instead of calling the model.

**"Gemini rejected this request (400)" error**
- Verify `AI_PROVIDER=gemini` and `GEMINI_API_KEY` are set in `server/.env`.
- Use a broadly available model first, e.g. `GEMINI_MODEL=gemini-2.0-flash`.
- Optionally set fallbacks, e.g. `GEMINI_FALLBACK_MODELS=gemini-1.5-flash`.
- Restart the server after changing environment variables.

**"Answer Current Transcript" appears to do nothing**
- The manual answer button now extracts a question from the current transcript (typically the latest line) and sends that as the prompt (it no longer depends on question-detection heuristics).
- Ensure transcript text has at least one meaningful line and microphone input is active.

**Auto Answer occasionally generates duplicates**
- The app now deduplicates repeated auto-detected questions within a cooldown window.
- If you still need a fresh regeneration, click `Answer Current Transcript (Manual Retry)` to force a new answer.

**Mobile app cannot connect**
- Ensure the device is on the same network as the server.
- Set `EXPO_PUBLIC_SERVER_URL` (mobile) and `CORS_ORIGIN` (server) to the server's LAN IP address (e.g. `http://192.168.1.10:4000`).
- Confirm the server is running and reachable (`curl http://<server-ip>:4000/health`).

**Answers mix content from previous questions**
- Each new question cancels the in-flight fetch request (`AbortController`) before starting a fresh SSE stream, so stale content should not appear. If you see mixing, tap/click **Clear** to reset the answer panel.
