// Only canonical stored text reaches the display. ASR text is used for locating it.
function normalizeArabic(text) {
  return String(text || '').normalize('NFKC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[^\u0621-\u063a\u0641-\u064a\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

function grams(text) {
  const result = new Set();
  for (let i = 0; i < text.length - 1; i += 1) result.add(text.slice(i, i + 2));
  return result;
}

function overlap(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count / Math.max(1, a.size);
}

function scoreTokens(query, target) {
  // Match the newest words anywhere inside a verse/line; older audio may belong
  // to the preceding verse. Free target prefixes/suffixes support long ayahs.
  const words = query.slice(-Math.min(12, target.length));
  if (target.length === 1) return query.length >= 2 && target[0].length >= 4 && query.at(-1) === target[0] ? 1 : 0;
  if (words.length < 2 || new Set(words).size < 2 || words.join('').length < 6) return 0;
  let row = new Array(target.length + 1).fill(0);
  for (let i = 1; i <= words.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= target.length; j += 1) {
      const a = words[i - 1];
      const b = target[j - 1];
      const cost = a === b ? 0 : Math.min(1, distance(a, b) / Math.max(a.length, b.length) * 1.8);
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost);
    }
    row = next;
  }
  return Math.max(0, 1 - Math.min(...row.slice(1)) / words.length);
}

function createFollowMatcher({ quranDataset, duasById }) {
  const quran = [];
  const duas = new Map();
  function entry(value) {
    const normalized = normalizeArabic(value.arabic);
    return { ...value, text: ` ${normalized} `, words: normalized.split(' ').filter(Boolean), grams: grams(normalized) };
  }
  for (const [surahNumber, ayahs] of quranDataset.ayahDataBySurah) {
    for (const [ayahNumber, ayah] of ayahs) quran.push(entry({ surahNumber, ayahNumber, arabic: ayah.arabic }));
  }
  for (const [id, dua] of duasById) {
    duas.set(id, dua.lines.map((line, index) => entry({ duaId: id, lineIndex: index + 1, arabic: line.arabic })));
  }
  let pending = null;
  let confirmations = 0;
  let locked = false;
  let acquisition = null;
  function clearPending() { pending = null; confirmations = 0; }
  function reset() { clearPending(); locked = false; acquisition = null; }
  function locate(text, state) {
    const query = normalizeArabic(text).split(' ').filter(Boolean).slice(-12);
    if (query.length < 2 || new Set(query).size < 2 || query.join('').length < 6) { clearPending(); return { reason: 'Waiting for more words' }; }
    const corpus = state.sessionType === 'dua' ? (duas.get(state.selectedDuaId) || []) : quran;
    const current = corpus.findIndex((value) => state.sessionType === 'dua'
      ? value.lineIndex === state.dua.lineIndex
      : value.surahNumber === state.quran.surahNumber && value.ayahNumber === state.quran.ayahNumber);
    const queryGrams = grams(query.join(' '));
    const shortlist = corpus.map((value, index) => ({ value, index, overlap: overlap(queryGrams, value.grams) }))
      .sort((a, b) => b.overlap - a.overlap).slice(0, 60);
    // Overlapping audio often includes the previous ayah. Always retrieve
    // exact newest word pairs too, so its older words cannot hide a short
    // current ayah behind longer, unrelated verses in the global shortlist.
    const tail = ` ${query.slice(-2).join(' ')} `;
    const included = new Set(shortlist.map((item) => item.index));
    corpus.forEach((value, index) => {
      if (value.text.includes(tail) && !included.has(index)) {
        shortlist.push({ value, index }); included.add(index);
      }
    });
    // Always compare neighbours, including short verses that rank poorly globally.
    for (let index = Math.max(0, current - 2); index <= Math.min(corpus.length - 1, current + 4); index += 1) {
      if (!shortlist.some((item) => item.index === index)) shortlist.push({ value: corpus[index], index });
    }
    const ranked = shortlist.map((item) => ({ ...item, score: scoreTokens(query, item.value.words) }))
      .sort((a, b) => b.score - a.score);
    // Once a passage is selected, nearby continuation resolves verses repeated
    // elsewhere in the Qur'an. Current/next identical lines still remain ambiguous.
    const local = ranked.filter((item) => item.index >= current - 1 && item.index <= current + 4)
      .map((item) => ({ ...item, rankScore: item.score - (item.index < current || (locked && item.index > current + 1) ? 0.12 : 0) }))
      .sort((a, b) => b.rankScore - a.rankScore);
    const localMargin = (local[0]?.rankScore || 0) - (local[1]?.rankScore || 0);
    const useLocal = local[0]?.score >= 0.84 && localMargin >= 0.08;
    const best = useLocal ? local[0] : ranked[0];
    if (!best) { clearPending(); return { reason: 'No text loaded' }; }
    const nearby = useLocal;
    // Global acquisition needs a unique match; local following uses session context.
    const margin = useLocal ? localMargin : best.score - (ranked[1]?.score || 0);
    const threshold = nearby ? 0.84 : 0.94;
    const sequential = locked && nearby && best.index === current + 1;
    const continuesAcquisition = state.sessionType === 'quran' && acquisition &&
      Date.now() - acquisition.time < 10000 && best.value.surahNumber === acquisition.surahNumber &&
      best.index >= acquisition.index && best.index <= acquisition.index + 4;
    const requiredWords = !nearby && continuesAcquisition ? 2 : sequential && best.value.words.length === 1 ? 1 : nearby ? 2 : 4;
    if (best.score < threshold || margin < 0.08 || Math.min(query.length, best.value.words.length) < requiredWords) {
      clearPending();
      return { reason: 'Uncertain match — holding display', score: best.score };
    }
    if (best.index === current) { locked = true; acquisition = null; clearPending(); return { reason: 'Following current passage', score: best.score }; }
    if (!nearby && state.sessionType === 'quran') {
      // The reciter keeps moving while we acquire a position. Corroborate
      // adjacent ayahs in the same surah, rather than requiring one ayah to
      // remain the newest recognised text for several inference windows.
      acquisition = { surahNumber: best.value.surahNumber, index: best.index,
        count: continuesAcquisition ? acquisition.count + 1 : 1, time: Date.now() };
      if (acquisition.count < 3) return { reason: 'Confirming passage', score: best.score };
    }
    const key = `${state.sessionType}:${state.selectedDuaId || ''}:${best.index}`;
    if (pending === key) confirmations += 1;
    else { pending = key; confirmations = 1; }
    const requiredConfirmations = !nearby && state.sessionType === 'quran' ? 1 : sequential && best.score >= 0.96 && margin >= 0.10 ? 1 : nearby ? 2 : 3;
    if (confirmations < requiredConfirmations) return { reason: 'Confirming passage', score: best.score };
    clearPending();
    locked = true;
    acquisition = null;
    const { surahNumber, ayahNumber, lineIndex } = best.value;
    return { reason: 'Following reciter', score: best.score, position: { surahNumber, ayahNumber, lineIndex } };
  }
  return { locate, reset };
}

module.exports = { normalizeArabic, scoreTokens, createFollowMatcher };
