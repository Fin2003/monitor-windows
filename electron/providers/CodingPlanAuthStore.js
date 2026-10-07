const fs = require('node:fs');
const path = require('node:path');
class CodingPlanAuthStore {
  file() { return path.join(require('electron').app.getPath('userData'), 'coding-plan-credentials.json'); }
  read(id) {
    const file = this.file();
    if (!fs.existsSync(file)) return {};
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))[id];
    return value ? JSON.parse(require('electron').safeStorage.decryptString(Buffer.from(value, 'base64'))) : {};
  }
  write(id, fields) {
    const { safeStorage } = require('electron');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，查询凭据未保存');
    const file = this.file(), all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const next = { ...this.read(id) };
    for (const key of ['apiKey', 'accessKeyId', 'secretAccessKey']) if (fields[key] !== undefined && fields[key] !== '') next[key] = String(fields[key]).trim();
    all[id] = safeStorage.encryptString(JSON.stringify(next)).toString('base64');
    fs.writeFileSync(file + '.tmp', JSON.stringify(all)); fs.renameSync(file + '.tmp', file);
  }
  flags(id) { const auth = this.read(id); return { hasApiKey: !!auth.apiKey, hasAccessKeyId: !!auth.accessKeyId, hasSecretAccessKey: !!auth.secretAccessKey }; }
  remove(id) { const file = this.file(); if (!fs.existsSync(file)) return; const all = JSON.parse(fs.readFileSync(file, 'utf8')); delete all[id]; fs.writeFileSync(file + '.tmp', JSON.stringify(all)); fs.renameSync(file + '.tmp', file); }
}
module.exports = CodingPlanAuthStore;
