const els = {
  brandText: document.getElementById('brandText'),
  modeLabel: document.getElementById('modeLabel'),
  currentRef: document.getElementById('currentRef'),
  lockMessage: document.getElementById('lockMessage'),
  lockedTitle: document.getElementById('lockedTitle'),
  lockedDescription: document.getElementById('lockedDescription'),
  quranPanel: document.getElementById('quranPanel'),
  surahSelect: document.getElementById('surahSelect'),
  ayahInput: document.getElementById('ayahInput'),
  ayahJumpBtn: document.getElementById('ayahJumpBtn'),
  ayahHint: document.getElementById('ayahHint'),
  duaPanel: document.getElementById('duaPanel'),
  duaTitle: document.getElementById('duaTitle'),
  lineInput: document.getElementById('lineInput'),
  lineJumpBtn: document.getElementById('lineJumpBtn'),
  lineHint: document.getElementById('lineHint'),
  guidedPanel: document.getElementById('guidedPanel'),
  eventTitle: document.getElementById('eventTitle'),
  sectionStatus: document.getElementById('sectionStatus'),
  sectionButtons: document.getElementById('sectionButtons'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
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

function renderGuidedSections() {
  els.sectionButtons.innerHTML = '';

  const sections = currentSession?.lockedEvent?.sections || [];
  const currentIndex = Number(currentSession?.guidedEvent?.sectionIndex) || 0;

  sections.forEach((section) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-btn';
    button.textContent = `${section.index + 1}. ${section.title}`;
    button.disabled = !controlsEnabled();
    button.classList.toggle('active', section.index === currentIndex);
    button.addEventListener('click', () => send({ type: 'jump_section', sectionIndex: section.index }));
    els.sectionButtons.appendChild(button);
  });
}

function renderSessionPanels() {
  const sessionType = currentSession?.sessionType || 'quran';

  els.quranPanel.classList.toggle('hidden', sessionType !== 'quran');
  els.duaPanel.classList.toggle('hidden', sessionType !== 'dua');
  els.guidedPanel.classList.toggle('hidden', sessionType !== 'guided_event');

  if (sessionType === 'quran') {
    els.prevBtn.textContent = 'Previous Ayah';
    els.nextBtn.textContent = 'Next Ayah';
    els.lockedTitle.textContent = 'Quran Mode';
    els.lockedDescription.textContent =
      'This page can choose the surah, jump to an ayah, and move to the previous or next ayah.';
    return;
  }

  if (sessionType === 'dua') {
    els.prevBtn.textContent = 'Previous Line';
    els.nextBtn.textContent = 'Next Line';
    els.lockedTitle.textContent = currentSession?.lockedDua?.title || 'Dua Mode';
    els.lockedDescription.textContent =
      'This page can move through the selected dua line by line and jump directly to a line.';
    return;
  }

  els.prevBtn.textContent = 'Previous Slide';
  els.nextBtn.textContent = 'Next Slide';
  els.lockedTitle.textContent = currentSession?.lockedEvent?.title || 'Guided Event Mode';
  els.lockedDescription.textContent =
    'This page can move through slides and jump to a section in the current guided event.';
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

  if (currentSession.sessionType === 'quran') {
    els.surahSelect.value = String(currentSession.quran?.surahNumber || 1);
    syncAyahInput(currentSession.quran?.surahNumber || 1, currentSession.quran?.ayahNumber || 1);
  }

  if (currentSession.sessionType === 'dua') {
    const lockedDua = currentSession.lockedDua;
    els.duaTitle.textContent = lockedDua?.title || 'Dua';
    syncLineInput(currentSession.dua?.lineIndex || 1, lockedDua?.totalLines || 1);
  }

  if (currentSession.sessionType === 'guided_event') {
    const lockedEvent = currentSession.lockedEvent;
    const guidedEvent = currentSession.guidedEvent || { sectionIndex: 0, slideIndex: 0 };
    const currentSection = lockedEvent?.sections?.[guidedEvent.sectionIndex];

    els.eventTitle.textContent = lockedEvent?.title || 'Guided Event';
    els.sectionStatus.textContent = `${currentSection?.title || 'Section'} - Slide ${(guidedEvent.slideIndex || 0) + 1} of ${currentContent?.guidedEvent?.totalSlides || currentSection?.totalSlides || 1}`;
    renderGuidedSections();
  }
}

function updateUiStatus() {
  const enabled = controlsEnabled();
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

  const sectionButtons = els.sectionButtons.querySelectorAll('button');
  sectionButtons.forEach((button) => {
    button.disabled = !enabled;
  });

  if (!enabled) {
    els.lockMessage.textContent = 'Disconnected. Reconnecting...';
    return;
  }

  const count = controllerStatus.controllerCount || 0;
  const noun = count === 1 ? 'controller' : 'controllers';
  els.lockMessage.textContent = `${count} ${noun} connected. Any connected controller can navigate.`;
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

function send(payload) {
  if (!controlsEnabled()) {
    return;
  }

  ws.send(JSON.stringify(payload));
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
    els.lockMessage.textContent = message.message || 'Action rejected by server.';
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

  els.lineInput.addEventListener('change', () => {
    const max = Number(els.lineInput.max || 1);
    syncLineInput(Number(els.lineInput.value || 1), max);
  });

  els.lineJumpBtn.addEventListener('click', () => {
    const max = Number(els.lineInput.max || 1);
    const lineIndex = Math.max(1, Math.min(max, Number(els.lineInput.value || 1)));
    send({ type: 'jump_line', lineIndex });
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
