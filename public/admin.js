const els = {
  brandText: document.getElementById('brandText'),
  statusText: document.getElementById('statusText'),
  modeStatus: document.getElementById('modeStatus'),
  currentStatus: document.getElementById('currentStatus'),
  displayStatus: document.getElementById('displayStatus'),
  controllerStatus: document.getElementById('controllerStatus'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  modeNotice: document.getElementById('modeNotice'),
  quranConfig: document.getElementById('quranConfig'),
  adminSurahSelect: document.getElementById('adminSurahSelect'),
  duaConfig: document.getElementById('duaConfig'),
  duaSelect: document.getElementById('duaSelect'),
  openDuaBtn: document.getElementById('openDuaBtn'),
  duaNotice: document.getElementById('duaNotice'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  jumpLabel: document.getElementById('jumpLabel'),
  jumpInput: document.getElementById('jumpInput'),
  jumpBtn: document.getElementById('jumpBtn'),
  jumpHint: document.getElementById('jumpHint'),
  controlsNotice: document.getElementById('controlsNotice'),
  displayUrl: document.getElementById('displayUrl'),
  adminUrl: document.getElementById('adminUrl'),
  controllerUrl: document.getElementById('controllerUrl'),
  qrImage: document.getElementById('qrImage'),
  resetBtn: document.getElementById('resetBtn'),
  blankBtn: document.getElementById('blankBtn'),
  logsList: document.getElementById('logsList')
};

let ws = null;
let reconnectTimer = null;
let surahs = [];
const surahByNumber = new Map();

let currentSession = null;
let currentContent = null;
let systemInfo = null;
let catalog = {
  duas: []
};
let controllerStatus = {
  connected: false,
  controllerCount: 0
};

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function controlsEnabled() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function hasDuas() {
  return catalog.duas.length > 0;
}

function send(payload) {
  if (controlsEnabled()) {
    ws.send(JSON.stringify(payload));
  }
}

function populateDuaSelect() {
  const selectedDuaId = currentSession?.selectedDuaId || catalog.duas[0]?.id || '';
  els.duaSelect.innerHTML = '';

  if (!hasDuas()) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No duas available';
    els.duaSelect.appendChild(option);
    return;
  }

  catalog.duas.forEach((dua) => {
    const option = document.createElement('option');
    option.value = dua.id;
    option.textContent = dua.title;
    els.duaSelect.appendChild(option);
  });

  if (selectedDuaId) {
    els.duaSelect.value = selectedDuaId;
  }
}

function populateSurahSelect() {
  const selected = String(currentSession?.quran?.surahNumber || 1);
  els.adminSurahSelect.innerHTML = '';

  surahs.forEach((surah) => {
    const option = document.createElement('option');
    option.value = String(surah.number);
    option.textContent = `${surah.number}. ${surah.nameEnglish}`;
    els.adminSurahSelect.appendChild(option);
  });

  els.adminSurahSelect.value = selected;
}

function renderLogs(entries) {
  const items = Array.isArray(entries) && entries.length > 0 ? entries : ['No controller activity yet.'];
  els.logsList.innerHTML = '';

  items.slice(0, 8).forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    els.logsList.appendChild(item);
  });
}

function renderModeButtons() {
  const sessionType = currentSession?.sessionType || 'quran';
  els.modeButtons.forEach((button) => {
    const isUnavailableDua = button.dataset.mode === 'dua' && !hasDuas();
    button.classList.toggle('active', button.dataset.mode === sessionType);
    button.disabled = !controlsEnabled() || isUnavailableDua;
    button.title = isUnavailableDua ? 'Add a dua JSON file in data/duas to enable Dua mode.' : '';
  });
}

function getJumpConfig() {
  const sessionType = currentSession?.sessionType || 'quran';

  if (sessionType === 'dua') {
    const totalLines = Number(currentSession?.lockedDua?.totalLines) || 1;
    return {
      label: 'Line',
      min: 1,
      max: totalLines,
      value: Number(currentSession?.dua?.lineIndex) || 1,
      hint: `Line ${Number(currentSession?.dua?.lineIndex) || 1} of ${totalLines}`
    };
  }

  const surahNumber = Number(currentSession?.quran?.surahNumber) || 1;
  const maxAyah = surahByNumber.get(surahNumber)?.ayahCount || 1;
  return {
    label: 'Ayah',
    min: 1,
    max: maxAyah,
    value: Number(currentSession?.quran?.ayahNumber) || 1,
    hint: `Surah ${surahNumber}, ayah ${Number(currentSession?.quran?.ayahNumber) || 1} of ${maxAyah}`
  };
}

function renderJumpControls() {
  const config = getJumpConfig();
  els.jumpLabel.textContent = config.label;
  els.jumpInput.min = String(config.min);
  els.jumpInput.max = String(config.max);
  els.jumpInput.value = String(Math.max(config.min, Math.min(config.max, config.value)));
  els.jumpHint.textContent = config.hint;
}

function renderSystemInfo() {
  els.displayUrl.textContent = systemInfo?.displayUrl || '';
  els.adminUrl.textContent = systemInfo?.adminUrl || window.location.href;
  els.controllerUrl.textContent = systemInfo?.controllerUrl || '';
}

function renderStatus(messageOverride) {
  const enabled = controlsEnabled();
  const sessionType = currentSession?.sessionType || 'quran';
  const duaAvailable = hasDuas();
  const count = controllerStatus.controllerCount || 0;
  const noun = count === 1 ? 'controller' : 'controllers';

  els.statusText.textContent = messageOverride || (enabled ? 'Online' : 'Reconnecting');
  els.statusText.classList.toggle('offline', !enabled);
  els.modeStatus.textContent = sessionType === 'dua' ? 'Dua' : 'Quran';
  els.currentStatus.textContent = currentSession?.selectedContent || currentContent?.header || 'Waiting';
  els.displayStatus.textContent = currentSession?.blanked ? 'Blanked' : 'Live';
  els.controllerStatus.textContent = enabled ? `${count} ${noun}` : 'Offline';

  els.quranConfig.classList.toggle('hidden', sessionType !== 'quran');
  els.duaConfig.classList.toggle('hidden', sessionType !== 'dua');
  els.adminSurahSelect.disabled = !enabled;
  els.duaSelect.disabled = !enabled || !duaAvailable;
  els.openDuaBtn.disabled = !enabled || !duaAvailable || !els.duaSelect.value;
  els.prevBtn.disabled = !enabled;
  els.nextBtn.disabled = !enabled;
  els.jumpInput.disabled = !enabled;
  els.jumpBtn.disabled = !enabled;
  els.resetBtn.disabled = !enabled;
  els.blankBtn.disabled = !enabled;
  els.modeNotice.textContent = !enabled
    ? 'Controls are unavailable while the admin panel reconnects.'
    : !duaAvailable
      ? 'Dua mode is unavailable because no dua JSON files were loaded.'
      : '';
  els.duaNotice.textContent = duaAvailable
    ? ''
    : 'Add a valid JSON file to data/duas, then restart the server.';
  els.controlsNotice.textContent = enabled ? '' : 'Navigation is paused until the WebSocket reconnects.';
  renderModeButtons();
}

function renderSession() {
  if (!currentSession || !currentContent) {
    return;
  }

  els.blankBtn.textContent = currentSession.blanked ? 'Restore display' : 'Blank display';
  populateDuaSelect();
  populateSurahSelect();
  renderJumpControls();
  renderStatus();
}

function applyBootstrap(message) {
  if (message.config?.brandText) {
    els.brandText.textContent = message.config.brandText;
  }

  if (message.config?.accentColor) {
    document.documentElement.style.setProperty('--accent', message.config.accentColor);
  }

  if (Array.isArray(message.surahs)) {
    surahs = message.surahs.map((surah) => ({
      number: Number(surah.number),
      nameEnglish: String(surah.nameEnglish || `Surah ${surah.number}`),
      ayahCount: Number(surah.ayahCount) || 1
    }));

    surahByNumber.clear();
    surahs.forEach((surah) => {
      surahByNumber.set(surah.number, surah);
    });
  }

  currentSession = message.session || currentSession;
  currentContent = message.content || currentContent;
  systemInfo = message.system || systemInfo;
  catalog = {
    duas: Array.isArray(message.catalog?.duas) ? message.catalog.duas : []
  };
  controllerStatus = {
    connected: Boolean(message.connection?.controllerConnected),
    controllerCount: Number(message.connection?.controllerCount) || 0
  };

  if (message.connection?.qrCodeDataUrl) {
    els.qrImage.src = message.connection.qrCodeDataUrl;
    els.qrImage.classList.remove('hidden');
  }

  renderSystemInfo();
  renderLogs(message.activity?.recentActivity || []);
  renderSession();
}

function applyStateUpdate(message) {
  currentSession = message.session || currentSession;
  currentContent = message.content || currentContent;
  renderSession();
}

function handleJump() {
  const config = getJumpConfig();
  const value = Math.max(config.min, Math.min(config.max, Number(els.jumpInput.value || config.min)));
  els.jumpInput.value = String(value);

  if ((currentSession?.sessionType || 'quran') === 'dua') {
    send({ type: 'jump_line', lineIndex: value });
    return;
  }

  send({ type: 'jump_ayah', ayahNumber: value });
}

function clampJumpInputValue() {
  const config = getJumpConfig();
  const value = Math.max(config.min, Math.min(config.max, Number(els.jumpInput.value || config.min)));
  els.jumpInput.value = String(value);
}

function openSelectedDua() {
  if (!hasDuas() || !els.duaSelect.value) {
    renderStatus('No duas available');
    return;
  }

  send({
    type: 'admin_set_mode',
    sessionType: 'dua',
    selectedDuaId: els.duaSelect.value
  });
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

function handleSocketMessage(message) {
  if (message.type === 'bootstrap') {
    applyBootstrap(message);
    return;
  }

  if (message.type === 'state_update') {
    applyStateUpdate(message);
    return;
  }

  if (message.type === 'activity_update') {
    renderLogs(message.recentActivity || []);
    return;
  }

  if (message.type === 'controller_status') {
    controllerStatus = {
      connected: Boolean(message.controllerConnected),
      controllerCount: Number(message.controllerCount) || 0
    };
    renderStatus();
    return;
  }

  if (message.type === 'error') {
    renderStatus(message.message || 'Action rejected by server.');
  }
}

function connectSocket() {
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'admin' }));
    renderStatus();
  });

  ws.addEventListener('message', (event) => {
    try {
      handleSocketMessage(JSON.parse(event.data));
    } catch (_error) {
      // ignore malformed messages
    }
  });

  ws.addEventListener('close', () => {
    renderStatus('Reconnecting');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function attachEvents() {
  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.mode === 'dua' && !hasDuas()) {
        renderStatus('No duas available');
        return;
      }

      send({
        type: 'admin_set_mode',
        sessionType: button.dataset.mode,
        selectedDuaId: els.duaSelect.value
      });
    });
  });

  els.openDuaBtn.addEventListener('click', openSelectedDua);
  els.duaSelect.addEventListener('change', openSelectedDua);
  els.adminSurahSelect.addEventListener('change', () => {
    send({
      type: 'select_surah',
      surahNumber: Number(els.adminSurahSelect.value || 1)
    });
  });
  els.prevBtn.addEventListener('click', () => send({ type: 'step', direction: 'prev' }));
  els.nextBtn.addEventListener('click', () => send({ type: 'step', direction: 'next' }));
  els.jumpBtn.addEventListener('click', handleJump);
  els.jumpInput.addEventListener('change', clampJumpInputValue);
  els.resetBtn.addEventListener('click', () => send({ type: 'admin_reset_position' }));
  els.blankBtn.addEventListener('click', () => send({ type: 'admin_toggle_blank' }));
}

async function init() {
  attachEvents();
  renderStatus();

  try {
    const response = await fetch('/api/bootstrap?role=admin', { cache: 'no-store' });
    if (response.ok) {
      applyBootstrap(await response.json());
    }
  } catch (_error) {
    // websocket bootstrap will recover
  }

  connectSocket();
}

init();
