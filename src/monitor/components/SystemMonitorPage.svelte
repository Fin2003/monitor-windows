<script>
  import { onMount, onDestroy } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import { decorateFanSensor, fanDisplayModeFor, findCounterpart, isFanSensor } from '../../../plugins/system-monitor/runtime/fan-display.js';
  import { decorateMemorySensor } from '../../../plugins/system-monitor/runtime/memory-display.js';
  import { decorateVramSensor, displayVramSensorName } from '../../../plugins/system-monitor/runtime/vram-display.js';
  import { stripHardwareBrand } from '../../../plugins/system-monitor/runtime/hardware-display.js';

  let { compact = false, horizontal = false, sensorIds = [], fontScale = 1, dataScale: overviewDataScale = 1 } = $props();

  let config = $state({ refreshInterval: 2, selectedSensors: [], layoutOrder: [], selectedHardwareIds: [], hardwareFilterEnabled: false, sensorAliases: {}, columns: 0, showMinMax: true, averageEnabled: false, sensorLanguage: 'zh', colorMode: 'type', fanDisplayMode: 'rpm', memoryDisplayMode: 'percent', vramDisplayMode: 'percent', vramDisplayUnit: 'GB', dataFontScale: 0.67, infoFontScale: 1.8 });
  let sensors = $state([]);
  let loading = $state(true);
  let error = $state('');
  let version = $state('');
  let backend = $state('');
  let diagnostics = $state({});
  let updatedAt = $state(0);
  let timer = null;
  let refreshPending = false;
  let disposed = false;
  const subscriptions = [];
  let gridWidth = $state(0);
  let gridHeight = $state(0);

  let visibleSensors = $derived.by(() => {
    const selection = compact ? sensorIds.filter(id=>(config.selectedSensors || []).includes(id)).slice(0, 2) : (config.selectedSensors || []);
    if (compact && !selection.length) return [];
    const selected = new Set(selection);
    const selectedHardware = new Set(config.selectedHardwareIds || []);
    const hardwareScoped = config.hardwareFilterEnabled && selectedHardware.size
      ? sensors.filter(sensor => [sensor.hardwareRootId, sensor.hardwareId, sensor.hardware, sensor.id].filter(Boolean).some(key => selectedHardware.has(key)) || selected.has(sensor.id))
      : sensors;
    const result = selected.size ? hardwareScoped.filter(sensor => selected.has(sensor.id)) : hardwareScoped.slice(0, 12);
    const layoutOrder = new Map((compact ? selection : config.layoutOrder || []).map((sensorId, index) => [sensorId, index]));
    const selectedOrder = new Map(selection.map((sensorId, index) => [sensorId, index]));
    result.sort((left, right) => (layoutOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (layoutOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || (selectedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (selectedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    return result.map(sensor => {
      const displaySensor = decorateVramSensor(
        decorateMemorySensor(
          decorateFanSensor(sensor, sensors, fanDisplayModeFor(sensor, config)),
          sensors,
          config.memoryDisplayMode,
        ),
        sensors,
        config.vramDisplayMode,
        config.vramDisplayUnit,
      );
      return {
      ...displaySensor,
      displayName: config.sensorAliases?.[sensor.id] || displayVramSensorName(sensor, config.sensorLanguage),
      displayHardware: stripHardwareBrand(config.sensorLanguage === 'en' ? sensor.hardware : sensor.zhHardware),
      displayType: config.sensorLanguage === 'en' ? sensor.type : sensor.zhType,
      };
    });
  });
  let gridLayout = $derived(compact && horizontal ? { columns: Math.max(1, visibleSensors.length), rows: 1 } : calculateGrid(visibleSensors.length, gridWidth, gridHeight));
  let gridStyle = $derived(`grid-template-columns: repeat(${gridLayout.columns}, minmax(0, 1fr)); grid-template-rows: repeat(${gridLayout.rows}, minmax(0, 1fr));`);

  const colors = {
    Temperature: '#FF453A', Load: '#0A84FF', Clock: '#BF5AF2', Frequency: '#BF5AF2',
    Fan: '#30D158', Control: '#30D158', Power: '#FF9F0A', Voltage: '#FFD60A', Current: '#FFD60A',
    Data: '#64D2FF', SmallData: '#64D2FF', Throughput: '#64D2FF', Level: '#5E5CE6',
    Energy: '#FF9F0A', Humidity: '#32D74B', Flow: '#30D158', Noise: '#FF375F',
  };

  const deviceColors = ['#0A84FF', '#FF453A', '#30D158', '#BF5AF2', '#FF9F0A', '#64D2FF', '#FF375F', '#5E5CE6', '#FFD60A', '#00C7BE', '#AC8E68', '#32ADE6'];

  function calculateGrid(count, width, height) {
    if (!count) return { columns: 1, rows: 1 };
    if (!width || !height) return { columns: Math.ceil(Math.sqrt(count)), rows: Math.ceil(Math.sqrt(count)) };

    const targetAspect = width / height > 2.4 ? 1.15 : width / height < 0.75 ? 0.95 : 1.35;
    let best = { columns: 1, rows: count, score: Infinity };
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const cardWidth = width / columns;
      const cardHeight = height / rows;
      const cardAspect = cardWidth / cardHeight;
      const emptyCells = columns * rows - count;
      let score = Math.abs(Math.log(cardAspect / targetAspect)) + (emptyCells / count) * 0.3;
      if (cardWidth < 100) score += (100 - cardWidth) / 100;
      if (cardHeight < 72) score += (72 - cardHeight) / 72;
      if (score < best.score) best = { columns, rows, score };
    }
    return best;
  }

  function colorFor(sensor) {
    if (config.colorMode !== 'device') return colors[sensor.type] || '#8E8E93';
    let hash = 0;
    for (const character of sensor.hardwareId || sensor.hardware || sensor.id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return deviceColors[Math.abs(hash) % deviceColors.length];
  }

  function valueFontSize(value) {
    const length = Math.max(3, String(value || '--').length);
    return Math.max(9, Math.min(30, 150 / (length * 0.75)));
  }

  function visualLength(value) {
    return [...String(value || '--')].reduce((length, character) => length + (/[\u2e80-\u9fff]/u.test(character) ? 1.35 : 0.72), 0);
  }

  function longestDisplayLine(lines, fallback = '--') {
    const values = Array.isArray(lines) && lines.length ? lines : [fallback];
    return values.reduce((longest, value) => visualLength(value) > visualLength(longest) ? value : longest, values[0] || fallback);
  }

  function cardDataScale(sensor, displayValue, capacityLayout = null) {
    const primaryLength = visualLength(displayValue);
    const currentValue = capacityLayout?.primary || longestDisplayLine(sensor.displayValueLines, sensor.displayValue || '--');
    const averageLength = visualLength(`当前 ${currentValue}`);
    const minLength = visualLength(`MIN ${sensor.displayMin || '--'}`);
    const maxLength = visualLength(`MAX ${sensor.displayMax || '--'}`);
    if (capacityLayout) {
      const auxiliaryScale = 13 / Math.max(13, minLength, maxLength);
      return Math.max(0.72, Math.min(1, auxiliaryScale));
    }
    const memoryCapacityMode = Boolean(capacityLayout)
      || (Array.isArray(sensor.displayValueLines) && sensor.displayValueLines.length > 0);
    const primaryTarget = memoryCapacityMode ? 14 : 5.8;
    const auxiliaryTarget = memoryCapacityMode ? 20 : 13;
    const primaryScale = primaryTarget / Math.max(primaryTarget, primaryLength);
    const auxiliaryScale = auxiliaryTarget / Math.max(auxiliaryTarget, averageLength, minLength, maxLength);
    return Math.max(0.58, Math.min(1, primaryScale, auxiliaryScale));
  }

  function cardInfoScale(sensor) {
    const titleLength = Math.max(visualLength(sensor.displayName), visualLength(sensor.displayHardware));
    return Math.max(0.62, Math.min(1, 18 / Math.max(18, titleLength)));
  }

  function fitSensorCard(node, options = {}) {
    let animationFrame = 0;
    let fitting = false;
    let disposed = false;
    let lastWidth = 0;
    let lastHeight = 0;
    let fitKey = options.fitKey || '';

    const outerHeight = (element) => {
      if (!element) return 0;
      const style = getComputedStyle(element);
      return Math.max(element.scrollHeight, element.offsetHeight)
        + (Number.parseFloat(style.marginTop) || 0)
        + (Number.parseFloat(style.marginBottom) || 0);
    };

    const fitElementWidth = (element, minimumSize, reset = true) => {
      if (!element) return;
      if (reset) element.style.removeProperty('font-size');
      const naturalSize = Number.parseFloat(getComputedStyle(element).fontSize) || minimumSize;
      const availableWidth = element.clientWidth;
      if (!availableWidth || element.scrollWidth <= availableWidth + 1) return;
      const ratio = availableWidth / element.scrollWidth;
      element.style.fontSize = `${Math.max(minimumSize, naturalSize * ratio * 0.97)}px`;
    };

    const fitCapacityWidth = (primary, minimumSize, reset = true) => {
      if (!primary) return;
      if (reset) primary.style.removeProperty('font-size');
      const naturalSize = Number.parseFloat(getComputedStyle(primary).fontSize) || minimumSize;
      const availableWidth = primary.clientWidth;
      if (!availableWidth || primary.scrollWidth <= availableWidth + 1) return;
      const ratio = availableWidth / primary.scrollWidth;
      primary.style.fontSize = `${Math.max(minimumSize, naturalSize * ratio * 0.97)}px`;
    };

    const syncCapacitySideFont = (value, primary) => {
      if (!value || !primary) return;
      const primarySize = Number.parseFloat(getComputedStyle(primary).fontSize) || 18;
      value.style.setProperty('--capacity-side-font', `${Math.max(10, primarySize * 0.5)}px`);
    };

    const fitPairWidth = (element, minimumSize) => {
      if (!element) return;
      element.style.removeProperty('font-size');
      const naturalSize = Number.parseFloat(getComputedStyle(element).fontSize) || minimumSize;
      const children = [...element.children];
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const requiredWidth = children.reduce((width, child) => width + child.scrollWidth, 0) + gap * Math.max(0, children.length - 1);
      if (!element.clientWidth || requiredWidth <= element.clientWidth) return;
      const ratio = element.clientWidth / requiredWidth;
      element.style.fontSize = `${Math.max(minimumSize, naturalSize * ratio * 0.96)}px`;
    };

    const fit = () => {
      if (fitting || disposed) return;
      fitting = true;
      animationFrame = 0;
      try {
        const value = node.querySelector('.value');
        const capacityPrimary = node.querySelector('.capacity-primary');
        const name = node.querySelector('.name');
        const cardTop = node.querySelector('.card-top');
        const infoBlock = node.querySelector('.info-block');
        const valueBlock = node.querySelector('.value-block');
        const statsBlock = node.querySelector('.stats-block');
        const averageMeta = node.querySelector('.average-meta');
        const minmax = node.querySelector('.minmax');
        for (const element of [value, capacityPrimary, name, cardTop, averageMeta, minmax]) element?.style.removeProperty('font-size');
        value?.style.removeProperty('--capacity-side-font');

        if (capacityPrimary) {
          fitCapacityWidth(capacityPrimary, 18);
          syncCapacitySideFont(value, capacityPrimary);
        }
        else fitElementWidth(value, 14);
        fitElementWidth(name, 13);
        if (!node.classList.contains('info-large')) fitPairWidth(cardTop, 9);
        fitPairWidth(averageMeta, 13);
        fitPairWidth(minmax, compact ? 9 : 13);

        if (value && !capacityPrimary && valueBlock && valueBlock.scrollHeight > valueBlock.clientHeight) {
          const currentSize = Number.parseFloat(getComputedStyle(value).fontSize) || 14;
          const valueHeight = Math.max(1, value.offsetHeight);
          const targetHeight = Math.max(14, valueHeight - (valueBlock.scrollHeight - valueBlock.clientHeight) - 2);
          value.style.fontSize = `${Math.max(14, currentSize * targetHeight / valueHeight)}px`;
          fitElementWidth(value, 14, false);
        }

        if (infoBlock) {
          for (let pass = 0; pass < 3; pass += 1) {
            const requiredHeight = outerHeight(cardTop) + outerHeight(name);
            if (!requiredHeight || requiredHeight <= infoBlock.clientHeight + 1) break;
            const ratio = Math.min(0.96, infoBlock.clientHeight / requiredHeight);
            if (cardTop) {
              const currentSize = Number.parseFloat(getComputedStyle(cardTop).fontSize) || 10;
              cardTop.style.fontSize = `${Math.max(9, currentSize * ratio)}px`;
            }
            if (name) {
              const currentSize = Number.parseFloat(getComputedStyle(name).fontSize) || 13;
              name.style.fontSize = `${Math.max(12, currentSize * ratio)}px`;
            }
          }
          fitElementWidth(name, 12, false);
        }

        if (statsBlock && statsBlock.scrollHeight > statsBlock.clientHeight) {
          const ratio = Math.max(0.78, statsBlock.clientHeight / statsBlock.scrollHeight);
          for (const element of [averageMeta, minmax]) {
            if (!element) continue;
            const currentSize = Number.parseFloat(getComputedStyle(element).fontSize) || 13;
            element.style.fontSize = `${Math.max(12, currentSize * ratio)}px`;
          }
        }
      } finally {
        lastWidth = node.clientWidth;
        lastHeight = node.clientHeight;
        fitting = false;
      }
    };

    const schedule = (force = false) => {
      if (disposed) return;
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (!force && Math.abs(width - lastWidth) < 0.5 && Math.abs(height - lastHeight) < 0.5) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(() => schedule());
    observer.observe(node);
    schedule(true);
    return {
      update: (nextOptions = {}) => {
        const nextKey = nextOptions.fitKey || '';
        if (nextKey === fitKey) return;
        fitKey = nextKey;
        schedule(true);
      },
      destroy() {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        observer.disconnect();
      },
    };
  }

  function percentage(sensor) {
    if (isFanSensor(sensor)) return fanPercentage(sensor);
    if (!['Load', 'Control', 'Level', 'Humidity'].includes(sensor.type)
      && !['Control', 'Load'].includes(sensor.displaySourceType)) return null;
    const averageValue = sensor.displaySourceType === 'Control'
      ? sensor.displayAverageRaw
      : sensor.displaySourceType === 'Load'
        ? sensor.displayAverageRaw ?? sensor.averageRaw
        : sensor.averageRaw;
    const value = config.averageEnabled && Number.isFinite(averageValue)
      ? averageValue
      : sensor.displayRawValue;
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  }

  function fanPercentage(sensor) {
    const counterpart = sensor.type === 'Control' ? sensor : findCounterpart(sensor, sensors);
    const percentSource = counterpart?.type === 'Control' ? counterpart : null;
    const percentValue = config.averageEnabled && Number.isFinite(percentSource?.averageRaw)
      ? percentSource.averageRaw
      : percentSource?.rawValue;
    if (Number.isFinite(percentValue)) return Math.max(0, Math.min(100, percentValue));
    if (!Number.isFinite(sensor.rawValue)) return null;
    const isPump = /pump|水泵/i.test(`${sensor.name || ''} ${sensor.zhName || ''}`);
    const nominalMaxRpm = isPump ? 5000 : 3000;
    return Math.max(0, Math.min(100, (sensor.rawValue / nominalMaxRpm) * 100));
  }

  function schedule() {
    clearInterval(timer);
    if (disposed) return;
    timer = setInterval(refresh, Math.max(1, Number(config.refreshInterval) || 2) * 1000);
  }

  function mergeScanningSensors(nextSensors, scanStage) {
    if (!sensors.length || !nextSensors.length || !['extended', 'partial'].includes(scanStage)) return nextSensors;
    const currentIds = new Set(nextSensors.map(sensor => sensor.id));
    const cachedSensors = sensors
      .filter(sensor => !currentIds.has(sensor.id))
      .map(sensor => ({ ...sensor, cached: true, stale: true }));
    return [...nextSensors, ...cachedSensors];
  }

  async function loadConfig() {
    const next = await window.api.getSystemMonitorConfig();
    if (disposed) return;
    config = { ...config, ...next };
    schedule();
  }

  async function loadCachedData() {
    const result = await window.api.getCachedSystemMonitorData?.();
    if (disposed) return;
    if (!result?.success || !result.data?.sensors?.length) return;
    sensors = result.data.sensors.map(sensor => ({ ...sensor, cached: true }));
    version = result.data.version || '';
    diagnostics = result.data.diagnostics || { status: 'cached', cached: true };
    backend = diagnostics.backend || 'librehardwaremonitor';
    updatedAt = result.data.fetchedAt || 0;
    loading = false;
  }

  async function refresh() {
    if (refreshPending || disposed) return;
    refreshPending = true;
    try {
      const result = await window.api.fetchSystemMonitorData();
      if (disposed) return;
      loading = false;
      if (!result.success) {
        error = result.error;
        return;
      }
      error = '';
      if (result.data.config) config = result.data.config;
      const scanStage = result.data.diagnostics?.scanStage;
      const hasCachedTail = ['extended', 'partial'].includes(scanStage) && sensors.some(sensor => sensor.cached || sensor.stale);
      sensors = mergeScanningSensors(result.data.sensors, scanStage);
      version = result.data.version;
      diagnostics = { ...(result.data.diagnostics || {}), cached: hasCachedTail };
      backend = diagnostics.backend || 'librehardwaremonitor';
      updatedAt = result.data.fetchedAt;
    } catch (e) {
      if (!disposed) { loading = false; error = e.message; }
    } finally {
      refreshPending = false;
    }
  }

  onMount(() => {
    subscriptions.push(window.api.onSystemMonitorConfig(next => {
      if (disposed) return;
      config = { ...config, ...next };
      schedule();
      refresh();
    }));
    subscriptions.push(window.api.onSystemMonitorPreviewConfig(next => { if (!disposed) config = { ...config, ...next }; }));
    subscriptions.push(window.api.onSystemMonitorAverageReset(() => refresh()));
    (async () => {
      await loadConfig();
      if (disposed) return;
      await loadCachedData();
      await refresh();
    })().catch(e => { if (!disposed) { loading = false; error = e.message; } });
  });

  onDestroy(() => { disposed = true; clearInterval(timer); subscriptions.forEach(unsubscribe => unsubscribe?.()); });
</script>

<div class="system-page" class:compact>
  {#if !compact}
  <header>
    <div class="title-wrap">
      <span class="pulse" class:error={!!error}></span>
      <div><h2>系统监控</h2><p>{backend === 'hwinfo' ? 'lfreist/hwinfo · Linux' : 'LibreHardwareMonitor · Windows'} {version ? `v${version}` : ''}</p></div>
    </div>
    <div class="header-status">{#if config.averageEnabled}<span class="average-badge">AVG</span>{/if}{#if diagnostics.cached}<span class="cache-badge">缓存</span>{/if}<span class="updated">{updatedAt ? `更新 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '等待数据'}</span></div>
  </header>
  {/if}

  {#if loading && !sensors.length}
    <div class="state"><Icon name="refresh" size={30} /><strong>正在读取硬件传感器</strong></div>
  {:else if error && !sensors.length}
    <div class="state error-state"><Icon name="system-monitor" size={38} /><strong>内置硬件采集器启动失败</strong><span>{error}</span><small>{diagnostics.requiresAdministrator ? '完整主板和风扇数据需要以管理员权限启动监控软件。' : '请检查 Linux 引擎文件、权限和 hwinfo 后端日志。'}</small></div>
  {:else if !visibleSensors.length}
    <div class="state"><Icon name="system-monitor" size={compact ? 20 : 38} /><strong>没有可显示的传感器</strong>{#if !compact}<span>请在系统监控管理页面选择传感器。</span>{/if}</div>
  {:else}
    <div class="sensor-grid" style={gridStyle} bind:clientWidth={gridWidth} bind:clientHeight={gridHeight}>
      {#each visibleSensors as sensor}
        {@const pct = percentage(sensor)}
        {@const color = colorFor(sensor)}
        {@const displayValueLines = config.averageEnabled ? sensor.displayAverageValueLines : sensor.displayValueLines}
        {@const displayValue = config.averageEnabled ? (sensor.displayAverageValue || sensor.displayValue || '--') : (sensor.displayValue || '--')}
        {@const capacityLayout = config.averageEnabled ? (sensor.displayAverageCapacityLayout || sensor.displayCapacityLayout) : sensor.displayCapacityLayout}
        {@const displayFitValue = capacityLayout?.primary || longestDisplayLine(displayValueLines, displayValue)}
        {@const dataScale = (Number(config.dataFontScale) || 0.67) * (compact ? overviewDataScale : 1)}
        {@const infoScale = (Number(config.infoFontScale) || 1.8) * (compact ? fontScale : 1)}
        {@const dataCardScale = cardDataScale(sensor, displayFitValue, capacityLayout)}
        {@const infoCardScale = cardInfoScale(sensor)}
        {@const effectiveDataScale = dataScale * dataCardScale}
        {@const effectiveInfoScale = infoScale * infoCardScale}
        {@const fitKey = `${sensor.id}|${displayFitValue.length}|${displayValueLines?.length || 0}|${capacityLayout?.mode || ''}|${sensor.displayName?.length || 0}|${sensor.displayHardware?.length || 0}|${sensor.displayMin?.length || 0}|${sensor.displayMax?.length || 0}|${dataScale.toFixed(2)}|${infoScale.toFixed(2)}|${config.averageEnabled}|${config.showMinMax}`}
        <article use:fitSensorCard={{ fitKey, displayValue: displayFitValue, effectiveDataScale, effectiveInfoScale, averageEnabled: config.averageEnabled, showMinMax: config.showMinMax }} class="sensor-card" class:info-large={effectiveInfoScale >= 2.15} class:has-stats={config.averageEnabled || config.showMinMax} style={`--sensor-color:${color};--value-font:${valueFontSize(displayFitValue) * effectiveDataScale}cqw;--value-height:${24 * effectiveDataScale}cqh;--value-max:${82 * effectiveDataScale}px;--top-cqw:${3.2 * effectiveInfoScale}cqw;--top-cqh:${5 * effectiveInfoScale}cqh;--name-cqw:${5 * effectiveInfoScale}cqw;--name-cqh:${8 * effectiveInfoScale}cqh;--meta-cqw:${5.5 * effectiveDataScale}cqw;--meta-cqh:${7 * effectiveDataScale}cqh;--minmax-cqw:${5.5 * effectiveDataScale}cqw;--minmax-cqh:${7 * effectiveDataScale}cqh`}>
          <div class="info-block">
            <div class="card-top"><span class="type">{sensor.displayType}</span><span class="hardware">{sensor.displayHardware}</span></div>
            <div class="name" title={sensor.displayName}>{sensor.displayName}</div>
          </div>
          <div class="value-block">
            <div class="value" class:multi-line={!capacityLayout && displayValueLines?.length > 1} class:capacity-value={!!capacityLayout} class:capacity-percent={capacityLayout?.mode === 'used-percent'}>
              {#if capacityLayout}
                <span class="capacity-primary">{capacityLayout.primary}</span>
                <span class="capacity-side">
                  {#each capacityLayout.secondary as item}
                    <span class="capacity-side-row" class:percentage={item.kind === 'percent'} class:total={item.kind === 'total'}>
                      {#if item.label}<small>{item.label}</small>{/if}<strong>{item.value}</strong>
                    </span>
                  {/each}
                </span>
              {:else if displayValueLines?.length}
                {#each displayValueLines as line}<span>{line}</span>{/each}
              {:else}
                {displayValue}
              {/if}
            </div>
            {#if pct !== null}<div class="meter"><span style={`width:${pct}%`}></span></div>{/if}
          </div>
          {#if config.averageEnabled || config.showMinMax}
            <div class="stats-block">
              {#if config.averageEnabled}<div class="average-meta"><span>当前 {sensor.displayValue || '--'}</span><span>{sensor.averageCount || 0} 次采样</span></div>{/if}
              {#if config.showMinMax}<div class="minmax"><span>MIN <b>{sensor.displayMin || '--'}</b></span><span>MAX <b>{sensor.displayMax || '--'}</b></span></div>{/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
    {#if error}<div class="stale-warning">连接暂时中断，正在显示上次数据：{error}</div>{/if}
  {/if}
</div>

<style>
  .system-page { width: 100%; height: 100%; display: flex; flex-direction: column; padding: clamp(10px, 2.5vw, 24px); overflow: hidden; background: var(--bg); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: clamp(8px, 1.8vh, 18px); flex-shrink: 0; }
  .title-wrap { display: flex; align-items: center; gap: 10px; }
  .pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--green); }
  .pulse.error { background: var(--red); }
  h2 { margin: 0; font-size: clamp(16px, 2.5vw, 26px); font-weight: 700; line-height: 1.1; }
  header p, .updated { color: var(--text-3); font-size: clamp(9px, 1.4vw, 14px); }
  .header-status { display: flex; align-items: center; gap: 8px; }.average-badge, .cache-badge { padding: 2px 6px; border-radius: 8px; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-size: 9px; font-weight: 800; letter-spacing: 1px; }.cache-badge { color: var(--warning); background: color-mix(in srgb, var(--warning) 14%, transparent); letter-spacing: 0; }
  .sensor-grid { flex: 1; min-height: 0; display: grid; gap: clamp(6px, 1.3vw, 12px); overflow: hidden; }
  .sensor-card { container-type: size; position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: repeat(2, minmax(max-content, 1fr)); padding: clamp(8px, 1.5vw, 16px); border: 0; border-radius: clamp(10px, 1.6vw, 16px); background: var(--surface); overflow: hidden; }
  .sensor-card.has-stats { grid-template-rows: repeat(3, minmax(max-content, 1fr)); }
  .info-block, .value-block, .stats-block { min-width: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
  .info-block { padding-block: 2px; }
  .sensor-card.has-stats .value-block { justify-content: flex-end; }
  .sensor-card.has-stats .stats-block { justify-content: center; }
  .card-top { display: flex; flex-shrink: 0; align-items: flex-start; justify-content: space-between; flex-wrap: nowrap; gap: 2px 6px; color: var(--text-secondary); font-size: clamp(10px, min(var(--top-cqw), var(--top-cqh)), 32px); line-height: 1.08; letter-spacing: 0; }
  .hardware { min-width: 0; max-width: 68%; overflow: hidden; color: var(--text-3); text-overflow: ellipsis; white-space: nowrap; text-align: right; text-transform: none; }
  .sensor-card.info-large .card-top { flex-direction: column; align-items: flex-start; flex-wrap: wrap; gap: 4px; }
  .sensor-card.info-large .hardware { max-width: 100%; overflow: visible; white-space: normal; overflow-wrap: anywhere; text-align: left; }
  .type { display: inline-flex; align-items: center; gap: .45em; color: var(--text-secondary); font-weight: 500; }
  .type::before { content: ''; width: .5em; height: .5em; flex: none; border-radius: 50%; background: var(--sensor-color); }
  .name { flex-shrink: 0; margin: clamp(12px, 2.2cqh, 20px) 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(14px, min(var(--name-cqw), var(--name-cqh)), 44px); font-weight: 700; line-height: 1.02; }
  .value { max-width: 100%; margin: 0; overflow: hidden; color: var(--sensor-color); font-size: clamp(14px, min(var(--value-font), var(--value-height)), var(--value-max)); line-height: .94; font-weight: 700; letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .value.multi-line { display: flex; flex-direction: column; align-items: flex-start; gap: .08em; line-height: .86; white-space: normal; }
  .value.multi-line span { max-width: 100%; white-space: nowrap; }
  .value.multi-line span:last-child { font-size: 1.14em; }
  .value.capacity-value { width: 100%; min-height: 1.05em; display: grid; grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr); align-items: center; gap: clamp(6px, 2cqw, 14px); overflow: hidden; white-space: normal; }
  .capacity-primary { min-width: 0; overflow: hidden; color: var(--sensor-color); font-size: 1em; font-weight: 780; line-height: .9; text-overflow: clip; white-space: nowrap; }
  .capacity-side { min-width: 0; align-self: stretch; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; color: var(--text-secondary); font-size: var(--capacity-side-font, 12px); font-weight: 600; line-height: 1; letter-spacing: -.25px; }
  .capacity-side-row { width: 100%; min-width: 0; display: grid; grid-template-columns: 1fr; align-items: baseline; justify-items: end; font-size: 1em; white-space: nowrap; }
  .capacity-side-row small { color: var(--text-secondary); font-size: .62em; font-weight: 600; letter-spacing: 0; }
  .capacity-side-row strong { min-width: 0; color: var(--text-primary); font-size: 1em; font-weight: 720; font-variant-numeric: tabular-nums; }
  .capacity-side-row.percentage strong { color: var(--sensor-color); font-weight: 780; }
  .value.capacity-value:not(.capacity-percent) .capacity-side { align-self: center; }
  .average-meta { display: flex; flex-shrink: 0; justify-content: space-between; gap: 5px; margin: 0; color: var(--text-primary); font-size: clamp(14px, min(var(--meta-cqw), var(--meta-cqh)), 34px); font-weight: 550; line-height: 1.04; }
  .average-meta span, .minmax span { min-width: 0; white-space: nowrap; }
  .meter { flex-shrink: 0; height: clamp(6px, 1.2vh, 11px); margin-top: clamp(1px, .25cqh, 2px); border-radius: 6px; background: var(--ring-track); overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: inherit; background: var(--sensor-color); transition: width .4s ease; }
  .stats-block { gap: clamp(3px, .7cqh, 7px); }
  .minmax { display: flex; flex-shrink: 0; justify-content: space-between; gap: clamp(4px, 1vw, 12px); margin: 0; padding: 0; color: var(--text-secondary); font-size: clamp(14px, min(var(--minmax-cqw), var(--minmax-cqh)), 34px); font-weight: 500; line-height: 1.04; }
  .minmax b { color: var(--text-primary); font-weight: 500; font-variant-numeric: tabular-nums; }
  .state { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 9px; color: var(--text-secondary); text-align: center; }
  .state strong { color: var(--text-primary); font-size: clamp(15px, 2.4vw, 22px); }.state span { color: var(--danger); }.state small { max-width: 520px; }
  .stale-warning { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); max-width: 90%; padding: 4px 10px; border-radius: 12px; color: var(--warning); background: color-mix(in srgb, var(--bg) 90%, transparent); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .system-page.compact { padding: 0; gap: 0; background: transparent; }
  .compact .sensor-grid { gap: 8px; }
  .compact .sensor-card { border-radius: var(--radius-card); padding: 12px 14px; }
  .compact .name { margin-top: 4px; }
  .compact .minmax { font-size: clamp(10px, min(var(--minmax-cqw), var(--minmax-cqh)), 24px); gap: 5px; }
  .compact .value, .compact .card-top, .compact .capacity-side { letter-spacing: 0; }
  .compact .state { font-size: 11px; overflow: hidden; }
  .compact .state strong { font-size: 13px; }
</style>
