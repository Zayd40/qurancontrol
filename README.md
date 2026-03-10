# Al Zahraa Centre Presenter System

A local-first mosque presenter system for Al Zahraa Centre.

The mosque computer runs the Node.js server. OBS captures [`/display`](/Users/zaydabbas/Documents/GitHub/qurancontrol/public/display.html) and sends it to TVs. A helper joins [`/control`](/Users/zaydabbas/Documents/GitHub/qurancontrol/public/control.html) from a phone on the same LAN and can only navigate inside the session that was chosen in the terminal before startup.

## What The System Does

- Runs fully on the local network. No internet is required during use.
- Supports 3 locked session types:
  - Quran mode
  - Dua mode
  - Guided Event mode
- Keeps the phone controller restricted:
  - no mode switching
  - no content switching
  - no setup or admin controls
- Shows a QR code on the display only when no active controller is connected.
- Keeps display and controller in sync over WebSockets.
- Saves the previous session so the next launch can resume it from the terminal.

## Requirements

- Node.js 18 or newer
- npm
- The mosque computer and phone on the same Wi-Fi/LAN
- OBS Studio on the display computer if you are sending the presenter view to TVs

## How To Install

1. Open a terminal in the project folder:
   - `/Users/zaydabbas/Documents/GitHub/qurancontrol`
2. Install dependencies:

```bash
npm install
```

## How To Start

Run:

```bash
npm run start
```

The app starts with an interactive terminal setup before the web server begins.

## What Happens In The Terminal

When you run `npm run start`, the terminal will ask what session to start.

If there is a saved previous session, you will first see:

1. `Start previous session?`
2. `1) Yes — [previous session summary]`
3. `2) No — choose a new session`

If you choose a new session, the terminal will ask for one of these:

1. `Quran`
2. `Dua`
3. `Guided Event`

After the choice is made, the server starts and the terminal shows a runtime dashboard with:

- mode
- selected content
- display URL
- controller URL
- controller access instructions
- recent controller activity (latest 3 items only)

## How To Choose Quran, Dua, Or Guided Event

### Quran

Choose:

1. `Quran`

The app starts immediately in Quran mode.

The phone controller can then:

- choose a surah
- jump to an ayah
- move to previous or next ayah

### Dua

Choose:

1. `Dua`

Then choose:

1. `Dua Iftitah`
2. `Dua Kumayl`

That dua is locked for the whole server run.

The phone controller can then:

- jump to a line
- move to previous or next line

It cannot load a different dua.

### Guided Event

Choose:

1. `Guided Event`

Then choose:

1. `Laylat al-Qadr — 21st Night`

That event is locked for the whole server run.

The phone controller can then:

- move to previous or next slide
- jump to a section only

It cannot switch to a different event, and it cannot jump directly to a slide inside a section.

## Display And Controller URLs

After startup, the app shows:

- Display URL in the terminal
- Controller URL in the terminal
- Controller QR code on the display page when no active controller is connected

Typical URLs look like:

- Display: `http://localhost:5173/display`
- Controller: `http://<LAN_IP>:5173/control`

Use the display URL on the OBS computer. Use the controller URL or QR code on the phone.

## How To Stop The Server

Press:

- `CTRL+C`

in the terminal that is running the app.

## How To Restart And Resume The Previous Session

1. Run `npm run start` again.
2. If a previous session exists, the terminal offers to resume it.
3. Choose `1` to continue the saved session, including its last navigation position.
4. Choose `2` to start a new locked session instead.

The saved session file is written automatically to [`data/previous-session.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/previous-session.json).

## Data Files

### Quran data

The server loads Quran data from:

- [`data/quran.full.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.full.json) if present
- otherwise [`data/quran.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.json)

You can also override the path with `QURAN_DATA_FILE` in `.env`.

### Dua files

Duas live in:

- [`data/duas/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/duas)

Current files:

- [`data/duas/iftitah.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/duas/iftitah.json)
- [`data/duas/kumayl.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/duas/kumayl.json)

### Guided event files

Guided events live in:

- [`data/events/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/events)

Current file:

- [`data/events/laylat-al-qadr-21.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/events/laylat-al-qadr-21.json)

## How To Add Or Update Dua Iftitah / Dua Kumayl

Each dua uses this JSON shape:

```json
{
  "id": "iftitah",
  "title": "Duʿāʾ al-Iftitāḥ",
  "lines": [
    {
      "arabic": "...",
      "transliteration": "...",
      "english": "..."
    }
  ]
}
```

To update a dua:

1. Open the relevant file in [`data/duas/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/duas).
2. Replace each line entry with the approved Arabic, transliteration, and English text.
3. Keep one recitation chunk per JSON line object.
4. Restart the server.

If you still use the raw Iftitah formatter, the existing helper remains available:

```bash
npm run format:iftitah
```

## How To Add A New Guided Event JSON File

1. Create a new file in [`data/events/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/events).
2. Use one JSON file per event.
3. Keep manual section and slide boundaries in the JSON.
4. Do not rely on automatic splitting by text length.

Schema:

```json
{
  "id": "your-event-id",
  "title": "Your Event Title",
  "sections": [
    {
      "id": "section-id",
      "title": "Section Title",
      "slides": [
        {
          "title": "",
          "instruction": "",
          "repeat": "",
          "reference": "",
          "arabic": "",
          "transliteration": "",
          "english": "",
          "note": ""
        }
      ]
    }
  ]
}
```

All slide fields are optional. Empty strings are fine and will be hidden automatically on the display.

If you add a brand new guided event file and want it to appear in the startup menu, also add it to the terminal prompt logic in [`server/cli.js`](/Users/zaydabbas/Documents/GitHub/qurancontrol/server/cli.js).

## Laylat al-Qadr 21st Night

The included guided event file is:

- [`data/events/laylat-al-qadr-21.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/events/laylat-al-qadr-21.json)

It already includes these sections in order:

1. 2 Rakʿah Salat for Forgiveness
2. 70x Istighfar
3. 100x Istighfar
4. Ziyarat of Imam Husayn
5. 21st Night Specific Amaal
6. Duʿāʾ Jawshan al-Kabir
7. Holy Qur’an Amaal
8. Bidding Farewell

Some long-source sections currently use representative placeholder slides with TODO notes. Replace them with the exact approved recitation chunks when ready. No code changes are needed for that update.

## OBS Setup

1. Start the app with `npm run start`.
2. In OBS, add a `Browser Source`.
3. Set the URL to the Display URL shown in the terminal:
   - usually `http://localhost:5173/display`
4. Set width and height:
   - `1920 x 1080` is a good default
5. Refresh the source if OBS cached an old version.

## Controller Rules

The phone controller is intentionally restricted.

It cannot:

- switch mode
- choose a different dua during a locked dua session
- choose a different guided event during a locked event session
- open setup/admin controls

It can only navigate inside the session that was chosen in the terminal before startup.

## Troubleshooting

### The phone cannot connect

- Confirm the phone and computer are on the same Wi-Fi/LAN.
- Use the exact Controller URL shown in the terminal.
- Allow Node.js through the local firewall if needed.
- Confirm the server is still running.

### The QR code is not showing

- The QR code only appears when there is no active controller.
- If a valid controller is connected, the QR code hides automatically.
- Refresh the display page if needed.

### The wrong IP address is shown

- Restart the server.
- The app detects a LAN IPv4 address at startup.

### The display page is blank in OBS

- Confirm OBS is using the Display URL from the terminal.
- Confirm the server is running.
- Refresh the OBS Browser Source.

### Quran text is missing for some ayahs

- The fallback dataset may be incomplete.
- Add a full dataset file at [`data/quran.full.json`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.full.json) and restart.

### A dua or guided event looks incomplete

- Check the JSON file under [`data/duas/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/duas) or [`data/events/`](/Users/zaydabbas/Documents/GitHub/qurancontrol/data/events).
- Placeholder slides and TODO notes are meant to be replaced with the exact approved source chunks.

## Environment Options

Optional `.env` settings:

- `PORT` default `5173`
- `CONTROLLER_TIMEOUT_MS` default `30000`
- `HEARTBEAT_INTERVAL_MS` default `10000`
- `QURAN_DATA_FILE` optional custom Quran dataset path

## Scripts

- `npm run start`
- `npm run dev`
- `npm run format:iftitah`
