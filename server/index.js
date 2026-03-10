const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const dotenv = require('dotenv');

const { promptForStartupSession } = require('./cli');
const { createDashboard } = require('./dashboard');
const {
  getLanIPv4,
  loadConfig,
  loadDuas,
  loadGuidedEvents,
  loadQuranDataset,
  loadSurahMetadata
} = require('./loaders');
const { createLogBuffer } = require('./logBuffer');
const { createSessionManager } = require('./session');
const { createSessionStore } = require('./sessionStore');

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DUA_DIR = path.join(DATA_DIR, 'duas');
const EVENTS_DIR = path.join(DATA_DIR, 'events');

const PORT = Number(process.env.PORT || 5173);
const CONTROLLER_TIMEOUT_MS = Number(process.env.CONTROLLER_TIMEOUT_MS || 30000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 10000);

const config = loadConfig(DATA_DIR);
const metadata = loadSurahMetadata(DATA_DIR);
const quranDataset = loadQuranDataset(ROOT_DIR, DATA_DIR);
const duasById = loadDuas(DUA_DIR);
const eventsById = loadGuidedEvents(EVENTS_DIR);
const sessionManager = createSessionManager({
  metadata,
  quranDataset,
  duasById,
  eventsById
});
const sessionStore = createSessionStore(ROOT_DIR);
const logBuffer = createLogBuffer(3);
const dashboard = createDashboard();

const lanIp = getLanIPv4();
const displayUrl = `http://localhost:${PORT}/display`;
const controlUrl = `http://${lanIp}:${PORT}/control`;

let qrCodeDataUrl = '';
let currentState = null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const socketInfoByWs = new Map();
let socketIdCounter = 1;
let activeControllerId = null;

function stateKey(state) {
  return JSON.stringify(state);
}

function isControllerConnected() {
  return activeControllerId !== null;
}

function normalizeIp(address) {
  if (!address) {
    return 'unknown';
  }
  return String(address).replace('::ffff:', '');
}

function getRecentActivityLines() {
  const entries = logBuffer.list();
  return entries.length > 0 ? entries : ['[--:--:--] WAITING — No controller activity yet'];
}

function renderDashboard() {
  dashboard.render({
    modeLabel: sessionManager.getModeLabel(currentState.sessionType),
    selectedContent: sessionManager.describeSelectedContent(currentState),
    displayUrl,
    controllerUrl: controlUrl,
    recentActivity: getRecentActivityLines()
  });
}

function pushActivity(action, detail) {
  logBuffer.add(action, detail);
  renderDashboard();
}

function getControllerFlags(socketInfo) {
  const isControl = socketInfo?.role === 'control';
  const isActiveController = isControl && socketInfo.id === activeControllerId;
  const lockedByAnother = isControl && activeControllerId !== null && socketInfo.id !== activeControllerId;

  return {
    isActiveController,
    lockedByAnother
  };
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

function getBootstrapPayload(socketInfo) {
  return {
    type: 'bootstrap',
    config,
    session: sessionManager.getPublicSessionData(currentState),
    state: currentState,
    content: sessionManager.getCurrentContentPayload(currentState),
    surahs: metadata.surahs || [],
    connection: {
      controllerConnected: isControllerConnected(),
      controlUrl,
      qrCodeDataUrl,
      controllerTimeoutMs: CONTROLLER_TIMEOUT_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      ...getControllerFlags(socketInfo)
    },
    dataset: {
      path: path.relative(ROOT_DIR, quranDataset.path),
      type: quranDataset.meta.type,
      description: quranDataset.meta.description
    }
  };
}

function sendBootstrap(ws) {
  const socketInfo = socketInfoByWs.get(ws) || { id: -1, role: 'display' };
  sendMessage(ws, getBootstrapPayload(socketInfo));
}

function broadcastStateUpdate() {
  broadcast({
    type: 'state_update',
    session: sessionManager.getPublicSessionData(currentState),
    state: currentState,
    content: sessionManager.getCurrentContentPayload(currentState)
  });
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

    sendMessage(ws, {
      type: 'control_lock',
      controllerConnected: isControllerConnected(),
      ...getControllerFlags(info)
    });
  }
}

function persistState() {
  sessionStore.save(currentState);
}

function setCurrentState(nextState, activity) {
  const clamped = sessionManager.clampState(nextState);
  if (stateKey(clamped) === stateKey(currentState)) {
    return false;
  }

  currentState = clamped;
  persistState();
  broadcastStateUpdate();
  if (activity) {
    pushActivity(activity.action, activity.detail);
  } else {
    renderDashboard();
  }
  return true;
}

function claimController(ws) {
  const info = socketInfoByWs.get(ws);
  if (!info || info.role !== 'control') {
    return;
  }

  info.lastHeartbeatAt = Date.now();

  if (activeControllerId === null) {
    activeControllerId = info.id;
    broadcastControllerStatus();
    pushActivity('CONNECTED', `Controller joined (${info.ip})`);
    return;
  }

  broadcastControllerStatus();
}

function releaseActiveController(reason, socketInfo) {
  if (!socketInfo || socketInfo.id !== activeControllerId) {
    return;
  }

  activeControllerId = null;
  broadcastControllerStatus();

  if (reason === 'timeout') {
    pushActivity('TIMED OUT', `Controller inactive (${socketInfo.ip})`);
    return;
  }

  pushActivity('DISCONNECTED', `Controller left (${socketInfo.ip})`);
}

function rejectIfNotActiveController(ws, socketInfo) {
  if (socketInfo.role !== 'control') {
    sendMessage(ws, {
      type: 'error',
      message: 'Only control clients can update the session.'
    });
    return true;
  }

  if (socketInfo.id !== activeControllerId) {
    sendMessage(ws, {
      type: 'error',
      message: activeControllerId === null ? 'No active controller. Refresh to claim control.' : 'Controller is active on another device.'
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

function resolveActionFromMessage(message, sessionType) {
  if (message.type === 'step') {
    return {
      type: 'step',
      direction: message.direction === 'prev' ? 'prev' : 'next'
    };
  }

  if (sessionType === 'quran') {
    if (message.type === 'select_surah') {
      return {
        type: 'select_surah',
        surahNumber: Number(message.surahNumber)
      };
    }

    if (message.type === 'jump_ayah') {
      return {
        type: 'jump_ayah',
        ayahNumber: Number(message.ayahNumber)
      };
    }
  }

  if (sessionType === 'dua' && message.type === 'jump_line') {
    return {
      type: 'jump_line',
      lineIndex: Number(message.lineIndex)
    };
  }

  if (sessionType === 'guided_event' && message.type === 'jump_section') {
    return {
      type: 'jump_section',
      sectionIndex: Number(message.sectionIndex)
    };
  }

  return null;
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
  res.json(getBootstrapPayload({ id: -1, role, ip: normalizeIp(req.ip) }));
});

wss.on('connection', (ws, req) => {
  const socketInfo = {
    id: socketIdCounter,
    ip: normalizeIp(req.socket.remoteAddress),
    role: 'unknown',
    lastHeartbeatAt: Date.now()
  };

  socketIdCounter += 1;
  socketInfoByWs.set(ws, socketInfo);

  ws.on('message', (buffer) => {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch (_error) {
      sendMessage(ws, {
        type: 'error',
        message: 'Invalid JSON message.'
      });
      return;
    }

    if (message.type === 'hello') {
      socketInfo.role = message.role === 'control' ? 'control' : 'display';
      if (socketInfo.role === 'control') {
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

    const action = resolveActionFromMessage(message, currentState.sessionType);
    if (!action) {
      return;
    }

    if (rejectIfNotActiveController(ws, socketInfo)) {
      return;
    }

    socketInfo.lastHeartbeatAt = Date.now();

    const transition = sessionManager.transition(currentState, action);
    if (transition.changed) {
      setCurrentState(transition.state, transition.activity);
    }
  });

  ws.on('close', () => {
    const info = socketInfoByWs.get(ws);
    if (!info) {
      return;
    }

    socketInfoByWs.delete(ws);
    if (info.id === activeControllerId) {
      releaseActiveController('close', info);
    }
  });

  ws.on('error', () => {
    // close handler owns cleanup
  });
});

const heartbeatMonitor = setInterval(() => {
  if (activeControllerId === null) {
    return;
  }

  for (const info of socketInfoByWs.values()) {
    if (info.id !== activeControllerId) {
      continue;
    }

    const elapsed = Date.now() - info.lastHeartbeatAt;
    if (elapsed > CONTROLLER_TIMEOUT_MS) {
      activeControllerId = null;
      broadcastControllerStatus();
      pushActivity('TIMED OUT', `Controller inactive (${info.ip})`);
    }
    return;
  }

  activeControllerId = null;
  broadcastControllerStatus();
  renderDashboard();
}, 5000);

async function start() {
  const savedState = sessionStore.load();
  currentState = await promptForStartupSession({
    sessionManager,
    savedState: savedState ? sessionManager.clampState(savedState) : null
  });
  persistState();

  try {
    qrCodeDataUrl = await QRCode.toDataURL(controlUrl, {
      margin: 1,
      width: 220,
      color: {
        dark: '#F4F1E8',
        light: '#14171c'
      }
    });
  } catch (error) {
    console.warn(`[warn] Failed to generate QR code: ${error.message}`);
    qrCodeDataUrl = '';
  }

  server.listen(PORT, '0.0.0.0', () => {
    renderDashboard();
  });
}

function shutdown(signal) {
  clearInterval(heartbeatMonitor);

  for (const ws of socketInfoByWs.keys()) {
    try {
      ws.close();
    } catch (_error) {
      // ignore close errors during shutdown
    }
  }

  wss.close(() => {
    server.close(() => {
      process.stdout.write(`\nStopping server (${signal})\n`);
      process.exit(0);
    });
  });
}

start().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
