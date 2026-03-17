## Goal

Add desktop-only authentication and billing UI to the existing Electron/React app using the current server endpoints, without changing mobile, server contracts, routing architecture, or dependencies.

## Scope

- Desktop only (`desktop/`)
- Reuse current App.jsx view switching
- Reuse existing Zustand store
- Reuse `MoreSettings` as the account/profile-adjacent surface
- Use existing server endpoints:
  - `POST /api/user/register`
  - `POST /api/user/login`
  - `GET /api/user/profile`
  - `PUT /api/user/profile`
  - `GET /api/billing/status`
  - `POST /api/billing/create-customer`
  - `POST /api/billing/create-subscription`
  - `POST /api/billing/cancel-subscription`

## Constraints

- No new dependencies
- No TypeScript
- No new router
- No Stripe Elements or browser payment SDK
- Keep payment input dev-oriented with a plain `paymentMethodId` field because the backend already accepts it
- Keep mobile as the lightweight session companion

## Implementation Plan

### 1. Add shared desktop API client

Create `desktop/src/utils/api.js` with named helpers wrapping `fetch()` against `REACT_APP_SERVER_URL || 'http://localhost:4000'`.

Functions:

- `register`
- `login`
- `getProfile`
- `updateProfile`
- `getBillingStatus`
- `createCustomer`
- `createSubscription`
- `cancelSubscription`

Behavior:

- JSON request/response handling
- optional Bearer token header
- throw readable errors for non-2xx responses
- match the existing error-handling style used in desktop hooks

Add `desktop/src/utils/api.test.js` to mock `fetch` and verify success/error/header behavior.

### 2. Extend Zustand store with auth state

Update `desktop/src/store/interviewStore.js` to add an `auth` slice:

- `token`
- `user`
- `loading`
- `error`

Add actions:

- `setAuth`
- `clearAuth`
- `setAuthLoading`
- `setAuthError`

Persist `auth` in the existing `partialize` output so the desktop app can remember login state across reloads.

Add `desktop/src/store/authStore.test.js` to verify defaults and store actions.

### 3. Add desktop Auth panel

Create:

- `desktop/src/components/AuthPanel/index.jsx`
- `desktop/src/components/AuthPanel/AuthPanel.css`
- `desktop/src/components/AuthPanel/AuthPanel.test.js`

Behavior:

- login/signup mode toggle
- signup fields: name, email, password
- login fields: email, password
- submit via shared API client
- write token/user into Zustand store on success
- show inline error state on failure
- if already authenticated, show account summary and sign-out action
- expose a path onward to billing when authenticated

UI style should match the current dark overlay settings panels.

### 4. Add desktop Billing panel

Create:

- `desktop/src/components/BillingPanel/index.jsx`
- `desktop/src/components/BillingPanel/BillingPanel.css`
- `desktop/src/components/BillingPanel/BillingPanel.test.js`

Behavior:

- if unauthenticated: show sign-in-required message
- if authenticated: fetch billing status on load
- if no Stripe customer: show create-customer action
- if customer exists but no subscription: show plain `paymentMethodId` input and subscribe action
- if active subscription: show plan/status and cancel action
- if cancel-at-period-end: show that state clearly
- show inline loading and error feedback

Use a plain test payment method input such as `pm_card_visa`; do not add Stripe UI libraries.

### 5. Wire new views into desktop flow

Update `desktop/src/App.jsx` to add:

- `AUTH` view
- `BILLING` view

Render the new `AuthPanel` and `BillingPanel` through the existing conditional view-switching pattern.

Expose entry into auth from `desktop/src/components/InterviewSetup/index.jsx` by adding an auth/account link near the bottom:

- unauthenticated: “Sign In / Create Account”
- authenticated: “{name or email} · Account & Billing”

Navigation target flow:

- `SETUP -> AUTH`
- `AUTH -> BILLING`
- `BILLING -> AUTH`
- `AUTH -> SETUP`

Do not disturb existing `SETUP -> SESSION -> STANDARD/UNDETECTABLE/MORE` flows.

### 6. Add profile sync controls to MoreSettings

Update `desktop/src/components/MoreSettings/index.jsx` and `.css`:

- when authenticated, show:
  - “Sync Profile to Server”
  - “Pull from Server”
- push local profile to `/api/user/profile` using:
  - `name: personalInfo.fullName`
  - `personalInfo: personalInfo`
- pull remote profile and merge back into local store using:
  - `personalInfo.fullName = user.name || personalInfo.fullName`
  - remaining profile fields from `user.personalInfo`
- show inline success/error feedback

This keeps the existing local profile UI and adds server sync instead of duplicating profile-editing screens.

### 7. Verify

Run:

- `cd desktop && npx react-scripts test --watchAll=false`
- `cd server && npx jest --forceExit`

Also run `lsp_diagnostics` on changed desktop files.

## Executable QA Scenarios

### Task 1 — API client utility

- Tool: desktop Jest test run
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false src/utils/api.test.js`
  2. Confirm mocked `fetch` assertions cover auth header, request body, and non-2xx failures
- Expected result:
  - all tests pass
  - no real network requests occur

### Task 2 — Auth store slice

- Tool: desktop Jest test run
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false src/store/authStore.test.js`
  2. Verify default auth state, `setAuth`, `clearAuth`, `setAuthLoading`, and `setAuthError`
- Expected result:
  - all tests pass
  - auth state shape matches implementation plan

### Task 3 — Auth panel

- Tool: desktop Jest test run
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false src/components/AuthPanel/AuthPanel.test.js`
  2. Verify login mode renders by default
  3. Verify signup mode renders name field
  4. Verify successful submission stores token/user
  5. Verify failed submission shows inline error
- Expected result:
  - all tests pass
  - authenticated state renders account summary and sign-out action

### Task 4 — Billing panel

- Tool: desktop Jest test run
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false src/components/BillingPanel/BillingPanel.test.js`
  2. Verify unauthenticated state shows sign-in-required message
  3. Verify customer-creation state shows create-customer action
  4. Verify subscription state shows plain `paymentMethodId` input and subscribe action
  5. Verify active subscription state shows cancel action
- Expected result:
  - all tests pass
  - billing actions are driven by mocked API responses

### Task 5 — App wiring and navigation

- Tool: desktop full Jest run plus file diagnostics
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false`
  2. Run `lsp_diagnostics` on `desktop/src/App.jsx` and changed view components
  3. Verify `App.jsx` includes `AUTH` and `BILLING` views
  4. Verify `InterviewSetup` exposes auth/account entry point based on auth state
- Expected result:
  - full desktop suite passes
  - no import/type diagnostics on changed files
  - existing session/setup navigation still works in tests

### Task 6 — MoreSettings profile sync

- Tool: desktop full Jest run plus targeted code review of request mapping
- Steps:
  1. Verify sync-up code sends `{ name: personalInfo.fullName, personalInfo }`
  2. Verify pull code maps `user.name` back into `personalInfo.fullName`
  3. Run `cd desktop && npx react-scripts test --watchAll=false`
- Expected result:
  - full desktop suite passes
  - local and remote profile fields map correctly

### Final verification

- Tool: desktop/server test runs and LSP diagnostics
- Steps:
  1. Run `cd desktop && npx react-scripts test --watchAll=false`
  2. Run `cd server && npx jest --forceExit`
  3. Run `lsp_diagnostics` on all changed desktop files
- Expected result:
  - desktop tests pass
  - server tests pass
  - changed desktop files have no diagnostics errors

## Atomic Commit Breakdown

1. `add desktop auth and billing API client helpers`
2. `add persisted auth state to desktop store`
3. `add desktop auth panel for sign in and signup`
4. `add desktop billing panel for subscription management`
5. `wire desktop account navigation and profile sync`

## Files Expected To Change

Create:

- `desktop/src/utils/api.js`
- `desktop/src/utils/api.test.js`
- `desktop/src/store/authStore.test.js`
- `desktop/src/components/AuthPanel/index.jsx`
- `desktop/src/components/AuthPanel/AuthPanel.css`
- `desktop/src/components/AuthPanel/AuthPanel.test.js`
- `desktop/src/components/BillingPanel/index.jsx`
- `desktop/src/components/BillingPanel/BillingPanel.css`
- `desktop/src/components/BillingPanel/BillingPanel.test.js`

Modify:

- `desktop/src/store/interviewStore.js`
- `desktop/src/App.jsx`
- `desktop/src/components/InterviewSetup/index.jsx`
- `desktop/src/components/MoreSettings/index.jsx`
- `desktop/src/components/MoreSettings/MoreSettings.css`

## Acceptance Criteria

- Desktop app has working auth/account entry point from setup flow
- User can register and log in from desktop UI
- Auth token and user state persist in the desktop store
- Authenticated user can view billing status from desktop UI
- Authenticated user can create Stripe customer and submit a test `paymentMethodId` to subscribe
- Authenticated user can cancel subscription
- Authenticated user can sync local profile settings to the server and pull them back
- Desktop tests pass
- Server tests still pass
- No new dependencies are added
