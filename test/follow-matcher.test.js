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
    const first = matcher.locate(arabic(1, ayah), current);
    const result = first.position ? first : matcher.locate(arabic(1, ayah), current);
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


test('follows short two-word ayahs using the selected surah context', () => {
  const matcher = create();
  let current = state(112, 1);
  for (let ayah = 2; ayah <= 4; ayah += 1) {
    const first = matcher.locate(arabic(112, ayah), current);
    const result = first.position ? first : matcher.locate(arabic(112, ayah), current);
    assert.equal(result.position?.ayahNumber, ayah, JSON.stringify(result));
    current = state(112, ayah);
  }
});


test('acquires an unknown position then advances on each clear next ayah without a timer', () => {
  const matcher = create();
  let current = state();
  matcher.locate(arabic(112, 1), current);
  matcher.locate(arabic(112, 1), current);
  const acquired = matcher.locate(arabic(112, 1), current);
  assert.equal(acquired.position?.surahNumber, 112);
  current = state(112, 1);
  for (let ayah = 2; ayah <= 4; ayah += 1) {
    const result = matcher.locate(arabic(112, ayah), current);
    assert.equal(result.position?.ayahNumber, ayah, JSON.stringify(result));
    current = state(112, ayah);
  }
  for (let i = 0; i < 3; i += 1) assert.equal(matcher.locate('', current).position, undefined);
});

test('a distinctive one-word next ayah follows using preceding recitation context', () => {
  const matcher = create();
  matcher.locate(arabic(55, 62), state(55, 62));
  assert.equal(matcher.locate(arabic(55, 63), state(55, 62)).position?.ayahNumber, 63);
  const current = state(55, 63);
  const result = matcher.locate(arabic(55, 63) + ' ' + arabic(55, 64), current);
  assert.equal(result.position?.ayahNumber, 64, JSON.stringify(result));
});


test('acquires a moving reciter across short adjacent ayahs without waiting on one verse', () => {
  const matcher = create();
  const initial = state();
  assert.equal(matcher.locate(arabic(112, 1), initial).position, undefined);
  assert.equal(matcher.locate(arabic(112, 1) + ' ' + arabic(112, 2), initial).position, undefined);
  const acquired = matcher.locate(arabic(112, 2) + ' ' + arabic(112, 3), initial);
  assert.equal(acquired.position?.surahNumber, 112, JSON.stringify(acquired));
  assert.equal(acquired.position?.ayahNumber, 3, JSON.stringify(acquired));
  assert.equal(matcher.locate(arabic(112, 4), state(112, 3)).position?.ayahNumber, 4);
});


test('after a pause, reacquires globally and corrects to a different surah', () => {
  const matcher = create();
  const oldPosition = state(112, 1);
  matcher.locate(arabic(112, 1), oldPosition);
  matcher.reacquire();
  assert.equal(matcher.locate(arabic(2, 255), oldPosition).position, undefined);
  assert.equal(matcher.locate(arabic(2, 255), oldPosition).position, undefined);
  assert.equal(matcher.locate(arabic(2, 255), oldPosition).position?.surahNumber, 2);
});

test('can recover on a distinctive short next ayah after a pause', () => {
  const matcher = create();
  matcher.reacquire();
  const position = state(112, 1);
  matcher.locate(arabic(112, 2), position);
  matcher.locate(arabic(112, 2), position);
  assert.equal(matcher.locate(arabic(112, 2), position).position?.ayahNumber, 2);
});
