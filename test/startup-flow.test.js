const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStartupState } = require('../server/startup');

function createFakeSessionManager() {
  return {
    clampState(state) {
      return { ...state, clamped: true };
    },
    createNewSession(type) {
      return { sessionType: type, created: true };
    }
  };
}

test('startup resumes a saved state without prompting', () => {
  const state = resolveStartupState({
    sessionManager: createFakeSessionManager(),
    savedState: { sessionType: 'dua', selectedDuaId: 'kumayl' }
  });

  assert.deepEqual(state, {
    sessionType: 'dua',
    selectedDuaId: 'kumayl',
    clamped: true
  });
});

test('startup defaults to Quran when there is no saved state', () => {
  const state = resolveStartupState({
    sessionManager: createFakeSessionManager(),
    savedState: null
  });

  assert.deepEqual(state, { sessionType: 'quran', created: true });
});
