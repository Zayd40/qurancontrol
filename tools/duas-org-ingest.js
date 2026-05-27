const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT_DIR, 'data/events/eid-al-adha-guided.json');

const SOURCES = {
  eid: 'https://www.duas.org/mobile/zilhajj-dua-eid-sacrifice.html',
  waritha: 'https://www.duas.org/mobile/ziyarat-imam-hussain-waritha.html'
};

const EVENT_SECTIONS = [
  {
    id: 'night-of-eid-takbeerat',
    title: 'Night of Eid Takbeerat',
    source: SOURCES.eid,
    paneId: 'one',
    startArabic: 'اللَّهُ اكْبَرُ',
    stopArabic: 'يَا ذَا ٱلْمَنِّ'
  },
  {
    id: 'eid-salat',
    title: 'Eid Salat',
    source: SOURCES.eid,
    paneId: 'seven',
    startArabic: 'اللّهُمّ أَهْلَ الْكِبْرِيَاءِ وَالْعَظَمَةِ'
  },
  {
    id: 'ziyarat-waritha-of-imam-hussain',
    title: 'Ziyarat Waritha of Imam Hussain',
    source: SOURCES.waritha,
    paneId: 'one',
    startArabic: 'اَلسَّلاَمُ عَلَيْكَ يَا وَارِثَ آدَمَ',
    stopHeading: 'Ziyarah of `Ali ibn al-Husayn'
  },
  {
    id: 'ziyarah-of-ali-ibn-al-husayn',
    title: 'Ziyarah of Ali ibn al-Husayn',
    source: SOURCES.waritha,
    paneId: 'one',
    startHeading: 'Ziyarah of `Ali ibn al-Husayn',
    stopHeading: 'Ziyarah of all Martyrs'
  },
  {
    id: 'ziyarah-of-all-martyrs',
    title: 'Ziyarah of all Martyrs',
    source: SOURCES.waritha,
    paneId: 'one',
    startHeading: 'Ziyarah of all Martyrs',
    stopHeading: "Ziyarah Abal Fadhl 'Abbas"
  }
];

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    ndash: '-',
    mdash: '-',
    quot: '"',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"'
  };

  return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const base = entity[1]?.toLowerCase() === 'x' ? 16 : 10;
      const number = parseInt(entity.replace(/^#x?/i, ''), base);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }

    return named[entity] || match;
  });
}

function cleanText(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:h[1-6]|div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeComparable(value) {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/[،,.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractTabLabels(html) {
  const labels = new Map();
  const linkPattern = /<a\b[^>]*data-toggle=["']tab["'][^>]*href=["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html))) {
    labels.set(match[1], cleanText(match[2]));
  }

  return labels;
}

function extractTabPanes(html) {
  const labels = extractTabLabels(html);
  const panePattern = /<div\b[^>]*class=["'][^"']*\btab-pane\b[^"']*["'][^>]*id=["']([^"']+)["'][^>]*>/gi;
  const matches = [...html.matchAll(panePattern)];

  return matches.map((match, index) => {
    const next = matches[index + 1];
    return {
      id: match[1],
      title: labels.get(match[1]) || match[1],
      html: html.slice(match.index, next ? next.index : html.length)
    };
  });
}

function extractHeadings(html) {
  const headings = [];
  const pattern = /<(h[1-6]|green)\b[^>]*>([\s\S]*?)<\/\1>|<b>\s*<green\b[^>]*>([\s\S]*?)<\/green>\s*<\/b>|<green\b[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/green>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const text = cleanText(match[2] || match[3] || match[4]);
    if (text) {
      headings.push({ index: match.index, text });
    }
  }

  return headings;
}

function extractRows(html) {
  const rows = [];
  const tripletPattern =
    /<div\b[^>]*class=["'][^"']*\bAra\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*\bTrl\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/?t2[^>]*>?\s*<div\b[^>]*class=["'][^"']*\bTra\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = tripletPattern.exec(html))) {
    const arabic = cleanText(match[1]);
    const transliteration = cleanText(match[2]);
    const english = cleanText(match[3]);

    if (arabic || transliteration || english) {
      rows.push({
        index: match.index,
        arabic,
        transliteration,
        english
      });
    }
  }

  return rows;
}

function parseDuasOrgPage(html) {
  return {
    panes: extractTabPanes(html).map((pane) => ({
      ...pane,
      headings: extractHeadings(pane.html),
      rows: extractRows(pane.html)
    }))
  };
}

function findPane(page, paneId) {
  const pane = page.panes.find((entry) => entry.id === paneId);
  if (!pane) {
    throw new Error(`Tab pane not found: ${paneId}`);
  }
  return pane;
}

function findMarkerIndex(markers, expected, label) {
  const needle = normalizeComparable(expected);
  const marker = markers.find((entry) => normalizeComparable(entry.text).includes(needle));
  if (!marker) {
    throw new Error(`${label} not found: ${expected}`);
  }
  return marker.index;
}

function findRowIndex(rows, expected, label) {
  const needle = normalizeComparable(expected);
  const row = rows.find((entry) => normalizeComparable(entry.arabic).includes(needle));
  if (!row) {
    throw new Error(`${label} not found: ${expected}`);
  }
  return row.index;
}

function extractSectionRows(page, definition) {
  const pane = findPane(page, definition.paneId);
  const startIndex =
    definition.startHeading !== undefined
      ? findMarkerIndex(pane.headings, definition.startHeading, 'Start heading')
      : findRowIndex(pane.rows, definition.startArabic, 'Start Arabic');

  const stopIndexes = [];
  if (definition.stopHeading) {
    stopIndexes.push(findMarkerIndex(pane.headings, definition.stopHeading, 'Stop heading'));
  }
  if (definition.stopArabic) {
    stopIndexes.push(findRowIndex(pane.rows, definition.stopArabic, 'Stop Arabic'));
  }

  const stopIndex = stopIndexes.length > 0 ? Math.min(...stopIndexes) : Number.POSITIVE_INFINITY;
  const rows = pane.rows
    .filter((row) => row.index >= startIndex && row.index < stopIndex)
    .map(({ arabic, transliteration, english }) => ({ arabic, transliteration, english }));

  if (rows.length === 0) {
    throw new Error(`No rows extracted for section: ${definition.title}`);
  }

  return rows;
}

function rowsToSlides(rows, source) {
  return rows.map((row) => ({
    title: '',
    instruction: '',
    repeat: '',
    reference: source,
    arabic: row.arabic,
    transliteration: row.transliteration,
    english: row.english,
    note: ''
  }));
}

function buildGuidedEidEvent(pagesBySource) {
  return {
    id: 'eid-al-adha-guided',
    title: 'Guided Eid al-Adha Event',
    sections: EVENT_SECTIONS.map((definition) => {
      const page = pagesBySource.get(definition.source);
      if (!page) {
        throw new Error(`Missing parsed page for ${definition.source}`);
      }

      const rows = extractSectionRows(page, definition);
      return {
        id: definition.id,
        title: definition.title,
        slides: rowsToSlides(rows, definition.source)
      };
    })
  };
}

function renderGuidedEventMarkdown(event) {
  const sections = event.sections.map((section) => {
    const arabic = section.slides.map((slide) => slide.arabic).filter(Boolean).join('\n');
    const transliteration = section.slides.map((slide) => slide.transliteration).filter(Boolean).join('\n');
    const english = section.slides.map((slide) => slide.english).filter(Boolean).join('\n');

    return `## ${section.title}\n\nArabic:\n${arabic}\n\nTransliteration:\n${transliteration}\n\nEnglish:\n${english}`;
  });

  return `# ${event.title}\n\n${sections.join('\n\n')}\n`;
}

async function fetchHtml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function loadPages() {
  const pages = new Map();
  for (const source of Object.values(SOURCES)) {
    if (!pages.has(source)) {
      pages.set(source, parseDuasOrgPage(await fetchHtml(source)));
    }
  }
  return pages;
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const outputIndex = process.argv.indexOf('--output');
  const outputPath =
    outputIndex >= 0 && process.argv[outputIndex + 1]
      ? path.resolve(process.cwd(), process.argv[outputIndex + 1])
      : DEFAULT_OUTPUT;

  const event = buildGuidedEidEvent(await loadPages());

  if (args.has('--markdown')) {
    process.stdout.write(renderGuidedEventMarkdown(event));
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  console.log(`[ok] Wrote ${outputPath}`);
  for (const section of event.sections) {
    console.log(`[ok] ${section.title}: ${section.slides.length} slides`);
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`[error] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  EVENT_SECTIONS,
  SOURCES,
  buildGuidedEidEvent,
  extractRows,
  extractSectionRows,
  extractTabPanes,
  parseDuasOrgPage,
  renderGuidedEventMarkdown
};
