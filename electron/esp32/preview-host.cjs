const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { png } = require('./preview-png.cjs');

class PreviewHost {
  constructor(controller) {
    this.controller = controller;
    this.revision = 0;
    this.image = '';
    this.diagnostics = null;
    this.error = '';
  }
  start() {
    if (this.child) return;
    let executable = path.join(__dirname, 'native', 'win-x64', 'MonitorEsp32Preview.exe');
    executable = executable.replace('app.asar', 'app.asar.unpacked');
    if (!fs.existsSync(executable)) throw new Error('请先运行 install-dependencies.bat 构建 ESP32 预览');
    this.buffer = Buffer.alloc(0);
    this.frameLength = 0;
    this.error = '';
    this.child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', chunk => { this.error = chunk.toString().trim(); });
    this.child.on('error', error => { this.error = error.message; });
    const child = this.child;
    child.on('exit', () => { if (this.child === child) { this.child = null; clearInterval(this.timer); } });
    this.lastPrefs = '';
    this.pushFrame();
    this.timer = setInterval(() => this.pushFrame(), 500);
  }
  send(message) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
  pushFrame() {
    const frame = this.controller.frame();
    const prefs = JSON.stringify(frame.prefs);
    if (prefs !== this.lastPrefs) { this.lastPrefs = prefs; this.send({ v: 1, type: 'prefs_set', prefs: frame.prefs }); }
    this.send(frame);
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      if (this.frameLength) {
        if (this.buffer.length < this.frameLength) return;
        this.image = 'data:image/png;base64,' + png(1024, 600, this.buffer.subarray(0, this.frameLength)).toString('base64');
        this.buffer = this.buffer.subarray(this.frameLength);
        this.frameLength = 0;
        this.revision++;
      } else {
        const end = this.buffer.indexOf(10);
        if (end < 0) return;
        const line = this.buffer.subarray(0, end).toString('utf8');
        this.buffer = this.buffer.subarray(end + 1);
        if (line.startsWith('FRAME ')) this.frameLength = Number(line.slice(6));
        else if (line.startsWith('STATE ')) this.diagnostics = JSON.parse(line.slice(6));
        else if (line.startsWith('EVENT ')) {
          const message = JSON.parse(line.slice(6));
          if (message.type === 'navigate') this.controller.navigate(message.page);
          else { const reply = this.controller.command(message); if (reply) this.send(reply); }
          this.pushFrame();
        }
      }
    }
  }
  input(value) { this.send({ type: 'pointer', x: value.x, y: value.y, pressed: value.pressed }); }
  snapshot(revision) { return { revision: this.revision, image: revision === this.revision ? null : this.image, error: this.error, diagnostics: this.diagnostics }; }
  stop() { clearInterval(this.timer); this.child?.stdin.end(); this.child?.kill(); this.child = null; }
}
module.exports = { PreviewHost };
