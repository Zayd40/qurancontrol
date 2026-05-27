const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForHttp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    async function attempt() {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve(response);
          return;
        }
      } catch (_error) {
        // retry until timeout
      }

      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 100);
    }

    attempt();
  });
}

async function startServer(t, env = {}) {
  const port = String(6200 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await wait(100);
  });

  await waitForHttp(`http://127.0.0.1:${port}/api/bootstrap`);
  return { port, child, logs: () => logs };
}

function openWs(port, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for websocket response'));
    }, 3000);

    ws.on('open', () => {
      ws.send(JSON.stringify(hello));
    });

    ws.on('message', (buffer) => {
      clearTimeout(timeout);
      resolve({ ws, message: JSON.parse(buffer.toString()) });
    });

    ws.on('error', reject);
  });
}

test('admin websocket requires the configured PIN before admin commands are accepted', async (t) => {
  const { port } = await startServer(t, { ADMIN_PIN: '2468' });

  const wrong = await openWs(port, { type: 'hello', role: 'admin', pin: '0000' });
  assert.equal(wrong.message.type, 'error');
  assert.match(wrong.message.message, /PIN/i);
  wrong.ws.close();

  const right = await openWs(port, { type: 'hello', role: 'admin', pin: '2468' });
  assert.equal(right.message.type, 'bootstrap');
  assert.equal(right.message.socketRole, 'admin');
  const initialBlanked = Boolean(right.message.state.blanked);
  right.ws.send(JSON.stringify({ type: 'admin_toggle_blank' }));

  const stateUpdate = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for state update')), 3000);
    right.ws.on('message', (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.type === 'state_update') {
        clearTimeout(timeout);
        resolve(message);
      }
    });
  });

  assert.equal(stateUpdate.state.blanked, !initialBlanked);
  right.ws.close();
});

test('admin bootstrap endpoint does not expose admin controls without the configured PIN', async (t) => {
  const { port } = await startServer(t, { ADMIN_PIN: '1357' });

  const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?role=admin&pin=0000`);
  assert.equal(response.status, 403);

  const ok = await fetch(`http://127.0.0.1:${port}/api/bootstrap?role=admin&pin=1357`);
  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.socketRole, 'admin');
});
