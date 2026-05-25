const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionManager } = require('../server/session');
const { buildGuidedEventChoices } = require('../server/cli');

test('guided event startup choices are built from loaded event data', () => {
  const sessionManager = createSessionManager({
    metadata: { surahs: [] },
    quranDataset: { ayahDataBySurah: new Map() },
    duasById: new Map(),
    eventsById: new Map([
      ['second-event', { id: 'second-event', title: 'Second Event', sections: [{ title: 'B', slides: [{}] }] }],
      ['first-event', { id: 'first-event', title: 'First Event', sections: [{ title: 'A', slides: [{}] }] }]
    ])
  });

  const choices = buildGuidedEventChoices(sessionManager);

  assert.deepEqual(choices.allowedChoices, ['1', '2']);
  assert.deepEqual(
    choices.items.map((item) => item.id),
    ['first-event', 'second-event']
  );
  assert.match(choices.prompt, /1\) First Event/);
  assert.match(choices.prompt, /2\) Second Event/);
});

test('session manager keeps selected guided events instead of forcing the default event', () => {
  const eventsById = new Map([
    ['alpha', { id: 'alpha', title: 'Alpha', sections: [{ title: 'A', slides: [{}] }] }],
    ['beta', { id: 'beta', title: 'Beta', sections: [{ title: 'B', slides: [{}] }] }]
  ]);

  const sessionManager = createSessionManager({
    metadata: { surahs: [] },
    quranDataset: { ayahDataBySurah: new Map() },
    duasById: new Map(),
    eventsById
  });

  const state = sessionManager.createNewSession('guided_event', { selectedEventId: 'beta' });

  assert.equal(state.selectedEventId, 'beta');
  assert.equal(sessionManager.getPublicSessionData(state).lockedEvent.title, 'Beta');
});
