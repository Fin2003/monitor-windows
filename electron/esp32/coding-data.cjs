const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const text = (value, length = 40) => [...String(value ?? '')].slice(0, length).join('');
function countdown(ms) {
  if (!(ms > 0)) return '—';
  const minutes = Math.ceil(ms / 60000), hours = Math.floor(minutes / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)}天 ${hours % 24}时` : hours ? `${hours}时 ${minutes % 60}分` : `${minutes}分`;
}
function codingCards({ config = {}, cache = {}, now = Date.now() } = {}) {
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
    cards.push({ name: text(config.providerNames?.[channel] || config.providerNames?.[id] || account.label ||
      ({ kimi: 'Kimi Coding', zhipu: '智谱 GLM', minimax: 'MiniMax', zenmux: 'ZenMux', commandcode: 'Command Code', volcengine: '火山方舟', opencodego: 'opencode Go', xfyun: '讯飞星火' }[account.type] || 'Coding Plan') + (agent ? ' Agent' : '')),
      periods, center: Number.isFinite(next) ? { value: String(hours || minutes), unit: hours ? '时' : '分' } : { value: '—', unit: '' } });
  }
  while (cards.length < 2) cards.push({ name: 'Coding Plan', periods: ['5小时', '周', '月'].map(label => ({ label, pct: null, countdown: '—' })), center: { value: '—', unit: '' } });
  return cards.slice(0, 2);
}
module.exports = { codingCards };
