const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/control.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/control.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/control.js'), 'utf8');

test('controller has a visible time element in the header', () => {
  assert.match(html, /id="controllerClock"/);
  assert.match(html, /class="controller-clock"/);
});

test('controller script updates the visible clock every second', () => {
  assert.match(js, /controllerClock/);
  assert.match(js, /function setClock\(/);
  assert.match(js, /setInterval\(setClock, 1000\)/);
});

test('controller CSS is optimized for full-screen phone operation and large navigation', () => {
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /font-size:\s*clamp\(24px, 8vw, 42px\)/);
});
