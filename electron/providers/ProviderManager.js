const { BrowserWindow, Menu, session } = require('electron');
const LoginObserver = require('./LoginObserver');
const { requiredCodingChannels } = require('../compact-overview');

class ProviderManager {
  #providers = new Map();
  #scrapers = new Map();
  #mainWindow = null;
  #pluginWindows = null;
  #monitorWindow = null;
  #configStore = null;
  constructor(configStore = null) {
    this.#configStore = configStore;
  }

  setMainWindow(win) {
    this.#mainWindow = win;
  }

  setConfigStore(store) {
    this.#configStore = store;
  }

  setMonitorWindow(win) {
    this.#monitorWindow = win;
  }

  resendLatestData() {
    const cache = this.getCachedData();
    for (const [id, provider] of this.#providers) {
      const entry = cache[id];
      if (provider.status === 'connected' && entry?.data) {
        entry.data._fetchTime = entry.timestamp;
        this.#sendUpdate(id, entry.data);
      } else if (provider.status === 'error' || provider.status === 'unauthorized') {
        this.#sendUpdate(id, null, provider.status === 'error' ? '连接失败' : '未登录');
      } else if (entry?.data) {
        entry.data._fetchTime = entry.timestamp;
        this.#sendUpdate(id, entry.data);
      }
    }
    this.sendAllChannelDebug();
  }

  register(provider) {
    this.#providers.set(provider.id, provider);
    this.#applyProviderConfig(provider.id);
  }

  unregister(providerId) {
    this.#providers.delete(providerId);
    const scraper = this.#scrapers.get(providerId);
    if (scraper) {
      scraper.destroy();
      this.#scrapers.delete(providerId);
    }
    this.#initializedProviders.delete(providerId);
    this.setVisibleChannels(this.#configStore?.get('selectedProviders') || []);
  }

  getProvider(id) {
    return this.#providers.get(id);
  }

  getOrCreateScraper(providerId) {
    return this.#getOrCreateScraper(providerId);
  }

  getScraperIfActive(providerId) {
    const scraper = this.#scrapers.get(providerId);
    if (scraper && scraper.hasActiveWindow()) return scraper;
    return null;
  }

  async dumpCookies(providerId) {
    const scraper = this.#scrapers.get(providerId);
    if (!scraper) return [];
    return await scraper.getCookies();
  }

  async injectCookies(providerId, cookies) {
    const scraper = this.#getOrCreateScraper(providerId);
    return await scraper.setCookies(cookies);
  }

  getAllProviders() {
    return Array.from(this.#providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      authType: p.authType,
      status: p.status,
      planStatus: p.planStatus || null,
      catalogStatus: p.catalogStatus || null,
      availablePlans: p.availablePlans || [],
      lastError: p.lastError || null,
      source: p.source || null,
      directAuth: p.isDirectAuth?.() || false,
    }));
  }

  async getLoginInfo(providerId) {
    const cached = (this.#configStore?.get('providerLoginInfo') || {})[providerId] || null;
    const provider = this.#providers.get(providerId);
    const scraper = this.#scrapers.get(providerId);
    if (!provider || provider.status !== 'connected' || !scraper?.hasActiveWindow()) return cached;
    return await this.#captureLoginInfo(providerId, scraper) || cached;
  }

  async #captureLoginInfo(providerId, scraper) {
    if (this.#providers.get(providerId)?.queryApiAuth) return null;
    try {
      const info = await scraper.executeScript(() => {
        const text = document.body.innerText || '';
        const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
        const phoneMatch = text.match(/1[3-9]\d{9}/);
        const nameEl = document.querySelector('[class*="user"] [class*="name"], [class*="avatar"] [title], [data-testid*="user"]');
        return {
          email: emailMatch ? emailMatch[0] : null,
          phone: phoneMatch ? phoneMatch[0] : null,
          displayName: nameEl ? nameEl.textContent.trim() : null,
        };
      });
      if (!info || (!info.email && !info.phone && !info.displayName)) return null;
      const all = this.#configStore?.get('providerLoginInfo') || {};
      all[providerId] = info;
      this.#configStore?.set('providerLoginInfo', all);
      return info;
    } catch (_) {
      return null;
    }
  }

  getAllChannelStates() {
    const states = {};
    for (const channelKey of this.#visibleChannels) {
      const state = this.#channelState.get(channelKey);
      states[channelKey] = {
        isError: (state?.consecutiveErrors || 0) > 0,
        status: (state?.consecutiveErrors || 0) > 0
          ? 'error'
          : (state?.lastValues?.length > 0 ? 'connected' : 'checking'),
        isHighFreq: (state?.highFreqCount || 0) > 0,
        fetching: state?.fetching || false,
        consecutiveErrors: state?.consecutiveErrors || 0,
        nextFetchAt: state?.nextFetchAt || 0,
      };
    }
    return states;
  }

  async checkAuth(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider) return { error: 'Provider not found' };
    if (provider.status === 'waiting' || this.#providerFetching.get(providerId)) {
      return { status: provider.status };
    }

    const scraper = this.#getOrCreateScraper(providerId);
    try {
      const result = await provider.checkAuth(scraper);
      if (result.status === 'connected') await this.#captureLoginInfo(providerId, scraper);
      this.#sendUpdate(providerId, result.data);
      return result;
    } catch (e) {
      console.error(`[ProviderManager] checkAuth ${providerId} error:`, e.message);
      provider.status = 'error';
      this.#sendUpdate(providerId, null, e.message);
      return { status: 'error', error: e.message };
    }
  }

  // Signs this account out so the next 连接 starts a fresh login (e.g. after logging into the wrong account):
  // stops its work, wipes its browser session and drops saved credentials, login info and cached usage.
  // The channel selection is kept and resumes once the account is connected again.
  async logout(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider) return { success: false, error: 'Provider not found' };
    this.#scrapers.get(providerId)?.destroy();
    this.#scrapers.delete(providerId);
    this.#providerFetching.delete(providerId);
    this.#backgroundProviders.delete(providerId);
    // Keep the background tick from re-checking (and auto-logging into) this account until 连接 is pressed.
    this.#initializedProviders.add(providerId);
    const ses = session.fromPartition(`persist:${providerId}`);
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    provider.authStore?.remove?.(providerId);
    provider.status = 'unauthorized';
    provider.lastError = null;
    provider.usageFetching = false;
    if (provider.planStatus) provider.planStatus = { coding: 'unknown', agent: 'unknown' };
    if (this.#configStore) {
      for (const key of ['providerLoginInfo', 'providerCredentials']) {
        const all = this.#configStore.get(key) || {};
        if (providerId in all) { delete all[providerId]; this.#configStore.set(key, all); }
      }
      const cache = this.#configStore.get('providerCache') || {};
      for (const key of Object.keys(cache)) if (key.split(':')[0] === providerId) delete cache[key];
      this.#configStore.set('providerCache', cache);
    }
    for (const [key, st] of this.#channelState) {
      if (key.split(':')[0] !== providerId) continue;
      Object.assign(st, { lastValues: [], prevValues: [], isInfinite: [], highFreqCount: 0, nextFetchAt: 0, fetching: false, consecutiveErrors: 0 });
    }
    this.#sendUpdate(providerId);
    this.sendAllChannelDebug();
    return { success: true };
  }

  async login(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider) return { error: 'Provider not found' };
    if (this.#providerFetching.get(providerId)) return { success: false, error: '正在处理此账号，请稍后重试' };
    this.#providerFetching.set(providerId, true);
    const scraper = this.#getOrCreateScraper(providerId);
    scraper.stopLoginWatch();
    try {
      const result = await provider.checkAuth(scraper);
      if (result.status === 'connected') {
        this.#sendUpdate(providerId, result.data || await provider.fetchData(scraper));
        await this.#captureLoginInfo(providerId, scraper);
        scraper.hideLoginWindows();
        return { success: true, status: 'connected' };
      }
      if (provider.isDirectAuth?.()) {
        this.#sendUpdate(providerId, null, result.error);
        return { success: false, status: result.status, error: result.error };
      }
      await scraper.loadPage(provider.consoleUrl);
      scraper.showWindow(); provider.status = 'waiting'; provider.lastError = null;
      this.#sendUpdate(providerId);
      const complete = () => this.confirmLogin(providerId);
      const expired = () => {
        if (provider.status !== 'waiting') return;
        provider.status = 'unauthorized';
        this.#sendUpdate(providerId, null, '登录等待已结束，请重新连接');
      };
      if (provider.queryApiAuth) scraper.watchQueryLogin(async () => {
        const result = await provider.checkAuth(scraper);
        if (result.status === 'connected') return true;
        provider.status = 'waiting';
        return false;
      }, complete, expired);
      else scraper.watchLogin(provider.readLoginState, complete, expired);
      return { needsBrowser: true };
    } catch (error) {
      provider.status = 'error';
      this.#sendUpdate(providerId, null, error.message);
      return { success: false, error: error.message };
    } finally { this.#providerFetching.delete(providerId); }
  }

  async confirmLogin(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider) return { error: 'Provider not found' };

    const scraper = this.#getOrCreateScraper(providerId);
    if (this.#providerFetching.get(providerId)) return { success: false, message: '正在获取数据，请稍后重试' };
    this.#providerFetching.set(providerId, true);
    scraper.stopLoginWatch();
    try {
      const result = await provider.checkAuth(scraper);
      if (result.status === 'connected') {
        scraper.hideLoginWindows();
        provider.status = 'connected';
        await this.#captureLoginInfo(providerId, scraper);
        this.#sendUpdate(providerId);

        try {
          const data = result.data || await provider.fetchData(scraper);
          this.#sendUpdate(providerId, data);
        } catch (e) {
          console.error(`[ProviderManager] fetchData after confirm error:`, e.message);
          this.#sendUpdate(providerId, null, e.message);
          if (provider.status === 'unauthorized') return { success: false, status: 'unauthorized', error: e.message };
        }

        return { success: true, status: 'connected' };
      }

      provider.status = result.status;
      this.#sendUpdate(providerId, null, result.error || '未登录');
      return { success: false, status: result.status, message: result.error || '未检测到登录信息，请重试' };
    } catch (e) {
      console.error(`[ProviderManager] confirmLogin ${providerId} error:`, e.message);
      provider.status = 'error';
      this.#sendUpdate(providerId, null, e.message);
      return { success: false, status: 'error', message: e.message };
    } finally {
      this.#providerFetching.delete(providerId);
    }
  }

  async fetchData(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider) return { error: 'Provider not found' };

    if (this.#providerFetching.get(providerId)) {
      return null;
    }
    this.#providerFetching.set(providerId, true);

    try {
      const scraper = this.#getOrCreateScraper(providerId);
      const channels = this.#visibleChannels.filter(k => k.split(':')[0] === providerId);
      if (channels.length > 0 && provider.fetchChannel) {
        for (const channelKey of channels) {
            const st = this.#channelState.get(channelKey);
            if (st) { st.fetching = true; st.startedAt = Date.now(); }
            this.#sendChannelDebug(channelKey);
            try {
              const result = await provider.fetchChannel(channelKey, scraper);
              if (!result?.plans || result.plans.length === 0) {
                throw new Error('empty plans');
              }
              provider.status = 'connected';
              this.#mergeChannelData(providerId, channelKey, result);
              if (st) {
                st.prevValues = st.lastValues || [];
                const ext = this.#extractValues(result, channelKey);
                st.lastValues = ext.values;
                st.isInfinite = ext.isInfinite;
                st.consecutiveErrors = 0;

                const isInf = st.isInfinite && st.isInfinite[0];
                const hasPrev = st.prevValues && st.prevValues.length > 0;
                if (!isInf && ((hasPrev && this.#detectRise(st.prevValues, st.lastValues)) || (!hasPrev && st.lastValues[0].pct > 0))) {
                  st.highFreqCount = ProviderManager.HIGH_FREQ_SUSTAIN;
                  st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
                  this.#sendChannelHighFreq(channelKey, true);
                } else if (st.highFreqCount > 0) {
                  st.highFreqCount--;
                  st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
                  if (st.highFreqCount === 0) this.#sendChannelHighFreq(channelKey, false);
                } else {
                  st.nextFetchAt = this.#nextFetchAt(channelKey, st, false);
                }
              }
              this.#sendChannelStatus(channelKey, false);
            } catch (e) {
              try { console.error(`[ProviderManager] manual fetchChannel ${channelKey}:`, e.message); } catch(_) {}
              if (st) {
                st.consecutiveErrors = (st.consecutiveErrors || 0) + 1;
                this.#sendChannelStatus(channelKey, true);
                st.nextFetchAt = this.#nextFetchAt(channelKey, st, false, 30000);
              }
            } finally {
              if (st) st.fetching = false;
              this.#sendChannelDebug(channelKey);
            }
        }
        this.#sendUpdate(providerId);
      } else {
        const data = await provider.fetchData(scraper);
        provider.status = 'connected';
        this.#sendUpdate(providerId, data);
      }
      scraper.releaseWindow();
      return null;
    } catch (e) {
      try { console.error(`[ProviderManager] fetchData error ${providerId}:`, e.message); } catch(_) {}
      provider.status = 'error';
      this.#sendUpdate(providerId, null, e.message);
      return { error: e.message };
    } finally {
      this.#providerFetching.delete(providerId);
    }
  }

  async fetchChannelByKey(channelKey) {
    const providerId = channelKey.split(':')[0];
    const provider = this.#providers.get(providerId);
    if (!provider || !provider.fetchChannel) return { error: 'Provider not found' };

    if (this.#providerFetching.get(providerId)) {
      return null;
    }
    this.#providerFetching.set(providerId, true);

    const st = this.#channelState.get(channelKey);
    if (!st) {
      this.#providerFetching.delete(providerId);
      return { error: 'Channel not visible' };
    }

    st.fetching = true;
    st.startedAt = Date.now();
    this.#sendChannelDebug(channelKey);

    provider.usageFetching = true;
    provider.lastError = null;
    this.#sendUpdate(providerId);
    try {
      const scraper = this.#getOrCreateScraper(providerId);
      const result = await provider.fetchChannel(channelKey, scraper);
      if (scraper.signal.aborted || this.#channelState.get(channelKey) !== st || !this.#visibleChannels.includes(channelKey)) return null;
      if (!result.plans || result.plans.length === 0) {
        throw new Error('empty plans');
      }

      provider.status = 'connected';
      st.consecutiveErrors = 0;
      this.#sendChannelStatus(channelKey, false);
      this.#mergeChannelData(providerId, channelKey, result);

      const mergedData = this.#configStore?.get('providerCache')?.[providerId]?.data;
      const ext = mergedData ? this.#extractValues(mergedData, channelKey) : this.#extractValues(result, channelKey);
      const values = ext.values;
      const prevValues = st.lastValues;
      st.prevValues = prevValues || [];
      st.lastValues = values;
      st.isInfinite = ext.isInfinite;

      const isInf = st.isInfinite && st.isInfinite[0];
      const hasPrev = prevValues && prevValues.length > 0;
      const rose = !isInf && ((hasPrev && this.#detectRise(prevValues, values)) || (!hasPrev && values[0].pct > 0));
      if (rose) {
        st.highFreqCount = ProviderManager.HIGH_FREQ_SUSTAIN;
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
        this.#sendChannelHighFreq(channelKey, true);
      } else if (st.highFreqCount > 0) {
        st.highFreqCount--;
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
        if (st.highFreqCount === 0) {
          this.#sendChannelHighFreq(channelKey, false);
        }
      } else {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false);
      }
      this.#sendChannelDebug(channelKey);
      return { success: true };
    } catch (e) {
      try { console.error(`[ProviderManager] fetchChannelByKey ${channelKey}:`, e.message); } catch(_) {}
      st.consecutiveErrors = (st.consecutiveErrors || 0) + 1;
      this.#sendChannelStatus(channelKey, true);
      this.#sendUpdate(providerId);
      if (st.consecutiveErrors <= 3) {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false, 30000);
      } else {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false);
      }
      this.#sendChannelDebug(channelKey);
      return { error: e.message };
    } finally {
      st.fetching = false;
      provider.usageFetching = false;
      this.#sendUpdate(providerId);
      this.#providerFetching.delete(providerId);
      this.#sendChannelDebug(channelKey);
      const scraper = this.#scrapers.get(providerId);
      if (scraper) scraper.releaseWindow();
    }
  }

  async fetchAll() {
    const results = {};
    for (const [id, provider] of this.#providers) {
      if (provider.status === 'connected') {
        results[id] = await this.fetchData(id);
      }
    }
    return results;
  }

  #getOrCreateScraper(providerId) {
    if (this.#scrapers.get(providerId)?.signal.aborted) this.#scrapers.delete(providerId);
    if (!this.#scrapers.has(providerId)) {
      const scraper = new ScraperSession(providerId);
      const ports = this.#configStore?.get('providerProxyPorts') || {};
      if (ports[providerId]) scraper.setProxyPort(ports[providerId]);
      this.#scrapers.set(providerId, scraper);
      this.#applyProviderConfig(providerId);
    }
    return this.#scrapers.get(providerId);
  }

  setProxyPort(providerId, port) {
    const ports = this.#configStore?.get('providerProxyPorts') || {};
    if (port) ports[providerId] = port;
    else delete ports[providerId];
    if (this.#configStore) this.#configStore.set('providerProxyPorts', ports);
    const scraper = this.#scrapers.get(providerId);
    if (scraper) scraper.setProxyPort(port || null);
  }

  setProviderConfig(providerId, config) {
    if (!this.#configStore) return;
    const provider = this.#providers.get(providerId);
    const { AUTH_FIELDS } = require('./CodingPlanAuthStore');
    const metadata = Object.fromEntries(Object.entries(config).filter(([key]) => !AUTH_FIELDS.includes(key) && !key.startsWith('has')));
    const secrets = Object.fromEntries(AUTH_FIELDS.filter(key => config[key]).map(key => [key, config[key]]));
    if (Object.keys(secrets).length) provider.authStore.write(providerId, secrets);
    const all = this.#configStore.get('providerConfig') || {};
    all[providerId] = { ...all[providerId], ...metadata };
    this.#configStore.set('providerConfig', all);
    this.#applyProviderConfig(providerId);
    if (provider.queryApiAuth) {
      provider.lastError = null;
    }
  }

  getProviderConfig(providerId) {
    const config = this.#configStore?.get('providerConfig')?.[providerId] || {};
    return { ...config, ...(this.#providers.get(providerId)?.authStore?.flags?.(providerId) || {}) };
  }

  #applyProviderConfig(providerId) {
    const provider = this.#providers.get(providerId);
    if (!provider || !this.#configStore) return;
    const pc = this.#configStore.get('providerConfig')?.[providerId] || {};
    provider.setConfig?.(pc);
    if (provider.setWorkspaceUrl) provider.setWorkspaceUrl(pc.workspaceUrl);
  }

  applyProviderConfig(providerId) { this.#applyProviderConfig(providerId); }

  #sendUpdate(providerId, data = null, error = null) {
    this.#reconcileAvailableChannels(providerId);
    const provider = this.#providers.get(providerId);
    const payload = {
      providerId,
      data,
      error: error || provider?.lastError || null,
      fetching: !!provider?.usageFetching,
      status: provider?.status || null,
      planStatus: provider?.planStatus || null,
      catalogStatus: provider?.catalogStatus || null,
      availablePlans: provider?.availablePlans || [],
    };
    if (data && this.#configStore) {
      const hasContent = !data.plans || data.plans.length > 0;
      if (hasContent) {
        try {
          const cache = this.#configStore.get('providerCache') || {};
          cache[providerId] = { data, timestamp: Date.now() };
          this.#configStore.set('providerCache', cache);
        } catch (_) {}
      }
    }
    if (this.#mainWindow && !this.#mainWindow.isDestroyed()) {
      this.#mainWindow.webContents.send('provider-update', payload);
    }
    if (this.#monitorWindow && !this.#monitorWindow.isDestroyed()) {
      this.#monitorWindow.webContents.send('provider-update', payload);
    }
    if (this.#pluginWindows) {
      for (const [, win] of this.#pluginWindows) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('provider-update', payload);
        }
      }
    }
  }

  #reconcileAvailableChannels(providerId) {
    if (!this.#configStore) return;
    const provider = this.#providers.get(providerId);
    if (!provider) return;

    const type = providerId.split('_')[0];
    let validChannels = null;
    if (type === 'volcengine') {
      const statuses = provider.planStatus || {};
      const settled = ['coding', 'agent'].every(key =>
        ['active', 'unavailable'].includes(statuses[key])
      );
      if (!settled) return;
      validChannels = [];
      if (statuses.coding === 'active') validChannels.push(providerId);
      if (statuses.agent === 'active') validChannels.push(`${providerId}:agent`);
    } else if (type === 'xfyun') {
      if (provider.catalogStatus !== 'ready' && provider.catalogStatus !== 'empty') return;
      validChannels = (provider.availablePlans || []).map(plan =>
        `${providerId}:${plan.name.replace('讯飞星火 ', '')}`
      );
    } else {
      return;
    }

    const valid = new Set(validChannels);
    const accountChannels = this.#configStore.get('accountChannels') || {};
    const currentAccountChannels = accountChannels[providerId] || [];
    const nextAccountChannels = currentAccountChannels.filter(key => valid.has(key));
    const selectedProviders = this.#configStore.get('selectedProviders') || [];
    const nextSelectedProviders = selectedProviders.filter(key =>
      key.split(':')[0] !== providerId || valid.has(key)
    );

    const accountChanged = JSON.stringify(currentAccountChannels) !== JSON.stringify(nextAccountChannels);
    const selectedChanged = JSON.stringify(selectedProviders) !== JSON.stringify(nextSelectedProviders);
    if (!accountChanged && !selectedChanged) return;

    if (accountChanged) {
      accountChannels[providerId] = nextAccountChannels;
      this.#configStore.set('accountChannels', accountChannels);
    }
    if (selectedChanged) {
      this.#configStore.set('selectedProviders', nextSelectedProviders);
      this.setVisibleChannels(nextSelectedProviders);
    }

    const windows = [this.#mainWindow, this.#monitorWindow, ...(this.#pluginWindows ? Array.from(this.#pluginWindows.values()) : [])];
    for (const win of windows) {
      if (!win || win.isDestroyed()) continue;
      if (accountChanged) win.webContents.send('account-channels-change', accountChannels);
      if (selectedChanged) win.webContents.send('selected-providers-change', nextSelectedProviders);
    }
  }

  setPluginWindows(windows) {
    this.#pluginWindows = windows;
  }

  reconcileAvailableChannels() {
    for (const providerId of this.#providers.keys()) {
      this.#reconcileAvailableChannels(providerId);
    }
  }

  getCachedData() {
    if (!this.#configStore) return {};
    const cache = this.#configStore.get('providerCache') || {};
    const result = {};
    for (const [pid, entry] of Object.entries(cache)) {
      if (entry.data) {
        result[pid] = { data: entry.data, timestamp: entry.timestamp };
      }
    }
    return result;
  }

  #channelTimers = new Map();
  #channelState = new Map();
  #visibleChannels = [];
  #tickInterval = null;
  #providerFetching = new Map();
  #autoRefreshEnabled = false;
  #initializedProviders = new Set();
  #backgroundProviders = new Set();
  static NORMAL_INTERVAL = 5 * 60 * 1000;
  static HIGH_FREQ_INTERVAL = 60 * 1000;
  static HIGH_FREQ_SUSTAIN = 4;
  #refreshInterval(channelKey, highFrequency) {
    return highFrequency ? ProviderManager.HIGH_FREQ_INTERVAL : ProviderManager.NORMAL_INTERVAL;
  }

  #nextFetchAt(channelKey, st, highFrequency, retryMs) {
    return Date.now() + (retryMs ?? this.#refreshInterval(channelKey, highFrequency));
  }

  setVisibleChannels(channels) {
    channels = requiredCodingChannels(this.#configStore?.get('plugins') || [],
      this.#configStore?.get('compactOverview'), channels || [],
      this.#configStore?.get('channelAccounts') || []).filter(key => this.#providers.has(key.split(':')[0]));
    const removedProviders = new Set(this.#visibleChannels.filter(key => !channels.includes(key)).map(key => key.split(':')[0]));
    this.#visibleChannels = channels;
    for (const id of removedProviders) {
      this.#initializedProviders.delete(id);
      if (this.#backgroundProviders.has(id)) {
        this.#scrapers.get(id)?.destroy();
        this.#scrapers.delete(id);
      }
    }
    for (const ch of channels) {
      if (!this.#channelState.has(ch)) {
        this.#channelState.set(ch, {
          lastValues: [],
          prevValues: [],
          isInfinite: [],
          highFreqCount: 0,
          nextFetchAt: 0,
          fetching: false,
          consecutiveErrors: 0,
        });
      }
    }
    for (const key of this.#channelState.keys()) {
      if (!channels.includes(key)) {
        this.#channelTimers.delete(key);
        this.#channelState.delete(key);
      }
    }
    this.#syncAutoRefresh();
  }

  startAutoRefresh() {
    this.#autoRefreshEnabled = true;
    this.sendAllChannelDebug();
    this.#syncAutoRefresh();
  }

  #syncAutoRefresh() {
    if (!this.#autoRefreshEnabled || !this.#visibleChannels.length) {
      if (this.#tickInterval) clearInterval(this.#tickInterval);
      this.#tickInterval = null;
      return;
    }
    if (!this.#tickInterval) this.#tickInterval = setInterval(() => this.#channelTick(), 10000);
    this.#channelTick();
  }

  stopAutoRefresh() {
    this.#autoRefreshEnabled = false;
    if (this.#tickInterval) { clearInterval(this.#tickInterval); this.#tickInterval = null; }
    this.#channelTimers.clear();
    for (const id of this.#backgroundProviders) {
      this.#scrapers.get(id)?.destroy();
      this.#scrapers.delete(id);
    }
    this.#initializedProviders.clear();
  }

  async #channelTick() {
    if (!this.#autoRefreshEnabled) return;
    const now = Date.now();
    const dueByProvider = new Map();

    for (const id of new Set(this.#visibleChannels.map(key => key.split(':')[0]))) {
      if (!this.#initializedProviders.has(id) && !this.#providerFetching.get(id)) {
        this.#initProvider(id, this.#providers.get(id), this.getCachedData());
      }
    }

    for (const channelKey of this.#visibleChannels) {
      const providerId = channelKey.split(':')[0];
      const provider = this.#providers.get(providerId);
      if (!provider || provider.status !== 'connected') continue;
      const type = channelKey.split('_')[0].split(':')[0];
      if (!provider.fetchChannel) continue;

      const st = this.#channelState.get(channelKey);
      if (!st || st.fetching || now < st.nextFetchAt) continue;

      if (!dueByProvider.has(providerId)) {
        dueByProvider.set(providerId, []);
      }
      dueByProvider.get(providerId).push(channelKey);
    }

    for (const [providerId, channelKeys] of dueByProvider) {
      if (this.#providerFetching.get(providerId)) continue;
      this.#providerFetching.set(providerId, true);
      this.#backgroundProviders.add(providerId);
      this.#runProviderQueue(providerId, channelKeys).catch(error => {
        console.error('[ProviderManager] background queue:', error.message);
      }).finally(() => {
        this.#backgroundProviders.delete(providerId);
        this.#providerFetching.delete(providerId);
        if (this.#autoRefreshEnabled && !this.#initializedProviders.has(providerId)) this.#channelTick();
      });
    }

    this.sendAllChannelDebug();
  }

  async #runProviderQueue(providerId, channelKeys) {
    const scraper = this.#getOrCreateScraper(providerId);
    const provider = this.#providers.get(providerId);
    provider.usageFetching = true;
    provider.lastError = null;
    this.#sendUpdate(providerId);
    try {
      for (const channelKey of channelKeys) {
        if (scraper.signal.aborted) break;
        if (!this.#visibleChannels.includes(channelKey)) continue;
        const st = this.#channelState.get(channelKey);
        if (!st) continue;
        st.fetching = true;
        st.startedAt = Date.now();
        this.#sendChannelDebug(channelKey);
        try {
          await this.#fetchChannel(channelKey, provider, scraper);
        } finally {
          st.fetching = false;
          this.#sendChannelDebug(channelKey);
        }
      }
    } finally {
      provider.usageFetching = false;
      this.#sendUpdate(providerId);
      scraper.releaseWindow();
    }
  }

  async #fetchChannel(channelKey, provider, scraper = this.#getOrCreateScraper(channelKey.split(':')[0]), singleChannelStartup = false) {
    const providerId = channelKey.split(':')[0];
    const st = this.#channelState.get(channelKey);
    const active = () => !scraper.signal.aborted && this.#channelState.get(channelKey) === st && this.#visibleChannels.includes(channelKey);
    if (!st || !active()) return;

    try {
      const result = singleChannelStartup ? await provider.fetchData(scraper) : await provider.fetchChannel(channelKey, scraper);
      if (!active()) return;
      if (!result.plans || result.plans.length === 0) {
        throw new Error('empty plans');
      }

      provider.status = 'connected';
      st.consecutiveErrors = 0;
      this.#sendChannelStatus(channelKey, false);

      this.#mergeChannelData(providerId, channelKey, result);

      const mergedData = this.#configStore?.get('providerCache')?.[providerId]?.data;
      const ext = mergedData ? this.#extractValues(mergedData, channelKey) : this.#extractValues(result, channelKey);
      const values = ext.values;
      const prevValues = st.lastValues;
      st.prevValues = prevValues || [];
      st.lastValues = values;
      st.isInfinite = ext.isInfinite;

      const isInf = st.isInfinite && st.isInfinite[0];
      const hasPrev = prevValues && prevValues.length > 0;
      const rose = !isInf && ((hasPrev && this.#detectRise(prevValues, values)) || (!hasPrev && values[0].pct > 0));
      if (rose) {
        st.highFreqCount = ProviderManager.HIGH_FREQ_SUSTAIN;
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
        this.#sendChannelHighFreq(channelKey, true);
      } else if (st.highFreqCount > 0) {
        st.highFreqCount--;
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, true);
        if (st.highFreqCount === 0) {
          this.#sendChannelHighFreq(channelKey, false);
        }
      } else {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false);
      }
      this.#sendChannelDebug(channelKey);
    } catch (e) {
      if (!active()) return;
      try { console.error(`[ProviderManager] channel fetch ${channelKey} error:`, e.message); } catch(_) {}
      st.consecutiveErrors = (st.consecutiveErrors || 0) + 1;
      this.#sendChannelStatus(channelKey, true);
      provider.lastError = e.message;
      this.#sendUpdate(providerId, null, e.message);

      if (st.consecutiveErrors <= 3) {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false, 30000);
      } else {
        st.nextFetchAt = this.#nextFetchAt(channelKey, st, false);
      }
      this.#sendChannelDebug(channelKey);
    }
  }

  #sendChannelStatus(channelKey, isError) {
    const payload = { channelKey, isError };
    const windows = [this.#mainWindow, this.#monitorWindow, ...(this.#pluginWindows ? Array.from(this.#pluginWindows.values()) : [])];
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('channel-status', payload);
      }
    }
  }

  #sendChannelHighFreq(channelKey, isHighFreq) {
    const payload = { channelKey, isHighFreq };
    const windows = [this.#mainWindow, this.#monitorWindow, ...(this.#pluginWindows ? Array.from(this.#pluginWindows.values()) : [])];
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('channel-highfreq', payload);
      }
    }
  }

  #sendChannelDebug(channelKey) {
    const st = this.#channelState.get(channelKey);
    if (!st) return;
    const sanitize = (vals) => (vals || []).map(v => {
      if (v.type === 'raw') return { type: 'raw', pct: v.pct, used: v.used, total: v.total === Infinity ? '∞' : v.total };
      return { type: 'pct', pct: v.pct };
    });
    const payload = {
      channelKey,
      nextFetchAt: st.nextFetchAt || 0,
      isHighFreq: (st.highFreqCount || 0) > 0,
      isError: (st.consecutiveErrors || 0) > 0,
      consecutiveErrors: st.consecutiveErrors || 0,
      fetching: st.fetching || false,
      isRetrying: (st.consecutiveErrors || 0) > 0 && st.nextFetchAt > 0 && (st.nextFetchAt - Date.now()) < this.#refreshInterval(channelKey, false),
      lastValues: sanitize(st.lastValues),
      prevValues: sanitize(st.prevValues),
      isInfinite: st.isInfinite || [],
    };
    const windows = [this.#mainWindow, this.#monitorWindow, ...(this.#pluginWindows ? Array.from(this.#pluginWindows.values()) : [])];
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('channel-debug', payload); } catch(_) {}
      }
    }
  }

  sendAllChannelDebug() {
    for (const channelKey of this.#visibleChannels) {
      this.#sendChannelDebug(channelKey);
    }
  }

  #detectRise(prev, curr) {
    if (!prev || prev.length === 0 || !curr || curr.length === 0) return false;
    return curr[0].pct !== prev[0].pct;
  }

  #extractValues(result, channelKey) {
    const values = [];
    const isInfinite = [];
    const providerId = channelKey ? channelKey.split(':')[0] : null;
    const type = providerId ? providerId.split('_')[0] : null;
    const offset = result.channelOffset || 0;
    let pctIdx = 0;
    for (const p of result.plans) {
      if (result.dynamicQuota && p.percentage == null) {
        values.push({ type: 'balance', pct: 0, remaining: p.remaining, used: p.used, total: p.total });
        isInfinite.push(!!p.unlimited);
      } else if (p.percentage != null) {
        if (type === 'volcengine') {
          const isAgent = channelKey.endsWith(':agent');
          const planIsAgent = p.name.includes('Agent');
          if (isAgent !== planIsAgent) { pctIdx++; continue; }
        }
        values.push({ type: 'pct', pct: p.percentage });
        isInfinite.push(false);
        pctIdx++;
      } else if (p.periods && p.periods.length > 0) {
        if (type === 'xfyun' && channelKey) {
          const colonIdx = channelKey.indexOf(':');
          const planName = colonIdx >= 0 ? channelKey.slice(colonIdx + 1) : '';
          if (!p.name.includes(planName)) continue;
        }
        const periodLabels = ['5小时', '周', '总'];
        for (const label of periodLabels) {
          const pd = p.periods.find(pp => pp.label === label);
          if (pd && pd.usage && pd.usage.length > 0) {
            const u = pd.usage[0];
            if (u.total === '∞') {
              values.push({ type: 'raw', pct: 0, used: parseFloat(u.used), total: Infinity });
              isInfinite.push(true);
            } else {
              const used = parseFloat(u.used);
              const total = parseFloat(u.total);
              values.push({ type: 'raw', pct: total > 0 ? Math.round((used / total) * 100) : 0, used, total });
              isInfinite.push(false);
            }
          }
        }
      }
    }
    return { values, isInfinite };
  }

  #mergeChannelData(providerId, channelKey, result) {
    const cache = this.#configStore?.get('providerCache') || {};
    const cached = cache[providerId]?.data || { plans: [], countdowns: [] };
    const offset = result.channelOffset || 0;

    const planNames = result.plans.map(p => p.name);
    const type = providerId.split('_')[0];
    const otherPlans = type === 'volcengine'
      ? (cached.plans || []).filter(p => p.name.startsWith('Agent-') !== channelKey.endsWith(':agent'))
      : type === 'xfyun' ? (cached.plans || []).filter(p => !planNames.includes(p.name)) : [];
    const allPlans = [...otherPlans, ...result.plans];

    const allCountdowns = cached.countdowns ? [...cached.countdowns] : [];
    const resultCountdowns = result.countdowns || [];
    for (let i = 0; i < resultCountdowns.length; i++) {
      allCountdowns[offset + i] = resultCountdowns[i];
    }

    const data = { ...result, plans: allPlans, countdowns: allCountdowns, url: result.url || cached.url || '', source: result.source || cached.source, _fetchTime: Date.now() };
    cache[providerId] = { data, timestamp: Date.now() };
    if (this.#configStore) {
      try { this.#configStore.set('providerCache', cache); } catch(_) {}
    }
    this.#sendUpdate(providerId, data);
  }

  async checkAuthOnStartup() {
    const cache = this.getCachedData();
    for (const [id, provider] of this.#providers) {
      if (provider.hydrateCatalog) provider.hydrateCatalog(cache[id]?.data || null);
    }
    for (const [pid, entry] of Object.entries(cache)) {
      if (entry.data) {
        entry.data._fetchTime = entry.timestamp;
      }
      this.#sendUpdate(pid, entry.data);
    }

    const tasks = [];
    for (const [id, provider] of this.#providers) {
      if (this.#visibleChannels.some(key => key.split(':')[0] === id)) tasks.push(this.#initProvider(id, provider, cache));
    }
    await Promise.all(tasks);
  }

  async #initProvider(id, provider, cache) {
    if (!provider || this.#providerFetching.get(id) || !this.#visibleChannels.some(key => key.split(':')[0] === id)) return;
    this.#providerFetching.set(id, true);
    this.#initializedProviders.add(id);
    this.#backgroundProviders.add(id);
    const scraper = this.#getOrCreateScraper(id);
    try {
      provider.status = 'checking';
      const result = await provider.checkAuth(scraper);
      scraper.signal.throwIfAborted();
      provider.status = result.status || 'unauthorized';
      if (result.status === 'connected') {
        provider.status = 'connected';
        await this.#captureLoginInfo(id, scraper);
        scraper.signal.throwIfAborted();
        const cachedData = result.data || cache[id]?.data || null;
        this.#sendUpdate(id, cachedData);
        await this.#fetchProviderChannels(id, provider, scraper);
      } else {
        this.#sendUpdate(id, null, result.error || null);
        scraper.releaseWindow();
      }
    } catch (e) {
      if (scraper.signal.aborted) return;
      try { console.error(`[ProviderManager] startup checkAuth ${id} error:`, e.message); } catch(_) {}
      provider.status = 'error';
      this.#sendUpdate(id, null, e.message);
      scraper.releaseWindow();
    } finally {
      provider.usageFetching = false;
      scraper.releaseWindow();
      this.#backgroundProviders.delete(id);
      this.#providerFetching.delete(id);
      if (this.#autoRefreshEnabled && !this.#initializedProviders.has(id)) this.#channelTick();
    }
  }

  async #fetchProviderChannels(providerId, provider, scraper) {
    provider.usageFetching = true;
    provider.lastError = null;
    this.#sendUpdate(providerId);
    for (const channelKey of this.#visibleChannels) {
      if (scraper.signal.aborted) break;
      if (channelKey.split(':')[0] !== providerId) continue;
      await this.#fetchChannel(channelKey, provider, scraper, provider.singleChannel === true);
    }
    provider.usageFetching = false;
    this.#sendUpdate(providerId);
    scraper.releaseWindow();
  }

  destroy() {
    this.stopAutoRefresh();
    for (const scraper of this.#scrapers.values()) {
      scraper.destroy();
    }
    this.#scrapers.clear();
  }
}

class ScraperSession {
  #providerId;
  #win = null;
  #gone = null;
  #onRefresh = null;
  #proxyPort = null;
  #loginObserver = null;
  #controller = new AbortController();

  get signal() { return this.#controller.signal; }

  stopLoginWatch() {
    this.#loginObserver?.stop();
    this.#loginObserver = null;
  }

  #loginWindows() {
    if (!this.hasActiveWindow()) return [];
    const session = this.#win.webContents.session;
    return BrowserWindow.getAllWindows().filter(win =>
      !win.isDestroyed() && win.webContents.session === session);
  }

  hideLoginWindows() {
    for (const win of this.#loginWindows()) win.hide();
  }

  watchQueryLogin(probe, complete, expired) {
    this.stopLoginWatch();
    this.#loginObserver = new LoginObserver({
      interval: 3000,
      probe: async () => {
        if (!this.hasActiveWindow()) { this.stopLoginWatch(); expired(); return false; }
        return probe();
      }, complete, expired,
    });
    this.#loginObserver.start();
  }

  watchLogin(readState, complete, expired) {
    this.stopLoginWatch();
    this.#loginObserver = new LoginObserver({
      probe: async () => {
        if (!this.hasActiveWindow()) {
          this.stopLoginWatch();
          expired();
          return false;
        }
        // OAuth can complete in a child window. Inspect only this account's session.
        for (const win of this.#loginWindows()) {
          try {
            const state = await win.webContents.executeJavaScript(`(${readState.toString()})()`);
            if (state === 'connected') return true;
          } catch (_) {}
        }
        return false;
      },
      complete,
      expired,
    });
    this.#loginObserver.start();
  }

  constructor(providerId) {
    this.#providerId = providerId;
  }

  setProxyPort(port) {
    this.#proxyPort = port || null;
    if (this.#win && !this.#win.isDestroyed() && this.#proxyPort) {
      this.#win.webContents.session.setProxy({
        proxyRules: `http=127.0.0.1:${this.#proxyPort};https=127.0.0.1:${this.#proxyPort}`,
      }).catch(() => {});
    }
  }

  #ensureWindow() {
    this.signal.throwIfAborted();
    if (this.#win && !this.#win.isDestroyed()) return;

    this.#win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        partition: `persist:${this.#providerId}`,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        backgroundThrottling: false,
      },
    });

    try { this.#win.webContents.session.setCacheSize(10 * 1024 * 1024); } catch (_) {}
    this.#gone = null;
    this.#win.webContents.on('render-process-gone', (_event, details) => {
      this.#gone = details.reason + (details.exitCode != null ? ` ${details.exitCode}` : '');
    });
    this.#win.webContents.on('unresponsive', () => { this.#gone ||= 'unresponsive'; });

    if (this.#proxyPort) {
      this.#win.webContents.session.setProxy({
        proxyRules: `http=127.0.0.1:${this.#proxyPort};https=127.0.0.1:${this.#proxyPort}`,
      }).catch(() => {});
    }

    this.#win.webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        if (details.url.includes('botim')) {
          callback({ cancel: true });
        } else {
          callback({});
        }
      }
    );

    this.#win.webContents.on('context-menu', (_event, params) => {
      const menu = Menu.buildFromTemplate([
        { label: '刷新页面', click: () => this.#doRefresh() },
        { type: 'separator' },
        { label: '后退', click: () => { if (this.#win && !this.#win.isDestroyed()) this.#win.webContents.goBack(); } },
        { type: 'separator' },
        { label: '复制地址', click: () => { if (this.#win && !this.#win.isDestroyed()) { const url = this.#win.webContents.getURL(); require('electron').clipboard.writeText(url); } } },
      ]);
      menu.popup({ window: this.#win });
    });
  }

  setOnRefresh(callback) {
    this.#onRefresh = callback;
  }

  async #doRefresh() {
    if (!this.#win || this.#win.isDestroyed()) return;
    this.#win.webContents.reload();
    await this.#waitForLoad();
    await this.waitForNetworkIdle(8000);
    if (this.#onRefresh) {
      try {
        await this.#onRefresh(this.#providerId);
      } catch (e) {
        console.error(`[ScraperSession] refresh callback error:`, e.message);
      }
    }
  }

  async loadPage(url) {
    this.#ensureWindow();
    this.#win.loadURL(url);
    await this.#waitForLoad();
  }

  async reloadPage(url) {
    this.#ensureWindow();
    const currentUrl = this.#win.webContents.getURL();
    const cleanCurrent = currentUrl ? currentUrl.split('#')[0].split('?')[0] : '';
    if (cleanCurrent === url) {
      this.#win.webContents.reload();
    } else {
      this.#win.loadURL(url);
    }
    await this.#waitForLoad();
  }

  async waitForNetworkIdle(timeout = 5000) {
    this.#ensureWindow();
    if (!this.#win || this.#win.isDestroyed()) return;
    const win = this.#win;
    return new Promise((resolve, reject) => {
      let inflight = 0;
      let timer = null;

      const done = () => {
        if (timer) clearTimeout(timer);
        try {
          win.webContents.removeListener('did-start-loading', onStart);
          win.webContents.removeListener('did-stop-loading', onStop);
        } catch (_) {}
        this.signal.removeEventListener('abort', done);
        if (this.signal.aborted) reject(this.signal.reason);
        else resolve();
      };

      const onStart = () => { inflight++; resetTimer(); };
      const onStop = () => { inflight = Math.max(0, inflight - 1); resetTimer(); };
      const resetTimer = () => {
        if (timer) clearTimeout(timer);
        if (inflight <= 0) {
          timer = setTimeout(done, 1500);
        } else {
          timer = setTimeout(done, timeout);
        }
      };

      this.#win.webContents.on('did-start-loading', onStart);
      this.#win.webContents.on('did-stop-loading', onStop);
      this.signal.addEventListener('abort', done, { once: true });
      resetTimer();
    });
  }

  async readApiResponse(targetUrl, accepts, parse) {
    this.#ensureWindow();
    if (!this.getURL() || this.getURL() === 'about:blank') {
      try { await this.loadPage(targetUrl); }
      catch (error) { throw new (require('./coding-plan-api').QueryError)(error.code === 'ERR_PROXY_CONNECTION_FAILED' ? 'OpenCode 代理连接失败，请启动代理或在账号设置中清空代理端口' : 'OpenCode 控制台连接失败', 'network'); }
    }
    const contents = this.#win.webContents, debug = contents.debugger;
    const { QueryError } = require('./coding-plan-api');
    if (!debug.isAttached()) debug.attach('1.3');
    await debug.sendCommand('Network.enable');
    return new Promise((resolve, reject) => {
      const requests = new Set();
      let finished = false;
      const finish = (error, data) => {
        if (finished) return; finished = true; clearTimeout(timer);
        debug.removeListener('message', onMessage); this.signal.removeEventListener('abort', onAbort);
        if (debug.isAttached()) debug.detach();
        error ? reject(error) : resolve(data);
      };
      const onAbort = () => finish(this.signal.reason);
      const timer = setTimeout(() => {
        const login = /\/auth\/|\/login|\/authorize/.test(contents.getURL());
        finish(new QueryError(login ? '网页登录会话已失效，请重新连接' : 'OpenCode 没有返回套餐用量接口数据；可在查询设置中使用 Go API Key', login ? 'auth' : 'schema'));
      }, 20000);
      const onMessage = async (_event, method, params) => {
        try {
          if (method === 'Network.responseReceived' && accepts(params.response.url)) requests.add(params.requestId);
          if (method !== 'Network.loadingFinished' || !requests.delete(params.requestId)) return;
          const response = await debug.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          const text = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
          const data = parse(text);
          if (data) finish(null, data);
        } catch (error) { if (!finished) finish(new QueryError('OpenCode 用量接口响应读取失败', 'network')); }
      };
      debug.on('message', onMessage); this.signal.addEventListener('abort', onAbort, { once: true });
      contents.loadURL(targetUrl).catch(error => finish(new QueryError(error.code === 'ERR_PROXY_CONNECTION_FAILED' ? 'OpenCode 代理连接失败，请启动代理或在账号设置中清空代理端口' : 'OpenCode 控制台连接失败', 'network')));
    });
  }

  async executeScript(script, ...args) {
    this.#ensureWindow();
    if (!this.#win || this.#win.isDestroyed()) return null;
    const argStr = args.length > 0 ? args.map(a => JSON.stringify(a)).join(',') : '';
    const result = await this.#win.webContents.executeJavaScript(`(${script.toString()})(${argStr})`);
    this.signal.throwIfAborted();
    return result;
  }

  showWindow() {
    this.#ensureWindow();
    this.#win.show();
    this.#win.focus();
  }

  hideWindow() {
    if (!this.#win || this.#win.isDestroyed()) return;
    this.#win.hide();
  }

  releaseWindow() {
    this.stopLoginWatch();
    if (!this.#win || this.#win.isDestroyed()) return;
    try { this.#win.close(); } catch (_) {}
    this.#win = null;
  }

  // Snapshot for timeout diagnostics: tells a page stuck on the network from a renderer that never started or died.
  debugState() {
    if (!this.#win || this.#win.isDestroyed()) return { window: false };
    const wc = this.#win.webContents;
    return { window: true, url: wc.getURL(), loading: wc.isLoading(), waitingForResponse: wc.isWaitingForResponse(),
      crashed: wc.isCrashed(), pid: wc.getOSProcessId(), gone: this.#gone };
  }

  getURL() {
    if (!this.#win || this.#win.isDestroyed()) return '';
    return this.#win.webContents.getURL();
  }

  hasActiveWindow() {
    return this.#win && !this.#win.isDestroyed();
  }

  async getCookies() {
    if (!this.#win || this.#win.isDestroyed()) return [];
    return await this.#win.webContents.session.cookies.get({});
  }

  async setCookies(cookies) {
    this.#ensureWindow();
    for (const c of cookies) {
      try {
        await this.#win.webContents.session.cookies.set({
          url: c.url || `https://${c.domain}${c.path || '/'}`,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== false,
          httpOnly: c.httpOnly !== false,
          expirationDate: c.expirationDate,
          sameSite: c.sameSite || 'lax',
        });
      } catch (e) {
        try { console.error(`[setCookies] ${c.name}:`, e.message); } catch(_) {}
      }
    }
    return true;
  }

  destroy() {
    this.#controller.abort();
    this.stopLoginWatch();
    if (this.#win && !this.#win.isDestroyed()) {
      this.#win.destroy();
    }
    this.#win = null;
  }

  #waitForLoad() {
    this.signal.throwIfAborted();
    const win = this.#win;
    return new Promise((resolve, reject) => {
      if (!this.#win) { resolve(); return; }
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { win.webContents.removeListener('did-finish-load', onLoad); } catch (_) {}
        try { win.webContents.removeListener('did-fail-load', onFail); } catch (_) {}
        this.signal.removeEventListener('abort', onAbort);
      };
      const timer = setTimeout(() => { cleanup(); resolve(); }, 15000);
      const onLoad = () => { cleanup(); resolve(); };
      const onAbort = () => { cleanup(); reject(this.signal.reason); };
      const onFail = (_event, errorCode, _errorDesc, _validatedURL, isMainFrame) => {
        if (isMainFrame) { cleanup(); resolve(); }
      };
      this.#win.webContents.once('did-finish-load', onLoad);
      this.#win.webContents.once('did-fail-load', onFail);
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

module.exports = ProviderManager;
