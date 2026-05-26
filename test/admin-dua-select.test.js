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

function waitForStateUpdate(ws, trigger, predicate, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 3000);
    const onMessage = (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.type === 'state_update' && predicate(message)) {
        clearTimeout(timeout);
        ws.off('message', onMessage);
        resolve(message);
      }
    };
    ws.on('message', onMessage);
    trigger();
  });
}

test('admin websocket can switch the selected dua during a Dua session', async () => {
  const port = 5500 + Math.floor(Math.random() * 200);
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
    const duas = bootstrap.catalog.duas;
    assert.ok(Array.isArray(duas) && duas.length >= 2, 'expected at least two duas in catalog');

    const currentDuaId = bootstrap.state.selectedDuaId || '';
    const targetDuaId = duas.find((dua) => dua.id !== currentDuaId)?.id || duas[0].id;

    const update = await waitForStateUpdate(
      ws,
      () => ws.send(JSON.stringify({ type: 'admin_select_dua', selectedDuaId: targetDuaId })),
      (message) => message.state.sessionType === 'dua' && message.state.selectedDuaId === targetDuaId,
      'selected Dua change'
    );

    assert.equal(update.session.selectedDuaId, targetDuaId);
    assert.equal(update.session.lockedDua.id, targetDuaId);
    assert.equal(update.state.dua.lineIndex, 1);
    assert.equal(update.content.mode, 'dua');
    assert.equal(update.content.dua.duaId, targetDuaId);
    ws.close();
  } finally {
    proc.kill('SIGTERM');
    await new Promise((resolve) => proc.once('exit', resolve));
  }
});
