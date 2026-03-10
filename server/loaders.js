const fs = require('fs');
const path = require('path');
const os = require('os');

function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[warn] Failed to read ${filePath}: ${error.message}`);
    return fallbackValue;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveQuranDataPath(rootDir, dataDir) {
  const envPath = process.env.QURAN_DATA_FILE;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(rootDir, envPath);
  }

  const fullPath = path.join(dataDir, 'quran.full.json');
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }

  return path.join(dataDir, 'quran.json');
}

function getLanIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const networkName of Object.keys(interfaces)) {
    for (const iface of interfaces[networkName] || []) {
      if (iface.family !== 'IPv4' || iface.internal) {
        continue;
      }

      const isPrivate =
        iface.address.startsWith('10.') ||
        iface.address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address);

      candidates.push({
        address: iface.address,
        private: isPrivate
      });
    }
  }

  const privateMatch = candidates.find((entry) => entry.private);
  return privateMatch?.address || candidates[0]?.address || '127.0.0.1';
}

function loadConfig(dataDir) {
  const config = readJsonFile(path.join(dataDir, 'config.json'), {});

  return {
    brandText: 'Al Zahraa Centre',
    logoPath: String(config.logoPath || '').trim(),
    accentColor: String(config.accentColor || '#6f8476').trim() || '#6f8476',
    safeMargin: String(config.safeMargin || '4vw').trim() || '4vw'
  };
}

function loadSurahMetadata(dataDir) {
  const metadata = readJsonFile(path.join(dataDir, 'surah-metadata.json'), { surahs: [] });
  const surahs = Array.isArray(metadata.surahs)
    ? metadata.surahs.map((surah) => ({
        number: Number(surah.number) || 1,
        nameEnglish: String(surah.nameEnglish || `Surah ${surah.number || 1}`),
        nameArabic: String(surah.nameArabic || ''),
        ayahCount: Number(surah.ayahCount) || 1
      }))
    : [];

  return { surahs };
}

function loadQuranDataset(rootDir, dataDir) {
  const quranDataPath = resolveQuranDataPath(rootDir, dataDir);
  const quranData = readJsonFile(quranDataPath, { meta: { type: 'empty' }, surahs: [] });

  if ((quranData?.meta?.type || '').toLowerCase() === 'seed') {
    console.warn('[warn] Seed dataset loaded. Add data/quran.full.json for full 114-surah content.');
  }

  const ayahDataBySurah = new Map();
  for (const surah of quranData.surahs || []) {
    const surahNumber = Number(surah.number);
    const ayahMap = new Map();

    for (const ayah of surah.ayahs || []) {
      ayahMap.set(Number(ayah.number), {
        number: Number(ayah.number),
        arabic: String(ayah.arabic || ''),
        translation: String(ayah.translation || ''),
        transliteration: String(ayah.transliteration || '')
      });
    }

    ayahDataBySurah.set(surahNumber, ayahMap);
  }

  return {
    path: quranDataPath,
    meta: {
      type: quranData?.meta?.type || 'unknown',
      description: quranData?.meta?.description || ''
    },
    ayahDataBySurah
  };
}

function normalizeDuaLine(line) {
  return {
    arabic: String(line?.arabic || '').trim(),
    transliteration: String(line?.transliteration || '').trim(),
    english: String(line?.english || '').trim()
  };
}

function loadDuas(duaDir) {
  const duaMap = new Map();

  if (!fs.existsSync(duaDir)) {
    console.warn(`[warn] Dua directory not found at ${duaDir}`);
    return duaMap;
  }

  for (const fileName of fs.readdirSync(duaDir)) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(duaDir, fileName);
    const parsed = readJsonFile(filePath, null);
    if (!parsed) {
      continue;
    }

    const id = String(parsed.id || path.basename(fileName, '.json')).trim().toLowerCase();
    const title = String(parsed.title || id).trim();
    const lines = Array.isArray(parsed.lines) ? parsed.lines.map(normalizeDuaLine) : [];

    if (!id || !title || lines.length === 0) {
      console.warn(`[warn] Skipping invalid dua file ${fileName} (missing id/title/lines)`);
      continue;
    }

    duaMap.set(id, {
      id,
      title,
      lines
    });
  }

  return duaMap;
}

function normalizeSlide(slide) {
  return {
    title: String(slide?.title || '').trim(),
    instruction: String(slide?.instruction || '').trim(),
    repeat: String(slide?.repeat || '').trim(),
    reference: String(slide?.reference || '').trim(),
    arabic: String(slide?.arabic || '').trim(),
    transliteration: String(slide?.transliteration || '').trim(),
    english: String(slide?.english || '').trim(),
    note: String(slide?.note || '').trim()
  };
}

function loadGuidedEvents(eventsDir) {
  const eventMap = new Map();

  if (!fs.existsSync(eventsDir)) {
    console.warn(`[warn] Event directory not found at ${eventsDir}`);
    return eventMap;
  }

  for (const fileName of fs.readdirSync(eventsDir)) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(eventsDir, fileName);
    const parsed = readJsonFile(filePath, null);
    if (!parsed) {
      continue;
    }

    const id = String(parsed.id || path.basename(fileName, '.json')).trim().toLowerCase();
    const title = String(parsed.title || id).trim();
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((section, sectionIndex) => ({
            id: String(section?.id || `section-${sectionIndex + 1}`)
              .trim()
              .toLowerCase(),
            title: String(section?.title || `Section ${sectionIndex + 1}`).trim(),
            slides: Array.isArray(section?.slides) ? section.slides.map(normalizeSlide) : []
          }))
          .filter((section) => section.title && section.slides.length > 0)
      : [];

    if (!id || !title || sections.length === 0) {
      console.warn(`[warn] Skipping invalid event file ${fileName} (missing id/title/sections)`);
      continue;
    }

    eventMap.set(id, {
      id,
      title,
      sections,
      todo: String(parsed._todo || '').trim()
    });
  }

  return eventMap;
}

module.exports = {
  getLanIPv4,
  loadConfig,
  loadDuas,
  loadGuidedEvents,
  loadQuranDataset,
  loadSurahMetadata,
  readJsonFile,
  writeJsonFile
};
