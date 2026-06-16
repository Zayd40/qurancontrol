const els = {
  brandText: document.getElementById('brandText'),
  modeLabel: document.getElementById('modeLabel'),
  currentRef: document.getElementById('currentRef'),
  lockMessage: document.getElementById('lockMessage'),
  controlNotice: document.getElementById('controlNotice'),
  modeButtons: [...document.querySelectorAll('.mode-btn')],
  quranPanel: document.getElementById('quranPanel'),
  surahSelect: document.getElementById('surahSelect'),
  ayahInput: document.getElementById('ayahInput'),
  ayahJumpBtn: document.getElementById('ayahJumpBtn'),
  ayahHint: document.getElementById('ayahHint'),
  duaPanel: document.getElementById('duaPanel'),
  duaSelect: document.getElementById('duaSelect'),
  openDuaBtn: document.getElementById('openDuaBtn'),
  duaNotice: document.getElementById('duaNotice'),
  lineInput: document.getElementById('lineInput'),
  lineJumpBtn: document.getElementById('lineJumpBtn'),
  lineHint: document.getElementById('lineHint'),
  scrollBackBtn: document.getElementById('scrollBackBtn'),
  scrollForwardBtn: document.getElementById('scrollForwardBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  previewPanel: document.querySelector('.preview-panel'),
  preview: {
    title: document.getElementById('previewTitle'),
    instruction: document.getElementById('previewInstruction'),
    repeat: document.getElementById('previewRepeat'),
    reference: document.getElementById('previewReference'),
    arabic: document.getElementById('previewArabic'),
    transliteration: document.getElementById('previewTransliteration'),
    english: document.getElementById('previewEnglish'),
    note: document.getElementById('previewNote')
  }
};

let ws = null;
let reconnectTimer = null;
let surahs = [];
const surahByNumber = new Map();

let currentSession = null;
let currentContent = null;
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

function setFieldText(element, value) {
  const text = String(value || '').trim();
  element.textContent = text;
  element.classList.toggle('hidden', text.length === 0);
}

function getAyahMax(surahNumber) {
  return surahByNumber.get(Number(surahNumber))?.ayahCount || 1;
}

function clampAyah(surahNumber, ayahNumber) {
  const max = getAyahMax(surahNumber);
  const numericValue = Number(ayahNumber) || 1;
  return Math.max(1, Math.min(max, numericValue));
}

function syncAyahInput(surahNumber, ayahNumber) {
  const max = getAyahMax(surahNumber);
  const clamped = clampAyah(surahNumber, ayahNumber);
  els.ayahInput.max = String(max);
  els.ayahInput.value = String(clamped);
  els.ayahHint.textContent = `Max ayah: ${max}`;
  return clamped;
}

function syncLineInput(lineIndex, totalLines) {
  const max = Math.max(1, Number(totalLines) || 1);
  const clamped = Math.max(1, Math.min(max, Number(lineIndex) || 1));
  els.lineInput.max = String(max);
  els.lineInput.value = String(clamped);
  els.lineHint.textContent = `Line ${clamped} / ${max}`;
  return clamped;
}

function populateSurahSelect() {
  const selected = String(currentSession?.quran?.surahNumber || 1);
  els.surahSelect.innerHTML = '';

  surahs.forEach((surah) => {
    const option = document.createElement('option');
    option.value = String(surah.number);
    option.textContent = `${surah.number}. ${surah.nameEnglish}`;
    els.surahSelect.appendChild(option);
  });

  els.surahSelect.value = selected;
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

function renderModeButtons() {
  const sessionType = currentSession?.sessionType || 'quran';
  els.modeButtons.forEach((button) => {
    const isUnavailableDua = button.dataset.mode === 'dua' && !hasDuas();
    button.classList.toggle('active', button.dataset.mode === sessionType);
    button.disabled = !controlsEnabled() || isUnavailableDua;
    button.title = isUnavailableDua ? 'No duas are loaded on the server.' : '';
  });
}

function renderSessionPanels() {
  const sessionType = currentSession?.sessionType || 'quran';
  els.quranPanel.classList.toggle('hidden', sessionType !== 'quran');
  els.duaPanel.classList.toggle('hidden', sessionType !== 'dua');
  els.prevBtn.textContent = sessionType === 'dua' ? 'Previous line' : 'Previous ayah';
  els.nextBtn.textContent = sessionType === 'dua' ? 'Next line' : 'Next ayah';
}

function renderPreview(content) {
  if (!content) {
    return;
  }

  els.modeLabel.textContent = content.modeLabel || currentSession?.modeLabel || 'Presenter';
  els.currentRef.textContent = content.header || '';
  setFieldText(els.preview.title, content.title);
  setFieldText(els.preview.instruction, content.instruction);
  setFieldText(els.preview.repeat, content.repeat);
  setFieldText(els.preview.reference, content.reference);
  setFieldText(els.preview.arabic, content.arabic);
  setFieldText(els.preview.transliteration, content.transliteration);
  setFieldText(els.preview.english, content.english);
  setFieldText(els.preview.note, content.note);
}

function renderSessionState() {
  if (!currentSession) {
    return;
  }

  renderSessionPanels();
  renderModeButtons();
  populateDuaSelect();

  if (currentSession.sessionType === 'quran') {
    els.surahSelect.value = String(currentSession.quran?.surahNumber || 1);
    syncAyahInput(currentSession.quran?.surahNumber || 1, currentSession.quran?.ayahNumber || 1);
  }

  if (currentSession.sessionType === 'dua') {
    syncLineInput(currentSession.dua?.lineIndex || 1, currentSession.lockedDua?.totalLines || 1);
  }
}

function updateUiStatus(messageOverride) {
  const enabled = controlsEnabled();
  const duaAvailable = hasDuas();
  const controlElements = [
    els.surahSelect,
    els.ayahInput,
    els.ayahJumpBtn,
    els.lineInput,
    els.lineJumpBtn,
    els.prevBtn,
    els.nextBtn
  ];

  controlElements.forEach((element) => {
    element.disabled = !enabled;
  });

  els.duaSelect.disabled = !enabled || !duaAvailable;
  els.openDuaBtn.disabled = !enabled || !duaAvailable || !els.duaSelect.value;
  els.scrollBackBtn.disabled = false;
  els.scrollForwardBtn.disabled = false;
  renderModeButtons();

  if (!enabled) {
    els.lockMessage.textContent = messageOverride || 'Reconnecting';
    els.lockMessage.classList.add('offline');
    els.controlNotice.textContent =
      'Presentation controls are unavailable while the phone reconnects. Preview scrolling still works.';
    els.duaNotice.textContent = duaAvailable ? '' : 'No duas are loaded. Add one in data/duas and restart.';
    return;
  }

  const count = controllerStatus.controllerCount || 0;
  const noun = count === 1 ? 'controller' : 'controllers';
  els.lockMessage.textContent = messageOverride || `${count} ${noun}`;
  els.lockMessage.classList.remove('offline');
  els.controlNotice.textContent = duaAvailable
    ? ''
    : 'Dua mode is unavailable because no dua JSON files were loaded.';
  els.duaNotice.textContent = duaAvailable ? '' : 'No duas are loaded. Add one in data/duas and restart.';
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

    populateSurahSelect();
  }

  currentSession = message.session || currentSession;
  currentContent = message.content || currentContent;
  catalog = {
    duas: Array.isArray(message.catalog?.duas) ? message.catalog.duas : []
  };
  controllerStatus = {
    connected: Boolean(message.connection?.controllerConnected),
    controllerCount: Number(message.connection?.controllerCount) || 0
  };

  renderSessionState();
  renderPreview(currentContent);
  updateUiStatus();
}

function applyStateUpdate(message) {
  currentSession = message.session || currentSession;
  currentContent = message.content || currentContent;
  renderSessionState();
  renderPreview(currentContent);
  updateUiStatus();
}

function openSelectedDua() {
  if (!hasDuas() || !els.duaSelect.value) {
    updateUiStatus('No duas available');
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

  if (message.type === 'controller_status') {
    controllerStatus = {
      connected: Boolean(message.controllerConnected),
      controllerCount: Number(message.controllerCount) || 0
    };
    updateUiStatus();
    return;
  }

  if (message.type === 'error') {
    updateUiStatus(message.message || 'Action rejected');
  }
}

function connectSocket() {
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'control' }));
    updateUiStatus();
  });

  ws.addEventListener('message', (event) => {
    try {
      handleSocketMessage(JSON.parse(event.data));
    } catch (_error) {
      // ignore malformed messages
    }
  });

  ws.addEventListener('close', () => {
    controllerStatus = {
      connected: false,
      controllerCount: 0
    };
    updateUiStatus();
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
        updateUiStatus('No duas available');
        return;
      }

      send({
        type: 'admin_set_mode',
        sessionType: button.dataset.mode,
        selectedDuaId: els.duaSelect.value
      });
    });
  });

  els.surahSelect.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || 1);
    syncAyahInput(surahNumber, 1);
    send({ type: 'select_surah', surahNumber });
  });

  els.ayahInput.addEventListener('change', () => {
    const surahNumber = Number(els.surahSelect.value || 1);
    syncAyahInput(surahNumber, Number(els.ayahInput.value || 1));
  });

  els.ayahJumpBtn.addEventListener('click', () => {
    const surahNumber = Number(els.surahSelect.value || 1);
    const ayahNumber = clampAyah(surahNumber, Number(els.ayahInput.value || 1));
    send({ type: 'jump_ayah', ayahNumber });
  });

  els.duaSelect.addEventListener('change', openSelectedDua);
  els.openDuaBtn.addEventListener('click', openSelectedDua);

  els.lineInput.addEventListener('change', () => {
    const max = Number(els.lineInput.max || 1);
    syncLineInput(Number(els.lineInput.value || 1), max);
  });

  els.lineJumpBtn.addEventListener('click', () => {
    const max = Number(els.lineInput.max || 1);
    const lineIndex = Math.max(1, Math.min(max, Number(els.lineInput.value || 1)));
    send({ type: 'jump_line', lineIndex });
  });

  els.scrollBackBtn.addEventListener('click', () => {
    els.previewPanel.scrollBy({ top: -160, behavior: 'smooth' });
  });

  els.scrollForwardBtn.addEventListener('click', () => {
    els.previewPanel.scrollBy({ top: 160, behavior: 'smooth' });
  });

  els.prevBtn.addEventListener('click', () => send({ type: 'step', direction: 'prev' }));
  els.nextBtn.addEventListener('click', () => send({ type: 'step', direction: 'next' }));
}

async function init() {
  attachEvents();
  updateUiStatus();

  try {
    const response = await fetch('/api/bootstrap?role=control', { cache: 'no-store' });
    if (response.ok) {
      applyBootstrap(await response.json());
    }
  } catch (_error) {
    // websocket bootstrap will recover
  }

  connectSocket();
}

init();
