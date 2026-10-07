const BaseProvider = require('./BaseProvider');
const AuthStore = require('./CodingPlanAuthStore');
const { SOURCE, TYPES, QueryError, queryKey, toMonitor } = require('./coding-plan-api');
class CodingPlanApiProvider extends BaseProvider {
  constructor(type, { authStore = new AuthStore(), request } = {}) {
    super(); this.type = type; this.id = type; this.name = TYPES[type].name;
    this.icon = 'coding'; this.authType = 'api'; this.skipAutoLogin = true;
    this.authStore = authStore; this.request = request || ((...args) => require('electron').session.fromPartition('persist:' + this.id).fetch(...args)); this.source = SOURCE; this.config = {}; this.queryApiAuth = true;
    this.consoleUrl = TYPES[type].url; this.loginUrl = this.consoleUrl; this.lastError = null;
  }
  setConfig(config) { this.config = config || {}; }
  isDirectAuth() { return true; }
  async checkAuth(scraper) {
    try { const data = await this.fetchData(scraper); this.status = 'connected'; return { status: this.status, data }; }
    catch (error) { this.lastError = error.message; this.status = error.kind === 'auth' ? 'unauthorized' : 'error'; return { status: this.status, error: error.message }; }
  }
  async fetchData() {
    try {
      const data = await queryKey(this.type, this.config, this.authStore.read(this.id), this.request);
      this.lastError = null; this.status = 'connected';
      return { ...toMonitor(data.tiers, { url: this.consoleUrl }), planName: data.plan };
    } catch (error) { this.lastError = error.message; if (error.kind === 'auth') this.status = 'unauthorized'; throw error; }
  }
  async fetchChannel() { return { ...await this.fetchData(), channelOffset: 0 }; }
}
module.exports = CodingPlanApiProvider;
