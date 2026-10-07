const fs = require('fs');
const path = require('path');

const SENSOR_CACHE_SCHEMA = 1;
const SENSOR_CACHE_WRITE_INTERVAL = 15000;

function getSensorCachePath() {
  const { app } = require('electron');
  if (app.isPackaged) return path.join(app.getPath('userData'), 'system-monitor', 'sensor-cache.json');
  let runtimeDirectory = path.join(__dirname, '..', 'plugins', 'system-monitor', 'runtime');
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (runtimeDirectory.includes(asarSegment)) {
    runtimeDirectory = runtimeDirectory.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return path.join(runtimeDirectory, 'sensor-cache.json');
}

const CACHE_SENSOR_FIELDS = [
  'id', 'name', 'zhName', 'type', 'zhType', 'hardware', 'hardwareId', 'zhHardware',
  'hardwareRoot', 'hardwareRootId', 'zhHardwareRoot', 'hardwarePath', 'group', 'groupPath',
  'value', 'min', 'max', 'rawValue', 'rawMin', 'rawMax', 'available',
];

const DEFAULT_CONFIG = Object.freeze({
  endpoint: 'http://127.0.0.1:8085',
  username: '',
  password: '',
  refreshInterval: 2,
  selectedSensors: [],
  layoutOrder: [],
  favoriteSensors: [],
  selectedHardwareIds: [],
  hardwareFilterEnabled: false,
  sensorAliases: {},
  columns: 0,
  showMinMax: true,
  selectionInitialized: false,
  averageEnabled: false,
  presets: [null, null, null, null, null],
  activePreset: null,
  sensorLanguage: 'zh',
  colorMode: 'type',
  fanDisplayModes: {},
  fanDisplayMode: 'rpm',
  memoryDisplayMode: 'percent',
  vramDisplayMode: 'percent',
  vramDisplayUnit: 'GB',
  dataFontScale: 0.67,
  infoFontScale: 1.8,
  autoAddGpuHotspot: true,
});

const AverageTracker = require('../plugins/system-monitor/runtime/average-tracker');
const { translateType, translateSensorName, translateHardware } = require('../plugins/system-monitor/runtime/sensor-translator');

function normalizeConfig(config = {}) {
  const presets = Array.isArray(config.presets) ? config.presets.slice(0, 5) : [];
  const fanDisplayModes = config.fanDisplayModes && typeof config.fanDisplayModes === 'object'
    ? Object.fromEntries(Object.entries(config.fanDisplayModes)
      .filter(([sensorId, mode]) => typeof sensorId === 'string' && (mode === 'rpm' || mode === 'percent')))
    : {};
  return {
    ...DEFAULT_CONFIG,
    ...config,
    endpoint: String(config.endpoint || DEFAULT_CONFIG.endpoint).trim().replace(/\/(?:data\.json)?\/?$/i, ''),
    refreshInterval: Math.min(60, Math.max(1, Number(config.refreshInterval) || DEFAULT_CONFIG.refreshInterval)),
    selectedSensors: Array.isArray(config.selectedSensors) ? config.selectedSensors : [],
    layoutOrder: Array.isArray(config.layoutOrder)
      ? [...new Set(config.layoutOrder.map(value => String(value || '').trim()).filter(Boolean))]
      : [],
    favoriteSensors: Array.isArray(config.favoriteSensors)
      ? [...new Set(config.favoriteSensors.map(value => String(value || '').trim()).filter(Boolean))]
      : [],
    selectedHardwareIds: Array.isArray(config.selectedHardwareIds)
      ? [...new Set(config.selectedHardwareIds.map(value => String(value || '').trim()).filter(Boolean))]
      : [],
    hardwareFilterEnabled: config.hardwareFilterEnabled === true,
    sensorAliases: config.sensorAliases && typeof config.sensorAliases === 'object' ? config.sensorAliases : {},
    columns: 0,
    showMinMax: config.showMinMax !== false,
    sensorLanguage: config.sensorLanguage === 'en' ? 'en' : 'zh',
    colorMode: config.colorMode === 'device' ? 'device' : 'type',
    fanDisplayModes,
    fanDisplayMode: config.fanDisplayMode === 'percent' ? 'percent' : 'rpm',
    memoryDisplayMode: ['percent', 'used', 'used-percent'].includes(config.memoryDisplayMode)
      ? config.memoryDisplayMode
      : 'percent',
    vramDisplayMode: ['percent', 'used', 'used-percent'].includes(config.vramDisplayMode)
      ? config.vramDisplayMode
      : 'percent',
    vramDisplayUnit: config.vramDisplayUnit === 'MB' ? 'MB' : 'GB',
    dataFontScale: Math.min(1.5, Math.max(0.4, Number(config.dataFontScale) || DEFAULT_CONFIG.dataFontScale)),
    infoFontScale: Math.min(3, Math.max(0.75, Number(config.infoFontScale) || DEFAULT_CONFIG.infoFontScale)),
    autoAddGpuHotspot: config.autoAddGpuHotspot !== false,
    averageEnabled: config.averageEnabled === true,
    presets: Array.from({ length: 5 }, (_, index) => presets[index] && typeof presets[index] === 'object' ? presets[index] : null),
    activePreset: Number.isInteger(config.activePreset) && config.activePreset >= 0 && config.activePreset < 5 ? config.activePreset : null,
  };
}

function hardwareKeys(sensor) {
  return [sensor.hardwareRootId, sensor.hardwareId, sensor.hardware, sensor.id].filter(Boolean);
}

function canonicalHardwareId(sensor) {
  return sensor.hardwareRootId || sensor.hardwareId || sensor.hardware || sensor.id;
}

function flattenTree(root) {
  const sensors = [];

  function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function visit(node, context = { hardware: '', hardwareId: '', hardwarePath: [], groups: [] }) {
    if (!node || typeof node !== 'object') return;
    const next = { ...context };
    if (node.HardwareId) {
      next.hardware = node.Text || node.HardwareId;
      next.hardwareId = node.HardwareId;
      next.hardwarePath = [...(context.hardwarePath || []), { id: node.HardwareId, name: node.Text || node.HardwareId }];
    }
    else if (!node.SensorId && node.Text && node.Text !== 'Sensor') next.groups = [...context.groups, node.Text];

    if (node.SensorId) {
      const name = node.Text || node.SensorId;
      const type = node.Type || context.groups.at(-1) || 'Other';
      const hardware = context.hardware || context.groups[0] || 'System';
      const hardwarePath = context.hardwarePath || [];
      const rootHardware = hardwarePath[0] || { id: context.hardwareId || '', name: hardware };
      const rawValue = nullableNumber(node.RawValue);
      sensors.push({
        id: node.SensorId,
        name,
        zhName: translateSensorName(name, type),
        type,
        zhType: translateType(type),
        hardware,
        hardwareId: context.hardwareId || '',
        zhHardware: translateHardware(hardware, context.hardwareId),
        hardwareRoot: rootHardware.name,
        hardwareRootId: rootHardware.id,
        zhHardwareRoot: translateHardware(rootHardware.name, rootHardware.id),
        hardwarePath,
        group: context.groups.at(-1) || '',
        groupPath: [...context.groups],
        value: node.Value ?? '',
        min: node.Min ?? '',
        max: node.Max ?? '',
        rawValue,
        rawMin: nullableNumber(node.RawMin),
        rawMax: nullableNumber(node.RawMax),
        available: rawValue !== null,
      });
    }

    for (const child of node.Children || []) visit(child, next);
  }

  visit(root);
  return sensors;
}

class SystemMonitorClient {
  #configStore;
  #runtime;
  #averageTracker = new AverageTracker();
  #cachePath;
  #lastCacheSignature = '';
  #lastCacheWriteAt = 0;

  constructor(configStore, runtime = null, cachePath = null) {
    this.#configStore = configStore;
    this.#runtime = runtime;
    this.#cachePath = cachePath || getSensorCachePath();
  }

  getConfig() {
    return normalizeConfig(this.#configStore.get('systemMonitor'));
  }

  setConfig(value) {
    const config = normalizeConfig(value);
    config.selectionInitialized = true;
    this.#configStore.set('systemMonitor', config);
    return config;
  }

  previewConfig(value) {
    return normalizeConfig(value);
  }

  getCachedData() {
    try {
      if (!fs.existsSync(this.#cachePath)) return null;
      const cached = JSON.parse(fs.readFileSync(this.#cachePath, 'utf8').replace(/^\uFEFF/, ''));
      if (cached?.schemaVersion !== SENSOR_CACHE_SCHEMA || !Array.isArray(cached.sensors) || !cached.sensors.length) return null;
      const savedAt = Number(cached.savedAt) || 0;
      return {
        version: cached.version || '',
        fetchedAt: savedAt || Date.now(),
        sensors: cached.sensors,
        tree: null,
        diagnostics: {
          ...(cached.diagnostics || {}),
          status: 'cached',
          cached: true,
          cacheAgeMs: savedAt ? Math.max(0, Date.now() - savedAt) : null,
        },
        gpuHotspot: cached.gpuHotspot || { present: false, available: false, value: '' },
        gpuHotspots: cached.gpuHotspots || [],
        cached: true,
      };
    } catch (_) {
      return null;
    }
  }

  async getData(configOverride, shouldTrack = false) {
    const waitForExtendedHardware = configOverride?.waitForExtendedHardware === true;
    const config = await this.#getRequestConfig(configOverride);
    let data;
    for (let attempt = 0; attempt < 480; attempt++) {
      data = await this.#request('/data.json', config, { responseType: 'json' });
      const diagnostics = data?.Diagnostics || {};
      const coreScanPending = diagnostics.status === 'starting';
      const extendedScanPending = waitForExtendedHardware
        && diagnostics.status === 'ok'
        && diagnostics.scanStage === 'extended';
      if (!coreScanPending && !extendedScanPending) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const scanTimedOut = !data
      || data.Diagnostics?.status === 'starting'
      || (waitForExtendedHardware && data.Diagnostics?.scanStage === 'extended');
    if (scanTimedOut) {
      throw new Error(waitForExtendedHardware
        ? '完整硬件扫描超过 120 秒，请检查主板或扩展设备驱动'
        : '核心硬件扫描超过 120 秒，请检查异常设备或驱动');
    }
    let sensors = flattenTree(data);
    const storedConfig = this.getConfig();
    if (!storedConfig.selectionInitialized) {
      storedConfig.selectedSensors = this.#selectDefaultSensors(sensors, storedConfig);
      storedConfig.selectionInitialized = true;
      this.#configStore.set('systemMonitor', storedConfig);
    }
    const effectiveConfig = this.getConfig();
    const selectedHardware = new Set(effectiveConfig.selectedHardwareIds || []);
    if (effectiveConfig.hardwareFilterEnabled && selectedHardware.size) {
      const canonicalHardware = new Set();
      for (const hardwareId of selectedHardware) {
        const sensor = sensors.find(item => hardwareKeys(item).includes(hardwareId));
        canonicalHardware.add(sensor ? canonicalHardwareId(sensor) : hardwareId);
      }
      for (const sensor of sensors) {
        if (effectiveConfig.selectedSensors.includes(sensor.id)) canonicalHardware.add(canonicalHardwareId(sensor));
      }
      const nextHardware = [...canonicalHardware];
      if (JSON.stringify(nextHardware) !== JSON.stringify(effectiveConfig.selectedHardwareIds)) {
        effectiveConfig.selectedHardwareIds = nextHardware;
        this.#configStore.set('systemMonitor', effectiveConfig);
      }
    }
    const hotspotSensors = sensors.filter(sensor => sensor.id.startsWith('/gpu-nvidia/') && /hot\s*spot/i.test(sensor.name));
    const hotspotSensor = hotspotSensors.find(sensor => sensor.available) || hotspotSensors[0];
    const missingHotspots = hotspotSensors.filter(sensor => sensor.available && !effectiveConfig.selectedSensors.includes(sensor.id));
    if (effectiveConfig.autoAddGpuHotspot && missingHotspots.length) {
      effectiveConfig.selectedSensors = [...effectiveConfig.selectedSensors, ...missingHotspots.map(sensor => sensor.id)];
      this.#configStore.set('systemMonitor', effectiveConfig);
    }
    sensors = this.#averageTracker.apply(sensors, effectiveConfig, shouldTrack);
    const result = {
      version: data.Version || '',
      fetchedAt: Date.now(),
      sensors,
      tree: data,
      config: this.getConfig(),
      diagnostics: data.Diagnostics || {},
      gpuHotspot: hotspotSensor ? {
        id: hotspotSensor.id,
        present: true,
        available: hotspotSensor.available,
        value: hotspotSensor.value,
      } : { present: false, available: false, value: '' },
      gpuHotspots: hotspotSensors.map(sensor => ({ id: sensor.id, name: sensor.name, available: sensor.available, value: sensor.value })),
    };
    this.#writeSensorCache(sensors, result);
    return result;
  }

  resetAverages() {
    this.#averageTracker.reset();
  }

  async getSensor(sensorId, configOverride) {
    return this.#sensorAction('Get', sensorId, null, configOverride);
  }

  async setSensor(sensorId, value, configOverride) {
    return this.#sensorAction('Set', sensorId, value, configOverride, 'POST');
  }

  async resetSensor(sensorId, configOverride) {
    return this.#sensorAction('ResetMinMax', sensorId, null, configOverride, 'POST');
  }

  async resetAll(configOverride) {
    const config = await this.#getRequestConfig(configOverride);
    const data = await this.#request('/ResetAllMinMax', config, { responseType: 'json' });
    return { sensors: flattenTree(data), tree: data };
  }

  async getMetrics(configOverride) {
    const config = await this.#getRequestConfig(configOverride);
    return this.#request('/metrics', config, { responseType: 'text' });
  }

  async #sensorAction(action, sensorId, value, configOverride, method = 'GET') {
    if (!sensorId || typeof sensorId !== 'string') throw new Error('传感器 ID 无效');
    const config = await this.#getRequestConfig(configOverride);
    const params = new URLSearchParams({ action, id: sensorId });
    if (value !== null && value !== undefined) params.set('value', String(value));
    const result = await this.#request(`/Sensor?${params}`, config, { method, responseType: 'json' });
    if (result.result === 'fail') throw new Error(result.message || '系统监控后端操作失败');
    return result;
  }

  #writeSensorCache(sensors, result) {
    const diagnostics = result.diagnostics || {};
    if (diagnostics.status === 'starting' || (diagnostics.scanStage && diagnostics.scanStage !== 'complete') || !sensors.length) return;
    const signature = sensors.map(sensor => sensor.id).join('\n');
    const now = Date.now();
    if (signature === this.#lastCacheSignature && now - this.#lastCacheWriteAt < SENSOR_CACHE_WRITE_INTERVAL) return;
    const payload = {
      schemaVersion: SENSOR_CACHE_SCHEMA,
      savedAt: now,
      version: result.version || '',
      diagnostics: {
        backend: diagnostics.backend,
        scanStage: diagnostics.scanStage,
        source: diagnostics.source,
      },
      gpuHotspot: result.gpuHotspot,
      gpuHotspots: result.gpuHotspots,
      sensors: sensors.map(sensor => Object.fromEntries(CACHE_SENSOR_FIELDS
        .filter(field => sensor[field] !== undefined)
        .map(field => [field, sensor[field]]))),
    };
    const temporaryPath = `${this.#cachePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.#cachePath), { recursive: true });
      fs.writeFileSync(temporaryPath, JSON.stringify(payload), 'utf8');
      fs.renameSync(temporaryPath, this.#cachePath);
      this.#lastCacheSignature = signature;
      this.#lastCacheWriteAt = now;
    } catch (_) {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch (_) {}
    }
  }

  #validateEndpoint(endpoint) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch (_) {
      throw new Error('服务地址格式不正确');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('服务地址仅支持 HTTP 或 HTTPS');
  }

  async #getRequestConfig(configOverride) {
    const config = normalizeConfig(configOverride || this.getConfig());
    if (this.#runtime) config.endpoint = await this.#runtime.start();
    return config;
  }

  #selectDefaultSensors(sensors, config = {}) {
    const selectedHardware = new Set(config.selectedHardwareIds || []);
    const candidates = config.hardwareFilterEnabled && selectedHardware.size
      ? sensors.filter(sensor => hardwareKeys(sensor).some(key => selectedHardware.has(key)))
      : sensors;
    const scored = candidates.filter(sensor => Number.isFinite(sensor.rawValue)).map((sensor, index) => {
      const text = `${sensor.hardware} ${sensor.name}`.toLowerCase();
      let score = 0;
      if (sensor.type === 'Temperature') score += 30;
      if (sensor.type === 'Load') score += 28;
      if (sensor.type === 'Fan') score += 22;
      if (sensor.type === 'Power') score += 18;
      if (sensor.type === 'Throughput') score += 14;
      if (/package|total|core|memory|used|gpu|cpu/.test(text)) score += 16;
      if (/max|average|d3d|virtual|space/.test(text)) score -= 8;
      return { sensor, score, index };
    });
    return scored.sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, Math.min(12, sensors.length)).map(item => item.sensor.id);
  }

  async #request(route, config, options = {}) {
    this.#validateEndpoint(config.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const headers = { Accept: options.responseType === 'text' ? 'text/plain' : 'application/json' };
    if (config.username || config.password) {
      headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    }

    try {
      const response = await fetch(`${config.endpoint}${route}`, {
        method: options.method || 'GET',
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        let details = null;
        try { details = await response.json(); } catch (_) {}
        if (details?.message) throw new Error(details.message);
        if (details?.error) throw new Error(details.error);
        if (response.status === 401) throw new Error('认证失败，请检查用户名和密码');
        throw new Error(`系统监控后端返回 HTTP ${response.status}`);
      }
      return options.responseType === 'text' ? response.text() : response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接系统监控后端超时');
      if (error instanceof SyntaxError) throw new Error('系统监控后端返回了无效数据');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { SystemMonitorClient, DEFAULT_CONFIG, normalizeConfig, flattenTree };
