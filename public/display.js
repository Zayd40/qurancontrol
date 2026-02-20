const els = {
  brandContainer: document.getElementById('brandContainer'),
  brandLogo: document.getElementById('brandLogo'),
  brandText: document.getElementById('brandText'),
  surahMeta: document.getElementById('surahMeta'),
  clock: document.getElementById('clock'),
  arabicText: document.getElementById('arabicText'),
  translationText: document.getElementById('translationText'),
  transliterationText: document.getElementById('transliterationText'),
  qrOverlay: document.getElementById('qrOverlay'),
  qrImage: document.getElementById('qrImage'),
  connectionLabel: document.getElementById('connectionLabel'),
  screenRoot: document.getElementById('screenRoot')
};

const fitTargets = [els.arabicText, els.translationText, els.transliterationText];

let currentAyahKey = '';
let controllerConnected = false;
let reconnectTimer = null;
let ws = null;

function debounce(fn, waitMs) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), waitMs);
  };
}

function setClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  els.clock.textContent = `${hh}:${mm}`;
}

function applyBrandConfig(config) {
  if (!config) {
    return;
  }

  const brandText = (config.brandText || '').trim() || 'Al Zahraa Centre';
  els.brandText.textContent = brandText;

  if (config.accentColor) {
    document.documentElement.style.setProperty('--accent', config.accentColor);
  }

  if (config.safeMargin) {
    document.documentElement.style.setProperty('--safe-margin', config.safeMargin);
  }

  if ((config.logoPath || '').trim()) {
    els.brandLogo.src = config.logoPath;
    els.brandLogo.classList.remove('hidden');
  } else {
    els.brandLogo.classList.add('hidden');
    els.brandLogo.removeAttribute('src');
  }
}

function fits(el) {
  return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
}

function fitElement(el) {
  if (!el || el.clientHeight <= 0 || el.clientWidth <= 0) {
    return;
  }

  const min = Number(el.dataset.min || 14);
  const max = Number(el.dataset.max || 60);

  let low = min;
  let high = max;
  let best = min;

  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    el.style.fontSize = `${mid}px`;

    if (fits(el)) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }

    if (Math.abs(high - low) < 0.4) {
      break;
    }
  }

  el.style.fontSize = `${best.toFixed(2)}px`;
}

const debouncedFitAll = debounce(() => {
  window.requestAnimationFrame(() => {
    fitTargets.forEach((target) => fitElement(target));
  });
}, 140);

function setConnectionState(isConnected) {
  controllerConnected = Boolean(isConnected);
  els.connectionLabel.textContent = controllerConnected ? 'Connected' : 'Awaiting controller';
  els.connectionLabel.style.borderColor = controllerConnected
    ? 'rgba(95, 122, 105, 0.45)'
    : 'rgba(0, 0, 0, 0.08)';

  if (!controllerConnected && els.qrImage.getAttribute('src')) {
    els.qrOverlay.classList.remove('hidden');
  } else {
    els.qrOverlay.classList.add('hidden');
  }
}

function renderAyah(ayahPayload, animate = true) {
  if (!ayahPayload) {
    return;
  }

  const key = `${ayahPayload.surahNumber}:${ayahPayload.ayahNumber}`;
  if (key === currentAyahKey && !ayahPayload.forceRefresh) {
    return;
  }

  currentAyahKey = key;
  els.surahMeta.textContent = `${ayahPayload.surahNameEnglish} (${ayahPayload.surahNumber}) - Ayah ${ayahPayload.ayahNumber}`;

  const updateText = () => {
    els.arabicText.textContent = ayahPayload.arabic || '—';
    els.translationText.textContent = ayahPayload.translation || '';
    els.transliterationText.textContent = ayahPayload.transliteration || '';
    debouncedFitAll();
  };

  if (!animate) {
    updateText();
    return;
  }

  fitTargets.forEach((target) => target.classList.add('fading'));

  window.setTimeout(() => {
    updateText();
    fitTargets.forEach((target) => target.classList.remove('fading'));
  }, 120);
}

function applyBootstrap(payload) {
  applyBrandConfig(payload.config);

  if (payload.connection?.qrCodeDataUrl) {
    els.qrImage.src = payload.connection.qrCodeDataUrl;
  }

  renderAyah(payload.ayah, false);
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
  switch (message.type) {
    case 'bootstrap':
      applyBootstrap(message);
      break;
    case 'state_update':
      renderAyah(message.ayah, true);
      break;
    case 'controller_status':
      setConnectionState(message.controllerConnected);
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
        role: 'display'
      })
    );
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
      const bootstrap = await response.json();
      applyBootstrap(bootstrap);
    }
  } catch (_error) {
    // display still works once WebSocket bootstrap arrives
  }

  const resizeObserver = new ResizeObserver(() => debouncedFitAll());
  resizeObserver.observe(els.screenRoot);
  window.addEventListener('resize', debouncedFitAll);

  connectSocket();
  debouncedFitAll();
}

init();
