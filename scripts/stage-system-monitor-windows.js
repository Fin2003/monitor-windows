const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'plugins', 'system-monitor', 'engine', 'win-x64');
const source = path.join(output, 'SystemMonitorEngine.exe');
const staged = path.join(output, 'SystemMonitorEngine.current.exe');

if (!fs.existsSync(source)) {
  throw new Error(`Windows engine publish output was not found: ${source}`);
}

fs.copyFileSync(source, staged);
console.log(`Staged ${staged}`);
