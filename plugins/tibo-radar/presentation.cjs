const { windowBounds } = require('./forecast-window.cjs');
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const DISPLAY_TIME_ZONES = {
  'Asia/Shanghai': '北京时间',
  'America/Los_Angeles': '太平洋时间',
  UTC: 'UTC',
  'Asia/Tokyo': '日本时间',
};

function displayTimeZone(value) {
  return Object.hasOwn(DISPLAY_TIME_ZONES, value) ? value : 'Asia/Shanghai';
}

function displayTimeZoneLabel(value) {
  return DISPLAY_TIME_ZONES[displayTimeZone(value)];
}

function radarState(snapshot, now = Date.now()) {
  const meta = snapshot?.meta || {};
  const config = snapshot?.config || {};
  const issue = Array.isArray(meta.errors) ? meta.errors.filter(Boolean).join('\n') : '';
  const interval = Math.max(60, finiteNumber(config.intervalSeconds) || 120);
  const stale = !finiteNumber(meta.lastSuccess) || now - meta.lastSuccess > Math.max(300000, interval * 2500);
  const errors = Array.isArray(meta.errors) ? meta.errors.filter(Boolean) : [];
  const primary = errors.some(error => !/^(?:X 回复：|历史补充：|(?:LLM|GLM|JEV)(?:\s|：))/.test(error));
  const model = errors.some(error => /^(?:LLM|GLM|JEV)(?:\s|：)/.test(error));
  const replies = errors.some(error => error.startsWith('X 回复：'));
  const replyLabel = {page_error:'回复加载失败',login_required:'回复需登录',rate_limited:'回复限流',challenge:'X 需验证',redirected:'回复跳转',loading:'回复未返回',coverage_incomplete:'回复覆盖不足'}[meta.repliesStatus] || '回复受限';
  const issueLabel = primary ? '抓取异常' : model && replies ? `分析重试 · ${replyLabel}` : model ? '分析重试' : replies ? replyLabel : issue ? '历史待补' : '';
  let label = '未启用';
  let kind = 'muted';
  if (config.paused) {
    label = '已暂停';
    kind = 'warning';
  } else if (meta.running && meta.fetching) {
    label = '更新中';
    kind = 'active';
  } else if (meta.running && issue) {
    label = primary ? '抓取异常' : model ? '分析重试' : replies ? replyLabel : '历史待补';
    kind = primary ? 'error' : 'warning';
  } else if (meta.running && stale) {
    label = '待更新';
    kind = 'warning';
  } else if (meta.running) {
    label = '监测中';
    kind = 'active';
  }
  return { label, kind, issue, issueLabel, stale,
    latestAt: finiteNumber(snapshot?.recentReset?.publishedAt ?? snapshot?.latest?.publishedAt),
    latestType: snapshot?.recentReset?.type || (snapshot?.latest ? 'Hard' : '') };
}

function formatRadarDate(timestamp, timeZone = 'Asia/Shanghai') {
  const value = finiteNumber(timestamp);
  if (value === null) return '无记录';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: displayTimeZone(timeZone),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

function radarOutlook(snapshot, now = Date.now()) {
  const timeZone = displayTimeZone(snapshot?.config?.displayTimeZone);
  const pending = snapshot?.pending?.find(event => !event.banked);
  const pairedBanked = snapshot?.events?.find(event => event.pairedBanked && event.completion?.publishedAt <= now);
  const hardAt = finiteNumber(snapshot?.latest?.publishedAt);
  const bankedAt = finiteNumber(pairedBanked?.completion?.publishedAt);
  const reset = bankedAt !== null && (hardAt === null || bankedAt > hardAt)
    ? { source: 'banked', publishedAt: bankedAt } : snapshot?.latest;
  const latestAt = finiteNumber(reset?.publishedAt);
  if (!pending && latestAt !== null && now >= latestAt && now - latestAt < 12 * 3600000) {
    if (reset.source === 'banked') return { label: '已重置', detail: '', late: false, badge: 'Banked', tone: 'banked',
      basis: `Tibo Banked Reset · ${formatRadarDate(reset.publishedAt, timeZone)}` };
    const quota = reset.source === 'quota';
    return { label: '已重置', detail: '', late: false, badge: quota ? `${reset.before}%→${reset.after}%` : '', tone: 'confirmed',
      basis: quota ? `监测账号周用量显著回落，检测于 ${formatRadarDate(reset.publishedAt, timeZone)}；不是 Tibo 完成通知，实际发生时间在两次采样之间` : `Tibo 完成通知 · ${formatRadarDate(reset.publishedAt, timeZone)}` };
  }
  if (!pending) return { label: '暂无预告', detail: '', late: false, badge: '', tone: 'muted' };
  const at = finiteNumber(pending.eta?.at);
  if (!at && pending.timeWindow) {
    const { start, end } = windowBounds(pending.timeWindow);
    const first = formatRadarDate(start, timeZone).slice(0, 5), last = formatRadarDate(end - 1, timeZone).slice(0, 5);
    const late = now >= end;
    return { label: late ? '超时 ' + Math.floor((now - end) / 60000) + ' 分' : first === last ? first : first + '–' + last,
      detail: '', late, badge: late ? '已超时' : '等待重置', tone: late ? 'overdue' : 'forecast' };
  }
  if (!at) return { label: '未通报时间', detail: '', late: false, badge: '等待重置', tone: 'forecast' };
  const date = formatRadarDate(at, timeZone);
  if (pending.eta.timeClass === 'prediction') return { label: '未通报时间', detail: date, late: false,
    badge: `预测 ${date.slice(-5)}`, tone: 'forecast', prediction: true,
    basis: `${pending.eta.basis || '既有默认时刻预测'} · 不是 Tibo 通报的准确时刻，不据此判定超时或重置` };
  const until = finiteNumber(pending.observationUntil) ?? at + 2 * 3600000;
  const late = now >= at;
  const countdown = late ? '' : `剩余 ${Math.ceil((at - now) / 60000)} 分`;
  const elapsed = late ? `已超时 ${Math.floor((now - at) / 60000)} 分` : '';
  const status = countdown || elapsed;
  const observation = late ? now <= until ? '延迟观察中' : '已超过两小时，继续监测' : '';
  const inferred = pending.eta.timeClass === 'inferred';
  return { label: date.slice(-5), dateLabel: date.slice(0, 5), countdown, elapsed, inferred,
    detail: date.slice(0, 5) + ' · ' + status, late,
    badge: inferred ? late ? '预测已过' : '关联预测' : late ? '已超时' : '等待重置', tone: late ? 'overdue' : 'forecast',
    basis: `${pending.eta.basis || '预计重置时间'} · ${observation || '到时无完成通知，观察两小时后仍继续监测'} · 尚无完成通知，不自动确认` };
}

const radarSentenceSegmenter = new Intl.Segmenter('en', {granularity:'sentence'});
function radarPostExcerpt(text) {
  if (typeof text !== 'string') return '';
  const keyword = /\breset(?:s|ting)?\b/i;
  if (!keyword.test(text)) return text;
  for (const line of text.split(/\r?\n/)) {
    for (const {segment} of radarSentenceSegmenter.segment(line)) {
      if (keyword.test(segment)) return segment.trim();
    }
  }
  return text;
}

function latestRadarPosts(snapshot) {
  return (Array.isArray(snapshot?.posts) ? snapshot.posts : [])
    .filter(post => post && !post.manual && typeof post.text === "string" && post.text.trim())
    .map(post => ({ ...post, display: post.display || postPresentation(post) }))
    .slice().sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || (finiteNumber(b.publishedAt) || 0) - (finiteNumber(a.publishedAt) || 0));
}

function postPresentation(post) {
  const excerpt = radarPostExcerpt(post.text || post.keyText || '');
  if (post.banked) return { label: 'Banked +1', tone: 'banked', category: 'banked', excerpt };
  if (!post.resetRelated) return { label: '', tone: 'ordinary', category: 'all', excerpt };
  if (post.kind === 'completion') return { label: '重置完成', tone: 'completed', category: 'reset', excerpt };
  if (post.superseded) return { label: '', tone: 'ordinary', category: 'reset', excerpt };
  if (post.kind === 'forecast') return { label: '重置预告', tone: 'forecast', category: 'reset', excerpt };
  return { label: '重置相关', tone: 'related', category: 'reset', excerpt };
}

function eventPresentation(event, now = Date.now()) {
  if (event.pairedBanked) return { label: 'Banked Reset', tone: 'banked' };
  if (event.banked) return { label: 'Banked +1', tone: 'banked' };
  if (event.post) return { label: event.post.source === 'pending' ? '待分析' : '重置相关', tone: 'related' };
  if (event.completion) return { label: '已完成', tone: 'done' };
  if (!event.eta && event.timeWindow) return { label: '等待重置', tone: 'waiting' };
  if (!event.eta || event.eta.timeClass === 'prediction') return { label: '未通报时间', tone: 'waiting' };
  if (event.eta.timeClass === 'inferred') return { label: now < event.eta.at ? '关联预测' : `预测已过 ${Math.floor((now - event.eta.at) / 60000)} 分`, tone: now < event.eta.at ? 'waiting' : 'late' };
  if (now < event.eta.at) return { label: '等待重置', tone: 'waiting' };
  return { label: `已超时 ${Math.floor((now - event.eta.at) / 60000)} 分`, tone: 'late' };
}

function formatRadarAge(timestamp, now = Date.now()) {
  const value = finiteNumber(timestamp);
  if (value === null) return '无记录';
  const minutes = Math.max(0, Math.floor((now - value) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  return `${Math.floor(minutes / 1440)}天前`;
}

module.exports = { radarState, radarOutlook, radarPostExcerpt, latestRadarPosts, formatRadarAge, formatRadarDate, displayTimeZone, displayTimeZoneLabel, DISPLAY_TIME_ZONES, postPresentation, eventPresentation };
