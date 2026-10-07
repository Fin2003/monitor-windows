const { app } = require('electron');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

class SystemMonitorRuntime {
  #process = null;
  #endpoint = null;
  #startPromise = null;
  #administrator = null;
  #canRun;

  constructor(canRun = () => true) {
    this.#canRun = canRun;
  }

  #assertWanted() {
    if (!this.#canRun()) throw new Error('系统监控未启用，请开启插件或在已开启的缩略总览中选择系统指标');
  }

  get endpoint() {
    return this.#endpoint;
  }

  async start() {
    this.#assertWanted();
    if (this.#process && this.#endpoint && await this.#isHealthy()) {
      this.#assertWanted();
      return this.#endpoint;
    }
    this.#process = null;
    this.#endpoint = null;
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start();
    try { return await this.#startPromise; }
    finally { this.#startPromise = null; }
  }

  async #start() {
    const port = await this.#getFreePort();
    this.#assertWanted();
    const executable = this.#getExecutablePath();
    const processInfo = await this.#launch(executable, port);
    this.#process = processInfo;
    this.#endpoint = `http://127.0.0.1:${port}`;

    try {
      this.#assertWanted();
      await this.#waitUntilReady();
      this.#assertWanted();
      return this.#endpoint;
    } catch (error) {
      try { await fetch(`${this.#endpoint}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(500) }); } catch (_) {}
      if (processInfo.child && !processInfo.child.killed) processInfo.child.kill('SIGTERM');
      this.#process = null;
      this.#endpoint = null;
      throw error;
    }
  }

  async stop() {
    if (this.#startPromise) {
      try { await this.#startPromise; } catch (_) {}
    }
    const child = this.#process;
    const endpoint = this.#endpoint;
    this.#process = null;
    this.#endpoint = null;
    if (!child) return;
    if (endpoint) {
      try { await fetch(`${endpoint}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) }); }
      catch (_) {}
    }
    if (child.child && !child.child.killed) child.child.kill('SIGTERM');
  }

  async enableExperimentalHotspot() {
    if (process.platform !== 'win32') throw new Error('RTX 50 热点直读仅支持 Windows');
    const executable = this.#getExecutablePath();
    const script = path.join(path.dirname(executable), 'enable-experimental-driver.ps1');
    if (!fs.existsSync(script)) throw new Error('RTX 50 热点驱动配置脚本不存在');
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    const command = `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${quote(script)}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('exit', code => {
        if (code === 0) resolve({ success: true, output: stdout.trim() });
        else reject(new Error(stderr.trim() || stdout.trim() || 'RTX 50 热点驱动配置被取消'));
      });
    });
  }

  destroy() {
    const processInfo = this.#process;
    const endpoint = this.#endpoint;
    this.#process = null;
    this.#endpoint = null;
    if (endpoint) fetch(`${endpoint}/shutdown`, { method: 'POST' }).catch(() => {});
    if (processInfo?.child && !processInfo.child.killed) processInfo.child.kill('SIGTERM');
  }

  #getExecutablePath() {
    const platformDirectory = this.#getPlatformDirectory();
    const executableNames = process.platform === 'win32'
      ? ['SystemMonitorEngine.current.exe', 'SystemMonitorEngine.exe']
      : ['SystemMonitorEngine.current', 'SystemMonitorEngine'];
    for (const executableName of executableNames) {
      let executable = path.join(app.getAppPath(), 'plugins', 'system-monitor', 'engine', platformDirectory, executableName);
      if (executable.includes('app.asar')) executable = executable.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(executable)) return executable;
    }
    throw new Error(`系统监控引擎文件不存在：${platformDirectory}/${executableNames[0]}`);
  }

  #getPlatformDirectory() {
    if (process.platform === 'win32') {
      if (process.arch === 'arm64') return 'win-arm64';
      if (process.arch === 'x64') return 'win-x64';
      throw new Error(`系统监控暂不支持 Windows ${process.arch} 架构`);
    }
    if (process.platform === 'linux') {
      if (process.arch === 'arm64') return 'linux-arm64';
      if (process.arch === 'x64') return 'linux-x64';
      throw new Error(`系统监控暂不支持 Linux ${process.arch} 架构`);
    }
    throw new Error(`系统监控暂不支持 ${process.platform} 平台`);
  }

  #getFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
    });
  }

  #launch(executable, port) {
    if (process.platform !== 'win32' || this.#isAdministrator()) return this.#launchDirect(executable, port);
    return this.#launchElevated(executable, port);
  }

  #launchDirect(executable, port) {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [
        '--port', String(port), '--parent-pid', String(process.pid),
      ], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('spawn', () => resolve({ pid: child.pid, child, stderr: () => stderr }));
    });
  }

  #isAdministrator() {
    if (this.#administrator !== null) return this.#administrator;
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        '$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } exit 1',
      ], { windowsHide: true, stdio: 'ignore', timeout: 2000 });
      this.#administrator = true;
    } catch (_) {
      this.#administrator = false;
    }
    return this.#administrator;
  }

  #launchElevated(executable, port) {
    return new Promise((resolve, reject) => {
      const launcher = path.join(path.dirname(executable), 'launch-elevated.ps1');
      const launcherProcess = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher,
        '-Executable', executable, '-Port', String(port), '-ParentPid', String(process.pid),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      launcherProcess.stdout.on('data', chunk => { stdout += chunk.toString(); });
      launcherProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
      launcherProcess.once('error', reject);
      launcherProcess.once('exit', code => {
        const processId = Number(stdout.trim().split(/\s+/).at(-1));
        if (code === 0 && Number.isInteger(processId) && processId > 0) resolve({ pid: processId, child: null });
        else reject(new Error(stderr.trim() || '管理员授权被取消，无法读取 CPU 温度和功耗'));
      });
    });
  }

  async #isHealthy() {
    try {
      const response = await fetch(`${this.#endpoint}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return true;
      if (response.status !== 503) return false;
      const diagnostics = await response.json();
      return diagnostics?.status === 'starting';
    } catch (_) { return false; }
  }

  async #waitUntilReady() {
    for (let attempt = 0; attempt < 200; attempt++) {
      this.#assertWanted();
      try {
        const response = await fetch(`${this.#endpoint}/health`, { signal: AbortSignal.timeout(500) });
        const diagnostics = await response.json();
        if (diagnostics?.status === 'error') throw new Error(diagnostics.error || '硬件采集器初始化失败');
        if (response.ok || diagnostics?.status === 'starting') return;
      } catch (error) {
        if (error?.name !== 'TypeError' && error?.name !== 'AbortError' && error?.name !== 'SyntaxError') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('内置硬件采集器启动超时');
  }
}

module.exports = SystemMonitorRuntime;
