// Manually marked Tibo resets (for when no "reset finished" post appears).
// Shared by the desktop radar runtime and the ESP32 bridge; both use the same file,
// tibo-radar-manual-resets.json next to tibo-radar-state.json, so marks show everywhere.
// Each mark becomes a synthetic completion post that quotes the pending forecast, so the
// normal radar state machine closes that reset as Hard or Banked.
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'tibo-radar-manual-resets.json';
const DAY = 86400000, MAX_AGE_DAYS = 7, MAX_RECORDS = 50;

function load(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter(r => r && typeof r.id === 'string' && Number.isFinite(r.at) && ['hard', 'banked'].includes(r.kind)) : [];
  } catch (_) { return []; }
}
function save(list, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(list.slice(-MAX_RECORDS), null, 2));
  fs.renameSync(file + '.tmp', file);
}

function zoneParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
// Wall-clock time in a zone -> epoch ms (two passes settle DST offsets).
function zonedEpoch(date, hour, minute, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], hour, minute);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(guess, timeZone), [y, m, d] = p.date.split('-').map(Number);
    guess += wall - Date.UTC(y, m - 1, d, p.hour, p.minute);
  }
  return guess;
}

function syntheticPosts(list) {
  return list.map(record => {
    const label = record.kind === 'banked' ? 'Banked' : 'Hard';
    return {
      id: 'manual-' + record.id, author: 'thsottiaux', publishedAt: record.at, manual: true,
      text: `手动标记：${label} 重置已完成`, quoteId: record.forecastId || undefined,
      analysis: { kind: 'completion', banked: record.kind === 'banked', eta: null, keyText: `手动标记 ${label} 重置`, source: 'manual' },
    };
  });
}

// Compact picker data for the device: recent days, current time, and the undoable last mark.
function pickerInfo({ radar, now = Date.now(), timeZone = 'Asia/Shanghai', list = [] } = {}) {
  const today = zoneParts(now, timeZone), days = [];
  for (let i = 0; i < MAX_AGE_DAYS; i++) {
    const date = zoneParts(now - i * DAY, timeZone).date;
    days.push({ value: date, label: date.slice(5).replace('-', '/') + (i === 0 ? ' 今天' : i === 1 ? ' 昨天' : '') });
  }
  const recentAt = radar?.recentReset?.publishedAt;
  const last = [...list].sort((a, b) => b.at - a.at).find(r => r.at === recentAt);
  return {
    canMark: (radar?.pending || []).some(event => !event.banked),
    days, hour: today.hour, minute: today.minute,
    last: last ? { id: last.id, label: `${last.kind === 'banked' ? 'Banked' : 'Hard'} · ${zoneParts(last.at, timeZone).date.slice(5).replace('-', '/')} ${String(zoneParts(last.at, timeZone).hour).padStart(2, '0')}:${String(zoneParts(last.at, timeZone).minute).padStart(2, '0')}` } : null,
  };
}

function mark({ date, hour, minute, kind }, { radar, now = Date.now(), timeZone = 'Asia/Shanghai', file } = {}) {
  if (!['hard', 'banked'].includes(kind)) throw new Error('重置类型无效');
  const at = zonedEpoch(date, hour, minute, timeZone);
  if (at === null) throw new Error('时间无效');
  if (at > now + 5 * 60000) throw new Error('不能标记未来时间');
  if (at < now - MAX_AGE_DAYS * DAY) throw new Error('只能标记最近 7 天');
  const pending = (radar?.pending || []).find(event => !event.banked);
  if (pending?.forecast?.publishedAt > at) throw new Error('时间早于重置预告');
  const list = load(file);
  const record = { id: String(now), at, kind, forecastId: pending?.forecast?.id || null, createdAt: now };
  list.push(record); save(list, file);
  return record;
}
function undo(id, { file } = {}) {
  const list = load(file), next = list.filter(r => r.id !== String(id));
  if (next.length === list.length) throw new Error('找不到该标记');
  save(next, file);
}

module.exports = { FILE_NAME, load, save, zonedEpoch, syntheticPosts, pickerInfo, mark, undo };
