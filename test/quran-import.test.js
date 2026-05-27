const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  createDatabase,
  migrateDatabase,
  getDatabaseSummary,
  importQuranDataset
} = require('../server/database');

test('imports full Quran dataset into SQLite with Arabic, English, and transliteration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-quran-import-'));
  const dbPath = path.join(dir, 'qurancontrol.db');
  const db = createDatabase(dbPath);
  const quranPath = path.join(__dirname, '..', 'data', 'quran.full.json');

  try {
    migrateDatabase(db);
    const result = importQuranDataset(db, quranPath);

    assert.deepEqual(result, { surahs: 114, ayahs: 6236 });
    assert.deepEqual(getDatabaseSummary(db), {
      surahs: 114,
      ayahs: 6236,
      duas: 0,
      duaLines: 0,
      events: 0,
      eventSections: 0,
      eventItems: 0
    });

    const firstAyah = db
      .prepare('SELECT arabic, english, transliteration FROM ayahs WHERE surah_number = 1 AND ayah_number = 1')
      .get();
    assert.match(firstAyah.arabic, /ٱللَّهِ/);
    assert.match(firstAyah.english, /Merciful/);
    assert.match(firstAyah.transliteration, /Bismi/i);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
