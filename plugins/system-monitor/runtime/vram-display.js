const VRAM_MODES = ['percent', 'used', 'used-percent'];
const VRAM_UNITS = ['GB', 'MB'];
const UNIT_FACTORS = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

function isGpuHardware(sensor) {
  if (!sensor) return false;
  const text = [sensor.id, sensor.hardware, sensor.hardwareRoot, sensor.zhHardware, sensor.zhHardwareRoot]
    .filter(Boolean)
    .join(' ');
  return /^\/gpu(?:-|\/)/i.test(sensor.id || '')
    || /gpu|graphics|geforce|radeon|显卡/i.test(text);
}

function sameGpu(sensor, candidate) {
  if (!sensor || !candidate || !isGpuHardware(candidate)) return false;
  const sensorHardwareId = sensor.hardwareId || '';
  const candidateHardwareId = candidate.hardwareId || '';
  if (sensorHardwareId && candidateHardwareId) return sensorHardwareId === candidateHardwareId;
  const sensorRootId = sensor.hardwareRootId || '';
  const candidateRootId = candidate.hardwareRootId || '';
  if (sensorRootId && candidateRootId) return sensorRootId === candidateRootId;
  return sensor.hardware === candidate.hardware || sensor.hardwareRoot === candidate.hardwareRoot;
}

function isVramUsedSensor(sensor) {
  if (!isGpuHardware(sensor)) return false;
  const text = `${sensor.name || ''} ${sensor.zhName || ''}`;
  return /gpu\s*memory\s*used/i.test(text)
    || /gpu\s*显存\s*已用/i.test(text)
    || (/\/smalldata\/1(?:$|\/)/i.test(sensor.id || '') && /memory|显存/i.test(text));
}

function displayVramSensorName(sensor, language = 'zh') {
  const value = language === 'en' ? sensor?.name : sensor?.zhName;
  const name = String(value || '');
  if (!isVramUsedSensor(sensor)) return name;
  return language === 'en'
    ? name.replace(/\s+Used$/i, '').trim()
    : name.replace(/\s*已用$/u, '').trim();
}

function findVramSensor(sensors, source, namePattern, idPattern) {
  return sensors.find(candidate => sameGpu(source, candidate) && idPattern.test(candidate.id || ''))
    || sensors.find(candidate => sameGpu(source, candidate) && namePattern.test(`${candidate.name || ''} ${candidate.zhName || ''}`));
}

function isVramTotalSensor(sensor, source) {
  if (!sameGpu(source, sensor)) return false;
  return /gpu\s*memory\s*total|显存.*总计/i.test(`${sensor.name || ''} ${sensor.zhName || ''}`)
    || /\/smalldata\/2(?:$|\/)/i.test(sensor.id || '');
}

function sourceUnit(value, fallback = 'MB') {
  const match = String(value || '').match(/([KMGT]?B)\s*$/i);
  return match ? match[1].toUpperCase() : fallback;
}

function toBytes(value, unit) {
  if (!Number.isFinite(value)) return null;
  return value * (UNIT_FACTORS[unit] || UNIT_FACTORS.MB);
}

function formatVramAmount(value, sourceValue, displayUnit = 'GB') {
  if (!Number.isFinite(value)) return '--';
  const unit = VRAM_UNITS.includes(displayUnit) ? displayUnit : 'GB';
  const bytes = toBytes(value, sourceUnit(sourceValue));
  if (!Number.isFinite(bytes)) return '--';
  return `${(bytes / UNIT_FACTORS[unit]).toFixed(1)} ${unit}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '--';
}

function decorateVramSensor(sensor, sensors, mode = 'percent', displayUnit = 'GB') {
  if (!isVramUsedSensor(sensor)) return sensor;
  const normalizedMode = VRAM_MODES.includes(mode) ? mode : 'percent';
  const normalizedUnit = VRAM_UNITS.includes(displayUnit) ? displayUnit : 'GB';
  const total = sensors.find(candidate => isVramTotalSensor(candidate, sensor));
  const free = findVramSensor(sensors, sensor, /gpu\s*memory\s*free|显存.*free|显存.*可用/i, /\/smalldata\/0(?:$|\/)/i);
  const load = findVramSensor(sensors, sensor, /^gpu\s*memory$|^gpu\s*显存$/i, /\/load\/4(?:$|\/)/i);
  const totalRaw = Number.isFinite(total?.rawValue)
    ? total.rawValue
    : Number.isFinite(sensor.rawValue) && Number.isFinite(free?.rawValue)
      ? sensor.rawValue + free.rawValue
      : null;
  const usedRaw = sensor.rawValue;
  const currentPercent = Number.isFinite(load?.rawValue)
    ? load.rawValue
    : Number.isFinite(usedRaw) && Number.isFinite(totalRaw) && totalRaw > 0
      ? (usedRaw / totalRaw) * 100
      : null;
  const percentMin = Number.isFinite(load?.rawMin)
    ? load.rawMin
    : Number.isFinite(sensor.rawMin) && Number.isFinite(totalRaw) && totalRaw > 0
      ? (sensor.rawMin / totalRaw) * 100
      : null;
  const percentMax = Number.isFinite(load?.rawMax)
    ? load.rawMax
    : Number.isFinite(sensor.rawMax) && Number.isFinite(totalRaw) && totalRaw > 0
      ? (sensor.rawMax / totalRaw) * 100
      : null;
  const averageUsed = Number.isFinite(sensor.averageRaw) ? sensor.averageRaw : null;
  const averageLoad = Number.isFinite(load?.averageRaw)
    ? load.averageRaw
    : Number.isFinite(averageUsed) && Number.isFinite(totalRaw) && totalRaw > 0
      ? (averageUsed / totalRaw) * 100
      : null;
  const usedText = formatVramAmount(usedRaw, sensor.value, normalizedUnit);
  const totalText = formatVramAmount(totalRaw, total?.value || sensor.value, normalizedUnit);
  const capacityText = `${usedText} / ${totalText}`;
  const displayValueLines = normalizedMode === 'used-percent'
    ? [capacityText, formatPercent(currentPercent)]
    : normalizedMode === 'used'
      ? [capacityText]
      : [];
  const averageCapacityText = formatVramAmount(averageUsed, sensor.value, normalizedUnit);
  const displayAverageValueLines = normalizedMode === 'used-percent'
    ? averageCapacityText === '--' ? [] : [averageCapacityText, formatPercent(averageLoad)]
    : normalizedMode === 'used'
      ? averageCapacityText === '--' ? [] : [averageCapacityText]
      : [];
  const percentValue = formatPercent(currentPercent);
  return {
    ...sensor,
    displayValue: normalizedMode === 'percent'
      ? percentValue
      : normalizedMode === 'used-percent'
        ? `${capacityText} (${percentValue})`
        : capacityText,
    displayValueLines,
    displayMin: normalizedMode === 'percent' ? formatPercent(percentMin) : formatVramAmount(sensor.rawMin, sensor.value, normalizedUnit),
    displayMax: normalizedMode === 'percent' ? formatPercent(percentMax) : formatVramAmount(sensor.rawMax, sensor.value, normalizedUnit),
    displayAverageValue: normalizedMode === 'percent'
      ? formatPercent(averageLoad)
      : normalizedMode === 'used-percent' && averageCapacityText !== '--'
        ? `${averageCapacityText} (${formatPercent(averageLoad)})`
        : averageCapacityText,
    displayAverageValueLines,
    displayCapacityLayout: normalizedMode === 'percent' ? null : {
      mode: normalizedMode,
      primary: usedText,
      secondary: normalizedMode === 'used-percent'
        ? [{ kind: 'percent', value: percentValue }, { kind: 'total', value: totalText }]
        : [{ kind: 'total', value: totalText }],
    },
    displayAverageCapacityLayout: normalizedMode === 'percent' || averageCapacityText === '--' ? null : {
      mode: normalizedMode,
      primary: averageCapacityText,
      secondary: normalizedMode === 'used-percent'
        ? [{ kind: 'percent', value: formatPercent(averageLoad) }, { kind: 'total', value: totalText }]
        : [{ kind: 'total', value: totalText }],
    },
    displayRawValue: currentPercent,
    displayAverageRaw: averageLoad,
    displaySourceType: 'Load',
    vramDisplayMode: normalizedMode,
    vramDisplayUnit: normalizedUnit,
  };
}

module.exports = { decorateVramSensor, displayVramSensorName, isVramUsedSensor, isGpuHardware, formatVramAmount };
