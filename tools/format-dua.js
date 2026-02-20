const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const inputArg = process.argv[2] || 'data/duas/iftitah.raw.txt';
const outputArg = process.argv[3] || 'data/duas/iftitah.json';

const inputPath = path.isAbsolute(inputArg) ? inputArg : path.join(ROOT_DIR, inputArg);
const outputPath = path.isAbsolute(outputArg) ? outputArg : path.join(ROOT_DIR, outputArg);

function resolveDuaId(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'dua';
}

function resolveDuaTitle(duaId) {
  if (duaId === 'iftitah') {
    return 'Duʿāʾ al-Iftitāḥ';
  }

  return `Duʿāʾ ${duaId}`;
}

if (!fs.existsSync(inputPath)) {
  console.error(`[error] Input file not found: ${inputPath}`);
  console.error('[hint] Create the raw file first, then run: npm run format:iftitah');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
const logicalLines = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (logicalLines.length === 0) {
  console.error('[error] The input file is empty after removing blank lines.');
  console.error('[hint] Paste triplets: Arabic line, transliteration line, English line, then repeat.');
  process.exit(1);
}

if (logicalLines.length % 3 !== 0) {
  console.error(
    `[error] Invalid line count: ${logicalLines.length}. Expected a multiple of 3 (Arabic, transliteration, English).`
  );
  console.error('[hint] Check for a missing or extra line in one of the triplets.');
  process.exit(1);
}

const lines = [];
for (let i = 0; i < logicalLines.length; i += 3) {
  lines.push({
    arabic: logicalLines[i],
    transliteration: logicalLines[i + 1],
    english: logicalLines[i + 2]
  });
}

const duaId = resolveDuaId(outputPath).replace(/\.json$/, '');
const output = {
  id: duaId,
  title: resolveDuaTitle(duaId),
  lines
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`[ok] Wrote ${outputPath}`);
console.log(`[ok] Parsed ${lines.length} line groups (${logicalLines.length} non-blank lines).`);
