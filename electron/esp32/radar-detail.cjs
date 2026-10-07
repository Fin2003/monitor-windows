const crypto = require('node:crypto');
const {
  eventPresentation,
  formatRadarDate,
  latestRadarPosts,
  postPresentation,
  radarOutlook,
} = require('../../plugins/tibo-radar/presentation.cjs');

const clean = value => String(value ?? '').replace(/\r/g, '').trim();

function textHash(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function boundedUtf8(value, maxBytes = 4800) {
  const source = clean(value);
  if (Buffer.byteLength(source, 'utf8') <= maxBytes) return { text: source, truncated: false };
  let bytes = 0, output = '';
  for (const character of source) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes - 3) break;
    output += character;
    bytes += size;
  }
  return { text: output.trimEnd() + '...', truncated: true };
}

function translationFor(translations, post) {
  const record = translations?.items?.[post?.id];
  if (!record || record.sourceHash !== textHash(post?.text) || !clean(record.text)) return null;
  return clean(record.text);
}

function radarPosts(snapshot, limit = 3) {
  const zone = snapshot?.config?.displayTimeZone || 'Asia/Shanghai';
  return latestRadarPosts(snapshot).slice(0, limit).map(post => {
    const display = post.display || postPresentation(post);
    return {
      id: String(post.id || ''),
      text: boundedUtf8(display.excerpt || post.text, 360).text,
      tag: clean(display.label),
      tone: clean(display.tone || 'ordinary'),
      at: formatRadarDate(post.publishedAt, zone),
    };
  });
}

function statusHistory(snapshot, now) {
  const zone = snapshot?.config?.displayTimeZone || 'Asia/Shanghai';
  const entries = [];
  for (const event of snapshot?.events || []) {
    const forecast = event.forecast;
    if (forecast?.publishedAt) {
      const presentation = eventPresentation({ ...event, completion: null }, forecast.publishedAt);
      entries.push({
        at: forecast.publishedAt,
        label: presentation.label || '重置预告',
        detail: clean(forecast.keyText || forecast.text),
        tone: presentation.tone || 'waiting',
      });
    }
    if (event.eta?.at && now >= event.eta.at && !event.completion) {
      entries.push({
        at: event.eta.at,
        label: now <= (event.observationUntil || event.eta.at + 7200000) ? '延迟观察中' : '继续监测',
        detail: '预告时刻已到，尚未收到完成通知',
        tone: 'late',
      });
    }
    if (event.completion?.publishedAt) {
      entries.push({
        at: event.completion.publishedAt,
        label: event.banked || event.completion.banked ? 'Banked Reset' : '重置完成',
        detail: clean(event.completion.keyText || event.completion.text),
        tone: event.banked || event.completion.banked ? 'banked' : 'done',
      });

    }
  }
  return entries
    .filter(entry => Number.isFinite(entry.at))
    .sort((a, b) => b.at - a.at)
    .filter((entry, index, array) => index === array.findIndex(candidate => candidate.at === entry.at && candidate.label === entry.label))
    .slice(0, 10)
    .map(entry => ({ ...entry, at: formatRadarDate(entry.at, zone), detail: boundedUtf8(entry.detail, 420).text }));
}

function resetHistory(snapshot) {
  const zone = snapshot?.config?.displayTimeZone || 'Asia/Shanghai';
  const entries = [];
  for (const event of snapshot?.events || []) {
    const completion = event.completion;
    if (completion?.publishedAt) {
      const banked = !!(event.banked || completion.banked || event.pairedBanked);
      entries.push({
        at: completion.publishedAt,
        label: banked ? 'Banked' : 'Hard',
        detail: clean(completion.keyText || completion.text),
        tone: banked ? 'banked' : 'done',
      });

    }
  }
  return entries
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
    .map(entry => ({ ...entry, at: formatRadarDate(entry.at, zone), detail: boundedUtf8(entry.detail, 520).text }));
}

function radarDetail({ radar = null, translations = null, mode, id, now = Date.now() } = {}) {
  const snapshot = radar || {};
  const zone = snapshot.config?.displayTimeZone || 'Asia/Shanghai';
  if (mode === 'post') {
    const post = latestRadarPosts(snapshot).find(candidate => String(candidate.id || '') === String(id || ''));
    if (!post) return { v: 1, type: 'radar_detail', mode, title: '帖子详情', subtitle: '内容已更新', error: '该帖子已不在当前缓存中' };
    const original = boundedUtf8(post.text, 4800);
    const translated = translationFor(translations, post);
    const translation = translated ? boundedUtf8(translated, 4800) : null;
    const display = post.display || postPresentation(post);
    return {
      v: 1, type: 'radar_detail', mode, id: String(post.id || ''),
      title: display.label || 'Tibo 帖子',
      subtitle: `@${clean(post.author || 'thsottiaux')} · ${formatRadarDate(post.publishedAt, zone)}`,
      original: original.text,
      translation: translation?.text || '',
      translationState: translation ? 'ready' : translations?.meta?.lastError ? 'unavailable' : 'pending',
      truncated: original.truncated || !!translation?.truncated,
    };
  }
  if (mode === 'status') {
    const outlook = radarOutlook(snapshot, now);
    return {
      v: 1, type: 'radar_detail', mode, title: '状态变动',
      subtitle: `当前 · ${outlook.badge || outlook.label || '暂无状态'}`,
      items: statusHistory(snapshot, now),
    };
  }
  if (mode === 'resets') {
    return {
      v: 1, type: 'radar_detail', mode, title: '历史重置',
      subtitle: 'Hard、Banked 与额度检测记录',
      items: resetHistory(snapshot),
    };
  }
  throw new Error('Invalid radar detail request');
}

module.exports = { boundedUtf8, radarDetail, radarPosts, resetHistory, statusHistory, textHash, translationFor };
