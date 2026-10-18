const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

class LightControl {
  constructor({ transport, profile, log = console.log }) {
    Object.assign(this, { transport, profile, log });
    this.pending = new Map(); this.sequence = 0; this.lanes = new Map();
    this.lamp1Owner = 'monitor'; this.lamp1Claimed = false; this.wasOnline = false;
    this.pcConnected = false; this.routeInitialized = false; this.retryComputerAt = 0;
  }
  async start() {
    const { LightEngine } = await import(pathToFileURL(path.join(__dirname, 'engine.mjs')));
    const protocol = await import(pathToFileURL(path.join(__dirname, 'protocols.mjs')));
    const file = path.join(this.profile, 'esp32-lights-state.json');
    // Lamp identity (Smart Pro address, JustGoGo token, power packets) stays in the user's profile, never in source.
    const identityFile = path.join(this.profile, 'lights-connection.json');
    protocol.configureIdentity(fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, 'utf8')) : {});
    const original = path.join(process.env.APPDATA, 'Ulanzi/UlanziDeck/Config/local-lights-native-state.json');
    this.originalState = original;
    this.ownerFile = path.join(this.profile, 'esp32-lamp1-owner.json');
    fs.writeFileSync(this.ownerFile, JSON.stringify({ mode: 'esp32-first', owner: 'monitor' }));
    this.peerFile = path.join(this.profile, 'esp32-lamp1-peer.json');
    this.lamp1Peer = fs.existsSync(this.peerFile) ? JSON.parse(fs.readFileSync(this.peerFile, 'utf8')) : null;
    if (!fs.existsSync(file) && fs.existsSync(original)) fs.copyFileSync(original, file);
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
        if (this.switching) await this.switching;
        if (!this.routeInitialized || this.lamp1Owner === 'phone') await this.preferESP();
        let currentSequence = state.sequence;
        if (this.lamp1Owner === 'computer') {
          try {
            const result = await this.computer('/api/pc-send', { action, state });
            onAdvance(result.sequence);
            return;
          } catch (error) {
            if (error.reply?.sequence) { currentSequence = error.reply.sequence; onAdvance(currentSequence); }
            await this.preferESP();
          }
        }
        await this.claimLamp1();
        const seq = Buffer.from(currentSequence, 'hex');
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
  async computer(endpoint, body, method = 'POST') {
    const response = await fetch('http://127.0.0.1:8765' + endpoint, { method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(endpoint === '/api/pc-connect' ? 45000 : 15000) });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const error = new Error(result.error || '电脑蓝牙不可用'); error.reply = result; throw error;
    }
    return result;
  }
  async releaseComputer() {
    await this.computer('/api/pc-release').catch(error => {
      if (error.cause?.code !== 'ECONNREFUSED') throw error;
    });
    this.pcConnected = false;
  }
  async activateESP() {
    await this.releaseComputer();
    this.lamp1Owner = 'monitor'; this.lamp1Claimed = false;
    this.espWasConnected = false; this.espDisconnectedAt = 0;
    this.espConnectDeadline = Date.now() + 90000;
    this.retryComputerAt = Date.now() + 60000;
    await this.claimLamp1();
    this.routeInitialized = true;
    fs.writeFileSync(this.ownerFile, JSON.stringify({ mode: 'esp32-first', owner: 'monitor' }));
  }
  async preferComputer() {
    if (this.switching) return this.switching;
    const task = (async () => {
      this.lamp1Owner = 'computer'; this.lamp1Claimed = false;
      if (this.online) await this.request({ kind: 'release' });
      try {
        const result = await this.computer('/api/pc-connect');
        if (!result.connected) throw new Error('电脑蓝牙未连接外围灯');
        this.pcConnected = true; this.pcDisconnectedAt = 0; this.routeInitialized = true;
        fs.writeFileSync(this.ownerFile, JSON.stringify({ mode: 'esp32-first', owner: 'computer' }));
        this.log('[lights] lamp1 persistent connection assigned to computer Bluetooth');
      } catch (error) {
        this.log('[lights] computer Bluetooth unavailable, switching to ESP32: ' + error.message);
        await this.activateESP();
      }
    })();
    this.switching = task;
    try { return await task; } finally { this.switching = null; }
  }
  async preferESP() {
    if (this.switching) await this.switching;
    const task = this.activateESP(); this.switching = task;
    try { return await task; } finally { this.switching = null; }
  }
  async claimLamp1() {
    if (this.lamp1Claimed) return;
    if (this.claiming) return this.claiming;
    const task = (async () => {
      const peer = this.lamp1Peer;
      await this.request({ kind: 'maintain', peer: peer ? peer.address.split(':').reverse().join('') : '', peerType: peer?.addressType === 'random' ? 1 : 0 });
      this.claimDiagnostics = this.transport.diagnostics;
      this.lamp1Claimed = true;
      if (this.lamp1Claimed) this.log('[lights] lamp1 persistent connection assigned to Monitor');
    })();
    this.claiming = task;
    try { return await task; } finally { this.claiming = null; }
  }
  watchLink() {
    const diagnostics = this.transport.diagnostics;
    if (diagnostics?.lamp1Connected && diagnostics.peerAddress && diagnostics.peerAddress.toLowerCase() !== this.lamp1Peer?.address?.toLowerCase()) {
      this.lamp1Peer = { address: diagnostics.peerAddress, addressType: diagnostics.peerType === 1 ? 'random' : 'public' };
      fs.writeFileSync(this.peerFile, JSON.stringify(this.lamp1Peer, null, 2));
    }
    const boot = this.transport.diagnostics?.radioBoot;
    if (this.online && boot != null && boot !== this.radioBoot) {
      this.radioBoot = boot; this.lamp1Claimed = false;
      if (this.routeInitialized && this.lamp1Owner !== 'phone') this.routeInitialized = false;
    }
    if (this.transport.diagnostics?.lamp1Maintained === false && this.transport.diagnostics !== this.claimDiagnostics) this.lamp1Claimed = false;
    if (!this.online) {
      this.lamp1Claimed = false;
      if (this.wasOnline) {
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Monitor USB disconnected')); }
        this.pending.clear();
      }
    } else if (!this.routeInitialized && !this.switching) {
      void this.preferESP().catch(error => this.log('[lights] lamp1 route: ' + error.message));
    } else if (this.lamp1Owner === 'monitor' && !this.switching && !this.lamp1Claimed && !this.claiming) {
      void this.claimLamp1().catch(error => this.log('[lights] lamp1 startup connection: ' + error.message));
    }
    if (this.lamp1Owner === 'monitor') {
      if (diagnostics?.lamp1Connected) { this.espWasConnected = true; this.espDisconnectedAt = 0; this.espConnectDeadline = 0; }
      else if (this.espWasConnected && !this.espDisconnectedAt) this.espDisconnectedAt = Date.now();
      const initialFailed = !this.espWasConnected && this.espConnectDeadline && Date.now() > this.espConnectDeadline;
      const reconnectFailed = this.espDisconnectedAt && Date.now() - this.espDisconnectedAt >= 15000 && Date.now() > this.retryComputerAt;
      if (this.routeInitialized && !this.switching && (initialFailed || reconnectFailed)) {
        void this.preferComputer().catch(error => this.log('[lights] lamp1 computer fallback: ' + error.message));
      }
    }
    if (this.lamp1Owner === 'computer' && this.routeInitialized && !this.switching && !this.checkingComputer) {
      this.checkingComputer = true;
      void this.computer('/health', null, 'GET').then(health => {
        this.pcConnected = health.bluetoothConnected === true;
      }).catch(() => { this.pcConnected = false; }).finally(() => {
        this.checkingComputer = false;
        if (this.pcConnected) this.pcDisconnectedAt = 0;
        else if (!this.pcDisconnectedAt) this.pcDisconnectedAt = Date.now();
        else if (Date.now() - this.pcDisconnectedAt >= 15000 && !this.switching && this.lamp1Owner === 'computer') {
          void this.preferESP().catch(error => this.log('[lights] lamp1 primary reconnect: ' + error.message));
        }
      });
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Monitor 蓝牙命令未返回')); }, command.kind === 'sample' ? 45000 : command.kind === 'gatt' ? 40000 : 24000);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.replies.push({ v: 1, type: 'light', id, ...command });
      setImmediate(() => this.transport.tick());
    }));
    this.lanes.set(lane, task); return task;
  }
  snapshot() {
    this.engine.ready = this.online || this.pcConnected;
    if (fs.existsSync(this.originalState) && !this.engine.snapshot().devices.some(device => device.busy)) {
      const saved = JSON.parse(fs.readFileSync(this.originalState, 'utf8'));
      if (fs.statSync(this.originalState).mtimeMs > fs.statSync(this.engine.file).mtimeMs) {
        for (const [id, value] of Object.entries(saved.devices || {})) Object.assign(this.engine.devices[id], value);
      }
    }
    const state = this.engine.snapshot();
    state.app = { ready: this.online, backend: 'monitor-esp32', bridge: `Monitor ESP32：${this.transport.path}`, bridge_port: this.transport.path,
      firmware: this.transport.diagnostics?.firmware, radioReady: this.transport.diagnostics?.radioReady, radioError: this.transport.diagnostics?.radioError,
      lamp1Owner: this.lamp1Owner, lamp1Policy: 'esp32-first', stateSource: 'last-command' };
    for (const device of state.devices) {
      device.transport = device.id === 'justgogo' ? (this.lamp1Owner === 'computer' ? 'computer_bluetooth' : 'monitor_esp32_gatt') : 'monitor_esp32_advertising';
      device.connected = device.id === 'justgogo' ? (this.lamp1Owner === 'computer' ? this.pcConnected : this.lamp1Owner === 'monitor' && !!this.transport.diagnostics?.lamp1Connected) : null;
      device.connection = !this.online ? 'Monitor ESP32：未连接' : device.id !== 'justgogo' ? 'Monitor ESP32：广播待命'
        : device.connected ? '灯1：ESP32 已连接（优先）' : '灯1：ESP32 自动重连中';
      if (device.id === 'justgogo' && this.lamp1Owner === 'computer') device.connection = device.connected ? '灯1：电脑蓝牙已连接（兜底）' : '灯1：电脑蓝牙正在连接（兜底）';
      if (device.id === 'justgogo' && this.lamp1Owner === 'phone') device.connection = '灯1：已释放给手机';
      if (device.id === 'justgogo' && !device.connected) device.status = device.connection;
      if (device.id === 'justgogo' && device.connected && !this.engine.devices.justgogo.busy) {
        this.engine.devices.justgogo.error = '';
        device.status = '已连接';
      }
    }
    return state;
  }
  json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  async handle(req, res) {
    if (req.headers.origin) return this.json(res, 403, { ok: false, error: 'Use the local Studio plugin' });
    if (req.method === 'GET' && req.url === '/api/diagnostics') return this.json(res, 200, this.transport.diagnostics);
    if (req.method === 'POST' && req.url === '/api/lamp1-rssi-sample') {
      if (this.lamp1Owner !== 'phone') return this.json(res, 409, { ok: false, error: '先释放两端连接再采样' });
      const peer = this.lamp1Peer;
      const result = await this.request({ kind: 'sample', peer: peer.address.split(':').reverse().join(''),
        peerType: peer.addressType === 'random' ? 1 : 0 });
      return this.json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/lamp1-fallback') {
      await this.preferESP();
      return this.json(res, 200, { ok: true, owner: this.lamp1Owner });
    }
    if (req.method === 'POST' && req.url === '/api/lamp1-connect') {
      let error;
      try {
        await this.preferESP();
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          if (this.pcConnected || (this.lamp1Owner === 'monitor' && this.transport.diagnostics?.lamp1Connected)) {
            return this.json(res, 200, { ok: true, connected: true, diagnostics: this.transport.diagnostics });
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        error = 'ESP32 外围灯连接未建立';
      } catch (failure) { error = failure.message; }
      const diagnostics = { ...this.transport.diagnostics };
      return this.json(res, 200, { ok: false, connected: false, error, diagnostics, reconnecting: true });
    }
    if (req.method === 'POST' && req.url === '/api/lamp1-send') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { action, state } = JSON.parse(body);
      this.snapshot();
      await this.engine.command({ device: 'justgogo', action: action === 'power' ? 'power' : 'apply',
        value: state.power, brightness: state.brightness, kelvin: state.kelvin });
      return this.json(res, 200, { ok: true, sequence: this.engine.devices.justgogo.sequence,
        connected: this.lamp1Owner === 'computer' ? this.pcConnected : !!this.transport.diagnostics?.lamp1Connected });
    }
    if (req.method === 'POST' && req.url === '/api/adv-send') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { device, packets } = JSON.parse(body);
      const result = await this.request({ kind: 'adv', target: device === 'lamp3' ? 1 : 0, packets });
      return this.json(res, 200, result);
    }
    if (req.method === 'GET' && ['/health', '/api/state'].includes(req.url)) return this.json(res, 200, this.snapshot());
    if (req.method === 'POST' && req.url === '/api/lamp1-release') {
      if (this.switching) await this.switching;
      this.lamp1Owner = 'phone'; this.routeInitialized = true;
      await this.releaseComputer();
      if (this.online) await this.request({ kind: 'release' });
      this.lamp1Claimed = false;
      return this.json(res, 200, { ok: true, released: true });
    }
    if (req.method === 'POST' && req.url === '/api/release') {
      return this.json(res, 409, { ok: false, error: '请使用 lamp1-release 交给手机控制' });
    }
    if (req.method !== 'POST' || req.url !== '/api/command') return this.json(res, 404, { ok: false, error: 'not found' });
    let body = ''; for await (const chunk of req) body += chunk;
    const command = JSON.parse(body); this.snapshot();
    await this.engine.command(command);
    const { power, brightness, kelvin, preset, sequence, primarySequence, auxiliarySequence } = this.engine.devices[command.device];
    await fetch('http://127.0.0.1:8765/api/esp-sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: command.device, state: { power, brightness, kelvin, preset, sequence, primarySequence, auxiliarySequence } }),
      signal: AbortSignal.timeout(2000) }).catch(() => {});
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
