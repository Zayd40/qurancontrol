const els = {
  brandText: document.getElementById('brandText'),
  statusText: document.getElementById('statusText'),
  sessionSummary: document.getElementById('sessionSummary'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  eventSelect: document.getElementById('eventSelect'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  jumpLabel: document.getElementById('jumpLabel'),
  jumpInput: document.getElementById('jumpInput'),
  jumpBtn: document.getElementById('jumpBtn'),
  jumpHint: document.getElementById('jumpHint'),
  displayUrl: document.getElementById('displayUrl'),
  controllerUrl: document.getElementById('controllerUrl'),
  restartBtn: document.getElementById('restartBtn'),
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
  events: []
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

function send(payload) {
  if (!controlsEnabled()) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function populateEventSelect() {
  const selectedEventId = currentSession?.selectedEventId || catalog.events[0]?.id || '';
  els.eventSelect.innerHTML = '';

  catalog.events.forEach((event) => {
    const option = document.createElement('option');
    option.value = event.id;
    option.textContent = event.title;
    els.eventSelect.appendChild(option);
  });

  if (selectedEventId) {
    els.eventSelect.value = selectedEventId;
  }
}

function renderLogs(entries) {
  const items = Array.isArray(entries) && entries.length > 0 ? entries : ['No controller activity yet.'];
  els.logsList.innerHTML = '';

  items.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    els.logsList.appendChild(item);
  });
}

function renderModeButtons() {
  const sessionType = currentSession?.sessionType || 'quran';
  els.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === sessionType);
    button.disabled = !controlsEnabled();
  });
}

function getJumpConfig() {
  const sessionType = currentSession?.sessionType || 'quran';

  if (sessionType === 'dua') {
    const totalLines = Number(currentSession?.lockedDua?.totalLines) || 1;
    return {
      label: 'Jump to line',
      min: 1,
      max: totalLines,
      value: Number(currentSession?.dua?.lineIndex) || 1,
      hint: `Line ${Number(currentSession?.dua?.lineIndex) || 1} / ${totalLines}`
    };
  }

  if (sessionType === 'guided_event') {
    const totalSections = Number(currentSession?.lockedEvent?.sections?.length) || 1;
    return {
      label: 'Jump to section',
      min: 1,
      max: totalSections,
      value: (Number(currentSession?.guidedEvent?.sectionIndex) || 0) + 1,
      hint: `Section ${(Number(currentSession?.guidedEvent?.sectionIndex) || 0) + 1} / ${totalSections}`
    };
  }

  const surahNumber = Number(currentSession?.quran?.surahNumber) || 1;
  const maxAyah = surahByNumber.get(surahNumber)?.ayahCount || 1;
  return {
    label: 'Jump to ayah',
    min: 1,
    max: maxAyah,
    value: Number(currentSession?.quran?.ayahNumber) || 1,
    hint: `Surah ${surahNumber} - Ayah ${Number(currentSession?.quran?.ayahNumber) || 1} / ${maxAyah}`
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
  els.controllerUrl.textContent = systemInfo?.controllerUrl || '';
}

function renderStatus(messageOverride) {
  const enabled = controlsEnabled();
  const count = controllerStatus.controllerCount || 0;
  const noun = count === 1 ? 'controller' : 'controllers';

  if (messageOverride) {
    els.statusText.textContent = messageOverride;
  } else if (!enabled) {
    els.statusText.textContent = 'Disconnected. Reconnecting...';
  } else {
    els.statusText.textContent = `${count} ${noun} connected. Admin controls are live.`;
  }

  els.eventSelect.disabled = !enabled || (currentSession?.sessionType || 'quran') !== 'guided_event';
  els.prevBtn.disabled = !enabled;
  els.nextBtn.disabled = !enabled;
  els.jumpInput.disabled = !enabled;
  els.jumpBtn.disabled = !enabled;
  els.restartBtn.disabled = !enabled;
  els.resetBtn.disabled = !enabled;
  els.blankBtn.disabled = !enabled;
  renderModeButtons();
}

function renderSession() {
  if (!currentSession || !currentContent) {
    return;
  }

  const selectedContent = currentSession.selectedContent || currentContent.header || 'Presenter';
  const blankState = currentSession.blanked ? 'Display is blanked.' : 'Display is live.';
  els.sessionSummary.textContent = `${selectedContent} ${blankState}`;
  els.blankBtn.textContent = currentSession.blanked ? 'Restore display screen' : 'Blank display screen';
  populateEventSelect();
  renderJumpControls();
  renderModeButtons();
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
  catalog = message.catalog || catalog;
  controllerStatus = {
    connected: Boolean(message.connection?.controllerConnected),
    controllerCount: Number(message.connection?.controllerCount) || 0
  };

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

  if ((currentSession?.sessionType || 'quran') === 'guided_event') {
    send({ type: 'jump_section', sectionIndex: value - 1 });
    return;
  }

  send({ type: 'jump_ayah', ayahNumber: value });
}

function clampJumpInputValue() {
  const config = getJumpConfig();
  const value = Math.max(config.min, Math.min(config.max, Number(els.jumpInput.value || config.min)));
  els.jumpInput.value = String(value);
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
    renderStatus('Disconnected. Reconnecting...');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function attachEvents() {
  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      send({
        type: 'admin_set_mode',
        sessionType: button.dataset.mode,
        selectedEventId: els.eventSelect.value
      });
    });
  });

  els.eventSelect.addEventListener('change', () => {
    send({
      type: 'admin_select_event',
      selectedEventId: els.eventSelect.value
    });
  });

  els.prevBtn.addEventListener('click', () => send({ type: 'step', direction: 'prev' }));
  els.nextBtn.addEventListener('click', () => send({ type: 'step', direction: 'next' }));
  els.jumpBtn.addEventListener('click', handleJump);
  els.jumpInput.addEventListener('change', clampJumpInputValue);
  els.restartBtn.addEventListener('click', () => send({ type: 'admin_restart_session' }));
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
