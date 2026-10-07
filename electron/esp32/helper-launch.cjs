const path = require('node:path');
const { app } = require('electron');
function helperLaunch(worker, extraArguments = []) {
  return { executable: process.execPath,
    arguments: [...(app.isPackaged ? [] : [app.getAppPath()]), `--esp32-worker=${worker}`, ...extraArguments],
    directory: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath() };
}
module.exports = { helperLaunch };
