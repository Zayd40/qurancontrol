const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('./loaders');

function createSessionStore(rootDir) {
  const filePath = path.join(rootDir, 'data', 'previous-session.json');

  return {
    load() {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return readJsonFile(filePath, null);
    },
    save(state) {
      writeJsonFile(filePath, state);
    },
    filePath
  };
}

module.exports = {
  createSessionStore
};
