const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFollowMatcher, normalizeArabic } = require('../server/follow-matcher');
const { loadQuranDataset, loadDuas } = require('../server/loaders');
const root = path.resolve(__dirname, '..');
const quranDataset = loadQuranDataset(root, path.join(root, 'data'));
const duasById = loadDuas(path.join(root, 'data/duas'));
const create = () => createFollowMatcher({ quranDataset, duasById });
const state = (surah = 1, ayah = 1) => ({ sessionType: 'quran', quran: { surahNumber: surah, ayahNumber: ayah }, dua: { lineIndex: 1 } });
const arabic = (surah, ayah) => quranDataset.ayahDataBySurah.get(surah).get(ayah).arabic;

test('normalises Uthmani marks and alif variants without altering stored display text', () => {
  assert.equal(normalizeArabic('إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ'), 'اياك نعبد واياك نستعين');
  assert.equal(normalizeArabic('ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ'), 'الرحمن الرحيم');
});

test('requires three clear observations to acquire a distant surah automatically', () => {
  const matcher = create();
  assert.equal(matcher.locate(arabic(112, 1), state()).position, undefined);
  assert.equal(matcher.locate(arabic(112, 1), state()).position, undefined);
  assert.deepEqual(matcher.locate(arabic(112, 1), state()).position, { surahNumber: 112, ayahNumber: 1, lineIndex: undefined });
});

test('follows Fatiha despite its phrases also occurring elsewhere in the Quran', () => {
  const matcher = create();
  let current = state();
  for (let ayah = 2; ayah <= 7; ayah += 1) {
    assert.equal(matcher.locate(arabic(1, ayah), current).position, undefined);
    const result = matcher.locate(arabic(1, ayah), current);
    assert.equal(result.position?.ayahNumber, ayah, JSON.stringify(result));
    current = state(1, ayah);
  }
});

test('accepts a partial long ayah and small ASR spelling errors', () => {
  const matcher = create();
  const partial = 'وسع كرسيه السماوات والارض ولا يوده حفظهما وهو العلي العظيم';
  const current = state(2, 254);
  matcher.locate(partial, current);
  assert.equal(matcher.locate(partial, current).position?.ayahNumber, 255);
});

test('holds on silence, unrelated speech, very short fragments and repeated words', () => {
  for (const text of ['', 'مرحبا بكم في الاجتماع اليوم', 'يس', 'الله الله الله الله', 'الحمد لله']) {
    const matcher = create();
    for (let i = 0; i < 4; i += 1) assert.equal(matcher.locate(text, state(50, 1)).position, undefined, text);
  }
});

test('does not jump globally on an ambiguous repeated Quran passage', () => {
  const matcher = create();
  for (let i = 0; i < 4; i += 1) assert.equal(matcher.locate('فباي الاء ربكما تكذبان', state(2, 1)).position, undefined);
});

test('repeating the current verse never advances the screen', () => {
  const matcher = create();
  for (let i = 0; i < 5; i += 1) assert.equal(matcher.locate(arabic(112, 1), state(112, 1)).position, undefined);
});

test('a reset discards pending confirmations after manual navigation', () => {
  const matcher = create();
  matcher.locate(arabic(112, 1), state());
  matcher.locate(arabic(112, 1), state());
  matcher.reset();
  assert.equal(matcher.locate(arabic(112, 1), state()).position, undefined);
});

test('follows the selected dua and cannot select a different dua from speech', () => {
  const matcher = create();
  const current = { ...state(), sessionType: 'dua', selectedDuaId: 'iftitah' };
  const text = duasById.get('iftitah').lines[1].arabic;
  matcher.locate(text, current);
  assert.equal(matcher.locate(text, current).position?.lineIndex, 2);
  const other = duasById.get('ziyarat-waritha').lines[1].arabic;
  for (let i = 0; i < 4; i += 1) assert.equal(matcher.locate(other, current).position, undefined);
});
