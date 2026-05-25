const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionManager } = require('../server/session');

function manager() {
  return createSessionManager({
    metadata: { surahs: [{ number: 1, nameEnglish: 'Al-Fatihah', nameArabic: 'الفاتحة', ayahCount: 7 }] },
    quranDataset: { ayahDataBySurah: new Map([[1, new Map([[1, { arabic: 'a', translation: 'e', transliteration: 't' }]])]]) },
    duasById: new Map(),
    eventsById: new Map()
  });
}

test('new sessions default to showing Arabic, English, and transliteration', () => {
  const state = manager().createNewSession('quran');

  assert.deepEqual(state.languages, {
    arabic: true,
    english: true,
    transliteration: true
  });
});

test('language visibility can be changed and is clamped to supported languages', () => {
  const sessionManager = manager();
  const state = sessionManager.setLanguages(sessionManager.createNewSession('quran'), {
    arabic: true,
    english: false,
    transliteration: true,
    farsi: true
  });

  assert.deepEqual(state.languages, {
    arabic: true,
    english: false,
    transliteration: true
  });
});

test('public session payload includes language visibility', () => {
  const sessionManager = manager();
  const state = sessionManager.setLanguages(sessionManager.createNewSession('quran'), {
    arabic: false,
    english: true,
    transliteration: false
  });

  assert.deepEqual(sessionManager.getPublicSessionData(state).languages, {
    arabic: false,
    english: true,
    transliteration: false
  });
});
