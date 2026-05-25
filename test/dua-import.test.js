const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  createDatabase,
  migrateDatabase,
  getDatabaseSummary,
  importDuaJsonFile,
  importDuaJsonDirectory
} = require('../server/database');

test('imports one local dua JSON file into SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-dua-import-'));
  const db = createDatabase(path.join(dir, 'qurancontrol.db'));
  const duaPath = path.join(__dirname, '..', 'data', 'duas', 'iftitah.json');

  try {
    migrateDatabase(db);
    const result = importDuaJsonFile(db, duaPath, { sourceName: 'local-json' });

    assert.equal(result.id, 'iftitah');
    assert.equal(result.title, 'Duʿāʾ al-Iftitāḥ');
    assert.equal(result.lines, 236);

    const row = db.prepare('SELECT title, source_name FROM duas WHERE id = ?').get('iftitah');
    assert.equal(row.title, 'Duʿāʾ al-Iftitāḥ');
    assert.equal(row.source_name, 'local-json');

    const firstLine = db
      .prepare('SELECT arabic, english, transliteration FROM dua_lines WHERE dua_id = ? AND line_number = 1')
      .get('iftitah');
    assert.match(firstLine.arabic, /إِنِّي أَفْتَتِحُ/);
    assert.match(firstLine.english, /O Allah/);
    assert.match(firstLine.transliteration, /allahumma/i);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('imports all existing local dua JSON files into SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-duas-import-'));
  const db = createDatabase(path.join(dir, 'qurancontrol.db'));
  const duasDir = path.join(__dirname, '..', 'data', 'duas');

  try {
    migrateDatabase(db);
    const result = importDuaJsonDirectory(db, duasDir, { sourceName: 'local-json' });

    assert.equal(result.duas, 5);
    assert.equal(result.lines, 734);
    assert.deepEqual(getDatabaseSummary(db), {
      surahs: 0,
      ayahs: 0,
      duas: 5,
      duaLines: 734,
      events: 0,
      eventSections: 0,
      eventItems: 0
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
