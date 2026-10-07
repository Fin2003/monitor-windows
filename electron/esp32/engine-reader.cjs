const { execFile } = require('node:child_process');
const path = require('node:path');
const { flattenTree } = require('../system-monitor-client.js');

// The original Monitor only asks its hardware engine for data while its display window is open, so with the
// window closed sensor-cache.json goes stale although the engine keeps running. Then the bridge reads that
// same engine (read-only GET /data.json, no second collector). The engine listens on a random port through
// HTTP.sys, found via `netsh http show servicestate` by matching the engine's executable path.
const ENGINE_DIR = path.resolve(__dirname, '../../plugins/system-monitor/engine').toLowerCase();

function findEndpoint(text, engineDir = ENGINE_DIR) {
  let inEngine = false;
  for (const line of String(text).split(/\r?\n/)) {
    const proc = line.match(/ID:\s*\d+\s*,\s*[^:]+:\s*(.+\.exe)\s*$/i);
    if (proc) { inEngine = proc[1].trim().toLowerCase().startsWith(engineDir); continue; }
    const url = inEngine && line.match(/HTTP:\/\/127\.0\.0\.1:(\d+):127\.0\.0\.1\/\s*$/i);
    if (url) return `http://127.0.0.1:${url[1]}`;
  }
  return null;
}

function netshState() {
  return new Promise(resolve => execFile('netsh', ['http', 'show', 'servicestate', 'view=requestq'],
    { windowsHide: true, timeout: 10000, maxBuffer: 4 << 20 }, (error, stdout) => resolve(error ? '' : stdout)));
}

class EngineReader {
  constructor({ staleMs = 30000, intervalMs = 2000, discoverMs = 30000, readCache = () => null, fetchImpl = fetch, netsh = netshState, log = () => {} } = {}) {
    Object.assign(this, { staleMs, intervalMs, discoverMs, readCache, fetchImpl, netsh, log });
    this.endpoint = null; this.discoveredAt = 0; this.data = null; this.timer = null; this.busy = false;
  }
  start() { this.timer = setInterval(() => this.tick(), this.intervalMs); this.timer.unref?.(); this.tick(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }
  // Fresh engine data replaces the cache only while Monitor itself is not refreshing it.
  current(cache, now = Date.now()) {
    const cacheAt = Number(cache?.savedAt) || 0;
    if (this.data && this.data.fetchedAt > cacheAt && now - cacheAt > this.staleMs) return this.data;
    return null;
  }
  async tick(now = Date.now()) {
    if (this.busy) return;
    const cacheAt = Number(this.readCache()?.savedAt) || 0;
    if (now - cacheAt <= this.staleMs) { this.data = null; return; }
    this.busy = true;
    try {
      if (!this.endpoint && now - this.discoveredAt >= this.discoverMs) {
        this.discoveredAt = now;
        this.endpoint = findEndpoint(await this.netsh());
        if (this.endpoint) this.log(`[engine] reading ${this.endpoint} (Monitor sensor cache stale)`);
      }
      if (!this.endpoint) return;
      const response = await this.fetchImpl(`${this.endpoint}/data.json`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tree = await response.json();
      const diagnostics = tree.Diagnostics || {};
      if (diagnostics.status === 'starting') return;
      const sensors = flattenTree(tree);
      if (!sensors.length) return;
      this.data = { schemaVersion: 1, savedAt: Date.now(), fetchedAt: Date.now(), version: tree.Version || '', live: true,
        diagnostics: { backend: diagnostics.backend, scanStage: diagnostics.scanStage, source: 'engine' }, sensors };
    } catch (error) {
      if (this.endpoint) this.log(`[engine] ${this.endpoint} unavailable: ${error.message}`);
      this.endpoint = null; this.data = null;
    } finally { this.busy = false; }
  }
}

module.exports = { EngineReader, findEndpoint };
