const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

function waitForServer(proc, port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?role=display`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch (_error) {
        // keep trying
      }
      if (Date.now() > deadline) {
        reject(new Error(`Server did not start. Output: ${proc.output || ''}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function connectAdmin(port, pin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for admin bootstrap')), 3000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'admin', pin })));
    ws.on('message', (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.type === 'bootstrap') {
        clearTimeout(timeout);
        resolve({ ws, message });
      }
    });
    ws.on('error', reject);
  });
}

test('admin websocket can update display language visibility', async () => {
  const port = 5300 + Math.floor(Math.random() * 200);
  const pin = '123456';
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(port), ADMIN_PIN: pin },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.output = '';
  proc.stdout.on('data', (chunk) => { proc.output += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { proc.output += chunk.toString(); });

  try {
    await waitForServer(proc, port);
    const { ws, message: bootstrap } = await connectAdmin(port, pin);
    const nextEnglish = !bootstrap.state.languages.english;

    const update = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for language state update')), 3000);
      ws.on('message', (buffer) => {
        const message = JSON.parse(buffer.toString());
        if (message.type === 'state_update') {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      ws.send(JSON.stringify({
        type: 'admin_set_languages',
        languages: { arabic: true, english: nextEnglish, transliteration: true, farsi: true }
      }));
    });

    assert.deepEqual(update.state.languages, {
      arabic: true,
      english: nextEnglish,
      transliteration: true
    });
    ws.close();
  } finally {
    proc.kill('SIGTERM');
    await new Promise((resolve) => proc.once('exit', resolve));
  }
});
