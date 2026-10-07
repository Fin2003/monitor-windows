const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildState } = require('../../plugins/tibo-radar/core.cjs');
const { latestRadarPosts } = require('../../plugins/tibo-radar/presentation.cjs');
const { textHash } = require('./radar-detail.cjs');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

class RadarTranslationScheduler {
  constructor({ sourceProfile = require('./profile.cjs').profile, deviceProfile = require('./profile.cjs').profile } = {}) {
    this.sourceProfile = sourceProfile;
    this.deviceProfile = deviceProfile;
    this.stateFile = path.join(sourceProfile, 'tibo-radar-state.json');
    this.modelFile = path.join(sourceProfile, 'tibo-radar-model.json');
    this.cacheFile = path.join(deviceProfile, 'esp32-radar-translations.json');
    this.worker = path.resolve(__dirname, '../../scripts/esp32-radar-translation.cjs');
    this.busy = false;
    this.lastAttempt = 0;
  }
  missing() {
    const state = readJson(this.stateFile), cache = readJson(this.cacheFile) || {};
    if (!state || !fs.existsSync(this.modelFile)) return false;
    return latestRadarPosts(buildState(state.posts || [], Date.now(), { useLLM: true })).slice(0, 12)
      .some(post => cache.items?.[post.id]?.sourceHash !== textHash(post.text));
  }
  tick() {
    if (this.busy || Date.now() - this.lastAttempt < 60000 || !this.missing()) return;
    this.lastAttempt = Date.now(); this.busy = true;
    const launch = require('./helper-launch.cjs').helperLaunch('translation', [`--source-profile=${this.sourceProfile}`, `--device-profile=${this.deviceProfile}`]);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(launch.executable, launch.arguments, {
      cwd: launch.directory, stdio: 'ignore', windowsHide: true, env,
    });
    child.once('exit', () => { this.busy = false; });
    child.once('error', () => { this.busy = false; });
  }
  start() { this.tick(); this.timer = setInterval(() => this.tick(), 30000); return this; }
  stop() { clearInterval(this.timer); }
}

module.exports = { RadarTranslationScheduler };
