const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const text = (value, length = 40) => [...String(value ?? '')].slice(0, length).join('');
function countdown(ms) {
  if (!(ms > 0)) return '—';
  const minutes = Math.ceil(ms / 60000), hours = Math.floor(minutes / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)}天 ${hours % 24}时` : hours ? `${hours}时 ${minutes % 60}分` : `${minutes}分`;
}
function codingCards({ config = {}, cache = {}, now = Date.now(), pageSize = 2 } = {}) {
  const channels = [...new Set([...(config.selectedProviders || []),
    ...(config.compactOverview?.slots || []).filter(slot => slot?.kind === 'coding')
      .flatMap(slot => [slot.channelKey, ...(slot.channelKeys || [])])].filter(Boolean))];
  const cards = [];
  for (const channel of channels) {
    const id = channel.split(':')[0], account = (config.channelAccounts || []).find(item => item.id === id);
    if (!account || account.enabled === false || config.accountDisplayEnabled?.[id] === false) continue;
    const data = cache[channel]?.data || cache[id]?.data || {};
    const agent = channel.endsWith(':agent'), offset = agent ? 3 : 0;
    let periods;
    if (account.type === 'xfyun') {
      const plan = (data.plans || []).find(plan => channel.endsWith(':' + plan.name.replace('讯飞星火 ', ''))) || data.plans?.[0];
      periods = (plan?.periods || []).slice(0, 3).map(period => {
        const item = period.usage?.[0], used = number(item?.used), total = number(item?.total);
        return { label: text(period.label, 14), pct: total > 0 && used != null ? used / total * 100 : null, countdown: '—', remaining: null };
      });
    } else if (data.dynamicQuota) {
      const all = data.plans || [];
      const pageCount = Math.max(1, Math.ceil(all.length / 3)), page = Math.floor(now / 15000) % pageCount;
      periods = all.slice(page * 3, page * 3 + 3).map(plan => {
        const remaining = plan.resetsAt ? Date.parse(plan.resetsAt) - now : null;
        const amount = plan.remaining != null ? String(Math.round(plan.remaining * 100) / 100) + ' ' + (plan.unit || '') : plan.unlimited ? '不限量' : null;
        return { label: text(plan.name, 14), pct: number(plan.percentage), countdown: text(amount || countdown(remaining), 24), remaining };
      });
    } else {
      const names = account.type === 'volcengine'
        ? agent ? ['Agent-近5小时', 'Agent-近一周', 'Agent-近一月'] : ['当前会话', '近1周', '近1月']
        : ['滚动', '周', '月'];
      periods = names.map((name, index) => {
        const plan = (data.plans || []).find(plan => plan.name === name), raw = number(data.countdowns?.[index + offset]);
        const remaining = raw == null ? null : number(data._fetchTime) != null ? data._fetchTime + raw - now : raw;
        return { label: ['5小时', '周', '月'][index], pct: number(plan?.percentage), countdown: countdown(remaining), remaining };
      });
    }
    while (periods.length < 3) periods.push({ label: '额度', pct: null, countdown: '—', remaining: null });
    const next = Math.min(...periods.map(item => item.remaining).filter(value => value > 0));
    const minutes = Math.ceil(next / 60000), hours = Math.floor(minutes / 60);
    const balance = data.dynamicQuota ? (data.plans || []).find(plan => plan.balanceOnly) : null;
    cards.push({ name: text(config.providerNames?.[channel] || config.providerNames?.[id] || account.label ||
      ({ ...Object.fromEntries(Object.entries(require('../providers/quota-catalog.json')).map(([type,item])=>[type,item.name])), kimi: 'Kimi Coding', zhipu: '智谱 GLM', minimax: 'MiniMax', zenmux: 'ZenMux', commandcode: 'Command Code', volcengine: '火山方舟', opencodego: 'opencode Go', xfyun: '讯飞星火' }[account.type] || 'Coding Plan') + (agent ? ' Agent' : '')),
      periods, center: balance ? { value: text(Number(balance.remaining).toLocaleString('en-US', { maximumFractionDigits: 2, notation: 'compact' }), 12), unit: text(balance.unit, 6) } : Number.isFinite(next) ? { value: String(hours || minutes), unit: hours ? '时' : '分' } : { value: '—', unit: '' } });
  }
  while (cards.length < pageSize) cards.push({ name: 'Coding Plan', periods: ['5小时', '周', '月'].map(label => ({ label, pct: null, countdown: '—' })), center: { value: '—', unit: '' } });
  const page = Math.floor(now / 15000) % Math.ceil(cards.length / pageSize);
  return cards.slice(page * pageSize, page * pageSize + pageSize);
}
module.exports = { codingCards };
