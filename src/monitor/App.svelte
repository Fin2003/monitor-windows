<script>
  import { onMount } from 'svelte';
  import quotaCatalog from '../../electron/providers/quota-catalog.json';
  import QuotaUsage from '../panel/components/QuotaUsage.svelte';
  import Icon from '@shared/components/Icon.svelte';
  import PageIndicator from './components/PageIndicator.svelte';
  import SystemMonitorPage from './components/SystemMonitorPage.svelte';
  import TiboRadarPage from '../../plugins/tibo-radar/Radar.svelte';
  import CompactOverview from './components/CompactOverview.svelte';
  import { codingChannelKeys } from '../shared/compact-overview-config.cjs';
  let { overviewPreview = false, overviewDraft = null } = $props();

  let enabledPlugins = $state([]);
  let currentPageIndex = $state(0);
  let autoSwitch = $state(true);
  let autoSwitchInterval = $state(10);
  let autoSwitchTimer = null;
  let displayConfig = $state(null);
  let providerStatus = $state({});
  let providerData = $state({});
  let isRefreshing = $state(false);
  let refreshSeen = $state({});
  let displayMode = $state('single');
  let activeProvider = $state('volcengine_0');
  let selectedProviders = $state(['volcengine_0']);
  let compactOverview = $state({ slots: [] });
  let compactSlots = $derived(((overviewPreview ? overviewDraft : compactOverview)?.slots || []).filter(Boolean));
  let compactChannelKeys = $derived([...new Set(compactSlots.filter(s=>s.kind==='coding').flatMap(codingChannelKeys))]);
  let trackedChannels = $derived([...new Set([...selectedProviders,
    ...(enabledPlugins.some(p => p.id === 'compact-overview') ? compactChannelKeys : [])])]);
  let compactCoding = $derived.by(() => Object.fromEntries(compactChannelKeys.map(key => {
    const id = key.split(':')[0];
    const disabled = channelAccounts.some(account => account.id === id && account.enabled === false);
    return [key, { label: getChannelLabel(key), rings: disabled ? [] : getProviderRings(key),
      status: disabled ? 'unauthorized' : providerStatus[id], error: channelErrors[key] || disabled }];
  })));

  function calibrateCompactChannels() {
    for (const key of compactChannelKeys) {
      const id = key.split(':')[0];
      if (!providerData[id]) continue;
      if (getProviderType(key) === 'volcengine') calibrateVolcengineCountdown(key);
      else if (Object.keys(quotaCatalog).filter(type => !['volcengine', 'xfyun'].includes(type)).includes(getProviderType(key))) calibrateSimpleCountdown(key, id);

    }
  }
  let currentTheme = $state('dark');

  function darkenColor(hex, factor = 0.72) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const toHex = n => Math.round(n).toString(16).padStart(2, '0');
    return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
  }

  function themeColor(hex) {
    return currentTheme === 'light' ? darkenColor(hex) : hex;
  }

  const PROVIDER_TYPE_COLORS = {
    volcengine: '#FFB23F',
    xfyun: '#3ECF8E',
    opencodego: '#3CC8DC',
  };
  const PROVIDER_TYPE_COLORS_LIGHT = {
    volcengine: '#B26A00',
    xfyun: '#138A55',
    opencodego: '#4C9AFF',
  };

  function getProviderType(key) {
    const accountId = key.includes(':') ? key.split(':')[0] : key;
    return accountId.split('_')[0];
  }

  function isPlaceholder(key) {
    const type = getProviderType(key);
    return type !== 'volcengine' && type !== 'xfyun' && type !== 'opencodego' && !Object.hasOwn(quotaCatalog, type);
  }

  function hasCachedChannelData(channelKey) {
    const providerId = channelKey.includes(':') ? channelKey.split(':')[0] : channelKey;
    const plans = providerData[providerId]?.plans || [];
    const type = getProviderType(channelKey);
    if (type === 'volcengine') {
      const isAgent = channelKey.endsWith(':agent');
      return plans.some(plan => isAgent ? plan.name.startsWith('Agent-') : !plan.name.startsWith('Agent-'));
    }
    if (type === 'xfyun') {
      const planName = channelKey.split(':').slice(1).join(':');
      return plans.some(plan => plan.name === `讯飞星火 ${planName}`);
    }
    return plans.length > 0;
  }

  async function loadPlugins() {
    try {
      enabledPlugins = (await window.api.getPlugins()).filter(p => p.enabled);
    } catch (e) { console.error(e); }
  }

  async function loadProviders() {
    try {
      const providers = await window.api.getProviders();
      const next = { ...providerStatus };
      for (const p of providers) {
        next[p.id] = p.status || 'unauthorized';
      }
      providerStatus = next;
    } catch (e) { console.error(e); }
  }

  async function loadCachedData() {
    try {
      const cache = await window.api.getCachedProviderData();
      const nextData = { ...providerData };
      for (const [pid, entry] of Object.entries(cache)) {
        if (!pid.includes('_')) continue;
        if (entry.data) {
          entry.data._fetchTime = entry.timestamp || Date.now();
          nextData[pid] = entry.data;
        }
      }
      providerData = nextData;
    } catch (_) {}
  }

  async function loadChannelStates() {
    try {
      const states = await window.api.getChannelStates();
      const nextErrors = { ...channelErrors };
      const nextDebug = { ...channelDebug };
      for (const [channelKey, state] of Object.entries(states || {})) {
        nextErrors[channelKey] = !!state.isError;
        nextDebug[channelKey] = { ...nextDebug[channelKey], ...state };
      }
      channelErrors = nextErrors;
      channelDebug = nextDebug;
    } catch (_) {}
  }

  function startAutoSwitch() {
    stopAutoSwitch();
    if (overviewPreview || !autoSwitch || enabledPlugins.length <= 1) return;
    autoSwitchTimer = setInterval(() => {
      currentPageIndex = (currentPageIndex + 1) % enabledPlugins.length;
    }, autoSwitchInterval * 1000);
  }

  function stopAutoSwitch() {
    if (autoSwitchTimer) { clearInterval(autoSwitchTimer); autoSwitchTimer = null; }
  }

  function persistActivePage() {
    const pageId = enabledPlugins[currentPageIndex]?.id;
    if (pageId && !overviewPreview) window.api.setActivePluginPage(pageId);
  }

  function switchToPage(index) { currentPageIndex = index; persistActivePage(); startAutoSwitch(); }
  function prevPage() { currentPageIndex = (currentPageIndex - 1 + enabledPlugins.length) % enabledPlugins.length; persistActivePage(); startAutoSwitch(); }
  function nextPage() { currentPageIndex = (currentPageIndex + 1) % enabledPlugins.length; persistActivePage(); startAutoSwitch(); }

  async function setDisplayMode(mode) {
    displayMode = mode;
    try { await window.api.setConfig('displayMode', mode); } catch (_) {}
  }

  async function setActiveProvider(pid) {
    activeProvider = pid;
    try { await window.api.setConfig('activeProvider', pid); } catch (_) {}
  }

  onMount(async () => {
    await loadPlugins();
    await loadProviders();
    await loadCachedData();

    try {
      const config = await window.api.getConfig();
      autoSwitch = config.carousel?.enabled !== false;
      autoSwitchInterval = config.carousel?.interval || 10;
      const savedPageIndex = enabledPlugins.findIndex(plugin => plugin.id === config.activePluginPageId);
      if (savedPageIndex >= 0) currentPageIndex = savedPageIndex;
      const theme = config.theme || 'dark';
      currentTheme = theme;
      document.documentElement.setAttribute('data-theme', theme);
      displayMode = config.displayMode || 'single';
      activeProvider = config.activeProvider || 'volcengine_0';
      selectedProviders = config.selectedProviders || ['volcengine_0'];
      compactOverview = config.compactOverview || { slots: [] };
      providerNames = config.providerNames || {};
      debugMode = config.debugMode || false;
       channelAccounts = config.channelAccounts || [];
       accountChannels = config.accountChannels || {};
    } catch (_) {}

    await loadChannelStates();
    calibrateCompactChannels();
    window.api.onCompactOverviewChange?.(value => {
      compactOverview = value || { slots: [] };
      loadCachedData().then(calibrateCompactChannels);
    });

    for (const key of trackedChannels) {
      const accountId = key.includes(':') ? key.split(':')[0] : key;
      const type = accountId.split('_')[0];
      if (type === 'volcengine' && providerData[accountId]) {
        calibrateVolcengineCountdown(key);
      } else if (Object.keys(quotaCatalog).filter(type => !['volcengine', 'xfyun'].includes(type)).includes(type) && providerData[accountId]) {
        calibrateSimpleCountdown(key, accountId);
      }
    }

    startAutoSwitch();
    startCountdownTick();

    window.api.onSwitchPage((pageId) => {
      const idx = enabledPlugins.findIndex(p => p.id === pageId);
      if (idx >= 0) { currentPageIndex = idx; startAutoSwitch(); }
    });

    window.api.onSwitchNextPage(() => {
      nextPage();
    });

    window.api.onCarouselConfig((config) => {
      autoSwitch = config.enabled !== false;
      autoSwitchInterval = config.interval || 10;
      startAutoSwitch();
    });

    window.api.onPluginUpdate((allPlugins) => {
      const newEnabled = allPlugins.filter(p => p.enabled);
      const currentId = enabledPlugins[currentPageIndex]?.id;
      enabledPlugins = newEnabled;
      if (currentId) {
        const newIdx = newEnabled.findIndex(p => p.id === currentId);
        if (newIdx >= 0) {
          currentPageIndex = newIdx;
        } else {
          currentPageIndex = 0;
        }
      } else {
        currentPageIndex = 0;
      }
      startAutoSwitch();
    });

    window.api.onDisplayConfig((config) => { if (!overviewPreview) displayConfig = config; });

    window.api.onThemeChange((theme) => {
      currentTheme = theme;
      document.documentElement.setAttribute('data-theme', theme);
    });

    window.api.onSelectedProvidersChange(async (providers) => {
      const newProviders = providers || [];
      const prev = selectedProviders;
      selectedProviders = newProviders;

      const added = newProviders.filter(k => !prev.includes(k));
      if (added.length > 0) {
        const cache = await window.api.getCachedProviderData();
        for (const key of added) {
          const accountId = key.includes(':') ? key.split(':')[0] : key;
          const type = accountId.split('_')[0];
          if (!providerData[accountId] && cache[accountId]?.data) {
            cache[accountId].data._fetchTime = cache[accountId].timestamp || Date.now();
            providerData[accountId] = cache[accountId].data;
            providerStatus[accountId] = 'connected';
          }
          if (type === 'volcengine' && providerData[accountId]) {
            calibrateVolcengineCountdown(key);
          } else if (Object.keys(quotaCatalog).filter(type => !['volcengine', 'xfyun'].includes(type)).includes(type) && providerData[accountId]) {
            calibrateSimpleCountdown(key, accountId);
          }
        }
      }
    });

    window.api.onProviderNamesChange((names) => {
      providerNames = names || {};
    });

    window.api.onAccountChannelsChange((channels) => {
      accountChannels = channels || {};
    });

    window.api.onChannelStatus(({ channelKey, isError }) => {
      channelErrors = { ...channelErrors, [channelKey]: isError };
    });

    window.api?.onChannelDebug?.(({ channelKey, ...debug }) => {
      channelDebug = { ...channelDebug, [channelKey]: debug };
      dbgUpdateText = { ...dbgUpdateText, [channelKey]: formatDbgUpdate(debug) };
    });

    window.api?.onDebugModeChange?.((value) => {
      debugMode = value;
    });

    window.api.onProviderUpdate(({ providerId, data, error, status }) => {
      if (status && providerStatus[providerId] !== status) {
        providerStatus = { ...providerStatus, [providerId]: status };
      }
      if (data) {
        if (!data._fetchTime) data._fetchTime = Date.now();
        const prev = providerData[providerId];
        const sameData = prev && prev.plans && data.plans &&
          prev.plans.length === data.plans.length &&
          prev.plans.every((p, i) => {
            const np = data.plans[i];
            
            if (p.percentage != null || np?.percentage != null) {
              return p.percentage === np?.percentage;
            }
            if (p.periods && np?.periods) {
              if (p.periods.length !== np.periods.length) return false;
              return p.periods.every((pd, j) => {
                const npd = np.periods[j];
                if (!pd.usage || !npd?.usage || pd.usage.length !== npd.usage.length) return false;
                return pd.usage.every((u, k) => u.used === npd.usage[k]?.used && u.total === npd.usage[k]?.total);
              });
            }
            return true;
          });
        if (data.dynamicQuota || !sameData || !prev) {
          providerData = { ...providerData, [providerId]: data };
        } else {
          prev._fetchTime = data._fetchTime;
          prev.countdowns = data.countdowns;
        }
        const prevStatus = providerStatus[providerId];
        if (!status && prevStatus !== 'connected') {
          providerStatus = { ...providerStatus, [providerId]: 'connected' };
        }
        refreshSeen = { ...refreshSeen, [providerId]: true };

        const type = providerId.split('_')[0];
        if (type === 'volcengine') {
          for (const key of trackedChannels) {
            if (getProviderType(key) === 'volcengine' && key.split(':')[0] === providerId) {
              calibrateVolcengineCountdown(key);
            }
          }
        }
        if (Object.keys(quotaCatalog).filter(type => !['volcengine', 'xfyun'].includes(type)).includes(type)) {
          for (const key of trackedChannels) {
            if (getProviderType(key) === type && key.split(':')[0] === providerId) {
              calibrateSimpleCountdown(key, providerId);
            }
          }
        }
        for (const key of trackedChannels) {
          if (key.split(':')[0] !== providerId) continue;
          const st = autoRefreshState[key];
          if (!st || st.phase !== 'refreshing') continue;
          const rings = getProviderRings(key);
          let refreshed = false;
          for (const ring of rings) {
            const prevPct = st.prevSnapshot[ring.key];
            if (prevPct != null && ring.pct < prevPct) { refreshed = true; break; }
          }
          autoRefreshState[key] = refreshed ? { phase: 'idle' } : { ...st, phase: 'stuck' };
        }
      } else if (error && !status) {
        if (providerStatus[providerId] !== 'error') {
          providerStatus = { ...providerStatus, [providerId]: 'error' };
        }
        refreshSeen = { ...refreshSeen, [providerId]: true };
      }
      const allSeen = selectedProviders.length === 0 || selectedProviders.every(key => {
        const accountId = key.split(':')[0];
        return refreshSeen[accountId] || (providerStatus[accountId] !== 'connected' && providerStatus[accountId] !== 'error');
      });
      if (allSeen) {
        isRefreshing = false;
      }
    });

    const hasCachedData = Object.values(providerData).some(d => d && d.plans);
    if (hasCachedData) {
      isRefreshing = false;
    }
  });

  let currentPlugin = $derived(overviewPreview ? {id:"compact-overview"} : enabledPlugins[currentPageIndex]);

  const RING_COLORS_DARK = ['#4C9AFF', '#9D8CFF', '#FFB23F'];
  const RING_COLORS_LIGHT = ['#1D6FE0', '#6B55D6', '#B26A00'];
  let ringColors = $derived(currentTheme === 'light' ? RING_COLORS_LIGHT : RING_COLORS_DARK);

  const PERIODS = [
    { key: 'session', label: '5小时', volcName: '当前会话', volcAgentName: 'Agent-近5小时', xfyunName: '5小时' },
    { key: 'week', label: '周', volcName: '近1周', volcAgentName: 'Agent-近一周', xfyunName: '周' },
    { key: 'month', label: '月', volcName: '近1月', volcAgentName: 'Agent-近一月', xfyunName: '总' },
  ];


  let countdownNow = $state(Date.now());
  let countdownTimer = null;

  function startCountdownTick() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownNow = Date.now();
    countdownTimer = setInterval(() => {
      countdownNow = Date.now();
      if (!overviewPreview) checkAutoRefresh();
    }, 1000);
  }

  let countdownState = $state({});

  function getCountdownKey(channelKey, periodKey) {
    return channelKey + ':' + periodKey;
  }

  function calibrateVolcengineCountdown(channelKey) {
    const accountId = channelKey.includes(':') ? channelKey.split(':')[0] : channelKey;
    const data = providerData[accountId];
    if (!data) return;
    const countdowns = data.countdowns || [];
    const fetchTime = data._fetchTime;
    if (!fetchTime) return;

    const offset = channelKey.endsWith(':agent') ? 3 : 0;

    for (let i = 0; i < PERIODS.length; i++) {
      const cd = countdowns[i + offset];
      if (cd == null) continue;
      const key = getCountdownKey(channelKey, PERIODS[i].key);
      const existing = countdownState[key];

      const existingTarget = existing?.refreshTargetMs;
      const expired = existingTarget && existingTarget <= Date.now();
      const cdChanged = !existing || existing.lastCd !== cd;

      if (cdChanged || expired) {
        countdownState[key] = {
          refreshTargetMs: fetchTime + cd,
          periodMs: null,
          lastCd: cd,
        };
      }
    }
  }

  function calibrateSimpleCountdown(channelKey, providerId) {
    const data = providerData[providerId];
    if (!data) return;
    const countdowns = data.countdowns || [];
    const fetchTime = data._fetchTime;
    if (!fetchTime) return;

    for (let i = 0; i < PERIODS.length; i++) {
      const cd = countdowns[i];
      if (cd == null) continue;
      const key = getCountdownKey(channelKey, PERIODS[i].key);
      const existing = countdownState[key];

      const existingTarget = existing?.refreshTargetMs;
      const expired = existingTarget && existingTarget <= Date.now();
      const cdChanged = !existing || existing.lastCd !== cd;

      if (cdChanged || expired) {
        countdownState[key] = {
          refreshTargetMs: fetchTime + cd,
          periodMs: null,
          lastCd: cd,
        };
      }
    }
  }

  function getProviderRings(channelKey) {
    if (isPlaceholder(channelKey)) {
      return PERIODS.map((period, i) => ({
        key: period.key, label: period.label, pct: 100, color: ringColors[i],
        used: '—', total: '—', countdownMs: null, placeholder: true,
      }));
    }
    const type = getProviderType(channelKey);
    const accountId = channelKey.includes(':') ? channelKey.split(':')[0] : channelKey;
    if (type === 'xfyun') {
      const planName = channelKey.split(':').slice(1).join(':');

      const plans = providerData[accountId]?.plans || [];
    if (providerData[accountId]?.dynamicQuota) return plans.map((plan, index) => ({ key: plan.period || plan.name, label: plan.name, pct: plan.percentage, color: ringColors[index % ringColors.length], used: plan.remaining != null ? '余 ' + Number(plan.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + (plan.unit || '') : plan.unlimited ? '不限量' : plan.used, infinite: plan.unlimited, countdownMs: plan.resetsAt ? Date.parse(plan.resetsAt) - countdownNow : null }));
      const plan = plans.find(p => p.name === `讯飞星火 ${planName}`);
      if (!plan || !plan.periods) return [];

      return PERIODS.map((period, i) => {
        const pd = plan.periods.find(pp => pp.label === period.xfyunName);
        if (pd && pd.usage && pd.usage.length > 0) {
          const u = pd.usage[0];
          const used = parseFloat(u.used);
          const refreshTargetMs = pd.resetsAt ? Date.parse(pd.resetsAt) : null;
          const countdownMs = refreshTargetMs ? refreshTargetMs - countdownNow : null;
          if (u.total === '∞') {
            return { key: period.key, label: period.label, pct: 100, color: ringColors[i], used: Math.round(used), total: '∞', infinite: true, countdownMs: null };
          }
          const total = parseFloat(u.total);
          const pct = total > 0 ? Math.round((used / total) * 100) : 0;
          return { key: period.key, label: period.label, pct, color: ringColors[i], used: pct + '%', total: u.total, countdownMs: countdownMs > 0 ? countdownMs : null };
        }
        return null;
      }).filter(Boolean);
    }
    const plans = providerData[accountId]?.plans || [];
    
    return PERIODS.map((period, i) => {
      if (type === 'volcengine') {
        const isAgent = channelKey.endsWith(':agent');
        const nameField = isAgent ? 'volcAgentName' : 'volcName';
        const plan = plans.find(p => p.name === period[nameField]);
        if (plan && plan.percentage != null) {
          const ck = getCountdownKey(channelKey, period.key);
          const st = countdownState[ck];
          const countdownMs = st?.refreshTargetMs ? st.refreshTargetMs - countdownNow : null;
          const noSession = period.key === 'session' && plan.percentage === 0;
          return { key: period.key, label: period.label, pct: plan.percentage, color: ringColors[i], countdownMs: !noSession && countdownMs > 0 ? countdownMs : null };
        }
      }
      if (Object.keys(quotaCatalog).filter(type => !['volcengine', 'xfyun'].includes(type)).includes(type)) {
        const plan = plans.find(p => p.name === ['滚动', '周', '月'][i]);
        if (plan && plan.percentage != null) {
          const ck = getCountdownKey(channelKey, period.key);
          const st = countdownState[ck];
          const countdownMs = st?.refreshTargetMs ? st.refreshTargetMs - countdownNow : null;
          const noSession = period.key === 'session' && plan.percentage === 0;
          return { key: period.key, label: period.label, pct: plan.percentage, color: ringColors[i], countdownMs: !noSession && countdownMs > 0 ? countdownMs : null };
        }
      }
      return null;
    }).filter(Boolean);
  }

  function formatUsed(val) {
    if (typeof val === 'string' && /^\d+(?:\.\d+)?%$/.test(val)) {
      return Math.round(Number.parseFloat(val)) + '%';
    }
    if (typeof val === 'string') return val;
    if (val >= 10000) return (val / 10000).toFixed(2) + 'w';
    return val;
  }

  function formatCountdown(ms) {
    if (ms == null || ms <= 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    if (days >= 1) return days + '天';
    const hours = Math.floor(totalSec / 3600);
    if (hours >= 1) return hours + '时';
    return Math.max(1, Math.ceil(totalSec / 60)) + '分';
  }

  const DBG_PERIOD_LABELS = ['5H', '周', '月'];

  function formatDbgUpdate(dbg) {
    if (!dbg || !dbg.lastValues || dbg.lastValues.length === 0) return '--';
    const parts = [];
    const len = Math.min(dbg.lastValues.length, DBG_PERIOD_LABELS.length);
    for (let i = 0; i < len; i++) {
      if (dbg.isInfinite && dbg.isInfinite[i]) {
        parts.push(`${DBG_PERIOD_LABELS[i]}∞`);
        continue;
      }
      const curr = dbg.lastValues[i];
      const prev = dbg.prevValues && dbg.prevValues[i] ? dbg.prevValues[i] : null;
      if (curr.type === 'raw') {
        const fmtUsed = Number.isInteger(curr.used) ? curr.used : curr.used.toFixed(1);
        const currStr = `${fmtUsed}/${curr.total}`;
        let diffStr = '';
        if (prev && prev.type === 'raw' && prev.used != null) {
          const diff = +(curr.used - prev.used).toFixed(1);
          if (diff !== 0) diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        }
        parts.push(`${DBG_PERIOD_LABELS[i]}${currStr}${diffStr}`);
      } else {
        const diff = prev && prev.pct != null ? curr.pct - prev.pct : null;
        const diffStr = diff != null && diff !== 0 ? (diff > 0 ? `+${diff}` : `${diff}`) : '';
        parts.push(`${DBG_PERIOD_LABELS[i]}${curr.pct}%${diffStr}`);
      }
    }
    return parts.join(' ');
  }

  let autoRefreshState = $state({});

  function getMinCountdown(rings) {
    const valid = rings.map(r => r.countdownMs).filter(c => c != null);
    return valid.length > 0 ? Math.min(...valid) : null;
  }

  function getCenterDisplay(rings, channelKey) {
    if (isPlaceholder(channelKey)) return { text: '—' };
    const phase = autoRefreshState[channelKey]?.phase;
    if (phase === 'waiting' || phase === 'refreshing' || phase === 'stuck') {
      return { text: '刷新中' };
    }
    const minMs = getMinCountdown(rings);
    if (minMs == null) return { text: '—' };
    if (minMs <= 0) return { text: '刷新中' };
    const totalSec = Math.floor(minMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    
    if (hours >= 1) return { num: hours, unit: '时' };
    const minutes = Math.ceil(totalSec / 60);
    if (minutes >= 1) return { num: minutes, unit: '分' };
    return { num: Math.max(1, Math.ceil(minMs / 1000)), unit: '' };
  }

  function checkAutoRefresh() {
    for (const channelKey of visibleChannels) {
      if (isPlaceholder(channelKey)) continue;
      const st = autoRefreshState[channelKey];
      if (st && st.phase !== 'idle') {
        if (st.phase === 'waiting' && Date.now() >= st.triggerAt) {
          st.phase = 'refreshing';
          autoRefreshState[channelKey] = { ...st };
          const providerId = channelKey.split(':')[0];
          window.api.providerFetchData(providerId);
        }
        continue;
      }
      const rings = getProviderRings(channelKey);
      const minMs = getMinCountdown(rings);
      if (minMs != null && minMs <= 0) {
        const snapshot = {};
        rings.forEach(r => { snapshot[r.key] = r.pct; });
        autoRefreshState[channelKey] = {
          phase: 'waiting',
          triggerAt: Date.now() + 5000,
          prevSnapshot: snapshot,
        };
      }
    }
  }

  let providerNames = $state({});
  let channelErrors = $state({});
  let channelDebug = $state({});
  let dbgUpdateText = $state({});
  let debugMode = $state(false);
  let channelAccounts = $state([]);
  let accountChannels = $state({});

  let visibleChannels = $derived(
    selectedProviders.filter(key => {
      if (isPlaceholder(key)) return true;
      const providerId = key.includes(':') ? key.split(':')[0] : key;
      if (!providerId.includes('_')) return false;
      const account = channelAccounts.find(a => a.id === providerId);
      if (account && account.enabled === false) return false;
      const type = providerId.split('_')[0];
      if (type === 'xfyun') {
        if (!key.includes(':')) return false;
        return hasCachedChannelData(key) || providerStatus[providerId] === 'connected' || providerStatus[providerId] === 'error';
      }
      return hasCachedChannelData(key) || providerStatus[providerId] === 'connected' || providerStatus[providerId] === 'error';
    })
  );

  let containerW = $state(640);
  let containerH = $state(480);

  function computeLayout(count, isPortrait, isUltraWide) {
    if (count === 0) return { rows: [], maxCols: 0, maxRows: 0 };
    if (isPortrait) {
      return { rows: Array.from({ length: count }, (_, i) => [i]), maxCols: 1, maxRows: count };
    }
    if (isUltraWide) {
      return { rows: [Array.from({ length: count }, (_, i) => i)], maxCols: count, maxRows: 1 };
    }
    let numRows;
    if (count <= 2) numRows = 1;
    else if (count <= 8) numRows = 2;
    else if (count <= 16) numRows = 3;
    else numRows = Math.ceil(Math.sqrt(count));
    const perRow = [];
    let remaining = count;
    for (let i = 0; i < numRows; i++) {
      const n = Math.ceil(remaining / (numRows - i));
      perRow.push(n);
      remaining -= n;
    }
    const maxCols = Math.max(...perRow);
    const rows = [];
    let idx = 0;
    for (const n of perRow) {
      const cells = [];
      for (let j = 0; j < n; j++) cells.push(idx++);
      rows.push(cells);
    }
    return { rows, maxCols, maxRows: numRows };
  }

  let isPortraitLayout = $derived(containerH > containerW && containerH > 0);
  let isUltraWideLayout = $derived(containerW > containerH * 2.5 && containerH > 0);
  let layout = $derived(computeLayout(visibleChannels.length, isPortraitLayout, isUltraWideLayout));

  let brickH = $state(0);

  let ringMaxW = $derived.by(() => {
    if (layout.maxCols === 0 || containerW === 0 || brickH === 0) return 380;
    const innerW = containerW - 32;
    const cw = innerW / layout.maxCols;
    const maxRows = layout.maxRows;
    const minGap = 2;
    const gapTotal = (maxRows - 1) * minGap;
    const availH = brickH - gapTotal;
    const perRowH = maxRows > 0 ? availH / maxRows : availH;
    const roughW = Math.min(cw * 0.95, Math.max(60, (perRowH - 40) * 360 / 210), 480);
    const estScale = Math.max(0.4, Math.min(1.3, roughW / 280));
    const labelH = 20 * estScale * 1.5 + (-4) * estScale + 2 * estScale;
    const wByHeight = Math.max(60, (perRowH - labelH) * 360 / 210);
    let result = Math.min(cw * 0.95, wByHeight, 480);
    const fs = Math.max(0.4, Math.min(1.3, result / 280));
    const realLabelH = 20 * fs * 1.5 + (-4) * fs + 2 * fs;
    const realRingH = result * 210 / 360;
    const totalH = maxRows * (realLabelH + realRingH) + (maxRows - 1) * minGap;
    if (totalH > brickH) {
      const correctedWByH = Math.max(60, (perRowH - realLabelH) * 360 / 210);
      result = Math.min(cw * 0.95, correctedWByH, result - 4);
    }
    return result;
  });

  let rowGap = $derived.by(() => {
    if (layout.maxRows <= 1 || brickH === 0 || ringMaxW === 0) return 4;
    const scale = Math.max(0.4, Math.min(1.3, ringMaxW / 280));
    const labelH = 20 * scale * 1.5 + (-4) * scale + 2 * scale;
    const ringH = ringMaxW * 210 / 360;
    const contentH = layout.maxRows * (labelH + ringH);
    const remaining = brickH - contentH;
    const gap = layout.maxRows > 1 ? remaining / (layout.maxRows - 1) : 0;
    return Math.max(2, Math.min(32, Math.round(gap)));
  });

  let fontScale = $derived(Math.max(0.4, Math.min(1.3, ringMaxW / 280)));
  let tooSmall = $derived(ringMaxW < 100 && brickH > 0);

  function getPeriodLabel(period) {
    if (period.key === 'month') {
      const hasXfyun = visibleChannels.some(k => getProviderType(k) === 'xfyun');
      const hasOther = visibleChannels.some(k => getProviderType(k) !== 'xfyun' && !isPlaceholder(k));
      if (hasXfyun && !hasOther) return '总';
      if (hasXfyun && hasOther) return '月/总';
    }
    return period.label;
  }

  const PROVIDER_TYPE_NAMES = { ...Object.fromEntries(Object.entries(quotaCatalog).map(([type, item]) => [type, item.name])), kimi: 'Kimi Coding', zhipu: '智谱 GLM', minimax: 'MiniMax', zenmux: 'ZenMux', commandcode: 'Command Code', volcengine: '火山方舟', xfyun: '讯飞星火', opencodego: 'opencode Go' };

  function getChannelLabel(key) {
    if (providerNames[key]) return providerNames[key];
    const accountId = key.includes(':') ? key.split(':')[0] : key;
    const type = accountId.split('_')[0];
    const baseName = PROVIDER_TYPE_NAMES[type] || type;
    const acc = channelAccounts.find(a => a.id === accountId);
    const accountLabel = acc?.label || '';
    let name = baseName;
    if (accountLabel) name += ` (${accountLabel})`;
    if (key.endsWith(':agent')) name += ' Agent';
    if (type === 'xfyun' && key.includes(':')) {
      const planPart = key.split(':').pop();
      if (!baseName.includes(planPart)) name += `-${planPart}`;
    }
    return name;
  }

  function getChannelColor(key) {
    const type = getProviderType(key);
    const palette = currentTheme === 'light' ? PROVIDER_TYPE_COLORS_LIGHT : PROVIDER_TYPE_COLORS;
    return palette[type] || (currentTheme === 'light' ? '#4C9AFF' : '#4C9AFF');
  }
</script>

{#snippet ringGroup(channelKey)}
  {@const rings = getProviderRings(channelKey)}
  {@const label = getChannelLabel(channelKey)}
  {@const color = getChannelColor(channelKey)}
  {@const providerId = channelKey.split(':')[0]}
  {@const isPh = isPlaceholder(channelKey)}
  {@const chError = !isPh && channelErrors[channelKey]}
  {@const hasData = !isPh && rings.length > 0}
  {@const providerDown = !isPh && (providerStatus[providerId] === 'error' || providerStatus[providerId] === 'unauthorized')}
  {@const hasError = !isPh && !hasData && (chError || providerDown)}
  {@const showWarning = !isPh && (chError || (providerDown && hasData))}
  {@const displayLabel = showWarning && hasData ? label + ' (未连接)' : label}
    <div class="ring-group">
      {#if debugMode && !isPh}
        {@const dbg = channelDebug[channelKey]}
        <div class="debug-overlay">
          {#if dbg?.fetching}
            <span class="dbg-line dbg-fetch">FETCHING...</span>
          {:else if dbg?.nextFetchAt}
            {@const remain = Math.max(0, dbg.nextFetchAt - countdownNow)}
            <span class="dbg-line">NEXT {Math.floor(remain / 60000)}m{Math.floor((remain % 60000) / 1000)}s</span>
          {:else}
            <span class="dbg-line">NEXT --</span>
          {/if}
          <span class="dbg-line" class:dbg-on={dbg?.isHighFreq}>HF:{dbg?.isHighFreq ? 'ON' : 'OFF'}</span>
          <span class="dbg-line" class:dbg-err={dbg?.isError}>LAST:{dbg?.isError ? 'FAIL' : 'OK'}</span>
          <span class="dbg-line">UPD:{dbgUpdateText[channelKey] || '--'}</span>
          <span class="dbg-line" class:dbg-retry={dbg?.isRetrying}>RTY:{dbg?.isRetrying ? `Y(${dbg?.consecutiveErrors || '?'})` : 'N'}</span>
        </div>
      {/if}
      <div class="ring-label" style:color={showWarning ? 'var(--warning)' : (hasError ? 'var(--warning)' : color)}>{displayLabel}</div>
      
      {#if hasError}
        <div class="error-container">
          <div class="error-icon"><Icon name="unlock" size={28} /></div>
          <div class="error-text">{chError && !providerDown ? '用量获取失败，等待重试' : '需要重新登录'}</div>
        </div>
    {:else if !isPh && !hasData}
      <div class="error-container" role="status"><div class="error-text">{providerStatus[providerId] === 'connected' ? '正在获取用量…' : '正在检查登录状态…'}</div></div>
    {:else if providerData[providerId]?.dynamicQuota}
      <div class="dynamic-quota"><QuotaUsage data={providerData[providerId]} /></div>
    {:else if rings.length > 0}
      {@const center = getCenterDisplay(rings, channelKey)}
      <div class="ring-container">
        <svg viewBox="0 0 360 210" class="ring-svg">
          {#each rings as ring, i}
            {@const r = 150 - i * 40}
            {@const stroke = ring.strokeWidth ?? 24}
            {@const halfCirc = Math.PI * r}
            {@const leftX = 180 - r}
            {@const rightX = 180 + r}
            {@const cy = 162}
            <path d="M {leftX} {cy} A {r} {r} 0 0 1 {rightX} {cy}"
                  fill="none" stroke="var(--ring-track)" stroke-width={stroke}
                  stroke-linecap="round" />
            {#if ring.infinite}
              <path d="M {leftX} {cy} A {r} {r} 0 0 1 {rightX} {cy}"
                    fill="none" stroke={ring.color} stroke-width={stroke}
                    stroke-linecap="round"
                    class="ring-arc" />
              <text x={leftX} y={cy + stroke / 2 + 18} text-anchor="middle"
                    fill={ring.color} font-size="17" font-weight="600"
                    class="ring-text">{formatUsed(ring.used)}</text>
              <text x={rightX} y={cy + stroke / 2 + 18} text-anchor="middle"
                    fill="var(--text-secondary)" font-size="17" font-weight="500"
                    class="ring-text">∞</text>
            {:else}
              {@const usedLen = halfCirc * Math.max(0, Math.min(1, ring.pct / (ring.maxPct ?? 100)))}
              {@const remainLen = halfCirc - usedLen}
              <path d="M {leftX} {cy} A {r} {r} 0 0 1 {rightX} {cy}"
                    fill="none" stroke={ring.color} stroke-width={stroke}
                    stroke-linecap="round"
                    stroke-dasharray="{usedLen} {remainLen}"
                    class="ring-arc" />
              <text x={leftX} y={cy + stroke / 2 + 18} text-anchor="middle"
                    fill={ring.color} font-size="17" font-weight="600"
                    class="ring-text">{formatUsed(ring.used || ring.pct + '%')}</text>
              <text x={rightX} y={cy + stroke / 2 + 18} text-anchor="middle"
                    fill="var(--text-secondary)" font-size="17" font-weight="500"
                    class="ring-text">{formatCountdown(ring.countdownMs)}</text>
            {/if}
          {/each}
          {#if center.text}
            <text x="180" y="135" text-anchor="middle"
                  fill={color} font-size="13" font-weight="500"
                  class="ring-text">预计刷新</text>
            <text x="180" y="192" text-anchor="middle"
                  fill={color} font-size="44" font-weight="700"
                  class="ring-text">{center.text}</text>
          {:else}
            <text x="180" y="135" text-anchor="middle"
                  fill={color} font-size="13" font-weight="500"
                  class="ring-text">预计刷新</text>
            <text x="180" y="192" text-anchor="middle"
                  fill={color} font-size="63" font-weight="700"
                  class="ring-text">{center.num}</text>
            {#if center.unit}
              <text x="180" y="210" text-anchor="middle"
                    fill={color} font-size="14" font-weight="500"
                    class="ring-text">{center.unit}</text>
            {/if}
          {/if}
        </svg>
      </div>
    {/if}
  </div>
{/snippet}

<div class="monitor-shell"
  style:transform={displayConfig?.needsRotation ? 'rotate(90deg)' : 'none'}
  style:transform-origin={displayConfig?.needsRotation ? 'top left' : 'none'}
  style:width={displayConfig?.needsRotation ? `${displayConfig.height}px` : '100%'}
  style:height={displayConfig?.needsRotation ? `${displayConfig.width}px` : '100%'}>

  {#if !overviewPreview && enabledPlugins.length === 0}
    <div class="empty">
      <div class="empty-icon"><Icon name="monitor" size={48} /></div>
      <div class="empty-text">暂无启用的插件</div>
      <div class="empty-hint">请在管理面板中启用插件</div>
    </div>
  {:else}
    <div class="page-container" bind:clientWidth={containerW} bind:clientHeight={containerH}>
      {#if currentPlugin?.id === 'system-monitor'}
        <SystemMonitorPage />
      {:else if currentPlugin?.id === 'tibo-radar'}
        <TiboRadarPage />
      {:else if currentPlugin?.id === 'compact-overview'}
        <CompactOverview slots={compactSlots} coding={compactCoding} />
      {:else if currentPlugin?.id === 'coding-plan'}
        <div class="coding-plan-page" style="--font-scale: {fontScale}">
          <div class="page-header">
            <span class="page-title">MONITOR</span>
            <div class="header-right">
              {#if isRefreshing}
                <span class="refresh-badge">
                  <span class="refresh-dot"></span>
                  获取中
                </span>
              {/if}
            </div>
          </div>

          {#if tooSmall}
            <div class="too-small">
              <div class="too-small-text">分辨率过小</div>
              <div class="too-small-hint">请放大窗口尺寸</div>
            </div>
          {:else if visibleChannels.length > 0}
            <div class="period-tags">
              
              {#each PERIODS as period, i}
                <span class="period-tag">
                  <span class="period-dot" style:background={ringColors[i]}></span>
                  {getPeriodLabel(period)}
                </span>
              {/each}
              
            </div>
            <div class="brick-layout" bind:clientHeight={brickH}
              style="--max-cols: {layout.maxCols}; --ring-max-w: {ringMaxW}px; --font-scale: {fontScale}; --row-gap: {rowGap}px;">
              {#each layout.rows as row}
                <div class="brick-row">
                  {#each row as ci}
                    {@render ringGroup(visibleChannels[ci])}
                  {/each}
                </div>
              {/each}
            </div>
          {:else}
            <div class="login-section">
              <div class="lock-icon"><Icon name="coding" size={32} /></div>
              <div class="login-title">Coding Plan</div>
              <div class="login-status">未检测到登录信息</div>
              <div class="login-hint">请在管理面板中登录</div>
            </div>
          {/if}
        </div>
      {:else if currentPlugin?.htmlPath}
        <iframe
          src={`file://${currentPlugin.htmlPath}`}
          sandbox="allow-scripts allow-same-origin"
          frameborder="0"
          allowfullscreen
          title={currentPlugin.name}
        ></iframe>
      {/if}
    </div>
  {/if}
</div>

<style>
  .dynamic-quota { width: 100%; max-height: 320px; overflow-y: auto; padding: 0 18px; box-sizing: border-box; }
  .monitor-shell {
    width: 100%; height: 100%; display: flex; flex-direction: column;
    background: var(--bg); overflow: hidden;
  }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .empty-icon { margin-bottom: 12px; color: var(--text-secondary); display: flex; justify-content: center; }
  .empty-text { font-size: 16px; font-weight: 500; }
  .empty-hint { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }

  .page-container { flex: 1; overflow: hidden; position: relative; }

  .coding-plan-page {
    width: 100%; height: 100%; display: flex; flex-direction: column;
    padding: 12px 16px; overflow: hidden;
    --font-scale: 1;
  }

  .page-header {
    display: flex; justify-content: space-between; align-items: center; margin-bottom: calc(8px * var(--font-scale));
  }
  .page-title {
    font-size: calc(13px * var(--font-scale)); font-weight: 600; letter-spacing: 0; color: var(--text-3);
  }
  .header-right { display: flex; align-items: center; gap: 8px; }

  .refresh-badge {
    display: flex; align-items: center; gap: calc(6px * var(--font-scale));
    font-size: calc(11px * var(--font-scale)); color: var(--accent); font-weight: 500;
    animation: refresh-pulse 2s ease-in-out infinite;
  }
  .refresh-dot {
    width: calc(6px * var(--font-scale)); height: calc(6px * var(--font-scale)); border-radius: 50%;
    background: var(--accent); animation: dot-blink 1s ease-in-out infinite;
  }

  @keyframes dot-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  @keyframes refresh-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

  .brick-layout {
    flex: 1; display: flex; flex-direction: column;
    gap: var(--row-gap, 4px); justify-content: center;
    overflow: hidden; min-height: 0;
  }
  .brick-row {
    flex: 0 0 auto; display: flex; flex-direction: row;
    justify-content: center; align-items: center;
    gap: 4px; min-width: 0;
  }

  .ring-group {
    display: flex; flex-direction: column; align-items: center;
    gap: calc(2px * var(--font-scale));
    width: calc(100% / var(--max-cols));
    max-width: var(--ring-max-w); min-width: 0;
    position: relative;
  }
  .ring-label {
    font-size: calc(20px * var(--font-scale)); font-weight: 700; letter-spacing: 0.5px;
    margin-bottom: calc(-4px * var(--font-scale));
  }
  .weekly-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; font-size: 12px; line-height: 1.4; letter-spacing: 0; }

  .debug-overlay {
    position: absolute; top: 0; left: 0; z-index: 10;
    display: flex; flex-direction: column; gap: 1px;
    padding: 3px 5px; border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    font-size: calc(18px * var(--font-scale)); font-weight: 700;
    line-height: 1.3; letter-spacing: 0.3px;
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums; pointer-events: none;
  }
  .dbg-line { white-space: nowrap; }
  .dbg-on { color: #FF6B66; }
  .dbg-err { color: #FFB23F; }
  .dbg-fetch { color: #4C9AFF; }
  .dbg-retry { color: #FFB23F; }

  .period-tags {
    display: flex; gap: calc(20px * var(--font-scale)); align-items: center; justify-content: center;
    margin-bottom: 4px;
  }
  .period-tag {
    display: flex; align-items: center; gap: calc(6px * var(--font-scale));
    font-size: calc(16px * var(--font-scale)); color: var(--text-secondary); font-weight: 500;
  }
  .period-dot {
    width: calc(12px * var(--font-scale)); height: calc(12px * var(--font-scale)); border-radius: 50%; flex-shrink: 0;
  }

  .ring-container {
    position: relative; width: 100%; aspect-ratio: 360 / 210;
    margin: 0 auto;
  }
  .ring-svg { width: 100%; height: 100%; }
  .ring-arc { transition: stroke-dasharray 0.4s ease; }
  .ring-text { font-variant-numeric: tabular-nums; pointer-events: none; user-select: none; }

  .login-section {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
  }

  .too-small {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 8px;
  }
  .too-small-text { font-size: 18px; font-weight: 600; color: var(--text-secondary); }
  .too-small-hint { font-size: 13px; color: var(--text-secondary); }
  .lock-icon { color: var(--text-secondary); }
  .login-title { font-size: 20px; font-weight: 600; }
  .login-status { font-size: 14px; color: var(--warning); }
  .login-hint { font-size: 12px; color: var(--text-secondary); }

  .error-container {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 8px;
    padding: 24px 0;
  }
  .error-icon { color: var(--warning); }
  .error-text { font-size: 16px; font-weight: 600; color: var(--warning); }


  iframe { width: 100%; height: 100%; border: none; background: var(--bg); }
</style>
