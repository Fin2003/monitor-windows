const BaseProvider = require('./BaseProvider');

class OpencodeGoProvider extends BaseProvider {
  id = 'opencodego';
  name = 'opencode Go';
  icon = 'coding';
  authType = 'cookie';
  status = 'unauthorized';
  loginUrl = 'https://opencode.ai/go';
  consoleUrl = 'https://opencode.ai/go';
  accountLabel = '';
  skipAutoLogin = true;

  setWorkspaceUrl(url) {
    this.consoleUrl = String(url || '').trim() || 'https://opencode.ai/go';
    this.loginUrl = this.consoleUrl;
  }

  async checkAuth(scraper) {
    await scraper.loadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 3000)));

    const snapshot = await scraper.executeScript(() => {
      const url = window.location.href;
      const text = document.body.innerText || '';
      const labels = [
        '滾動使用量', '滚动使用量', '滾動用量', '滚动用量', 'Rolling',
        '每週使用量', '每周使用量', '每週用量', '每周用量', 'Weekly',
        '每月使用量', '每月用量', 'Monthly',
      ];
      const found = labels.filter(l => text.includes(l));
      return {
        url,
        text,
        hasPct: text.includes('%'),
        labelCount: found.length,
        found,
        onAuthPage: url.includes('/google/authorize') || url.includes('/github/authorize') || text.includes('Continue with Google') || text.includes('Continue with GitHub') || text.includes('OpenAuth'),
      };
    });

    if (!snapshot) {
      this.lastError = 'opencodego scraper lost';
      this.status = 'error';
      return { status: 'error', error: 'scraper window lost' };
    }

    const isLoggedIn = !snapshot.onAuthPage && snapshot.hasPct && snapshot.labelCount >= 2;

    if (!isLoggedIn) {
      const preview = (snapshot.text || '').replace(/\s+/g, ' ').slice(0, 500);
      console.error('[opencodego.checkAuth] not logged in', {
        url: snapshot.url,
        hasPct: snapshot.hasPct,
        labelCount: snapshot.labelCount,
        found: snapshot.found,
        preview,
      });
    }

    if (isLoggedIn) {
      this.status = 'connected';
      return { status: 'connected' };
    }

    this.status = 'unauthorized';
    return { status: 'unauthorized' };
  }

  async fetchData(scraper) {
    return this.#scrapeUsage(scraper);
  }

  async fetchChannel(channelKey, scraper) {
    const data = await this.#scrapeUsage(scraper);
    return {
      plans: data.plans,
      countdowns: data.countdowns,
      channelOffset: 0,
    };
  }

  async #scrapeUsage(scraper) {
    await scraper.reloadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 3000)));

    for (let attempt = 0; attempt < 20; attempt++) {
      const ready = await scraper.executeScript(() => {
        const text = document.body.innerText || '';
        if (text.includes('Continue with Google') || text.includes('Continue with GitHub') || text.includes('OpenAuth')) return false;
        if (!text.includes('%')) return false;
        const checks = [
          '滾動使用量', '滚动使用量', '滾動用量', '滚动用量', 'Rolling',
          '每週使用量', '每周使用量', '每週用量', '每周用量', 'Weekly',
          '每月使用量', '每月用量', 'Monthly', 'Month',
        ];
        const found = checks.filter(l => text.includes(l));
        return found.length >= 2;
      });
      if (ready === null) throw new Error('scraper window lost');
      if (ready) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    const raw = await scraper.executeScript(() => {
      const text = document.body.innerText || '';
      const findLabel = (patterns) => {
        for (const p of patterns) {
          const idx = text.indexOf(p);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const sessionPatterns = ['滾動使用量', '滚动使用量', '滾動用量', '滚动用量', 'Rolling Usage', 'Rolling usage', 'Rolling'];
      const weekPatterns = ['每週使用量', '每周使用量', '每週用量', '每周用量', 'Weekly Usage', 'Weekly usage', 'Weekly'];
      const monthPatterns = ['每月使用量', '每月用量', 'Monthly Usage', 'Monthly usage', 'Monthly'];
      const sIdx = findLabel(sessionPatterns);
      const wIdx = findLabel(weekPatterns);
      const mIdx = findLabel(monthPatterns);
      return { text, indices: { session: sIdx, week: wIdx, month: mIdx } };
    });

    if (!raw) throw new Error('scraper window lost during opencodego scrape');

    const { text, indices } = raw;
    const labels = [
      { sc: '滚动', idx: indices.session },
      { sc: '周', idx: indices.week },
      { sc: '月', idx: indices.month },
    ];

    const plans = [];
    const countdowns = [null, null, null];

    for (let i = 0; i < 3; i++) {
      const { sc, idx } = labels[i];
      if (idx < 0) continue;

      let sectionEnd = text.length;
      if (i === 0 && indices.week >= 0) sectionEnd = indices.week;
      else if (i === 1 && indices.month >= 0) sectionEnd = indices.month;

      const section = text.substring(idx, sectionEnd);
      const pctMatch = section.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        plans.push({ name: sc, percentage: Math.round(parseFloat(pctMatch[1])) });
      } else {
        plans.push({ name: sc, percentage: 0 });
      }

      const resetIdx = section.search(/重置時間|重置时间|重置於|重置于|Reset\s*time|reset\s*time/);
      if (resetIdx >= 0) {
        const afterReset = section.substring(resetIdx);
        countdowns[i] = this.#parseCountdown(afterReset);
      }
    }

    if (plans.length === 0) {
      throw new Error('opencode Go usage data not found');
    }

    while (plans.length < 3) {
      const idx = plans.length;
      plans.push({ name: labels[idx].sc, percentage: 0 });
    }

    return { plans, countdowns, url: this.consoleUrl };
  }

  #parseCountdown(text) {
    let ms = 0;
    const dayM = text.match(/(\d+)\s*(?:天|days?|day)/);
    const hourM = text.match(/(\d+)\s*(?:小時|小时|hours?|hour)/);
    const minM = text.match(/(\d+)\s*(?:分鐘|分钟|minutes?|minute)/);
    if (dayM) ms += parseInt(dayM[1], 10) * 86400000;
    if (hourM) ms += parseInt(hourM[1], 10) * 3600000;
    if (minM) ms += parseInt(minM[1], 10) * 60000;
    return ms > 0 ? ms : null;
  }
}

module.exports = OpencodeGoProvider;
