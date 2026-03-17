# AGENTS.md — InterviewHelper

> Guidelines for agentic coding agents operating in this repository.

## Project Structure

Monorepo with 4 independent sub-projects (no workspace manager):

| Directory              | Stack                        | Module System          |
|------------------------|------------------------------|------------------------|
| `server/`              | Node.js, Express, Jest 29    | CommonJS (`require`)   |
| `desktop/`             | Electron, React 18, Zustand  | ES Modules (`import`)  |
| `mobile/`              | React Native, Expo 49        | ES Modules             |
| `local-whisper-service/` | Python 3.10+, FastAPI       | Python modules         |

Each sub-project has its own `package.json` (or `requirements.txt`). Install dependencies per-project.

---

## Build & Run Commands

### Server (`server/`)
```bash
npm install
npm start          # node index.js (production)
npm run dev        # nodemon index.js (development)
```
Requires `.env` — copy `.env.example`. Default port: 4000.

### Desktop (`desktop/`)
```bash
npm install
npm start          # concurrently: server + react-scripts + electron
npm run build      # CRA production build
npm run build:win  # electron-builder Windows package
```
Requires `.env` — copy `.env.example`. Needs server running on port 4000.

### Mobile (`mobile/`)
```bash
npm install
npx expo start
```

### Local Whisper Service (`local-whisper-service/`)
```bash
pip install -r requirements.txt
python app.py                      # or start_local_whisper.bat on Windows
```

---

## Test Commands

### Run All Tests
```bash
cd server  && npx jest --forceExit
cd desktop && npx react-scripts test --watchAll=false
cd mobile  && npx jest --watchAll=false
```

### Run a Single Test
```bash
# Server — by file
cd server && npx jest --forceExit __tests__/app.test.js

# Server — by test name
cd server && npx jest --forceExit -t "test name pattern"

# Desktop — by file
cd desktop && npx react-scripts test --watchAll=false src/utils/autoAnswer.test.js

# Mobile — by file
cd mobile && npx jest --watchAll=false __tests__/ConnectScreen.test.js
```

### Test File Locations
- **Server**: `server/__tests__/*.test.js` (supertest for HTTP, socket.io-client for WS)
- **Desktop**: colocated `src/**/*.test.js` (React Testing Library)
- **Mobile**: `mobile/__tests__/*.test.js` (jest-expo, @testing-library/react-native)
- **Mobile mocks**: `mobile/__mocks__/socket.io-client.js` (manual mock)

### E2E / Smoke Tests (Desktop)
```bash
cd desktop && npm run test:e2e            # Playwright
cd desktop && npm run test:electron-smoke # Electron smoke test
```

---

## Linting & Formatting

No ESLint, Prettier, or EditorConfig is configured. Follow the conventions below by reading existing code.

---

## Code Style Guidelines

### General (All JS/JSX)
- **Indent**: 2 spaces
- **Quotes**: single quotes (`'`) for strings; backticks for interpolation
- **Semicolons**: always
- **Trailing commas**: yes (objects, arrays, function params)
- **Line length**: no enforced limit; keep reasonable (~100-120 chars)
- **File naming**: camelCase for `.js` files, PascalCase not used in filenames

### Server (Node.js — CommonJS)
- Start every file with `'use strict';`
- Use `require()` / `module.exports` — NOT ES modules
- Declare functions with `function` keyword (not arrow for top-level)
- Arrow functions are fine for callbacks and inline handlers
- Name constants with `UPPER_SNAKE_CASE`
- Log errors with tagged prefix: `console.error('[TagName]', err)`
- Error handling: try/catch, set `err.status` before throwing, always log context
- JSDoc `/** */` comments for exported functions

```js
'use strict';
const express = require('express');
const router = express.Router();

const MAX_RETRIES = 3;

/** Process the uploaded file */
function processUpload(req, res) {
  try {
    // ...
  } catch (err) {
    console.error('[processUpload]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = router;
```

### Desktop (React — ES Modules)
- Use `import` / `export` — NOT CommonJS
- `.jsx` extension for components, `.js` for hooks, utils, stores, constants
- Functional components only — no class components
- Default export for components: `export default function ComponentName()`
- Named exports for hooks: `export function useHookName()`
- Named exports for utils and constants
- Hooks pattern: `useState`, `useCallback`, `useRef`, `useEffect`
- State management: Zustand with `persist` middleware (`src/store/`)
- CSS: plain CSS files colocated with components (`ComponentName.css`)
- Component folders: `src/components/ComponentName/index.jsx` + `.css`

```jsx
import { useState, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import './MyComponent.css';

export default function MyComponent({ onSubmit }) {
  const [value, setValue] = useState('');
  const settings = useInterviewStore((s) => s.settings);

  const handleChange = useCallback((e) => {
    setValue(e.target.value);
  }, []);

  return <div className="my-component">...</div>;
}
```

### Mobile (React Native — ES Modules)
- Same conventions as Desktop (ES modules, functional components, hooks)
- Styles via `StyleSheet.create()` at bottom of file
- Navigation screens in `screens/`, hooks in `hooks/`
- Socket communication via custom `useSocketClient` hook

### Python (Local Whisper Service)
- Python 3.10+ with type hints on function signatures
- FastAPI with `async def` endpoints
- Use `logging` module (not print) — configure at module level
- Follow existing patterns in `app.py`

---

## Environment Variables

Never commit `.env` files. Reference `.env.example` in each sub-project:
- `server/.env.example` — AI_PROVIDER, API keys, PORT, CORS_ORIGIN, Stripe keys
- `desktop/.env.example` — REACT_APP_SERVER_URL

---

## Key Architectural Patterns

- **AI Provider Abstraction**: `server/services/openai.service.js` supports OpenAI and Gemini via `AI_PROVIDER` env var. Extend here for new providers.
- **SSE Streaming**: `server/routes/ai.js` streams AI responses to desktop client via Server-Sent Events.
- **Socket.io Sessions**: `server/services/socket.service.js` manages real-time sessions between desktop and mobile using in-memory Maps.
- **Zustand Store**: `desktop/src/store/interviewStore.js` is the single source of truth for desktop app state, with localStorage persistence.
- **Windows Live Captions**: Desktop captures system audio captions via native integration (Windows-only feature).

---

## Common Pitfalls

- Server tests require `--forceExit` (open handles from Socket.io/Express).
- Desktop `npm start` launches 3 processes concurrently — server, React, and Electron.
- Mobile uses manual `__mocks__/socket.io-client.js` — update it when changing socket events.
- No TypeScript anywhere — all plain JavaScript. Do not introduce `.ts` files.
- No monorepo tooling — `cd` into sub-project before running any command.
