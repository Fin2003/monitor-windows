const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'linux') {
  console.error('Linux engine builds must run on Linux or inside WSL.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'plugins', 'system-monitor', 'engine', 'linux');
const build = path.join(root, 'plugins', 'system-monitor', 'engine', '.build', 'linux');
const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
const output = path.join(root, 'plugins', 'system-monitor', 'engine', `linux-${architecture}`, 'SystemMonitorEngine');

fs.mkdirSync(path.dirname(output), { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_CXX_COMPILER=g++', `-DSYSTEM_MONITOR_ARCH=${architecture}`]);
run('cmake', ['--build', build, '--config', 'Release', '--parallel']);
fs.chmodSync(output, 0o755);
console.log(`Built ${output}`);
