# Al Zahraa Centre Presenter System

Local-first Quran and dua presenter control for Al Zahraa Centre.

The mosque computer runs the Node.js server. OBS or the hall display opens `/display`. The admin operator opens `/admin` for setup, QR access, display status, and recovery controls. A phone opens `/control` for simple navigation.

## Modes

- Quran mode
- Dua mode

Guided event mode is no longer part of the runtime UI or session state. Old saved guided-event sessions are clamped back to Quran mode on startup.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run start
```

The server listens on port `5173` unless `PORT` is set.

Typical URLs:

- Admin: `http://<LAN_IP>:5173/admin`
- Display: `http://localhost:5173/display`
- Phone controller: `http://<LAN_IP>:5173/control`

The QR code appears only on the admin panel. It is intentionally not rendered on the display screen.

For packaging tests, the server can open the admin panel automatically after it starts:

```bash
npm run start:admin
```

## Centre usage

Install once on the centre computer:

```bash
npm install
```

Normal start command:

```bash
npm run start:admin
```

Use `/display` for the projector, TV, or OBS browser capture.

The phone controller scans the QR code from the admin panel only. The QR code is not shown on `/display`.

Do not show the admin panel on the projector.

## Admin Panel

Use `/admin` for setup and control-room operation.

The admin panel shows:

- current mode
- current Quran/surah/ayah or dua line
- display live/blanked status
- connected controller count
- controller URL and QR code
- compact mode, navigation, jump, reset, and blank controls

## Phone Controller

Use `/control` from a phone on the same LAN.

The controller is mobile-first and only includes:

- Quran mode
- Dua mode
- Surah selector
- Ayah selector
- Dua selector
- Line selector
- Scroll forward/back for the preview
- Preview
- Previous/next navigation

## Display Screen

Use `/display` for OBS/browser capture.

The display receives updates over WebSockets. Text changes fade out, swap while hidden, then fade back in so words do not change mid-fade or jump during transitions.

## Data Files

### Quran

The server loads Quran data from:

- `data/quran.full.json` if present
- otherwise `data/quran.json`

You can override the path with `QURAN_DATA_FILE` in `.env`.

### Duas

Duas live in `data/duas/`.

Each dua uses this shape:

```json
{
  "id": "sample-dua",
  "title": "Sample Dua",
  "lines": [
    {
      "arabic": "...",
      "transliteration": "...",
      "english": "..."
    }
  ]
}
```

Keep one readable presenter chunk per `lines` entry.

## Verification

```bash
npm test
npm run check
```

`npm run check` runs JavaScript syntax checks for the server/browser scripts and then runs the test suite.

## Windows EXE packaging plan

Do not package from this repo until the team is ready to test on Windows.

A future single-file Windows package should:

1. Bundle the Node server entrypoint `server/index.js`.
2. Include `public/`, `data/`, and production dependencies.
3. Start the local server.
4. Set `OPEN_ADMIN_ON_START=1` so the server opens `http://localhost:5173/admin` automatically in the default browser.
5. Keep the console or tray process alive while the local server is running.

Candidate tooling:

- `pkg` or `nexe` for a single executable Node bundle.
- A small launcher script that starts `server/index.js` and opens `/admin`.
- A Windows smoke test that confirms `/admin`, `/control`, `/display`, and `/api/bootstrap?role=admin` load without internet.

Suggested later packaging command shape after adding the tooling:

```bash
npm run package:windows
```

That script does not exist yet.

## Stop The Server

Press `CTRL+C` in the terminal running the app.
