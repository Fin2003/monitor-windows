// CC Switch request/extractor contract, executed in QuickJS without Node or browser globals.
const { getQuickJS } = require('quickjs-emscripten');
const { QueryError, requestJson } = require('./coding-plan-api');

const TEMPLATES = {
  general: `({ request: { url: "{{baseUrl}}/user/balance", method: "GET", headers: { Authorization: "Bearer {{apiKey}}" } }, extractor: function(response) { return { remaining: response.balance, unit: "USD", isValid: response.is_active !== false }; } })`,
  newapi: `({ request: { url: "{{baseUrl}}/api/user/self", method: "GET", headers: { Authorization: "Bearer {{accessToken}}", "New-Api-User": "{{userId}}" } }, extractor: function(response) { if (!response.success || !response.data) return { isValid: false }; return { planName: response.data.group || "账户额度", remaining: response.data.quota / 500000, used: response.data.used_quota / 500000, total: (response.data.quota + response.data.used_quota) / 500000, unit: "USD" }; } })`
};

function evaluate(vm, expression) {
  const result = vm.evalCode(expression);
  if (result.error) { result.error.dispose(); throw new QueryError('查询脚本执行失败，请检查 request / extractor', 'script'); }
  try { return JSON.parse(vm.dump(result.value)); } finally { result.value.dispose(); }
}

async function queryScript(config, auth, request) {
  const script = config.template === 'custom' ? auth.script : TEMPLATES[config.template || 'general'];
  if (!script) throw new QueryError('请填写 CC Switch 格式的查询脚本', 'script');
  const vars = { baseUrl: (config.baseUrl || '').replace(/\/$/, ''), apiKey: auth.apiKey || '', accessToken: auth.accessToken || '', userId: auth.userId || '' };
  const resolved = script.replace(/\{\{(baseUrl|apiKey|accessToken|userId)\}\}/g, (_, key) => JSON.stringify(vars[key]).slice(1, -1));
  const runtime = (await getQuickJS()).newRuntime();
  const deadline = Date.now() + 3000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  runtime.setMemoryLimit(16 * 1024 * 1024);
  const vm = runtime.newContext();
  try {
    const spec = evaluate(vm, `const config = (${resolved}); JSON.stringify(config.request)`);
    const url = new URL(spec.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new QueryError('查询地址必须是 HTTP 或 HTTPS');
    if (config.template !== 'custom' && url.origin !== new URL(config.baseUrl).origin) throw new QueryError('模板请求必须使用所填 API 地址');
    const response = await requestJson(url.href, { method: spec.method || 'GET', headers: spec.headers || {}, ...(spec.body != null ? { body: typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body) } : {}) }, request);
    const extractionDeadline = Date.now() + 3000;
    runtime.setInterruptHandler(() => Date.now() > extractionDeadline);
    const value = evaluate(vm, `JSON.stringify(config.extractor(${JSON.stringify(response)}))`);
    const items = Array.isArray(value) ? value : [value];
    if (items.some(item => item.isValid === false && item.remaining == null && item.used == null)) throw new QueryError('接口查询失败，请检查凭据和脚本字段');
    return items;
  } finally { vm.dispose(); runtime.dispose(); }
}
module.exports = { TEMPLATES, queryScript };
