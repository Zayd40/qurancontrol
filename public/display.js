const els = {
  brandLogo: document.getElementById('brandLogo'),
  brandText: document.getElementById('brandText'),
  clock: document.getElementById('clock'),
  contentViewport: document.getElementById('contentViewport'),
  contentStack: document.getElementById('contentStack'),
  qrOverlay: document.getElementById('qrOverlay'),
  qrImage: document.getElementById('qrImage'),
  qrUrl: document.getElementById('qrUrl'),
  fields: {
    title: document.getElementById('slideTitle'),
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
    els.contentStack.scrollHeight <= els.contentViewport.clientHeight + 1 &&
    els.contentStack.scrollWidth <= els.contentViewport.clientWidth + 1
  );
}

function fitContent() {
  if (!els.contentViewport.clientHeight || !els.contentViewport.clientWidth) {
    return;
  }

  let low = 0.68;
  let high = 2.35;
  let best = low;

  for (let index = 0; index < 20; index += 1) {
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
}, 120);

function animateFieldChange(element) {
  if (typeof element.animate !== 'function') {
    return;
  }

  element.animate(
    [
      { opacity: 0.35, transform: 'translateY(0.35rem)' },
      { opacity: 1, transform: 'translateY(0)' }
    ],
    {
      duration: 170,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    }
  );
}

function setFieldText(element, value, animate = false) {
  const text = String(value || '').trim();
  const previous = element.dataset.renderedValue || '';

  if (previous !== text) {
    element.textContent = text;
    element.dataset.renderedValue = text;
    if (animate && text.length > 0) {
      animateFieldChange(element);
    }
  }

  element.classList.toggle('hidden', text.length === 0);
}

function getContentKey(content) {
  if (!content) {
    return '';
  }

  if (content.mode === 'quran' && content.quran) {
    return `quran:${content.quran.surahNumber}:${content.quran.ayahNumber}`;
  }

  if (content.mode === 'dua' && content.dua) {
    return `dua:${content.dua.duaId}:${content.dua.lineIndex}`;
  }

  if (content.mode === 'guided_event' && content.guidedEvent) {
    return `guided:${content.guidedEvent.eventId}:${content.guidedEvent.sectionIndex}:${content.guidedEvent.slideIndex}`;
  }

  return `${content.mode || 'unknown'}:${content.header || ''}`;
}

function buildContextText(content) {
  const header = String(content?.header || '').trim();
  const title = String(content?.title || '').trim();

  if (content?.mode === 'quran' || content?.mode === 'dua') {
    return header || title;
  }

  if (content?.mode === 'guided_event') {
    if (!title) {
      return header;
    }

    if (!header) {
      return title;
    }

    const normalizedHeader = header.toLowerCase();
    const normalizedTitle = title.toLowerCase();
    if (normalizedHeader.includes(normalizedTitle) || normalizedTitle.includes(normalizedHeader)) {
      return title.length <= header.length ? title : header;
    }

    return title;
  }

  return title || header;
}

function buildReferenceText(content) {
  if (!content || content.mode === 'quran' || content.mode === 'dua') {
    return '';
  }

  return String(content.reference || '').trim();
}

function updateContentFields(content, animateDynamic = true) {
  setFieldText(els.fields.title, buildContextText(content), false);
  setFieldText(els.fields.instruction, content.instruction, false);
  setFieldText(els.fields.repeat, content.repeat, false);
  setFieldText(els.fields.reference, buildReferenceText(content), false);
  setFieldText(els.fields.arabic, content.arabic, animateDynamic);
  setFieldText(els.fields.transliteration, content.transliteration, animateDynamic);
  setFieldText(els.fields.english, content.english, animateDynamic);
  setFieldText(els.fields.note, content.note, false);
  debouncedFitContent();
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
  window.addEventListener('resize', debouncedFitContent);

  connectSocket();
  debouncedFitContent();
}

init();
