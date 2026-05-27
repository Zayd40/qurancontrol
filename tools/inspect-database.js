const path = require('node:path');
const { createDatabase, getDatabaseSummary } = require('../server/database');

const rootDir = path.resolve(__dirname, '..');
const dbPath = process.env.QURANCONTROL_DB || path.join(rootDir, 'data', 'qurancontrol.db');
const db = createDatabase(dbPath);

try {
  const summary = getDatabaseSummary(db);
  const duas = db
    .prepare(`
      SELECT d.id, d.title, d.source_name, d.source_url, COUNT(l.id) AS lines
      FROM duas d
      LEFT JOIN dua_lines l ON l.dua_id = d.id
      GROUP BY d.id
      ORDER BY d.title
    `)
    .all();
  const quranSample = db
    .prepare(`
      SELECT s.number, s.name_english, s.name_arabic, COUNT(a.id) AS ayahs
      FROM surahs s
      LEFT JOIN ayahs a ON a.surah_number = s.number
      GROUP BY s.number
      ORDER BY s.number
      LIMIT 5
    `)
    .all();

  console.log(JSON.stringify({ dbPath, summary, quranSample, duas }, null, 2));
} finally {
  db.close();
}
