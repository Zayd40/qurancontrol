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

function clampState(nextSurah, nextAyah) {
  const totalSurahs = metadata.surahs?.length || 114;
  const surahNumber = Math.max(1, Math.min(totalSurahs, Number(nextSurah) || 1));
  const maxAyah = getMaxAyahForSurah(surahNumber);
  const ayahNumber = Math.max(1, Math.min(maxAyah, Number(nextAyah) || 1));

  return { surahNumber, ayahNumber };
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

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

const lanIp = getLanIPv4();
const controlUrl = `http://${lanIp}:${PORT}/control`;
let qrCodeDataUrl = '';

let currentState = clampState(1, 1);

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
    ayah: getAyahPayload(currentState.surahNumber, currentState.ayahNumber),
    surahs: metadata.surahs || [],
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
    ayah: getAyahPayload(currentState.surahNumber, currentState.ayahNumber)
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

function setState(nextSurah, nextAyah, sourceLabel) {
  const nextState = clampState(nextSurah, nextAyah);
  if (
    nextState.surahNumber === currentState.surahNumber &&
    nextState.ayahNumber === currentState.ayahNumber
  ) {
    return;
  }

  currentState = nextState;
  console.log(
    `[state] ${sourceLabel} -> Surah ${currentState.surahNumber}, Ayah ${currentState.ayahNumber}`
  );
  broadcastStateUpdate();
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

app.get('/api/ayah', (req, res) => {
  const surahNumber = Number(req.query.surah || currentState.surahNumber);
  const ayahNumber = Number(req.query.ayah || currentState.ayahNumber);
  const next = clampState(surahNumber, ayahNumber);
  res.json({ ayah: getAyahPayload(next.surahNumber, next.ayahNumber) });
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

    if (message.type === 'set_state') {
      if (socketInfo.role !== 'control') {
        sendMessage(ws, {
          type: 'error',
          message: 'Only control clients can update state.'
        });
        return;
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
        return;
      }

      socketInfo.lastHeartbeatAt = Date.now();
      setState(message.surahNumber, message.ayahNumber, `controller #${socketInfo.id}`);
      return;
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
