const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

test('presenter serves all screens, synchronises phone navigation and rejects malformed/display commands', { timeout: 15000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-presenter-'));
  for (const dir of ['server', 'data', 'public']) fs.cpSync(path.join(root, dir), path.join(temporary, dir), { recursive: true });
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.js'], { cwd: temporary, env: {
    ...process.env, PORT: String(port), NO_STARTUP_PROMPT: '1', OPEN_ADMIN_ON_START: '0', LISTENER_AUTOSTART: '0',
    NODE_PATH: path.join(root, 'node_modules')
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.terminate());
    const done = new Promise((resolve) => server.once('exit', resolve));
    if (server.exitCode === null) { server.kill(); await done; }
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-3000); });
  server.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-3000); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { ready = (await fetch(`${base}/api/bootstrap`)).ok; if (ready) break; } catch (_) { /* wait for listener */ }
    if (server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  for (const route of ['/admin', '/control', '/display']) assert.equal((await fetch(base + route)).status, 200);
  async function connect(role) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const response = nextMessage(socket, (message) => message.type === 'bootstrap');
    socket.send(JSON.stringify({ type: 'hello', role }));
    return { socket, bootstrap: await response };
  }
  const display = await connect('display');
  const phone = await connect('control');
  const admin = await connect('admin');
  assert.equal(admin.bootstrap.listener.state, 'stopped');
  assert.equal(display.bootstrap.listener, undefined);
  let result = nextMessage(phone.socket, (message) => message.type === 'error');
  phone.socket.send('null');
  assert.match((await result).message, /Invalid command/);
  result = nextMessage(display.socket, (message) => message.type === 'error');
  display.socket.send(JSON.stringify({ type: 'step', direction: 'next' }));
  assert.match((await result).message, /Only controller/);
  result = nextMessage(display.socket, (message) => message.type === 'state_update');
  phone.socket.send(JSON.stringify({ type: 'admin_set_mode', sessionType: 'dua', selectedDuaId: 'kumayl' }));
  const mode = await result;
  assert.equal(mode.state.sessionType, 'dua');
  assert.equal(mode.state.selectedDuaId, 'kumayl');
  result = nextMessage(display.socket, (message) => message.type === 'state_update');
  phone.socket.send(JSON.stringify({ type: 'step', direction: 'next' }));
  assert.equal((await result).state.dua.lineIndex, 2);
  result = nextMessage(phone.socket, (message) => message.type === 'error');
  phone.socket.send(JSON.stringify({ type: 'listener_start' }));
  assert.match((await result).message, /not available/);
});

function nextMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', handler); reject(new Error('Timed out waiting for presenter message')); }, 4000);
    function handler(buffer) {
      const message = JSON.parse(buffer.toString());
      if (!predicate(message)) return;
      clearTimeout(timer); socket.off('message', handler); resolve(message);
    }
    socket.on('message', handler);
  });
}
