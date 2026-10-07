// GitHub device-code authentication, matching CC Switch's Copilot client IDs (MIT).
const { requestJson, QueryError } = require('./coding-plan-api');
const pending = new Map();
async function begin(provider) {
  const domain = provider.config.githubDomain || 'github.com';
  const clientId = domain === 'github.com' ? 'Iv1.b507a08c87ecfe98' : 'Ov23li8tweQw6odWQebz';
  const result = await requestJson('https://' + domain + '/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: 'read:user' }).toString() }, provider.request);
  if (!result.device_code) throw new QueryError('GitHub 没有返回设备登录码');
  pending.set(provider.id, { deviceCode: result.device_code, clientId, domain, expiresAt: Date.now() + result.expires_in * 1000, interval: result.interval || 5 });
  return { userCode: result.user_code, verificationUri: result.verification_uri, interval: result.interval || 5 };
}
async function poll(provider) {
  const state = pending.get(provider.id);
  if (!state || state.expiresAt <= Date.now()) { pending.delete(provider.id); throw new QueryError('GitHub 登录码已过期，请重新开始', 'auth'); }
  const result = await requestJson('https://' + state.domain + '/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: state.clientId, device_code: state.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString() }, provider.request);
  if (result.error === 'authorization_pending') return { pending: true, interval: state.interval };
  if (result.error === 'slow_down') { state.interval += 5; return { pending: true, interval: state.interval }; }
  pending.delete(provider.id);
  if (!result.access_token) throw new QueryError('GitHub 设备登录未完成，请重新授权', 'auth');
  provider.authStore.write(provider.id, { apiKey: result.access_token });
  return { success: true };
}
module.exports = { begin, poll };
