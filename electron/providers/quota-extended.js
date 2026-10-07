// JavaScript adaptations of CC Switch subscription.rs, balance.rs and coding_plan.rs (MIT).
const { requestJson, QueryError, resetTime, parseZhipu, TYPES } = require('./coding-plan-api');
const { readAccountAuth } = require('./quota-auth');
const { queryScript } = require('./quota-script');
const { queryGrok } = require('./quota-grok');
const CLIENTS = require('./quota-oauth-clients.json');
const SOURCE = { name: 'CC Switch', revision: 'f9db9f7056cbe7f972cdc02644722002316866b9', url: 'https://github.com/farion1231/cc-switch', license: 'MIT' };
const number = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const labels = { five_hour: '5小时', seven_day: '7天', weekly_limit: '周', monthly: '月', thirty_day: '30天', seven_day_opus: 'Opus 周', seven_day_sonnet: 'Sonnet 周', seven_day_fable: 'Fable 周', seven_day_oauth_apps: 'OAuth Apps 周', seven_day_cowork: 'Cowork 周' };
const tier = (name, utilization, resetsAt, label = labels[name] || name) => ({ name, label, utilization, resetsAt: resetTime(resetsAt) });

async function queryExtended(provider) {
  let auth = readAccountAuth(provider);
  const { type, config, request } = provider;
  if (type === 'custom') return { usage: await queryScript(config, auth, request), source: SOURCE };
  if (type === 'newapi') {
    const base = (config.baseUrl || '').replace(/\/$/, '');
    if (!base) throw new QueryError('请填写平台 API 地址');
    const scale = Number(config.quotaScale) || 500000;
    if (config.newApiMode === 'key') {
      if (!auth.apiKey) throw new QueryError('请填写此平台的 API Key', 'auth');
      const body = await requestJson(base + '/api/usage/token', { headers: { Authorization: 'Bearer ' + auth.apiKey } }, request);
      if (body.success === false || body.code === false || (typeof body.code === 'number' && body.code !== 0)) throw new QueryError('API Key 额度接口返回业务错误');
      const data = body.data || body;
      const convert = value => number(value) === null ? null : Number(value) / scale;
      return { usage: [{ planName: data.name || 'API Key 额度', remaining: convert(data.total_available), used: convert(data.total_used), total: convert(data.total_granted), unit: config.unit || 'USD', unlimited: data.unlimited_quota === true }], source: SOURCE };
    }
    if (!auth.accessToken || !auth.userId) throw new QueryError('账户额度查询需要 Access Token 和 User ID', 'auth');
    const body = await requestJson(base + '/api/user/self', { headers: { Authorization: 'Bearer ' + auth.accessToken, 'New-Api-User': auth.userId } }, request);
    if (!body.success || !body.data) throw new QueryError('账户额度查询失败，请检查 Access Token 和 User ID');
    return { usage: [{ planName: body.data.group || '账户额度', remaining: number(body.data.quota) / scale, used: number(body.data.used_quota) / scale, total: (number(body.data.quota) + number(body.data.used_quota)) / scale, unit: config.unit || 'USD' }], source: SOURCE };
  }
  const oauth = ['claude', 'codex', 'gemini', 'grok'].includes(type);
  if (oauth && !auth.accessToken) throw new QueryError('请导入此账号的 CLI 登录文件或填写 OAuth Access Token', 'auth');
  if (!oauth && !auth.apiKey) throw new QueryError(type === 'copilot' ? '请使用 GitHub 设备码登录或填写 Copilot 账号的 GitHub Token' : '请保存此渠道的 API Key', 'auth');

  const refreshGemini = async () => {
    const body = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...CLIENTS.gemini, refresh_token: auth.refreshToken, grant_type: 'refresh_token' }).toString() }, request);
    if (!body.access_token) throw new QueryError('Gemini 登录需要重新授权', 'auth');
    auth = { ...auth, accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000, refreshToken: body.refresh_token || auth.refreshToken };
    provider.authStore.write(provider.id, auth);
  };
  if (type === 'gemini' && auth.refreshToken && (!auth.expiresAt || Number(auth.expiresAt) <= Date.now() + 60000)) await refreshGemini();
  const get = (url, headers = {}) => requestJson(url, { headers: { Authorization: 'Bearer ' + (oauth ? auth.accessToken : auth.apiKey), Accept: 'application/json', ...headers } }, request);
  const post = (url, body) => requestJson(url, { method: 'POST', headers: { Authorization: 'Bearer ' + auth.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, request);
  let result;
  if (type === 'claude') {
    const body = await get(TYPES.claude.url, { 'anthropic-beta': 'oauth-2025-04-20' });
    const tiers = Object.entries(body).filter(([key, value]) => key !== 'extra_usage' && number(value?.utilization) !== null)
      .map(([name, value]) => tier(name, Number(value.utilization), value.resets_at));
    for (const limit of body.limits || []) {
      if (limit.kind !== 'weekly_scoped' || limit.group !== 'weekly' || limit.scope?.surface != null || number(limit.percent) === null) continue;
      const model = limit.scope?.model?.display_name;
      if (!model) continue;
      const name = 'seven_day_' + model.trim().toLowerCase();
      const item = tier(name, Number(limit.percent), limit.resets_at, model + ' 周');
      const index = tiers.findIndex(value => value.name === name);
      if (index >= 0) tiers[index] = item; else tiers.push(item);
    }
    const extra = body.extra_usage;
    const usage = extra?.is_enabled ? [{ planName: '额外用量', used: number(extra.used_credits), total: number(extra.monthly_limit), unit: extra.currency || 'credits' }] : [];
    result = { tiers, usage };
  } else if (type === 'codex') {
    const body = await get(TYPES.codex.url, { 'User-Agent': 'codex-cli', ...(auth.accountId ? { 'ChatGPT-Account-Id': auth.accountId } : {}) });
    const tiers = [];
    const windows = (limits, prefix = '') => {
      for (const value of [limits?.primary_window, limits?.secondary_window]) {
        if (number(value?.used_percent) === null) continue;
        const secs = value.limit_window_seconds;
        const name = secs === 18000 ? 'five_hour' : secs === 604800 ? 'seven_day' : secs === 2592000 ? 'thirty_day' : 'window_' + secs;
        tiers.push(tier(prefix + name, Number(value.used_percent), value.reset_at, prefix + (labels[name] || (secs ? Math.round(secs / 3600) + '小时' : '配额'))));
      }
    };
    windows(body.rate_limit);
    windows(body.code_review_rate_limit, 'Review ');
    for (const limit of body.additional_rate_limits || []) windows(limit.rate_limit, (limit.limit_name || limit.metered_feature || '模型') + ' ');
    const usage = body.credits?.has_credits && !body.credits.unlimited && number(body.credits.balance) !== null
      ? [{ planName: '额外 credits', remaining: Number(body.credits.balance), unit: 'credits' }] : [];
    result = { tiers, usage, plan: body.plan_type };
  } else if (type === 'gemini') {
    const loaded = await post('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } });
    const project = typeof loaded.cloudaicompanionProject === 'string' ? loaded.cloudaicompanionProject : loaded.cloudaicompanionProject?.id;
    const body = await post(TYPES.gemini.url, project ? { project } : {});
    const groups = new Map();
    for (const bucket of body.buckets || []) {
      if (number(bucket.remainingFraction) === null) continue;
      const id = bucket.modelId || 'unknown';
      const label = /flash.?lite/i.test(id) ? 'Flash Lite' : /flash/i.test(id) ? 'Flash' : /pro/i.test(id) ? 'Pro' : id;
      const prev = groups.get(label);
      if (!prev || bucket.remainingFraction < prev.remainingFraction) groups.set(label, bucket);
    }
    result = { tiers: [...groups].map(([label, bucket]) => tier('gemini_' + label, (1 - Number(bucket.remainingFraction)) * 100, bucket.resetTime, label)), plan: loaded.currentTier?.name || loaded.currentTier?.id };
  } else if (type === 'grok') result = await queryGrok(auth.accessToken, request);
  else if (type === 'copilot') {
    const domain = config.githubDomain || 'github.com';
    const endpoint = domain === 'github.com' ? TYPES.copilot.url : 'https://' + domain + '/api/v3/copilot_internal/user';
    const body = await get(endpoint, { Authorization: 'token ' + auth.apiKey, 'editor-version': 'vscode/1.104.1', 'editor-plugin-version': 'copilot-chat/0.31.1', 'User-Agent': 'GitHubCopilotChat/0.31.1' });
    const tiers = Object.entries(body.quota_snapshots || {}).map(([name, value]) => ({ ...tier(name, value.unlimited ? null : number(value.percent_remaining) !== null ? 100 - Number(value.percent_remaining) : Number(value.entitlement) > 0 ? (Number(value.entitlement) - Number(value.remaining)) / Number(value.entitlement) * 100 : null, body.quota_reset_date, { premium_interactions: 'Premium', chat: 'Chat', completions: 'Completions' }[name] || name), used: value.unlimited ? null : number(value.entitlement) - number(value.remaining), remaining: number(value.remaining), total: number(value.entitlement), unit: '次', unlimited: value.unlimited }));
    result = { tiers, plan: body.copilot_plan };
  } else if (type === 'zhiputeam') {
    if (!auth.organizationId || !auth.projectId) throw new QueryError('智谱团队版还需要组织 ID 和项目 ID', 'auth');
    const body = await get(TYPES.zhiputeam.url, { Authorization: auth.apiKey, 'bigmodel-organization': auth.organizationId, 'bigmodel-project': auth.projectId, 'Accept-Language': 'en-US,en' });
    if (body.success === false || !body.data) throw new QueryError('智谱团队接口没有返回有效额度');
    result = { tiers: parseZhipu(body.data), plan: body.data.level };
  } else if (type === 'deepseek') {
    const body = await get(TYPES.deepseek.url);
    result = { usage: (body.balance_infos || []).map(info => ({ planName: info.currency || 'CNY', remaining: number(info.total_balance), unit: info.currency || 'CNY', isValid: body.is_available })) };
  } else if (type === 'stepfun') {
    const body = await get(TYPES.stepfun.url);
    result = { usage: [{ planName: '账户余额', remaining: number(body.balance), unit: 'CNY' }] };
  } else if (type === 'siliconflow') {
    const international = new URL(config.baseUrl || TYPES.siliconflow.url).hostname === 'api.siliconflow.com';
    const body = await get('https://' + (international ? 'api.siliconflow.com' : 'api.siliconflow.cn') + '/v1/user/info');
    if (!body.data) throw new QueryError('硅基流动接口没有返回余额');
    result = { usage: [{ planName: '账户余额', remaining: number(body.data.totalBalance), unit: international ? 'USD' : 'CNY' }] };
  } else if (type === 'openrouter') {
    const body = await get(TYPES.openrouter.url), data = body.data || {};
    result = { usage: [{ planName: '账户额度', total: number(data.total_credits), used: number(data.total_usage), remaining: number(data.total_credits) !== null && number(data.total_usage) !== null ? Number(data.total_credits) - Number(data.total_usage) : null, unit: 'USD' }] };
  } else if (type === 'novita') {
    const body = await get(TYPES.novita.url);
    result = { usage: [{ planName: '账户余额', remaining: number(body.availableBalance) === null ? null : Number(body.availableBalance) / 10000, unit: 'USD' }] };
  }
  if (!result || (!(result.tiers?.length) && !(result.usage?.some(item => number(item.remaining) !== null || number(item.used) !== null)))) throw new QueryError('接口没有返回可识别的额度或余额', 'schema');
  return { ...result, source: SOURCE };
}

function toQuotaMonitor(result, url, now = Date.now()) {
  const plans = (result.tiers || []).map(item => ({ name: item.label || labels[item.name] || item.name, period: item.name, percentage: item.utilization, resetsAt: item.resetsAt, used: item.used, remaining: item.remaining, total: item.total, unit: item.unit, unlimited: item.unlimited }));
  for (const item of result.usage || []) {
    const used = number(item.used), remaining = number(item.remaining), total = number(item.total) ?? (used !== null && remaining !== null ? used + remaining : null);
    if (remaining === null && used === null && total === null && !item.unlimited) throw new QueryError('查询结果缺少 remaining / used / total 字段', 'schema');
    plans.push({ name: item.planName || '余额', period: 'balance_' + plans.length, percentage: !item.unlimited && total > 0 && used !== null ? used / total * 100 : null, used, remaining, total, unit: item.unit || '', unlimited: !!item.unlimited, isValid: item.isValid, resetsAt: resetTime(item.resetsAt), balanceOnly: used === null && total === null });
  }
  return { plans, planName: result.plan, dynamicQuota: true, countdowns: plans.map(item => { const at = Date.parse(item.resetsAt); return Number.isFinite(at) ? Math.max(0, at - now) : null; }), source: result.source || SOURCE, url, _fetchTime: now };
}
module.exports = { SOURCE, queryExtended, toQuotaMonitor };
