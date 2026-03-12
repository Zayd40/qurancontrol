const els = {
  brandLogo: document.getElementById('brandLogo'),
  brandText: document.getElementById('brandText'),
  clock: document.getElementById('clock'),
  contentViewport: document.getElementById('contentViewport'),
  contentBody: document.querySelector('.content-body'),
  contentStack: document.getElementById('contentStack'),
  readingContent: document.getElementById('readingContent'),
  qrOverlay: document.getElementById('qrOverlay'),
  qrImage: document.getElementById('qrImage'),
  qrUrl: document.getElementById('qrUrl'),
  fields: {
    title: document.getElementById('slideTitle'),
    lineNumber: document.getElementById('slideLineNumber'),
    instruction: document.getElementById('slideInstruction'),
    repeat: document.getElementById('slideRepeat'),
    reference: document.getElementById('slideReference'),
    arabic: document.getElementById('slideArabic'),
    transliteration: document.getElementById('slideTransliteration'),
    english: document.getElementById('slideEnglish'),
    note: document.getElementById('slideNote')
  }
};

let ws = null;
let reconnectTimer = null;
let controllerConnected = false;
let currentContentKey = '';
let fadeOutTimer = null;
let fadeInTimer = null;

const FADE_OUT_MS = 90;
const FADE_IN_MS = 110;

function debounce(fn, waitMs) {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), waitMs);
  };
}

function setClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  els.clock.textContent = `${hours}:${minutes}`;
}

function applyBrandConfig(config) {
  if (!config) {
    return;
  }

  els.brandText.textContent = config.brandText || 'Al Zahraa Centre';
  document.documentElement.style.setProperty('--accent', config.accentColor || '#718272');
  document.documentElement.style.setProperty('--safe-margin', config.safeMargin || '4vw');

  if (config.logoPath) {
    els.brandLogo.src = config.logoPath;
    els.brandLogo.classList.remove('hidden');
  } else {
    els.brandLogo.classList.add('hidden');
    els.brandLogo.removeAttribute('src');
  }
}

function fitsContent() {
  return (
    els.contentStack.scrollHeight <= els.contentBody.clientHeight + 1 &&
    els.contentStack.scrollWidth <= els.contentBody.clientWidth + 1
  );
}

function fitContent() {
  if (!els.contentBody.clientHeight || !els.contentBody.clientWidth) {
    return;
  }

  let low = 0.8;
  let high = 4.4;
  let best = low;

  for (let index = 0; index < 22; index += 1) {
    const mid = (low + high) / 2;
    els.contentStack.style.setProperty('--content-scale', mid.toFixed(3));

    if (fitsContent()) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  els.contentStack.style.setProperty('--content-scale', best.toFixed(3));
}

const debouncedFitContent = debounce(() => {
  window.requestAnimationFrame(() => fitContent());
}, 80);

function setFieldText(element, value) {
  const text = String(value || '').trim();
  const previous = element.dataset.renderedValue || '';

  if (previous !== text) {
    element.textContent = text;
    element.dataset.renderedValue = text;
  }

  element.classList.toggle('hidden', text.length === 0);
}

function getContentKey(content) {
  if (!content) {
    return '';
  }

  if (content.mode === 'quran' && content.quran) {
    return `quran:${content.quran.surahNumber}:${content.quran.ayahNumber}:${content.blanked ? 1 : 0}`;
  }

  if (content.mode === 'dua' && content.dua) {
    return `dua:${content.dua.duaId}:${content.dua.lineIndex}:${content.blanked ? 1 : 0}`;
  }

  if (content.mode === 'guided_event' && content.guidedEvent) {
    return `guided:${content.guidedEvent.eventId}:${content.guidedEvent.sectionIndex}:${content.guidedEvent.slideIndex}:${content.blanked ? 1 : 0}`;
  }

  return `${content.mode || 'unknown'}:${content.header || ''}:${content.blanked ? 1 : 0}`;
}

function updateBlankState(blanked) {
  els.contentViewport.classList.toggle('blanked', Boolean(blanked));
}

function clearReadingFadeState() {
  if (fadeOutTimer) {
    window.clearTimeout(fadeOutTimer);
    fadeOutTimer = null;
  }

  if (fadeInTimer) {
    window.clearTimeout(fadeInTimer);
    fadeInTimer = null;
  }

  els.readingContent.classList.remove('is-fading-out', 'is-pre-fade-in', 'is-fading-in');
}

function updateStaticFields(content) {
  setFieldText(els.fields.title, content.displayTitle);
  setFieldText(els.fields.lineNumber, content.lineLabel);
  setFieldText(els.fields.instruction, content.instruction);
  setFieldText(els.fields.repeat, content.repeat);
  setFieldText(els.fields.reference, content.reference);
  updateBlankState(content.blanked);
}

function updateReadingFields(content) {
  setFieldText(els.fields.arabic, content.arabic);
  setFieldText(els.fields.transliteration, content.transliteration);
  setFieldText(els.fields.english, content.english);
  setFieldText(els.fields.note, content.note);
  debouncedFitContent();
}

function fadeReadingContent(content) {
  clearReadingFadeState();
  els.readingContent.classList.add('is-fading-out');

  fadeOutTimer = window.setTimeout(() => {
    fadeOutTimer = null;
    els.readingContent.classList.remove('is-fading-out');
    els.readingContent.classList.add('is-pre-fade-in');
    updateReadingFields(content);

    window.requestAnimationFrame(() => {
      els.readingContent.classList.remove('is-pre-fade-in');
      els.readingContent.classList.add('is-fading-in');

      fadeInTimer = window.setTimeout(() => {
        fadeInTimer = null;
        els.readingContent.classList.remove('is-fading-in');
      }, FADE_IN_MS);
    });
  }, FADE_OUT_MS);
}

function updateContentFields(content, animateDynamic = true) {
  updateStaticFields(content);

  if (!animateDynamic || content.blanked) {
    clearReadingFadeState();
    updateReadingFields(content);
    return;
  }

  fadeReadingContent(content);
}

function renderContent(content, animate = true) {
  if (!content) {
    return;
  }

  const nextKey = getContentKey(content);
  if (nextKey === currentContentKey && !content.forceRefresh) {
    return;
  }

  currentContentKey = nextKey;
  updateContentFields(content, animate);
}

function setConnectionState(isConnected) {
  controllerConnected = Boolean(isConnected);
  const hasQr = Boolean(els.qrImage.getAttribute('src'));
  els.qrOverlay.classList.toggle('hidden', controllerConnected || !hasQr);
}

function applyBootstrap(payload) {
  applyBrandConfig(payload.config);

  if (payload.connection?.qrCodeDataUrl) {
    els.qrImage.src = payload.connection.qrCodeDataUrl;
  }

  els.qrUrl.textContent = payload.connection?.controlUrl || '';
  renderContent(payload.content, false);
  setConnectionState(payload.connection?.controllerConnected);
}

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
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
    renderContent(message.content, true);
    return;
  }

  if (message.type === 'controller_status') {
    setConnectionState(message.controllerConnected);
  }
}

function connectSocket() {
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'display' }));
  });

  ws.addEventListener('message', (event) => {
    try {
      handleSocketMessage(JSON.parse(event.data));
    } catch (_error) {
      // ignore malformed messages
    }
  });

  ws.addEventListener('close', () => {
    setConnectionState(false);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

async function init() {
  setClock();
  window.setInterval(setClock, 1000);

  try {
    const response = await fetch('/api/bootstrap?role=display', { cache: 'no-store' });
    if (response.ok) {
      applyBootstrap(await response.json());
    }
  } catch (_error) {
    // websocket bootstrap will recover
  }

  const resizeObserver = new ResizeObserver(() => debouncedFitContent());
  resizeObserver.observe(els.contentViewport);
  resizeObserver.observe(els.contentBody);
  window.addEventListener('resize', debouncedFitContent);

  connectSocket();
  debouncedFitContent();
}

init();
