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
      const duaChoice = await askChoice(
        rl,
        'Select dua:\n1) Dua Iftitah\n2) Dua Kumayl',
        ['1', '2']
      );
      const selectedDuaId = duaChoice === '2' ? 'kumayl' : 'iftitah';
      return sessionManager.createNewSession('dua', { selectedDuaId });
    }

    const eventChoice = await askChoice(
      rl,
      'Select guided event:\n1) Laylat al-Qadr — 21st Night',
      ['1']
    );

    if (eventChoice === '1') {
      return sessionManager.createNewSession('guided_event', {
        selectedEventId: 'laylat-al-qadr-21'
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
