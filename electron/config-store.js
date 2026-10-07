const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeOverview } = require('./compact-overview');

class ConfigStore {
  #configPath;
  #data;

  constructor() {
    this.#configPath = path.join(app.getPath('userData'), 'config.json');
    this.#data = this.#load();
  }

  #load() {
    // A crash during an old non-atomic save can leave config.json zero-filled; fall back to the
    // last good copy instead of defaults, which the next save would write over the real config.
    for (const file of [this.#configPath, `${this.#configPath}.bak`]) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
        if (data.compactOverview) data.compactOverview = normalizeOverview(data.compactOverview);
        if (file !== this.#configPath) console.error('Config load: config.json unreadable, restored from config.json.bak');
        return data;
      } catch (e) {
        console.error(`Config load error (${path.basename(file)}):`, e);
      }
    }
    return this.#defaults();
  }

  #defaults() {
    return {
      display: {
        targetDisplayId: null,
        targetDisplayMeta: null,
        autoStart: false,
        customWidth: 640,
        customHeight: 480,
        customX: null,
        customY: null,
      },
      carousel: {
        enabled: true,
        interval: 10,
      },
      plugins: [],
      accountDisplayEnabled: {},
      selectedAccounts: {},
      presets: [],
      activePresetId: null,
    };
  }

  #save() {
    // Write to a temp file, flush it to disk, keep the previous good file as .bak, then rename,
    // so a power loss or bluescreen never leaves a truncated or zero-filled config.json.
    const temp = `${this.#configPath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.#configPath), { recursive: true });
      const fd = fs.openSync(temp, 'w');
      try {
        fs.writeSync(fd, JSON.stringify(this.#data, null, 2), null, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        JSON.parse(fs.readFileSync(this.#configPath, 'utf8').replace(/^﻿/, ''));
        fs.copyFileSync(this.#configPath, `${this.#configPath}.bak`);
      } catch (_) { /* Missing or damaged current file: keep the existing .bak. */ }
      fs.renameSync(temp, this.#configPath);
    } catch (e) {
      console.error('Config save error:', e);
    }
  }

  get(key) {
    return key ? this.#data[key] : this.#data;
  }

  set(key, value) {
    this.#data[key] = value;
    this.#save();
  }

  getAll() {
    return this.#data;
  }

  getPresets() {
    return this.#data.presets || [];
  }

  savePreset(preset) {
    if (!preset.id) preset.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!preset.createdAt) preset.createdAt = Date.now();
    preset.updatedAt = Date.now();

    const presets = this.#data.presets || [];
    const idx = presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      presets[idx] = preset;
    } else {
      presets.push(preset);
    }
    this.#data.presets = presets;
    this.#data.activePresetId = preset.id;
    this.#save();
    return preset;
  }

  loadPreset(presetId) {
    const presets = this.#data.presets || [];
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return null;

    this.#data.activePresetId = presetId;

    if (preset.data.display) this.#data.display = { ...this.#data.display, ...preset.data.display };
    if (preset.data.theme !== undefined) this.#data.theme = preset.data.theme;
    if (preset.data.carousel) this.#data.carousel = { ...this.#data.carousel, ...preset.data.carousel };
    if (preset.data.plugins) this.#data.plugins = preset.data.plugins;
    if (preset.data.compactOverview) this.#data.compactOverview = normalizeOverview(preset.data.compactOverview);
    if (preset.data.selectedProviders) {
      const VALID = ['volcengine', 'xfyun', 'opencodego'];
      this.#data.selectedProviders = preset.data.selectedProviders.map(k => {
        if (k.includes('_')) return k;
        const ci = k.indexOf(':');
        const type = ci >= 0 ? k.slice(0, ci) : k;
        if (!VALID.includes(type)) return k;
        return type + '_0' + (ci >= 0 ? k.slice(ci) : '');
      });
    }
    if (preset.data.providerNames) {
      this.#data.providerNames = { ...preset.data.providerNames, ...(this.#data.providerNames || {}) };
    }
    if (preset.data.accountDisplayEnabled) {
      this.#data.accountDisplayEnabled = { ...preset.data.accountDisplayEnabled };
    }

    this.#save();
    return preset;
  }

  deletePreset(presetId) {
    this.#data.presets = (this.#data.presets || []).filter(p => p.id !== presetId);
    if (this.#data.activePresetId === presetId) {
      this.#data.activePresetId = null;
    }
    this.#save();
  }

  getActivePresetId() {
    return this.#data.activePresetId || null;
  }

  setActivePresetId(id) {
    this.#data.activePresetId = id;
    this.#save();
  }

  snapshotCurrent() {
    return {
      compactOverview: normalizeOverview(this.#data.compactOverview),
      display: { ...this.#data.display },
      theme: this.#data.theme,
      carousel: { ...this.#data.carousel },
      plugins: this.#data.plugins ? this.#data.plugins.map(p => ({ ...p })) : [],
      selectedProviders: this.#data.selectedProviders ? [...this.#data.selectedProviders] : [],
      accountDisplayEnabled: this.#data.accountDisplayEnabled ? { ...this.#data.accountDisplayEnabled } : {},
      providerNames: this.#data.providerNames ? { ...this.#data.providerNames } : {},
    };
  }
}

module.exports = ConfigStore;
