# InterviewHelper

An AI-powered interview assistant desktop application that provides real-time answer generation during interviews. Built with Electron, React, Node.js, and OpenAI GPT-4o.

---

## Features

- **Live Transcript** — Real-time speech-to-text via Web Speech API
- **AI Answer Generation** — Streaming answers powered by GPT-4o, personalised with your resume and background
- **Standard Mode** — Overlay window with screen-capture protection
- **Undetectable Mode** — Desktop stays hidden; answers stream to your phone via a session code
- **Configurable Settings** — STAR/CAR/PAR/SOAR structure, response style, answer length, detection sensitivity
- **Cross-Platform** — Windows and macOS via Electron

---

## Project Structure

```
interview-hammer/
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
└── shared/                    # Shared constants
    └── constants.js
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys)

### 1. Start the server

```bash
cd server
cp .env.example .env          # Fill in OPENAI_API_KEY
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

---

## Configuration

### Interview Setup

| Field | Description |
|---|---|
| Topic | Interview category (Software Engineering, Behavioral, etc.) |
| Interview Language | Language the interviewer speaks |
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
| Hide from Screen Sharing | Uses `setContentProtection` (macOS) to prevent capture |
| Hide App Icon | Removes app from taskbar/dock |

---

## Undetectable Mode

1. Open the desktop app and navigate to **Undetectable Mode**
2. Note the session code (e.g. `IRON-7842`)
3. Open the mobile companion app and tap **Connect to Session**
4. Enter the session code — answers stream to your phone in real time
5. Optionally click **Hide App** to hide the desktop window

---

## Building for Production

```bash
cd desktop
npm run build     # Builds React app + packages with electron-builder
```

Output is in `desktop/out/`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 27, React 18 |
| UI | Custom CSS (dark overlay aesthetic) |
| State | Zustand (persisted) |
| Backend | Node.js, Express |
| Real-time | Socket.io |
| AI | OpenAI GPT-4o (streaming) |
| Payments | Stripe |
| Mobile (Phase 2) | React Native |