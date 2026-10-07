function isFanSensor(sensor) {
  if (!sensor) return false;
  if (sensor.type === 'Fan') return true;
  return sensor.type === 'Control' && /fan|风扇|pump|水泵/i.test(`${sensor.name || ''} ${sensor.zhName || ''}`);
}

function counterpartId(sensor) {
  if (!sensor?.id) return '';
  if (sensor.type === 'Fan') return sensor.id.replace('/fan/', '/control/');
  if (sensor.type === 'Control') return sensor.id.replace('/control/', '/fan/');
  return '';
}

function findCounterpart(sensor, sensors) {
  if (!isFanSensor(sensor)) return null;
  const targetType = sensor.type === 'Fan' ? 'Control' : 'Fan';
  const expectedId = counterpartId(sensor);
  return sensors.find(candidate => candidate.id === expectedId)
    || sensors.find(candidate => candidate.type === targetType
      && candidate.hardwareId === sensor.hardwareId
      && candidate.name === sensor.name)
    || null;
}

function fanDisplayModeFor(sensor, config = {}) {
  const configured = config?.fanDisplayModes?.[sensor?.id];
  if (configured === 'percent' || configured === 'rpm') return configured;
  return config?.fanDisplayMode === 'percent' ? 'percent' : 'rpm';
}

function decorateFanSensor(sensor, sensors, mode = 'rpm') {
  const normalizedMode = mode === 'percent' ? 'percent' : 'rpm';
  const desiredType = normalizedMode === 'percent' ? 'Control' : 'Fan';
  const source = isFanSensor(sensor)
    ? sensor.type === desiredType ? sensor : findCounterpart(sensor, sensors)
    : sensor;
  const fallback = !source || source.type !== desiredType;
  const valueSource = source || sensor;
  return {
    ...sensor,
    displayValue: valueSource.value || '--',
    displayMin: valueSource.min || '--',
    displayMax: valueSource.max || '--',
    displayRawValue: valueSource.rawValue,
    displayAverageRaw: valueSource.averageRaw,
    displayAverageValue: valueSource.averageValue,
    displaySourceType: valueSource.type || sensor.type,
    fanDisplayFallback: isFanSensor(sensor) && fallback,
  };
}

module.exports = { decorateFanSensor, fanDisplayModeFor, findCounterpart, isFanSensor };
