<script>
  import Icon from '@shared/components/Icon.svelte';

  let { onconfigchanged } = $props();

  let plugins = $state([]);
  let loading = $state(true);
  let providerStatus = $state({});
  let autoSwitch = $state(true);
  let autoSwitchInterval = $state(10);
  let toggleError = $state('');

  async function refresh() {
    loading = true;
    try {
      plugins = await window.api.getPlugins();
    } catch (e) {
      console.error(e);
    }
    loading = false;

    try {
      const providers = await window.api.getProviders();
      for (const p of providers) {
        providerStatus[p.id] = p.status;
      }
    } catch (e) {
      console.error(e);
    }

    try {
      const config = await window.api.getConfig();
      autoSwitch = config.carousel?.enabled !== false;
      autoSwitchInterval = config.carousel?.interval || 10;
    } catch (_) {}
  }

  async function togglePlugin(id, enabled) {
    await window.api.togglePlugin(id, enabled);
    onconfigchanged?.();
    await refresh();
  }

  async function uninstallPlugin(id) {
    await window.api.uninstallPlugin(id);
    onconfigchanged?.();
    await refresh();
  }

  async function moveUp(idx) {
    if (idx <= 0) return;
    const ids = plugins.map(p => p.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    await window.api.reorderPlugins(ids);
    onconfigchanged?.();
    await refresh();
  }

  async function moveDown(idx) {
    if (idx >= plugins.length - 1) return;
    const ids = plugins.map(p => p.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    await window.api.reorderPlugins(ids);
    onconfigchanged?.();
    await refresh();
  }

  async function openPluginPanel(pluginId) {
    await window.api.openPluginPanel(pluginId);
  }

  async function loginInPanel(providerId) {
    providerStatus[providerId] = 'logging-in';
    const result = await window.api.providerLoginInPanel(providerId);
    if (result.success) {
      providerStatus[providerId] = 'connected';
    } else {
      providerStatus[providerId] = 'unauthorized';
    }
  }

  async function switchToPage(id) {
    await window.api.switchPage(id);
  }

  async function switchNextPage() {
    if (plugins.filter(plugin => plugin.enabled).length < 2) return;
    await window.api.switchNextPage();
  }

  async function saveAutoSwitch() {
    await window.api.setConfig('carousel', { enabled: autoSwitch, interval: autoSwitchInterval });
    await window.api.setCarouselConfig({ enabled: autoSwitch, interval: autoSwitchInterval });
    onconfigchanged?.();
  }

  refresh();

  window.api?.onPresetLoaded?.(() => {
    refresh();
  });
</script>

<div class="page">
  <div class="page-title-row">
    <h2 class="page-title">插件管理</h2>
    <div class="switch-actions">
      <button class="manual-switch" onclick={switchNextPage} disabled={plugins.filter(plugin => plugin.enabled).length < 2} title="切换到下一个已启用插件">
        <Icon name="carousel" size={13} /> 手动切换
      </button>
      <div class="carousel-toggle">
        <span class="toggle-label-sm">自动切换</span>
        <label class="toggle toggle-sm" title={autoSwitch ? '自动切换已开启' : '自动切换已关闭'}>
          <input type="checkbox" aria-label="自动切换" checked={autoSwitch} onchange={() => { autoSwitch = !autoSwitch; saveAutoSwitch(); }} />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>

  {#if toggleError}<p role="alert">{toggleError}</p>{/if}

  {#if autoSwitch}
    <div class="interval-row">
      <span class="interval-label">间隔</span>
      <input type="range" min={3} max={60} step={1} value={autoSwitchInterval}
        oninput={(e) => autoSwitchInterval = Number(e.target.value)}
        onchange={saveAutoSwitch} />
      <span class="interval-value">{autoSwitchInterval}秒</span>
    </div>
  {/if}

  {#if loading}
    <div class="loading">加载中...</div>
  {:else if plugins.length === 0}
    <div class="empty">
      <div class="empty-icon"><Icon name="plugin" size={48} /></div>
      <div class="empty-text">暂无插件</div>
      <div class="empty-hint">将插件文件夹放入 plugins 目录</div>
    </div>
  {:else}
    <div class="plugin-list">
      {#each plugins as plugin, idx}
        <div class="plugin-card" class:disabled={!plugin.enabled}>
          <div class="plugin-header">
            <div class="plugin-icon">
              <Icon name={plugin.icon || 'dot'} size={22} />
            </div>
            <div class="plugin-info">
              <div class="plugin-name">{plugin.name}</div>
              <div class="plugin-meta">
                {plugin.type === 'builtin' ? '内置' : '用户'} · v{plugin.version || '1.0'}
                {#if plugin.description}
                  · {plugin.description}
                {/if}
                {#if providerStatus[plugin.id]}
                  · <span class="provider-status" class:connected={providerStatus[plugin.id] === 'connected'}
                      class:unauthorized={providerStatus[plugin.id] === 'unauthorized'}
                      class:error={providerStatus[plugin.id] === 'error'}>
                    {providerStatus[plugin.id] === 'connected' ? '已登录' : providerStatus[plugin.id] === 'logging-in' ? '登录中...' : providerStatus[plugin.id] === 'error' ? '需重连' : '未登录'}
                  </span>
                {/if}
              </div>
            </div>
            <label class="toggle">
              <input type="checkbox" checked={plugin.enabled} onchange={() => togglePlugin(plugin.id, !plugin.enabled)} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          {#if plugin.id === 'coding-plan'}
            <div class="plugin-source-links">接口实现来源：
              <button onclick={() => window.api.openExternal('https://github.com/farion1231/cc-switch')}>CC Switch · MIT</button>
              <span> / </span><button onclick={() => window.api.openExternal('https://github.com/Asklear/QuotaRadar')}>QuotaRadar · MIT</button>
            </div>
          {/if}
          <div class="plugin-actions">
            {#if providerStatus[plugin.id] === 'unauthorized'}
              <button class="action-btn accent" onclick={() => loginInPanel(plugin.id)}>
                <Icon name="power" size={12} /> 登录
              </button>
            {/if}
            <button class="action-btn" onclick={() => openPluginPanel(plugin.id)}>
              <Icon name="monitor" size={12} /> 管理
            </button>
            <button class="action-btn" onclick={() => switchToPage(plugin.id)} disabled={!plugin.enabled}>
              <Icon name="eye" size={12} /> 预览
            </button>
            <button class="action-btn" onclick={() => moveUp(idx)} disabled={idx === 0}>
              <Icon name="chevron-up" size={12} />
            </button>
            <button class="action-btn" onclick={() => moveDown(idx)} disabled={idx === plugins.length - 1}>
              <Icon name="chevron-down" size={12} />
            </button>
            {#if plugin.type !== 'builtin'}
              <button class="action-btn danger" onclick={() => uninstallPlugin(plugin.id)}>
                <Icon name="trash" size={12} />
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <button class="btn-ghost" onclick={refresh} style="margin-top: 16px;">
    <Icon name="refresh" size={14} /> 刷新插件列表
  </button>
</div>

<style>
  .plugin-source-links { font-size: 11px; color: var(--text-secondary); margin: 8px 0; }
  .plugin-source-links button { color: var(--accent); font: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  .page { max-width: 560px; }
  .page-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
  .page-title { font-size: 22px; font-weight: 600; margin: 0; }
  .switch-actions { display: flex; align-items: center; gap: 12px; }
  .carousel-toggle { display: flex; align-items: center; gap: 8px; }
  .manual-switch { height: 30px; display: flex; align-items: center; gap: 5px; padding: 0 10px; border-radius: 7px; color: var(--accent); background: rgba(10, 132, 255, .08); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); font-size: 11px; }
  .manual-switch:hover { background: rgba(10, 132, 255, .16); }
  .manual-switch:disabled { opacity: .35; cursor: not-allowed; }

  .toggle-sm { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .toggle-label-sm { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
  .toggle-sm .toggle-slider { width: 36px; height: 20px; }
  .toggle-sm .toggle-slider::before { width: 16px; height: 16px; }
  .toggle-sm input:checked + .toggle-slider::before { transform: translateX(16px); }

  .interval-row { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding: 10px 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .interval-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
  .interval-row input[type="range"] { flex: 1; appearance: none; height: 4px; background: var(--border); border-radius: 2px; outline: none; border: none; padding: 0; }
  .interval-row input[type="range"]::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); cursor: pointer; }
  .interval-value { min-width: 36px; color: var(--accent); font-weight: 500; font-size: 13px; text-align: right; }

  .loading { color: var(--text-secondary); padding: 40px 0; }

  .empty { text-align: center; padding: 48px 0; }
  .empty-icon { margin-bottom: 12px; color: var(--text-secondary); display: flex; justify-content: center; }
  .empty-text { font-size: 16px; font-weight: 500; }
  .empty-hint { font-size: 13px; color: var(--text-secondary); }

  .plugin-list { display: flex; flex-direction: column; gap: 8px; }

  .plugin-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius-card); padding: 16px; transition: opacity 0.2s;
  }
  .plugin-card.disabled { opacity: 0.5; }

  .plugin-header { display: flex; align-items: center; gap: 12px; }
  .plugin-icon { flex-shrink: 0; color: var(--text-secondary); display: flex; }
  .plugin-info { flex: 1; min-width: 0; }
  .plugin-name { font-weight: 500; }
  .plugin-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
  .provider-status { font-weight: 500; }
  .provider-status.connected { color: var(--success); }
  .provider-status.unauthorized { color: var(--warning); }
  .provider-status.error { color: var(--danger); }

  .toggle { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0; background: var(--border);
    border-radius: 11px; cursor: pointer; transition: background 0.2s;
  }
  .toggle-slider::before {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%; background: white; transition: transform 0.2s;
  }
  .toggle input:checked + .toggle-slider { background: var(--accent); }
  .toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

  .plugin-actions {
    display: flex; gap: 6px; margin-top: 12px;
    padding-top: 12px; border-top: 1px solid var(--border); flex-wrap: wrap;
  }

  .action-btn {
    padding: 6px 12px; border-radius: var(--radius-sm);
    background: var(--card-hover); color: var(--text-primary);
    font-size: 12px; display: flex; align-items: center; gap: 4px;
  }
  .action-btn:hover { background: var(--border); }
  .action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .action-btn.danger { color: var(--danger); }
  .action-btn.danger:hover { background: rgba(255, 69, 58, 0.1); }
  .action-btn.accent { color: var(--accent); border: 1px solid var(--accent); background: transparent; }
  .action-btn.accent:hover { background: rgba(10, 132, 255, 0.08); }

  .btn-ghost {
    background: transparent; color: var(--text-secondary); border: none;
    cursor: pointer; font-size: 13px; padding: 8px 12px;
    display: flex; align-items: center; gap: 6px;
  }
  .btn-ghost:hover { color: var(--text-primary); }
</style>
