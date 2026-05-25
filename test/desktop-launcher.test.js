const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package defines desktop launcher and packaging scripts', () => {
  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.scripts.start, 'node server/index.js');
  assert.equal(packageJson.scripts.desktop, 'electron .');
  assert.equal(packageJson.scripts['pack:win'], 'electron-builder --win --x64');
});

test('electron builder is configured for a Windows EXE target', () => {
  assert.equal(packageJson.build.appId, 'org.alzahraa.qurancontrol');
  assert.equal(packageJson.build.productName, 'Quran Control');
  assert.deepEqual(packageJson.build.files, ['desktop/**/*', 'server/**/*', 'public/**/*', 'data/**/*', 'package.json']);
  assert.deepEqual(packageJson.build.win.target, ['nsis']);
});

test('desktop launcher entry point exists and opens the admin dashboard', () => {
  const launcher = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
  assert.match(launcher, /require\('electron'\)/);
  assert.match(launcher, /server\/index\.js/);
  assert.match(launcher, /\/admin/);
});
