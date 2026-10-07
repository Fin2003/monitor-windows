// The ESP32 bridge shares manual reset marks with the desktop Monitor's radar runtime.
const path = require('node:path');
const shared = require('../../plugins/tibo-radar/manual-resets.cjs');
const DEFAULT_FILE = path.join(require('./profile.cjs').profile, shared.FILE_NAME);
module.exports = { ...shared, DEFAULT_FILE };
