const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  createDatabase,
  migrateDatabase,
  importDuasOrgDua
} = require('../server/database');

test('imports duas.org JSON format into SQLite dua tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qurancontrol-duasorg-import-'));
  const db = createDatabase(path.join(dir, 'qurancontrol.db'));
  const source = {
    id: 'dua-arafah-imam-husain',
    title: 'Dua Arafah of Imam Husain (as)',
    duas: [
      { type: 'title', title: 'Dua Arafah' },
      {
        type: 'dua',
        id: 'dua-2',
        title: 'Dua Arafah of Imam Husain (as)',
        segments: [
          {
            arabic: 'اَلْحَمْدُ لِلَّهِ',
            transliteration: 'alhamdu lillahi',
            translation: 'Praise be to Allah'
          },
          {
            arabic: 'وَلاَ لِعَطَائِهِ مَانِعٌ',
            transliteration: 'wa la li`ataihi mani`un',
            translation: 'Whose gifts cannot be stopped'
          }
        ]
      }
    ]
  };

  try {
    migrateDatabase(db);
    const result = importDuasOrgDua(db, source, {
      sourceUrl: 'https://www.duas.org/data_v2/dua-arafah-imam-husain.json'
    });

    assert.deepEqual(result, {
      id: 'dua-arafah-imam-husain',
      title: 'Dua Arafah of Imam Husain (as)',
      lines: 2
    });

    const dua = db.prepare('SELECT title, source_name, source_url FROM duas WHERE id = ?').get(source.id);
    assert.equal(dua.title, source.title);
    assert.equal(dua.source_name, 'duas.org');
    assert.equal(dua.source_url, 'https://www.duas.org/data_v2/dua-arafah-imam-husain.json');

    const lines = db.prepare('SELECT line_number, arabic, english, transliteration FROM dua_lines WHERE dua_id = ? ORDER BY line_number').all(source.id);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].english, 'Praise be to Allah');
    assert.equal(lines[1].transliteration, 'wa la li`ataihi mani`un');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
