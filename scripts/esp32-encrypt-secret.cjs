// Electron helper for the ESP32 editor: encrypts the secret in MONITOR_SECRET_FILE (deleted on read) with the Monitor profile's safeStorage key
// (Local State is copied into a throwaway userData folder) and prints base64. Never prints the secret.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profile = process.env.MONITOR_PROFILE || require('../electron/esp32/profile.cjs').profile;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-encrypt-'));
fs.copyFileSync(path.join(profile, 'Local State'), path.join(temp, 'Local State'));
app.setPath('userData', temp);
app.on('window-all-closed', () => {});


app.whenReady().then(async () => {
  let code = 1;
  try {
    const file = process.env.MONITOR_SECRET_FILE;
    const secret = file ? fs.readFileSync(file, 'utf8').trim() : '';
    if (file) fs.rmSync(file, { force: true });
    if (!secret) throw new Error('empty input');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption unavailable');
    const encrypted = safeStorage.encryptString(secret);
    if (safeStorage.decryptString(encrypted) !== secret) throw new Error('round trip failed');
    process.stdout.write(encrypted.toString('base64') + '\n');
    code = 0;
  } catch (error) {
    process.stderr.write(error.message + '\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(code);
  }
});
