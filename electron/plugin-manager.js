const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class PluginManager {
  #configStore;
  #pluginsDir;

  constructor(configStore) {
    this.#configStore = configStore;
    this.#pluginsDir = path.join(app.getPath('userData'), 'plugins');
    fs.mkdirSync(this.#pluginsDir, { recursive: true });
  }

  getPluginList() {
    const config = this.#configStore.get('plugins') || [];
    const diskPlugins = this.#scanDiskPlugins();

    const merged = [];
    const seen = new Set();

    for (const cfg of config) {
      const disk = diskPlugins.find(d => d.id === cfg.id);
      if (disk) {
        merged.push({ ...disk, ...cfg });
        seen.add(cfg.id);
      }
    }

    for (const disk of diskPlugins) {
      if (!seen.has(disk.id)) {
        merged.push({ ...disk, enabled: disk.defaultEnabled !== false, duration: 10 });
      }
    }

    this.#configStore.set('plugins', merged);
    return merged;
  }

  #scanDiskPlugins() {
    const plugins = [];

    const builtinDir = path.join(__dirname, '..', 'plugins');
    if (fs.existsSync(builtinDir)) {
      this.#scanDir(builtinDir, plugins, 'builtin');
    }

    this.#scanDir(this.#pluginsDir, plugins, 'user');

    return plugins;
  }

  #scanDir(dir, plugins, type) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginPath = path.join(dir, entry.name);
        const manifestPath = path.join(pluginPath, 'manifest.json');
        const htmlPath = path.join(pluginPath, 'index.html');

        if (!fs.existsSync(htmlPath)) continue;

        let manifest = { id: entry.name, name: entry.name, icon: '📄' };
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
          } catch (_) {}
        }

        plugins.push({
          id: manifest.id || entry.name,
          name: manifest.name || entry.name,
          icon: manifest.icon || '📄',
          type,
          path: pluginPath,
          htmlPath,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          defaultEnabled: manifest.defaultEnabled !== false,
          managerEntry: manifest.managerEntry || '',
           sourceName: manifest.sourceName || '',
           sourceUrl: manifest.sourceUrl || '',
           license: manifest.license || '',
           sources: Array.isArray(manifest.sources) ? manifest.sources : [],
         });
      }
    } catch (_) {}
  }

  install(pluginPath) {
    const stat = fs.statSync(pluginPath);
    if (!stat.isDirectory()) return { error: 'Not a directory' };

    const manifestPath = path.join(pluginPath, 'manifest.json');
    const htmlPath = path.join(pluginPath, 'index.html');
    if (!fs.existsSync(htmlPath)) return { error: 'No index.html found' };

    let manifest = { id: path.basename(pluginPath) };
    if (fs.existsSync(manifestPath)) {
      manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    }

    const targetDir = path.join(this.#pluginsDir, manifest.id);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.cpSync(pluginPath, targetDir, { recursive: true });

    return { success: true, id: manifest.id };
  }

  uninstall(pluginId) {
    const plugins = this.getPluginList();
    const plugin = plugins.find(p => p.id === pluginId);
    if (!plugin) return { error: 'Plugin not found' };

    if (fs.existsSync(plugin.path)) {
      fs.rmSync(plugin.path, { recursive: true, force: true });
    }

    const config = this.#configStore.get('plugins') || [];
    this.#configStore.set('plugins', config.filter(p => p.id !== pluginId));

    return { success: true };
  }

  toggle(pluginId, enabled) {
    const config = this.#configStore.get('plugins') || [];
    const idx = config.findIndex(p => p.id === pluginId);
    if (idx >= 0) {
      config[idx].enabled = enabled;
      this.#configStore.set('plugins', config);
    }
    return { success: true };
  }

  reorder(pluginIds) {
    const config = this.#configStore.get('plugins') || [];
    const reordered = [];
    for (const id of pluginIds) {
      const p = config.find(c => c.id === id);
      if (p) reordered.push(p);
    }
    for (const p of config) {
      if (!pluginIds.includes(p.id)) reordered.push(p);
    }
    this.#configStore.set('plugins', reordered);
    return { success: true };
  }
}

module.exports = PluginManager;
