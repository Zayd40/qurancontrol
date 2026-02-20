# Qur'an Recitation Display Controller (Local)

A local web app for mosque recitation sessions: one screen (`/display`) is captured by OBS for TVs, and one phone (`/control`) on the same Wi-Fi manually moves Surah/Ayah like slideshow slides. It is manual-only (no autoplay), works on a local network, and does not require internet at runtime.

## What This Project Does

- Shows Arabic, English translation, and transliteration on a clean fullscreen display page.
- Lets one phone control Surah/Ayah with Previous, Next, and Jump.
- Hides QR code while a controller is connected, shows QR code again when no controller is connected or controller times out.
- Uses WebSockets for instant state sync.

## Requirements

- Node.js **18 LTS or newer** (Node 20 LTS recommended)
- Phone and OBS PC on the **same Wi-Fi/LAN**

## One-Time Setup (Windows/macOS/Linux)

1. Download or unzip this project folder.
2. Open a terminal:
   - Windows: PowerShell
   - macOS: Terminal
   - Linux: Terminal
3. Go into the project folder:
   - `cd /path/to/qurancontrol`
4. Install dependencies:
   - `npm install`

## Start the Server

1. In the project folder, run:
   - `npm run start`
2. You should see startup logs similar to:
   - `Display URL (OBS PC): http://localhost:5173/display`
   - `Control URL (phone): http://<LAN_IP>:5173/control`
3. Open these URLs:
   - On the OBS PC: `http://localhost:5173/display`
   - On the phone: `http://<LAN_IP>:5173/control`

## Add to OBS (Browser Source)

1. In OBS, click `+` in Sources.
2. Choose `Browser` (Browser Source).
3. Set URL to:
   - `http://localhost:5173/display`
4. Set Width/Height:
   - `1920 x 1080` (1080p; output scales for other resolutions)
5. If needed, click refresh on Browser Source or restart the source.

## How to Stop the Server (Very Important)

- In the terminal window running the app, press:
  - `Ctrl + C`
- Closing that terminal window also stops the server.

## How to Start Again Later

1. Open terminal again.
2. Go to the folder again:
   - `cd /path/to/qurancontrol`
3. Start server:
   - `npm run start`

## Controller Lock Behavior (Multiple Phones)

- **First controller wins**.
- Other phones show read-only message: "Controller already active on another phone".
- If active controller disconnects/times out, next connected controller is promoted automatically.

## Branding and Simple Config

Edit `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/config.json`:

- `brandText`: shown on display and control page (default: `Al Zahraa Centre`)
- `logoPath`: optional logo path served from `public/` (example: `/assets/logo.png`)
- `accentColor`: subtle accent color
- `safeMargin`: screen-safe margin for TV overscan

Example logo setup:

1. Put logo at: `/Users/zaydabbas/Documents/GitHub/qurancontrol/public/assets/logo.png`
2. Set `"logoPath": "/assets/logo.png"` in config.
3. Restart server.

## Data Files (Offline)

- Full dataset (already included): `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.full.json`
- Fallback seed dataset: `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.json`
- Surah metadata (all 114 surahs + ayah counts):
  - `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/surah-metadata.json`

### Replace/Update Full Offline Dataset

1. Create file:
   - `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.full.json`
2. Use the same schema as template:
   - `/Users/zaydabbas/Documents/GitHub/qurancontrol/data/quran.full.template.json`
3. Restart server.

The server auto-loads `data/quran.full.json` if present.

Optional: set custom path in `.env`:

- `QURAN_DATA_FILE=data/quran.full.json`

## Environment Options

Copy `.env.example` to `.env` if you want custom settings.

- `PORT` (default `5173`)
- `CONTROLLER_TIMEOUT_MS` (default `30000`)
- `HEARTBEAT_INTERVAL_MS` (default `10000`)
- `QURAN_DATA_FILE` (optional custom data file)

Server binds to `0.0.0.0` so phones on LAN can connect.

## Troubleshooting

### Phone cannot connect

- Confirm phone and PC are on same Wi-Fi/LAN.
- Check the Control URL shown in terminal (use that exact IP + port).
- Allow Node.js through firewall.
- Confirm server is running (`npm run start`).

### QR not showing on display

- QR shows only when **no controller is connected**.
- If controller is active, QR is hidden by design.
- Refresh `/display` page if needed.

### Wrong IP shown

- Restart the server. LAN IP is detected at startup.

### OBS shows blank

- Make sure Browser Source URL is `http://localhost:PORT/display` on OBS PC.
- Make sure server is running.
- Refresh Browser Source cache.

### Ayah text missing

- Seed dataset is limited.
- Add full dataset file at `data/quran.full.json` and restart.

## Optional: Run at Boot

This is optional. You can configure your OS to run:

- `npm run start`

at login/startup using:

- Windows Task Scheduler
- macOS Login Items or LaunchAgent
- Linux systemd user service

## Scripts

- `npm install`
- `npm run start`
- `npm run dev`

## Runtime Summary

Single-command start after setup:

```bash
npm run start
```

Then:

- Display (OBS PC): `http://localhost:5173/display`
- Control (phone): `http://<LAN_IP>:5173/control`
