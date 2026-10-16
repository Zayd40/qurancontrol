const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createFollowMatcher } = require('./follow-matcher');

function createListener({ rootDir, quranDataset, duasById, getState, applyPosition, onStatus, spawnProcess = spawn }) {
  const matcher = createFollowMatcher({ quranDataset, duasById });
  const venv = path.join(rootDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.LISTENER_PYTHON || (fs.existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3'));
  const script = path.join(rootDir, 'listener', 'worker.py');
  let child = null;
  let epoch = 0;
  let mode = null;
  let status = { state: 'stopped', paused: false, message: 'Choose the mixer input, then start listening.', level: 0 };
  let settings = { device: null, noiseFloor: 0.008 };
  const settingsPath = path.join(rootDir, 'data', 'listener-settings.json');
  try { settings = validateSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))); } catch (_) { /* first run */ }
  function publish(update) { status = { ...status, ...update }; onStatus(snapshot()); }
  function snapshot() { return { ...status, settings, epoch }; }
  function context() {
    epoch += 1;
    matcher.reset();
    if (child?.stdin.writable) child.stdin.write(`${JSON.stringify({ epoch })}\n`);
  }
  function validateSettings(value) {
    const device = value.device === null || value.device === '' || value.device === undefined ? null : Number(value.device);
    const noiseFloor = Number(value.noiseFloor ?? 0.008);
    if ((device !== null && (!Number.isInteger(device) || device < 0 || device > 10000)) ||
        !Number.isFinite(noiseFloor) || noiseFloor < 0.001 || noiseFloor > 0.2) throw new Error('Choose a valid audio input and sensitivity.');
    return { device, noiseFloor };
  }
  function stop() {
    const old = child;
    child = null;
    context();
    if (old) { old.stdin.destroy(); old.kill(); }
    publish({ state: 'stopped', paused: false, level: 0, message: 'Listening stopped.' });
  }
  function pause(message = 'Manual control — press Resume following when ready.') {
    context();
    if (child) publish({ paused: true, message });
  }
  function start(value = settings) {
    const nextSettings = validateSettings(value);
    const nextMode = getState().sessionType;
    if (child && mode === nextMode && JSON.stringify(settings) === JSON.stringify(nextSettings)) {
      context();
      publish({ paused: false, message: 'Listening — waiting for a clear passage.' });
      return;
    }
    stop();
    settings = nextSettings;
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    mode = nextMode;
    publish({ state: 'loading', paused: false, message: 'Loading local speech model… First use downloads the model.' });
    const args = ['-u', script, '--mode', mode, '--noise-floor', String(settings.noiseFloor)];
    if (settings.device !== null) args.push('--device', String(settings.device));
    const worker = spawnProcess(python, args, { cwd: rootDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    child = worker;
    worker.stdin.on('error', () => {});
    context();
    let diagnostics = '';
    worker.stderr.on('data', (buffer) => { diagnostics = (diagnostics + buffer.toString()).slice(-2000); });
    const lines = readline.createInterface({ input: worker.stdout });
    lines.on('line', (line) => {
      if (child !== worker || line.length > 20000) return;
      let event;
      try { event = JSON.parse(line); } catch (_) { return; }
      if (event.type === 'status') {
        publish({ state: event.state, message: status.paused ? status.message : event.message, engine: event.engine });
      } else if (event.type === 'level') {
        publish({ level: event.level, clipping: event.clipping, audioWarning: event.warning || '' });
      } else if (event.type === 'transcript' && event.epoch === epoch && !status.paused && !getState().blanked && typeof event.text === 'string') {
        const match = matcher.locate(event.text.slice(0, 2000), getState());
        publish({ message: match.reason, transcript: event.text.slice(0, 500), score: match.score || 0 });
        if (match.position) applyPosition(match.position);
      }
    });
    worker.on('error', (error) => {
      if (child !== worker) return;
      child = null;
      publish({ state: 'error', level: 0, message: `Could not start listener: ${error.message}. Run Setup-Windows.cmd first.` });
    });
    worker.on('exit', (code) => {
      lines.close();
      if (child !== worker) return;
      child = null;
      publish({ state: 'error', level: 0, message: `Listener stopped (${code}). ${diagnostics.trim() || 'Check the selected input and restart listening.'}` });
    });
  }
  function devices() {
    return new Promise((resolve, reject) => {
      const worker = spawnProcess(python, ['-u', script, '--list-devices'], { cwd: rootDir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let output = ''; let errors = '';
      const timer = setTimeout(() => { worker.kill(); reject(new Error('Audio device discovery timed out. Run Setup-Windows.cmd.')); }, 15000);
      worker.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-100000); });
      worker.stderr.on('data', (chunk) => { errors = (errors + chunk.toString()).slice(-1000); });
      worker.on('error', (error) => { clearTimeout(timer); reject(new Error(`Run Setup-Windows.cmd first. ${error.message}`)); });
      worker.on('close', (code) => {
        clearTimeout(timer);
        try { if (code !== 0) throw new Error(`Run Setup-Windows.cmd first, then check the mixer connection. ${errors || 'Cannot read audio devices.'}`); resolve(JSON.parse(output)); }
        catch (error) { reject(error); }
      });
    });
  }
  return { start, stop, pause, context, snapshot, devices };
}

module.exports = { createListener };
