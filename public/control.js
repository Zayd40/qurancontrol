const els = {
  brandText: document.getElementById('brandText'),
  currentRef: document.getElementById('currentRef'),
  lockMessage: document.getElementById('lockMessage'),
  surahSelect: document.getElementById('surahSelect'),
  ayahInput: document.getElementById('ayahInput'),
  boundsHint: document.getElementById('boundsHint'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  jumpBtn: document.getElementById('jumpBtn')
};

let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;

let surahs = [];
const surahByNumber = new Map();

let currentState = {
  surahNumber: 1,
  ayahNumber: 1
};

let lockState = {
  isActiveController: false,
  lockedByAnother: false,
  controllerConnected: false
};

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function sortedSurahs() {
  return [...surahs].sort((a, b) => a.number - b.number);
}

function getAyahMax(surahNumber) {
  return surahByNumber.get(Number(surahNumber))?.ayahCount || 1;
}

function clampAyah(surahNumber, ayahNumber) {
  const max = getAyahMax(surahNumber);
  const value = Number(ayahNumber) || 1;
  return Math.max(1, Math.min(max, value));
}

function controlsEnabled() {
  return lockState.isActiveController && ws && ws.readyState === WebSocket.OPEN;
}

function updateUiLockState() {
  const enabled = controlsEnabled();

  els.surahSelect.disabled = !enabled;
  els.ayahInput.disabled = !enabled;
  els.jumpBtn.disabled = !enabled;
  els.prevBtn.disabled = !enabled;
  els.nextBtn.disabled = !enabled;

  if (lockState.isActiveController) {
    els.lockMessage.textContent = 'Connected: this phone controls the display.';
    return;
  }

  if (lockState.lockedByAnother) {
    els.lockMessage.textContent = 'Controller already active on another phone (read-only).';
    return;
  }

  els.lockMessage.textContent = 'Awaiting controller lock...';
}

function renderCurrentRef(ayah) {
  if (!ayah) {
    return;
  }
  els.currentRef.textContent = `${ayah.surahNameEnglish} (${ayah.surahNumber}) - Ayah ${ayah.ayahNumber}`;
}

function populateSurahSelect() {
  const selected = Number(els.surahSelect.value || currentState.surahNumber || 1);
  els.surahSelect.innerHTML = '';

  for (const surah of sortedSurahs()) {
    const option = document.createElement('option');
    option.value = String(surah.number);
    option.textContent = `${surah.number}. ${surah.nameEnglish}`;
    els.surahSelect.appendChild(option);
  }

  els.surahSelect.value = String(selected);
}

function syncAyahBounds(surahNumber, desiredAyah) {
  const max = getAyahMax(surahNumber);
  const ayahNumber = clampAyah(surahNumber, desiredAyah);

  els.ayahInput.max = String(max);
  els.ayahInput.value = String(ayahNumber);
  els.boundsHint.textContent = `Max ayah: ${max}`;

  return ayahNumber;
}

function applyState(state, ayah) {
  if (!state) {
    return;
  }

  currentState = {
    surahNumber: Number(state.surahNumber) || 1,
    ayahNumber: Number(state.ayahNumber) || 1
  };

  els.surahSelect.value = String(currentState.surahNumber);
  currentState.ayahNumber = syncAyahBounds(currentState.surahNumber, currentState.ayahNumber);

  if (ayah) {
    renderCurrentRef(ayah);
  }
}

function sendSetState(surahNumber, ayahNumber) {
  if (!controlsEnabled()) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'set_state',
      surahNumber,
      ayahNumber
    })
  );
}

function moveRelative(step) {
  const sorted = sortedSurahs();
  const index = sorted.findIndex((s) => s.number === currentState.surahNumber);
  let surahNumber = currentState.surahNumber;
  let ayahNumber = currentState.ayahNumber + step;

  const maxAyah = getAyahMax(surahNumber);

  if (ayahNumber > maxAyah) {
    if (index >= 0 && index < sorted.length - 1) {
      surahNumber = sorted[index + 1].number;
      ayahNumber = 1;
    } else {
      ayahNumber = maxAyah;
    }
  }

  if (ayahNumber < 1) {
    if (index > 0) {
      surahNumber = sorted[index - 1].number;
      ayahNumber = getAyahMax(surahNumber);
    } else {
      ayahNumber = 1;
    }
  }

  sendSetState(surahNumber, ayahNumber);
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, 1500);
}

function startHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
  }

  heartbeatTimer = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }, 10000);
}

function stopHeartbeat() {
  if (!heartbeatTimer) {
    return;
  }

  window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function handleSocketMessage(message) {
  switch (message.type) {
    case 'bootstrap': {
      if (message.config?.brandText) {
        els.brandText.textContent = message.config.brandText;
      }

      if (message.config?.accentColor) {
        document.documentElement.style.setProperty('--accent', message.config.accentColor);
      }

      if (Array.isArray(message.surahs) && message.surahs.length > 0) {
        surahs = message.surahs.map((surah) => ({
          number: Number(surah.number),
          nameEnglish: surah.nameEnglish,
          ayahCount: Number(surah.ayahCount) || 1
        }));

        surahByNumber.clear();
        for (const surah of surahs) {
          surahByNumber.set(surah.number, surah);
        }

        populateSurahSelect();
      }

      lockState = {
        isActiveController: Boolean(message.connection?.isActiveController),
        lockedByAnother: Boolean(message.connection?.lockedByAnother),
        controllerConnected: Boolean(message.connection?.controllerConnected)
      };

      applyState(message.state, message.ayah);
      updateUiLockState();
      break;
    }
    case 'state_update':
      applyState(message.state, message.ayah);
      break;
    case 'control_lock':
      lockState = {
        isActiveController: Boolean(message.isActiveController),
        lockedByAnother: Boolean(message.lockedByAnother),
        controllerConnected: Boolean(message.controllerConnected)
      };
      updateUiLockState();
      break;
    case 'error':
      els.lockMessage.textContent = message.message || 'Action rejected by server.';
      break;
    default:
      break;
  }
}

function connectSocket() {
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'hello',
        role: 'control'
      })
    );

    startHeartbeat();
  });

  ws.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      handleSocketMessage(message);
    } catch (_error) {
      // ignore malformed payloads
    }
  });

  ws.addEventListener('close', () => {
    stopHeartbeat();
    lockState = {
      isActiveController: false,
      lockedByAnother: false,
      controllerConnected: false
    };
    updateUiLockState();
    els.lockMessage.textContent = 'Disconnected. Reconnecting...';
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function attachEvents() {
  els.surahSelect.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || 1);
    syncAyahBounds(surahNumber, 1);
  });

  els.jumpBtn.addEventListener('click', () => {
    const surahNumber = Number(els.surahSelect.value || currentState.surahNumber || 1);
    const ayahNumber = clampAyah(surahNumber, Number(els.ayahInput.value || 1));
    sendSetState(surahNumber, ayahNumber);
  });

  els.prevBtn.addEventListener('click', () => moveRelative(-1));
  els.nextBtn.addEventListener('click', () => moveRelative(1));

  els.ayahInput.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || currentState.surahNumber || 1);
    syncAyahBounds(surahNumber, Number(els.ayahInput.value || 1));
  });
}

async function init() {
  attachEvents();

  try {
    const response = await fetch('/api/bootstrap?role=control', { cache: 'no-store' });
    if (response.ok) {
      const bootstrap = await response.json();
      handleSocketMessage(bootstrap);
    }
  } catch (_error) {
    // socket bootstrap will recover
  }

  connectSocket();
}

init();
