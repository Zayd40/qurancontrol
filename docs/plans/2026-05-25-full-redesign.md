# Quran Presenter Full Redesign Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild the Quran presenter into a simpler, cleaner local web app with no terminal setup flow, a better display screen, and a redesigned admin/control panel.

**Architecture:** Keep the app local-first with Node.js, Express, and WebSockets, but move all setup and session control into the web UI. The server should start immediately and expose Display, Control, and Admin pages; Admin chooses the active mode/content and manages the PIN from the UI. Preserve existing Quran/dua/event JSON data, but create a cleaner state model and UI structure.

**Tech Stack:** Node.js, Express, ws, plain HTML/CSS/JS initially; Node built-in test runner for tests. No token auth; use admin PIN only.


---

## Database Content Requirements

The redesigned app should create and use a local SQLite database, populated from trusted online/import sources plus the current repo content.

### Required Quran content

Include the whole Quran:
- Arabic
- English translation
- Transliteration

Do **not** include Farsi.

### Required dua/ziyarat content

Use duas.org as the verification/replacement source for duas where possible.

Carry over the currently installed duas, but verify/replace their content against duas.org where matching source pages are available:
- Dua Ilaahi Waqafa Sailun
- Eid Prayer
- Dua for the Farewell of Ramadan
- Dua al-Iftitah
- Dua Kumayl

Add these exact new duas.org sources:
- Ziyarat Imam Hussain on Arafah Day
  - Source: `https://www.duas.org/ziyarat-imam-husain-on-arafah-day.html`
- Dua of Arafah of Imam Hussain
  - Source: `https://www.duas.org/dua-arafah-imam-husain.html`

### Content import rules

- Use duas.org for the requested duas/ziyarat sources.
- Keep import scripts so the database can be rebuilt from sources.
- Store source metadata for each imported text: source name, URL, language, and import date.
- Prefer Arabic, English, and transliteration where available.
- If a duas.org page lacks one language/field, store the available fields and mark missing fields in the admin content-library view.
- Normalise content into SQLite tables instead of relying on loose JSON files at runtime.

---

## Product Direction

### What changes

- Remove the interactive terminal session picker.
- Start the server immediately with `npm start`.
- Display page becomes cleaner and more broadcast/presenter-like.
- Admin panel becomes the main control centre:
  - choose mode
  - choose Quran/dua/event content
  - navigate live output
  - blank/unblank display
  - turn display languages on/off
  - change admin PIN
  - view controller status/logs
- Phone controller remains visually/layout-compatible with the current version, but uses the screen better:
  - largest practical font sizes
  - full-screen layout
  - current time in the corner
  - only navigation controls for the active session
  - no setup complexity
- Admin PIN is managed in the admin UI after login.
- Avoid tokens completely.
- Prefer a desktop launcher/executable that starts the server, opens the admin dashboard, and hosts `/display` and `/control` for OBS/controllers.

### Core screens

1. `/display`
   - OBS/browser output only.
   - No admin controls.
   - Clean large typography.
   - Optional QR code if no controller connected.

2. `/control`
   - Phone-friendly live controller.
   - Shows current mode/content.
   - Big previous/next buttons.
   - Jump control relevant to active mode.

3. `/admin`
   - Desktop/tablet control centre.
   - First screen asks for admin PIN if configured.
   - After login, full control over mode/content/session/security.
   - Includes admin PIN change UI.

4. `/api/*`
   - Server-side endpoints for bootstrap/config/security.

---

## New State Model

Use one central state object:

```js
{
  mode: 'quran' | 'dua' | 'event',
  blanked: false,
  languages: {
    arabic: true,
    transliteration: true,
    english: true,
  },
  quran: {
    surahNumber: 1,
    ayahNumber: 1
  },
  dua: {
    duaId: 'iftitah',
    lineIndex: 1
  },
  event: {
    eventId: 'laylat-al-qadr-2026',
    sectionIndex: 0,
    slideIndex: 0
  }
}
```

The server owns this state and broadcasts updates over WebSocket.

---

## Admin PIN Concept

### Storage

Create `data/security.json`:

```json
{
  "adminPin": "1234"
}
```

Rules:
- If `data/security.json` exists, use it.
- If not, use `ADMIN_PIN` from `.env`.
- If neither exists, admin is open but UI warns: “No admin PIN set”.
- When changed in UI, write `data/security.json`.

### API

- `POST /api/admin/login`
  - Body: `{ "pin": "1234" }`
  - Returns success/failure.
  - No long-lived token; browser keeps the PIN in session memory/sessionStorage and sends it with admin requests.

- `POST /api/admin/pin`
  - Body: `{ "currentPin": "1234", "newPin": "2468" }`
  - Verifies current PIN and saves new PIN.

Admin WebSocket hello:

```js
{ "type": "hello", "role": "admin", "pin": "1234" }
```

No token system.

---

## Task 1: Create a redesign branch

**Objective:** Keep the current working version safe while rebuilding.

**Files:**
- No source file changes.

**Steps:**

```bash
git checkout -b redesign-simple-admin-flow
```

Verify:

```bash
git branch --show-current
```

Expected: `redesign-simple-admin-flow`

---

## Task 2: Add tests for no terminal prompt startup

**Objective:** Prove the server starts immediately without interactive setup.

**Files:**
- Test: `test/startup-flow.test.js`

**Test behaviour:**
- Spawn `node server/index.js` with a random port.
- Do not provide TTY input.
- Expect `/api/bootstrap` to respond quickly.
- Expect default mode to be Quran.

Run:

```bash
npm test -- test/startup-flow.test.js
```

Expected before implementation: fail if the startup logic still depends on old session prompt assumptions.

---

## Task 3: Remove interactive terminal session selection

**Objective:** Server starts straight away and admin UI controls session choice.

**Files:**
- Modify: `server/index.js`
- Modify or remove: `server/cli.js`
- Test: `test/startup-flow.test.js`

**Implementation notes:**
- Replace `promptForStartupSession(...)` with:
  - load saved state if valid
  - otherwise create default Quran state
- Keep dashboard output minimal:
  - display URL
  - control URL
  - admin URL
  - active mode
- Do not ask questions in terminal.

Verify:

```bash
npm test
PORT=5173 npm start
```

Expected: server starts immediately.

---

## Task 4: Add security config module

**Objective:** Move admin PIN handling into a testable server module.

**Files:**
- Create: `server/security.js`
- Test: `test/security.test.js`
- Data file used at runtime: `data/security.json` ignored if local-only desired.

**Behaviours to test:**
- Loads PIN from `data/security.json` when present.
- Falls back to `ADMIN_PIN`.
- Allows open admin only when no PIN is configured.
- Validates current PIN.
- Saves changed PIN to `data/security.json`.

---

## Task 5: Add admin PIN change API

**Objective:** Admin PIN can be changed from the admin UI.

**Files:**
- Modify: `server/index.js`
- Use: `server/security.js`
- Test: `test/admin-pin-api.test.js`

**Routes:**

```http
POST /api/admin/login
POST /api/admin/pin
```

**Security rules:**
- If a PIN exists, current PIN is required.
- New PIN must be 4–12 digits.
- Reject empty/invalid PIN.
- After saving, old PIN must stop working and new PIN must work.

---

## Task 6: Add display language toggles

**Objective:** Admin can decide which available languages appear on the display.

**Files:**
- Modify: `server/session.js`
- Modify: `server/index.js`
- Modify: `public/admin.*`
- Modify: `public/display.*`
- Data: add Farsi fields where available.

**Languages:**
- Arabic
- Transliteration
- English

**Behaviour:**
- Admin page has clear on/off toggles for each language.
- Display hides disabled languages immediately.
- State is persisted so it survives restart.
- If Farsi text is missing for a line/ayah, display either hides that Farsi line or shows a subtle “Farsi unavailable” only in admin, not on the public display.

**Data note:**
- Quran data should contain Arabic, English translation, and transliteration only.
- Do not add Farsi support.

---

## Task 7: Redesign Admin page structure

**Objective:** Replace current admin page with simpler command-centre layout.

**Files:**
- Rewrite: `public/admin.html`
- Rewrite: `public/admin.css`
- Rewrite: `public/admin.js`

**UI sections:**
- Header/live status: mode, current reference, display state.
- Primary controls: previous, next, blank/unblank.
- Mode/content picker: Quran, Dua, Guided Event.
- Jump control: ayah/line/section depending on mode.
- Security panel: change admin PIN.
- URLs/status/logs panel.

**Visual direction:**
- Use the hosted sketch as starting concept:
  - `sketches/001-admin-command-centre/index.html`
- Keep it touch-friendly and clear in a live event.

---

## Task 8: Redesign Display page

**Objective:** Make OBS/display output cleaner and less prototype-like.

**Files:**
- Modify: `public/display.html`
- Modify: `public/display.css`
- Modify only if needed: `public/display.js`

**Design goals:**
- Large readable Arabic.
- Balanced transliteration/English.
- Minimal chrome.
- Better blanked state.
- QR overlay should look intentional, not like a debug overlay.

---

## Task 9: Simplify Control page

**Objective:** Phone controller should be obvious and minimal.

**Files:**
- Modify: `public/control.html`
- Modify: `public/control.css`
- Modify: `public/control.js`

**Design goals:**
- Preserve the current controller layout style/mental model.
- Make font as large as practically possible.
- Use the full phone screen with minimal wasted margins.
- Show the current time in the corner.
- Big previous/next controls.
- Current item preview.
- Simple jump control.
- No mode switching.
- No admin settings.

---

## Task 10: Desktop EXE/launcher packaging

**Objective:** Make it easy to run without terminal commands.

**Preferred user experience:**
- User double-clicks an app/exe.
- It starts the local Node server.
- It opens the admin dashboard automatically.
- It hosts:
  - `/display` for OBS/browser source
  - `/control` for phones/tablets on the network
  - `/admin` for the operator

**Implementation options:**
1. **Electron wrapper** — best operator experience; includes admin dashboard in an app window and server in the background.
2. **Tauri wrapper** — lighter, but more setup complexity.
3. **pkg/nexe Node executable** — simpler server executable, but browser/admin window handling is less polished.
4. **Windows shortcut/batch launcher first** — fastest interim option if full packaging takes longer.

**Recommendation:** Build the web app first, then package with Electron once the flow is stable.

---

## Task 11: Keep data loading dynamic

**Objective:** Preserve automatic Quran/dua/event loading.

**Files:**
- Modify if needed: `server/loaders.js`
- Modify if needed: `server/session.js`
- Tests: `test/session-events.test.js`

**Rules:**
- Duas are loaded from `data/duas/*.json`.
- Events are loaded from `data/events/*.json`.
- Admin UI lists available duas/events dynamically.
- No hardcoded Laylat al-Qadr menu.

---

## Task 12: Final verification

Run:

```bash
npm test
npm audit --omit=dev
node --check server/*.js
node --check public/*.js
```

Smoke test:

```bash
PORT=5173 npm start
```

Check:
- `/display`
- `/control`
- `/admin`
- admin PIN login
- admin PIN change
- mode switching
- Quran navigation
- dua navigation
- guided event navigation
- blank/unblank display
- OBS browser source still works

---

## Acceptance Criteria

- No terminal session picker remains.
- Server starts immediately.
- Admin controls the active mode/content from the browser.
- Admin PIN can be changed in the admin UI.
- No tokens are introduced.
- Display page looks clean enough for OBS/mosque TVs.
- Admin panel feels like a proper control centre, not a debug panel.
- Phone controller is simple and touch-friendly.
- All tests pass.
- `npm audit --omit=dev` reports 0 vulnerabilities.
