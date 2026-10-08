const { codingCards } = require('./coding-data.cjs');
const { decorateFanSensor, fanDisplayModeFor } = require('../../plugins/system-monitor/runtime/fan-display.js');
const { decorateMemorySensor } = require('../../plugins/system-monitor/runtime/memory-display.js');
const { decorateVramSensor, displayVramSensorName } = require('../../plugins/system-monitor/runtime/vram-display.js');
const { stripHardwareBrand } = require('../../plugins/system-monitor/runtime/hardware-display.js');
const {
  radarState, radarOutlook, eventPresentation, formatRadarDate,
  displayTimeZoneLabel,
} = require('../../plugins/tibo-radar/presentation.cjs');
const { radarPosts } = require('./radar-detail.cjs');

const text = (value, max = 96) => [...String(value ?? '')].slice(0, max).join('');
const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const percent = value => {
  const n = finite(value);
  return n === null ? null : Math.max(0, Math.min(100, n));
};
const day = (at, zone) => formatRadarDate(at, zone).slice(0, 5);
const clock = (at, zone) => formatRadarDate(at, zone).slice(-5);

function countdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.floor(ms / 1000), days = Math.floor(seconds / 86400);
  if (days >= 1) return days + '天';
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return hours + '时';
  return Math.max(1, Math.ceil(seconds / 60)) + '分';
}

function centerCountdown(values) {
  const valid = values.filter(value => Number.isFinite(value) && value > 0);
  if (!valid.length) return { value: '—', unit: '' };
  const seconds = Math.floor(Math.min(...valid) / 1000), hours = Math.floor(seconds / 3600);
  if (hours >= 1) return { value: String(hours), unit: '时' };
  const minutes = Math.ceil(seconds / 60);
  return { value: String(Math.max(1, minutes)), unit: '分' };
}

function selectedChannels(config) {
  return [...new Set([
    ...(config.selectedProviders || []),
    ...(config.compactOverview?.slots || []).filter(slot => slot?.kind === 'coding')
      .flatMap(slot => [slot.channelKey, ...(slot.channelKeys || [])]),
  ].filter(Boolean))];
}

function codingPage(input = {}) {
  return { type: 'coding', cards: codingCards(input) };
}

function systemPage({ config = {}, system = null } = {}) {
  const settings = config.systemMonitor || {}, all = system?.sensors || [];
  const selected = new Set(settings.selectedSensors || []);
  const order = [...(settings.layoutOrder || []), ...(settings.selectedSensors || [])];
  const ids = [...new Set(order)].filter(id => selected.has(id)).slice(0, 6);
  const sensors = ids.map(id => {
    const raw = all.find(sensor => sensor.id === id);
    if (!raw) return { type: '指标', hardware: '等待 Windows 数据', name: '暂无数据', value: '--', min: '--', max: '--', pct: null };
    const decorated = decorateVramSensor(
      decorateMemorySensor(
        decorateFanSensor(raw, all, fanDisplayModeFor(raw, settings)),
        all,
        settings.memoryDisplayMode,
      ),
      all,
      settings.vramDisplayMode,
      settings.vramDisplayUnit,
    );
    const capacity = decorated.displayCapacityLayout, side = capacity?.secondary || [];
    const displayPercent = side.find(item => item.kind === 'percent')?.value || '';
    const rawPercent = finite(displayPercent.replace?.('%', '')) ?? finite(decorated.displayRawValue) ?? (raw.type === 'Load' ? finite(raw.rawValue) : null);
    return {
      type: text(settings.sensorLanguage === 'en' ? raw.type : raw.zhType || raw.type, 18),
      hardware: text(stripHardwareBrand(settings.sensorLanguage === 'en' ? raw.hardware : raw.zhHardware || raw.hardware), 42),
      name: text(settings.sensorAliases?.[id] || displayVramSensorName(decorated, settings.sensorLanguage), 34),
      value: raw.available === false ? '--' : text(capacity?.primary || decorated.displayValue || raw.value, 22),
      percent: text(displayPercent, 12), total: text(side.find(item => item.kind === 'total')?.value, 18),
      min: text(decorated.displayMin || raw.min || '--', 18), max: text(decorated.displayMax || raw.max || '--', 18),
      pct: raw.available === false ? null : percent(rawPercent),
    };
  });
  while (sensors.length < 6) sensors.push({ type: '指标', hardware: '等待 Windows 数据', name: '暂无数据', value: '--', min: '--', max: '--', pct: null });
  const updated = finite(system?.fetchedAt);
  return {
    type: 'system', backend: text(system?.backend || 'LibreHardwareMonitor · Windows v0.9.7', 52),
    updated: updated === null ? '--:--:--' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(updated),
    cached: !!system?.cached, sensors,
  };
}

function elapsed(at, now) {
  const value = finite(at);
  if (value === null) return { number: '无记录', unit: '' };
  const minutes = Math.max(0, Math.floor((now - value) / 60000));
  if (minutes < 1) return { number: '刚刚', unit: '' };
  if (minutes < 60) return { number: String(minutes), unit: '分钟前' };
  if (minutes < 1440) return { number: String(Math.floor(minutes / 60)), unit: '小时前' };
  return { number: String(Math.floor(minutes / 1440)), unit: '天前' };
}

function eventCard(event, now, zone) {
  const presentation = eventPresentation(event, now);
  const forecast = event.forecast, completion = event.completion;
  const quote = (completion || forecast)?.keyText || (completion || forecast)?.text || '';
  return {
    postId: text((completion || forecast)?.id || '', 32),
    date: day(event.sortAt, zone), status: text(presentation.label, 18), tone: presentation.tone,
    forecastLabel: event.eta?.timeClass === 'prediction' ? '预测' : forecast ? '预计' : '预告',
    forecastValue: event.eta ? clock(event.eta.at, zone) : forecast ? text(event.timeWindow?.label || '待定', 12) : '—',
    completionLabel: '完成',
    completionValue: completion ? clock(completion.publishedAt, zone) : '--:--',
    quote: text(String(quote).replace(/\s+/g, ' ').trim(), 86), done: !!completion,
  };
}

function radarPage({ radar = null, now = Date.now() } = {}) {
  const data = radar || {}, zone = data.config?.displayTimeZone || 'Asia/Shanghai';
  const state = radarState(data, now), outlook = radarOutlook(data, now);
  const recent = data.recentReset || (data.latest ? { publishedAt: data.latest.publishedAt, type: 'Hard' } : null);
  const events = (data.events || []).filter(event => (!event.banked || event.pairedBanked) && !event.post && (event.forecast || event.completion)).slice(0, 2).map(event => eventCard(event, now, zone));
  while (events.length < 2) events.push({ date: '--/--', status: '暂无 Reset', tone: 'muted', forecastLabel: '预计', forecastValue: '—', completionLabel: '完成', completionValue: '--:--', quote: '暂无 Reset 事件', done: false });
  const cutoff = now - 30 * 86400000;
  const banks = (data.banked || []).filter(event => !event.post && !event.pairedBanked && event.sortAt >= cutoff && event.sortAt <= now).slice(0, 2).map(event => day(event.sortAt, zone));
  const last = finite(data.meta?.lastSuccess);
  return {
    type: 'radar', health: text(state.overviewLabel, 16), recentType: text(recent?.type || '--', 12),
    age: elapsed(recent?.publishedAt, now), recentAt: recent ? formatRadarDate(recent.publishedAt, zone) : '无记录',
    outlook: text(outlook.label, 28), badge: text(outlook.badge, 20), tone: outlook.tone,
    banks, events, posts: radarPosts(data, 3),
    updated: last === null ? '等待更新' : clock(last, zone) + ' 更新',
    timezone: displayTimeZoneLabel(zone),
  };
}

function nativePage(group, input) {
  if (group === 'coding') return codingPage(input);
  if (group === 'system') return systemPage(input);
  if (group === 'radar') return radarPage(input);
  return null;
}

module.exports = { nativePage, codingPage, systemPage, radarPage };
