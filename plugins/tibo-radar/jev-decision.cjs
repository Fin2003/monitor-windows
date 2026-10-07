const TYPES = ['forecast', 'completion', 'mention', 'none'];
const BANKED = ['promised', 'credited', 'mention', 'none'];
const TIMING = ['clock', 'relative', 'date', 'unknown'];
const { estimate, classify } = require('./core.cjs');
const { wallTime } = require('./semantic.cjs');
const { calendarWindow, linkedTiming } = require('./forecast-window.cjs');
const HOURS = Array.from({ length: 25 }, (_, hour) => `h${String(hour).padStart(2, '0')}`);
const HOUR_CHOICES = [...HOURS, 'unknown'];

const questions = {
  ordinary: {
    type: 'choice',
    instructions: 'Classify the TARGET post only. Ancestors and nearby posts may clarify context, but must not turn a different post into this post\'s announcement. An ordinary reset replenishes Codex or ChatGPT Work usage limits automatically; a banked credit alone is separate. Select the most supported option. A completed ordinary reset takes precedence if the same target also promises another reset.',
    criteria: {
      forecast: 'TARGET promises, schedules, or clearly announces a future ordinary usage reset, including more resets coming this week/next week/next Tuesday, or one still landing or propagating without confirmation. Week-only promises are forecasts with a range, not completions; subsequent promises can refine an unfinished event.',
      completion: 'TARGET explicitly says an ordinary usage reset has happened or finished propagating. A plan, hope, question, or banked credit does not count.',
      mention: 'TARGET mentions an ordinary usage reset without clearly promising a future one or confirming it happened.',
      none: 'TARGET only discusses banked credits, an unrelated reset, or no ordinary usage reset.'
    }
  },
  banked: {
    type: 'choice',
    instructions: 'Classify a banked reset CREDIT in the TARGET post. A banked credit is stored for later use; it does not itself confirm an ordinary usage reset. Select the most supported option.',
    criteria: {
      promised: 'TARGET promises a future grant of a banked reset credit.',
      credited: 'TARGET explicitly says a banked reset credit has already been added or granted.',
      mention: 'TARGET discusses banked resets without clearly promising or confirming a grant.',
      none: 'TARGET does not announce or discuss a banked reset credit.'
    }
  },
  timing: {
    type: 'choice',
    instructions: 'For an ordinary usage reset forecast in TARGET, select the best time evidence. Use TARGET timing first. A compatible nearby Tibo time hint may supplement a date-only target but must not override an explicit TARGET clock. Do not use banked-credit timing for an ordinary reset. The app will verify the actual source text and resolve Pacific daylight saving time.',
    criteria: {
      clock: 'An explicit wall-clock hour/minute such as 3am, 18:00, or 6pm PST applies to the ordinary reset.',
      relative: 'An explicit numeric relative interval such as in 2 hours or next 30 minutes applies to the ordinary reset.',
      date: 'A named day/date, today, tomorrow, midnight, or end of day applies, but no reliable explicit clock or numeric interval applies.',
      unknown: 'No reliable date or time for the ordinary reset forecast, or TARGET is not an ordinary reset forecast.'
    }
  }
};

const hourQuestions = {
  hour: {
    type: 'choice',
    instructions: 'The TARGET is an ordinary reset forecast. Choose its best supported local wall-clock hour (00 through 24); 24:00 means 00:00 on the following calendar day, not another hour within that day. Prefer an explicit TARGET time, then a compatible nearby Tibo reply or post, then the date-only 01:00 prediction. If no calendar date or supported time exists, choose unknown. A completion post publication time is never reset-time evidence. Banked credits do not set ordinary reset time. Do not invent a time from an unsupported option.',
    criteria: Object.fromEntries([
      ...HOURS.map((key, hour) => [key, hour === 24 ? 'The source explicitly says 24:00, meaning 00:00 on the next calendar day.' : `The supported or predicted reset clock is in hour ${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59.`]),
      ['unknown', 'The forecast has no defensible calendar date, clock, or numeric relative time.']
    ])
  }
};

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const RESET = /\breset(?:s|ting|ed|ing)?\b/i;
const BANKED_HINT = /\bbanked\b|\breset (?:credits?|tokens?)\b/i;
const BANKED_GRANTED = /\b(?:banked resets?|reset credits?)\b.{0,50}\b(?:credited|granted|added|issued|available now)\b|\b(?:credited|granted|added|issued)\b.{0,50}\b(?:banked resets?|reset credits?)\b/i;
const BANKED_UNCERTAIN = /\?\s*$|\b(?:will|would|should|might|could|may|not|never|haven't|hasn't|won't)\b.{0,60}\b(?:credited|granted|added|issued)\b/i;
const RELATIVE = /\b(?:in\s+(?:about\s+|around\s+|~\s*)?|next\s+)(?:\d+(?:\.\d+)?|one|two|three|an?)?\s*(?:hours?|minutes?)\b/i;
const AMPM = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*(PST|PDT|PT)\b)?/i;
const CLOCK24 = /\b(\d{1,2}):(\d{2})\b(?:\s*(PST|PDT|PT)\b)?/i;

function pacificHour(ms) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(ms));
}

function pacificMinute(ms) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', minute: '2-digit' }).format(ms));
}

function pacificDate(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function namedDate(text, publishedAt) {
  const local = pacificDate(publishedAt);
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text);
  if (iso && !Number.isNaN(Date.parse(`${iso[0]}T00:00:00Z`))) return iso[0];
  const weekday = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  if (weekday) {
    const offset = (DAY_NAMES.indexOf(weekday[1].toLowerCase()) - new Date(`${local}T00:00:00Z`).getUTCDay() + 7) % 7;
    return require('./forecast-window.cjs').calendarWindow(text, publishedAt).startDate;
  }
  if (/\btomorrow\b/i.test(text)) return addDays(local, 1);
  if (/\btoday\b/i.test(text)) return local;
  return null;
}

function predictionDate(text, publishedAt) {
  const date = namedDate(text, publishedAt);
  if (/\b(?:midnight|end of (?:the )?day|tonight)\b/i.test(text) && !/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text)) {
    return addDays(date || pacificDate(publishedAt), 1);
  }
  return date;
}

function parseClock(text) {
  const ampm = AMPM.exec(text);
  if (ampm && +ampm[1] >= 1 && +ampm[1] <= 12 && +(ampm[2] || 0) < 60) {
    return { hour: (+ampm[1] % 12) + (ampm[3].toLowerCase() === 'pm' ? 12 : 0), minute: +(ampm[2] || 0), zone: ampm[4]?.toUpperCase() || null, label: ampm[0] };
  }
  const wall = CLOCK24.exec(text);
  if (wall && +wall[1] <= 24 && +wall[2] < 60 && (+wall[1] !== 24 || +wall[2] === 0)) {
    return { hour: +wall[1], minute: +wall[2], zone: wall[3]?.toUpperCase() || null, label: wall[0] };
  }
  return null;
}

function instant(date, clock) {
  if (!date) return null;
  try {
    return wallTime({ date: clock.hour === 24 ? addDays(date, 1) : date, hour: clock.hour === 24 ? 0 : clock.hour,
      minute: clock.minute, timezone: clock.zone === 'PST' ? '-08:00' : clock.zone === 'PDT' ? '-07:00' : 'America/Los_Angeles' });
  } catch (_) { return null; }
}

function hourCandidates(post, nearby = []) {
  if (RELATIVE.test(post.text)) {
    const relative = estimate(post.text, post.publishedAt);
    if (relative) return [{ hour: pacificHour(relative.at), minute: pacificMinute(relative.at), sourceId: post.id, basis: 'target', label: relative.label, at: relative.at }];
  }
  const directClock = parseClock(post.text);
  if (directClock) {
    const date = namedDate(post.text, post.publishedAt) || pacificDate(post.publishedAt);
    const at = instant(date, directClock);
    return at === null ? [] : [{ ...directClock, date, sourceId: post.id, basis: 'target', at }];
  }
  const targetDate = predictionDate(post.text, post.publishedAt);
  const targetWindow = calendarWindow(post.text, post.publishedAt);
  const nearbyClocks = nearby.flatMap(hint => {
    if (BANKED_HINT.test(hint.text)) return [];
    if (targetWindow?.precision === 'week' && !linkedTiming(post, hint)) return [];
    const linked = hint.replyToId === post.id || post.replyToId === hint.id;
    if (RELATIVE.test(hint.text) && (linked || (targetDate && RESET.test(hint.text)))) {
      const relative = estimate(hint.text, hint.publishedAt);
      if (relative && (!targetDate || pacificDate(relative.at) === targetDate)) {
        return [{ hour: pacificHour(relative.at), minute: pacificMinute(relative.at), date: pacificDate(relative.at),
          sourceId: hint.id, basis: 'nearby', label: relative.label, at: relative.at }];
      }
    }
    const clock = parseClock(hint.text);
    if (!clock) return [];
    const hintDate = namedDate(hint.text, hint.publishedAt);
    if (targetDate && hintDate && hintDate !== targetDate) return [];
    if (!targetDate && !hintDate) return [];
    if (targetDate && !hintDate && !linked) return [];
    const date = targetDate || hintDate;
    const at = instant(date, clock);
    return at === null ? [] : [{ ...clock, date, sourceId: hint.id, basis: 'nearby', at }];
  });
  if (nearbyClocks.length) return nearbyClocks;
  if (!targetDate) return [];
  const at = instant(targetDate, { hour: 1, minute: 0 });
  return at === null ? [] : [{ hour: 1, minute: 0, date: targetDate, sourceId: post.id, basis: 'date_policy', label: '未通报时刻，按既有经验规则预测 01:00', at }];
}

function estimatedAt(candidate) { return Number.isFinite(candidate?.at) ? candidate.at : null; }

function selectedCandidate(candidates, choice) {
  const matches = candidates.filter(value => `h${String(value.hour).padStart(2, '0')}` === choice);
  if (!matches.length || candidates.some(value => value.at !== matches[0].at)) return null;
  return matches[0];
}

function hourEvaluation(post, parents = [], nearby = []) {
  const candidates = hourCandidates(post, nearby);
  const criteria = Object.fromEntries(HOURS.map((key, hour) => {
    const evidence = candidates.filter(candidate => candidate.hour === hour).map(candidate => `${candidate.basis} source ${candidate.sourceId}`).join('; ');
    const meaning = hour === 24 ? ' 24:00 means 00:00 on the following calendar day.' : '';
    return [key, evidence ? `Supported candidate ${String(hour).padStart(2, '0')}:00 from ${evidence}.${meaning}` : `Hour ${String(hour).padStart(2, '0')}:00 has no supporting source evidence.${meaning}`];
  }));
  criteria.unknown = 'No supported calendar date, clock, or numeric relative interval; or all candidates contradict the target.';
  return { state: { ...state(post, parents, nearby), time_candidates: candidates }, questions: { hour: { ...hourQuestions.hour, criteria } }, candidates };
}

function state(post, parents = [], nearby = []) {
  const record = p => ({ id: p.id, text: p.text, publishedAt: new Date(p.publishedAt).toISOString(), replyToId: p.replyToId || null });
  return { target: record(post), ancestors: parents.map(record), nearby_times: nearby.map(record), policy: 'Unspecified timezone is America/Los_Angeles (DST aware). A date without a precise reported time has a separate, non-authoritative 01:00 prediction. 24:00 means next-day 00:00. An explicit time overrides the prediction. Banked credits never confirm an ordinary usage reset.' };
}

function parseChoice(answer, names) {
  if (answer?.type !== 'choice' || !answer.probabilities || typeof answer.probabilities !== 'object') throw new Error('JEV 未返回选择概率');
  const probabilities = Object.fromEntries(names.map(name => [name, answer.probabilities[name]]));
  if (Object.values(probabilities).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('JEV 概率字段无效');
  const winner = names.reduce((best, name) => probabilities[name] > probabilities[best] ? name : best, names[0]);
  return { choice: winner, probability: probabilities[winner], probabilities,
    providerChoice: answer.choice, choiceMismatch: answer.choice !== winner };
}

function parseResult(result) {
  if (result?.model !== 'typesafe-ai/jev') throw new Error('JEV 返回了意外模型');
  return {
    ordinary: parseChoice(result.answers?.ordinary, TYPES),
    banked: parseChoice(result.answers?.banked, BANKED),
    timing: parseChoice(result.answers?.timing, TIMING),
    usage: result.usage || null,
    cost: result.providerMetadata?.gateway?.cost ?? null
  };
}

function parseHourResult(result) {
  if (result?.model !== 'typesafe-ai/jev') throw new Error('JEV 返回了意外模型');
  const hour = parseChoice(result.answers?.hour, HOUR_CHOICES);
  return { hour, usage: result.usage || null, cost: result.providerMetadata?.gateway?.cost ?? null };
}

function toAnalysis(post, decision, hour = null, nearby = []) {
  const bankedChoice = decision.banked.choice;
  const banked = bankedChoice !== 'none' && !['forecast', 'completion'].includes(decision.ordinary.choice);
  let kind = banked ? ({ promised: 'forecast', credited: 'completion', mention: 'mention' }[bankedChoice] || 'mention')
    : ({ none: 'irrelevant' }[decision.ordinary.choice] || decision.ordinary.choice);
  if (kind === 'completion' && !(banked ? BANKED_GRANTED.test(post.text) && !BANKED_UNCERTAIN.test(post.text) : classify(post).kind === 'completion')) kind = 'mention';
  let candidate = !banked && kind === 'forecast' && hour?.supported ? hour.candidate : null;
  const declaredWindow = require('./forecast-window.cjs').calendarWindow(post.text, post.publishedAt);
  if (candidate && candidate.sourceId !== post.id && declaredWindow?.precision === 'week'
    && !linkedTiming(post, nearby.find(p => p.id === candidate.sourceId))) candidate = null;
  if (candidate && candidate.sourceId !== post.id && declaredWindow
    && (candidate.date < declaredWindow.startDate || candidate.date > declaredWindow.endDate)) candidate = null;
  const timeClass = candidate?.basis === 'target' ? 'announced' : candidate?.basis === 'nearby' ? 'inferred' : 'prediction';
  const zone = candidate?.zone === 'PST' ? '原文 PST (UTC-8)' : candidate?.zone === 'PDT' ? '原文 PDT (UTC-7)' : '默认 America/Los_Angeles（自动冬夏令时）';
  const eta = candidate ? { at: candidate.at, label: candidate.label,
    basis: `${candidate.basis === 'target' ? '主帖' : candidate.basis === 'nearby' ? '附近帖关联' : '经验规则'} · JEV 选时 · ${zone}`,
    approximate: true, inferredMidnight: timeClass === 'prediction', timeClass, sourcePostId: candidate.sourceId,
    sourceUrl: `https://x.com/thsottiaux/status/${candidate.sourceId}` } : null;
  return { kind, timeWindow: kind === 'forecast' && !banked ? require('./forecast-window.cjs').resolveWindow(post, nearby) : null, banked, forecastType: banked && kind === 'forecast' ? 'banked_release' : kind === 'forecast' ? eta ? 'scheduled' : 'unspecified' : 'none',
    eta, timeWarning: kind === 'forecast' && hour && !hour.supported && hour.choice !== 'unknown' ? '选时缺少一致的原文证据，未采用' : null,
    keyText: classify(post).keyText, source: 'jev', analyzedAt: Date.now() };
}

module.exports = { questions, state, parseResult, hourQuestions, hourEvaluation, hourCandidates, selectedCandidate, estimatedAt, parseHourResult, toAnalysis };
