const HOUR = 3600000;
const { postPresentation } = require('./presentation.cjs');
const { calendarWindow, timingRank, compatible } = require('./forecast-window.cjs');
const RESET = /\breset(?:s|ting|ed|ing)?\b/i;
const BANKED = /\bbanked\b|\breset credits?\b|\breset tokens?\b/i;
const NEGATIVE = /\b(?:not|never|haven't|hasn't|didn't|won't|will not|no)\b.{0,30}\b(?:reset|done|propagated|completed)\b|\breset\b.{0,25}\b(?:not|isn't)\b.{0,15}\b(?:done|complete|propagated)\b/i;
const COMPLETE = /\breset\s+(?:has\s+been|is|was)\s+processed\b|\b(?:have|has|had|just|already|now|(?:i|we|they|you)['’]ve)\s+(?:been\s+)?reset\b|\b(?:limits?|usage|accounts?)\s+(?:have\s+been\s+|has\s+been\s+|are\s+|is\s+)?reset\b|\b(?:reset|all)\s+(?:has\s+been\s+|have\s+been\s+|is\s+|all\s+)?propagated\b|\ball reset\b|\b(?:it(?:['’]s| is)|reset is)\s+(?:done|complete|completed|live)\b|\breset\s+(?:is\s+)?(?:done|completed)\b/i;
const FORECAST = /\b(?:will|going to|plan to|planning to|scheduled|landing|lands|tomorrow|tonight|midnight)\b|\bin\s+(?:~\s*)?(?:\d+|one|two|three)\s+hours?\b/i;

function laParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function forecastCalendarDate(post) {
  const evidence = post.keyText || post.text || '';
  const { year, month, day } = laParts(post.publishedAt);
  const base = Date.UTC(+year, +month - 1, +day);
  const dates = [...new Set(evidence.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])];
  if (dates.length) return dates.length === 1 ? dates[0] : null;
  const relative = [...new Set((evidence.match(/\b(?:today|tomorrow)\b/gi) || []).map(value => value.toLowerCase()))];
  if (relative.length) return relative.length === 1
    ? new Date(base + (relative[0] === 'tomorrow' ? 1 : 0) * 86400000).toISOString().slice(0, 10) : null;
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const named = [...new Set((evidence.match(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi) || []).map(value => value.toLowerCase()))];
  if (named.length !== 1) return null;
  let offset = (weekdays.indexOf(named[0]) - new Date(base).getUTCDay() + 7) % 7;
  if (!offset && /\bnext\b/i.test(evidence)) offset = 7;
  return new Date(base + offset * 86400000).toISOString().slice(0, 10);
}

// Resolve a Pacific wall-clock time through Intl, including daylight saving time.
function pacificTime(parts, hour, minute = 0, dayOffset = 0) {
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day + dayOffset, hour, minute);
  let utc = wall + 8 * HOUR;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(utc).map(p => [p.type, p.value]));
    const observed = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    utc += wall - observed;
  }
  return utc;
}

function estimate(text, publishedAt, banked = false) {
  if (banked || !Number.isFinite(publishedAt)) return null;
  const parts = laParts(publishedAt);
  const relative = text.match(/(?:\bin\s+(?:about\s+|around\s+|~\s*)?|\bnext\s+)(\d+(?:\.\d+)?|one|two|three|an?)?\s*(hours?|minutes?)\b/i);
  if (relative) {
    const words = { one: 1, two: 2, three: 3, a: 1, an: 1 };
    const n = words[relative[1]?.toLowerCase()] || Number(relative[1] || 1);
    return { at: publishedAt + n * (/minute/i.test(relative[2]) ? 60000 : HOUR), label: relative[0], basis: '相对发帖时间估算', approximate: true, timeClass: 'announced' };
  }
  const clock = text.match(/(?:\bat\s+|\baround\s+|\bby\s+|\bbefore\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(PST|PDT|PT)?\b/i);
  if (clock && +clock[1] >= 1 && +clock[1] <= 12 && +(clock[2] || 0) < 60) {
    const hour = (+clock[1] % 12) + (clock[3].toLowerCase() === 'pm' ? 12 : 0);
    const tomorrow = /\btomorrow\b/i.test(text) ? 1 : 0;
    const zone = clock[4]?.toUpperCase();
    let at = pacificTime(parts, hour, +(clock[2] || 0), tomorrow);
    if (zone === 'PST' || zone === 'PDT') at = Date.UTC(+parts.year, +parts.month - 1, +parts.day + tomorrow, hour, +(clock[2] || 0)) + (zone === 'PST' ? 8 : 7) * HOUR;
    return { at, label: clock[0].trim(), approximate: true, timeClass: 'announced', basis: zone === 'PST' ? '按原文 PST (UTC−8)；可能与当地夏令时相差 1 小时' : zone ? `原文 ${zone}` : '未注明时区，按美国太平洋时间推定' };
  }
  const clock24 = text.match(/\b(\d{1,2}):(\d{2})\s*(PST|PDT|PT)?\b/i);
  if (clock24 && +clock24[1] < 24 && +clock24[2] < 60) {
    const tomorrow = /\btomorrow\b/i.test(text) ? 1 : 0;
    const zone = clock24[3]?.toUpperCase();
    const at = zone === 'PST' || zone === 'PDT'
      ? Date.UTC(+parts.year, +parts.month - 1, +parts.day + tomorrow, +clock24[1], +clock24[2]) + (zone === 'PST' ? 8 : 7) * HOUR
      : pacificTime(parts, +clock24[1], +clock24[2], tomorrow);
    return { at, label:clock24[0], basis:zone ? `原文 ${zone}` : '原文具体时刻，默认太平洋时区', approximate:true, timeClass:'announced' };
  }
  if (/\bmidnight\b|\bend of (?:the )?day\b|\btonight\b/i.test(text)) {
    return { at: pacificTime(parts, 1, 0, /\btomorrow\b/i.test(text) ? 2 : 1), label: '午夜推定 01:00', basis: '按既有默认时刻预测，太平洋时区自动冬夏令时', approximate: true, inferredMidnight: true, timeClass:'prediction' };
  }
  return null;
}

function classify(post, contextHasReset = false) {
  const text = post.text || '';
  const hasReset = RESET.test(text);
  const banked = BANKED.test(text);
  const relevant = hasReset || contextHasReset;
  let kind = 'mention';
  if (!relevant) kind = 'irrelevant';
  else if (!NEGATIVE.test(text) && COMPLETE.test(text) && !/\?\s*$/.test(text.trim()) && !/\b(?:will|would|should|might)\s+(?:have\s+)?(?:been\s+)?reset\b/i.test(text)) kind = 'completion';
  else if (hasReset && !NEGATIVE.test(text) && FORECAST.test(text) && !/\?\s*$/.test(text.trim())) kind = 'forecast';
  const lines = text.split(/\n+|(?<=[.!])\s+/).map(s => s.trim()).filter(Boolean);
  const keys = lines.filter(s => RESET.test(s) || COMPLETE.test(s) || /\b(?:midnight|lands|landing|end of day|\d+\s*(?:am|pm)|next hour)\b/i.test(s));
  return { kind, banked, eta: kind === 'forecast' ? estimate(text, post.publishedAt, banked) : null, keyText: (keys.length ? keys : lines).join('\n') };
}

function buildState(posts, now = Date.now(), { useLLM = false, allowRules = false } = {}) {
  const valid = posts.filter(p => p.author?.toLowerCase() === 'thsottiaux' && p.id && Number.isFinite(p.publishedAt));
  const map = new Map(valid.map(p => [p.id, p]));
  function ancestors(post) {
    const result = [], seen = new Set([post.id]);
    let queue = [post.quoteId, post.replyToId].filter(Boolean);
    while (queue.length && result.length < 8) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const p = map.get(id);
      if (p) { result.push(p); queue.push(...[p.quoteId, p.replyToId].filter(Boolean)); }
    }
    return result;
  }
  const decorated = valid.map(p => {
    const parents = ancestors(p);
    const classification = { ...(useLLM
      ? p.analysis || (allowRules ? { ...classify(p, parents.some(q => RESET.test(q.text))), source: 'rules' }
        : { kind: RESET.test(p.text) ? 'mention' : 'irrelevant', banked: false, eta: null, keyText: p.text, source: 'pending' })
      : classify(p, parents.some(q => RESET.test(q.text)))) };
    // Only generic acknowledgements inherit context, not explicit usage resets.
    const resetParent = parents.find(q => RESET.test(q.text));
    const genericReply = !RESET.test(p.text) || /^\s*(?:all reset(?: for everyone)?|reset (?:is )?(?:done|completed|all propagated))[.!\s]*$/i.test(p.text);
    if (resetParent && BANKED.test(resetParent.text) && genericReply) classification.banked = true;
    if (classification.banked) classification.eta = null;
    else if (classification.eta && !classification.eta.timeClass) classification.eta = { ...classification.eta,
      timeClass: classification.eta.inferredMidnight ? 'prediction' : classification.eta.sourcePostId && classification.eta.sourcePostId !== p.id ? 'inferred' : 'announced' };
    // Old nearby-date windows did not verify that the hint concerned this reset.
    const cachedWindow = classification.timeWindow?.sourcePostId && classification.timeWindow.evidenceVersion !== 2 ? null : classification.timeWindow;
    const timeWindow = classification.kind === 'forecast' && !classification.banked ? cachedWindow || calendarWindow(p.text, p.publishedAt) : null;
    if (timeWindow?.precision === 'week' && (!classification.eta || classification.eta.timeClass === 'prediction')) classification.eta = null;
    return { ...p, ...classification, timeWindow, resetRelated: classification.kind !== 'irrelevant', ancestors: parents.map(q => q.id) };
  }).sort((a, b) => a.publishedAt - b.publishedAt);
  const events = [];
  for (const p of decorated) {
    if (p.banked) {
      const linked = events.find(e => e.banked && !e.post
        && [e.forecast?.id,e.completion?.id,...(e.relatedPosts || []).map(post=>post.id)].some(id=>p.ancestors.includes(id)));
      if (linked) {
        (linked.relatedPosts ||= []).push(p);
        if (p.kind === 'completion' || /\bconfirmed\s+(?:landed|credited|available)\b/i.test(p.text)) linked.confirmation ||= p;
        continue;
      }
    }
    if (p.kind === 'mention') events.push({ id: p.id, post: p, forecast: null, completion: null, banked: p.banked, eta: null });
    if (p.kind === 'forecast') {
      const active = !p.banked && [...events].reverse().find(e => e.forecast && !e.banked && !e.completion
        && p.publishedAt > e.forecast.publishedAt && p.publishedAt - e.forecast.publishedAt <= 31 * 24 * HOUR
        && compatible(e.timeWindow, p.timeWindow)
        && !events.some(other => other.completion && other.completion.publishedAt >= e.forecast.publishedAt));
      if (active) {
        active.forecastIds.push(p.id);
        if (timingRank(p) >= timingRank(active.forecast)) {
          active.forecast = p;
          active.eta = p.eta;
          active.timeWindow = p.timeWindow;
        }
      } else events.push({ id: p.id, forecastIds: [p.id], forecast: p, completion: null, banked: p.banked, eta: p.eta, timeWindow: p.timeWindow });
    }
    if (p.kind === 'completion') {
      let related = events.filter(e => e.forecast && !e.completion && (!e.banked || p.banked)
        && e.forecastIds.some(id => p.ancestors.includes(id)));
      if (!related.length && p.banked) {
        // Unquoted Banked completions need a unique, dated ordinary promise to close.
        const completedDay = laParts(p.publishedAt);
        const completedDate = `${completedDay.year}-${completedDay.month}-${completedDay.day}`;
        const candidates = events.filter(e => e.forecast && !e.banked && !e.completion
          && p.publishedAt > e.forecast.publishedAt && p.publishedAt - e.forecast.publishedAt <= 48 * HOUR
          && ((Number.isFinite(e.eta?.at) && e.eta.timeClass !== 'prediction'
            && Math.abs(p.publishedAt - e.eta.at) <= 12 * HOUR)
            || (e.forecast.forecastType === 'scheduled' && forecastCalendarDate(e.forecast) === completedDate))
          && !events.some(other => other.completion && other.completion.publishedAt > e.forecast.publishedAt));
        if (candidates.length === 1) related = candidates;
      }
      if (related.length) {
        for (const e of related) { e.completion = p; e.banked = p.banked; }
      } else events.push({ id: p.id, forecast: null, completion: p, banked: p.banked, eta: null });
    }
  }
  for (const e of events) {
    e.pairedBanked = !!(e.forecast && !e.forecast.banked && e.completion?.banked);
    e.status = e.completion ? 'confirmed' : e.banked ? 'banked' : !e.eta || e.eta.timeClass === 'prediction' ? 'waiting' : now < e.eta.at ? 'scheduled' : now <= e.eta.at + 2 * HOUR ? 'overdue' : 'unconfirmed';
    e.observationUntil = e.eta && e.eta.timeClass !== 'prediction' ? e.eta.at + 2 * HOUR : null;
    if (e.post) e.status = e.post.source === 'pending' ? 'analyzing' : 'mention';
    e.sortAt = Math.max(e.forecast?.publishedAt || 0, e.completion?.publishedAt || 0, e.post?.publishedAt || 0);
  }
  events.sort((a, b) => b.sortAt - a.sortAt);
  const completed = events.filter(e => e.completion && !e.banked).map(e => e.completion);
  const latest = [...completed].sort((a, b) => b.publishedAt - a.publishedAt)[0] || null;
  const banked = events.filter(e => e.banked && !e.post && e.sortAt >= now - 30 * 24 * HOUR && e.sortAt <= now);
  const latestBanked = banked[0];
  const recentReset = latestBanked && (!latest || latestBanked.sortAt > latest.publishedAt)
    ? { publishedAt: latestBanked.sortAt, type: 'Banked' }
    : latest ? { publishedAt: latest.publishedAt, type: 'Hard' } : null;
  const unresolved = events.filter(e => e.forecast && !e.completion && !e.banked);
  // Old unmatched announcements remain in history, not the current reset outlook.
  // A future ETA still matters even when another reset has completed in between.
  const pending = unresolved.filter(e => !latest || e.forecast.publishedAt > latest.publishedAt || e.eta?.at > latest.publishedAt);
  const pinnedId = pending[0]?.forecast.id;
  for (const event of events.filter(e=>e.banked)) {
    for (const post of [event.forecast,event.completion,event.post,...(event.relatedPosts || [])].filter(Boolean)) {
      post.bankedEventId = event.id;
      post.bankedCredit = post.id === (event.forecast || event.completion)?.id;
      post.bankedRole = post.bankedCredit ? 'credited' : post.id === event.confirmation?.id || post.kind === 'completion' ? 'confirmation'
        : post.kind === 'forecast' ? 'announcement' : /\b(?:EOD|PST|PDT|tonight|tomorrow|by|at)\b/i.test(post.text) ? 'timing' : 'related';
    }
  }
  return { events, posts: decorated.sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId) || b.publishedAt - a.publishedAt).map(post => {
    const result = { ...post, pinned: post.id === pinnedId, superseded: post.kind === 'forecast' && !post.banked && post.id !== pinnedId };
    return { ...result, display: postPresentation(result) };
  }), latest, recentReset, pending, unresolved, banked };
}

module.exports = { HOUR, classify, estimate, buildState, pacificTime };
