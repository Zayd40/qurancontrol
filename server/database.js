const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function migrateDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS surahs (
      number INTEGER PRIMARY KEY,
      name_arabic TEXT,
      name_english TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ayahs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surah_number INTEGER NOT NULL REFERENCES surahs(number) ON DELETE CASCADE,
      ayah_number INTEGER NOT NULL,
      arabic TEXT NOT NULL,
      english TEXT NOT NULL,
      transliteration TEXT NOT NULL,
      UNIQUE (surah_number, ayah_number)
    );

    CREATE TABLE IF NOT EXISTS duas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS dua_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dua_id TEXT NOT NULL REFERENCES duas(id) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      arabic TEXT,
      english TEXT,
      transliteration TEXT,
      UNIQUE (dua_id, line_number)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS event_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      section_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      UNIQUE (event_id, section_number)
    );

    CREATE TABLE IF NOT EXISTS event_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES event_sections(id) ON DELETE CASCADE,
      item_number INTEGER NOT NULL,
      arabic TEXT,
      english TEXT,
      transliteration TEXT,
      UNIQUE (section_id, item_number)
    );

    CREATE TABLE IF NOT EXISTS metadata_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      language TEXT,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS display_presets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      show_arabic INTEGER NOT NULL DEFAULT 1,
      show_english INTEGER NOT NULL DEFAULT 1,
      show_transliteration INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS security_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function importQuranDataset(db, quranPath) {
  const raw = JSON.parse(fs.readFileSync(quranPath, 'utf8'));
  const surahs = Array.isArray(raw) ? raw : raw.surahs;

  if (!Array.isArray(surahs)) {
    throw new Error('Quran dataset must contain a surahs array.');
  }

  const insertSurah = db.prepare(`
    INSERT INTO surahs (number, name_arabic, name_english)
    VALUES (?, ?, ?)
    ON CONFLICT(number) DO UPDATE SET
      name_arabic = excluded.name_arabic,
      name_english = excluded.name_english
  `);
  const insertAyah = db.prepare(`
    INSERT INTO ayahs (surah_number, ayah_number, arabic, english, transliteration)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(surah_number, ayah_number) DO UPDATE SET
      arabic = excluded.arabic,
      english = excluded.english,
      transliteration = excluded.transliteration
  `);

  let ayahCount = 0;
  db.exec('BEGIN');
  try {
    for (const surah of surahs) {
      insertSurah.run(surah.number, surah.nameArabic || null, surah.nameEnglish || `Surah ${surah.number}`);
      const ayahs = surah.ayahs || [];
      for (const ayah of ayahs) {
        insertAyah.run(
          surah.number,
          ayah.number,
          ayah.arabic || '',
          ayah.translation || ayah.english || '',
          ayah.transliteration || ''
        );
        ayahCount += 1;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { surahs: surahs.length, ayahs: ayahCount };
}

function importDuaJsonFile(db, duaPath, options = {}) {
  const dua = JSON.parse(fs.readFileSync(duaPath, 'utf8'));
  const id = dua.id || path.basename(duaPath, '.json');
  const title = dua.title || dua.name || id;
  const lines = Array.isArray(dua.lines) ? dua.lines : [];
  const sourceName = options.sourceName || dua.sourceName || null;
  const sourceUrl = options.sourceUrl || dua.sourceUrl || null;

  const insertDua = db.prepare(`
    INSERT INTO duas (id, title, source_name, source_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      source_name = excluded.source_name,
      source_url = excluded.source_url
  `);
  const insertLine = db.prepare(`
    INSERT INTO dua_lines (dua_id, line_number, arabic, english, transliteration)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(dua_id, line_number) DO UPDATE SET
      arabic = excluded.arabic,
      english = excluded.english,
      transliteration = excluded.transliteration
  `);

  db.exec('BEGIN');
  try {
    insertDua.run(id, title, sourceName, sourceUrl);
    for (const [index, line] of lines.entries()) {
      insertLine.run(
        id,
        index + 1,
        line.arabic || null,
        line.english || line.translation || null,
        line.transliteration || null
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { id, title, lines: lines.length };
}

function importDuaJsonDirectory(db, duasDir, options = {}) {
  const files = fs
    .readdirSync(duasDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const imported = files.map((file) => importDuaJsonFile(db, path.join(duasDir, file), options));
  return {
    duas: imported.length,
    lines: imported.reduce((total, item) => total + item.lines, 0),
    imported
  };
}

function importDuasOrgDua(db, source, options = {}) {
  const id = source.id;
  const title = source.title || id;
  const sourceUrl = options.sourceUrl || null;
  const segments = [];

  for (const item of source.duas || []) {
    if (item.type !== 'dua' || !Array.isArray(item.segments)) continue;
    for (const segment of item.segments) {
      if (!segment.arabic && !segment.translation && !segment.transliteration) continue;
      segments.push({
        arabic: segment.arabic || null,
        english: segment.translation || segment.english || null,
        transliteration: segment.transliteration || null
      });
    }
  }

  const insertDua = db.prepare(`
    INSERT INTO duas (id, title, source_name, source_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      source_name = excluded.source_name,
      source_url = excluded.source_url
  `);
  const insertLine = db.prepare(`
    INSERT INTO dua_lines (dua_id, line_number, arabic, english, transliteration)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(dua_id, line_number) DO UPDATE SET
      arabic = excluded.arabic,
      english = excluded.english,
      transliteration = excluded.transliteration
  `);

  db.exec('BEGIN');
  try {
    insertDua.run(id, title, 'duas.org', sourceUrl);
    for (const [index, segment] of segments.entries()) {
      insertLine.run(id, index + 1, segment.arabic, segment.english, segment.transliteration);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { id, title, lines: segments.length };
}

function getCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function getDatabaseSummary(db) {
  return {
    surahs: getCount(db, 'surahs'),
    ayahs: getCount(db, 'ayahs'),
    duas: getCount(db, 'duas'),
    duaLines: getCount(db, 'dua_lines'),
    events: getCount(db, 'events'),
    eventSections: getCount(db, 'event_sections'),
    eventItems: getCount(db, 'event_items')
  };
}

module.exports = {
  createDatabase,
  migrateDatabase,
  importQuranDataset,
  importDuaJsonFile,
  importDuaJsonDirectory,
  importDuasOrgDua,
  getDatabaseSummary
};
