<script>
  import Sidebar from './components/Sidebar.svelte';
  import DisplaySettings from './components/DisplaySettings.svelte';
  import PluginManager from './components/PluginManager.svelte';
  import PresetManager from './components/PresetManager.svelte';
  import Icon from '@shared/components/Icon.svelte';

  let activeTab = $state('display');
  let sidebarCollapsed = $state(false);
  let theme = $state('dark');
  let presetManagerRef = $state(null);

  async function loadTheme() {
    try {
      const config = await window.api.getConfig();
      theme = config.theme || 'dark';
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) {}
  }

  async function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    await window.api.setConfig('theme', theme);
    notifyConfigChanged();
  }

  function notifyConfigChanged() {
    window.dispatchEvent(new CustomEvent('config-changed'));
  }

  function onPresetApplied(e) {
    const preset = e.detail;
    if (preset?.data?.theme) {
      theme = preset.data.theme;
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  loadTheme();

  const tabs = [
    { id: 'display', label: '显示设置', icon: 'display' },
    { id: 'plugins', label: '插件管理', icon: 'plugin' },
  ];
</script>

<svelte:window on:preset-applied={onPresetApplied} />

<div class="app-shell">
  <div class="titlebar">
    <div class="titlebar-drag">
      <span class="titlebar-title">Monitor</span>
    </div>
    <div class="titlebar-center">
      <PresetManager bind:this={presetManagerRef} />
    </div>
    <div class="titlebar-controls">
      <button class="tb-btn" onclick={toggleTheme} title={theme === 'dark' ? '切换亮色' : '切换暗色'}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
      </button>
      <button class="tb-btn" onclick={() => window.api.minimizeManager()}>
        <Icon name="minus" size={14} />
      </button>
      <button class="tb-btn close" onclick={() => window.api.closeManager()}>
        <Icon name="close" size={14} />
      </button>
    </div>
  </div>

  <div class="app-body">
    <Sidebar
      {tabs}
      activeTab={activeTab}
      collapsed={sidebarCollapsed}
      onTabChange={(id) => activeTab = id}
      onToggleCollapse={() => sidebarCollapsed = !sidebarCollapsed}
    />
    <main class="content">
      {#if activeTab === 'display'}
        <DisplaySettings onconfigchanged={notifyConfigChanged} />
      {:else if activeTab === 'plugins'}
        <PluginManager onconfigchanged={notifyConfigChanged} />
      {/if}
    </main>
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 38px;
    -webkit-app-region: drag;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    padding: 0 8px 0 16px;
    flex-shrink: 0;
  }

  .titlebar-drag {
    flex: 1;
    min-width: 0;
  }

  .titlebar-center {
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .titlebar-title {
    font-size: 13px;
    color: var(--text-secondary);
    font-weight: 600;
    letter-spacing: 1px;
  }

  .titlebar-controls {
    display: flex;
    gap: 4px;
    -webkit-app-region: no-drag;
  }

  .tb-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
  }
  .tb-btn:hover { background: var(--border); color: var(--text-primary); }
  .tb-btn.close:hover { background: var(--danger); color: white; }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }
</style>
