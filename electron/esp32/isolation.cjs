const path = require('node:path');
const fs = require('node:fs');

function configureIsolation(app) {
  // Must run before the single-instance lock and all persistent sessions.
  const directory = require('./profile.cjs').profile;
  fs.mkdirSync(directory, { recursive: true });
  app.setName('monitor-esp32');
  app.setPath('userData', directory);
  app.setPath('sessionData', path.join(directory, 'sessions'));
  if (process.platform === 'win32') app.setAppUserModelId('local.monitor.esp32');
  return directory;
}

function liveCollectionEnabled() { return !process.argv.includes('--esp32-passive'); }
module.exports = { configureIsolation, liveCollectionEnabled };
