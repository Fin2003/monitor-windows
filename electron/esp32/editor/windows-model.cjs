// The Tibo radar analysis model is owned by the Windows Monitor, which re-reads this file on every
// analysis. The editor writes it in the same shape as plugins/tibo-radar/model-connection.cjs; the API key
// is encrypted with the Monitor profile's safeStorage key by an Electron helper.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalize } = require('../../../plugins/tibo-radar/model-connection.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const PROFILE = require('../profile.cjs').profile;
const FILE = path.join(PROFILE, 'tibo-radar-model.json');
const BACKUPS = path.join(PROFILE, 'backups');

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function encrypt(secret, profile = PROFILE) {
  const launch = require('../helper-launch.cjs').helperLaunch('encrypt');
  // Electron's main process cannot read stdin on Windows: hand the secret over in a private temp file.
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'monitor-secret-'));
  const secretFile = path.join(folder, 'secret');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  const env = { ...process.env, MONITOR_PROFILE: profile, MONITOR_SECRET_FILE: secretFile };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(launch.executable, launch.arguments, { env, windowsHide: true, cwd: launch.directory });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); fs.rmSync(folder, { recursive: true, force: true }); reject(new Error('加密超时')); }, 20000);
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      fs.rmSync(folder, { recursive: true, force: true });
      const value = out.trim().split(/\r?\n/).pop() || '';
      if (code === 0 && /^[A-Za-z0-9+/]+=*$/.test(value)) resolve(value);
      else reject(new Error('API Key 加密失败' + (err ? '：' + err.trim().slice(0, 120) : '')));
    });
  });
}

function createWindowsModel({ file = FILE, backups = BACKUPS, encryptSecret = encrypt } = {}) {
  return {
    get() {
      const c = read(file);
      return { name: c.name || '', baseUrl: c.baseUrl || '', format: c.format || 'chat', model: c.model || '', hasApiKey: !!c.encryptedKey };
    },
    async save(values) {
      const { endpoint, ...config } = normalize(values);
      const saved = read(file);
      const key = String(values.apiKey || '').trim();
      let encryptedKey = saved.encryptedKey || '';
      if (key) encryptedKey = await encryptSecret(key);
      else if (encryptedKey && (config.baseUrl !== saved.baseUrl || config.format !== saved.format)) {
        throw new Error('更换地址或格式后，请重新输入 API Key');
      }
      if (fs.existsSync(file)) {
        fs.mkdirSync(backups, { recursive: true });
        fs.copyFileSync(file, path.join(backups, `tibo-radar-model-${Date.now()}.json`));
      }
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ ...config, encryptedKey }, null, 2));
      fs.renameSync(temp, file);
      return this.get();
    },
  };
}

module.exports = { createWindowsModel, MODEL_FILE: FILE };
