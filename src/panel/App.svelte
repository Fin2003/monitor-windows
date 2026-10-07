<script>
  import { onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';

  const PROVIDER_TYPES = {
    volcengine: { name: '火山方舟', subtitle: 'Volcengine ARK', description: 'Coding Plan + Agent Plan 用量追踪' },
    opencodego: { name: 'opencode Go', subtitle: 'opencode.ai', description: '用量追踪（GitHub/Google 登录）' },
    xfyun: { name: '讯飞星火', subtitle: 'Xfyun Spark', description: '套餐用量追踪' },
  };

  let accounts = $state([]);
  let loginStatus = $state({});
  let planStatus = $state({});
  let confirming = $state({});
  let selectedChannels = $state([]);
  let accountChannels = $state({});
  let accountDisplayEnabled = $state({});
  let xfyunPlans = $state({});
  let catalogStatus = $state({});
  let showSaved = $state(false);
  let savedTimer = null;
  let credSaveTimer = null;
  let providerNames = $state({});
  let credentials = $state({});
  let showCreds = $state({});
  let showAccountMenu = $state(null);
  let channelErrors = $state({});
  let channelStatus = $state({});
  let channelHighFreq = $state({});
  let channelFetching = $state({});
  let debugMode = $state(false);
  let showNewChannelDialog = $state(false);
  let newChannel = $state({ type: '', name: '', workspaceUrl: '' });
  let proxyPorts = $state({});
  let providerConfig = $state({});
  let loginInfo = $state({});
  let selectedAccPerType = $state({});
  let rootEl;

  function toPlain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function flashSaved() {
    showSaved = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { showSaved = false; }, 1500);
  }

  function getChannelsForAccount(acc) {
    if (acc.type === 'volcengine') {
      const chs = [];
      if (planStatus[acc.id]?.coding === 'active') chs.push(acc.id);
      if (planStatus[acc.id]?.agent === 'active') chs.push(acc.id + ':agent');
      return chs;
    }
    if (acc.type === 'xfyun') {
      const plans = xfyunPlans[acc.id];
      if (plans && plans.length > 0) return plans.map(p => `${acc.id}:${p.name.replace('讯飞星火 ', '')}`);
      return [];
    }
    return [acc.id];
  }

  function isAccountSelected(acc) {
    return accountDisplayEnabled[acc.id] === true;
  }

  function isChannelSelected(key) {
    const accId = key.includes(':') ? key.split(':')[0] : key;
    return (accountChannels[accId] || []).includes(key);
  }

  function getDisplayName(key) {
    if (providerNames[key]) return providerNames[key];
    const accId = key.includes(':') ? key.split(':').slice(0, -1).join(':') : key;
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return key;
    const pt = PROVIDER_TYPES[acc.type];
    let name = pt?.name || acc.type;
    if (acc.label) name += ` (${acc.label})`;
    if (key.endsWith(':agent')) name += ' Agent';
    if (key.includes(':') && acc.type === 'xfyun') {
      const planPart = key.split(':').pop();
      if (planPart !== acc.id.split(':').pop()) name += `-${planPart}`;
    }
    return name;
  }

  function getAccountLabel(acc) {
    if (acc.label) return acc.label;
    if (credentials[acc.id]?.username) return credentials[acc.id].username;
    if (loginInfo[acc.id]?.email) return loginInfo[acc.id].email;
    if (loginInfo[acc.id]?.phone) return loginInfo[acc.id].phone;
    if (loginInfo[acc.id]?.displayName) return loginInfo[acc.id].displayName;
    return null;
  }

  function getStatusText(accId) {
    return { connected: '已登录', waiting: '等待登录', checking: '检测中', error: '连接异常' }[loginStatus[accId]] || '未登录';
  }

  function toggleSelect(key) {
    const accId = key.includes(':') ? key.split(':').slice(0, -1).join(':') : key;
    const acc = accounts.find(a => a.id === accId);
    if (!acc || !acc.enabled) return;
    if (loginStatus[accId] !== 'connected') return;

    const own = accountChannels[accId] || [];
    const nextOwn = own.includes(key) ? own.filter(k => k !== key) : [...own, key];
    accountChannels = { ...accountChannels, [accId]: nextOwn };
    selectedChannels = [...new Set(Object.values(accountChannels).flat())];
    window.api.setConfig('accountChannels', JSON.parse(JSON.stringify(accountChannels))).then(() => flashSaved());
  }

  async function toggleAccountDisplay(accId) {
    const acc = accounts.find(account => account.id === accId);
    if (!acc || acc.enabled === false) return;
    const nextEnabled = accountDisplayEnabled[accId] !== true;
    if (nextEnabled && !(accountChannels[accId]?.length > 0)) {
      const rememberedChannels = getChannelsForAccount(acc);
      if (rememberedChannels.length > 0) {
        accountChannels = { ...accountChannels, [accId]: rememberedChannels };
        await window.api.setConfig('accountChannels', JSON.parse(JSON.stringify(accountChannels)));
      }
    }
    accountDisplayEnabled = { ...accountDisplayEnabled, [accId]: nextEnabled };
    await window.api.setConfig('accountDisplayEnabled', toPlain(accountDisplayEnabled));
    flashSaved();
  }

  function accountDisplayToggleAction(node) {
    const handleClick = (event) => {
      event.stopPropagation();
      toggleAccountDisplay(node.dataset.key);
    };
    node.addEventListener('click', handleClick);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
      },
    };
  }

  function accountMenuToggleAction(node) {
    const handleClick = (event) => {
      event.stopPropagation();
      const type = node.dataset.type;
      showAccountMenu = showAccountMenu === type ? null : type;
    };
    node.addEventListener('click', handleClick);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
      },
    };
  }

  function accountSelectAction(node) {
    const handleClick = (event) => {
      event.stopPropagation();
      selectAccount(node.dataset.type, node.dataset.key);
    };
    node.addEventListener('click', handleClick);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
      },
    };
  }

  async function addAccount(type) {
    const existing = accounts.filter(a => a.type === type);
    let idx = existing.length;
    const allIds = new Set(accounts.map(a => a.id));
    let id = type + '_' + idx;
    while (allIds.has(id)) { idx++; id = type + '_' + idx; }
    const acc = { id, type, label: '', enabled: true };
    accounts = [...accounts, acc];
    accountDisplayEnabled = { ...accountDisplayEnabled, [id]: false };
    window.api.setConfig('accountDisplayEnabled', toPlain(accountDisplayEnabled));
    selectedAccPerType = { ...selectedAccPerType, [type]: id };
    window.api.setConfig('selectedAccounts', toPlain(selectedAccPerType));
    showAccountMenu = null;
    saveAccounts();
    await window.api.addChannelAccount(type, id);
    flashSaved();
  }

  function removeAccount(accId) {
    const acc = accounts.find(a => a.id === accId);
    const type = acc?.type;
    accounts = accounts.filter(a => a.id !== accId);
    delete accountChannels[accId];
    accountChannels = { ...accountChannels };
    delete accountDisplayEnabled[accId];
    accountDisplayEnabled = { ...accountDisplayEnabled };
    selectedChannels = [...new Set(Object.values(accountChannels).flat())];
    delete loginStatus[accId];
    delete credentials[accId];
    showAccountMenu = null;
    if (type) {
      const remaining = accounts.filter(a => a.type === type);
      if (remaining.length > 0) {
        selectedAccPerType = { ...selectedAccPerType, [type]: remaining[0].id };
      } else {
        delete selectedAccPerType[type];
      }
    }
    window.api.setConfig('selectedAccounts', toPlain(selectedAccPerType));
    window.api.setConfig('accountDisplayEnabled', toPlain(accountDisplayEnabled));
    saveAccounts();
    window.api.removeChannelAccount(accId);
    window.api.setConfig('accountChannels', JSON.parse(JSON.stringify(accountChannels))).then(() => flashSaved());
  }

  function updateAccountLabel(accId, label) {
    const acc = accounts.find(a => a.id === accId);
    if (acc) acc.label = label;
    accounts = accounts;
    saveAccounts();
  }

  function updatePlanLabel(key, label) {
    const value = label.trim();
    if (!value) return;
    providerNames = { ...providerNames, [key]: value };
    window.api.setConfig('providerNames', toPlain(providerNames));
  }

  function toggleAccountEnabled(accId) {
    const acc = accounts.find(a => a.id === accId);
    if (acc) {
      acc.enabled = !acc.enabled;
      accounts = accounts;
      if (!acc.enabled) {
        // Keep this account's channel choices so re-enabling restores them.
        selectedChannels = [...new Set(Object.values(accountChannels).flat())];
        window.api.setConfig('accountChannels', JSON.parse(JSON.stringify(accountChannels)));
      }
      saveAccounts();
    }
    showAccountMenu = null;
  }

  function saveAccounts() {
    const data = accounts.map(a => ({ id: a.id, type: a.type, label: a.label, enabled: a.enabled }));
    window.api.setConfig('channelAccounts', data);
    flashSaved();
  }

  function selectAccount(type, accId) {
    selectedAccPerType = { ...selectedAccPerType, [type]: accId };
    window.api.setConfig('selectedAccounts', toPlain(selectedAccPerType));
    showAccountMenu = null;
  }

  function renameChannel(key, currentName) {
    const name = window.prompt('修改渠道/套餐名称', providerNames[key] || currentName || key);
    if (!name?.trim()) return;
    providerNames = { ...providerNames, [key]: name.trim() };
    window.api.setConfig('providerNames', toPlain(providerNames)).then(() => flashSaved());
  }

  async function checkAuth() {
    try {
      const providers = await window.api.getProviders();
      const next = { ...loginStatus };
      const nextPlan = { ...planStatus };
      const nextCatalog = { ...catalogStatus };
      const nextXfyunPlans = { ...xfyunPlans };
      for (const p of providers) {
        next[p.id] = p.status || 'unauthorized';
        if (p.planStatus) nextPlan[p.id] = p.planStatus;
        if (p.catalogStatus) nextCatalog[p.id] = p.catalogStatus;
        if (p.id.startsWith('xfyun')) nextXfyunPlans[p.id] = p.availablePlans || [];
      }
      loginStatus = next;
      planStatus = nextPlan;
      catalogStatus = nextCatalog;
      xfyunPlans = nextXfyunPlans;
      loadLoginInfo();
    } catch (e) { console.error(e); }
  }

  async function loadLoginInfo() {
    try {
      for (const acc of accounts) {
        if (loginStatus[acc.id] === 'connected') {
          const info = await window.api.getProviderLoginInfo(acc.id);
          if (info && (info.email || info.phone || info.displayName)) {
            loginInfo = { ...loginInfo, [acc.id]: info };
          }
        }
      }
    } catch (_) {}
  }

  async function login(accId) {
    try {
      const result = await window.api.providerLogin(accId);
      if (result.needsBrowser) {
        loginStatus = { ...loginStatus, [accId]: 'waiting' };
      } else if (result.success) {
        loginStatus = { ...loginStatus, [accId]: 'connected' };
        const acc = accounts.find(a => a.id === accId);
        if (acc && !isAccountSelected(acc)) toggleSelect(accId);
      }
    } catch (e) {
      console.error(e);
      loginStatus = { ...loginStatus, [accId]: 'unauthorized' };
    }
  }

  // Clears this account's login (browser session, saved password, cached usage) so 连接 can sign in to
  // another account. The plan selection stays and resumes after logging in again.
  async function logout(accId) {
    const who = getAccountLabel(accounts.find(a => a.id === accId) || { id: accId });
    if (!confirm(`退出登录${who ? `「${who}」` : ''}？\n将清除此账号的登录状态、保存的密码和缓存用量，之后可点「连接」登录其他账号。`)) return;
    confirming = { ...confirming, [accId]: true };
    try {
      const result = await window.api.providerLogout(accId);
      if (result?.success) {
        loginStatus = { ...loginStatus, [accId]: 'unauthorized' };
        const { [accId]: _info, ...restInfo } = loginInfo;
        loginInfo = restInfo;
        const { [accId]: _creds, ...restCreds } = credentials;
        credentials = restCreds;
        const { [accId]: _plan, ...restPlan } = planStatus;
        planStatus = restPlan;
      }
    } catch (e) { console.error(e); }
    confirming = { ...confirming, [accId]: false };
  }

  async function confirmLogin(accId) {
    confirming = { ...confirming, [accId]: true };
    try {
      const result = await window.api.providerConfirmLogin(accId);
      if (result.success) {
        loginStatus = { ...loginStatus, [accId]: 'connected' };
        const acc = accounts.find(a => a.id === accId);
        if (acc && !isAccountSelected(acc)) toggleSelect(accId);
      } else {
        loginStatus = { ...loginStatus, [accId]: 'unauthorized' };
      }
    } catch (e) {
      console.error(e);
      loginStatus = { ...loginStatus, [accId]: 'unauthorized' };
    }
    confirming = { ...confirming, [accId]: false };
  }

  async function refreshAuth(accId) {
    confirming = { ...confirming, [accId]: true };
    try {
      const result = await window.api.providerCheckAuth(accId);
      loginStatus = { ...loginStatus, [accId]: result.status };
      if (result.status === 'connected') {
        await window.api.providerFetchData(accId);
      }
    } catch (e) { console.error(e); }
    confirming = { ...confirming, [accId]: false };
  }

  async function refreshChannel(channelKey) {
    channelFetching = { ...channelFetching, [channelKey]: true };
    try { await window.api.providerFetchChannel(channelKey); } catch (e) { console.error(e); }
    channelFetching = { ...channelFetching, [channelKey]: false };
  }

  async function loadChannelStates() {
    try {
      const states = await window.api.getChannelStates();
      const nextErrors = { ...channelErrors };
      const nextStatus = { ...channelStatus };
      const nextHighFreq = { ...channelHighFreq };
      const nextFetching = { ...channelFetching };
      for (const [channelKey, state] of Object.entries(states || {})) {
        nextErrors[channelKey] = !!state.isError;
        nextStatus[channelKey] = state.status || (state.isError ? 'error' : 'checking');
        nextHighFreq[channelKey] = !!state.isHighFreq;
        nextFetching[channelKey] = !!state.fetching;
      }
      channelErrors = nextErrors;
      channelStatus = nextStatus;
      channelHighFreq = nextHighFreq;
      channelFetching = nextFetching;
    } catch (_) {}
  }

  async function loadAccounts() {
    try {
      const config = await window.api.getConfig();
      const data = config.channelAccounts || defaultAccounts();
      accounts = data;
      const initSel = {};
      const savedSelections = config.selectedAccounts || {};
      const selectedByType = {};
      for (const key of (config.selectedProviders || [])) {
        const accId = key.includes(':') ? key.split(':')[0] : key;
        const acc = data.find(a => a.id === accId);
        if (acc && !selectedByType[acc.type]) selectedByType[acc.type] = acc.id;
      }
      for (const type of Object.keys(PROVIDER_TYPES)) {
        const typeAccounts = data.filter(a => a.type === type && a.enabled !== false);
        const connected = typeAccounts.find(a => loginStatus[a.id] === 'connected');
        const savedId = savedSelections[type];
        const savedAccount = typeAccounts.find(a => a.id === savedId);
        initSel[type] = savedAccount?.id || selectedByType[type] || connected?.id || typeAccounts[0]?.id || null;
      }
      selectedAccPerType = initSel;
      if (!config.selectedAccounts) window.api.setConfig('selectedAccounts', initSel);
      accountChannels = config.accountChannels || {};
      let sel = config.selectedProviders || ['volcengine_0'];
      const selectedAccountIds = new Set(sel.map(key => key.split(':')[0]));
      const savedDisplayEnabled = config.accountDisplayEnabled || {};
      const nextDisplayEnabled = {};
      for (const account of data) {
        nextDisplayEnabled[account.id] = Object.hasOwn(savedDisplayEnabled, account.id)
          ? savedDisplayEnabled[account.id] !== false
          : selectedAccountIds.has(account.id);
      }
      accountDisplayEnabled = nextDisplayEnabled;
      if (!config.accountDisplayEnabled) window.api.setConfig('accountDisplayEnabled', nextDisplayEnabled);
      const validAccountIds = new Set(data.map(a => a.id));
      let filtered = sel.filter(k => {
        const accId = k.includes(':') ? k.split(':')[0] : k;
        if (!validAccountIds.has(accId)) return false;
        const acc = data.find(a => a.id === accId);
        if (acc?.type === 'xfyun' && !k.includes(':')) return false;
        return true;
      });
      if (filtered.length !== sel.length) {
        window.api.setConfig('selectedProviders', filtered);
      }
      if (!config.accountChannels) {
        for (const key of filtered) {
          const accId = key.includes(':') ? key.split(':')[0] : key;
          accountChannels[accId] = [...(accountChannels[accId] || []), key];
        }
        window.api.setConfig('accountChannels', JSON.parse(JSON.stringify(accountChannels)));
      }
      selectedChannels = [...new Set(Object.values(accountChannels).flat())];
      providerNames = config.providerNames || {};
      debugMode = config.debugMode || false;
    } catch (_) {
      accounts = defaultAccounts();
      selectedChannels = ['volcengine_0'];
    }
  }

  function defaultAccounts() {
    return [
      { id: 'volcengine_0', type: 'volcengine', label: '', enabled: true },
      { id: 'opencodego_0', type: 'opencodego', label: '', enabled: true },
      { id: 'xfyun_0', type: 'xfyun', label: '', enabled: true },
    ];
  }

  function toggleDebug() {
    debugMode = !debugMode;
    window.api.setConfig('debugMode', debugMode);
    flashSaved();
  }

  function openNewChannelDialog() {
    newChannel = { type: '', name: '', workspaceUrl: '' };
    showNewChannelDialog = true;
  }

  async function createNewChannel() {
    if (!newChannel.type || !newChannel.name) return;
    const providerId = newChannel.type + '_' + Date.now();
    await window.api.addChannelAccount(newChannel.type, providerId, newChannel.name, newChannel.workspaceUrl || null);
    showNewChannelDialog = false;
    await loadAccounts();
    selectedAccPerType = { ...selectedAccPerType, [newChannel.type]: providerId };
    await window.api.setConfig('selectedAccounts', toPlain(selectedAccPerType));
  }

  async function loadCredentials() {
    try {
      for (const acc of accounts) {
        const creds = await window.api.getProviderCredentials(acc.id);
        if (creds) credentials = { ...credentials, [acc.id]: creds };
      }
    } catch (_) {}
  }

  async function loadProxyPorts() {
    try {
      for (const acc of accounts) {
        if (acc.type === 'opencodego') {
          const port = await window.api.getProviderProxyPort(acc.id);
          proxyPorts = { ...proxyPorts, [acc.id]: port || '' };
        }
      }
    } catch (_) {}
  }

  async function loadProviderConfig() {
    try {
      for (const acc of accounts) {
        if (acc.type === 'opencodego') {
          const cfg = await window.api.getProviderConfig(acc.id);
          providerConfig = { ...providerConfig, [acc.id]: cfg || { workspaceUrl: '' } };
        }
      }
    } catch (_) {}
  }

  async function saveCredentials(accId) {
    const creds = credentials[accId];
    if (!creds) return;
    await window.api.setProviderCredentials(accId, { username: creds.username || '', password: creds.password || '' });
    flashSaved();
  }

  window.api?.onProviderUpdate?.(({ providerId, data, error, status, fetching, planStatus: nextPlanStatus, catalogStatus: nextCatalogStatus, availablePlans }) => {
    const next = { ...loginStatus };
    if (status) next[providerId] = status;
    if (nextPlanStatus) planStatus = { ...planStatus, [providerId]: nextPlanStatus };
    if (nextCatalogStatus) catalogStatus = { ...catalogStatus, [providerId]: nextCatalogStatus };
    if (providerId.startsWith('xfyun') && availablePlans) {
      xfyunPlans = { ...xfyunPlans, [providerId]: availablePlans };
    }
    if (data) {
      window.api.getProviderLoginInfo(providerId).then(info => {
        if (info && (info.email || info.phone || info.displayName)) {
          loginInfo = { ...loginInfo, [providerId]: info };
        }
      }).catch(() => {});
    }
    if (error && !status) next[providerId] = 'error';
    loginStatus = next;
    if (!nextPlanStatus && (error || (data && providerId.startsWith('volcengine')))) {
      window.api.getProviders().then(providers => {
        const nextPlan = { ...planStatus };
        for (const p of providers) {
          if (p.planStatus) nextPlan[p.id] = p.planStatus;
        }
        planStatus = nextPlan;
      }).catch(() => {});
    }
  });

  onMount(() => {
    loadAccounts().then(() => {
      loadCredentials();
      loadProxyPorts();
      loadProviderConfig();
      checkAuth();
      loadChannelStates();
    });

    rootEl.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) {
        if (showAccountMenu) showAccountMenu = null;
        return;
      }
      const action = el.dataset.action;
      const key = el.dataset.key;
      const type = el.dataset.type;
      if (action === 'toggle') {
        // The checkbox change handler performs this toggle. Do not toggle again
        // when the checkbox click bubbles through the plan container.
        if (e.target.closest('[data-action="toggle-check"]')) return;
        toggleSelect(key);
      } else if (action === 'login') {
        login(key);
      } else if (action === 'refresh') {
        refreshAuth(key);
      } else if (action === 'refresh-channel') {
        refreshChannel(key);
      } else if (action === 'rename-channel') {
        renameChannel(key, el.dataset.name);
      } else if (action === 'confirm') {
        confirmLogin(key);
      } else if (action === 'reconnect') {
        login(key);
      } else if (action === 'logout') {
        logout(key);
      } else if (action === 'toggle-creds') {
        showCreds = { ...showCreds, [key]: !showCreds[key] };
      } else if (action === 'remove-account') {
        removeAccount(key);
      } else if (action === 'toggle-enabled') {
        toggleAccountEnabled(key);
      } else if (action === 'add-account') {
        addAccount(key);
      } else if (action === 'edit-account') {
        const el = rootEl.querySelector(`[data-action="account-label"][data-key="${key}"]`);
        if (el) { el.contentEditable = 'true'; el.focus(); }
      }
    });

    rootEl.addEventListener('change', (e) => {
      const el = e.target.closest('[data-action="toggle-check"]');
      if (!el) return;
      toggleSelect(el.dataset.key);
    });

    rootEl.addEventListener('focusout', (e) => {
      const el = e.target.closest('[data-action="account-label"]');
      if (!el) return;
      updateAccountLabel(el.dataset.key, e.target.textContent?.trim() || '');
    });

    rootEl.addEventListener('input', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const providerId = el.dataset.provider;
      const field = el.dataset.field;
      if (el.dataset.action === 'cred-input') {
        if (!credentials[providerId]) {
          credentials = { ...credentials, [providerId]: { username: '', password: '' } };
        }
        credentials[providerId][field] = e.target.value;
        credentials = credentials;
        clearTimeout(credSaveTimer);
        credSaveTimer = setTimeout(() => saveCredentials(providerId), 800);
      } else if (el.dataset.action === 'proxy-input') {
        const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
        proxyPorts = { ...proxyPorts, [providerId]: val };
        clearTimeout(credSaveTimer);
        credSaveTimer = setTimeout(() => {
          window.api.setProviderProxyPort(providerId, parseInt(val, 10) || null);
          flashSaved();
        }, 800);
      } else if (el.dataset.action === 'workspace-input') {
        const val = e.target.value.trim();
        providerConfig = { ...providerConfig, [providerId]: { ...providerConfig[providerId], workspaceUrl: val } };
        clearTimeout(credSaveTimer);
        credSaveTimer = setTimeout(() => {
          window.api.setProviderConfig(providerId, providerConfig[providerId]);
          flashSaved();
        }, 800);
      }
    });

    window.api?.onChannelStatus?.(({ channelKey, isError }) => {
      channelErrors = { ...channelErrors, [channelKey]: isError };
      channelStatus = { ...channelStatus, [channelKey]: isError ? 'error' : 'connected' };
    });

    window.api?.onChannelHighFreq?.(({ channelKey, isHighFreq }) => {
      channelHighFreq = { ...channelHighFreq, [channelKey]: isHighFreq };
    });

    window.api?.onChannelDebug?.(({ channelKey, isError, isHighFreq, fetching, lastValues }) => {
      channelErrors = { ...channelErrors, [channelKey]: !!isError };
      channelStatus = {
        ...channelStatus,
        [channelKey]: isError ? 'error' : (lastValues?.length > 0 ? 'connected' : 'checking'),
      };
      channelHighFreq = { ...channelHighFreq, [channelKey]: !!isHighFreq };
      channelFetching = { ...channelFetching, [channelKey]: !!fetching };
    });
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="panel" bind:this={rootEl}>
  {#if showSaved}
    <div class="saved-toast">
      <Icon name="check" size={14} />
      已保存
    </div>
  {/if}
  <div class="panel-header">
    <div class="header-row">
      <div>
        <h1 class="panel-title">Coding Plan 管理</h1>
        <p class="panel-desc">登录账号后自动获取用量数据，每个账号独立隔离</p>
      </div>
      <div class="header-actions">
        <button class="btn-new-channel" onclick={openNewChannelDialog}>
          <Icon name="plus" size={14} />
          新建渠道
        </button>
        <button class="debug-toggle" class:on={debugMode} onclick={toggleDebug}>
          <span class="debug-toggle-dot"></span>
          DEBUG
        </button>
      </div>
    </div>
  </div>

  {#if showNewChannelDialog}
    <div class="dialog-overlay" onclick={() => showNewChannelDialog = false}>
      <div class="dialog" onclick={e => e.stopPropagation()}>
        <h2>新建渠道</h2>
        <div class="dialog-row">
          <label>渠道类型</label>
          <select bind:value={newChannel.type}>
            <option value="">请选择...</option>
            <option value="volcengine">火山方舟</option>
            <option value="opencodego">opencode Go</option>
            <option value="xfyun">讯飞星火</option>
          </select>
        </div>
        <div class="dialog-row">
          <label>显示名称</label>
          <input type="text" bind:value={newChannel.name} placeholder="输入账号显示名称" />
        </div>
        {#if newChannel.type === 'opencodego'}
          <div class="dialog-row">
            <label>Workspace URL</label>
            <input type="text" bind:value={newChannel.workspaceUrl} placeholder="填写你自己的 Workspace URL" />
          </div>
        {/if}
        <div class="dialog-actions">
          <button class="btn-cancel" onclick={() => showNewChannelDialog = false}>取消</button>
          <button class="btn-confirm" onclick={createNewChannel}>确定</button>
        </div>
      </div>
    </div>
  {/if}

  <div class="channel-grid">
    {#each Object.entries(PROVIDER_TYPES) as [type, pt]}
      {@const typeAccounts = accounts.filter(a => a.type === type)}
      {@const selectedId = selectedAccPerType[type]}
      {@const acc = typeAccounts.find(a => a.id === selectedId) || typeAccounts[0]}
      {@const connected = acc && loginStatus[acc.id] === 'connected'}
      {@const hasError = acc && loginStatus[acc.id] === 'error'}
      {@const checking = acc && loginStatus[acc.id] === 'checking'}
      {@const waiting = acc && loginStatus[acc.id] === 'waiting'}
      {@const isDisabled = acc && !acc.enabled}
      {@const isSelected = acc && isAccountSelected(acc)}
      <div class="channel-card" class:selected={isSelected} class:disabled={isDisabled}
         class:card-error={hasError}
        class:card-active={connected && isSelected && getChannelsForAccount(acc).some(k => channelHighFreq[k])}>
        <div class="card-top">
          {#if acc && !isDisabled}
            <button class="select-check" class:checked={isSelected}
              class:check-active={isSelected && getChannelsForAccount(acc).some(k => channelHighFreq[k])}
              class:check-error={isSelected && getChannelsForAccount(acc).some(k => channelErrors[k])}
              data-action="toggle-account-display" data-key={acc.id}
              use:accountDisplayToggleAction
              title={isSelected ? '关闭整个渠道显示' : '开启整个渠道显示'}>
              <Icon name="check" size={14} />
            </button>
          {:else if acc && !isDisabled}
            <div class="select-check disabled"><Icon name="check" size={14} /></div>
          {/if}
          <div class="card-icon">
            <Icon name="coding" size={22} />
          </div>
          <div class="card-info">
            <div class="card-name-row">
              <span class="card-name">{pt.name}</span>
              {#if typeAccounts.length > 0}
                <button class="account-selector" data-action="toggle-account-menu" data-type={type} use:accountMenuToggleAction>
                  {#if acc}
                    <span class="account-selector-label">{getAccountLabel(acc) || '未命名'}</span>
                  {:else}
                    <span class="account-selector-label">无账号</span>
                  {/if}
                  <span class="account-selector-arrow" class:open={showAccountMenu === type}>▾</span>
                </button>
              {/if}
            </div>
            <div class="card-subtitle">{pt.subtitle}</div>
          </div>
          {#if showAccountMenu === type}
            <div class="account-dropdown">
              {#each typeAccounts as tAcc}
                {@const tConn = loginStatus[tAcc.id] === 'connected'}
                {@const tMonitoring = isAccountSelected(tAcc)}
                {@const tDisabled = !tAcc.enabled}
                <div class="dropdown-item" class:active={tAcc.id === selectedId}>
                  <button class="dd-account-btn" data-action="select-account" data-key={tAcc.id} data-type={type} use:accountSelectAction>
                    <span class="dd-dot" class:monitoring={tMonitoring} class:disabled={tDisabled} title={tMonitoring ? '正在监控' : '未监控'}></span>
                    <span class="dd-label" data-action="account-label" data-key={tAcc.id} contenteditable="true">{getAccountLabel(tAcc) || tAcc.id}</span>
                    <span class="dd-status" class:connected={tConn} class:disabled={tDisabled}>
                      {tDisabled ? '已暂停' : getStatusText(tAcc.id)}
                    </span>
                  </button>
                  <button class="dd-action-btn edit" data-action="edit-account" data-key={tAcc.id} title="编辑名称">✎</button>
                  <button class="dd-action-btn" data-action="toggle-enabled" data-key={tAcc.id} title={tDisabled ? '启用账号' : '暂停账号'}>
                    {#if tDisabled}▶{:else}⏸{/if}
                  </button>
                  <button class="dd-action-btn remove" data-action="remove-account" data-key={tAcc.id} data-type={type} title="移除账号">✕</button>
                </div>
              {/each}
              <div class="dropdown-divider"></div>
              <button class="dropdown-item add" data-action="add-account" data-key={type}>
                <span class="dd-label">+ 新增账号</span>
              </button>
            </div>
          {/if}
          {#if acc}
            <div class="card-status"
                  class:status-ok={connected}
                  class:status-warn={!connected && !hasError && !waiting && !checking && !isDisabled}
                  class:status-wait={waiting || checking}
                  class:status-err={hasError}
                  class:status-disabled={isDisabled}>
              {#if isDisabled}
                已暂停
              {:else if confirming[acc.id]}
                检测中...
              {:else if checking}
                检测中...
               {:else if connected}
                账号已登录
              {:else if hasError}
                需重连
              {:else if waiting}
                等待确认
              {:else}
                未登录
              {/if}
            </div>
          {/if}
        </div>

        {#if acc}
          <div class="card-bottom">
            <span class="card-desc">{pt.description}</span>
            {#if !isDisabled}
              {#if connected}
                <div class="btn-group">
                  <button class="card-btn connected" disabled>账号已登录</button>
                  <button class="card-btn refresh" data-action="refresh" data-key={acc.id} disabled={confirming[acc.id]}>
                    刷新全部
                  </button>
                  <button class="card-btn logout" data-action="logout" data-key={acc.id} disabled={confirming[acc.id]}>
                    退出登录
                  </button>
                </div>
              {:else if hasError}
                <div class="btn-group">
                  <button class="card-btn reconnect" data-action="reconnect" data-key={acc.id}>
                    重新连接
                  </button>
                  <button class="card-btn logout" data-action="logout" data-key={acc.id} disabled={confirming[acc.id]}>
                    退出登录
                  </button>
                </div>
              {:else if waiting}
                <button class="card-btn confirm" data-action="confirm" data-key={acc.id} disabled={confirming[acc.id]}>
                  {confirming[acc.id] ? '检测中...' : '已登录？确认'}
                </button>
              {:else if checking}
                <button class="card-btn connected" disabled>正在检测账号</button>
              {:else}
                <button class="card-btn" data-action="login" data-key={acc.id}>
                  连接
                </button>
              {/if}
            {/if}
          </div>

          {#if connected && type === 'volcengine'}
            <div class="plan-select">
              {#each [[acc.id, 'Coding Plan', 'coding'], [acc.id + ':agent', 'Agent Plan', 'agent']] as [key, planLabel, planKey]}
                {#if planStatus[acc.id]?.[planKey] === 'active'}
                  {@const planChecked = isChannelSelected(key)}
                  {@const planHF = channelHighFreq[key]}
                  {@const planErr = channelErrors[key]}
                  {@const connectionStatus = channelStatus[key] || 'checking'}
                  <div class="plan-option" class:checked={planChecked}
                    class:plan-active={planChecked && planHF}
                    class:plan-error={planChecked && planErr}
                    data-action="toggle" data-key={key}>
                    <input type="checkbox" checked={planChecked}
                      data-action="toggle-check" data-key={key} />
                    <span class="plan-name">{getDisplayName(key)}<span class="plan-tag">{planLabel}</span></span>
                    {#if planChecked}
                      <span class="plan-connection" class:error={planErr} class:checking={connectionStatus === 'checking'}>
                        {planErr ? '未连接' : connectionStatus === 'connected' ? '已连接' : '检测中'}
                      </span>
                    {/if}
                    <button class="plan-edit-btn" data-action="rename-channel" data-key={key} data-name={getDisplayName(key)} title="修改名称">✎</button>
                    <button class="plan-refresh-btn" class:fetching={channelFetching[key]} data-action="refresh-channel" data-key={key} title="刷新此套餐">
                      <Icon name="refresh" size={12} />
                    </button>
                  </div>
                {/if}
              {/each}
              {#if planStatus[acc.id]?.coding !== 'active' && planStatus[acc.id]?.agent !== 'active'}
                <span class="plan-empty">
                  {planStatus[acc.id]?.coding === 'error' || planStatus[acc.id]?.agent === 'error'
                    ? '套餐获取失败，请刷新重试'
                    : planStatus[acc.id]?.coding === 'checking' || planStatus[acc.id]?.agent === 'checking' || !planStatus[acc.id]
                    ? '正在检测有效套餐…'
                    : '未发现有效套餐'}
                </span>
              {/if}
            </div>
          {/if}
          
          {#if connected && type === 'xfyun'}
            <div class="plan-select">
              {#each xfyunPlans[acc.id] || [] as plan}
                {@const key = `${acc.id}:${plan.name.replace('讯飞星火 ', '')}`}
                {@const planLabel = plan.name.replace('讯飞星火 ', '')}
                {@const planChecked = isChannelSelected(key)}
                {@const planHF = channelHighFreq[key]}
                {@const planErr = channelErrors[key]}
                {@const connectionStatus = channelStatus[key] || 'checking'}
                <div class="plan-option" class:checked={planChecked}
                  class:plan-active={planChecked && planHF}
                  class:plan-error={planChecked && planErr}
                  data-action="toggle" data-key={key}>
                  <input type="checkbox" checked={planChecked}
                    data-action="toggle-check" data-key={key} />
                  <span class="plan-name">{getDisplayName(key)}<span class="plan-tag">{planLabel}</span></span>
                  {#if planChecked}
                    <span class="plan-connection" class:error={planErr} class:checking={connectionStatus === 'checking'}>
                      {planErr ? '未连接' : connectionStatus === 'connected' ? '已连接' : '检测中'}
                    </span>
                  {/if}
                  <button class="plan-edit-btn" data-action="rename-channel" data-key={key} data-name={getDisplayName(key)} title="修改名称">✎</button>
                  <button class="plan-refresh-btn" class:fetching={channelFetching[key]} data-action="refresh-channel" data-key={key} title="刷新此套餐">
                    <Icon name="refresh" size={12} />
                  </button>
                </div>
              {/each}
              {#if !xfyunPlans[acc.id]?.length}
                <span class="plan-empty">{catalogStatus[acc.id] === 'checking' || !catalogStatus[acc.id] ? '正在检测有效套餐…' : '未发现有效套餐'}</span>
              {/if}
            </div>
          {/if}
          {#if type === 'volcengine'}
            <div class="creds-section">
              <div class="creds-header" data-action="toggle-creds" data-key={acc.id}>
                <span class="creds-label">自动登录</span>
                <span class="creds-hint">{credentials[acc.id]?.username ? '已保存' : '未设置'}</span>
                <span class="creds-arrow" class:open={showCreds[acc.id]}>▸</span>
              </div>
              {#if showCreds[acc.id]}
                <div class="creds-fields">
                  <input class="cred-input" type="text" placeholder="手机号/邮箱"
                    value={credentials[acc.id]?.username || ''}
                    data-action="cred-input" data-provider={acc.id} data-field="username"
                    onclick={(e) => e.stopPropagation()} />
                  <input class="cred-input" type="password" placeholder="密码"
                    value={credentials[acc.id]?.password || ''}
                    data-action="cred-input" data-provider={acc.id} data-field="password"
                    onclick={(e) => e.stopPropagation()} />
                  <div class="creds-note">保存后登录过期时自动尝试登录</div>
                </div>
              {/if}
            </div>
          {/if}
          {#if type === 'opencodego'}
            <div class="creds-section">
              <div class="proxy-row">
                <span class="creds-label">Workspace URL</span>
                <input class="proxy-input workspace-input" type="text" placeholder="填写你自己的 Workspace URL"
                  value={providerConfig[acc.id]?.workspaceUrl || ''}
                  data-action="workspace-input" data-provider={acc.id}
                  onclick={(e) => e.stopPropagation()} />
              </div>
              <div class="proxy-row">
                <span class="creds-label">代理端口</span>
                <input class="proxy-input" type="text" placeholder="留空使用直连"
                  value={proxyPorts[acc.id] || ''}
                  data-action="proxy-input" data-provider={acc.id}
                  onclick={(e) => e.stopPropagation()} />
              </div>
              <div class="creds-note" style="margin-top:4px">GitHub/Google 登录在弹出的浏览器中手动完成，Cookie 自动独立保存，切换账号不会登出</div>
            </div>
          {/if}
        {:else}
          <div class="card-bottom">
            <span class="card-desc">点击下方添加账号</span>
            <button class="card-btn" data-action="add-account" data-key={type}>新增账号</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  :root {
    --sel: #0A84FF;
    --sel-bg: rgba(10, 132, 255, 0.12);
    --act: #FF453A;
    --act-bg: rgba(255, 69, 58, 0.12);
    --warn: #FF9F0A;
    --warn-bg: rgba(255, 159, 10, 0.12);
  }

  .panel {
    padding: 32px;
    max-width: 720px;
    margin: 0 auto;
    height: 100vh;
    overflow-y: auto;
    position: relative;
  }

  .saved-toast {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 100;
    padding: 8px 20px; border-radius: var(--radius-btn);
    background: var(--sel-bg); border: 1px solid var(--sel);
    color: var(--sel); font-size: 13px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
    animation: toast-in 0.2s ease;
  }

  @keyframes toast-in { from { opacity: 0; } to { opacity: 1; } }

  .panel-header { margin-bottom: 28px; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .panel-title { font-size: 22px; font-weight: 600; }
  .panel-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }

  .debug-toggle {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--card);
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    letter-spacing: 1px; cursor: pointer; transition: all 0.15s;
  }
  .debug-toggle:hover { border-color: var(--sel); }
  .debug-toggle.on { border-color: var(--act); color: var(--act); background: var(--act-bg); }
  .debug-toggle-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-secondary); transition: all 0.15s; }
  .debug-toggle.on .debug-toggle-dot { background: var(--act); box-shadow: 0 0 6px var(--act); }

  .header-actions { display: flex; gap: 8px; align-items: center; }

  .btn-new-channel {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 6px;
    background: var(--sel); border: none;
    color: #fff; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
  }
  .btn-new-channel:hover { opacity: 0.9; }

  .channel-grid { display: flex; flex-direction: column; gap: 10px; }

  .channel-card {
    background: var(--card); border: 2px solid var(--border);
    border-radius: var(--radius-card); padding: 16px 20px; transition: all 0.15s;
  }
  .channel-card:hover { border-color: color-mix(in srgb, var(--sel) 40%, var(--border)); }
  .channel-card.selected { border-color: var(--sel); background: var(--sel-bg); }
  .channel-card.card-error { border-color: var(--warn); }
  .channel-card.card-active { border-color: var(--act); }
  .channel-card.disabled { opacity: 0.5; }

  .card-top { display: flex; align-items: center; gap: 12px; position: relative; }
  .card-icon {
    width: 40px; height: 40px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    background: var(--card-hover);
  }
  .card-info { flex: 1; min-width: 0; }
  .card-name-row { display: flex; align-items: center; gap: 6px; }
  .card-name { font-weight: 500; font-size: 15px; }
  .card-subtitle { font-size: 12px; color: var(--text-secondary); }

  .account-selector {
    display: flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 6px;
    background: var(--card-hover); border: 1px solid var(--border);
    cursor: pointer; transition: all 0.15s; font-size: 12px;
  }
  .account-selector:hover { border-color: var(--sel); }
  .account-selector-label { color: var(--text-primary); font-weight: 500; }
  .account-selector-arrow { font-size: 10px; color: var(--text-secondary); transition: transform 0.15s; }
  .account-selector-arrow.open { transform: rotate(180deg); }

  .account-dropdown {
    position: absolute; top: 100%; left: 52px; z-index: 50;
    margin-top: 4px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 4px; min-width: 260px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .dropdown-item {
    display: flex; align-items: center; gap: 4px;
    padding: 0; border-radius: 6px; width: 100%;
    font-size: 12px; color: var(--text-primary);
    background: transparent;
  }
  .dropdown-item:hover { background: var(--card-hover); }
  .dropdown-item.active { background: var(--sel-bg); }
  .dd-account-btn {
    display: flex; align-items: center; gap: 8px; flex: 1;
    padding: 7px 10px; background: transparent; border: none; color: var(--text-primary);
    font-size: 12px; text-align: left; cursor: pointer;
  }
  .dd-action-btn {
    padding: 4px 6px; background: transparent; border: none;
    color: var(--text-secondary); font-size: 11px; cursor: pointer; border-radius: 4px;
  }
  .dd-action-btn:hover { color: var(--text-primary); background: var(--border); }
  .dd-action-btn.edit:hover { color: var(--sel); }
  .dd-action-btn.remove:hover { color: var(--act); }
  .dd-label[contenteditable="true"] { outline: 1px solid var(--sel); border-radius: 3px; padding: 0 4px; background: var(--bg); }
  .dd-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-secondary); opacity: 0.3; }
  .dd-dot.monitoring { background: var(--sel); opacity: 1; box-shadow: 0 0 6px color-mix(in srgb, var(--sel) 70%, transparent); }
  .dd-dot.disabled { background: var(--text-secondary); opacity: 0.5; }
  .dd-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dd-status { font-size: 11px; opacity: 0.6; flex-shrink: 0; }
  .dd-status.connected { color: var(--sel); opacity: 1; }
  .dd-status.disabled { color: var(--text-secondary); }
  .dropdown-divider { height: 1px; background: var(--border); margin: 4px 0; }
  .dropdown-item.add { color: var(--sel); font-weight: 500; cursor: pointer; padding: 7px 10px; }
  .dropdown-item.add:hover { background: var(--card-hover); }

  .select-check {
    width: 28px; height: 28px; border-radius: 6px; border: 2px solid var(--border);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    background: transparent; color: transparent; transition: all 0.15s; cursor: pointer;
  }
  .select-check.checked { border-color: var(--sel); background: var(--sel); color: white; }
  .select-check.disabled { opacity: 0.2; cursor: not-allowed; }
  .select-check.check-active.checked { border-color: var(--act); background: var(--act); }
  .select-check.check-error.checked { border-color: var(--warn); background: var(--warn); }

  .card-status { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 4px; flex-shrink: 0; }
  .card-status.status-ok { background: var(--sel-bg); color: var(--sel); }
  .card-status.status-warn { background: var(--warn-bg); color: var(--warn); }
  .card-status.status-wait { background: var(--sel-bg); color: var(--sel); }
  .card-status.status-err { background: var(--warn-bg); color: var(--warn); }
  .card-status.status-disabled { background: rgba(134, 134, 139, 0.08); color: var(--text-secondary); }

  .card-bottom {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);
  }
  .card-desc { font-size: 13px; color: var(--text-secondary); }

  .btn-group { display: flex; gap: 6px; }
  .card-btn {
    padding: 6px 16px; border-radius: var(--radius-btn); font-size: 13px; font-weight: 500;
    background: var(--sel); color: white; transition: all 0.15s;
  }
  .card-btn:hover:not(:disabled) { opacity: 0.85; }
  .card-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .card-btn.connected { background: var(--sel-bg); color: var(--sel); }
  .card-btn.refresh { background: var(--sel-bg); color: var(--sel); }
  .card-btn.confirm { background: var(--warn); color: white; }
  .card-btn.confirm:hover:not(:disabled) { opacity: 0.85; }
  .card-btn.reconnect { background: var(--warn); color: white; }
  .card-btn.reconnect:hover { opacity: 0.85; }
  .card-btn.logout { background: transparent; color: var(--text-secondary); box-shadow: inset 0 0 0 1px var(--border); }

  .plan-select {
    display: flex; gap: 8px; margin-top: 12px; padding-top: 12px;
    border-top: 1px solid var(--border); flex-wrap: wrap;
  }
  .plan-option {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    padding: 6px 12px; border-radius: var(--radius-btn);
    background: var(--card-hover); border: 1px solid var(--border);
    font-size: 13px; transition: all 0.15s;
  }
  .plan-option:hover { border-color: var(--sel); }
  .plan-option.checked { border-color: var(--sel); background: var(--sel-bg); }
  .plan-option.plan-active { border-color: var(--act); background: var(--act-bg); }
  .plan-option.plan-error { border-color: var(--warn); background: var(--warn-bg); }
  .plan-option input { display: none; }
  .plan-name { color: var(--text-primary); }
  .plan-tag { font-size: 10px; color: var(--text-secondary); background: rgba(134, 134, 139, 0.1); padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
  .plan-connection { font-size: 10px; color: var(--success); white-space: nowrap; }
  .plan-connection.error { color: var(--danger); }
  .plan-connection.checking { color: var(--text-secondary); }
  .plan-empty { color: var(--text-secondary); font-size: 12px; padding: 4px 0; }
  .expired-tag { color: var(--warn); background: var(--warn-bg); }
  .plan-option.expired { opacity: 0.55; border-color: var(--warn); }
  .plan-refresh-btn {
    opacity: 0.4; padding: 2px 4px; border-radius: 3px;
    color: var(--sel); background: transparent; transition: all 0.15s;
    display: flex; align-items: center; margin-left: auto;
  }
  .plan-option:hover .plan-refresh-btn { opacity: 0.7; }
  .plan-refresh-btn:hover { opacity: 1 !important; background: var(--card-hover); }
  .plan-refresh-btn.fetching { opacity: 1; animation: spin 1s linear infinite; }
  .plan-edit-btn { padding: 2px 4px; color: var(--text-secondary); background: transparent; font-size: 11px; opacity: 0.55; }
  .plan-edit-btn:hover { color: var(--sel); opacity: 1; background: var(--card-hover); }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .creds-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .creds-header { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--text-secondary); user-select: none; }
  .creds-header:hover { color: var(--text-primary); }
  .creds-label { font-weight: 500; }
  .creds-hint { font-size: 11px; opacity: 0.6; }
  .creds-arrow { margin-left: auto; transition: transform 0.15s; font-size: 11px; }
  .creds-arrow.open { transform: rotate(90deg); }
  .creds-fields { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .cred-input {
    padding: 6px 10px; border-radius: 6px; font-size: 13px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text-primary); outline: none;
  }
  .cred-input:focus { border-color: var(--sel); }
  .cred-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
  .creds-note { font-size: 11px; color: var(--text-secondary); opacity: 0.6; }

  .proxy-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .proxy-input {
    width: 80px; padding: 4px 8px; border-radius: 6px; font-size: 13px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text-primary);
    outline: none; font-variant-numeric: tabular-nums;
  }
  .proxy-input:focus { border-color: var(--sel); }
  .workspace-input { width: 320px; font-size: 11px; }
  .dialog-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .dialog {
    background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px;
    padding: 24px; width: 400px; max-width: 90vw;
  }
  .dialog h2 { margin: 0 0 16px; font-size: 16px; color: var(--text-primary); }
  .dialog-row { margin-bottom: 12px; }
  .dialog-row label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
  .dialog-row input, .dialog-row select {
    width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text-primary);
    outline: none; box-sizing: border-box;
  }
  .dialog-row input:focus, .dialog-row select:focus { border-color: var(--sel); }
  .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .btn-cancel { padding: 8px 16px; border-radius: 6px; background: var(--bg); border: 1px solid var(--border); color: var(--text-secondary); cursor: pointer; font-size: 13px; }
  .btn-confirm { padding: 8px 16px; border-radius: 6px; background: var(--sel); border: none; color: #fff; cursor: pointer; font-size: 13px; }
  .btn-confirm:hover { opacity: 0.9; }
</style>
