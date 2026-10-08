const fs = require('node:fs');
const path = require('node:path');
const { SerialPort } = require('serialport');
const { DisplayController } = require('./controller.cjs');
const { DeviceTransport } = require('./transport.cjs');
const { resolvePort } = require('./port-discovery.cjs');
const { PreviewHost } = require('./preview-host.cjs');
const { RadarTranslationScheduler } = require('./radar-translation-scheduler.cjs');
const { LightControl } = require('../../plugins/light-control/backend.cjs');
const settingsStore = require('./settings-store.cjs');
const { liveCollectionEnabled } = require('./isolation.cjs');
const { overviewDependencies } = require('../compact-overview');
const { profile } = require('./profile.cjs');
function startDeviceBackend({ configStore, providerManager, systemMonitorClient, tiboRadar }) {
  const live = liveCollectionEnabled();
  let busy = false, stopped = false, linking = false, transport, lights;
  let auto = !process.argv.includes('--esp32-no-connect'), candidates = [], connectionMessage = '';
  let system = live ? null : systemMonitorClient.getCachedData();
  let systemError = ''; 
  const translations = new RadarTranslationScheduler().start();
  const controller = new DisplayController({ ...settingsStore, mode: live ? 'live' : 'passive', source: () => {
    const file = path.join(profile, 'esp32-radar-translations.json');
    return { config: configStore.get(), cache: providerManager.getCachedData(), providers: providerManager.getAllProviders(),
      system, radar: tiboRadar.snapshot(), translations: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
  } });
  const preview = new PreviewHost(controller, message => command(message));
  function setTheme(theme) { controller.settings.preferences({ ...controller.settings.data.prefs, dark: theme !== 'light' }); }
  let background = {revision:'', bytes:null};
  function setBackground(bytes, revision) { background = {bytes, revision:revision || ''}; preview.setBackground(bytes, revision); }
  function command(message) {
    if (message.type === 'prefs') {
      const desired = configStore.get('screenAppearance')?.theme;
      if (message.source !== 'device' && desired) message.prefs = {...message.prefs, dark:desired !== 'light'};
    }
    const reply = controller.command(message);
    if (message.type === 'prefs' && message.source === 'device') {
      const theme = controller.settings.data.prefs.dark ? 'dark' : 'light';
      const saved = configStore.get('screenAppearance') || {};
      if (saved.theme !== theme) { configStore.set('screenAppearance', {...saved, theme}); require('electron').app.screenAppearance?.publish(); }
    }
    return reply;
  }
  setTheme(configStore.get('screenAppearance')?.theme || (controller.settings.data.prefs.dark ? 'dark' : 'light'));
  const getFrame = () => controller.frame();
  function selectPage(value) { controller.navigate(value); }
  function closeLink() { lights?.stop(); lights = null; transport?.stop(); transport = null; }
  function disconnect() { auto = false; closeLink(); }
  async function connect(requested = 'auto') {
    if (linking || stopped) return;
    linking = true;
    try {
      const selected = await resolvePort(requested, SerialPort);
      candidates = selected.candidates; connectionMessage = selected.message;
      auto = requested === 'auto';
      if (!selected.port) return;
      if (transport?.path === selected.port && !transport.stopped) return;
      closeLink();
      setTheme(configStore.get('screenAppearance')?.theme || (controller.settings.data.prefs.dark ? 'dark' : 'light'));
      transport = new DeviceTransport({ port: selected.port, SerialPort, getFrame, onNavigate: selectPage,
        getBackground: () => background, onCommand: command,
        onMessage: message => lights?.onMessage(message) === true }).start();
      lights = new LightControl({ transport, profile });
      await lights.start();
    } finally { linking = false; }
  }
  async function collect() {
    if (stopped || busy) return;
    busy = true;
    try {
      if (live && overviewDependencies(configStore.get('plugins') || [], configStore.get('compactOverview')).system) {
        system = await systemMonitorClient.getData(undefined, true);
        systemError = '';
      }
      controller.update();
      if (auto && !transport?.port?.isOpen) await connect('auto');
    } catch (error) { systemError = error.message; console.error('[ESP32 backend]', error.message); }
    finally { busy = false; }
  }
  controller.update();
  const timer = setInterval(collect, 2000);
  const requested = process.argv.find(arg => arg.startsWith('--esp32-port='))?.split('=')[1];
  if (requested || auto) connect(requested || 'auto').catch(error => { connectionMessage = error.message; });
  const status = () => ({ board: 'ESP32-S3-Touch-LCD-5B', width: 1024, height: 600, mode: live ? 'live' : 'passive',
    port: transport?.path || '', open: !!transport?.port?.isOpen, auto, candidates, connectionMessage,
    backgroundSupported: transport?.diagnostics?.background === true,
    deviceAppearance: {dark:transport?.diagnostics?.dark,backgroundReady:transport?.diagnostics?.backgroundReady,freePsram:transport?.diagnostics?.freePsram},
    ready: !!transport?.ready && Date.now() - transport.lastSeen < 6000,
    system: { enabled: live && overviewDependencies(configStore.get('plugins') || [], configStore.get('compactOverview')).system,
      fresh: !!system && system.cached !== true, fetchedAt: system?.fetchedAt || null, error: systemError },
    page: controller.page, pages: controller.views.map((view, i) => ({ id: i, title: view.title })), frame: getFrame() });
  return { getFrame, connect, disconnect, status, selectPage, setTheme, setBackground, preview, stop() { stopped = true; clearInterval(timer); translations.stop(); preview.stop(); closeLink(); } };
}
module.exports = { startDeviceBackend };
