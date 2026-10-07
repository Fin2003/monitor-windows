const ApiProvider = require('./CodingPlanApiProvider');
const { toMonitor } = require('./coding-plan-api');
const { SOURCE, parseOpenCodeResponse } = require('./coding-plan-web');
class OpencodeGoProvider extends ApiProvider {
  constructor(options) { super('opencodego', options); this.queryApiAuth = true; this.authType = 'api-or-session'; this.consoleUrl = 'https://opencode.ai/go'; this.loginUrl = this.consoleUrl; }
  setWorkspaceUrl(url) {
    const value = String(url || '').trim();
    if (value && new URL(value).origin !== 'https://opencode.ai') throw new Error('Workspace 地址必须属于 opencode.ai');
    this.consoleUrl = value || 'https://opencode.ai/go'; this.loginUrl = this.consoleUrl;
  }
  isDirectAuth() { if (this.config.mode === 'web') return false; return this.config.mode === 'api' || !!this.authStore.read(this.id).apiKey; }
  async fetchData(scraper) {
    if (this.isDirectAuth()) return super.fetchData(scraper);
    try {
      const tiers = await scraper.readApiResponse(this.consoleUrl, url => new URL(url).origin === 'https://opencode.ai' && new URL(url).pathname === '/_server', parseOpenCodeResponse);
      this.status = 'connected'; this.lastError = null;
      return toMonitor(tiers, { url: this.consoleUrl, source: SOURCE });
    } catch (error) { this.lastError = error.message; this.status = error.kind === 'auth' ? 'unauthorized' : 'error'; throw error; }
  }
  async fetchChannel(_key, scraper) { return { ...await this.fetchData(scraper), channelOffset: 0 }; }
}
module.exports = OpencodeGoProvider;
