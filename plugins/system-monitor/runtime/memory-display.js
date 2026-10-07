function isMemoryLoadSensor(sensor) {
  if (!sensor || sensor.type !== 'Load') return false;
  return /(?:^|\/)(?:ram|memory)\/load/i.test(sensor.id || '')
    || (/memory/i.test(sensor.name || '') && /total memory|内存/i.test(`${sensor.hardware || ''} ${sensor.zhHardware || ''}`));
}

function findMemorySensor(sensors, namePattern, idPattern) {
  return sensors.find(sensor => idPattern.test(sensor.id || ''))
    || sensors.find(sensor => namePattern.test(`${sensor.name || ''} ${sensor.zhName || ''}`));
}

function formatMemoryAmount(value, sourceValue = '') {
  if (!Number.isFinite(value)) return '--';
  const unit = String(sourceValue).match(/([A-Za-z]+)\s*$/)?.[1] || 'GB';
  return `${value.toFixed(1)} ${unit}`;
}

function decorateMemorySensor(sensor, sensors, mode = 'percent') {
  if (!['used', 'used-percent'].includes(mode) || !isMemoryLoadSensor(sensor)) return sensor;
  const used = findMemorySensor(sensors, /memory\s*used|已用内存/i, /\/ram\/data\/0/i);
  const available = findMemorySensor(sensors, /memory\s*available|可用内存/i, /\/ram\/data\/1/i);
  if (!Number.isFinite(used?.rawValue) || !Number.isFinite(available?.rawValue)) return sensor;
  const total = used.rawValue + available.rawValue;
  const currentPercent = Number.isFinite(sensor.rawValue) ? sensor.rawValue : (used.rawValue / total) * 100;
  const currentUsed = total * currentPercent / 100;
  const percentToUsed = value => Number.isFinite(value) ? total * value / 100 : null;
  const currentUsedText = formatMemoryAmount(currentUsed, used.value);
  const totalText = formatMemoryAmount(total, used.value);
  const usedText = `${currentUsedText} / ${totalText}`;
  const percentText = `${currentPercent.toFixed(1)}%`;
  const displayValueLines = mode === 'used-percent' ? [usedText, percentText] : [usedText];
  const averagePercent = Number.isFinite(sensor.averageRaw) ? sensor.averageRaw : null;
  const averageText = formatMemoryAmount(percentToUsed(averagePercent), used.value);
  const displayAverageValueLines = averageText === '--'
    ? []
    : mode === 'used-percent' ? [averageText, `${averagePercent.toFixed(1)}%`] : [averageText];
  return {
    ...sensor,
    displayValue: mode === 'used-percent' ? `${usedText} (${percentText})` : usedText,
    displayValueLines,
    displayMin: formatMemoryAmount(percentToUsed(sensor.rawMin), used.value),
    displayMax: formatMemoryAmount(percentToUsed(sensor.rawMax), used.value),
    displayAverageValue: mode === 'used-percent' && averageText !== '--'
      ? `${averageText} (${averagePercent.toFixed(1)}%)`
      : averageText,
    displayAverageValueLines,
    displayCapacityLayout: {
      mode,
      primary: currentUsedText,
      secondary: mode === 'used-percent'
        ? [{ kind: 'percent', value: percentText }, { kind: 'total', value: totalText }]
        : [{ kind: 'total', value: totalText }],
    },
    displayAverageCapacityLayout: averageText === '--' ? null : {
      mode,
      primary: averageText,
      secondary: mode === 'used-percent'
        ? [{ kind: 'percent', value: `${averagePercent.toFixed(1)}%` }, { kind: 'total', value: totalText }]
        : [{ kind: 'total', value: totalText }],
    },
  };
}

module.exports = { isMemoryLoadSensor, decorateMemorySensor };
