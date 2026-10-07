// JavaScript adaptation of CC Switch coding_plan.rs, MIT.
// https://github.com/farion1231/cc-switch/blob/d35726e28695844deaf0098450b34911f5be7b78/src-tauri/src/services/coding_plan.rs
// Copyright (c) 2025 Jason Young. See licenses/CC-Switch-MIT.txt.
const crypto = require('node:crypto');
const SOURCE = { name: 'CC Switch', revision: 'd35726e28695844deaf0098450b34911f5be7b78', url: 'https://github.com/farion1231/cc-switch', license: 'MIT' };
const TYPES = {
  volcengine: { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/coding', auth: 'aksk' },
  opencodego: { name: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1', auth: 'key' },
  kimi: { name: 'Kimi Coding', url: 'https://api.kimi.com/coding/v1', auth: 'key' },
  zhipu: { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/coding/paas/v4', auth: 'key' },
  minimax: { name: 'MiniMax', url: 'https://api.minimaxi.com', auth: 'key' },
  zenmux: { name: 'ZenMux', url: 'https://zenmux.ai/api/v1/management/subscription/detail', auth: 'key' },
  commandcode: { name: 'Command Code', url: 'https://api.commandcode.ai/provider', auth: 'key' },
};
const WINDOWS = ['five_hour', 'weekly_limit', 'monthly'];
const LABELS = ['滚动', '周', '月'];
const numeric = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
function resetTime(value) {
  if (typeof value === 'string') return value;
  if (!(value > 0)) return null;
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}
const tier = (name, utilization, resetsAt = null) => ({ name, utilization, resetsAt });
class QueryError extends Error {
  constructor(message, kind = 'api') { super(message); this.kind = kind; this.code = kind === 'auth' ? 'AUTH_REQUIRED' : 'QUOTA_QUERY_FAILED'; }
}
async function requestJson(url, options = {}, request = (...args) => require('electron').net.fetch(...args)) {
  let response;
  try { response = await request(url, { redirect: 'error', credentials: 'omit', cache: 'no-store', ...options, signal: options.signal || AbortSignal.timeout(15000) }); }
  catch (_) { throw new QueryError('用量接口网络请求失败，请检查网络或代理', 'network'); }
  if (response.status === 401) throw new QueryError('查询凭据已失效，请重新连接', 'auth');
  if (response.status === 403) {
    if (new URL(url).pathname === '/zen/go/v1/usage') throw new QueryError('API Key 有效，但该 Workspace 没有 OpenCode Go 订阅', 'subscription');
    throw new QueryError('查询凭据无效或缺少用量查询权限', 'auth');
  }
  let text;
  try { text = await response.text(); } catch (_) { throw new QueryError('用量接口响应中断，请重试', 'network'); }
  let body;
  try { body = JSON.parse(text); } catch (_) { throw new QueryError('用量接口返回格式不正确（HTTP ' + response.status + '）', 'schema'); }
  const remoteError = body.ResponseMetadata?.Error || body.Error;
  if (remoteError) {
    const code = String(remoteError.Code || 'UnknownError');
    const auth = /signature|accesskey|accessdenied|denied|unauthorized|forbidden|credential|token/i.test(code);
    throw new QueryError(auth ? 'AK/SK 无效或缺少 Ark 用量查询权限（' + code + '）' : '火山接口错误（' + code + '）', auth ? 'auth' : 'api');
  }
  if (!response.ok) throw new QueryError('用量接口请求失败（HTTP ' + response.status + '）');
  return body;
}
function parseCoding(result) {
  const names = { session: 'five_hour', '5h': 'five_hour', fivehour: 'five_hour', five_hour: 'five_hour', rolling_5h: 'five_hour', weekly: 'weekly_limit', week: 'weekly_limit', '7d': 'weekly_limit', monthly: 'monthly', month: 'monthly' };
  return (result.QuotaUsage || result.Usages || result.Details || []).flatMap(item => {
    const name = names[String(item.Level || item.Type || item.Period || item.Label || item.Window).toLowerCase()];
    return name ? [tier(name, numeric(item.Percent ?? item.UsedPercent ?? item.UsagePercent) ?? 0, resetTime(item.ResetTime ?? item.ResetTimestamp))] : [];
  });
}
function parseAgent(result) {
  return ['AFPFiveHour', 'AFPWeekly', 'AFPMonthly'].flatMap((key, i) => {
    const w = result[key];
    return w?.Quota > 0 ? [tier(WINDOWS[i], Number(w.Used || 0) / Number(w.Quota) * 100, resetTime(w.ResetTime))] : [];
  });
}
function signVolcengine(action, config, auth, now = new Date()) {
  const host = 'open.volcengineapi.com', region = config.region || 'cn-beijing';
  const encode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const query = [['Action', action], ['Region', region], ['Version', '2024-01-01']].map(([k, v]) => k + '=' + encode(v)).join('&');
  const xdate = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), date = xdate.slice(0, 8);
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const contentType = 'application/json; charset=utf-8', signedHeaders = 'host;x-date;x-content-sha256;content-type';
  const hash = sha('');
  const canonicalHeaders = `host:${host}\nx-date:${xdate}\nx-content-sha256:${hash}\ncontent-type:${contentType}\n`;
  const canonical = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${hash}`;
  const scope = `${date}/${region}/ark/request`;
  const key = hmac(hmac(hmac(hmac(auth.secretAccessKey, date), region), 'ark'), 'request');
  const signature = hmac(key, `HMAC-SHA256\n${xdate}\n${scope}\n${sha(canonical)}`).toString('hex');
  return { url: `https://${host}/?${query}`, options: { method: 'POST', body: '', headers: {
    'Content-Type': contentType, 'X-Date': xdate, 'X-Content-Sha256': hash,
    Authorization: `HMAC-SHA256 Credential=${auth.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  } } };
}
async function queryVolcengine(kind, config, auth, request) {
  const action = kind === 'agent' ? 'GetAFPUsage' : 'GetCodingPlanUsage';
  const signed = signVolcengine(action, config, auth);
  const body = await requestJson(signed.url, signed.options, request);
  return kind === 'agent' ? parseAgent(body.Result || {}) : parseCoding(body.Result || {});
}
function parseZhipu(data) {
  const slots = {}, rest = [];
  for (const item of data.limits || []) {
    if (!/^(tokens_limit|credit_limit)$/i.test(item.type || '')) continue;
    const name = item.unit === 3 ? 'five_hour' : item.unit === 6 ? 'weekly_limit' : null;
    const entry = tier(name, numeric(item.percentage) ?? 0, item.nextResetTime == null ? null : new Date(item.nextResetTime).toISOString());
    if (name && !slots[name]) slots[name] = entry; else rest.push(entry);
  }
  rest.sort((a, b) => (a.resetsAt ? Date.parse(a.resetsAt) : -Infinity) - (b.resetsAt ? Date.parse(b.resetsAt) : -Infinity));
  for (const entry of rest) { const name = WINDOWS.slice(0, 2).find(n => !slots[n]); if (name) slots[name] = { ...entry, name }; }
  return WINDOWS.flatMap(name => slots[name] ? [slots[name]] : []);
}
async function queryKey(type, config, auth, request) {
  if (!auth.apiKey) throw new QueryError('请先在查询设置中保存套餐 API Key', 'auth');
  const base = config.baseUrl || TYPES[type].url;
  const headers = { Authorization: 'Bearer ' + auth.apiKey, Accept: 'application/json' };
  let body, tiers = [], plan = null;
  const get = (url, extra = {}) => requestJson(url, { headers: { ...headers, ...extra } }, request);
  if (type === 'opencodego') {
    body = await get('https://opencode.ai/zen/go/v1/usage');
    tiers = ['rolling', 'weekly', 'monthly'].flatMap((key, i) => {
      const w = body.usage?.[key], pct = numeric(w?.percent);
      return pct === null ? [] : [tier(WINDOWS[i], pct, pct > 0 ? resetTime(w.resetsAt) : null)];
    });
  } else if (type === 'kimi') {
    body = await get('https://api.kimi.com/coding/v1/usages');
    const count = (w, name) => { const limit = numeric(w.limit) ?? 1, remain = numeric(w.remaining) ?? 0; return tier(name, limit > 0 ? Math.max(0, limit - remain) / limit * 100 : 0, resetTime(w.resetTime)); };
    tiers = (body.limits || []).filter(w => w.detail).map(w => count(w.detail, 'five_hour'));
    if (body.usage) tiers.push(count(body.usage, 'weekly_limit'));
  } else if (type === 'zhipu') {
    body = await get((new URL(base).hostname.endsWith('bigmodel.cn') ? 'https://open.bigmodel.cn' : 'https://api.z.ai') + '/api/monitor/usage/quota/limit', { Authorization: auth.apiKey, 'Accept-Language': 'en-US,en' });
    if (body.success === false) throw new QueryError('智谱用量接口返回业务错误');
    if (!body.data) throw new QueryError('智谱用量接口缺少额度数据', 'schema');
    tiers = parseZhipu(body.data); plan = body.data.level;
  } else if (type === 'minimax') {
    const host = new URL(base).hostname === 'api.minimax.io' ? 'api.minimax.io' : 'api.minimaxi.com';
    body = await get(`https://${host}/v1/api/openplatform/coding_plan/remains`);
    if (body.base_resp && body.base_resp.status_code !== 0) throw new QueryError('MiniMax 用量接口返回业务错误（' + body.base_resp.status_code + '）');
    const w = body.model_remains?.find(item => item.model_name === 'general');
    if (typeof w?.current_interval_remaining_percent === 'number') tiers.push(tier('five_hour', 100 - w.current_interval_remaining_percent, w.end_time == null ? null : new Date(w.end_time).toISOString()));
    if (w?.current_weekly_status === 1 && typeof w.current_weekly_remaining_percent === 'number') tiers.push(tier('weekly_limit', 100 - w.current_weekly_remaining_percent, w.weekly_end_time == null ? null : new Date(w.weekly_end_time).toISOString()));
  } else if (type === 'zenmux') {
    const url = new URL(base);
    if (url.protocol !== 'https:' || !['zenmux.ai', 'zenmux.com'].includes(url.hostname)) throw new QueryError('请输入 ZenMux 官方用量接口地址');
    body = await get(url.href);
    if (body.success !== true || !body.data) throw new QueryError('ZenMux 用量接口返回业务错误');
    tiers = ['quota_5_hour', 'quota_7_day'].flatMap((key, i) => { const w = body.data[key]; return w ? [{ ...tier(WINDOWS[i], (numeric(w.usage_percentage) ?? 0) * 100, resetTime(w.resets_at)), usedValueUsd: numeric(w.used_value_usd), maxValueUsd: numeric(w.max_value_usd) }] : []; });
    plan = body.data.plan?.tier;
  } else if (type === 'commandcode') {
    const url = (route, params = {}) => 'https://api.commandcode.ai' + route + '?' + new URLSearchParams(params);
    const who = await get(url('/alpha/whoami', { limits: '1' }));
    const params = who.org?.id ? { orgId: who.org.id } : {};
    const credits = await get(url('/alpha/billing/credits', params));
    const subscription = await get(url('/alpha/billing/subscriptions', params));
    const since = subscription.data?.currentPeriodStart;
    const summary = await get(url('/alpha/usage/summary', { ...params, ...(since ? { since } : {}) }));
    if (!credits.credits || numeric(summary.totalCost) === null) throw new QueryError('Command Code 用量接口缺少账单数据', 'schema');
    const w = credits.windowLimits || credits.credits.windowLimits;
    if (w?.limited) for (const [key, name] of [['fiveHour', 'five_hour'], ['weekly', 'weekly_limit']]) { const win = w[key]; if (win?.cap > 0 && numeric(win.used) !== null) tiers.push(tier(name, Number(win.used) / Number(win.cap) * 100, resetTime(win.resetAt))); }
    const remaining = ['monthlyCredits', 'purchasedCredits', 'freeCredits'].reduce((sum, k) => sum + Math.max(0, numeric(credits.credits[k]) ?? 0), 0);
    const spent = Math.max(0, numeric(summary.totalCost));
    tiers.push(tier('monthly', spent + remaining > 0 ? spent / (spent + remaining) * 100 : 0, resetTime(subscription.data?.currentPeriodEnd)));
    plan = subscription.data?.planId || credits.credits.planId;
  }
  if (!tiers.length) throw new QueryError('接口没有返回可识别的套餐额度', 'schema');
  return { tiers, plan };
}
function toMonitor(tiers, { kind, url, source = SOURCE, now = Date.now() } = {}) {
  const names = kind === 'agent' ? ['Agent-近5小时', 'Agent-近一周', 'Agent-近一月'] : kind === 'coding' ? ['当前会话', '近1周', '近1月'] : LABELS;
  return { plans: tiers.map(t => ({ name: names[WINDOWS.indexOf(t.name)], percentage: t.utilization, period: t.name, resetsAt: t.resetsAt, usedValueUsd: t.usedValueUsd, maxValueUsd: t.maxValueUsd })),
    countdowns: WINDOWS.map(name => { const at = Date.parse(tiers.find(t => t.name === name)?.resetsAt); return Number.isFinite(at) ? Math.max(0, at - now) : null; }), url, source, _fetchTime: now };
}
module.exports = { SOURCE, TYPES, WINDOWS, QueryError, requestJson, resetTime, parseCoding, parseAgent, signVolcengine, queryVolcengine, queryKey, toMonitor };
