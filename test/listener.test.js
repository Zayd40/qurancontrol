const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createListener } = require('../server/listener');

function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-listener-'));
  fs.mkdirSync(path.join(rootDir, 'data'));
  const workers = []; const positions = []; const statuses = [];
  const state = { sessionType: 'quran', blanked: false, quran: { surahNumber: 1, ayahNumber: 1 } };
  const quranDataset = { ayahDataBySurah: new Map([[1, new Map([[1, { arabic: 'بسم الله الرحمن الرحيم' }], [2, { arabic: 'الحمد لله رب العالمين' }]])]]) };
  const listener = createListener({ rootDir, quranDataset, duasById: new Map(), getState: () => state,
    applyPosition: (p) => positions.push(p), onStatus: (s) => statuses.push(s),
    spawnProcess: (command, args) => {
      const worker = new EventEmitter();
      Object.assign(worker, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), command, args, killed: false });
      worker.kill = () => { worker.killed = true; };
      workers.push(worker);
      return worker;
    }
  });
  t.after(() => { listener.stop(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  const emit = (worker, event) => worker.stdout.write(JSON.stringify(event) + '\n');
  const transcript = (epoch) => ({ type: 'transcript', epoch, text: 'الحمد لله رب العالمين' });
  return { listener, workers, positions, statuses, emit, transcript, state };
}

test('stale transcripts and manual pause cannot move the display; resume clears pending evidence', (t) => {
  const f = fixture(t); f.listener.start();
  const worker = f.workers[0]; const epoch = f.listener.snapshot().epoch;
  f.emit(worker, f.transcript(epoch));
  f.listener.pause();
  f.emit(worker, f.transcript(epoch)); f.emit(worker, f.transcript(epoch));
  assert.equal(f.positions.length, 0);
  f.listener.start();
  assert.equal(f.workers.length, 1, 'resume should reuse the loaded model');
  const nextEpoch = f.listener.snapshot().epoch;
  f.emit(worker, f.transcript(epoch)); f.emit(worker, f.transcript(nextEpoch));
  assert.equal(f.positions.length, 0);
  f.emit(worker, f.transcript(nextEpoch));
  assert.equal(f.positions.length, 1);
});

test('blanked display ignores recognition', (t) => {
  const f = fixture(t); f.listener.start(); f.state.blanked = true;
  for (let i = 0; i < 5; i += 1) f.emit(f.workers[0], f.transcript(f.listener.snapshot().epoch));
  assert.equal(f.positions.length, 0);
});

test('switching mode restarts with the appropriate model and ignores old process output', (t) => {
  const f = fixture(t); f.listener.start(); const old = f.workers[0];
  f.state.sessionType = 'dua'; f.listener.start();
  assert.equal(old.killed, true);
  assert.ok(f.workers[1].args.includes('dua'));
  f.emit(old, { type: 'status', state: 'listening', message: 'wrong model' });
  assert.notEqual(f.listener.snapshot().message, 'wrong model');
});

test('invalid device settings are rejected before launching a process', (t) => {
  const f = fixture(t);
  for (const settings of [{ device: '-1' }, { device: 'not-a-number' }, { noiseFloor: 0 }, { noiseFloor: Infinity }]) {
    assert.throws(() => f.listener.start(settings));
  }
  assert.equal(f.workers.length, 0);
});

test('a crashed worker shows an actionable error and a restart is possible', (t) => {
  const f = fixture(t); f.listener.start();
  f.workers[0].stderr.write('No CUDA driver'); f.workers[0].emit('exit', 1);
  assert.equal(f.listener.snapshot().state, 'error');
  assert.match(f.listener.snapshot().message, /CUDA driver/);
  f.listener.start(); assert.equal(f.workers.length, 2);
});

test('stopping releases the worker and late exit does not overwrite stopped status', (t) => {
  const f = fixture(t); f.listener.start(); const worker = f.workers[0];
  f.listener.stop(); worker.emit('exit', null);
  assert.equal(worker.killed, true);
  assert.equal(f.listener.snapshot().state, 'stopped');
});


test('Stop disables audio capture and Go re-enables it without a new model process', (t) => {
  const f = fixture(t); f.listener.start();
  const worker = f.workers[0];
  const commands = () => worker.stdin.read().toString().trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(commands().at(-1).enabled, true);
  f.listener.pause('Stopped. Press Go to continue following.');
  assert.equal(commands().at(-1).enabled, false);
  assert.equal(f.listener.snapshot().paused, true);
  f.emit(worker, { type: 'level', level: 1 });
  assert.equal(f.listener.snapshot().level, 0);
  f.listener.start();
  assert.equal(commands().at(-1).enabled, true);
  assert.equal(f.listener.snapshot().paused, false);
  assert.equal(f.workers.length, 1);
});
