const BaseProvider = require('./BaseProvider');
const { QueryError } = require('./coding-plan-api');
const { SOURCE, xfyunWeb } = require('./coding-plan-web');
class XfyunProvider extends BaseProvider {
  id = 'xfyun'; name = '讯飞星火'; icon = 'coding'; authType = 'session'; skipAutoLogin = true; queryApiAuth = true;
  consoleUrl = 'https://maas.xfyun.cn/packageSubscription'; loginUrl = this.consoleUrl;
  catalogStatus = 'unknown'; availablePlans = []; source = SOURCE; lastError = null;
  isDirectAuth() { return false; }
  hydrateCatalog(data) { if (data?.plans) { this.availablePlans = data.plans.map(p => ({ name: p.name, status: p.status, dateRange: p.dateRange })); this.catalogStatus = 'cached'; } }
  async checkAuth() {
    try { const data = await this.fetchData(); this.status = 'connected'; return { status: 'connected', data }; }
    catch (error) { this.lastError = error.message; this.status = error.kind === 'auth' ? 'unauthorized' : 'error'; return { status: this.status, error: error.message }; }
  }
  async fetchData() {
    this.catalogStatus = 'checking';
    try {
      const rows = await xfyunWeb(this.id), now = Date.now(), usedNames = new Map();
      const plans = rows.filter(row => row.status === 1).map(row => {
        const base = row.name?.match(/[\u4e00-\u9fa5]+版/)?.[0] || row.name || '默认';
        const index = usedNames.get(base) || 0; usedNames.set(base, index + 1);
        const name = '讯飞星火 ' + base + (index ? '_' + index : '');
        const dto = row.codingPlanUsageDTO || {}, periods = [];
        const count = (label, limit, used, left) => {
          if (limit == null) return;
          if (used == null && left != null && limit > 0) used = limit - left;
          if (used == null) { periods.push({ label, usage: [], unknown: true }); return; }
          periods.push({ label, usage: [{ used: String(used), total: limit < 0 ? '∞' : String(limit) }] });
        };
        count('5小时', dto.rp5hLimit, dto.rp5hUsage); count('周', dto.rpwLimit, dto.rpwUsage); count('总', dto.packageLimit, dto.packageUsage, dto.packageLeft);
        return { name, periods, dateRange: { start: row.validFrom, end: row.expiresAt }, status: 'active' };
      });
      this.availablePlans = plans.map(p => ({ name: p.name, status: p.status, dateRange: p.dateRange }));
      this.catalogStatus = plans.length ? 'ready' : 'empty'; this.status = 'connected'; this.lastError = null;
      return { plans, countdowns: [], source: SOURCE, url: this.consoleUrl, _fetchTime: now, expiredPackageCount: rows.filter(r => r.status !== 1).length };
    } catch (error) { this.catalogStatus = 'error'; this.lastError = error.message; if (error.kind === 'auth') this.status = 'unauthorized'; throw error; }
  }
  async fetchChannel(key) {
    const data = await this.fetchData(), name = key.slice(key.indexOf(':') + 1);
    const plans = data.plans.filter(p => p.name === '讯飞星火 ' + name);
    if (!plans.length) throw new QueryError('该讯飞套餐已失效或不存在', 'subscription');
    return { ...data, plans, channelOffset: 0 };
  }
}
module.exports = XfyunProvider;
