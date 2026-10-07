// Executed in the page context for both direct and third-party login sessions.
function readUsage(kind) {
  if (location.protocol !== 'https:' || location.hostname !== 'console.volcengine.com') return { state: 'pending' };
  const text = document.body?.innerText || '';
  if (/\/login(?:\/|$)/.test(location.pathname) || /立即登录使用|请先登录/.test(text)) return { state: 'unauthorized' };
  if (!location.pathname.endsWith('/subscription/' + kind + '-plan')) return { state: 'pending' };
  const agent = kind === 'agent';
  const periods = [
    { name: agent ? 'Agent-近5小时' : '当前会话', re: agent ? /近\s*5\s*小时/ : /当前会话/ },
    { name: agent ? 'Agent-近一周' : '近1周', re: /近\s*(?:1|一)\s*周/ },
    { name: agent ? 'Agent-近一月' : '近1月', re: /近\s*(?:1|一)\s*月/ },
  ];
  const positions = periods.map(p => text.search(p.re));
  const result = { state: 'pending', plans: [], countdowns: [null, null, null] };
  for (let i = 0; i < periods.length; i++) {
    const start = positions[i];
    if (start < 0) continue;
    const end = Math.min(text.length, ...positions.filter(p => p > start));
    const section = text.slice(start, end);
    const match = section.match(/(?:<\s*)?\d+(?:\.\d+)?\s*%/);
    if (!match) continue;
    const progress = match[0].replace(/\s/g, '');
    const percentage = Number.parseFloat(progress.replace('<', ''));
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) continue;
    result.plans.push({ name: periods[i].name, progress, percentage });
    const reset = section.match(/((?:\d+\s*(?:天|小时|时|分钟|分|秒)\s*)+)后(?:重置|刷新)/);
    if (reset) {
      let ms = 0;
      for (const part of reset[1].matchAll(/(\d+)\s*(天|小时|时|分钟|分|秒)/g)) {
        ms += Number(part[1]) * ({ 天: 86400000, 小时: 3600000, 时: 3600000, 分钟: 60000, 分: 60000, 秒: 1000 })[part[2]];
      }
      result.countdowns[i] = ms;
    }
  }
  // Do not publish a partially hydrated page or let a marketing button override usage.
  if (result.plans.length === periods.length) result.state = 'ready';
  else if (positions.every(p => p < 0) && /立即订阅|查看套餐概览/.test(text)) result.state = 'unavailable';
  return result;
}

module.exports = { readUsage };
