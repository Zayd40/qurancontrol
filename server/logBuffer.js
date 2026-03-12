function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createLogBuffer(limit = 20) {
  const items = [];

  return {
    add(action, detail, timestamp = new Date()) {
      const line = `[${formatTimestamp(timestamp)}] ${String(action || 'INFO').toUpperCase()} — ${detail}`;
      items.unshift(line);
      if (items.length > limit) {
        items.length = limit;
      }
      return line;
    },
    list(maxItems = items.length) {
      return items.slice(0, Math.max(0, Number(maxItems) || 0));
    }
  };
}

module.exports = {
  createLogBuffer,
  formatTimestamp
};
