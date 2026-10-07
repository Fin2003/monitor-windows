const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, shell } = require('electron');
require('./app-icon.cjs');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ScreenManager = require('./screen-manager');
const PluginManager = require('./plugin-manager');
const { normalizeOverview, overviewDependencies } = require('./compact-overview');
const ConfigStore = require('./config-store');
const ProviderManager = require('./providers/ProviderManager');
const VolcengineProvider = require('./providers/VolcengineProvider');
const XfyunProvider = require('./providers/XfyunProvider');
const OpencodeGoProvider = require('./providers/OpencodeGoProvider');
const CodingPlanApiProvider = require('./providers/CodingPlanApiProvider');
const API_PROVIDER_CLASSES = Object.fromEntries(['kimi', 'zhipu', 'minimax', 'zenmux', 'commandcode'].map(type => [type, class extends CodingPlanApiProvider { constructor() { super(type); } }]));
const { SystemMonitorClient } = require('./system-monitor-client');
const SystemMonitorRuntime = require('./system-monitor-runtime');
const TiboRadar = require('../plugins/tibo-radar/runtime.cjs');
const TiboXSession = require('../plugins/tibo-radar/x-session.cjs');
const { ModelConnection, createModelStore } = require('../plugins/tibo-radar/model-connection.cjs');
const { safeStorage, net } = require('electron');

// Separate profile for this distributable; never imports another installation's sessions.
app.setName('monitor-windows');
const profilePath = process.env.MONITOR_WINDOWS_PROFILE || (app.isPackaged
  ? path.join(app.getPath('appData'), 'monitor-windows')
  : path.join(__dirname, '..', '.device-profile'));
fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);

const isDev = !app.isPackaged;
const useDevServer = isDev && process.argv.includes('--dev');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// Tells scripts\monitor-autostart.vbs that Monitor was quit on purpose (not a crash): it stays closed
// until the next boot or a manual launch. Automatic launches must respect this marker.
const quitMarker = app.isPackaged ? path.join(app.getPath('userData'), 'autostart.quit') : path.join(__dirname, '..', 'autostart.quit');
const isAutoStart = process.argv.includes('--autostart');
if (!hasSingleInstanceLock || (isAutoStart && fs.existsSync(quitMarker))) app.exit(0);
if (!isAutoStart) fs.rmSync(quitMarker, { force: true });

let managerWindow = null;
let monitorWindow = null;
let previewWindow = null;
let pluginWindows = new Map();
let screenManager = null;
let pluginManager = null;
let configStore = null;
let providerManager = null;
let systemMonitorClient = null;
let systemMonitorRuntime = null;
let tiboRadar = null;
let tiboModel = null;
let tiboJev = null;
let tiboXSession = null;
let tray = null;

const VITE_DEV_SERVER = 'http://localhost:5173';

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getDistPath(filename) {
  return path.join(__dirname, '..', 'dist', filename);
}

function getManagerUrl() {
  if (useDevServer) return `${VITE_DEV_SERVER}/manager.html`;
  return url.pathToFileURL(getDistPath('manager.html')).href;
}

function getMonitorUrl() {
  if (useDevServer) return `${VITE_DEV_SERVER}/monitor.html`;
  return url.pathToFileURL(getDistPath('monitor.html')).href;
}

function getPanelUrl() {
  if (useDevServer) return `${VITE_DEV_SERVER}/panel.html`;
  return url.pathToFileURL(getDistPath('panel.html')).href;
}

function getSystemMonitorPanelUrl() {
  if (useDevServer) return `${VITE_DEV_SERVER}/system-monitor-panel.html`;
  return url.pathToFileURL(getDistPath('system-monitor-panel.html')).href;
}

function displaySnapshot(display) {
  return {
    internal: display.internal === true,
    label: display.label || '',
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    x: display.bounds.x,
    y: display.bounds.y,
  };
}

function resolveSavedDisplay(displayConfig = {}, allowFallback = true) {
  const displays = screen.getAllDisplays();
  const exact = displays.find(display => String(display.id) === String(displayConfig.targetDisplayId));
  if (exact) return exact;

  const saved = displayConfig.targetDisplayMeta;
  if (saved && displays.length) {
    const ranked = displays.map(display => {
      const snapshot = displaySnapshot(display);
      let score = 0;
      if (snapshot.internal === saved.internal) score += 100;
      if (snapshot.width === saved.width && snapshot.height === saved.height) score += 70;
      if (snapshot.width === saved.height && snapshot.height === saved.width) score += 35;
      if (snapshot.scaleFactor === saved.scaleFactor) score += 18;
      if (snapshot.label && snapshot.label === saved.label) score += 10;
      if (snapshot.x === saved.x && snapshot.y === saved.y) score += 20;
      return { display, score };
    }).sort((left, right) => right.score - left.score);
    if (ranked[0]?.score >= 100) return ranked[0].display;
  }

  const width = Number(displayConfig.customWidth);
  const height = Number(displayConfig.customHeight);
  const x = Number(displayConfig.customX);
  const y = Number(displayConfig.customY);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    const nearby = displays.find(display =>
      display.bounds.width === width && display.bounds.height === height
      || display.bounds.width === height && display.bounds.height === width
      || (Number.isFinite(x) && Number.isFinite(y)
        && display.bounds.x <= x && display.bounds.x + display.bounds.width >= x
        && display.bounds.y <= y && display.bounds.y + display.bounds.height >= y));
    if (nearby) return nearby;
  }

  if (!allowFallback && (displayConfig.targetDisplayId || displayConfig.targetDisplayMeta)) return null;
  return displays.find(display => display.internal === false) || screen.getPrimaryDisplay() || displays[0] || null;
}

function createManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
    return;
  }

  managerWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    resizable: true,
    transparent: false,
    backgroundColor: '#0A0A0B',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  managerWindow.loadURL(getManagerUrl());

  providerManager.setMainWindow(managerWindow);

  managerWindow.on('closed', () => {
    managerWindow = null;
  });
}

function createMonitorWindow(displayId, customBounds, fullscreenLock = true) {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    screenManager.detachWindow();
    monitorWindow.destroy();
    monitorWindow = null;
  }

  const config = configStore.get('display') || {};
  const requestedDisplayId = displayId || config.targetDisplayId;
  const targetDisplay = screenManager.findDisplayById(requestedDisplayId)
    || resolveSavedDisplay({ ...config, targetDisplayId: requestedDisplayId });

  if (targetDisplay && String(config.targetDisplayId) !== String(targetDisplay.id)) {
    configStore.set('display', {
      ...config,
      targetDisplayId: targetDisplay.id,
      targetDisplayMeta: displaySnapshot(targetDisplay),
    });
  }

  if (!targetDisplay && !customBounds) {
    return;
  }

  const sf = targetDisplay ? targetDisplay.scaleFactor : 1;
  const applyScale = config.ignoreScaleFactor && sf !== 1;
  const hasCustomRes = !!(config.customWidth && config.customHeight);
  const hasCustomPos = config.customX != null;

  let bounds;

  if (fullscreenLock && targetDisplay) {
    bounds = {
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
    };
  } else if (hasCustomRes) {
    bounds = {
      width: applyScale ? Math.round(config.customWidth / sf) : config.customWidth,
      height: applyScale ? Math.round(config.customHeight / sf) : config.customHeight,
      x: hasCustomPos ? config.customX : (targetDisplay ? targetDisplay.bounds.x : 0),
      y: hasCustomPos ? config.customY : (targetDisplay ? targetDisplay.bounds.y : 0),
    };
  } else if (customBounds) {
    bounds = {
      x: customBounds.x,
      y: customBounds.y,
      width: applyScale ? Math.round(customBounds.width / sf) : customBounds.width,
      height: applyScale ? Math.round(customBounds.height / sf) : customBounds.height,
    };
  } else {
    bounds = screenManager.getLandscapeBounds(targetDisplay);
  }

  monitorWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    resizable: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#0A0A0B',
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: false,
    },
  });

  let didShow = false;
  providerManager.setMonitorWindow(monitorWindow);
  monitorWindow.webContents.on('did-finish-load', () => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      providerManager.resendLatestData();
    }
    setTimeout(() => {
      if (!didShow) {
        didShow = true;
        if (monitorWindow && !monitorWindow.isDestroyed()) {
          screenManager.attachWindow(monitorWindow, targetDisplay?.id || requestedDisplayId, fullscreenLock !== false);
          monitorWindow.show();
        }
      }
    }, 300);
  });
  setTimeout(() => {
    if (!didShow && monitorWindow && !monitorWindow.isDestroyed()) {
      didShow = true;
      providerManager.resendLatestData();
      screenManager.attachWindow(monitorWindow, targetDisplay?.id || requestedDisplayId, fullscreenLock !== false);
      monitorWindow.show();
    }
  }, 3000);

  monitorWindow.loadURL(getMonitorUrl());

  monitorWindow.on('closed', () => {
    monitorWindow = null;
    providerManager.setMonitorWindow(null);
  });
}

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '管理面板', click: () => createManagerWindow() },
    { type: 'separator' },
    { label: '退出', click: () => {
      fs.writeFileSync(quitMarker, new Date().toISOString());
      app.quit();
    } },
  ]);

  tray.setToolTip('Monitor');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => createManagerWindow());
}

let overviewSourceQueue = Promise.resolve();
let overviewSystemWanted = null;
let overviewRadarWanted = null;
function syncOverviewSources() {
  pluginManager.getPluginList();
  providerManager.setVisibleChannels(configStore.get('selectedProviders') || []);
  const dependencies = overviewDependencies(configStore.get('plugins') || [], configStore.get('compactOverview'));
  if (overviewRadarWanted !== dependencies.radar) {
    if (dependencies.radar) tiboRadar.start();
    else tiboRadar.stop();
    overviewRadarWanted = dependencies.radar;
  }
  // Serialize runtime transitions when settings are toggled while an engine is starting.
  overviewSourceQueue = overviewSourceQueue.then(async () => {
    const dependencies = overviewDependencies(configStore.get('plugins') || [], configStore.get('compactOverview'));
    if (overviewSystemWanted !== dependencies.system) {
      if (dependencies.system) await systemMonitorRuntime.start();
      else await systemMonitorRuntime.stop();
      overviewSystemWanted = dependencies.system;
    }
  }).catch(error => console.error('[compact-overview] system:', error.message));
  return overviewSourceQueue;
}

function setupIPC() {
  const syncSelectedProviders = () => {
    const accounts = configStore.get('channelAccounts') || [];
    const accountChannels = configStore.get('accountChannels') || {};
    const displayEnabled = configStore.get('accountDisplayEnabled') || {};
    const enabledAccounts = new Set(accounts.filter(account => account.enabled !== false).map(account => account.id));
    const selected = [...new Set(Object.values(accountChannels).flat())].filter(channelKey => {
      const accountId = channelKey.split(':')[0];
      return enabledAccounts.has(accountId) && displayEnabled[accountId] !== false;
    });
    configStore.set('selectedProviders', selected);
    providerManager.setVisibleChannels(selected);
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('selected-providers-change', selected);
    }
    return selected;
  };

  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: d.internal,
      label: d.internal ? '主显示器' : `显示器 ${d.id}`,
    }));
  });

  ipcMain.handle('get-config', () => {
    return configStore.getAll();
  });

  ipcMain.handle('set-config', (_event, key, value) => {
    if (key === 'compactOverview') value = normalizeOverview(value);
    console.log('[set-config]', key, JSON.stringify(value));
    configStore.set(key, value);
    if (key === 'plugins') syncOverviewSources();
    if (key === 'compactOverview') {
      syncOverviewSources();
      if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.webContents.send('compact-overview-change', value);
    }
    if (key === 'theme') {
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('theme-change', value);
      }
      for (const [, win] of pluginWindows) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('theme-change', value);
        }
      }
    }
    if (key === 'selectedProviders') {
      providerManager.setVisibleChannels(value || []);
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('selected-providers-change', value);
      }
    }
    if (key === 'accountChannels') {
      syncSelectedProviders();
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('account-channels-change', value || {});
      }
    }
    if (key === 'channelAccounts') {
      syncSelectedProviders();
    }
    if (key === 'accountDisplayEnabled') {
      syncSelectedProviders();
    }
    if (key === 'providerNames') {
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('provider-names-change', value);
      }
    }
    if (key === 'debugMode') {
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('debug-mode-change', value);
      }
    }
    return true;
  });

  ipcMain.handle('start-monitor', (_event, displayId, customBounds, fullscreenLock) => {
    createMonitorWindow(displayId, customBounds, fullscreenLock);
    return true;
  });

  ipcMain.handle('stop-monitor', () => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.destroy();
    }
    const displayConfig = configStore.get('display') || {};
    configStore.set('display', { ...displayConfig, autoStart: false });
    return true;
  });

  ipcMain.handle('update-monitor-bounds', (_event, bounds) => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.setBounds(bounds);
      screenManager.updateCustomBounds(bounds);
    }
    return true;
  });

  ipcMain.handle('preview-bounds-start', (_event, bounds) => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.setBounds(bounds);
      previewWindow.showInactive();
      return true;
    }
    previewWindow = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false, transparent: false, resizable: false, alwaysOnTop: true,
      skipTaskbar: true, focusable: false, hasShadow: false,
      backgroundColor: '#1a3a5c',
      opacity: 0.35,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    previewWindow.showInactive();
    return true;
  });

  ipcMain.handle('preview-bounds-move', (_event, bounds) => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.setBounds(bounds);
    }
    return true;
  });

  ipcMain.handle('preview-bounds-end', (_event, bounds) => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.hide();
    }
    if (bounds && monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.setBounds(bounds);
      screenManager.updateCustomBounds(bounds);
    }
    return true;
  });

  ipcMain.handle('get-monitor-status', async () => {
    const win = monitorWindow;
    if (!win || win.isDestroyed()) return {running:false,bounds:null,viewport:null};
    let viewport = null;
    try {
      viewport = await win.webContents.executeJavaScript(`(()=>{
        const canvas=document.querySelector('.page-container') || document.querySelector('.monitor-shell');
        return {width:canvas?.clientWidth || innerWidth,height:canvas?.clientHeight || innerHeight,scaleFactor:devicePixelRatio,outputWidth:Math.round(innerWidth*devicePixelRatio),outputHeight:Math.round(innerHeight*devicePixelRatio)};
      })()`);
    } catch (_) {}
    if (win.isDestroyed() || win !== monitorWindow) return {running:false,bounds:null,viewport:null};
    return {
      running: true,
      bounds: win.getBounds(),
      viewport,
    };
  });

  ipcMain.handle('get-plugins', () => {
    return pluginManager.getPluginList();
  });

  ipcMain.handle('install-plugin', (_event, pluginPath) => {
    const result = pluginManager.install(pluginPath);
    syncOverviewSources();
    return result;
  });

  ipcMain.handle('uninstall-plugin', (_event, pluginId) => {
    const result = pluginManager.uninstall(pluginId);
    syncOverviewSources();
    return result;
  });

  ipcMain.handle('toggle-plugin', (_event, pluginId, enabled) => {
    const result = pluginManager.toggle(pluginId, enabled);
    if (pluginId === 'system-monitor') {
      systemMonitorClient.resetAverages();
    }
    syncOverviewSources();
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('plugin-update', pluginManager.getPluginList());
    }
    return result;
  });

  ipcMain.handle('reorder-plugins', (_event, pluginIds) => {
    const result = pluginManager.reorder(pluginIds);
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('plugin-update', pluginManager.getPluginList());
    }
    return result;
  });

  ipcMain.handle('switch-page', (_event, pageId) => {
    const enabled = pluginManager.getPluginList().some(plugin => plugin.id === pageId && plugin.enabled);
    if (!enabled) return false;
    configStore.set('activePluginPageId', pageId);
    if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.webContents.send('switch-page', pageId);
    return true;
  });

  ipcMain.handle('set-active-plugin-page', (_event, pageId) => {
    const enabled = pluginManager.getPluginList().some(plugin => plugin.id === pageId && plugin.enabled);
    if (!enabled) return false;
    configStore.set('activePluginPageId', pageId);
    return true;
  });

  ipcMain.handle('set-carousel-config', (_event, config) => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('carousel-config', config);
    }
    return true;
  });

  ipcMain.handle('switch-next-page', () => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('switch-next-page');
    }
    return true;
  });

  ipcMain.handle('tibo-radar-get', () => tiboRadar.snapshot());
  ipcMain.handle('tibo-model-get', () => tiboModel.get());
  ipcMain.handle('tibo-model-save', (_event, value) => tiboModel.save(value));
  const jevConfig = value => ({ name: value?.name || 'JEV', baseUrl: 'https://ai-gateway.vercel.sh/v1', format: 'evaluate', model: 'typesafe-ai/jev', apiKey: value?.apiKey || '', clearKey: !!value?.clearKey });
  ipcMain.handle('tibo-jev-get', () => {
    const saved = tiboJev.get();
    return { ...saved, ...jevConfig(saved), hasApiKey: saved.hasApiKey };
  });
  ipcMain.handle('tibo-jev-save', (_event, value) => tiboJev.save(jevConfig(value)));
  ipcMain.handle('tibo-radar-refresh', () => tiboRadar.refresh({forceReplies:true}));
  ipcMain.handle('tibo-radar-manual-reset', (_event, value) => tiboRadar.manualReset({
    action: value?.action === 'undo' ? 'undo' : 'mark', id: String(value?.id || ''),
    kind: value?.kind === 'banked' ? 'banked' : 'hard', date: String(value?.date || ''),
    hour: Number(value?.hour), minute: Number(value?.minute),
  }));
  ipcMain.handle('tibo-x-status', async () => ({ connected: await tiboRadar.hasXLogin(), checkedAt: Date.now() }));
  ipcMain.handle('tibo-x-connect', async () => {
    if (!tiboRadar.config().repliesEnabled) throw new Error('请先开启回复读取');
    tiboXSession ||= new TiboXSession(()=>{
      if(tiboRadar.running && !tiboRadar.config().paused) tiboRadar.refresh({forceReplies:true}).catch(()=>{});
    });
    await tiboXSession.open();
    return {ok:true};
  });
  ipcMain.handle('tibo-radar-configure', (_event, value) => tiboRadar.configure({
    ...(typeof value?.paused === 'boolean' ? { paused: value.paused } : {}),
    ...(Number.isFinite(value?.intervalSeconds) ? { intervalSeconds: value.intervalSeconds } : {}),
    ...(['glm', 'jev'].includes(value?.analysisProvider) ? { analysisProvider: value.analysisProvider } : {}),
    ...(typeof value?.repliesEnabled === 'boolean' ? { repliesEnabled: value.repliesEnabled } : {}),
    ...(typeof value?.displayTimeZone === 'string' ? { displayTimeZone: value.displayTimeZone } : {}),
  }));

  ipcMain.handle('system-monitor-get-config', () => systemMonitorClient.getConfig());
  ipcMain.handle('system-monitor-get-cached-data', () => ({
    success: true,
    data: systemMonitorClient.getCachedData(),
  }));
  ipcMain.handle('system-monitor-set-config', (_event, value) => {
    try {
      const config = systemMonitorClient.setConfig(value);
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('system-monitor-config', config);
      }
      for (const [, win] of pluginWindows) if (!win.isDestroyed()) win.webContents.send('system-monitor-config', config);
      return { success: true, config };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('system-monitor-preview-config', (_event, value) => {
    const config = systemMonitorClient.previewConfig(value);
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('system-monitor-preview-config', config);
    }
    return true;
  });
  ipcMain.handle('system-monitor-fetch-data', async (event, value) => {
    const shouldTrack = !!(monitorWindow && !monitorWindow.isDestroyed() && event.sender.id === monitorWindow.webContents.id);
    try { return { success: true, data: await systemMonitorClient.getData(value, shouldTrack) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-get-sensor', async (_event, sensorId) => {
    try { return { success: true, data: await systemMonitorClient.getSensor(sensorId) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-set-sensor', async (_event, sensorId, value) => {
    try { return { success: true, data: await systemMonitorClient.setSensor(sensorId, value) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-reset-sensor', async (_event, sensorId) => {
    try { return { success: true, data: await systemMonitorClient.resetSensor(sensorId) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-reset-all', async () => {
    try { return { success: true, data: await systemMonitorClient.resetAll() }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-get-metrics', async () => {
    try { return { success: true, data: await systemMonitorClient.getMetrics() }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('system-monitor-reset-averages', () => {
    systemMonitorClient.resetAverages();
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('system-monitor-average-reset');
    }
    return { success: true };
  });
  ipcMain.handle('system-monitor-enable-rtx-hotspot', async () => {
    try {
      return { success: true, data: await systemMonitorRuntime.enableExperimentalHotspot() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-providers', () => {
    return providerManager.getAllProviders();
  });
  ipcMain.handle('get-channel-states', () => {
    return providerManager.getAllChannelStates();
  });
  ipcMain.handle('get-cached-provider-data', () => {
    return providerManager.getCachedData();
  });

  ipcMain.handle('get-countdown-cache', () => {
    return configStore.get('countdownCache') || {};
  });

  ipcMain.handle('save-countdown-cache', (_event, cache) => {
    configStore.set('countdownCache', cache);
  });

  ipcMain.handle('provider-check-auth', (_event, providerId) => {
    return providerManager.checkAuth(providerId);
  });

  ipcMain.handle('provider-login', (_event, providerId) => {
    return providerManager.login(providerId);
  });

  ipcMain.handle('provider-logout', (_event, providerId) => {
    return providerManager.logout(providerId);
  });

  ipcMain.handle('provider-confirm-login', (_event, providerId) => {
    return providerManager.confirmLogin(providerId);
  });

  ipcMain.handle('provider-fetch-data', (_event, providerId) => {
    return providerManager.fetchData(providerId);
  });

  ipcMain.handle('provider-fetch-channel', (_event, channelKey) => {
    return providerManager.fetchChannelByKey(channelKey);
  });

  ipcMain.handle('get-provider-credentials', (_event, providerId) => {
    const creds = configStore.get('providerCredentials') || {};
    return creds[providerId] || null;
  });

  ipcMain.handle('set-provider-credentials', (_event, providerId, credentials) => {
    const creds = configStore.get('providerCredentials') || {};
    creds[providerId] = credentials;
    configStore.set('providerCredentials', creds);
    return true;
  });

  ipcMain.handle('get-provider-proxy-port', (_event, providerId) => {
    const ports = configStore.get('providerProxyPorts') || {};
    return ports[providerId] || null;
  });

  ipcMain.handle('set-provider-proxy-port', (_event, providerId, port) => {
    providerManager.setProxyPort(providerId, port);
    return true;
  });

  ipcMain.handle('get-provider-config', (_event, providerId) => {
    return providerManager.getProviderConfig(providerId);
  });

  ipcMain.handle('set-provider-config', (_event, providerId, config) => {
    providerManager.setProviderConfig(providerId, config);
    return true;
  });

  ipcMain.handle('add-channel-account', (_event, type, id, name, workspaceUrl) => {
    const VolcengineProvider = require('./providers/VolcengineProvider');
    const XfyunProvider = require('./providers/XfyunProvider');
    const OpencodeGoProvider = require('./providers/OpencodeGoProvider');
    const PROVIDER_CLASSES = { ...API_PROVIDER_CLASSES, volcengine: VolcengineProvider, xfyun: XfyunProvider, opencodego: OpencodeGoProvider };
    const Cls = PROVIDER_CLASSES[type];
    if (!Cls) return { error: 'Unknown provider type' };
    const provider = new Cls();
    provider.id = id;
    if (workspaceUrl) provider.workspaceUrl = workspaceUrl;
    providerManager.register(provider);
    providerManager.applyProviderConfig(id);
    const ports = configStore.get('providerProxyPorts') || {};
    if (ports[id]) providerManager.setProxyPort(id, ports[id]);

    const accounts = configStore.get('channelAccounts') || [];
    const existing = accounts.find(a => a.id === id);
    if (!existing) {
      accounts.push({ id, type, label: name || id, enabled: true });
      configStore.set('channelAccounts', accounts);
    }
    const providerNames = configStore.get('providerNames') || {};
    providerNames[id] = name || id;
    configStore.set('providerNames', providerNames);

    return { success: true };
  });

  ipcMain.handle('remove-channel-account', (_event, providerId) => {
    providerManager.unregister(providerId);
    return true;
  });

  ipcMain.handle('provider-dump-cookies', async (_event, providerId) => {
    return await providerManager.dumpCookies(providerId);
  });

  ipcMain.handle('provider-inject-cookies', async (_event, providerId, cookies) => {
    return await providerManager.injectCookies(providerId, cookies);
  });

  ipcMain.handle('provider-get-login-info', async (_event, providerId) => {
    return await providerManager.getLoginInfo(providerId);
  });

  ipcMain.handle('open-plugin-panel', (_event, pluginId) => {
    if (pluginWindows.has(pluginId)) {
      const existing = pluginWindows.get(pluginId);
      if (!existing.isDestroyed()) {
        existing.reload();
        existing.show();
        existing.focus();
        return true;
      }
      pluginWindows.delete(pluginId);
    }

    const managerBounds = managerWindow && !managerWindow.isDestroyed()
      ? managerWindow.getBounds()
      : { x: 100, y: 100, width: 800, height: 600 };

    const isSystemMonitor = pluginId === 'system-monitor';
    const isOverview = pluginId === 'compact-overview';
    const isTiboRadar = pluginId === 'tibo-radar';
    const pluginWin = new BrowserWindow({
      x: managerBounds.x + managerBounds.width + 10,
      y: managerBounds.y,
      width: isOverview ? 1200 : isSystemMonitor ? 980 : 760,
      height: isOverview ? 900 : isSystemMonitor ? 760 : 720,
      title: isOverview ? '缩略总览管理' : isTiboRadar ? 'Tibo 雷达' : isSystemMonitor ? '系统监控管理' : 'Coding Plan 管理',
      autoHideMenuBar: true,
      backgroundColor: '#0A0A0B',
      webPreferences: {
        preload: getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      },
    });

    pluginWin.loadURL(isOverview ? (useDevServer ? `${VITE_DEV_SERVER}/compact-overview-panel.html` : url.pathToFileURL(getDistPath('compact-overview-panel.html')).href) : isTiboRadar
      ? (useDevServer ? `${VITE_DEV_SERVER}/plugins/tibo-radar/index.html` : url.pathToFileURL(getDistPath('plugins/tibo-radar/index.html')).href)
      : isSystemMonitor ? getSystemMonitorPanelUrl() : getPanelUrl());

    pluginWin.on('closed', () => {
      pluginWindows.delete(pluginId);
    });

    pluginWindows.set(pluginId, pluginWin);
    return true;
  });

  ipcMain.handle('close-plugin-panel', (_event, pluginId) => {
    const win = pluginWindows.get(pluginId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    pluginWindows.delete(pluginId);
    return true;
  });

  ipcMain.handle('provider-login-in-panel', async (_event, providerId) => {
    const result = await providerManager.login(providerId);
    if (result.success) {
      await providerManager.fetchData(providerId);
    }
    return result;
  });

  ipcMain.handle('minimize-manager', () => {
    if (managerWindow && !managerWindow.isDestroyed()) {
      managerWindow.hide();
    }
    return true;
  });

  ipcMain.handle('close-manager', () => {
    if (managerWindow && !managerWindow.isDestroyed()) {
      managerWindow.hide();
    }
    return true;
  });

  ipcMain.handle('open-external', async (_event, externalUrl) => {
    const allowedUrls = new Set([
      'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor',
    ]);
    if (!allowedUrls.has(externalUrl)) return false;
    await shell.openExternal(externalUrl);
    return true;
  });

  ipcMain.handle('get-presets', () => {
    return configStore.getPresets();
  });

  ipcMain.handle('save-preset', (_event, preset) => {
    return configStore.savePreset(preset);
  });

  ipcMain.handle('load-preset', (_event, presetId) => {
    const preset = configStore.loadPreset(presetId);
    if (preset) {
      syncOverviewSources();
      providerManager.setVisibleChannels(configStore.get('selectedProviders') || []);
      providerManager.reconcileAvailableChannels();
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send('theme-change', configStore.get('theme') || 'dark');
        monitorWindow.webContents.send('plugin-update', pluginManager.getPluginList());
        monitorWindow.webContents.send('compact-overview-change', normalizeOverview(configStore.get('compactOverview')));
        monitorWindow.webContents.send('carousel-config', configStore.get('carousel') || { enabled: true, interval: 10 });
        monitorWindow.webContents.send('selected-providers-change', configStore.get('selectedProviders') || ['volcengine_0']);
        monitorWindow.webContents.send('provider-names-change', configStore.get('providerNames') || {});
      }
      for (const [, win] of pluginWindows) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('theme-change', configStore.get('theme') || 'dark');
        }
      }
      if (managerWindow && !managerWindow.isDestroyed()) {
        managerWindow.webContents.send('theme-change', configStore.get('theme') || 'dark');
        managerWindow.webContents.send('preset-loaded', preset);
      }
      const dc = configStore.get('display');
      if (monitorWindow && !monitorWindow.isDestroyed() && dc) {
        createMonitorWindow(dc.targetDisplayId, null, dc.fullscreenLock !== false);
      }
    }
    return preset;
  });

  ipcMain.handle('delete-preset', (_event, presetId) => {
    configStore.deletePreset(presetId);
    return true;
  });

  ipcMain.handle('get-active-preset-id', () => {
    return configStore.getActivePresetId();
  });

  ipcMain.handle('snapshot-current', () => {
    return configStore.snapshotCurrent();
  });
}

function cleanPartitionCache() {
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  if (!fs.existsSync(partitionsDir)) return;

  const validTypes = new Set(['volcengine', 'xfyun', 'opencodego', 'kimi', 'zhipu', 'minimax', 'zenmux', 'commandcode']);
  const validPartitions = new Set(['tibo-radar-public', 'tibo-radar-anonymous']);
  for (const entry of fs.readdirSync(partitionsDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const type = entry.name.split('_')[0];
    if (validTypes.has(type)) validPartitions.add(entry.name);
  }
  const cleanableDirs = ['Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache', 'Code Cache'];

  for (const entry of fs.readdirSync(partitionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!validPartitions.has(entry.name)) {
      const obsolete = path.join(partitionsDir, entry.name);
      try {
        fs.rmSync(obsolete, { recursive: true, force: true });
        console.log(`[cleanPartitionCache] removed obsolete partition: ${entry.name}`);
      } catch (e) {
        console.error(`[cleanPartitionCache] failed to remove ${entry.name}:`, e.message);
      }
      continue;
    }
    for (const dir of cleanableDirs) {
      const target = path.join(partitionsDir, entry.name, dir);
      if (fs.existsSync(target)) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch (e) {}
      }
    }
  }
}

const VALID_PROVIDER_TYPES = ['volcengine', 'xfyun', 'opencodego', 'kimi', 'zhipu', 'minimax', 'zenmux', 'commandcode'];

function migrateChannelKey(k) {
  if (k.includes('_')) return k;
  const colonIdx = k.indexOf(':');
  const type = colonIdx >= 0 ? k.slice(0, colonIdx) : k;
  if (!VALID_PROVIDER_TYPES.includes(type)) return k;
  const suffix = colonIdx >= 0 ? k.slice(colonIdx) : '';
  return type + '_0' + suffix;
}

function migrateOldConfigKeys(configStore) {
  let changed = false;

  const oldSel = configStore.get('selectedProviders');
  if (oldSel && Array.isArray(oldSel)) {
    const migrated = [...new Set(oldSel.map(migrateChannelKey))];
    if (JSON.stringify(migrated) !== JSON.stringify(oldSel)) {
      console.log('[migrate] selectedProviders:', oldSel, '->', migrated);
      configStore.set('selectedProviders', migrated);
    }
  }

  const oldCache = configStore.get('providerCache');
  if (oldCache && typeof oldCache === 'object') {
    const newCache = {};
    let cacheChanged = false;
    for (const [k, v] of Object.entries(oldCache)) {
      if (k.includes('_')) {
        newCache[k] = v;
      } else {
        console.log('[migrate] removing old providerCache key:', k);
        cacheChanged = true;
      }
    }
    if (cacheChanged) configStore.set('providerCache', newCache);
  }

  for (const cfgKey of ['providerCredentials', 'providerProxyPorts', 'providerConfig']) {
    const obj = configStore.get(cfgKey);
    if (!obj || typeof obj !== 'object') continue;
    const newObj = {};
    let objChanged = false;
    for (const [k, v] of Object.entries(obj)) {
      if (k.includes('_') || !VALID_PROVIDER_TYPES.includes(k)) {
        newObj[k] = v;
      } else {
        const newKey = k + '_0';
        if (!newObj[newKey]) newObj[newKey] = v;
        objChanged = true;
        console.log(`[migrate] ${cfgKey}: ${k} -> ${newKey}`);
      }
    }
    if (objChanged) configStore.set(cfgKey, newObj);
  }

  const oldNames = configStore.get('providerNames');
  if (oldNames && typeof oldNames === 'object') {
    const newNames = {};
    let namesChanged = false;
    for (const [k, v] of Object.entries(oldNames)) {
      const newKey = migrateChannelKey(k);
      if (newKey !== k) namesChanged = true;
      if (!newNames[newKey]) newNames[newKey] = v;
    }
    if (namesChanged) {
      console.log('[migrate] providerNames migrated');
      configStore.set('providerNames', newNames);
    }
  }
}

app.on('second-instance', () => {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  cleanPartitionCache();

  configStore = new ConfigStore();
  systemMonitorRuntime = new SystemMonitorRuntime(() => overviewDependencies(
    configStore.get('plugins') || [], configStore.get('compactOverview')).system);
  systemMonitorClient = new SystemMonitorClient(configStore, systemMonitorRuntime);

  migrateOldConfigKeys(configStore);

  screenManager = new ScreenManager();
  pluginManager = new PluginManager(configStore);
  providerManager = new ProviderManager(configStore);
  tiboModel = new ModelConnection(createModelStore(path.join(app.getPath('userData'), 'tibo-radar-model.json'), configStore), safeStorage, (url, options) => net.fetch(url, options));
  tiboJev = new ModelConnection(createModelStore(path.join(app.getPath('userData'), 'tibo-radar-jev.json')), safeStorage, (url, options) => net.fetch(url, options));
  tiboRadar = new TiboRadar(configStore, { model: tiboModel, jev: tiboJev,
    hasXLogin: async () => (await session.fromPartition('persist:tibo-radar-public').cookies.get({ url: 'https://x.com', name: 'auth_token' })).length > 0 });
  syncOverviewSources();


  const VolcengineProvider = require('./providers/VolcengineProvider');
  const XfyunProvider = require('./providers/XfyunProvider');
  const OpencodeGoProvider = require('./providers/OpencodeGoProvider');

  const PROVIDER_CLASSES = { ...API_PROVIDER_CLASSES, volcengine: VolcengineProvider, xfyun: XfyunProvider, opencodego: OpencodeGoProvider };
  const channelAccounts = configStore.get('channelAccounts') || [
    { id: 'volcengine_0', type: 'volcengine', label: '', enabled: true },
    { id: 'xfyun_0', type: 'xfyun', label: '', enabled: true },
    { id: 'opencodego_0', type: 'opencodego', label: '', enabled: true },
  ];

  let savedAccountChannels = configStore.get('accountChannels');
  if (savedAccountChannels) {
    const enabledAccounts = new Set(channelAccounts.filter(account => account.enabled !== false).map(account => account.id));
    const previousSelected = new Set((configStore.get('selectedProviders') || []).map(channelKey => channelKey.split(':')[0]));
    let displayEnabled = configStore.get('accountDisplayEnabled');
    if (!displayEnabled) {
      displayEnabled = {};
      for (const account of channelAccounts) displayEnabled[account.id] = previousSelected.has(account.id);
      configStore.set('accountDisplayEnabled', displayEnabled);
    }
    const restoredChannels = [...new Set(Object.values(savedAccountChannels).flat())].filter(channelKey =>
      enabledAccounts.has(channelKey.split(':')[0]) && displayEnabled[channelKey.split(':')[0]] !== false
    );
    configStore.set('selectedProviders', restoredChannels);
  }

  for (const acc of channelAccounts) {
    const Cls = PROVIDER_CLASSES[acc.type];
    if (!Cls) continue;
    const provider = new Cls();
    provider.id = acc.id;
    if (acc.label) provider.accountLabel = acc.label;
    providerManager.register(provider);
  }

  providerManager.setPluginWindows(pluginWindows);

  setupTray();
  setupIPC();
  createManagerWindow();

  const restoreSavedMonitor = (attempt = 0) => {
    const displayConfig = configStore.get('display') || {};
    if (!displayConfig.autoStart) return;
    const targetDisplay = resolveSavedDisplay(displayConfig, attempt >= 20);
    if (targetDisplay) {
      configStore.set('display', {
        ...displayConfig,
        targetDisplayId: targetDisplay.id,
        targetDisplayMeta: displaySnapshot(targetDisplay),
      });
      createMonitorWindow(targetDisplay.id, null, displayConfig.fullscreenLock !== false);
      return;
    }
    if (attempt < 30) setTimeout(() => restoreSavedMonitor(attempt + 1), 500);
  };
  restoreSavedMonitor();

  providerManager.setConfigStore(configStore);
  providerManager.setVisibleChannels(configStore.get('selectedProviders') || ['volcengine_0']);
  providerManager.checkAuthOnStartup().then(() => {
    providerManager.startAutoRefresh();
  });
});

app.on('window-all-closed', (e) => {
});

app.on('before-quit', () => {
  if (hasSingleInstanceLock) try { fs.writeFileSync(quitMarker, new Date().toISOString()); } catch (_) {}
  tiboXSession?.destroy();
  if (tiboRadar) tiboRadar.stop();
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
  if (screenManager) screenManager.destroy();
  if (providerManager) providerManager.destroy();
  if (systemMonitorRuntime) systemMonitorRuntime.destroy();
});
