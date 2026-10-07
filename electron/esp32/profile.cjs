const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const packaged = root.includes(`${path.sep}app.asar`);
const profile = process.env.MONITOR_ESP32_PROFILE
  ? path.resolve(process.env.MONITOR_ESP32_PROFILE)
  : packaged ? path.join(process.env.APPDATA, 'monitor-esp32') : path.join(root, '.device-profile');
module.exports = { profile, root, packaged };
