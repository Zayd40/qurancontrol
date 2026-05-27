const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  parseDuasOrgPage
} = require('../tools/duas-org-ingest');

const ROOT_DIR = path.resolve(__dirname, '..');
const eventPath = path.join(ROOT_DIR, 'data/events/eid-al-adha-guided.json');

function readEvent() {
  return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
}

function getSection(event, id) {
  const section = event.sections.find((entry) => entry.id === id);
  assert.ok(section, `Missing section ${id}`);
  return section;
}

function assertAligned(section) {
  for (const [index, slide] of section.slides.entries()) {
    assert.ok(slide.arabic, `${section.id} slide ${index + 1} is missing Arabic`);
    assert.ok(slide.transliteration, `${section.id} slide ${index + 1} is missing transliteration`);
    assert.ok(slide.english, `${section.id} slide ${index + 1} is missing English`);
  }
}

test('parser extracts rows from hidden tabs instead of only the active tab', () => {
  const html = `
    <a data-toggle="tab" href="#one">Visible</a>
    <a data-toggle="tab" href="#seven">Hidden Eid-Salaat</a>
    <div class="tab-content">
      <div class="tab-pane fade show active" id="one">
        <div class="Ara"><a1>اللَّهُ اكْبَرُ</a1></div><div class="Trl"><t2>allahu akbar</div></t2><div class="Tra"><t1>Allah is Great.</div></t1>
      </div>
      <div class="tab-pane fade" id="seven">
        <h6>Qunoot in Eid prayer</h6>
        <div class="Ara"><a1>اللّهُمّ أَهْلَ الْكِبْرِيَاءِ وَالْعَظَمَةِ،</a1></div><div class="Trl"><t2>allahumma ahla alkibriya‘i wal-\`azamati</div></t2><div class="Tra"><t1>O Allah: You are the Lord of glory and greatness</div></t1>
      </div>
    </div>
  `;

  const page = parseDuasOrgPage(html);
  const hiddenPane = page.panes.find((pane) => pane.id === 'seven');

  assert.ok(hiddenPane);
  assert.equal(hiddenPane.rows.length, 1);
  assert.equal(hiddenPane.rows[0].transliteration, 'allahumma ahla alkibriya‘i wal-`azamati');
});

test('generated Eid event contains the requested Waritha page sections', () => {
  const event = readEvent();
  const titles = event.sections.map((section) => section.title);

  assert.deepEqual(titles, [
    'Night of Eid Takbeerat',
    'Eid Salat',
    'Ziyarat Waritha of Imam Hussain',
    'Ziyarah of Ali ibn al-Husayn',
    'Ziyarah of all Martyrs'
  ]);

  assert.equal(getSection(event, 'ziyarat-waritha-of-imam-hussain').slides.length, 59);
  assert.equal(getSection(event, 'ziyarah-of-ali-ibn-al-husayn').slides.length, 15);
  assert.equal(getSection(event, 'ziyarah-of-all-martyrs').slides.length, 13);
});

test('Eid Salat hidden tab content is present and aligned', () => {
  const eidSalat = getSection(readEvent(), 'eid-salat');

  assert.equal(eidSalat.slides.length, 12);
  assert.equal(eidSalat.slides[0].arabic, 'اللّهُمّ أَهْلَ الْكِبْرِيَاءِ وَالْعَظَمَةِ،');
  assert.equal(eidSalat.slides[0].transliteration, 'allahumma ahla alkibriya‘i wal-`azamati');
  assert.equal(eidSalat.slides[0].english, 'O Allah: You are the Lord of glory and greatness');
  assertAligned(eidSalat);
});

test('Arabic, transliteration, and English rows stay aligned in every section', () => {
  const event = readEvent();

  for (const section of event.sections) {
    assertAligned(section);
  }
});

test('sections are not duplicated or truncated at subsection boundaries', () => {
  const event = readEvent();
  const ids = event.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);

  const waritha = getSection(event, 'ziyarat-waritha-of-imam-hussain');
  const ali = getSection(event, 'ziyarah-of-ali-ibn-al-husayn');
  const martyrs = getSection(event, 'ziyarah-of-all-martyrs');

  assert.equal(waritha.slides[0].arabic, 'اَلسَّلاَمُ عَلَيْكَ يَا وَارِثَ آدَمَ صَفْوَةِ ٱللَّهِ');
  assert.equal(waritha.slides.at(-1).english, 'and to keep me with you in this world and in the Hereafter.');
  assert.equal(ali.slides[0].arabic, 'اَلسَّلاَمُ عَلَيْكَ يَا بْنَ رَسُولِ ٱللَّهِ');
  assert.equal(ali.slides.at(-1).english, 'and I disavow them in the presence of Allah and You.');
  assert.equal(martyrs.slides[0].arabic, 'اَلسَّلاَمُ عَلَيْكُمْ يَا أَوْلِيَاءَ ٱللَّهِ وَأَحِبَّائَهُ');
  assert.equal(martyrs.slides.at(-1).english, 'Would that I were with you so that I could also share the accomplishment with you.');

  const serializedSlides = event.sections.flatMap((section) =>
    section.slides.map((slide) => JSON.stringify([section.id, slide.arabic, slide.transliteration, slide.english]))
  );
  assert.equal(new Set(serializedSlides).size, serializedSlides.length);
});
