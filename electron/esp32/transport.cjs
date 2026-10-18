const { Decoder, encode } = require('./protocol.cjs');
const ASSET_ACK_MS = 5000, MAX_BACKGROUND_ATTEMPTS = 5, RETRY_MS = 2000, PSRAM_MARGIN = 64 * 1024;
class DeviceTransport {
  constructor({ port, getFrame, getBackground, onBackgroundState, onNavigate, onCommand, onMessage, onData, onFatal, SerialPort, log = console.log, silenceMs = 10000 }) {
    if (!/^COM[1-9]\d*$/i.test(port || '')) throw new Error('Explicit COM port required');
    const rawLog = log, recent = new Map();
    // Unplugged boards retry every 3 s; log each distinct message at most once a minute.
    log = message => { const now = Date.now(); if (now - (recent.get(message) || 0) < 60000) return; recent.set(message, now); rawLog(message); };
    Object.assign(this, { path: port, getFrame, getBackground, onBackgroundState, onNavigate, onCommand, onMessage, onData, onFatal, SerialPort, log, silenceMs });
    this.lastRx = 0; this.openedAt = 0;
    this.replies=[];this.assets=[];this.assetPending=false;this.backgroundRevision=null;this.sentPrefs='';this.diagnostics=null;this.lastAck=0;
    this.decoder = new Decoder(message => this.receive(message));
    this.ready = false; this.stopped = false; this.writing = false; this.lastSeen = 0;
    this.lastAckAt=0;this.maxAckGapMs=0;this.disconnects=0;this.writeStartedAt=0;
  }
  start() {
    if(this.owner)return this;
    this.owner=require('node:net').createServer(socket=>socket.end());
    this.owner.on('error',error=>{this.log('[ESP32] Port ownership unavailable: '+error.message);this.stop();this.onFatal?.(error);});
    this.owner.listen('\\\\.\\pipe\\monitor-esp32-'+this.path.toUpperCase(),()=>{
      if(this.stopped){this.owner.close();return;}
      this.connect();this.timer=setInterval(()=>this.tick(),1000);
    });
    return this;
  }
  connect() {
    if (this.stopped) return;
    this.ready = false; this.decoder.reset(); this.writing = false;this.replies=[];
    const port = this.port = new this.SerialPort({ path: this.path, baudRate: 115200, autoOpen: false, hupcl: false });
    port.on('data', data => {if(this.port===port&&!this.stopped){this.lastRx=Date.now();this.onData?.(data);this.decoder.feed(data);}});
    port.on('error', error => { this.log('[ESP32] ' + error.message); if (this.port===port && !port.isOpen) this.schedule(); });
    port.on('close', () => { if(this.port!==port)return;this.disconnects++;this.ready = false;this.log('[ESP32] serial closed');this.schedule(); });
    port.open(error => {
      if (this.stopped || this.port!==port) { if (!error && port.isOpen) port.close(); return; }
      if (error) { this.log('[ESP32] ' + error.message); this.schedule(); return; }
      this.openedAt = this.lastRx = Date.now();
      // Drivers may still reset the device on open. Never pulse bootloader lines.
      port.set({ dtr: false, rts: false }, error => { if (error) this.log('[ESP32] ' + error.message); });
    });
  }
  schedule() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 3000);
  }
  receive(message) {
    if (message.type === 'hello' && message.board === 'ESP32-S3-Touch-LCD-5B' && message.width === 1024 && message.height === 600) {
      // A frame counter that went backwards means the board rebooted while the link stayed "ready" (e.g. mid-upload).
      const rebooted = Number.isFinite(message.frames) && Number.isFinite(this.diagnostics?.frames) && message.frames < this.diagnostics.frames;
      if (rebooted) this.log('[ESP32] device restarted');
      if (!this.ready || rebooted) { this.backgroundRevision = null; this.sentPrefs = ''; this.assets = []; this.assetPending = false; }
      this.ready = true; this.lastSeen = Date.now();this.diagnostics=message; return;
    }
    if (!this.ready) return;
    if (message.type === 'background_ack') {
      this.assetPending = false; this.lastSeen = Date.now();
      if (!this.assets.length) { this.backgroundFailures = 0; this.setBackgroundState(this.backgroundRevision ? 'shown' : 'none'); }
      this.tick(); return;
    }
    if (message.type === 'background_nack') {
      this.lastSeen = Date.now();
      this.backgroundFailed(`板卡拒绝：${String(message.reason || '未知原因').slice(0, 90)}`);
      this.tick(); return;
    }
    if(this.onMessage?.(message)===true){this.lastSeen=Date.now();return;}
    if (message.type === 'ack') {
      const now=Date.now();
      if(this.lastAckAt){const gap=now-this.lastAckAt;this.maxAckGapMs=Math.max(this.maxAckGapMs,gap);if(gap>4000)this.log('[ESP32] frame ACK gap '+gap+'ms');}
      this.lastSeen=now;this.lastAckAt=now;this.lastAck=message.seq;
    }
    if (message.type === 'navigate' && Number.isInteger(message.page)) {this.onNavigate(message.page);this.tick();}
    if (['prefs','catalog_request','select','radar_detail_request','radar_manual_reset'].includes(message.type) && this.onCommand) {
      try {const reply=this.onCommand(message);if(reply){if(this.replies.length>=16)this.replies.shift();this.replies.push(reply);}}
      catch(error){if(this.replies.length>=16)this.replies.shift();this.replies.push({v:1,type:'error',message:String(error.message).slice(0,120)});}
      this.tick();
    }
  }
  // Stop this upload so frames continue; retry a couple of times, then keep the board running without the image.
  backgroundFailed(reason) {
    this.backgroundFailures = (this.backgroundFailures || 0) + 1;
    this.log(`[ESP32] background upload failed (attempt ${this.backgroundFailures}): ${reason}`);
    this.assetPending = false; this.assets = [];
    // Back off before retrying: a board that is busy drawing (e.g. just after boot) rejects with "display busy".
    if (this.backgroundFailures < MAX_BACKGROUND_ATTEMPTS) { this.backgroundRevision = null; this.backgroundRetryAt = Date.now() + RETRY_MS * this.backgroundFailures; }
    else this.setBackgroundState('failed', reason);
  }
  setBackgroundState(state, message = '') {
    if (this.backgroundState?.state === state && this.backgroundState.message === message) return;
    this.backgroundState = { state, message, size: this.backgroundSize || '' };
    this.onBackgroundState?.(this.backgroundState);
  }
  reopen(reason) {
    const port = this.port;
    this.log('[ESP32] ' + reason + ', reopening ' + this.path);
    this.ready = false; this.writing = false;
    if (port?.isOpen) port.close(); else this.schedule();
  }
  tick() {
    if (Date.now() - this.lastSeen > 6000) {if(this.ready)this.log('[ESP32] device heartbeat timed out');this.ready = false;}
    // The firmware sends hello every 2 s. Silence on an "open" port means a stale handle after a replug.
    if (this.port?.isOpen && Date.now() - Math.max(this.lastRx, this.openedAt) > this.silenceMs) { this.reopen('no data for ' + Math.round(this.silenceMs / 1000) + 's'); return; }
    // The firmware never answers a background chunk it rejects (e.g. no PSRAM for the image). Waiting forever
    // stopped every frame while hellos kept the link "ready": Windows said connected, the board said USB lost.
    if (this.assetPending && Date.now() - this.assetSentAt > ASSET_ACK_MS) this.backgroundFailed('板卡没有回应');
    if (!this.ready || !this.port?.isOpen || this.writing || this.assetPending) return;
    if(this.paused&&!this.replies.length)return;
    const current = this.getFrame(), prefs = JSON.stringify(current.prefs);
    const background = this.getBackground?.();
    if (background && background.revision !== this.backgroundTarget) { this.backgroundTarget = background.revision; this.backgroundFailures = 0; }
    if (this.diagnostics?.background && background && background.revision !== this.backgroundRevision && Date.now() >= (this.backgroundRetryAt || 0)) {
      this.backgroundRevision = background.revision;
      // Full 512x300 (300 KB) when the board has room for it, else 256x150 (75 KB) on firmware that supports it.
      const room = this.diagnostics.psramBlock ?? this.diagnostics.freePsram ?? Infinity;
      const small = this.diagnostics.backgroundSizes && background.small && room < (background.bytes?.length || 0) + PSRAM_MARGIN;
      const bytes = small ? background.small : background.bytes;
      this.backgroundSize = !bytes ? '' : small ? '256×150' : '512×300';
      this.assets = backgroundMessages(bytes, this.diagnostics.backgroundSizes ? (small ? [256, 150] : [512, 300]) : null);
      if (bytes) this.setBackgroundState('sending');
    }
    let message;
    if (this.replies.length) message = this.replies.shift();
    else if (prefs !== this.sentPrefs) { this.sentPrefs = prefs; message = {v:1,type:'prefs_set',prefs:current.prefs}; }
    else if (this.assets.length) { message = this.assets.shift(); this.assetPending = true; this.assetSentAt = Date.now(); }
    else message = current;
    let frame;
    try { frame = encode(message); } catch (error) { this.log('[ESP32] ' + error.message); return; }
    this.writing = true;
    this.writeStartedAt=Date.now();
    const port = this.port;
    port.write(frame, error => {
      if(this.port!==port||this.stopped)return;
      if (error) { this.writing = false; this.reopen('write failed: ' + error.message); return; }
      port.drain(() => { if(this.port!==port||this.stopped)return;this.writing = false;if(this.replies.length || this.assets.length)setImmediate(()=>this.tick()); });
    });
  }
  stop() {
    this.stopped = true; this.ready=false;clearInterval(this.timer); clearTimeout(this.retry);
    const release=()=>{if(this.owner?.listening)this.owner.close();};
    if (this.port?.isOpen) this.port.close(release);else release();
  }
}
function backgroundMessages(bytes, size = null) {
  if (!bytes) return [{v:1,type:'background_clear'}];
  const messages = [size ? {v:1,type:'background_begin',width:size[0],height:size[1]} : {v:1,type:'background_begin'}];
  for (let offset=0; offset<bytes.length; offset+=4096) messages.push({v:1,type:'background_chunk',offset,data:bytes.subarray(offset,offset+4096).toString('hex')});
  messages.push({v:1,type:'background_end'}); return messages;
}
module.exports = { DeviceTransport, backgroundMessages };
