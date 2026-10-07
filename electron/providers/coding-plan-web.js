// Web-session endpoints and OpenCode response parsing adapted from QuotaRadar, MIT.
// https://github.com/Asklear/QuotaRadar/tree/d8d020b0dd4055c5c3defc8dc7b404fc9a132fbc/apps/desktop-tauri/src-tauri/src/providers
const { requestJson, QueryError, WINDOWS } = require('./coding-plan-api');
const SOURCE = { name: 'QuotaRadar', revision: 'd8d020b0dd4055c5c3defc8dc7b404fc9a132fbc', url: 'https://github.com/Asklear/QuotaRadar', license: 'MIT' };
function accountSession(id) { return require('electron').session.fromPartition('persist:' + id); }
async function volcanoWeb(id, kind, config = {}) {
  const session = accountSession(id), cookies = await session.cookies.get({ url: 'https://console.volcengine.com' });
  const csrf = cookies.find(c => c.name === 'csrfToken')?.value;
  const action = kind === 'agent' ? 'GetAFPUsage' : 'GetCodingPlanUsage';
  try { return await requestJson(`https://console.volcengine.com/api/top/ark/${config.region || 'cn-beijing'}/2024-01-01/${action}?`, {
    method: 'POST', credentials: 'include', body: JSON.stringify({ ProjectName: config.projectName || 'default' }),
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), Referer: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan' },
  }, (url, options) => session.fetch(url, options)); }
  catch (error) { if (error.kind === 'auth') throw new QueryError('火山网页登录会话已失效，请重新连接', 'auth'); throw error; }
}
async function xfyunWeb(id) {
  const session = accountSession(id);
  const body = await requestJson('https://maas.xfyun.cn/api/v1/gpt-finetune/coding-plan/list?page=1&size=100', {
    credentials: 'include', headers: { Referer: 'https://maas.xfyun.cn/packageSubscription' },
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
