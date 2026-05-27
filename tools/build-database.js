const path = require('node:path');

const {
  createDatabase,
  migrateDatabase,
  importQuranDataset,
  importDuaJsonDirectory,
  importDuasOrgDua,
  getDatabaseSummary
} = require('../server/database');

const rootDir = path.resolve(__dirname, '..');
const dbPath = process.env.QURANCONTROL_DB || path.join(rootDir, 'data', 'qurancontrol.db');
const quranPath = path.join(rootDir, 'data', 'quran.full.json');
const duasDir = path.join(rootDir, 'data', 'duas');

const DUAS_ORG_SOURCES = [
  {
    id: 'ziyarat-imam-husain-on-arafah-day',
    jsonUrl: 'https://www.duas.org/data_v2/ziyarat-imam-husain-on-arafah-day.json',
    pageUrl: 'https://www.duas.org/ziyarat-imam-husain-on-arafah-day.html'
  },
  {
    id: 'dua-arafah-imam-husain',
    jsonUrl: 'https://www.duas.org/data_v2/dua-arafah-imam-husain.json',
    pageUrl: 'https://www.duas.org/dua-arafah-imam-husain.html'
  }
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'qurancontrol-db-builder/1.0' } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const db = createDatabase(dbPath);
  try {
    migrateDatabase(db);
    const quran = importQuranDataset(db, quranPath);
    const localDuas = importDuaJsonDirectory(db, duasDir, { sourceName: 'local-json' });
    const duasOrg = [];

    for (const source of DUAS_ORG_SOURCES) {
      const data = await fetchJson(source.jsonUrl);
      duasOrg.push(importDuasOrgDua(db, data, { sourceUrl: source.pageUrl }));
    }

    const summary = getDatabaseSummary(db);
    console.log(JSON.stringify({
      dbPath,
      quran,
      localDuas: { duas: localDuas.duas, lines: localDuas.lines },
      duasOrg,
      summary
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
