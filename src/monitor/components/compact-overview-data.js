const { normalizeOverview } = require('../../shared/compact-overview-config.cjs');

const SENSOR_COLORS = Object.freeze({
  Temperature: '#FFB23F',
  Load: '#9D8CFF',
  Clock: '#3CC8DC',
  Frequency: '#3CC8DC',
  Fan: '#3ECF8E',
  Control: '#3ECF8E',
  Power: '#FF8A4C',
  Voltage: '#FFB23F',
  Current: '#FFB23F',
  Data: '#4C9AFF',
  SmallData: '#4C9AFF',
  Throughput: '#4C9AFF',
  Level: '#9D8CFF',
  Energy: '#FF8A4C',
  Humidity: '#3ECF8E',
  Flow: '#3ECF8E',
  Noise: '#FF6B66',
});

const DEVICE_COLORS = Object.freeze([
  '#4C9AFF', '#FFB23F', '#3ECF8E', '#9D8CFF', '#FF8A4C', '#3CC8DC',
  '#FF6B66', '#7F8CFF', '#E0C050', '#2FB8A8', '#B89878', '#5AB8F0',
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function normalizeSlots(slots) {
  return normalizeOverview({ slots }).slots.filter(Boolean);
}

function slotKey(slot, index = 0) {
  if (!slot) return `slot:${index}`;
  if (slot.id) return slot.id;
  const identity = slot.kind === 'coding'
    ? slot.channelKey
    : slot.kind === 'sensor'
      ? slot.sensorId
      : 'radar';
  return `${slot.kind}:${identity || index}:${index}`;
}

function compactRingLabel(ring = {}) {
  const key = shortText(ring.key).toLowerCase();
  const label = shortText(ring.label);
  if (key === 'session' || key.includes('5h') || key.includes('session')) return '5H';
  if (key === 'week' || key.includes('week')) return '周';
  if (key === 'month' || key.includes('month')) return '月';
  if (/账号|account|总用量/i.test(label)) return '账号';
  if (/您的|我的|user|your/i.test(`${label} ${key}`)) return '我的';
  return label || shortText(ring.key, '额度');
}

function ringDisplayValue(ring = {}) {
  if (ring.infinite) return '∞';
  if (typeof ring.used === 'string' && ring.used.startsWith('余 ')) return ring.used;
  if (ring.used === '待统计' || ring.used === '—') return ring.used;
  const pct = finiteNumber(ring.pct);
  if (pct !== null) return `${Math.round(pct)}%`;
  const used = shortText(ring.used);
  if (used) {
    const percent = used.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (percent) return `${Math.round(Number(percent[1]))}%`;
    return used;
  }
  return '--';
}

function normalizeCodingRings(rings) {
  if (!Array.isArray(rings)) return [];
  return rings.map((ring, index) => {
    const pct = ring?.used === '待统计' || ring?.used === '—' ? null : finiteNumber(ring?.pct);
    const maxPct = finiteNumber(ring?.maxPct);
    const strokeWidth = finiteNumber(ring?.strokeWidth);
    return {
      ...(ring || {}),
      key: shortText(ring?.key, `ring-${index}`),
      pct,
      maxPct: maxPct !== null && maxPct > 0 ? maxPct : 100,
      strokeWidth: strokeWidth !== null && strokeWidth > 0 ? strokeWidth : 24,
      compactLabel: compactRingLabel(ring),
      displayValue: ringDisplayValue(ring),
    };
  });
}

function ringFraction(ring = {}) {
  const pct = finiteNumber(ring.pct);
  const maxPct = finiteNumber(ring.maxPct) || 100;
  return pct === null ? 0 : clamp(pct / maxPct, 0, 1);
}

function ringStatus(entry, rings = normalizeCodingRings(entry?.rings)) {
  const rawStatus = shortText(typeof entry?.status === 'object' ? entry.status?.state : entry?.status).toLowerCase();
  const error = entry?.error === true ? '获取失败' : entry?.error ? shortText(entry.error) : '';
  const detail = error || shortText(typeof entry?.status === 'object' ? entry.status?.message : '');
  if (error || ['error', 'failed', 'failure', 'offline', 'unauthorized'].includes(rawStatus)) {
    return {
      kind: rawStatus === 'unauthorized' ? 'auth' : 'error',
      label: rawStatus === 'unauthorized' ? '需要登录' : '获取失败',
      detail,
    };
  }
  
  if (['loading', 'fetching', 'pending', 'checking'].includes(rawStatus)) {
    return { kind: 'loading', label: '检查中', detail };
  }
  if (!rings.length) return { kind: 'missing', label: '暂无额度', detail };
  if (['connected', 'ok', 'ready', 'success'].includes(rawStatus)) {
    return { kind: 'ok', label: '已连接', detail };
  }
  return { kind: 'ok', label: '已连接', detail };
}

function getCodingEntry(coding, channelKey) {
  const entry = coding && typeof coding === 'object' ? coding[channelKey] : null;
  const rings = normalizeCodingRings(entry?.rings);
  return {
    ...(entry || {}),
    label: shortText(entry?.label, channelKey || 'Coding'),
    rings,
    statusInfo: ringStatus(entry, rings),
  };
}

function formatCountdown(ms) {
  const value = finiteNumber(ms);
  if (value === null || value <= 0) return '—';
  const seconds = Math.floor(value / 1000);
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}天`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}时`;
  return `${Math.max(1, Math.ceil(seconds / 60))}分`;
}

function sensorColor(sensor, config = {}) {
  if (config.colorMode !== 'device') return SENSOR_COLORS[sensor?.type] || '#98A0A8';
  let hash = 0;
  for (const character of String(sensor?.hardwareId || sensor?.hardware || sensor?.id || '')) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return DEVICE_COLORS[Math.abs(hash) % DEVICE_COLORS.length];
}

function splitReading(value) {
  const text = shortText(value, '--');
  if (!text || text === '--') return { value: '--', unit: '' };
  const match = text.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(.*)$/);
  if (!match || !match[2] || /[/()]/.test(match[2]) || match[2].length > 14) {
    return { value: text, unit: '' };
  }
  return { value: match[1], unit: match[2].trim() };
}

function sensorRange(sensor) {
  const current = finiteNumber(sensor?.displayRawValue ?? sensor?.rawValue);
  const min = finiteNumber(sensor?.rawMin);
  const max = finiteNumber(sensor?.rawMax);
  if (current === null || min === null || max === null || max <= min) return null;
  return {
    percent: clamp(((current - min) / (max - min)) * 100, 0, 100),
    min,
    max,
  };
}

function sensorHasValue(sensor, reading) {
  if (sensor?.available === false) return false;
  if (finiteNumber(sensor?.displayRawValue ?? sensor?.rawValue) !== null) return true;
  return Boolean(reading?.value && reading.value !== '--');
}

function sensorExpiryMs(config = {}) {
  const source = config || {};
  const interval = Math.max(1, finiteNumber(source.refreshInterval) || 2);
  return Math.max(15000, interval * 3000);
}

function sensorStatus({ sensor, reading, state, now }) {
  const hasValue = sensorHasValue(sensor, reading);
  if (!sensor) return { kind: 'missing', label: '未找到' };
  if (!hasValue) return { kind: 'missing', label: '暂无数据' };
  const age = finiteNumber(state?.fetchedAt) ? Math.max(0, now - state.fetchedAt) : Infinity;
  if (age > sensorExpiryMs(state?.config)) return { kind: 'expired', label: '已过期' };
  if (state?.error) return { kind: 'error', label: '读取失败' };
  if (state?.cached) return { kind: 'cached', label: '缓存' };
  return { kind: 'ok', label: '在线' };
}

// Compatibility exports; all radar presentation rules belong to the plugin.
const { radarState, radarOutlook, radarPostExcerpt, latestRadarPosts, formatRadarAge, formatRadarDate } = require('../../../plugins/tibo-radar/presentation.cjs');

module.exports = {
  compactRingLabel,
  formatCountdown,
  formatRadarAge,
  formatRadarDate,
  getCodingEntry,
  normalizeCodingRings,
  normalizeSlots,
  ringFraction,
  sensorColor,
  sensorExpiryMs,
  sensorHasValue,
  sensorRange,
  sensorStatus,
  slotKey,
  splitReading,
  radarState,
  radarOutlook,
  latestRadarPosts,
  radarPostExcerpt,
};
