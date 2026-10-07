const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

class LightControl {
  constructor({ transport, profile, log = console.log }) {
    Object.assign(this, { transport, profile, log });
    this.pending = new Map(); this.sequence = 0; this.lanes = new Map();
    this.lamp1Owner = 'monitor'; this.lamp1Claimed = false; this.wasOnline = false;
  }
  async start() {
    const { LightEngine } = await import(pathToFileURL(path.join(__dirname, 'engine.mjs')));
    const protocol = await import(pathToFileURL(path.join(__dirname, 'protocols.mjs')));
    const file = path.join(this.profile, 'esp32-lights-state.json');
    const identityFile = path.join(this.profile, 'lights-connection.json');
    const identity = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, 'utf8')) : {};
    protocol.configureIdentity(identity);
    this.identityConfigured = !!identity.justGoGoToken;
    const service = this;
    const esp = {
      preferredPort: this.transport.path,
      get connected() { return service.online; },
      get path() { return service.transport.path; },
      send: (frames, { device }) => this.request({ kind: 'adv', target: device === 'lamp3' ? 1 : 0, packets: frames.map(frame => frame.toString('hex')) })
    };
    const ble = {
      get connected() { return !!service.transport.diagnostics?.lamp1Connected; },
      send: async (action, state, onAdvance) => {
        this.lamp1Owner = 'monitor';
        await this.claimLamp1();
        const seq = Buffer.from(state.sequence, 'hex');
        const packets = action === 'power' ? [protocol.justGoGoPower(state.power, seq)]
          : [protocol.justGoGoCctMode(seq), protocol.justGoGoCct(state.brightness, state.kelvin, protocol.nextJustGoGoSequence(seq))];
        let result;
        try { result = await this.request({ kind: 'gatt', packets: packets.map(packet => packet.toString('hex')) }); }
        catch (error) { result = error.reply; throw error; }
        finally {
          let sequence = seq;
          for (let i = 0; i < (result?.completed || 0); i++) sequence = protocol.nextJustGoGoSequence(sequence);
          if (result?.completed) onAdvance(sequence.toString('hex').toUpperCase());
        }
      }
    };
    this.engine = new LightEngine({ file, ble, esp });
    esp.preferredPort = this.transport.path;
    this.server = http.createServer((req, res) => this.handle(req, res).catch(error => this.json(res, 500, { ok: false, error: error.message })));
    this.server.on('error', error => this.log('[lights] ' + error.message));
    this.server.listen(47833, '127.0.0.1', () => this.log('[lights] Monitor light control: http://127.0.0.1:47833'));
    this.linkTimer = setInterval(() => this.watchLink(), 1000);
    this.watchLink();
    return this;
  }
  async claimLamp1() {
    if (this.lamp1Claimed) return;
    if (this.claiming) return this.claiming;
    const task = (async () => {
      if (this.lamp1Owner !== 'monitor' || !this.identityConfigured) return;
      await this.request({ kind: 'maintain', peer: '', peerType: 0 });
      this.lamp1Claimed = this.lamp1Owner === 'monitor';
      if (this.lamp1Claimed) this.log('[lights] lamp1 persistent connection assigned to Monitor');
    })();
    this.claiming = task;
    try { return await task; } finally { this.claiming = null; }
  }
  watchLink() {
    const boot = this.transport.diagnostics?.radioBoot;
    if (this.online && boot != null && boot !== this.radioBoot) {
      const restarted = this.radioBoot != null;
      this.radioBoot = boot; this.lamp1Claimed = false;
      if (restarted && this.lamp1Owner === 'studio') {
        void this.request({ kind: 'release' }).catch(error => this.log('[lights] restore original lamp1 owner: ' + error.message));
      }
    }
    if (!this.online) {
      this.lamp1Claimed = false;
      if (this.wasOnline) {
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Monitor USB disconnected')); }
        this.pending.clear();
      }
    } else if (this.lamp1Owner === 'monitor' && !this.lamp1Claimed && !this.claiming) {
      void this.claimLamp1().catch(error => this.log('[lights] lamp1 startup connection: ' + error.message));
    }
    this.wasOnline = this.online;
  }
  get online() { return this.transport.ready && this.transport.diagnostics?.lightControl === true && this.transport.diagnostics?.radioReady === true; }
  onMessage(message) {
    if (message.type === 'light_event') {
      const device = this.engine.devices[message.target === 1 ? 'lamp3' : 'lamp2'];
      device.error = `Monitor 广播发送失败 (${message.code}; ${message.stage})`;
      this.log(`[lights] background broadcast failed: target=${message.target}, code=${message.code}, stage=${message.stage}`);
      return true;
    }
    if (message.type !== 'light_result') return false;
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message);
      else {
        const detail = `${message.stage || 'unknown'} / ${message.instance ?? -1}`;
        this.log(`[lights] command ${message.id} failed: code=${message.code}, ${detail}`);
        const error = new Error(`Monitor 蓝牙发送失败 (${message.code}; ${detail})`);
        error.reply = message; pending.reject(error);
      }
    }
    return true;
  }
  request(command) {
    const lane = command.kind === 'adv' ? `adv-${command.target}` : command.kind === 'gatt' ? 'gatt' : 'control';
    const task = (this.lanes.get(lane) || Promise.resolve()).catch(() => {}).then(() => new Promise((resolve, reject) => {
      if (!this.online) { reject(new Error('Monitor ESP32 灯控未连接')); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Monitor 蓝牙命令未返回')); }, command.kind === 'gatt' ? 40000 : 24000);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.replies.push({ v: 1, type: 'light', id, ...command });
      setImmediate(() => this.transport.tick());
    }));
    this.lanes.set(lane, task); return task;
  }
  snapshot() {
    this.engine.ready = this.online;
    const state = this.engine.snapshot();
    state.app = { ready: this.online, backend: 'monitor-esp32', bridge: `Monitor ESP32：${this.transport.path}`, bridge_port: this.transport.path,
      firmware: this.transport.diagnostics?.firmware, radioReady: this.transport.diagnostics?.radioReady, radioError: this.transport.diagnostics?.radioError,
      lamp1Owner: this.lamp1Owner, stateSource: 'last-command' };
    for (const device of state.devices) {
      device.transport = device.id === 'justgogo' ? 'monitor_esp32_gatt' : 'monitor_esp32_advertising';
      device.connected = device.id === 'justgogo' ? !!this.transport.diagnostics?.lamp1Connected : null;
      device.connection = !this.online ? 'Monitor ESP32：未连接' : device.id !== 'justgogo' ? 'Monitor ESP32：广播待命'
        : this.lamp1Owner !== 'monitor' ? '灯1：交给原 Studio 插件' : device.connected ? '灯1：ESP32 已连接' : '灯1：ESP32 自动重连中';
    }
    return state;
  }
  json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  async handle(req, res) {
    if (req.headers.origin) return this.json(res, 403, { ok: false, error: 'Use the local Studio plugin' });
    if (req.method === 'GET' && ['/health', '/api/state'].includes(req.url)) return this.json(res, 200, this.snapshot());
    if (req.method === 'POST' && req.url === '/api/release') {
      this.lamp1Owner = 'studio'; this.lamp1Claimed = false;
      const result = await this.request({ kind: 'release' });
      return this.json(res, 200, result);
    }
    if (req.method !== 'POST' || req.url !== '/api/command') return this.json(res, 404, { ok: false, error: 'not found' });
    let body = ''; for await (const chunk of req) body += chunk;
    const command = JSON.parse(body); this.snapshot();
    await this.engine.command(command);
    this.log(`[lights] ${command.device} ${command.action}: sent via ${this.transport.path}`);
    return this.json(res, 200, this.snapshot());
  }
  stop() {
    clearInterval(this.linkTimer);
    this.server?.close();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Monitor bridge stopped')); }
    this.pending.clear();
  }
}
module.exports = { LightControl };
