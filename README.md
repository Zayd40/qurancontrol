# Al Zahraa Centre Presenter System

Local-first Quran and dua presenter control for Al Zahraa Centre.

The mosque computer runs the Node.js server. OBS or the hall display opens `/display`. The admin operator opens `/admin` for setup, QR access, display status, and recovery controls. A phone opens `/control` for simple navigation.

## Modes

- Quran mode
- Dua mode

Guided event mode is no longer part of the runtime UI or session state. Old saved guided-event sessions are clamped back to Quran mode on startup.

## Automatic following on Windows (RTX 4060)

The presenter can capture the mixer input locally, recognise Arabic speech, and move the existing display to a matching ayah or selected dua line. Recognition text is never projected: Arabic, transliteration and translation still come from the bundled dataset.

### First setup

1. Install **Node.js 22 LTS**, **Python 3.11** with its Python launcher, and a current NVIDIA graphics driver.
2. Extract the complete project to a writable folder on the centre PC.
3. Double-click **Setup-Windows.cmd**. This installs dependencies into `.venv`, checks CUDA, downloads both speech models, and runs the application checks. Initial setup needs internet and several GB of free disk space. Read any errors before continuing.
4. Double-click **Start-QuranControl.cmd**. The admin page opens automatically; no terminal session questions are required.
5. On the admin page, expand **Audio settings**, click **Find inputs**, select the actual mixer/USB input, and press **Go**. The input level should move during speech. Reduce the mixer output if clipping is reported. Use Quiet feed/Noisy feed only if necessary.
6. Open `/display` in OBS or on the hall screen as before.

Subsequent launches resume the saved session and start listening with the saved input. If hardware is unplugged/reordered, stop listening, refresh the input list, select the mixer again and restart. Windows input IDs can change. First-time setup is a source distribution with launchers, not a standalone EXE.

### Operation

The admin and phone controller have been redesigned with a clear Go/Stop panel, live canonical-text preview, and collapsible setup/details. The hall/OBS display HTML, CSS, script, and its shared theme are unchanged.

- **Quran mode:** follows nearby ayahs and can acquire a distinctive passage elsewhere in all 114 surahs. Repeated or very short phrases may need an initial manual surah/ayah selection. Context makes following repeated passages safer.
- **Dua mode:** choose the dua once, then the listener follows its stored lines. It does not automatically choose between Qur'an/dua modes or different duas. Dua recognition needs separate live validation.
- **Manual override:** any navigation or mode/display action pauses automatic following. Press **Go** in admin when ready. Old buffered audio and in-flight transcripts are invalidated on pause/resume. A blanked display is never advanced by speech.
- **Uncertain match:** holds the current passage. Once a passage is established, a clear next ayah advances on one recognition result. Other nearby movements need two consistent results; distant acquisition needs three distinctive results. Short one-word next ayahs require an established position and preceding speech context. These are text-similarity heuristics, not calibrated speech confidence probabilities.
- **Audio/model error:** shows the failure in admin. Select the input again if necessary and press Go. Process failures require restarting listening; the browser display/controller reconnect automatically after server connection loss.
- **Go / Stop:** Go finds the reciter and follows the ayahs automatically. Stop freezes the slide, invalidates pending recognition, and pauses audio capture while keeping the model loaded for a quick Go. Closing the server releases the model process.

The default models are `tarteel-ai/whisper-base-ar-quran` for Qur'an and `openai/whisper-small` for dua. They run through PyTorch/Transformers on the RTX 4060. Models are cached locally; audio stays in memory and is not uploaded or recorded. After setup, you can disconnect internet; offline model loading uses the local cache. Model overrides in `.env` may require downloading those replacement models separately.

The listener processes overlapping eight-second windows, checks for speech energy, and attempts an update about every 1.5 seconds plus inference time. Advancement is driven by recognised speech, not by a slideshow timer. Expect several seconds of following delay, especially for first acquisition and short/ambiguous passages. Actual accuracy, latency, audio sensitivity and GPU performance must be checked on the centre PC with its real mixer feed. No tajweed or pronunciation grading is performed.

For deliberate offline-only operation, set `HF_HUB_OFFLINE=1` after the models have been downloaded. The optional environment settings are shown in `.env.example`; `LISTENER_PYTHON` can point to an alternative Python executable. `LISTENER_AUTOSTART=1` enables listening at server startup; the Windows launcher enables it after the first saved input setup. `NO_STARTUP_PROMPT=1` resumes the last saved presenter session without asking terminal questions.

The app continues to use its existing trusted-LAN controller model. Keep it on the centre LAN; admin/control roles are not user authentication.

### Validation

`npm run check` checks JavaScript syntax and runs the tests, including a simulated recitation through the real listener/matcher/presenter/WebSocket path (unknown-surah acquisition, automatic next-ayah display updates, Stop, stale results and warm Go), Arabic normalisation, full-dataset passage matching, ambiguous/repeated passages, partial verses, dua scope, manual pause, stale-result rejection, worker failures and process cleanup. Python syntax can be checked with `python -m py_compile listener/worker.py`.

Before public use, make a rehearsal on the centre PC: verify the admin reports `cuda`, check the mixer meter, follow Al-Fatiha and a longer passage, repeat/skip a verse, pause speaking, test a selected dua, disconnect/reconnect a phone, and try manual override/blanking. The automated checks do not substitute for live Windows/CUDA/audio verification.

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
