function createDashboard() {
  let snapshot = null;

  function render(nextSnapshot) {
    snapshot = nextSnapshot;

    const lines = [
      'Al Zahraa Centre Presenter System',
      '',
      `Mode: ${snapshot.modeLabel}`,
      `Selected Content: ${snapshot.selectedContent}`,
      '',
      'Display URL:',
      snapshot.displayUrl,
      '',
      'Controller URL:',
      snapshot.controllerUrl,
      '',
      'Controller access:',
      '- Scan the QR code on the display',
      '- Or open the Controller URL manually on the phone',
      '',
      'Recent controller activity:',
      ...snapshot.recentActivity,
      '',
      'Press CTRL+C to stop the server'
    ];

    if (process.stdout.isTTY) {
      process.stdout.write('\x1Bc');
    }

    process.stdout.write(`${lines.join('\n')}\n`);
  }

  return {
    render(nextSnapshot) {
      render(nextSnapshot);
    },
    rerender() {
      if (snapshot) {
        render(snapshot);
      }
    }
  };
}

module.exports = {
  createDashboard
};
