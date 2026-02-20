const els = {
  brandText: document.getElementById('brandText'),
  currentRef: document.getElementById('currentRef'),
  lockMessage: document.getElementById('lockMessage'),
  modeQuranBtn: document.getElementById('modeQuranBtn'),
  modeDuaBtn: document.getElementById('modeDuaBtn'),
  quranPanel: document.getElementById('quranPanel'),
  duaPanel: document.getElementById('duaPanel'),
  surahSelect: document.getElementById('surahSelect'),
  ayahInput: document.getElementById('ayahInput'),
  jumpBtn: document.getElementById('jumpBtn'),
  boundsHint: document.getElementById('boundsHint'),
  duaSelect: document.getElementById('duaSelect'),
  lineInput: document.getElementById('lineInput'),
  lineJumpBtn: document.getElementById('lineJumpBtn'),
  lineHint: document.getElementById('lineHint'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  previewArabic: document.getElementById('previewArabic'),
  previewTranslation: document.getElementById('previewTranslation'),
  previewTransliteration: document.getElementById('previewTransliteration')
};

let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;

let surahs = [];
const surahByNumber = new Map();

let duas = [];
const duaById = new Map();

let currentState = {
  mode: 'quran',
  quran: {
    surahNumber: 1,
    ayahNumber: 1
  },
  dua: {
    duaId: '',
    lineIndex: 1
  }
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

function controlsEnabled() {
  return lockState.isActiveController && ws && ws.readyState === WebSocket.OPEN;
}

function getAyahMax(surahNumber) {
  return surahByNumber.get(Number(surahNumber))?.ayahCount || 1;
}

function clampAyah(surahNumber, ayahNumber) {
  const max = getAyahMax(surahNumber);
  const value = Number(ayahNumber) || 1;
  return Math.max(1, Math.min(max, value));
}

function getDuaTotalLines(duaId) {
  return duaById.get(String(duaId || '').toLowerCase())?.totalLines || 1;
}

function clampLine(duaId, lineIndex) {
  const max = getDuaTotalLines(duaId);
  const value = Number(lineIndex) || 1;
  return Math.max(1, Math.min(max, value));
}

function populateSurahSelect() {
  const sorted = [...surahs].sort((a, b) => a.number - b.number);
  const selected = Number(els.surahSelect.value || currentState.quran.surahNumber || 1);

  els.surahSelect.innerHTML = '';
  for (const surah of sorted) {
    const option = document.createElement('option');
    option.value = String(surah.number);
    option.textContent = `${surah.number}. ${surah.nameEnglish}`;
    els.surahSelect.appendChild(option);
  }

  els.surahSelect.value = String(selected);
}

function populateDuaSelect() {
  const selected = String(els.duaSelect.value || currentState.dua.duaId || '').toLowerCase();

  els.duaSelect.innerHTML = '';
  for (const dua of duas) {
    const option = document.createElement('option');
    option.value = dua.id;
    option.textContent = dua.title;
    els.duaSelect.appendChild(option);
  }

  if (selected && duaById.has(selected)) {
    els.duaSelect.value = selected;
  } else if (duas.length > 0) {
    els.duaSelect.value = duas[0].id;
  }
}

function syncAyahBounds(surahNumber, desiredAyah) {
  const max = getAyahMax(surahNumber);
  const ayahNumber = clampAyah(surahNumber, desiredAyah);

  els.ayahInput.max = String(max);
  els.ayahInput.value = String(ayahNumber);
  els.boundsHint.textContent = `Max ayah: ${max}`;

  return ayahNumber;
}

function syncDuaLineBounds(duaId, desiredLine) {
  const max = getDuaTotalLines(duaId);
  const lineIndex = clampLine(duaId, desiredLine);

  els.lineInput.max = String(max);
  els.lineInput.value = String(lineIndex);
  els.lineHint.textContent = `Line ${lineIndex} / ${max}`;

  return lineIndex;
}

function applyModeUi(mode) {
  const isDua = mode === 'dua';

  els.modeQuranBtn.classList.toggle('active', !isDua);
  els.modeDuaBtn.classList.toggle('active', isDua);
  els.quranPanel.classList.toggle('hidden', isDua);
  els.duaPanel.classList.toggle('hidden', !isDua);

  els.prevBtn.textContent = isDua ? 'Previous Line' : 'Previous Ayah';
  els.nextBtn.textContent = isDua ? 'Next Line' : 'Next Ayah';
}

function updateUiLockState() {
  const enabled = controlsEnabled();

  els.modeQuranBtn.disabled = !enabled;
  els.modeDuaBtn.disabled = !enabled;
  els.surahSelect.disabled = !enabled;
  els.ayahInput.disabled = !enabled;
  els.jumpBtn.disabled = !enabled;
  els.duaSelect.disabled = !enabled;
  els.lineInput.disabled = !enabled;
  els.lineJumpBtn.disabled = !enabled;
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

function renderCurrentRef(content) {
  if (!content) {
    return;
  }

  if (content.mode === 'dua' && content.dua) {
    els.currentRef.textContent = `${content.dua.title} · Line ${content.dua.lineIndex}`;
    return;
  }

  if (content.mode === 'quran' && content.quran) {
    els.currentRef.textContent = `${content.quran.surahNameEnglish} (${content.quran.surahNumber}) · Ayah ${content.quran.ayahNumber}`;
    return;
  }

  els.currentRef.textContent = content.header || 'Awaiting state...';
}

function renderContentPreview(content) {
  if (!content) {
    return;
  }

  els.previewArabic.textContent = content.arabic || '—';
  els.previewTranslation.textContent = content.translation || '';
  els.previewTransliteration.textContent = content.transliteration || '';
}

function applyState(state, content) {
  if (!state) {
    return;
  }

  currentState = {
    mode: state.mode === 'dua' ? 'dua' : 'quran',
    quran: {
      surahNumber: Number(state.quran?.surahNumber) || 1,
      ayahNumber: Number(state.quran?.ayahNumber) || 1
    },
    dua: {
      duaId: String(state.dua?.duaId || '').toLowerCase(),
      lineIndex: Number(state.dua?.lineIndex) || 1
    }
  };

  applyModeUi(currentState.mode);

  els.surahSelect.value = String(currentState.quran.surahNumber);
  currentState.quran.ayahNumber = syncAyahBounds(currentState.quran.surahNumber, currentState.quran.ayahNumber);

  if (currentState.dua.duaId && duaById.has(currentState.dua.duaId)) {
    els.duaSelect.value = currentState.dua.duaId;
  } else if (duas.length > 0) {
    currentState.dua.duaId = duas[0].id;
    els.duaSelect.value = duas[0].id;
  }

  currentState.dua.lineIndex = syncDuaLineBounds(currentState.dua.duaId, currentState.dua.lineIndex);

  if (content) {
    renderCurrentRef(content);
    renderContentPreview(content);
  }
}

function send(payload) {
  if (!controlsEnabled()) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function sendSetMode(mode) {
  send({ type: 'setMode', mode });
}

function sendSetQuran(surahNumber, ayahNumber) {
  send({ type: 'setQuran', surahNumber, ayahNumber });
}

function sendSetDua(duaId, lineIndex) {
  send({ type: 'setDua', duaId, lineIndex });
}

function sendStep(direction) {
  send({ type: 'step', direction });
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

      if (Array.isArray(message.duas) && message.duas.length > 0) {
        duas = message.duas.map((dua) => ({
          id: String(dua.id || '').toLowerCase(),
          title: String(dua.title || ''),
          totalLines: Number(dua.totalLines) || 1
        }));

        duaById.clear();
        for (const dua of duas) {
          duaById.set(dua.id, dua);
        }

        populateDuaSelect();
      }

      lockState = {
        isActiveController: Boolean(message.connection?.isActiveController),
        lockedByAnother: Boolean(message.connection?.lockedByAnother),
        controllerConnected: Boolean(message.connection?.controllerConnected)
      };

      applyState(message.state, message.content);
      updateUiLockState();
      break;
    }
    case 'state_update':
      applyState(message.state, message.content);
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
  els.modeQuranBtn.addEventListener('click', () => {
    if (currentState.mode !== 'quran') {
      sendSetMode('quran');
    }
  });

  els.modeDuaBtn.addEventListener('click', () => {
    if (currentState.mode !== 'dua') {
      sendSetMode('dua');
    }
  });

  els.surahSelect.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || 1);
    syncAyahBounds(surahNumber, 1);
  });

  els.jumpBtn.addEventListener('click', () => {
    const surahNumber = Number(els.surahSelect.value || currentState.quran.surahNumber || 1);
    const ayahNumber = clampAyah(surahNumber, Number(els.ayahInput.value || 1));
    sendSetQuran(surahNumber, ayahNumber);
  });

  els.ayahInput.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || currentState.quran.surahNumber || 1);
    syncAyahBounds(surahNumber, Number(els.ayahInput.value || 1));
  });

  els.duaSelect.addEventListener('change', () => {
    const duaId = String(els.duaSelect.value || currentState.dua.duaId || '').toLowerCase();
    const lineIndex = syncDuaLineBounds(duaId, 1);
    sendSetDua(duaId, lineIndex);
  });

  els.lineJumpBtn.addEventListener('click', () => {
    const duaId = String(els.duaSelect.value || currentState.dua.duaId || '').toLowerCase();
    const lineIndex = clampLine(duaId, Number(els.lineInput.value || 1));
    sendSetDua(duaId, lineIndex);
  });

  els.lineInput.addEventListener('change', () => {
    const duaId = String(els.duaSelect.value || currentState.dua.duaId || '').toLowerCase();
    syncDuaLineBounds(duaId, Number(els.lineInput.value || 1));
  });

  els.prevBtn.addEventListener('click', () => sendStep('prev'));
  els.nextBtn.addEventListener('click', () => sendStep('next'));
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
