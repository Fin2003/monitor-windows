<script>
  import { onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import { decorateFanSensor, fanDisplayModeFor, isFanSensor } from '../../plugins/system-monitor/runtime/fan-display.js';
  import { decorateMemorySensor, isMemoryLoadSensor } from '../../plugins/system-monitor/runtime/memory-display.js';
  import { decorateVramSensor, displayVramSensorName, isVramUsedSensor } from '../../plugins/system-monitor/runtime/vram-display.js';
  import { stripHardwareBrand } from '../../plugins/system-monitor/runtime/hardware-display.js';

  let config = $state({
    endpoint: 'http://127.0.0.1:8085', username: '', password: '', refreshInterval: 2,
    selectedSensors: [], layoutOrder: [], favoriteSensors: [], selectedHardwareIds: [], hardwareFilterEnabled: false, sensorAliases: {}, showMinMax: true,
    sensorLanguage: 'zh', colorMode: 'type', fanDisplayModes: {}, fanDisplayMode: 'rpm', memoryDisplayMode: 'percent', vramDisplayMode: 'percent', vramDisplayUnit: 'GB', presets: [null, null, null, null, null],
    dataFontScale: 0.67, infoFontScale: 1.8,
  });
  let sensors = $state([]);
  let loading = $state(false);
  let saving = $state(false);
  let status = $state('idle');
  let message = $state('内置采集引擎会自动启动，无需安装其他软件');
  let search = $state('');
  let typeFilter = $state('all');
  let sensorView = $state('all');
  let selectedViewSnapshot = $state([]);
  let expandedHardware = $state({});
  let metrics = $state('');
  let showMetrics = $state(false);
  let connectionDiagnostics = $state({});
  let enablingHotspot = $state(false);
  let hardwarePicker = $state();
  let sensorPanelTab = $state('sensors');
  let draggedLayoutSensorId = $state('');
  let layoutDropTargetId = $state('');
  let layoutPreviewWidth = $state(0);
  let layoutPreviewHeight = $state(0);
  let layoutStageWidth = $state(0);
  let layoutStageHeight = $state(0);
  let layoutScreenWidth = $state(960);
  let layoutScreenHeight = $state(640);

  const sensorColors = {
    Temperature: '#FF453A', Load: '#0A84FF', Clock: '#BF5AF2', Frequency: '#BF5AF2',
    Fan: '#30D158', Control: '#30D158', Power: '#FF9F0A', Voltage: '#FFD60A', Current: '#FFD60A',
    Data: '#64D2FF', SmallData: '#64D2FF', Throughput: '#64D2FF', Level: '#5E5CE6',
    Energy: '#FF9F0A', Humidity: '#32D74B', Flow: '#30D158', Noise: '#FF375F',
  };
  const deviceColors = ['#0A84FF', '#FF453A', '#30D158', '#BF5AF2', '#FF9F0A', '#64D2FF', '#FF375F', '#5E5CE6', '#FFD60A', '#00C7BE', '#AC8E68', '#32ADE6'];

  let sensorTypes = $derived([...new Set(sensors.map(sensor => sensor.type))].sort());
  let hardwareOptions = $derived.by(() => {
    const groups = new Map();
    for (const sensor of sensors) {
      const id = sensorHardwareKey(sensor);
      if (!groups.has(id)) groups.set(id, { id, name: displayHardwareRoot(sensor), count: 0 });
      groups.get(id).count += 1;
    }
    return [...groups.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  });
  let hardwareOptionGroups = $derived.by(() => {
    const categories = new Map();
    for (const hardware of hardwareOptions) {
      const category = hardwareCategory(hardware);
      if (!categories.has(category.key)) categories.set(category.key, { ...category, items: [] });
      categories.get(category.key).items.push(hardware);
    }
    return [...categories.values()]
      .sort((left, right) => left.rank - right.rank)
      .map(category => ({
        ...category,
        count: category.items.reduce((total, hardware) => total + hardware.count, 0),
        items: category.items.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
      }));
  });
  let filteredSensors = $derived(sensors.filter(sensor => {
    const query = search.trim().toLowerCase();
    const normalizedQuery = normalizeSearchText(query);
    const queryTerms = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
    const searchable = normalizeSearchText([
      sensor.name, sensor.zhName, sensor.hardware, sensor.zhHardware, sensor.hardwareRoot, sensor.zhHardwareRoot,
      sensor.hardwareId, sensor.hardwareRootId, sensor.id, sensor.type, sensor.zhType, sensor.group, ...(sensor.groupPath || []),
      config.sensorAliases?.[sensor.id],
    ].join(' '));
    const hardwareText = `${sensor.hardware || ''} ${sensor.zhHardware || ''} ${sensor.hardwareRoot || ''} ${sensor.zhHardwareRoot || ''} ${sensor.hardwareId || ''} ${sensor.hardwareRootId || ''}`;
    const cpuFanQuery = /cpu.*(?:fan|风扇)|(?:fan|风扇).*cpu/i.test(normalizedQuery);
    const matchesCpuFanAlias = cpuFanQuery && isFanSensor(sensor) && !/gpu|显卡|graphics/i.test(hardwareText);
    const favoriteSensors = new Set(config.favoriteSensors || []);
    const selectedView = new Set(sensorView === 'selected' ? selectedViewSnapshot : config.selectedSensors || []);
    const selectedHardware = new Set(config.selectedHardwareIds || []);
    const selectedSensors = new Set(config.selectedSensors || []);
    const matchesView = sensorView === 'favorites'
      ? favoriteSensors.has(sensor.id)
      : sensorView === 'selected'
      ? selectedView.has(sensor.id)
      : true;
    const matchesType = typeFilter === 'all' || sensor.type === typeFilter;
    const matchesHardware = config.hardwareFilterEnabled !== true
      || !selectedHardware.size
      || sensorHardwareKeys(sensor).some(key => selectedHardware.has(key))
      || selectedSensors.has(sensor.id)
      || (sensorView === 'selected' && selectedView.has(sensor.id))
      || (sensorView === 'favorites' && favoriteSensors.has(sensor.id))
      || Boolean(normalizedQuery);
    const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery) || queryTerms.every(term => searchable.includes(term)) || matchesCpuFanAlias;
    return matchesView && matchesHardware && matchesType && matchesQuery;
  }));
  let hardwareGroups = $derived.by(() => {
    if (sensorView === 'selected') return [['__selected__', filteredSensors]];
    const groups = new Map();
    for (const sensor of filteredSensors) {
      const hardware = displayHardwareRoot(sensor);
      if (!groups.has(hardware)) groups.set(hardware, []);
      groups.get(hardware).push(sensor);
    }
    return [...groups.entries()];
  });

  function plain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSearchText(value) {
    return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function sensorHardwareKey(sensor) {
    return sensor.hardwareRootId || sensor.hardwareId || sensor.hardware || sensor.id;
  }

  function sensorHardwareKeys(sensor) {
    return [sensor.hardwareRootId, sensor.hardwareId, sensor.hardware, sensor.id].filter(Boolean);
  }

  function displayHardwareRoot(sensor) {
    return config.sensorLanguage === 'en' ? (sensor.hardwareRoot || sensor.hardware) : (sensor.zhHardwareRoot || sensor.zhHardware);
  }

  function hardwareCategory(hardware) {
    const text = `${hardware.id} ${hardware.name}`;
    if (/motherboard|mainboard|主板|lpc|nct|super\s*i\/o/i.test(text)) return { key: 'motherboard', label: '主板', rank: 0 };
    if (/amdcpu|intelcpu|\bcpu\b|processor|ryzen|core\s+i\d/i.test(text)) return { key: 'cpu', label: 'CPU', rank: 1 };
    if (/gpu|graphics|radeon|geforce|显卡/i.test(text)) return { key: 'gpu', label: '显卡', rank: 2 };
    if (/memory|\bram\b|dimm|内存|虚拟内存/i.test(text)) return { key: 'memory', label: '内存', rank: 3 };
    if (/storage|nvme|ssd|hdd|disk|drive|硬盘|磁盘/i.test(text)) return { key: 'storage', label: '存储', rank: 4 };
    if (/network|nic|ethernet|wi-?fi|wlan|网卡|网络/i.test(text)) return { key: 'network', label: '网络', rank: 5 };
    return { key: 'other', label: '其他硬件', rank: 6 };
  }

  function displaySensorName(sensor) {
    return displayVramSensorName(sensor, config.sensorLanguage);
  }

  function displayType(sensor) {
    return config.sensorLanguage === 'en' ? sensor.type : sensor.zhType;
  }

  function isCpuHardwareGroup(group) {
    return group.some(sensor => /cpu/i.test(sensor.hardwareRootId || ''));
  }

  function cpuCoreNumber(sensor) {
    const text = `${sensor.name || ''} ${sensor.zhName || ''}`;
    return text.match(/(?:CPU\s+)?Core\s*#?(\d+)/i)?.[1]
      || text.match(/核心\s*#?(\d+)/)?.[1]
      || '';
  }

  function cpuCoreSensors(group, coreNumber) {
    return group.filter(sensor => cpuCoreNumber(sensor) === coreNumber);
  }

  function isFirstCpuCoreSensor(sensor, group) {
    const coreNumber = cpuCoreNumber(sensor);
    return coreNumber && group.find(item => cpuCoreNumber(item) === coreNumber)?.id === sensor.id;
  }

  function cpuCoreLabel(coreNumber) {
    return config.sensorLanguage === 'en' ? `CPU Core #${coreNumber}` : `CPU 核心 #${coreNumber}`;
  }

  function cpuCorePrimarySensor(coreSensors) {
    return coreSensors.find(sensor => sensor.type === 'Load') || coreSensors[0];
  }

  function selectedCountForView(sensorList) {
    const selected = new Set(sensorView === 'selected' ? selectedViewSnapshot : config.selectedSensors);
    return sensorList.filter(sensor => selected.has(sensor.id)).length;
  }

  let layoutSensors = $derived.by(() => {
    const selected = new Set(config.selectedSensors || []);
    const selectedOrder = new Map((config.selectedSensors || []).map((sensorId, index) => [sensorId, index]));
    const layoutOrder = new Map((config.layoutOrder || []).map((sensorId, index) => [sensorId, index]));
    return sensors.filter(sensor => selected.has(sensor.id)).sort((left, right) =>
      (layoutOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (layoutOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || (selectedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (selectedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  });
  let layoutGrid = $derived(calculateGrid(layoutSensors.length, layoutPreviewWidth, layoutPreviewHeight));
  let layoutGridStyle = $derived(`grid-template-columns: repeat(${layoutGrid.columns}, minmax(0, 1fr)); grid-template-rows: repeat(${layoutGrid.rows}, minmax(0, 1fr));`);
  let layoutScreenFrame = $derived.by(() => {
    const aspect = Math.max(0.2, layoutScreenWidth / Math.max(1, layoutScreenHeight));
    const maxWidth = Math.max(180, layoutStageWidth - 28);
    const maxHeight = Math.max(180, layoutStageHeight - 28);
    if (maxWidth / maxHeight > aspect) return { width: maxHeight * aspect, height: maxHeight };
    return { width: maxWidth, height: maxWidth / aspect };
  });
  let layoutScreenFrameStyle = $derived(`width:${layoutScreenFrame.width}px;height:${layoutScreenFrame.height}px`);

  function calculateGrid(count, width, height) {
    if (!count) return { columns: 1, rows: 1 };
    if (!width || !height) return { columns: Math.ceil(Math.sqrt(count)), rows: Math.ceil(Math.sqrt(count)) };
    const targetAspect = width / height > 2.4 ? 1.15 : width / height < 0.75 ? 0.95 : 1.35;
    let best = { columns: 1, rows: count, score: Infinity };
    for (let columns = 1; columns <= count; columns += 1) {
      const rows = Math.ceil(count / columns);
      const cardAspect = (width / columns) / (height / rows);
      const emptyCells = columns * rows - count;
      let score = Math.abs(Math.log(cardAspect / targetAspect)) + (emptyCells / count) * 0.3;
      if (width / columns < 150) score += (150 - width / columns) / 150;
      if (height / rows < 110) score += (110 - height / rows) / 110;
      if (score < best.score) best = { columns, rows, score };
    }
    return best;
  }

  function layoutCardName(sensor) {
    return config.sensorAliases?.[sensor.id] || displaySensorName(sensor);
  }

  function layoutHardwareName(sensor) {
    return stripHardwareBrand(config.sensorLanguage === 'en' ? sensor.hardware : sensor.zhHardware);
  }

  function layoutColorFor(sensor) {
    if (config.colorMode !== 'device') return sensorColors[sensor.type] || '#8E8E93';
    let hash = 0;
    for (const character of sensor.hardwareId || sensor.hardware || sensor.id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return deviceColors[Math.abs(hash) % deviceColors.length];
  }

  function startLayoutDrag(event, sensorId) {
    draggedLayoutSensorId = sensorId;
    layoutDropTargetId = '';
    event.dataTransfer?.setData('text/plain', sensorId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function updateLayoutDropTarget(event, targetSensorId) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    layoutDropTargetId = targetSensorId !== draggedLayoutSensorId ? targetSensorId : '';
  }

  async function dropLayoutSensor(event, targetSensorId) {
    event.preventDefault();
    const sourceSensorId = draggedLayoutSensorId || event.dataTransfer?.getData('text/plain');
    draggedLayoutSensorId = '';
    layoutDropTargetId = '';
    if (!sourceSensorId || sourceSensorId === targetSensorId) return;
    const order = layoutSensors.map(sensor => sensor.id);
    const sourceIndex = order.indexOf(sourceSensorId);
    const targetIndex = order.indexOf(targetSensorId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    [order[sourceIndex], order[targetIndex]] = [order[targetIndex], order[sourceIndex]];
    config.layoutOrder = order;
    await save(false);
  }

  function finishLayoutDrag() {
    draggedLayoutSensorId = '';
    layoutDropTargetId = '';
  }

  function presetSnapshot() {
    return plain({
      refreshInterval: config.refreshInterval,
      selectedSensors: config.selectedSensors,
      layoutOrder: config.layoutOrder,
      favoriteSensors: config.favoriteSensors,
      selectedHardwareIds: config.selectedHardwareIds,
      hardwareFilterEnabled: config.hardwareFilterEnabled,
      sensorAliases: config.sensorAliases,
      showMinMax: config.showMinMax,
      averageEnabled: config.averageEnabled,
      sensorLanguage: config.sensorLanguage,
      colorMode: config.colorMode,
      fanDisplayModes: config.fanDisplayModes,
      memoryDisplayMode: config.memoryDisplayMode,
      vramDisplayMode: config.vramDisplayMode,
      vramDisplayUnit: config.vramDisplayUnit,
      dataFontScale: config.dataFontScale,
      infoFontScale: config.infoFontScale,
      selectionInitialized: true,
    });
  }

  async function savePreset(index) {
    const existing = config.presets[index];
    const next = [...config.presets];
    next[index] = {
      name: existing?.name || `预设 ${index + 1}`,
      savedAt: Date.now(),
      data: presetSnapshot(),
    };
    config.presets = next;
    config.activePreset = index;
    await save();
    message = `已保存 ${next[index].name}`;
  }

  async function usePreset(index) {
    if (config.presets[index]) await applyPreset(index);
    else await savePreset(index);
  }

  async function saveActivePreset() {
    await savePreset(config.activePreset ?? 0);
  }

  async function applyPreset(index) {
    const preset = config.presets[index];
    if (!preset) return;
    config = {
      ...config,
      ...plain(preset.data),
      favoriteSensors: Array.isArray(preset.data.favoriteSensors) ? preset.data.favoriteSensors : [],
      layoutOrder: Array.isArray(preset.data.layoutOrder) ? preset.data.layoutOrder : [],
      selectedHardwareIds: Array.isArray(preset.data.selectedHardwareIds) ? preset.data.selectedHardwareIds : [],
      hardwareFilterEnabled: preset.data.hardwareFilterEnabled === true,
      presets: config.presets,
      activePreset: index,
    };
    await save();
    if (sensorView === 'selected') selectedViewSnapshot = [...config.selectedSensors];
    message = `已应用 ${preset.name}`;
  }

  async function renamePreset(index) {
    const preset = config.presets[index];
    if (!preset) return;
    const name = window.prompt('修改预设名称', preset.name);
    if (!name?.trim()) return;
    const next = [...config.presets];
    next[index] = { ...preset, name: name.trim() };
    config.presets = next;
    await save(false);
  }

  async function clearPreset(index) {
    const preset = config.presets[index];
    if (!preset || !window.confirm(`确定删除“${preset.name}”吗？`)) return;
    const next = [...config.presets];
    next[index] = null;
    config.presets = next;
    if (config.activePreset === index) config.activePreset = null;
    await save();
  }

  async function resetAverageValues() {
    await window.api.resetSystemMonitorAverages();
    status = 'success';
    message = '平均值统计区间已清空，将从下一次刷新重新计算';
  }

  async function enableRtxHotspot() {
    enablingHotspot = true;
    const result = await window.api.enableSystemMonitorRtxHotspot();
    enablingHotspot = false;
    status = result.success ? 'success' : 'error';
    message = result.success
      ? 'RTX 50 热点直读驱动已配置，请重启 Windows 后重新扫描'
      : result.error;
    if (result.success) connectionDiagnostics = { ...connectionDiagnostics, experimentalDriverRebootRequired: true };
  }

  function previewFontSizes() {
    window.api.previewSystemMonitorConfig(plain(config));
  }

  function previewDisplayOptions() {
    window.api.previewSystemMonitorConfig(plain(config));
    save(false);
  }

  async function load() {
    const saved = await window.api.getSystemMonitorConfig();
    config = { ...config, ...saved };
    const appConfig = await window.api.getConfig();
    document.documentElement.setAttribute('data-theme', appConfig.theme || 'dark');
    layoutScreenWidth = 1024;
    layoutScreenHeight = 600;
  }

  async function save(showFeedback = true) {
    saving = true;
    const result = await window.api.setSystemMonitorConfig(plain(config));
    saving = false;
    if (!result.success) {
      status = 'error';
      message = result.error;
      return false;
    }
    config = result.config;
    if (showFeedback) {
      status = 'success';
      message = '配置已保存';
    }
    return true;
  }

  async function connect() {
    loading = true;
    status = 'loading';
    message = '正在启动内置采集引擎并扫描硬件...';
    const result = await window.api.fetchSystemMonitorData({
      ...plain(config),
      waitForExtendedHardware: true,
    });
    loading = false;
    if (!result.success) {
      status = 'error';
      message = result.error;
      return;
    }
    sensors = result.data.sensors;
    config = { ...config, ...(await window.api.getSystemMonitorConfig()) };
    await syncSelectedHardware();
    const nextExpanded = { ...expandedHardware };
    for (const sensor of sensors) {
      nextExpanded[sensor.hardware] ??= true;
      nextExpanded[sensor.zhHardware] ??= true;
      nextExpanded[sensor.hardwareRoot] ??= true;
      nextExpanded[sensor.zhHardwareRoot] ??= true;
    }
    expandedHardware = nextExpanded;
    const diagnostics = result.data.diagnostics || {};
    connectionDiagnostics = diagnostics;
    if (diagnostics.requiresAdministrator && diagnostics.isAdministrator === false) {
      status = 'error';
      message = '采集器未获得管理员权限，CPU 温度和功耗不可用，请重新启动并允许 UAC';
    } else {
      status = 'success';
      const availableCount = sensors.filter(sensor => sensor.available).length;
      const hotspot = result.data.gpuHotspot;
      const nvidiaHotspot = diagnostics.nvidiaHotspot || {};
      const hotspotText = diagnostics.capabilities?.gpuHotspot === false
        ? 'RTX 50 hotspot is not provided by this backend'
        : diagnostics.experimentalDriverRebootRequired
        ? 'RTX 50 热点驱动已配置，请重启 Windows 一次'
        : nvidiaHotspot.state === 'pawnio-module-awaiting-signature'
        ? 'RTX 50 热点等待 PawnIO 上游官方签名模块'
        : nvidiaHotspot.state === 'pawnio-module-unavailable'
        ? 'RTX 50 热点模块未加载（公开 NVAPI 不提供该通道）'
        : nvidiaHotspot.state === 'direct-reader-error'
        ? 'RTX 50 热点直读模块初始化失败'
        : nvidiaHotspot.state === 'direct-waiting'
        ? 'RTX 50 热点正在读取'
        : nvidiaHotspot.state === 'nvapi-no-hotspot-channel'
        ? 'RTX 50 热点需启用 PawnIO 直读（公开 NVAPI 无独立通道）'
        : hotspot?.available ? `RTX 热点 ${hotspot.value}` : hotspot?.present ? 'RTX 热点等待驱动数据' : 'RTX 热点通道未发现';
      const backendText = diagnostics.backend === 'hwinfo' ? 'Linux hwinfo' : 'Windows LibreHardwareMonitor';
      const modeText = diagnostics.readOnly ? '只读' : '可控制';
      const sourceText = diagnostics.source?.name || backendText;
      message = `已连接 v${result.data.version || '未知'}，${availableCount}/${sensors.length} 个传感器当前有数据 · ${backendText} · ${modeText} · ${hotspotText} · ${sourceText}`;
    }
  }

  function toggleSensor(sensorId) {
    const selected = config.selectedSensors.includes(sensorId);
    config.selectedSensors = selected
      ? config.selectedSensors.filter(id => id !== sensorId)
      : [...config.selectedSensors, sensorId];
    keepSelectedHardwareVisible(sensors.filter(sensor => config.selectedSensors.includes(sensor.id)));
    save(false);
  }

  function setSensorView(view) {
    if (sensorView === view) {
      sensorView = 'all';
      return;
    }
    sensorView = view;
    if (view === 'selected') selectedViewSnapshot = [...config.selectedSensors];
  }

  function toggleFavorite(sensorId) {
    const favorite = new Set(config.favoriteSensors || []);
    if (favorite.has(sensorId)) favorite.delete(sensorId);
    else favorite.add(sensorId);
    config.favoriteSensors = [...favorite];
    save(false);
  }

  function toggleHardware(hardwareId) {
    if (config.hardwareFilterEnabled !== true) {
      config.hardwareFilterEnabled = true;
      config.selectedHardwareIds = [hardwareId];
      save(false);
      return;
    }
    const selected = new Set(config.selectedHardwareIds || []);
    if (selected.has(hardwareId)) selected.delete(hardwareId);
    else selected.add(hardwareId);
    config.selectedHardwareIds = [...selected];
    if (!selected.size) config.hardwareFilterEnabled = false;
    save(false);
  }

  function selectAllHardware() {
    config.hardwareFilterEnabled = true;
    config.selectedHardwareIds = hardwareOptions.map(hardware => hardware.id);
    save(false);
  }

  function clearHardwareSelection() {
    config.hardwareFilterEnabled = false;
    config.selectedHardwareIds = [];
    save(false);
  }

  function keepSelectedHardwareVisible(sensorList) {
    if (config.hardwareFilterEnabled !== true || !config.selectedHardwareIds?.length) return;
    const selected = new Set(config.selectedHardwareIds);
    for (const sensor of sensorList) selected.add(sensorHardwareKey(sensor));
    config.selectedHardwareIds = [...selected];
  }

  async function syncSelectedHardware() {
    if (config.hardwareFilterEnabled !== true || !config.selectedHardwareIds?.length) return;
    const selected = new Set();
    for (const hardwareId of config.selectedHardwareIds) {
      const sensor = sensors.find(item => sensorHardwareKeys(item).includes(hardwareId));
      selected.add(sensor ? sensorHardwareKey(sensor) : hardwareId);
    }
    for (const sensor of sensors) {
      if (config.selectedSensors.includes(sensor.id)) selected.add(sensorHardwareKey(sensor));
    }
    const next = [...selected];
    if (JSON.stringify(next) !== JSON.stringify(config.selectedHardwareIds)) {
      config.selectedHardwareIds = next;
      await save(false);
    }
  }

  function updateAlias(sensorId, value) {
    const aliases = { ...config.sensorAliases };
    if (value.trim()) aliases[sensorId] = value.trim();
    else delete aliases[sensorId];
    config.sensorAliases = aliases;
    save(false);
  }

  function updateFanDisplayMode(sensorId, mode) {
    config.fanDisplayModes = {
      ...(config.fanDisplayModes || {}),
      [sensorId]: mode === 'percent' ? 'percent' : 'rpm',
    };
    save(false);
  }

  function updateMemoryDisplayMode(mode) {
    config.memoryDisplayMode = ['percent', 'used', 'used-percent'].includes(mode) ? mode : 'percent';
    save(false);
  }

  function updateVramDisplayMode(mode) {
    config.vramDisplayMode = ['percent', 'used', 'used-percent'].includes(mode) ? mode : 'percent';
    save(false);
  }

  function updateVramDisplayUnit(unit) {
    config.vramDisplayUnit = unit === 'MB' ? 'MB' : 'GB';
    save(false);
  }

  async function resetSensor(sensor) {
    const result = await window.api.resetSystemMonitorSensor(sensor.id);
    status = result.success ? 'success' : 'error';
    message = result.success ? `已重置：${sensor.name}` : result.error;
    if (result.success) connect();
  }

  async function controlSensor(sensor) {
    const current = sensor.rawValue ?? '';
    const value = window.prompt(`设置 ${sensor.name}（输入 0-100，留空恢复默认）`, String(current));
    if (value === null) return;
    const normalized = value.trim() === '' ? 'null' : Number(value);
    if (normalized !== 'null' && (!Number.isFinite(normalized) || normalized < 0 || normalized > 100)) {
      status = 'error';
      message = '控制值必须为 0 到 100';
      return;
    }
    const result = await window.api.setSystemMonitorSensor(sensor.id, normalized);
    status = result.success ? 'success' : 'error';
    message = result.success ? `已更新：${sensor.name}` : result.error;
    if (result.success) connect();
  }

  async function resetAll() {
    if (!window.confirm('确定重置全部传感器的最小值和最大值吗？')) return;
    const result = await window.api.resetAllSystemMonitorSensors();
    status = result.success ? 'success' : 'error';
    message = result.success ? '已重置全部最小值和最大值' : result.error;
    if (result.success) connect();
  }

  async function openMetrics() {
    const result = await window.api.getSystemMonitorMetrics();
    if (!result.success) {
      status = 'error';
      message = result.error;
      return;
    }
    metrics = result.data;
    showMetrics = true;
  }

  onMount(() => {
    load().then(connect);
    window.api.onThemeChange?.(theme => document.documentElement.setAttribute('data-theme', theme));
    const closeHardwarePicker = event => {
      if (hardwarePicker?.open && !hardwarePicker.contains(event.target)) hardwarePicker.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeHardwarePicker);
    return () => document.removeEventListener('pointerdown', closeHardwarePicker);
  });
</script>

<div class="panel-shell">
  <header class="header">
    <div>
      <div class="eyebrow">LIBRE HARDWARE MONITOR</div>
      <h1>系统监控管理</h1>
      <p>内置 LibreHardwareMonitor 采集引擎，自动启动并扫描全部硬件传感器。</p>
      <div class="source-note">
        Windows 传感器：LibreHardwareMonitor/LibreHardwareMonitor · MPL-2.0 ·
        <button onclick={() => window.api.openExternal('https://github.com/LibreHardwareMonitor/LibreHardwareMonitor')}>源码</button>
        <br />Linux 基础后端：lfreist/hwinfo · MIT ·
        <button onclick={() => window.api.openExternal('https://github.com/lfreist/hwinfo')}>源码</button>
        <br />RTX 50 热点适配：CapFrameX/NvidiaThermal · MIT ·
        <button onclick={() => window.api.openExternal('https://github.com/CXWorld/CapFrameX')}>CapFrameX 源码</button>
        · PawnIO · GPL-2.1（特殊例外） ·
        <button onclick={() => window.api.openExternal('https://github.com/namazso/PawnIO')}>PawnIO 源码</button>
        · <button onclick={() => window.api.openExternal('https://github.com/namazso/PawnIO.Modules')}>PawnIO.Modules 源码</button>
      </div>
    </div>
    <button class="icon-btn" title="关闭" onclick={() => window.api.closePluginPanel('system-monitor')}><Icon name="close" size={18} /></button>
  </header>

  <main>
    <section class="card connection-card">
      <div class="section-heading">
        <div class="section-title"><Icon name="settings" size={16} /> 显示设置</div>
        <div class="preset-toolbar">
          <span>预设</span>
          {#each Array(5) as _, index}
            {@const preset = config.presets?.[index]}
            <button class="preset-button" class:active={config.activePreset === index} class:filled={!!preset} onclick={() => usePreset(index)} title={preset ? `应用：${preset.name}` : `保存当前配置到预设 ${index + 1}`}>{index + 1}</button>
          {/each}
          <button class="preset-tool" onclick={saveActivePreset} title="覆盖保存当前预设"><Icon name="save" size={12} /></button>
          <button class="preset-tool" onclick={() => renamePreset(config.activePreset ?? 0)} disabled={!config.presets?.[config.activePreset ?? 0]} title="重命名当前预设"><Icon name="edit" size={12} /></button>
          <button class="preset-tool danger" onclick={() => clearPreset(config.activePreset ?? 0)} disabled={!config.presets?.[config.activePreset ?? 0]} title="删除当前预设"><Icon name="trash" size={12} /></button>
        </div>
      </div>
      <div class="form-grid">
        <label class="field"><span>刷新间隔</span><div class="suffix-input"><input type="number" min="1" max="60" bind:value={config.refreshInterval} /><em>秒</em></div></label>
        <label class="check-field"><input type="checkbox" bind:checked={config.showMinMax} onchange={previewDisplayOptions} /><span>显示最小值 / 最大值</span></label>
        <label class="check-field average-toggle"><input type="checkbox" bind:checked={config.averageEnabled} onchange={previewDisplayOptions} /><span>平均值模式</span></label>
      </div>
      <div class="font-scale-controls">
        <label class="font-control">
          <span><b>数据字号</b><output>{Math.round(config.dataFontScale * 100)}%</output></span>
          <input type="range" min="0.4" max="1.5" step="0.01" bind:value={config.dataFontScale} oninput={previewFontSizes} onchange={() => save(false)} />
        </label>
        <label class="font-control">
          <span><b>其他信息字号</b><output>{Math.round(config.infoFontScale * 100)}%</output></span>
          <input type="range" min="0.75" max="3" step="0.01" bind:value={config.infoFontScale} oninput={previewFontSizes} onchange={() => save(false)} />
        </label>
        <span class="font-hint">数据字号同时控制当前值、平均采样信息和 Min/Max；拖动时实时更新监控页面</span>
      </div>
      <div class="connection-actions">
        <button class="btn primary" onclick={connect} disabled={loading}><Icon name="refresh" size={14} /> {loading ? '扫描中...' : '重新扫描硬件'}</button>
        <button class="btn" onclick={resetAll} disabled={!sensors.length}>重置全部 Min/Max</button>
        <button class="btn" onclick={openMetrics}>查看 Metrics</button>
        <button class="btn average-reset" onclick={resetAverageValues} disabled={!config.averageEnabled}><Icon name="refresh" size={13} /> 刷新数值（清空区间）</button>
        {#if ['pawnio-module-awaiting-signature', 'pawnio-module-unavailable', 'direct-reader-error', 'nvapi-no-hotspot-channel'].includes(connectionDiagnostics.nvidiaHotspot?.state) && connectionDiagnostics.pawnIoInstalled !== false}
          <button class="btn hotspot-enable" onclick={enableRtxHotspot} disabled={enablingHotspot}>启用 RTX 50 热点（需 UAC/重启）</button>
        {/if}
        <div class="status" class:success={status === 'success'} class:error={status === 'error'}><span class="status-dot"></span>{message}</div>
      </div>
    </section>

    <section class="card sensor-card">
      <div class="sensor-tabs" role="tablist" aria-label="传感器管理分页">
        <button class:active={sensorPanelTab === 'sensors'} onclick={() => sensorPanelTab = 'sensors'} role="tab" aria-selected={sensorPanelTab === 'sensors'}>传感器</button>
        <button class:active={sensorPanelTab === 'layout'} onclick={() => sensorPanelTab = 'layout'} role="tab" aria-selected={sensorPanelTab === 'layout'}>布局</button>
      </div>
      {#if sensorPanelTab === 'sensors'}
      <div class="sensor-toolbar">
        <div class="sensor-heading-summary">
          <div class="section-title"><Icon name="system-monitor" size={16} /> 传感器</div>
          <div class="sensor-meta-row">
            <div class="selection-count">已选 {sensorView === 'selected' ? selectedViewSnapshot.length : config.selectedSensors.length} / {sensors.length}</div>
            <div class="sensor-display-options">
              <label class="inline-field"><span>传感器语言</span><select bind:value={config.sensorLanguage} onchange={() => save(false)}><option value="zh">中文</option><option value="en">English</option></select></label>
              <label class="inline-field"><span>颜色区分</span><select bind:value={config.colorMode} onchange={() => save(false)}><option value="type">按类型</option><option value="device">按硬件设备</option></select></label>
            </div>
          </div>
        </div>
        <div class="filters">
          <input class="search" bind:value={search} placeholder="搜索硬件、名称或 ID" />
          <select bind:value={typeFilter}><option value="all">全部类型</option>{#each sensorTypes as type}<option value={type}>{config.sensorLanguage === 'en' ? type : (sensors.find(sensor => sensor.type === type)?.zhType || type)}</option>{/each}</select>
          <details class="hardware-picker" bind:this={hardwarePicker}>
            <summary class="btn compact">硬件 {config.hardwareFilterEnabled ? `${config.selectedHardwareIds?.length || 0} 项` : '全部'}</summary>
            <div class="hardware-picker-popover">
              <div class="hardware-picker-actions"><button class="picker-action" onclick={selectAllHardware}>全选</button><button class="picker-action" onclick={clearHardwareSelection}>显示全部</button></div>
              <div class="hardware-options">
                {#each hardwareOptionGroups as category}
                  <div class="hardware-option-group">
                    <div class="hardware-category"><strong>{category.label}</strong><span>{category.items.length} 个设备 · {category.count} 项</span></div>
                    {#each category.items as hardware}
                      <label class="hardware-option"><input type="checkbox" checked={config.hardwareFilterEnabled && config.selectedHardwareIds?.includes(hardware.id)} onchange={() => toggleHardware(hardware.id)} /><span title={hardware.name}>{stripHardwareBrand(hardware.name)}</span><em>{hardware.count}</em></label>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          </details>
          <button class="btn compact view-btn" class:active={sensorView === 'favorites'} onclick={() => setSensorView('favorites')} title="只显示已收藏的传感器">收藏 <span>{config.favoriteSensors?.length || 0}</span></button>
          <button class="btn compact view-btn" class:active={sensorView === 'selected'} onclick={() => setSensorView('selected')} title="只显示当前选中的传感器">当前选中 <span>{sensorView === 'selected' ? selectedViewSnapshot.length : config.selectedSensors.length}</span></button>
        </div>
      </div>

      {#if loading && !sensors.length}
        <div class="empty">正在读取传感器...</div>
      {:else if !sensors.length}
        <div class="empty"><Icon name="system-monitor" size={36} /><span>连接后将在这里显示所有传感器</span></div>
      {:else if hardwareGroups.length === 0}
        <div class="empty">没有匹配的传感器</div>
      {:else}
        <div class="sensor-list">
          {#each hardwareGroups as [hardware, group]}
            <div class="hardware-group" class:flat-selected={sensorView === 'selected'}>
              {#if sensorView !== 'selected'}
                <button class="hardware-title" onclick={() => expandedHardware = { ...expandedHardware, [hardware]: !expandedHardware[hardware] }}>
                  <Icon name={expandedHardware[hardware] ? 'chevron-down' : 'chevron-right'} size={14} />
                      <strong>{stripHardwareBrand(hardware)}</strong><span>{group.length}</span>
                </button>
              {/if}
              {#if sensorView === 'selected' || expandedHardware[hardware]}
                {#each group as sensor}
                  {@const coreNumber = sensorView !== 'selected' && isCpuHardwareGroup(group) ? cpuCoreNumber(sensor) : ''}
                  {#if coreNumber}
                    {#if isFirstCpuCoreSensor(sensor, group)}
                      {@const coreSensors = cpuCoreSensors(group, coreNumber)}
                      {@const primarySensor = cpuCorePrimarySensor(coreSensors)}
                      <div class="cpu-core-block">
                        <div class="cpu-core-header">
                          <div><strong>{cpuCoreLabel(coreNumber)}</strong><span>{selectedCountForView(coreSensors)} / {coreSensors.length} 已选</span></div>
                          {#if primarySensor}<b>{displaySensorName(primarySensor)} · {primarySensor.value || '--'}</b>{/if}
                        </div>
                        <div class="cpu-core-sensors">
                          {#each coreSensors as coreSensor}
                            {@const coreFanMode = fanDisplayModeFor(coreSensor, config)}
                            {@const coreDisplaySensor = decorateVramSensor(decorateMemorySensor(decorateFanSensor(coreSensor, sensors, coreFanMode), sensors, config.memoryDisplayMode), sensors, config.vramDisplayMode, config.vramDisplayUnit)}
                            <div class="cpu-sensor-item">
                              <button type="button" class="favorite-toggle" class:active={config.favoriteSensors?.includes(coreSensor.id)} onclick={() => toggleFavorite(coreSensor.id)} title={config.favoriteSensors?.includes(coreSensor.id) ? '取消收藏' : '收藏此传感器'} aria-label={config.favoriteSensors?.includes(coreSensor.id) ? '取消收藏' : '收藏此传感器'}><span aria-hidden="true">{config.favoriteSensors?.includes(coreSensor.id) ? '★' : '☆'}</span></button>
                              <button type="button" class="cpu-sensor-button" class:selected={config.selectedSensors.includes(coreSensor.id)} class:unavailable={!coreSensor.available} onclick={() => toggleSensor(coreSensor.id)} title={coreSensor.id}><strong>{displaySensorName(coreSensor)}</strong><span>{coreSensor.available ? displayType(coreSensor) : '暂无数据'} · {coreDisplaySensor.displayValue}</span></button>
                              <input class="cpu-alias" value={config.sensorAliases[coreSensor.id] || ''} placeholder="重命名" title="为这个传感器设置显示名称" onchange={(event) => updateAlias(coreSensor.id, event.target.value)} />
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  {:else}
                    {@const fanMode = fanDisplayModeFor(sensor, config)}
                    {@const displaySensor = decorateVramSensor(decorateMemorySensor(decorateFanSensor(sensor, sensors, fanMode), sensors, config.memoryDisplayMode), sensors, config.vramDisplayMode, config.vramDisplayUnit)}
                    <div class="sensor-row" class:selected={config.selectedSensors.includes(sensor.id)} class:unavailable={!sensor.available}>
                      <button type="button" class="favorite-toggle" class:active={config.favoriteSensors?.includes(sensor.id)} onclick={() => toggleFavorite(sensor.id)} title={config.favoriteSensors?.includes(sensor.id) ? '取消收藏' : '收藏此传感器'} aria-label={config.favoriteSensors?.includes(sensor.id) ? '取消收藏' : '收藏此传感器'}><span aria-hidden="true">{config.favoriteSensors?.includes(sensor.id) ? '★' : '☆'}</span></button>
                      <label class="sensor-check"><input type="checkbox" checked={config.selectedSensors.includes(sensor.id)} onchange={() => toggleSensor(sensor.id)} /></label>
                      <div class="sensor-main"><div class="sensor-name">{displaySensorName(sensor)}</div><div class="sensor-id">{sensor.id}</div></div>
                      <span class="type-badge">{sensor.available ? displayType(sensor) : '暂无数据'}</span>
                      <div class="sensor-reading" class:memory-reading={isMemoryLoadSensor(sensor)} class:vram-reading={isVramUsedSensor(sensor)} title={displaySensor.fanDisplayFallback ? '未找到对应的风扇百分比传感器，保留实际转速' : ''}><strong>{displaySensor.displayValue}</strong><span>{displaySensor.displayMin} / {displaySensor.displayMax}</span></div>
                      {#if isFanSensor(sensor)}
                        <label class="fan-mode-control" title="仅影响这个传感器卡片的显示方式"><span>风扇</span><select value={fanMode} onchange={(event) => updateFanDisplayMode(sensor.id, event.currentTarget.value)}><option value="rpm">RPM</option><option value="percent">%</option></select></label>
                      {/if}
                      {#if isMemoryLoadSensor(sensor)}
                        <label class="memory-mode-control" title="切换 Total Memory 监控卡片的显示格式"><span>内存</span><select value={config.memoryDisplayMode} onchange={(event) => updateMemoryDisplayMode(event.currentTarget.value)}><option value="percent">仅百分比</option><option value="used-percent">容量 + %</option><option value="used">仅容量</option></select></label>
                      {/if}
                      {#if isVramUsedSensor(sensor)}
                        <label class="vram-mode-control" title="切换 GPU 显存监控卡片的显示格式"><span>显存</span><select value={config.vramDisplayMode} onchange={(event) => updateVramDisplayMode(event.currentTarget.value)}><option value="percent">仅百分比</option><option value="used-percent">容量 + %</option><option value="used">仅容量</option></select><select value={config.vramDisplayUnit} onchange={(event) => updateVramDisplayUnit(event.currentTarget.value)} title="容量单位（按 1024 换算）"><option value="GB">GB（1024）</option><option value="MB">MB（1024）</option></select></label>
                      {/if}
                      <input class="alias" value={config.sensorAliases[sensor.id] || ''} placeholder="重命名" title="为这个传感器设置显示名称" onchange={(event) => updateAlias(sensor.id, event.target.value)} />
                      {#if sensor.type === 'Control'}<button class="row-btn accent" onclick={() => controlSensor(sensor)}>控制</button>{/if}
                      <button class="row-btn" onclick={() => resetSensor(sensor)}>重置</button>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {:else}
        <div class="layout-panel">
          <div class="layout-toolbar">
            <div><strong>监控卡片布局</strong><span>拖动卡片调整顺序，监控页面会即时采用新排列。</span></div>
            <button class="btn compact" onclick={() => save()} disabled={saving || !layoutSensors.length}>保存布局</button>
          </div>
          {#if !layoutSensors.length}
            <div class="layout-empty">请先在“传感器”分页选择要监控的项目。</div>
          {:else}
            <div class="layout-workspace">
              <div class="layout-screen-stage" bind:clientWidth={layoutStageWidth} bind:clientHeight={layoutStageHeight}>
                <div class="layout-virtual-screen" style={layoutScreenFrameStyle}>
                  <div class="layout-screen-header">
                    <div><span class="layout-screen-pulse"></span><strong>系统监控</strong><small>预览</small></div>
                    <span>{layoutScreenWidth}×{layoutScreenHeight}</span>
                  </div>
                  <div class="layout-preview" style={layoutGridStyle} bind:clientWidth={layoutPreviewWidth} bind:clientHeight={layoutPreviewHeight}>
                    {#each layoutSensors as sensor (sensor.id)}
                      <button
                        type="button"
                        class="layout-card"
                        class:dragging={draggedLayoutSensorId === sensor.id}
                        class:drop-target={layoutDropTargetId === sensor.id}
                        style={`--layout-sensor-color:${layoutColorFor(sensor)}`}
                        draggable="true"
                        ondragstart={(event) => startLayoutDrag(event, sensor.id)}
                        ondragover={(event) => updateLayoutDropTarget(event, sensor.id)}
                        ondrop={(event) => dropLayoutSensor(event, sensor.id)}
                        ondragend={finishLayoutDrag}
                        title="拖到另一张卡片上交换位置"
                      >
                        <strong>{layoutCardName(sensor)}</strong>
                        <small>{layoutHardwareName(sensor)}</small>
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
              <div class="layout-order-panel">
                <div class="layout-order-heading"><strong>卡片位置</strong><span>上下拖动排序</span></div>
                <div class="layout-order-list">
                  {#each layoutSensors as sensor, index (sensor.id)}
                  <button
                    type="button"
                    class="layout-order-card"
                    class:dragging={draggedLayoutSensorId === sensor.id}
                    class:drop-target={layoutDropTargetId === sensor.id}
                    style={`--layout-sensor-color:${layoutColorFor(sensor)}`}
                    draggable="true"
                    ondragstart={(event) => startLayoutDrag(event, sensor.id)}
                    ondragover={(event) => updateLayoutDropTarget(event, sensor.id)}
                    ondrop={(event) => dropLayoutSensor(event, sensor.id)}
                    ondragend={finishLayoutDrag}
                    title="拖动调整卡片位置"
                  >
                    <span class="layout-order-index">{index + 1}</span>
                    <span class="layout-order-copy"><strong>{layoutCardName(sensor)}</strong><small>{layoutHardwareName(sensor)}</small></span>
                    <span class="layout-order-handle" aria-hidden="true">⋮⋮</span>
                  </button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </main>
</div>

{#if showMetrics}
  <div class="modal-backdrop" onclick={(event) => { if (event.target === event.currentTarget) showMetrics = false; }} role="presentation">
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header"><div><strong>Prometheus Metrics</strong><span>/metrics 原始输出</span></div><button class="icon-btn" onclick={() => showMetrics = false}><Icon name="close" size={16} /></button></div>
      <textarea readonly value={metrics}></textarea>
    </div>
  </div>
{/if}

<style>
  .panel-shell { height: 100vh; overflow-y: auto; background: var(--bg); }
  .header { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: flex-start; padding: 24px 28px 18px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(18px); border-bottom: 1px solid var(--border); }
  .eyebrow { color: var(--accent); font-size: 10px; letter-spacing: 2px; font-weight: 700; }
  h1 { margin: 3px 0 2px; font-size: 24px; }
  .header p { color: var(--text-secondary); font-size: 13px; }
  .source-note { margin-top: 5px; color: var(--text-secondary); font-size: 11px; }
  .source-note button { padding: 0; background: transparent; color: var(--accent); font-size: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .source-note button:hover { color: var(--accent-hover); }
  main { padding: 20px 28px 32px; display: grid; gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
  .section-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 650; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .preset-toolbar { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 10px; }
  .preset-button, .preset-tool { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); background: var(--bg-secondary); font-size: 10px; }
  .preset-button.filled { color: var(--text-primary); }.preset-button.active { color: white; border-color: var(--accent); background: var(--accent); }
  .preset-button:hover, .preset-tool:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }.preset-button.active:hover { color: white; }
  .preset-tool { width: 24px; height: 24px; border: 0; background: transparent; }.preset-tool.danger:hover { color: var(--danger); }.preset-tool:disabled { opacity: .25; cursor: not-allowed; }
  .form-grid { display: grid; grid-template-columns: minmax(130px, 180px) minmax(220px, 1fr) minmax(170px, 1fr); gap: 10px; margin-top: 14px; align-items: end; }
  .field { display: grid; gap: 5px; min-width: 0; }
  .field span, .check-field span { color: var(--text-secondary); font-size: 11px; }
  .field input { width: 100%; height: 36px; padding: 7px 9px; }
  .suffix-input { display: flex; position: relative; }
  .suffix-input input { padding-right: 34px; }
  .suffix-input em { position: absolute; right: 9px; top: 9px; color: var(--text-secondary); font-style: normal; font-size: 11px; }
  .check-field { display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer; }
  .check-field input, .sensor-check input { accent-color: var(--accent); }
  .font-scale-controls { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) minmax(220px, 1.2fr); align-items:end; gap: 16px; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-secondary); }
  .font-control { display: grid; gap: 5px; }.font-control > span { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 10px; }.font-control b { color: var(--text-primary); font-weight: 600; }.font-control output { color: var(--accent); font-variant-numeric: tabular-nums; }
  .font-control input[type="range"] { width: 100%; height: 4px; appearance: none; padding: 0; border: 0; border-radius: 2px; background: var(--border); }
  .font-control input[type="range"]::-webkit-slider-thumb { width: 15px; height: 15px; appearance: none; border-radius: 50%; background: var(--accent); cursor: ew-resize; }
  .font-hint { color: var(--text-secondary); font-size: 10px; }
  .connection-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .btn { height: 34px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 7px; color: var(--text-primary); background: var(--card-hover); border: 1px solid var(--border); font-size: 12px; }
  .btn:hover { border-color: var(--text-secondary); }
  .btn.primary { color: white; background: var(--accent); border-color: var(--accent); }
  .btn.average-reset { color: var(--accent); }
  .btn.hotspot-enable { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 45%, var(--border)); }
  .btn.compact { height: 32px; padding: 0 9px; white-space: nowrap; }
  .view-btn span { margin-left: 2px; color: var(--text-secondary); font-size: 10px; }
  .view-btn.active { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--card-hover)); }
  .view-btn.active span { color: var(--accent); }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .icon-btn { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; background: transparent; color: var(--text-secondary); }
  .icon-btn:hover { background: var(--card-hover); color: var(--text-primary); }
  .status { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-secondary); }
  .status.success { color: var(--success); }.status.success .status-dot { background: var(--success); }
  .status.error { color: var(--danger); }.status.error .status-dot { background: var(--danger); }
  .sensor-tabs { display: flex; align-items: center; gap: 3px; margin: -2px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .sensor-tabs button { padding: 5px 12px; border: 0; border-radius: 6px; color: var(--text-secondary); background: transparent; font-size: 12px; cursor: pointer; }
  .sensor-tabs button:hover { color: var(--text-primary); background: var(--card-hover); }
  .sensor-tabs button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--card-hover)); font-weight: 650; }
  .sensor-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
  .sensor-heading-summary { min-width: 0; }
  .sensor-meta-row { display: flex; align-items: center; gap: 14px; margin-top: 3px; }
  .selection-count { margin-top: 3px; color: var(--text-secondary); font-size: 11px; }
  .sensor-display-options { display: flex; align-items: center; gap: 8px; }
  .inline-field { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 10px; white-space: nowrap; }
  .inline-field select { height: 27px; padding: 3px 7px; font-size: 11px; }
  .filters { display: flex; align-items: center; gap: 7px; }
  .filters input, .filters select { height: 32px; padding: 5px 9px; font-size: 12px; }
  .search { width: 220px; }
  .hardware-picker { position: relative; }
  .hardware-picker summary { list-style: none; cursor: pointer; }
  .hardware-picker summary::-webkit-details-marker { display: none; }
  .hardware-picker-popover { position: absolute; top: calc(100% + 6px); right: 0; z-index: 8; width: min(360px, 80vw); padding: 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--card); box-shadow: 0 16px 36px rgba(0,0,0,.3); }
  .hardware-picker-actions { display: flex; gap: 6px; padding-bottom: 7px; border-bottom: 1px solid var(--border); }
  .picker-action { padding: 3px 7px; border: 1px solid var(--border); border-radius: 5px; color: var(--text-secondary); background: var(--card-hover); font-size: 10px; }
  .picker-action:hover { color: var(--text-primary); border-color: var(--accent); }
  .hardware-options { display: grid; max-height: 360px; margin-top: 7px; overflow-y: auto; }
  .hardware-option-group { display: grid; gap: 2px; padding: 8px 0; border-top: 1px solid var(--border); }
  .hardware-option-group:first-child { padding-top: 0; border-top: 0; }
  .hardware-category { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 1px 4px 4px; }
  .hardware-category strong { color: var(--text-primary); font-size: 11px; }
  .hardware-category span { color: var(--text-secondary); font-size: 9px; }
  .hardware-option { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 5px 4px; border-radius: 5px; cursor: pointer; }
  .hardware-option:hover { background: var(--card-hover); }
  .hardware-option input { accent-color: var(--accent); }
  .hardware-option span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 11px; }
  .hardware-option em { margin-left: auto; color: var(--text-secondary); font-size: 10px; font-style: normal; }
  .sensor-list { display: grid; gap: 8px; max-height: 500px; overflow-y: auto; padding-right: 3px; }
  .layout-panel { display: grid; gap: 10px; }
  .layout-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0; }
  .layout-toolbar > div { display: grid; gap: 3px; min-width: 0; }
  .layout-toolbar strong { color: var(--text-primary); font-size: 13px; }
  .layout-toolbar span { color: var(--text-secondary); font-size: 11px; }
  .layout-workspace { height: clamp(300px, 42vh, 390px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, 240px); gap: 12px; }
  .layout-screen-stage { min-width: 0; min-height: 0; display: grid; place-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 11px; background: color-mix(in srgb, var(--bg) 76%, var(--card)); overflow: hidden; }
  .layout-virtual-screen { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: clamp(5px, 1vw, 9px); padding: clamp(7px, 1.2vw, 13px); border: 1px solid var(--border); border-radius: clamp(7px, 1vw, 11px); background: radial-gradient(circle at 85% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 40%), var(--bg); box-shadow: inset 0 0 0 1px rgba(255,255,255,.02), 0 10px 24px rgba(0,0,0,.2); overflow: hidden; }
  .layout-screen-header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: clamp(9px, 1vw, 11px); }
  .layout-screen-header > div { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .layout-screen-header strong { color: var(--text-primary); font-size: clamp(14px, 1.8vw, 21px); line-height: 1.1; }
  .layout-screen-header small { color: var(--text-secondary); font-size: .8em; }
  .layout-screen-pulse { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--success); box-shadow: 0 0 10px var(--success); }
  .layout-preview { flex: 1; min-height: 0; display: grid; gap: clamp(3px, .7vw, 7px); overflow: hidden; }
  .layout-card { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; padding: clamp(4px, .8vw, 8px); border: 1px solid color-mix(in srgb, var(--layout-sensor-color) 38%, var(--border)); border-radius: clamp(4px, .7vw, 8px); color: var(--text-primary); background: linear-gradient(145deg, color-mix(in srgb, var(--layout-sensor-color) 10%, var(--card)), var(--card)); text-align: left; cursor: grab; transition: opacity .15s, transform .15s ease, border-color .15s, box-shadow .15s; overflow: hidden; }
  .layout-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: clamp(2px, .25vw, 3px); background: var(--layout-sensor-color); }
  .layout-card:hover { border-color: var(--layout-sensor-color); }
  .layout-card:active { cursor: grabbing; }
  .layout-card.dragging { opacity: .35; transform: scale(.97); }
  .layout-card.drop-target { z-index: 1; border-color: var(--layout-sensor-color); transform: scale(1.035); box-shadow: 0 7px 18px rgba(0,0,0,.24), 0 0 0 2px color-mix(in srgb, var(--layout-sensor-color) 24%, transparent); }
  .layout-card strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: clamp(11px, 1.15vw, 17px); }
  .layout-card small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: clamp(8px, .85vw, 12px); }
  .layout-order-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 11px; background: var(--card); overflow: hidden; }
  .layout-order-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 10px 11px; border-bottom: 1px solid var(--border); }
  .layout-order-heading strong { color: var(--text-primary); font-size: 12px; }
  .layout-order-heading span { color: var(--text-secondary); font-size: 9px; }
  .layout-order-list { min-height: 0; display: flex; flex-direction: column; gap: 5px; padding: 7px; overflow-y: auto; }
  .layout-order-card { position: relative; min-width: 0; flex: 0 0 auto; display: grid; grid-template-columns: 24px minmax(0, 1fr) 18px; align-items: center; gap: 7px; padding: 7px; border: 1px solid var(--border); border-left: 3px solid var(--layout-sensor-color); border-radius: 7px; color: var(--text-primary); background: var(--card-hover); text-align: left; cursor: grab; transition: opacity .15s, transform .15s ease, border-color .15s, box-shadow .15s; }
  .layout-order-card:hover { border-color: var(--layout-sensor-color); }
  .layout-order-card:active { cursor: grabbing; }
  .layout-order-card.dragging { opacity: .35; transform: scale(.98); }
  .layout-order-card.drop-target { z-index: 1; border-color: var(--layout-sensor-color); transform: scale(1.035); box-shadow: 0 7px 18px rgba(0,0,0,.24), 0 0 0 2px color-mix(in srgb, var(--layout-sensor-color) 24%, transparent); }
  .layout-order-index { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: var(--layout-sensor-color); background: color-mix(in srgb, var(--layout-sensor-color) 13%, transparent); font-size: 10px; font-weight: 700; }
  .layout-order-copy { min-width: 0; display: grid; gap: 2px; }
  .layout-order-copy strong, .layout-order-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layout-order-copy strong { font-size: 12px; }
  .layout-order-copy small { color: var(--text-secondary); font-size: 9px; }
  .layout-order-handle { color: var(--text-secondary); font-size: 13px; letter-spacing: -4px; }
  @media (max-width: 760px) {
    .layout-workspace { height: auto; grid-template-columns: 1fr; }
    .layout-screen-stage { height: 300px; }
    .layout-order-panel { max-height: 220px; }
  }
  .layout-empty { min-height: 180px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 9px; color: var(--text-secondary); font-size: 12px; }
  .hardware-group { border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
  .hardware-group.flat-selected { border: 0; border-radius: 0; overflow: visible; }
  .hardware-title { width: 100%; height: 38px; display: flex; align-items: center; gap: 7px; padding: 0 11px; background: var(--bg-secondary); color: var(--text-primary); text-align: left; }
  .hardware-title span { margin-left: auto; color: var(--text-secondary); font-size: 11px; }
  .cpu-core-block { border-top: 1px solid var(--border); background: color-mix(in srgb, var(--card) 96%, var(--accent)); }
  .cpu-core-header { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 11px; border-bottom: 1px solid var(--border); }
  .cpu-core-header > div { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
  .cpu-core-header strong { color: var(--text-primary); font-size: 12px; }
  .cpu-core-header span { color: var(--text-secondary); font-size: 10px; white-space: nowrap; }
  .cpu-core-header b { max-width: 42%; overflow: hidden; color: var(--accent); font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .cpu-core-sensors { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 10px 9px 32px; }
  .cpu-sensor-item { display: inline-flex; align-items: center; min-width: 0; gap: 3px; }
  .cpu-sensor-button { min-width: 118px; height: 44px; display: inline-flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 2px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); background: var(--card-hover); text-align: left; line-height: 1.15; cursor: pointer; }
  .cpu-sensor-button:hover { border-color: var(--accent); }
  .cpu-sensor-button.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, var(--card-hover)); }
  .cpu-sensor-button.unavailable { opacity: .5; }
  .cpu-sensor-button strong { max-width: 150px; overflow: hidden; font-size: 10px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .cpu-sensor-button span { color: var(--text-secondary); font-size: 9px; line-height: 1.2; white-space: nowrap; }
  .cpu-alias { width: 72px; height: 28px; padding: 4px 6px; font-size: 10px; }
  .sensor-row { min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--card) 94%, var(--accent)); }
  .sensor-row.selected { background: color-mix(in srgb, var(--card) 89%, var(--accent)); }
  .sensor-row.unavailable { opacity: .48; }
  .favorite-toggle { flex: 0 0 22px; width: 22px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; color: var(--text-secondary); background: transparent; font-size: 18px; line-height: 1; cursor: pointer; }
  .favorite-toggle:hover { color: var(--warning); background: var(--card-hover); }
  .favorite-toggle.active { color: var(--warning); }
  .sensor-main { flex: 1; min-width: 130px; }
  .sensor-name { font-size: 12px; font-weight: 550; }
  .sensor-id { color: var(--text-secondary); font-family: var(--font-mono); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
  .type-badge { min-width: 70px; text-align: center; padding: 2px 6px; border-radius: 10px; background: var(--card-hover); color: var(--text-secondary); font-size: 10px; }
  .sensor-reading { width: 104px; text-align: right; font-variant-numeric: tabular-nums; }
  .sensor-reading.memory-reading { width: 190px; }
  .sensor-reading.vram-reading { width: 210px; }
  .sensor-reading strong { display: block; color: var(--accent); font-size: 12px; }
  .sensor-reading span { display: block; color: var(--text-secondary); font-size: 9px; }
  .fan-mode-control { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 9px; white-space: nowrap; }
  .fan-mode-control select { width: 58px; height: 28px; padding: 3px 5px; font-size: 10px; }
  .memory-mode-control { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 9px; white-space: nowrap; }
  .memory-mode-control select { width: 88px; height: 28px; padding: 3px 5px; font-size: 10px; }
  .vram-mode-control { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 9px; white-space: nowrap; }
  .vram-mode-control select:first-of-type { width: 88px; height: 28px; padding: 3px 5px; font-size: 10px; }
  .vram-mode-control select:last-of-type { width: 86px; height: 28px; padding: 3px 5px; font-size: 10px; }
  .alias { width: 116px; height: 30px; padding: 5px 8px; font-size: 11px; }
  .row-btn { height: 28px; padding: 0 8px; border-radius: 5px; background: var(--card-hover); color: var(--text-secondary); font-size: 10px; white-space: nowrap; }
  .row-btn:hover { color: var(--text-primary); }.row-btn.accent { color: var(--accent); }
  .empty { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }
  .modal-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.6); }
  .modal { width: min(820px, 92vw); height: min(620px, 84vh); display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,.35); overflow: hidden; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .modal-header strong, .modal-header span { display: block; }.modal-header span { color: var(--text-secondary); font-size: 10px; }
  .modal textarea { flex: 1; resize: none; border: 0; border-radius: 0; padding: 14px; font-family: var(--font-mono); font-size: 11px; line-height: 1.45; user-select: text; }
  @media (max-width: 900px) { .section-heading { align-items: flex-start; flex-direction: column; }.form-grid { grid-template-columns: 1fr 1fr 1fr; }.font-scale-controls { grid-template-columns: 1fr 1fr; }.font-hint { grid-column: 1 / -1; }.sensor-toolbar { align-items: stretch; flex-direction: column; }.sensor-meta-row { flex-wrap: wrap; }.filters { flex-wrap: wrap; }.status { width: 100%; margin-left: 0; }.sensor-id { max-width: 180px; } }
</style>
