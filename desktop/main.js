const { app, BrowserWindow, dialog, shell } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

const DEFAULT_PORT = 5183;
let serverProcess = null;
let mainWindow = null;

function appRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
}

function serverEntryPoint() {
  return path.join(appRoot(), 'server/index.js');
}

function adminUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/admin`;
}

function startServer() {
  if (serverProcess) {
    return serverProcess;
  }

  const port = process.env.PORT || String(DEFAULT_PORT);
  serverProcess = fork(serverEntryPoint(), [], {
    cwd: appRoot(),
    env: {
      ...process.env,
      PORT: port,
      BROWSER: 'none'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  serverProcess.stdout?.on('data', (chunk) => console.log(`[server] ${chunk}`));
  serverProcess.stderr?.on('data', (chunk) => console.error(`[server] ${chunk}`));
  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Quran Control server stopped', `The local server exited (${code ?? signal ?? 'unknown'}).`);
    }
  });

  return serverProcess;
}

async function waitForServer(port = DEFAULT_PORT, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?role=display`, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('Timed out waiting for the Quran Control server to start.');
}

async function createWindow() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  startServer();
  await waitForServer(port);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title: 'Quran Control',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(adminUrl(port));
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    dialog.showErrorBox('Quran Control failed to start', error.message);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => dialog.showErrorBox('Quran Control failed to start', error.message));
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});
