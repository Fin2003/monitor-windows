const { fanDisplayModeFor, findCounterpart, isFanSensor } = require('./fan-display');

class AverageTracker {
  #entries = new Map();

  reset() {
    this.#entries.clear();
  }

  apply(sensors, config, shouldTrack) {
    const selectedIds = new Set(config.selectedSensors || []);
    const selectedHardware = new Set(config.selectedHardwareIds || []);
    const inHardwareScope = sensor => config.hardwareFilterEnabled !== true || !selectedHardware.size
      || [sensor.hardwareRootId, sensor.hardwareId, sensor.hardware, sensor.id].filter(Boolean).some(key => selectedHardware.has(key));
    const selected = new Set(sensors.filter(sensor => selectedIds.has(sensor.id) && inHardwareScope(sensor)).map(sensor => sensor.id));
    const tracked = new Set(selected);
    const enabled = config.averageEnabled === true;
    const now = Date.now();

    if (enabled && shouldTrack) {
      for (const sensor of sensors) {
        if (!selected.has(sensor.id) || !isFanSensor(sensor)) continue;
        const counterpart = findCounterpart(sensor, sensors);
        const mode = fanDisplayModeFor(sensor, config);
        if (counterpart && ((mode === 'percent' && counterpart.type === 'Control') || (mode !== 'percent' && counterpart.type === 'Fan'))) {
          tracked.add(counterpart.id);
        }
      }
      for (const sensor of sensors) {
        if (!tracked.has(sensor.id) || !Number.isFinite(sensor.rawValue)) continue;
        const entry = this.#entries.get(sensor.id);
        if (!entry) {
          this.#entries.set(sensor.id, { mean: sensor.rawValue, count: 1, lastSeen: now });
          continue;
        }
        entry.count += 1;
        entry.mean += (sensor.rawValue - entry.mean) / entry.count;
        entry.lastSeen = now;
      }
    }

    this.#prune(tracked);
    return sensors.map(sensor => {
      const entry = this.#entries.get(sensor.id);
      if (!entry) return sensor;
      return {
        ...sensor,
        averageRaw: entry.mean,
        averageCount: entry.count,
        averageValue: this.#formatAverage(sensor.value, entry.mean),
      };
    });
  }

  #formatAverage(formattedValue, average) {
    const source = String(formattedValue || '');
    const match = source.match(/^\s*[-+]?\d+(?:\.(\d+))?\s*(.*)$/);
    const decimals = match?.[1]?.length ?? 1;
    const unit = match?.[2] || '';
    return `${average.toFixed(Math.min(3, decimals))}${unit ? ` ${unit}` : ''}`;
  }

  #prune(selected) {
    if (this.#entries.size <= 2048) return;
    const removable = [...this.#entries.entries()]
      .filter(([sensorId]) => !selected.has(sensorId))
      .sort((left, right) => left[1].lastSeen - right[1].lastSeen);
    while (this.#entries.size > 2048 && removable.length) {
      this.#entries.delete(removable.shift()[0]);
    }
  }
}

module.exports = AverageTracker;
