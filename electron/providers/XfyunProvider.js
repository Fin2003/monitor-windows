const BaseProvider = require('./BaseProvider');

class XfyunProvider extends BaseProvider {
  id = 'xfyun';
  name = '讯飞星火';
  icon = 'coding';
  authType = 'cookie';
  status = 'unauthorized';
  loginUrl = 'https://passport.xfyun.cn/login';
  consoleUrl = 'https://maas.xfyun.cn/packageSubscription';
  catalogStatus = 'unknown';
  availablePlans = [];

  hydrateCatalog(data) {
    if (!data?.plans?.length) return;
    this.availablePlans = data.plans.map(plan => ({
      name: plan.name,
      status: plan.status || 'active',
      dateRange: plan.dateRange || null,
    }));
    this.catalogStatus = 'cached';
  }

  async checkAuth(scraper) {
    await scraper.loadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 3000)));

    const result = await scraper.executeScript(() => {
      const url = window.location.href;
      const rootEl = document.getElementById('root');
      const hasContent = rootEl && rootEl.children.length > 0;
      const hasLoginBtn = !!document.querySelector('[class*="login"], [class*="Login"]');
      const hasAvatar = !!document.querySelector('[class*="avatar"], [class*="Avatar"], [class*="user"], [class*="User"]');
      const hasPwd = !!document.querySelector('input[type="password"]');
      const isLoginPage = url.includes('passport.xfyun.cn') || url.includes('/login');
      const bodyText = (document.body?.innerText || '').slice(0, 200);

      return { url, hasContent, hasLoginBtn, hasAvatar, hasPwd, isLoginPage, bodyText };
    });

    if (!result) {
      this.status = 'unauthorized';
      return { status: 'unauthorized' };
    }

    try { console.error(`[XfyunProvider] checkAuth result:`, JSON.stringify(result)); } catch(_) {}

    if (result.isLoginPage || result.hasPwd) {
      this.status = 'unauthorized';
      return { status: 'unauthorized' };
    }

    if (result.hasAvatar || (result.hasContent && !result.hasLoginBtn)) {
      this.status = 'connected';
      return { status: 'connected' };
    }

    this.status = 'unauthorized';
    return { status: 'unauthorized' };
  }

  async fetchData(scraper) {
    this.catalogStatus = 'checking';
    await scraper.reloadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 4000)));

    const rowInfo = await scraper.executeScript(() => {
      function getRowKey(tr) {
        if (tr.id) return tr.id;
        const path = [];
        let node = tr;
        while (node && node !== document.body && path.length < 20) {
          path.unshift([node.tagName, Array.from(node.parentElement?.children || []).indexOf(node)]);
          node = node.parentElement;
        }
        return path.map((p, i) => `${i}_${p[0]}_${p[1]}`).join('|');
      }

      function getRowName(text) {
        if (text.includes('无忧版')) return '无忧版';
        if (text.includes('旗舰版')) return '旗舰版';
        if (text.includes('专业版')) return '专业版';
        const m = text.match(/([\u4e00-\u9fa5]+版)/);
        return m ? m[1] : '默认';
      }

      function extractDateRange(text) {
        const dateRe = /起\s*(\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}:\d{2})\s*止\s*(\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}:\d{2})/;
        const m = text.match(dateRe);
        if (m) return { start: m[1].replace(/\//g, '-'), end: m[2].replace(/\//g, '-') };
        return null;
      }

      const seen = new Set();
      const rows = [];
      const allTrs = Array.from(document.querySelectorAll('tr'));
      allTrs.forEach((tr, idx) => {
        const text = (tr.innerText || '').trim();
        if (text.includes('/') && text.includes('次') &&
            (text.includes('5小时') || text.includes('周') || text.includes('总') || text.includes('token'))) {
          const key = `${getRowKey(tr)}_${idx}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push({
              key,
              idx,
              name: getRowName(text),
              dateRange: extractDateRange(text),
            });
          }
        }
      });
      return rows;
    });

    try { console.error(`[XfyunProvider] fetchData rows:`, JSON.stringify(rowInfo)); } catch(_) {}

    if (!rowInfo || !Array.isArray(rowInfo) || rowInfo.length === 0) {
      this.availablePlans = [];
      this.catalogStatus = 'empty';
      throw new Error('xfyun plan data not found');
    }

    const plans = [];
    const nameSeen = {};

    for (const info of rowInfo) {
      let planName = info.name;
      if (nameSeen[info.name]) {
        nameSeen[info.name]++;
        planName = `${info.name}_${nameSeen[info.name]}`;
      } else {
        nameSeen[info.name] = 1;
      }

      const periods = [];
      for (const tabLabel of ['5小时', '周', '总']) {
        const clicked = await scraper.executeScript((rowIdx, tab) => {
          const allTrs = Array.from(document.querySelectorAll('tr'));
          if (rowIdx >= allTrs.length) return false;
          const tr = allTrs[rowIdx];
          const els = tr.querySelectorAll('span, div, button, a');
          for (const el of els) {
            if ((el.textContent||'').trim() === tab) {
              el.click();
              return true;
            }
          }
          return false;
        }, info.idx, tabLabel);

        await scraper.executeScript(() => new Promise(r => setTimeout(r, 1500)));

        const usageData = await scraper.executeScript((rowIdx) => {
          const allTrs = Array.from(document.querySelectorAll('tr'));
          if (rowIdx >= allTrs.length) return null;
          const tr = allTrs[rowIdx];
          const text = (tr.innerText || '');
          const entries = [];
          const re = /([\d.]+)\s*\/\s*(∞|[\d.]+)\s*次/g;
          let m;
          while ((m = re.exec(text)) !== null) { entries.push({ used: m[1], total: m[2] }); }
          return entries;
        }, info.idx);

        if (usageData && usageData.length > 0) {
          periods.push({ label: tabLabel, usage: usageData });
        }
      }

      plans.push({
        name: `讯飞星火 ${planName}`,
        periods,
        dateRange: info.dateRange,
        status: 'active',
      });
    }

    try { console.error(`[XfyunProvider] fetchData plans:`, JSON.stringify(plans)); } catch(_) {}

    this.availablePlans = plans.map(plan => ({
      name: plan.name,
      status: plan.status,
      dateRange: plan.dateRange,
    }));
    this.catalogStatus = 'ready';
    return { plans, url: this.consoleUrl };
  }

  async fetchChannel(channelKey, scraper) {
    const colonIdx = channelKey.indexOf(':');
    const planName = colonIdx >= 0 ? channelKey.slice(colonIdx + 1) : channelKey;
    const baseName = planName.replace(/_\d+$/, '');

    await scraper.reloadPage(this.consoleUrl);
    await scraper.waitForNetworkIdle(8000);
    await scraper.executeScript(() => new Promise(r => setTimeout(r, 4000)));

    const step1 = await scraper.executeScript((targetName) => {
      function getRowName(text) {
        if (text.includes('无忧版')) return '无忧版';
        if (text.includes('旗舰版')) return '旗舰版';
        if (text.includes('专业版')) return '专业版';
        const m = text.match(/([\u4e00-\u9fa5]+版)/);
        return m ? m[1] : '默认';
      }

      function extractDateRange(text) {
        const dateRe = /起\s*(\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}:\d{2})\s*止\s*(\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}:\d{2})/;
        const m = text.match(dateRe);
        if (m) return { start: m[1].replace(/\//g, '-'), end: m[2].replace(/\//g, '-') };
        return null;
      }

      function extractUsage(text) {
        const entries = [];
        const re = /([\d.]+)\s*\/\s*(∞|[\d.]+)\s*次/g;
        let m;
        while ((m = re.exec(text)) !== null) { entries.push({ used: m[1], total: m[2] }); }
        return entries;
      }

      const allTrs = Array.from(document.querySelectorAll('tr'));
      let targetIdx = -1;
      let nameCount = 0;
      const base = targetName.replace(/_\d+$/, '');

      for (let i = 0; i < allTrs.length; i++) {
        const tr = allTrs[i];
        const text = (tr.innerText || '').trim();
        if (text.includes('/') && text.includes('次') &&
            (text.includes('5小时') || text.includes('周') || text.includes('总') || text.includes('token'))) {
          const rowName = getRowName(text);
          if (rowName === base) {
            nameCount++;
            if (targetName.includes('_')) {
              const seq = parseInt(targetName.split('_')[1]);
              if (nameCount === seq) { targetIdx = i; break; }
            } else {
              targetIdx = i;
              break;
            }
          }
        }
      }

      if (targetIdx < 0) return { __step: 'notfound', name: targetName };

      const tr = allTrs[targetIdx];
      const text = (tr.innerText || '');
      const firstEls = Array.from(tr.querySelectorAll('span, div, button, a'));
      for (const el of firstEls) {
        if ((el.textContent||'').trim() === '5小时') { el.click(); break; }
      }

      return { __step: 'found', name: getRowName(text), idx: targetIdx, dateRange: extractDateRange(text), usage: extractUsage(text) };
    }, baseName);

    try { console.error(`[XfyunProvider] fetchChannel ${channelKey} step1:`, JSON.stringify(step1)); } catch(_) {}

    if (!step1 || step1.__step !== 'found') {
      this.availablePlans = this.availablePlans.filter(plan => plan.name !== `讯飞星火 ${planName}`);
      throw new Error(`Plan ${planName} not found on page (step1: ${JSON.stringify(step1)})`);
    }

    const periods = [];
    if (step1.usage && step1.usage.length > 0) {
      periods.push({ label: '5小时', usage: step1.usage });
    }

    const usageData2 = await scraper.executeScript(async (rowIdx) => {
      const allTrs = Array.from(document.querySelectorAll('tr'));
      if (rowIdx >= allTrs.length) return null;
      const tr = allTrs[rowIdx];
      const els = Array.from(tr.querySelectorAll('span, div, button, a'));
      for (const el of els) {
        if ((el.textContent||'').trim() === '周') { el.click(); break; }
      }
      return true;
    }, step1.idx);

    await scraper.executeScript(() => new Promise(r => setTimeout(r, 2000)));

    const usageWeek = await scraper.executeScript((rowIdx) => {
      const allTrs = Array.from(document.querySelectorAll('tr'));
      if (rowIdx >= allTrs.length) return null;
      const tr = allTrs[rowIdx];
      const text = (tr.innerText || '');
      const entries = [];
      const re = /([\d.]+)\s*\/\s*(∞|[\d.]+)\s*次/g;
      let m;
      while ((m = re.exec(text)) !== null) { entries.push({ used: m[1], total: m[2] }); }
      return entries;
    }, step1.idx);

    try { console.error(`[XfyunProvider] fetchChannel ${channelKey} usageWeek:`, JSON.stringify(usageWeek)); } catch(_) {}

    if (usageWeek && usageWeek.length > 0) {
      periods.push({ label: '周', usage: usageWeek });
    }

    await scraper.executeScript(async (rowIdx) => {
      const allTrs = Array.from(document.querySelectorAll('tr'));
      if (rowIdx >= allTrs.length) return false;
      const tr = allTrs[rowIdx];
      const els = Array.from(tr.querySelectorAll('span, div, button, a'));
      for (const el of els) {
        if ((el.textContent||'').trim() === '总') { el.click(); break; }
      }
      return true;
    }, step1.idx);

    await scraper.executeScript(() => new Promise(r => setTimeout(r, 2000)));

    const usageTotal = await scraper.executeScript((rowIdx) => {
      const allTrs = Array.from(document.querySelectorAll('tr'));
      if (rowIdx >= allTrs.length) return null;
      const tr = allTrs[rowIdx];
      const text = (tr.innerText || '');
      const entries = [];
      const re = /([\d.]+)\s*\/\s*(∞|[\d.]+)\s*次/g;
      let m;
      while ((m = re.exec(text)) !== null) { entries.push({ used: m[1], total: m[2] }); }
      return entries;
    }, step1.idx);

    try { console.error(`[XfyunProvider] fetchChannel ${channelKey} usageTotal:`, JSON.stringify(usageTotal)); } catch(_) {}

    if (usageTotal && usageTotal.length > 0) {
      periods.push({ label: '总', usage: usageTotal });
    }

    try { console.error(`[XfyunProvider] fetchChannel ${channelKey} final periods:`, JSON.stringify(periods)); } catch(_) {}

    if (periods.length === 0) {
      throw new Error(`No usage data found for ${planName}`);
    }

    const discoveredPlan = {
      name: `讯飞星火 ${planName}`,
      status: 'active',
      dateRange: step1.dateRange,
    };
    this.availablePlans = [
      ...this.availablePlans.filter(plan => plan.name !== discoveredPlan.name),
      discoveredPlan,
    ];

    return {
      plans: [{ name: `讯飞星火 ${planName}`, periods, dateRange: step1.dateRange, status: 'active' }],
      countdowns: [],
      channelOffset: 0,
    };
  }
}

module.exports = XfyunProvider;
