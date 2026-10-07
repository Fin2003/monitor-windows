const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getEsp32Preview: revision => ipcRenderer.invoke('esp32-preview-get', revision),
  inputEsp32Preview: input => ipcRenderer.invoke('esp32-preview-input', input),
  closeEsp32Preview: () => ipcRenderer.invoke('esp32-preview-close'),
  getEsp32Status: () => ipcRenderer.invoke('esp32-status'),
  connectEsp32: port => ipcRenderer.invoke('esp32-connect', port),
  disconnectEsp32: () => ipcRenderer.invoke('esp32-disconnect'),
  setEsp32Page: page => ipcRenderer.invoke('esp32-page', page),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),


  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  listPluginMarketplace: () => ipcRenderer.invoke('plugin-marketplace-list'),
  installMarketplacePlugin: id => ipcRenderer.invoke('plugin-marketplace-install', id),
  installLocalPluginZip: () => ipcRenderer.invoke('plugin-marketplace-local'),
  setPluginMarketplaceSource: url => ipcRenderer.invoke('plugin-marketplace-source', url),
  getTiboRadar: () => ipcRenderer.invoke('tibo-radar-get'),
  getTiboModel: () => ipcRenderer.invoke('tibo-model-get'),
  saveTiboModel: (value) => ipcRenderer.invoke('tibo-model-save', value),
  getTiboJev: () => ipcRenderer.invoke('tibo-jev-get'),
  saveTiboJev: (value) => ipcRenderer.invoke('tibo-jev-save', value),
  refreshTiboRadar: () => ipcRenderer.invoke('tibo-radar-refresh'),
  getTiboXStatus: () => ipcRenderer.invoke('tibo-x-status'),
  connectTiboX: () => ipcRenderer.invoke('tibo-x-connect'),
  configureTiboRadar: (value) => ipcRenderer.invoke('tibo-radar-configure', value),
  installPlugin: (pluginPath) => ipcRenderer.invoke('install-plugin', pluginPath),
  uninstallPlugin: (pluginId) => ipcRenderer.invoke('uninstall-plugin', pluginId),
  togglePlugin: (pluginId, enabled) => ipcRenderer.invoke('toggle-plugin', pluginId, enabled),
  reorderPlugins: (pluginIds) => ipcRenderer.invoke('reorder-plugins', pluginIds),

  switchPage: (pageId) => ipcRenderer.invoke('switch-page', pageId),
  setCarouselConfig: (config) => ipcRenderer.invoke('set-carousel-config', config),
  switchNextPage: () => ipcRenderer.invoke('switch-next-page'),
  setActivePluginPage: (pageId) => ipcRenderer.invoke('set-active-plugin-page', pageId),

  getSystemMonitorConfig: () => ipcRenderer.invoke('system-monitor-get-config'),
  getCachedSystemMonitorData: () => ipcRenderer.invoke('system-monitor-get-cached-data'),
  setSystemMonitorConfig: (config) => ipcRenderer.invoke('system-monitor-set-config', config),
  previewSystemMonitorConfig: (config) => ipcRenderer.invoke('system-monitor-preview-config', config),
  fetchSystemMonitorData: (config) => ipcRenderer.invoke('system-monitor-fetch-data', config),
  getSystemMonitorSensor: (sensorId) => ipcRenderer.invoke('system-monitor-get-sensor', sensorId),
  setSystemMonitorSensor: (sensorId, value) => ipcRenderer.invoke('system-monitor-set-sensor', sensorId, value),
  resetSystemMonitorSensor: (sensorId) => ipcRenderer.invoke('system-monitor-reset-sensor', sensorId),
  resetAllSystemMonitorSensors: () => ipcRenderer.invoke('system-monitor-reset-all'),
  getSystemMonitorMetrics: () => ipcRenderer.invoke('system-monitor-get-metrics'),
  resetSystemMonitorAverages: () => ipcRenderer.invoke('system-monitor-reset-averages'),
  enableSystemMonitorRtxHotspot: () => ipcRenderer.invoke('system-monitor-enable-rtx-hotspot'),

  getProviders: () => ipcRenderer.invoke('get-providers'),
  getChannelStates: () => ipcRenderer.invoke('get-channel-states'),
  getCachedProviderData: () => ipcRenderer.invoke('get-cached-provider-data'),
  providerCheckAuth: (providerId) => ipcRenderer.invoke('provider-check-auth', providerId),
  providerLogin: (providerId) => ipcRenderer.invoke('provider-login', providerId),
  providerLogout: (providerId) => ipcRenderer.invoke('provider-logout', providerId),
  providerConfirmLogin: (providerId) => ipcRenderer.invoke('provider-confirm-login', providerId),
  providerFetchData: (providerId) => ipcRenderer.invoke('provider-fetch-data', providerId),
  providerFetchChannel: (channelKey) => ipcRenderer.invoke('provider-fetch-channel', channelKey),

  getProviderCredentials: (providerId) => ipcRenderer.invoke('get-provider-credentials', providerId),
  setProviderCredentials: (providerId, credentials) => ipcRenderer.invoke('set-provider-credentials', providerId, credentials),

  getProviderProxyPort: (providerId) => ipcRenderer.invoke('get-provider-proxy-port', providerId),
  setProviderProxyPort: (providerId, port) => ipcRenderer.invoke('set-provider-proxy-port', providerId, port),

  importProviderAuth: (id) => ipcRenderer.invoke('import-provider-auth', id),
  beginCopilotLogin: (id) => ipcRenderer.invoke('begin-copilot-login', id),
  pollCopilotLogin: (id) => ipcRenderer.invoke('poll-copilot-login', id),
  getProviderConfig: (providerId) => ipcRenderer.invoke('get-provider-config', providerId),
  setProviderConfig: (providerId, config) => ipcRenderer.invoke('set-provider-config', providerId, config),

  addChannelAccount: (type, id, name, workspaceUrl) => ipcRenderer.invoke('add-channel-account', type, id, name, workspaceUrl),
  removeChannelAccount: (providerId) => ipcRenderer.invoke('remove-channel-account', providerId),
  dumpProviderCookies: (providerId) => ipcRenderer.invoke('provider-dump-cookies', providerId),
  injectProviderCookies: (providerId, cookies) => ipcRenderer.invoke('provider-inject-cookies', providerId, cookies),

  getProviderLoginInfo: (providerId) => ipcRenderer.invoke('provider-get-login-info', providerId),

  openPluginPanel: (pluginId) => ipcRenderer.invoke('open-plugin-panel', pluginId),
  closePluginPanel: (pluginId) => ipcRenderer.invoke('close-plugin-panel', pluginId),
  providerLoginInPanel: (providerId) => ipcRenderer.invoke('provider-login-in-panel', providerId),

  minimizeManager: () => ipcRenderer.invoke('minimize-manager'),
  closeManager: () => ipcRenderer.invoke('close-manager'),
  openExternal: (externalUrl) => ipcRenderer.invoke('open-external', externalUrl),

  getPresets: () => ipcRenderer.invoke('get-presets'),
  savePreset: (preset) => ipcRenderer.invoke('save-preset', preset),
  loadPreset: (presetId) => ipcRenderer.invoke('load-preset', presetId),
  deletePreset: (presetId) => ipcRenderer.invoke('delete-preset', presetId),
  getActivePresetId: () => ipcRenderer.invoke('get-active-preset-id'),
  snapshotCurrent: () => ipcRenderer.invoke('snapshot-current'),

  getCountdownCache: () => ipcRenderer.invoke('get-countdown-cache'),
  saveCountdownCache: (cache) => ipcRenderer.invoke('save-countdown-cache', cache),

  onDisplayConfig: (callback) => {
    ipcRenderer.on('display-config', (_event, data) => callback(data));
  },
  onSwitchPage: (callback) => {
    ipcRenderer.on('switch-page', (_event, pageId) => callback(pageId));
  },
  onSwitchNextPage: (callback) => {
    ipcRenderer.on('switch-next-page', () => callback());
  },
  onSystemMonitorConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('system-monitor-config', listener);
    return () => ipcRenderer.removeListener('system-monitor-config', listener);
  },
  onSystemMonitorPreviewConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('system-monitor-preview-config', listener);
    return () => ipcRenderer.removeListener('system-monitor-preview-config', listener);
  },
  onSystemMonitorAverageReset: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('system-monitor-average-reset', listener);
    return () => ipcRenderer.removeListener('system-monitor-average-reset', listener);
  },
  onCarouselConfig: (callback) => {
    ipcRenderer.on('carousel-config', (_event, config) => callback(config));
  },
  onPluginUpdate: (callback) => {
    ipcRenderer.on('plugin-update', (_event, plugins) => callback(plugins));
  },
  onCompactOverviewChange: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('compact-overview-change', listener);
    return () => ipcRenderer.removeListener('compact-overview-change', listener);
  },
  onProviderUpdate: (callback) => {
    ipcRenderer.on('provider-update', (_event, data) => callback(data));
  },
  onThemeChange: (callback) => {
    ipcRenderer.on('theme-change', (_event, theme) => callback(theme));
  },
  onPresetLoaded: (callback) => {
    const listener = (_event, preset) => callback(preset);
    ipcRenderer.on('preset-loaded', listener);
    return () => ipcRenderer.removeListener('preset-loaded', listener);
  },
  onSelectedProvidersChange: (callback) => {
    ipcRenderer.on('selected-providers-change', (_event, providers) => callback(providers));
  },
  onProviderNamesChange: (callback) => {
    ipcRenderer.on('provider-names-change', (_event, names) => callback(names));
  },
  onAccountChannelsChange: (callback) => {
    ipcRenderer.on('account-channels-change', (_event, channels) => callback(channels));
  },
  onChannelStatus: (callback) => {
    ipcRenderer.on('channel-status', (_event, data) => callback(data));
  },
  onChannelHighFreq: (callback) => {
    ipcRenderer.on('channel-highfreq', (_event, data) => callback(data));
  },
  onChannelDebug: (callback) => {
    ipcRenderer.on('channel-debug', (_event, data) => callback(data));
  },
  onDebugModeChange: (callback) => {
    ipcRenderer.on('debug-mode-change', (_event, value) => callback(value));
  },
});
