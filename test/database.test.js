const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createDatabase, migrateDatabase, getDatabaseSummary } = require('../server/database');

test('SQLite database migration creates required content and settings tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-db-'));
  const dbPath = path.join(dir, 'qurancontrol.db');
  const db = createDatabase(dbPath);

  try {
    migrateDatabase(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.deepEqual(
      tables.filter((name) => !name.startsWith('sqlite_')),
      [
        'ayahs',
        'display_presets',
        'dua_lines',
        'duas',
        'event_items',
        'event_sections',
        'events',
        'metadata_sources',
        'security_settings',
        'session_state',
        'settings',
        'surahs'
      ]
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('database summary counts Quran, dua, and event content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-db-'));
  const dbPath = path.join(dir, 'qurancontrol.db');
  const db = createDatabase(dbPath);

  try {
    migrateDatabase(db);
    db.prepare("INSERT INTO surahs (number, name_arabic, name_english) VALUES (1, 'الفاتحة', 'Al-Fatihah')").run();
    db.prepare("INSERT INTO ayahs (surah_number, ayah_number, arabic, english, transliteration) VALUES (1, 1, 'بسم الله الرحمن الرحيم', 'In the name of Allah', 'Bismillaahir Rahmaanir Raheem')").run();
    db.prepare("INSERT INTO duas (id, title, source_url) VALUES ('kumayl', 'Dua Kumayl', 'https://www.duas.org/')").run();
    db.prepare("INSERT INTO dua_lines (dua_id, line_number, arabic, english, transliteration) VALUES ('kumayl', 1, 'x', 'y', 'z')").run();
    db.prepare("INSERT INTO events (id, title) VALUES ('laylat-al-qadr-2026', 'Laylat al-Qadr — 2026')").run();

    assert.deepEqual(getDatabaseSummary(db), {
      surahs: 1,
      ayahs: 1,
      duas: 1,
      duaLines: 1,
      events: 1,
      eventSections: 0,
      eventItems: 0
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
