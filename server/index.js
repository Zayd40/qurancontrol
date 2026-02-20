const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const dotenv = require('dotenv');

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DUA_DIR = path.join(DATA_DIR, 'duas');

const PORT = Number(process.env.PORT || 5173);
const CONTROLLER_TIMEOUT_MS = Number(process.env.CONTROLLER_TIMEOUT_MS || 30000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 10000);

function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[warn] Failed to read ${filePath}: ${error.message}`);
    return fallbackValue;
  }
}

function resolveQuranDataPath() {
  const envPath = process.env.QURAN_DATA_FILE;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(ROOT_DIR, envPath);
  }

  const fullPath = path.join(DATA_DIR, 'quran.full.json');
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }

  return path.join(DATA_DIR, 'quran.json');
}

function getLanIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const networkName of Object.keys(interfaces)) {
    for (const iface of interfaces[networkName] || []) {
      if (iface.family !== 'IPv4' || iface.internal) {
        continue;
      }

      const isPrivate =
        iface.address.startsWith('10.') ||
        iface.address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address);

      candidates.push({
        address: iface.address,
        private: isPrivate
      });
    }
  }

  const privateMatch = candidates.find((entry) => entry.private);
  if (privateMatch) {
    return privateMatch.address;
  }

  return candidates[0]?.address || '127.0.0.1';
}

const config = readJsonFile(path.join(DATA_DIR, 'config.json'), {
  brandText: 'Al Zahraa Centre',
  logoPath: '',
  accentColor: '#5f7a69',
  safeMargin: '4vw'
});

const metadata = readJsonFile(path.join(DATA_DIR, 'surah-metadata.json'), { surahs: [] });
const quranDataPath = resolveQuranDataPath();
const quranData = readJsonFile(quranDataPath, { meta: { type: 'empty' }, surahs: [] });

if ((quranData?.meta?.type || '').toLowerCase() === 'seed') {
  console.warn('[warn] Seed dataset loaded. Add data/quran.full.json for full 114-surah content.');
}

const surahMetaByNumber = new Map();
for (const surah of metadata.surahs || []) {
  surahMetaByNumber.set(Number(surah.number), {
    number: Number(surah.number),
    nameEnglish: surah.nameEnglish,
    nameArabic: surah.nameArabic,
    ayahCount: Number(surah.ayahCount)
  });
}

const ayahDataBySurah = new Map();
for (const surah of quranData.surahs || []) {
  const surahNumber = Number(surah.number);
  const ayahMap = new Map();
  for (const ayah of surah.ayahs || []) {
    ayahMap.set(Number(ayah.number), {
      number: Number(ayah.number),
      arabic: ayah.arabic || '',
      translation: ayah.translation || '',
      transliteration: ayah.transliteration || ''
    });
  }
  ayahDataBySurah.set(surahNumber, ayahMap);
}

function loadDuas(duaDirPath) {
  const duaMap = new Map();

  if (!fs.existsSync(duaDirPath)) {
    console.warn(`[warn] Dua directory not found at ${duaDirPath}`);
    return duaMap;
  }

  let files = [];
  try {
    files = fs.readdirSync(duaDirPath);
  } catch (error) {
    console.warn(`[warn] Failed to read dua directory: ${error.message}`);
    return duaMap;
  }

  for (const fileName of files) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(duaDirPath, fileName);
    const parsed = readJsonFile(filePath, null);
    if (!parsed) {
      continue;
    }

    const id = String(parsed.id || path.basename(fileName, '.json')).trim().toLowerCase();
    const title = String(parsed.title || id).trim();
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines.map((line) => ({
          arabic: String(line?.arabic || '').trim(),
          transliteration: String(line?.transliteration || '').trim(),
          english: String(line?.english || '').trim()
        }))
      : [];

    if (!id || !title || lines.length === 0) {
      console.warn(`[warn] Skipping invalid dua file ${fileName} (missing id/title/lines)`);
      continue;
    }

    duaMap.set(id, { id, title, lines });
  }

  return duaMap;
}

const duaDataById = loadDuas(DUA_DIR);
if (duaDataById.size === 0) {
  // Keep app functional even before first import.
  duaDataById.set('iftitah', {
    id: 'iftitah',
    title: 'Duʿāʾ al-Iftitāḥ',
    lines: [
      {
        arabic: 'أَضِفْ نَصَّ الدُّعَاءِ فِي data/duas/iftitah.raw.txt',
        transliteration: 'Add the dua raw text in data/duas/iftitah.raw.txt',
        english: 'Run npm run format:iftitah, then restart server.'
      }
    ]
  });
  console.warn('[warn] No dua JSON files loaded. Using in-memory placeholder for iftitah.');
}

function getMaxAyahForSurah(surahNumber) {
  const fromMeta = surahMetaByNumber.get(surahNumber)?.ayahCount;
  if (Number.isFinite(fromMeta) && fromMeta > 0) {
    return fromMeta;
  }

  const fromData = ayahDataBySurah.get(surahNumber);
  if (!fromData || fromData.size === 0) {
    return 1;
  }

  return Math.max(...fromData.keys());
}

function clampQuranState(nextSurah, nextAyah) {
  const totalSurahs = metadata.surahs?.length || 114;
  const surahNumber = Math.max(1, Math.min(totalSurahs, Number(nextSurah) || 1));
  const maxAyah = getMaxAyahForSurah(surahNumber);
  const ayahNumber = Math.max(1, Math.min(maxAyah, Number(nextAyah) || 1));

  return { surahNumber, ayahNumber };
}

function listDuas() {
  return [...duaDataById.values()]
    .map((dua) => ({
      id: dua.id,
      title: dua.title,
      totalLines: dua.lines.length
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function getDefaultDuaId() {
  if (duaDataById.has('iftitah')) {
    return 'iftitah';
  }

  const firstDua = [...duaDataById.values()][0];
  return firstDua?.id || '';
}

function clampDuaState(candidateDua) {
  const defaultId = getDefaultDuaId();
  const requestedId = String(candidateDua?.duaId || defaultId).trim().toLowerCase();
  const dua = duaDataById.get(requestedId) || duaDataById.get(defaultId);

  if (!dua) {
    return {
      duaId: '',
      lineIndex: 1
    };
  }

  const maxLine = dua.lines.length || 1;
  const lineIndex = Math.max(1, Math.min(maxLine, Number(candidateDua?.lineIndex) || 1));

  return {
    duaId: dua.id,
    lineIndex
  };
}

function clampMode(mode) {
  return mode === 'dua' ? 'dua' : 'quran';
}

function clampAppState(candidateState) {
  const quran = clampQuranState(
    candidateState?.quran?.surahNumber ?? candidateState?.surahNumber,
    candidateState?.quran?.ayahNumber ?? candidateState?.ayahNumber
  );
  const dua = clampDuaState(candidateState?.dua || {});

  let mode = clampMode(candidateState?.mode);
  if (mode === 'dua' && !dua.duaId) {
    mode = 'quran';
  }

  return {
    mode,
    quran,
    dua
  };
}

function getAyahPayload(surahNumber, ayahNumber) {
  const meta =
    surahMetaByNumber.get(surahNumber) || {
      number: surahNumber,
      nameEnglish: `Surah ${surahNumber}`,
      nameArabic: '',
      ayahCount: getMaxAyahForSurah(surahNumber)
    };

  const ayahMap = ayahDataBySurah.get(surahNumber);
  const ayah = ayahMap?.get(ayahNumber);

  if (ayah) {
    return {
      surahNumber,
      ayahNumber,
      surahNameEnglish: meta.nameEnglish,
      surahNameArabic: meta.nameArabic,
      ayahCount: meta.ayahCount,
      arabic: ayah.arabic,
      translation: ayah.translation,
      transliteration: ayah.transliteration,
      missing: false
    };
  }

  return {
    surahNumber,
    ayahNumber,
    surahNameEnglish: meta.nameEnglish,
    surahNameArabic: meta.nameArabic,
    ayahCount: meta.ayahCount,
    arabic: '—',
    translation: `No bundled text for Surah ${surahNumber}, Ayah ${ayahNumber}.`,
    transliteration: 'Add a full dataset file at data/quran.full.json (or set QURAN_DATA_FILE).',
    missing: true
  };
}

function getQuranContentPayload(state) {
  const ayah = getAyahPayload(state.quran.surahNumber, state.quran.ayahNumber);

  return {
    mode: 'quran',
    header: `${ayah.surahNameEnglish} (${ayah.surahNumber}) · Ayah ${ayah.ayahNumber}`,
    arabic: ayah.arabic,
    translation: ayah.translation,
    transliteration: ayah.transliteration,
    quran: {
      surahNumber: ayah.surahNumber,
      ayahNumber: ayah.ayahNumber,
      surahNameEnglish: ayah.surahNameEnglish,
      surahNameArabic: ayah.surahNameArabic,
      ayahCount: ayah.ayahCount
    },
    missing: ayah.missing
  };
}

function getDuaContentPayload(state) {
  const dua = duaDataById.get(state.dua.duaId);

  if (!dua) {
    return {
      mode: 'dua',
      header: 'Duʿāʾ · Line 1',
      arabic: '—',
      translation: 'No dua is currently loaded.',
      transliteration: 'Add a file in data/duas and restart server.',
      dua: {
        duaId: '',
        title: 'Duʿāʾ',
        lineIndex: 1,
        totalLines: 1
      },
      missing: true
    };
  }

  const maxLine = dua.lines.length || 1;
  const lineIndex = Math.max(1, Math.min(maxLine, state.dua.lineIndex));
  const line = dua.lines[lineIndex - 1] || { arabic: '—', transliteration: '', english: '' };

  return {
    mode: 'dua',
    header: `${dua.title} · Line ${lineIndex}`,
    arabic: line.arabic || '—',
    translation: line.english || '',
    transliteration: line.transliteration || '',
    dua: {
      duaId: dua.id,
      title: dua.title,
      lineIndex,
      totalLines: maxLine
    },
    missing: false
  };
}

function getCurrentContentPayload(state) {
  return state.mode === 'dua' ? getDuaContentPayload(state) : getQuranContentPayload(state);
}

function getSteppedQuranState(quranState, direction) {
  const step = direction === 'prev' ? -1 : 1;
  const totalSurahs = metadata.surahs?.length || 114;

  let surahNumber = quranState.surahNumber;
  let ayahNumber = quranState.ayahNumber + step;

  const maxAyah = getMaxAyahForSurah(surahNumber);
  if (ayahNumber > maxAyah) {
    if (surahNumber < totalSurahs) {
      surahNumber += 1;
      ayahNumber = 1;
    } else {
      ayahNumber = maxAyah;
    }
  }

  if (ayahNumber < 1) {
    if (surahNumber > 1) {
      surahNumber -= 1;
      ayahNumber = getMaxAyahForSurah(surahNumber);
    } else {
      ayahNumber = 1;
    }
  }

  return clampQuranState(surahNumber, ayahNumber);
}

function getSteppedDuaState(duaState, direction) {
  const step = direction === 'prev' ? -1 : 1;
  const clamped = clampDuaState(duaState);
  const dua = duaDataById.get(clamped.duaId);
  const totalLines = dua?.lines.length || 1;

  return {
    duaId: clamped.duaId,
    lineIndex: Math.max(1, Math.min(totalLines, clamped.lineIndex + step))
  };
}

function statesEqual(a, b) {
  return (
    a.mode === b.mode &&
    a.quran.surahNumber === b.quran.surahNumber &&
    a.quran.ayahNumber === b.quran.ayahNumber &&
    a.dua.duaId === b.dua.duaId &&
    a.dua.lineIndex === b.dua.lineIndex
  );
}

function stateSummary(state) {
  if (state.mode === 'dua') {
    return `dua:${state.dua.duaId}#${state.dua.lineIndex}`;
  }

  return `quran:${state.quran.surahNumber}:${state.quran.ayahNumber}`;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

const lanIp = getLanIPv4();
const controlUrl = `http://${lanIp}:${PORT}/control`;
let qrCodeDataUrl = '';

let currentState = clampAppState({
  mode: 'quran',
  quran: { surahNumber: 1, ayahNumber: 1 },
  dua: { duaId: getDefaultDuaId(), lineIndex: 1 }
});

const socketInfoByWs = new Map();
let socketIdCounter = 1;
let activeControllerId = null;

function isControllerConnected() {
  return activeControllerId !== null;
}

function getSocketInfoById(socketId) {
  for (const [ws, info] of socketInfoByWs.entries()) {
    if (info.id === socketId) {
      return { ws, info };
    }
  }
  return null;
}

function sendMessage(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload, role) {
  for (const [ws, info] of socketInfoByWs.entries()) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    if (role && info.role !== role) {
      continue;
    }
    sendMessage(ws, payload);
  }
}

function getControllerFlags(socketInfo) {
  const isControl = socketInfo?.role === 'control';
  const isActiveController = isControl && socketInfo.id === activeControllerId;
  const lockedByAnother = isControl && activeControllerId !== null && !isActiveController;

  return {
    isActiveController,
    lockedByAnother
  };
}

function getBootstrapPayload(socketInfo) {
  const flags = getControllerFlags(socketInfo);

  return {
    type: 'bootstrap',
    state: currentState,
    content: getCurrentContentPayload(currentState),
    surahs: metadata.surahs || [],
    duas: listDuas(),
    config,
    dataset: {
      path: path.relative(ROOT_DIR, quranDataPath),
      type: quranData?.meta?.type || 'unknown',
      description: quranData?.meta?.description || ''
    },
    connection: {
      controllerConnected: isControllerConnected(),
      controlUrl,
      qrCodeDataUrl,
      controllerTimeoutMs: CONTROLLER_TIMEOUT_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      ...flags
    }
  };
}

function sendBootstrap(ws) {
  const socketInfo = socketInfoByWs.get(ws);
  sendMessage(ws, getBootstrapPayload(socketInfo));
}

function broadcastStateUpdate() {
  const payload = {
    type: 'state_update',
    state: currentState,
    content: getCurrentContentPayload(currentState)
  };
  broadcast(payload);
}

function broadcastControllerStatus() {
  broadcast(
    {
      type: 'controller_status',
      controllerConnected: isControllerConnected()
    },
    'display'
  );

  for (const [ws, info] of socketInfoByWs.entries()) {
    if (info.role !== 'control') {
      continue;
    }

    const flags = getControllerFlags(info);
    sendMessage(ws, {
      type: 'control_lock',
      controllerConnected: isControllerConnected(),
      ...flags
    });
  }
}

function setCurrentState(nextState, sourceLabel) {
  const clamped = clampAppState(nextState);
  if (statesEqual(clamped, currentState)) {
    return;
  }

  currentState = clamped;
  console.log(`[state] ${sourceLabel} -> ${stateSummary(currentState)}`);
  broadcastStateUpdate();
}

function setMode(nextMode, sourceLabel) {
  setCurrentState(
    {
      ...currentState,
      mode: clampMode(nextMode)
    },
    sourceLabel
  );
}

function setQuran(nextSurah, nextAyah, sourceLabel) {
  setCurrentState(
    {
      ...currentState,
      quran: clampQuranState(nextSurah, nextAyah)
    },
    sourceLabel
  );
}

function setDua(nextDuaId, nextLineIndex, sourceLabel) {
  setCurrentState(
    {
      ...currentState,
      dua: clampDuaState({ duaId: nextDuaId, lineIndex: nextLineIndex })
    },
    sourceLabel
  );
}

function stepActive(direction, sourceLabel) {
  if (direction !== 'next' && direction !== 'prev') {
    return;
  }

  if (currentState.mode === 'dua') {
    setCurrentState(
      {
        ...currentState,
        dua: getSteppedDuaState(currentState.dua, direction)
      },
      sourceLabel
    );
    return;
  }

  setCurrentState(
    {
      ...currentState,
      quran: getSteppedQuranState(currentState.quran, direction)
    },
    sourceLabel
  );
}

function releaseActiveController(reason, excludedControllerId = null) {
  if (activeControllerId === null) {
    return;
  }

  const releasedId = activeControllerId;
  activeControllerId = null;
  console.log(`[controller] Released controller #${releasedId} (${reason})`);

  for (const [ws, info] of socketInfoByWs.entries()) {
    if (info.role !== 'control' || ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    if (info.id === excludedControllerId) {
      continue;
    }

    activeControllerId = info.id;
    info.lastHeartbeatAt = Date.now();
    console.log(`[controller] Promoted controller #${info.id} after release`);
    break;
  }

  broadcastControllerStatus();
}

function claimController(ws) {
  const info = socketInfoByWs.get(ws);
  if (!info || info.role !== 'control') {
    return;
  }

  info.lastHeartbeatAt = Date.now();

  if (activeControllerId === null) {
    activeControllerId = info.id;
    console.log(`[controller] Controller #${info.id} is now active`);
  }

  broadcastControllerStatus();
}

function rejectIfNotActiveController(ws, socketInfo) {
  if (socketInfo.role !== 'control') {
    sendMessage(ws, {
      type: 'error',
      message: 'Only control clients can update state.'
    });
    return true;
  }

  if (socketInfo.id !== activeControllerId) {
    sendMessage(ws, {
      type: 'error',
      message: 'Controller lock active on another device.'
    });
    sendMessage(ws, {
      type: 'control_lock',
      controllerConnected: isControllerConnected(),
      ...getControllerFlags(socketInfo)
    });
    return true;
  }

  return false;
}

app.get('/', (_req, res) => {
  res.redirect('/display');
});

app.get('/display', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'display.html'));
});

app.get('/control', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'control.html'));
});

app.get('/api/bootstrap', (req, res) => {
  const role = req.query.role === 'control' ? 'control' : 'display';
  const syntheticSocketInfo = { id: -1, role };
  res.json(getBootstrapPayload(syntheticSocketInfo));
});

app.get('/api/surahs', (_req, res) => {
  res.json({ surahs: metadata.surahs || [] });
});

app.get('/api/duas', (_req, res) => {
  res.json({ duas: listDuas() });
});

app.get('/api/ayah', (req, res) => {
  const surahNumber = Number(req.query.surah || currentState.quran.surahNumber);
  const ayahNumber = Number(req.query.ayah || currentState.quran.ayahNumber);
  const quran = clampQuranState(surahNumber, ayahNumber);
  res.json({ ayah: getAyahPayload(quran.surahNumber, quran.ayahNumber) });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const socketInfo = {
    id: socketIdCounter,
    role: 'unknown',
    lastHeartbeatAt: Date.now()
  };

  socketIdCounter += 1;
  socketInfoByWs.set(ws, socketInfo);

  sendMessage(ws, {
    type: 'connected',
    socketId: socketInfo.id
  });

  ws.on('message', (buffer) => {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch (_error) {
      sendMessage(ws, {
        type: 'error',
        message: 'Invalid JSON message'
      });
      return;
    }

    if (message.type === 'hello') {
      const requestedRole = message.role === 'control' ? 'control' : 'display';
      socketInfo.role = requestedRole;

      if (requestedRole === 'control') {
        claimController(ws);
      }

      sendBootstrap(ws);
      return;
    }

    if (message.type === 'heartbeat') {
      if (socketInfo.role === 'control' && socketInfo.id === activeControllerId) {
        socketInfo.lastHeartbeatAt = Date.now();
      }
      return;
    }

    if (message.type === 'request_state') {
      sendBootstrap(ws);
      return;
    }

    if (
      message.type === 'setMode' ||
      message.type === 'set_mode' ||
      message.type === 'setQuran' ||
      message.type === 'set_quran' ||
      message.type === 'setDua' ||
      message.type === 'set_dua' ||
      message.type === 'next' ||
      message.type === 'prev' ||
      message.type === 'step' ||
      message.type === 'set_state'
    ) {
      if (rejectIfNotActiveController(ws, socketInfo)) {
        return;
      }

      socketInfo.lastHeartbeatAt = Date.now();

      if (message.type === 'setMode' || message.type === 'set_mode') {
        setMode(message.mode, `controller #${socketInfo.id}`);
        return;
      }

      if (message.type === 'setQuran' || message.type === 'set_quran' || message.type === 'set_state') {
        setQuran(message.surahNumber, message.ayahNumber, `controller #${socketInfo.id}`);
        return;
      }

      if (message.type === 'setDua' || message.type === 'set_dua') {
        setDua(message.duaId, message.lineIndex, `controller #${socketInfo.id}`);
        return;
      }

      if (message.type === 'next' || message.type === 'prev') {
        stepActive(message.type, `controller #${socketInfo.id}`);
        return;
      }

      if (message.type === 'step') {
        const direction = message.direction === 'prev' ? 'prev' : 'next';
        stepActive(direction, `controller #${socketInfo.id}`);
      }
    }
  });

  ws.on('close', () => {
    const info = socketInfoByWs.get(ws);
    if (!info) {
      return;
    }

    socketInfoByWs.delete(ws);

    if (info.id === activeControllerId) {
      releaseActiveController('socket disconnected', info.id);
    }
  });

  ws.on('error', (error) => {
    console.warn(`[ws] Socket error: ${error.message}`);
  });
});

const heartbeatMonitor = setInterval(() => {
  if (activeControllerId === null) {
    return;
  }

  const activeEntry = getSocketInfoById(activeControllerId);
  if (!activeEntry) {
    releaseActiveController('active socket missing');
    return;
  }

  const elapsed = Date.now() - activeEntry.info.lastHeartbeatAt;
  if (elapsed > CONTROLLER_TIMEOUT_MS) {
    releaseActiveController('heartbeat timeout', activeEntry.info.id);
  }
}, 5000);

async function start() {
  try {
    qrCodeDataUrl = await QRCode.toDataURL(controlUrl, {
      margin: 1,
      width: 220,
      color: {
        dark: '#1f1f1f',
        light: '#FFFFFF'
      }
    });
  } catch (error) {
    console.warn(`[warn] Failed to generate QR code: ${error.message}`);
    qrCodeDataUrl = '';
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('[startup] Qur\'an Recitation Display Controller running');
    console.log(`[startup] Display URL (OBS PC): http://localhost:${PORT}/display`);
    console.log(`[startup] Control URL (phone): ${controlUrl}`);
    console.log(`[startup] WebSocket endpoint: ws://${lanIp}:${PORT}/ws`);
    console.log(`[startup] Data file: ${path.relative(ROOT_DIR, quranDataPath)}`);
    console.log(`[startup] Dua files loaded: ${listDuas().length}`);
  });
}

start();

function shutdown(signal) {
  console.log(`[shutdown] Received ${signal}. Closing server...`);
  clearInterval(heartbeatMonitor);

  for (const ws of socketInfoByWs.keys()) {
    try {
      ws.close();
    } catch (_error) {
      // no-op
    }
  }

  wss.close(() => {
    server.close(() => {
      console.log('[shutdown] Server stopped');
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
