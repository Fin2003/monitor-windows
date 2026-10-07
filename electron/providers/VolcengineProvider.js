const ApiProvider = require('./CodingPlanApiProvider');
const { QueryError, parseCoding, parseAgent, queryVolcengine, toMonitor } = require('./coding-plan-api');
const { volcanoWeb } = require('./coding-plan-web');
class VolcengineProvider extends ApiProvider {
  constructor(options) {
    super('volcengine', options); this.queryApiAuth = true;
    this.authType = 'api-or-session'; this.consoleUrl = 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan';
    this.loginUrl = this.consoleUrl; this.planStatus = { coding: 'unknown', agent: 'unknown' };
  }
  isDirectAuth() { if (this.config.mode === 'web') return false; const a = this.authStore.read(this.id); return this.config.mode === 'api' || !!(a.accessKeyId && a.secretAccessKey); }
  hydrateCatalog(data) {
    if (data?.plans?.length) this.planStatus = { coding: data.plans.some(p => !p.name.startsWith('Agent-')) ? 'active' : 'unknown', agent: data.plans.some(p => p.name.startsWith('Agent-')) ? 'active' : 'unknown' };
  }
  async query(kind) {
    let tiers;
    try {
      if (this.isDirectAuth()) {
        const auth = this.authStore.read(this.id);
        if (!auth.accessKeyId || !auth.secretAccessKey) throw new QueryError('请保存账号级 AccessKey ID 和 Secret Access Key；模型推理 Key 无法查询额度', 'auth');
        tiers = await queryVolcengine(kind, this.config, auth, this.request);
      } else {
        const body = await volcanoWeb(this.id, kind, this.config);
        tiers = kind === 'agent' ? parseAgent(body.Result || {}) : parseCoding(body.Result || {});
      }
      this.planStatus[kind] = tiers.length ? 'active' : 'unavailable';
      return { ...toMonitor(tiers, { kind, url: this.consoleUrl }), channelOffset: kind === 'agent' ? 3 : 0 };
    } catch (error) { this.planStatus[kind] = 'error'; this.lastError = error.message; if (error.kind === 'auth') this.status = 'unauthorized'; throw error; }
  }
  async fetchData() {
    const results = await Promise.allSettled([this.query('coding'), this.query('agent')]);
    const authError = results.find(r => r.status === 'rejected' && r.reason.kind === 'auth');
    if (authError) throw authError.reason;
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!ok.length) throw results[0].reason;
    this.status = 'connected'; this.lastError = results.find(r => r.status === 'rejected')?.reason.message || null;
    return { plans: ok.flatMap(r => r.plans), countdowns: [...(results[0].value?.countdowns || [null, null, null]), ...(results[1].value?.countdowns || [null, null, null])], url: this.consoleUrl, source: this.source, _fetchTime: Date.now() };
  }
  async fetchChannel(key) { return this.query(key.endsWith(':agent') ? 'agent' : 'coding'); }
}
module.exports = VolcengineProvider;
