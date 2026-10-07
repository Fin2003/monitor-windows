const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
const iconPath = path.join(__dirname, 'assets', 'app-icon.png');
const icon = nativeImage.createFromPath(iconPath);
app.on('browser-window-created', (_event, window) => window.setIcon(icon));
for (const window of BrowserWindow.getAllWindows()) window.setIcon(icon);
module.exports = { iconPath };
