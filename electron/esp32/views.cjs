const LIMIT = 6;
const text = (value, max = 150) => [...String(value ?? '')].slice(0, max).join('');
const row = (label, value, detail = '', pct = null) => ({ label: text(label, 70), value: text(value, 50), detail: text(detail), pct });

function age(at, now) {
  if (!Number.isFinite(Number(at)) || !at) return '无采集时间';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60 ? seconds + '秒前采集' : Math.floor(seconds / 60) + '分钟前采集';
}

function buildViews({ prefs = {} } = {}) {
  const { normalizePrefs, GROUPS } = require('./display-settings.cjs');
  const normalized = normalizePrefs(prefs);
  const groups = {
    overview: { title: 'Monitor / 概览', group: 'overview', rows: [] },
    coding: { title: 'Coding / 额度', group: 'coding', rows: [] },
    system: { title: 'System / 系统监控', group: 'system', rows: [] },
    radar: { title: 'Tibo / 雷达', group: 'radar', rows: [] },
  };
  return normalized.order.filter(id => normalized.mask & (1 << id)).map(id => groups[GROUPS[id]]);
}

function viewFrame(views, page, seq, mode, now = Date.now()) {
  const index = Math.max(0, Math.min(views.length - 1, Number.isInteger(page) ? page : 0));
  const view = views[index];
  return {
    v: 1, type: 'view', seq, createdAt: now, mode, page: index, pages: views.length,
    title: text(view.title, 70), group: view.group || 'overview', rows: view.rows.slice(0, LIMIT),
  };
}

module.exports = { buildViews, viewFrame, row, age };
