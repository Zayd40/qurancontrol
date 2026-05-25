const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const readme = fs.readFileSync('README.md', 'utf8');

test('README uses repo-relative links rather than one developer machine path', () => {
  assert.doesNotMatch(readme, /\/Users\/zaydabbas\/Documents\/GitHub\/qurancontrol/);
});

test('README documents the admin PIN setting', () => {
  assert.match(readme, /ADMIN_PIN/);
  assert.match(readme, /admin PIN/i);
});
