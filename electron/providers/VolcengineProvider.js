const BaseProvider = require('./BaseProvider');
const { readLoginState } = require('./volcengine-auth');
const { readUsage } = require('./volcengine-usage');

class VolcengineProvider extends BaseProvider {
  id = 'volcengine';
  name = '火山方舟';
  icon = 'coding';
  authType = 'cookie';
  status = 'unauthorized';
  loginUrl = 'https://console.volcengine.com/login';
  consoleUrl = 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan';
  agentUrl = 'https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan';
  lastError = null;
  planStatus = { coding: 'unknown', agent: 'unknown' };
  readLoginState = readLoginState;

  hydrateCatalog(data) {
    if (!data?.plans?.length) return;
    const hasCoding = data.plans.some(plan => !plan.name.startsWith('Agent-'));
    const hasAgent = data.plans.some(plan => plan.name.startsWith('Agent-'));
    this.planStatus = {
      coding: hasCoding ? 'active' : 'unavailable',
      agent: hasAgent ? 'active' : 'unavailable',
    };
  }

  #restoreKnownPlanStatus(key, previousStatus) {
    if (this.planStatus[key] !== 'checking') return;
    this.planStatus[key] = previousStatus === 'active' || previousStatus === 'unavailable'
      ? previousStatus
      : 'error';
  }

  async checkAuth(scraper) {
    await scraper.loadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 2000)));

    let authState = 'pending';
    for (let attempt = 0; attempt < 12; attempt++) {
      authState = await scraper.executeScript(this.readLoginState);
      if (authState === 'connected' || authState === 'unauthorized') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (authState === 'connected') {
      this.status = 'connected';
      return { status: 'connected' };
    }

    this.status = 'unauthorized';
    return { status: 'unauthorized' };
  }

  async fetchData(scraper) {
    const failures = [];
    let coding = { plans: [], countdowns: [null, null, null] };
    const previousCodingStatus = this.planStatus.coding;
    if (previousCodingStatus !== 'active' && previousCodingStatus !== 'unavailable') {
      this.planStatus.coding = 'checking';
    }
    try {
      coding = await this.#scrapeCodingPlan(scraper);
    } catch (e) {
      if (e.code === 'AUTH_REQUIRED') throw e;
      failures.push(e);
      this.#restoreKnownPlanStatus('coding', previousCodingStatus);
      try { console.error('[VolcengineProvider] coding-plan skipped:', e.message); } catch(_) {}
    }

    let agent = { plans: [], countdowns: [null, null, null] };
    const previousAgentStatus = this.planStatus.agent;
    if (previousAgentStatus !== 'active' && previousAgentStatus !== 'unavailable') {
      this.planStatus.agent = 'checking';
    }
    try {
      agent = await this.#scrapeAgentPlan(scraper);
    } catch (e) {
      if (e.code === 'AUTH_REQUIRED') throw e;
      failures.push(e);
      this.#restoreKnownPlanStatus('agent', previousAgentStatus);
      try { console.error('[VolcengineProvider] agent-plan skipped:', e.message); } catch(_) {}
    }

    const allPlans = [...coding.plans, ...agent.plans];
    if (allPlans.length === 0 && failures.length > 0) {
      throw new Error('套餐用量获取失败，请刷新重试');
    }

    return {
      plans: allPlans,
      countdowns: [...coding.countdowns, ...agent.countdowns],
      url: this.consoleUrl,
    };
  }

  async fetchChannel(channelKey, scraper) {
    if (channelKey.endsWith(':agent')) {
      const previousStatus = this.planStatus.agent;
      if (previousStatus !== 'active' && previousStatus !== 'unavailable') {
        this.planStatus.agent = 'checking';
      }
      try {
        const agent = await this.#scrapeAgentPlan(scraper);
        return {
          plans: agent.plans,
          countdowns: agent.countdowns,
          channelOffset: 3,
        };
      } catch (e) {
        this.#restoreKnownPlanStatus('agent', previousStatus);
        throw e;
      }
    }
    const previousStatus = this.planStatus.coding;
    if (previousStatus !== 'active' && previousStatus !== 'unavailable') {
      this.planStatus.coding = 'checking';
    }
    try {
      const coding = await this.#scrapeCodingPlan(scraper);
      return {
        plans: coding.plans,
        countdowns: coding.countdowns,
        channelOffset: 0,
      };
    } catch (e) {
      this.#restoreKnownPlanStatus('coding', previousStatus);
      throw e;
    }
  }

  async #navigateTo(scraper, targetUrl) {
    await scraper.reloadPage(targetUrl);
    await scraper.waitForNetworkIdle(6000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 1000)));
  }

  async #scrapeCodingPlan(scraper) {
    return this.#scrapePlan(scraper, 'coding', this.consoleUrl);
  }

  async #scrapeAgentPlan(scraper) {
    return this.#scrapePlan(scraper, 'agent', this.agentUrl);
  }

  // A half-loaded console page shows the subscribe links before the usage numbers, which reads as
  // "unavailable"; that would drop the user's channel selection. Only trust it when it holds for
  // UNAVAILABLE_POLLS polls in a row on UNAVAILABLE_REFRESHES consecutive refreshes.
  static POLL_MS = 1000;
  static UNAVAILABLE_POLLS = 5;
  static UNAVAILABLE_REFRESHES = 2;
  #unavailableRefreshes = { coding: 0, agent: 0 };

  async #scrapePlan(scraper, kind, url) {
    await this.#navigateTo(scraper, url);
    const label = kind === 'agent' ? 'Agent Plan' : 'Coding Plan';
    let unavailablePolls = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const data = await scraper.executeScript(readUsage, kind);
      if (!data) throw new Error('scraper window lost');
      if (data.state === 'unauthorized') {
        this.status = 'unauthorized';
        const error = new Error('登录已失效，请重新连接');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      if (data.state === 'ready') {
        this.planStatus[kind] = 'active';
        this.#unavailableRefreshes[kind] = 0;
        this.lastError = null;
        return { plans: data.plans, countdowns: data.countdowns };
      }
      unavailablePolls = data.state === 'unavailable' ? unavailablePolls + 1 : 0;
      if (unavailablePolls >= VolcengineProvider.UNAVAILABLE_POLLS) {
        this.#unavailableRefreshes[kind]++;
        if (this.#unavailableRefreshes[kind] < VolcengineProvider.UNAVAILABLE_REFRESHES) {
          throw new Error(label + ' 页面暂未显示用量，下次刷新再确认');
        }
        this.planStatus[kind] = 'unavailable';
        return { plans: [], countdowns: [null, null, null] };
      }
      await new Promise(resolve => setTimeout(resolve, VolcengineProvider.POLL_MS));
    }
    throw new Error(label + ' 页面未返回完整套餐数据');
  }
}

module.exports = VolcengineProvider;
