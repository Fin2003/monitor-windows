const DAY = 86400000;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RANGE_HINT = /\b(?:this|next)\s+week\b|本周|这周|下周/i;
function calendarWindow(text, publishedAt) {
  if (!Number.isFinite(publishedAt)) return null;
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(publishedAt);
  const base = Date.parse(local + 'T00:00:00Z'), dow = new Date(base).getUTCDay();
  const monday = base - ((dow + 6) % 7) * DAY;
  const named = /\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  const chinese = /(下周|本周|这周|星期|周)([一二三四五六日天])/.exec(text);
  const next = /\bnext\s+(?:week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|下周/i.test(text);
  const date = ms => new Date(ms).toISOString().slice(0, 10);
  if (named || chinese) {
    const day = named ? DAYS.indexOf(named[2].toLowerCase()) : chinese[2] === '天' ? 0 : '日一二三四五六'.indexOf(chinese[2]);
    const target = next ? monday + (7 + (day + 6) % 7) * DAY : /\bthis\b|本周|这周/i.test(text) ? monday + ((day + 6) % 7) * DAY : base + ((day - dow + 7) % 7) * DAY;
    return { precision: 'date', startDate: date(target), endDate: date(target), label: (named || chinese)[0], timezone: 'America/Los_Angeles' };
  }
  if (!RANGE_HINT.test(text)) return null;
  const start = monday + (next ? 7 : 0) * DAY;
  return { precision: 'week', startDate: date(start), endDate: date(start + 6 * DAY), label: next ? '下周' : '本周', timezone: 'America/Los_Angeles' };
}
function timingRank(post) {
  if (post.eta && post.eta.timeClass !== 'prediction') return 3;
  if (post.timeWindow?.precision === 'date' || post.eta) return 2;
  return post.timeWindow ? 1 : 0;
}
function compatible(a, b) {
  return !a || !b || a.startDate <= b.endDate && b.startDate <= a.endDate;
}
function linkedTiming(post, hint) {
  return !!hint && (hint.replyToId === post.id || hint.quoteId === post.id || post.replyToId === hint.id || post.quoteId === hint.id);
}
function resolveWindow(post, replies = []) {
  const own = calendarWindow(post.text, post.publishedAt);
  const hints = replies.filter(p => p.author === 'thsottiaux' && Math.abs(p.publishedAt - post.publishedAt) <= 3 * DAY
    && !/\bbanked\b|reset (?:credits?|tokens?)/i.test(p.text)
    && linkedTiming(post, p))
    .map(p => ({ ...calendarWindow(p.text, p.publishedAt), sourcePostId: p.id, evidenceVersion: 2 })).filter(w => w.precision && compatible(own, w));
  const dates = hints.filter(w => w.precision === 'date');
  if (own?.precision === 'date') return own;
  if (dates.length && dates.every(w => w.startDate === dates[0].startDate)) return dates[0];
  if (own) return own;
  return hints.length && hints.every(w => w.startDate === hints[0].startDate && w.endDate === hints[0].endDate) ? hints[0] : null;
}
function windowBounds(window) {
  function instant(date, hour, minute) {
    const wall = Date.parse(date + 'T00:00:00Z') + (hour * 60 + minute) * 60000;
    let utc = wall + 8 * 3600000;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: window.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(utc).map(p => [p.type,p.value]));
      utc += wall - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    }
    return utc;
  }
  return { start: instant(window.startDate, 0, 0), end: instant(window.endDate, 23, 59) + 60000 };
}
module.exports = { calendarWindow, RANGE_HINT, timingRank, compatible, resolveWindow, windowBounds, linkedTiming };
