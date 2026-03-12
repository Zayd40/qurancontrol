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
const logBuffer = createLogBuffer(20);
const dashboard = createDashboard();

const lanIp = getLanIPv4();
const displayUrl = `http://localhost:${PORT}/display`;
const controlUrl = `http://${lanIp}:${PORT}/control`;
const adminUrl = `http://${lanIp}:${PORT}/admin`;

let qrCodeDataUrl = '';
let currentState = null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const socketInfoByWs = new Map();

function stateKey(state) {
  return JSON.stringify(state);
}

function getControllerCount() {
  let total = 0;

  for (const [ws, info] of socketInfoByWs.entries()) {
    if (ws.readyState === WebSocket.OPEN && info.role === 'control') {
      total += 1;
    }
  }

  return total;
}

function isControllerConnected() {
  return getControllerCount() > 0;
}

function normalizeIp(address) {
  if (!address) {
    return 'unknown';
  }
  return String(address).replace('::ffff:', '');
}

function getRecentActivityLines(limit = 3) {
  const entries = logBuffer.list(limit);
  return entries.length > 0 ? entries : ['[--:--:--] WAITING - No controller activity yet'];
}

function renderDashboard() {
  dashboard.render({
    modeLabel: sessionManager.getModeLabel(currentState.sessionType),
    selectedContent: sessionManager.describeSelectedContent(currentState),
    displayUrl,
    controllerUrl: controlUrl,
    recentActivity: getRecentActivityLines(3)
  });
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

function broadcastActivityUpdate() {
  broadcast(
    {
      type: 'activity_update',
      recentActivity: getRecentActivityLines(20)
    },
    'admin'
  );
}

function pushActivity(action, detail) {
  logBuffer.add(action, detail);
  renderDashboard();
  broadcastActivityUpdate();
}

function broadcastControllerStatus() {
  broadcast({
    type: 'controller_status',
    controllerConnected: isControllerConnected(),
    controllerCount: getControllerCount()
  });
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
      controllerCount: getControllerCount(),
      controlUrl,
      qrCodeDataUrl
    },
    system: {
      displayUrl,
      controllerUrl: controlUrl,
      adminUrl
    },
    activity: {
      recentActivity: getRecentActivityLines(20)
    },
    catalog: {
      duas: sessionManager.listDuas(),
      events: sessionManager.listEvents()
    },
    dataset: {
      path: path.relative(ROOT_DIR, quranDataset.path),
      type: quranDataset.meta.type,
      description: quranDataset.meta.description
    },
    socketRole: socketInfo?.role || 'display'
  };
}

function sendBootstrap(ws) {
  const socketInfo = socketInfoByWs.get(ws) || { role: 'display' };
  sendMessage(ws, getBootstrapPayload(socketInfo));
}

function persistState() {
  sessionStore.save(currentState);
}

function broadcastStateUpdate() {
  broadcast({
    type: 'state_update',
    session: sessionManager.getPublicSessionData(currentState),
    state: currentState,
    content: sessionManager.getCurrentContentPayload(currentState)
  });
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

function ensureControlRole(ws, socketInfo) {
  if (socketInfo.role === 'control' || socketInfo.role === 'admin') {
    return true;
  }

  sendMessage(ws, {
    type: 'error',
    message: 'Only controller and admin clients can update the session.'
  });
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

function formatActor(socketInfo) {
  if (socketInfo.role === 'admin') {
    return 'Admin';
  }

  return `Controller (${socketInfo.ip})`;
}

function applySessionTransition(socketInfo, action) {
  const transition = sessionManager.transition(currentState, action);
  if (!transition.changed) {
    return;
  }

  const actor = formatActor(socketInfo);
  setCurrentState(transition.state, {
    action: transition.activity.action,
    detail: `${actor} - ${transition.activity.detail}`
  });
}

function handleAdminCommand(ws, socketInfo, message) {
  if (socketInfo.role !== 'admin') {
    return false;
  }

  if (message.type === 'admin_set_mode') {
    const sessionType = message.sessionType === 'dua' || message.sessionType === 'guided_event'
      ? message.sessionType
      : 'quran';

    const nextState = sessionManager.createNewSession(sessionType, {
      selectedDuaId:
        sessionType === 'dua'
          ? String(message.selectedDuaId || currentState.selectedDuaId || sessionManager.getDefaultDuaId())
              .trim()
              .toLowerCase()
          : null,
      selectedEventId:
        sessionType === 'guided_event'
          ? String(
              message.selectedEventId ||
                currentState.selectedEventId ||
                sessionManager.getDefaultEventId()
            )
              .trim()
              .toLowerCase()
          : null
    });

    setCurrentState(nextState, {
      action: 'MODE',
      detail: `Admin - Switched to ${sessionManager.getModeLabel(nextState.sessionType)}`
    });
    return true;
  }

  if (message.type === 'admin_select_event') {
    const nextState = sessionManager.createNewSession('guided_event', {
      selectedEventId: String(message.selectedEventId || sessionManager.getDefaultEventId())
        .trim()
        .toLowerCase()
    });

    const selectedEvent = eventsById.get(nextState.selectedEventId || '');
    setCurrentState(nextState, {
      action: 'EVENT',
      detail: `Admin - ${selectedEvent?.title || 'Guided Event'}`
    });
    return true;
  }

  if (message.type === 'admin_restart_session') {
    const nextState = sessionManager.restartSession(currentState);
    setCurrentState(nextState, {
      action: 'RESTART',
      detail: `Admin - ${sessionManager.describeSelectedContent(nextState)}`
    });
    return true;
  }

  if (message.type === 'admin_reset_position') {
    const nextState = sessionManager.resetToFirstPosition(currentState);
    setCurrentState(nextState, {
      action: 'RESET',
      detail: `Admin - ${sessionManager.describeSelectedContent(nextState)}`
    });
    return true;
  }

  if (message.type === 'admin_toggle_blank') {
    const nextState = sessionManager.setBlanked(currentState, !currentState.blanked);
    setCurrentState(nextState, {
      action: nextState.blanked ? 'BLANK' : 'RESTORE',
      detail: `Admin - ${nextState.blanked ? 'Display blanked' : 'Display restored'}`
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

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/api/bootstrap', (req, res) => {
  const role = ['control', 'admin'].includes(req.query.role) ? req.query.role : 'display';
  res.json(getBootstrapPayload({ role, ip: normalizeIp(req.ip) }));
});

wss.on('connection', (ws, req) => {
  const socketInfo = {
    ip: normalizeIp(req.socket.remoteAddress),
    role: 'unknown'
  };

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
      socketInfo.role = ['control', 'admin'].includes(message.role) ? message.role : 'display';

      if (socketInfo.role === 'control') {
        pushActivity('CONNECTED', `Controller joined (${socketInfo.ip})`);
        broadcastControllerStatus();
      }

      sendBootstrap(ws);
      return;
    }

    if (message.type === 'heartbeat') {
      return;
    }

    if (message.type === 'request_state') {
      sendBootstrap(ws);
      return;
    }

    if (!ensureControlRole(ws, socketInfo)) {
      return;
    }

    if (handleAdminCommand(ws, socketInfo, message)) {
      return;
    }

    const action = resolveActionFromMessage(message, currentState.sessionType);
    if (!action) {
      sendMessage(ws, {
        type: 'error',
        message: 'Action is not available in the current mode.'
      });
      return;
    }

    applySessionTransition(socketInfo, action);
  });

  ws.on('close', () => {
    const info = socketInfoByWs.get(ws);
    if (!info) {
      return;
    }

    socketInfoByWs.delete(ws);

    if (info.role === 'control') {
      pushActivity('DISCONNECTED', `Controller left (${info.ip})`);
      broadcastControllerStatus();
    }
  });

  ws.on('error', () => {
    // close handler owns cleanup
  });
});

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
