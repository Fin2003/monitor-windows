// Web-session endpoints and OpenCode response parsing adapted from QuotaRadar, MIT.
// https://github.com/Asklear/QuotaRadar/tree/d8d020b0dd4055c5c3defc8dc7b404fc9a132fbc/apps/desktop-tauri/src-tauri/src/providers
const { requestJson, QueryError, WINDOWS } = require('./coding-plan-api');
const SOURCE = { name: 'QuotaRadar', revision: 'd8d020b0dd4055c5c3defc8dc7b404fc9a132fbc', url: 'https://github.com/Asklear/QuotaRadar', license: 'MIT' };
function accountSession(id) { return require('electron').session.fromPartition('persist:' + id); }
async function sessionHeaders(session, url) {
  // QuotaRadar sends the cookie header and its matching CSRF value together.
  // Chromium can retain same-name cookies after a login; choose one value per name.
  const values = new Map((await session.cookies.get({ url })).map(cookie => [cookie.name, cookie.value]));
  return { Cookie: [...values].map(([name, value]) => name + '=' + value).join('; '),
    ...(values.has('csrfToken') ? { 'x-csrf-token': values.get('csrfToken') } : {}) };
}
async function volcanoWeb(id, kind, config = {}) {
  const session = accountSession(id);
  const action = kind === 'agent' ? 'GetAFPUsage' : 'GetCodingPlanUsage';
  const url = `https://console.volcengine.com/api/top/ark/${config.region || 'cn-beijing'}/2024-01-01/${action}?`;
  try { return await requestJson(url, {
    method: 'POST', credentials: 'omit', body: JSON.stringify({ ProjectName: config.projectName || 'default' }),
    headers: { 'Content-Type': 'application/json', ...await sessionHeaders(session, url), Origin: 'https://console.volcengine.com', Referer: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan' },
  }, (url, options) => session.fetch(url, options)); }
  catch (error) { if (error.kind === 'auth') throw new QueryError('火山网页登录会话已失效，请重新连接', 'auth'); throw error; }
}
async function xfyunWeb(id) {
  const session = accountSession(id);
  const url = 'https://maas.xfyun.cn/api/v1/gpt-finetune/coding-plan/list?page=1&size=100';
  const body = await requestJson(url, {
    credentials: 'omit', headers: { ...await sessionHeaders(session, url), Referer: 'https://maas.xfyun.cn/packageSubscription' },
  }, (url, options) => session.fetch(url, options));
  if (body.succeed === false || body.failed === true || body.code !== 0) throw new QueryError('讯飞登录会话已失效，请重新登录', 'auth');
  const data = body.data || body;
  if (!Array.isArray(data.rows)) throw new QueryError('讯飞套餐接口返回格式已变化', 'schema');
  return data.rows;
}
function parseOpenCodeResponse(text, now = Date.now()) {
  const tiers = [];
  for (const [i, field] of ['rollingUsage', 'weeklyUsage', 'monthlyUsage'].entries()) {
    const start = text.indexOf(field); if (start < 0) continue;
    const open = text.indexOf('{', start); if (open < 0) continue;
    let depth = 1, end = open + 1;
    for (; end < text.length && depth; end++) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; }
    const block = text.slice(open + 1, end - 1);
    const pct = block.match(/usagePercent\s*:\s*([-+\d.]+)/)?.[1];
    const sec = block.match(/resetInSec\s*:\s*([-+\d.]+)/)?.[1];
    if (pct === undefined) continue;
    tiers.push({ name: WINDOWS[i], utilization: Number(pct), resetsAt: Number(pct) > 0 && sec !== undefined ? new Date(now + Number(sec) * 1000).toISOString() : null });
  }
  return tiers.length === 3 ? tiers : null;
}
module.exports = { SOURCE, accountSession, volcanoWeb, xfyunWeb, parseOpenCodeResponse };
