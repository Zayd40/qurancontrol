const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

async function askChoice(rl, prompt, allowedChoices) {
  const choiceSet = new Set(allowedChoices);

  while (true) {
    const answer = String(await rl.question(`${prompt}\n> `)).trim();
    if (choiceSet.has(answer)) {
      return answer;
    }
  }
}

function buildIndexedPrompt(title, items) {
  return `${title}\n${items.map((item, index) => `${index + 1}) ${item}`).join('\n')}`;
}

async function promptForStartupSession({ sessionManager, savedState }) {
  if (!stdin.isTTY || !stdout.isTTY) {
    return savedState ? sessionManager.clampState(savedState) : sessionManager.createNewSession('quran');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (savedState) {
      const summary = sessionManager.summarizeSession(savedState);
      const resumeChoice = await askChoice(
        rl,
        `Start previous session?\n1) Yes — ${summary}\n2) No — choose a new session`,
        ['1', '2']
      );

      if (resumeChoice === '1') {
        return sessionManager.clampState(savedState);
      }
    }

    const sessionChoice = await askChoice(
      rl,
      'Select session type:\n1) Quran\n2) Dua\n3) Guided Event',
      ['1', '2', '3']
    );

    if (sessionChoice === '1') {
      return sessionManager.createNewSession('quran');
    }

    if (sessionChoice === '2') {
      const duas = sessionManager.listDuas();
      const allowedChoices = duas.map((_, index) => String(index + 1));
      const duaChoice = await askChoice(
        rl,
        buildIndexedPrompt(
          'Select dua:',
          duas.map((dua) => dua.title)
        ),
        allowedChoices
      );
      const selectedDuaId = duas[Number(duaChoice) - 1]?.id || sessionManager.getDefaultDuaId();
      return sessionManager.createNewSession('dua', { selectedDuaId });
    }

    const eventChoice = await askChoice(
      rl,
      'Select guided event:\n1) Laylat al-Qadr — 2026',
      ['1']
    );

    if (eventChoice === '1') {
      return sessionManager.createNewSession('guided_event', {
        selectedEventId: 'laylat-al-qadr-2026'
      });
    }

    return sessionManager.createNewSession('quran');
  } finally {
    rl.close();
  }
}

module.exports = {
  promptForStartupSession
};
