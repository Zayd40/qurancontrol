function resolveStartupState({ sessionManager, savedState }) {
  return savedState ? sessionManager.clampState(savedState) : sessionManager.createNewSession('quran');
}

module.exports = {
  resolveStartupState
};
