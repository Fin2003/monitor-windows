<script>
  import {onMount} from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  let {onchanged = () => {}} = $props();
  let plugins = $state([]), loading = $state(true), busy = $state(''), message = $state('');
  let search = $state(''), source = $state(''), editingSource = $state(false), variant = $state('windows');
  let filtered = $derived(plugins.filter(plugin => `${plugin.name} ${plugin.description} ${plugin.author}`.toLowerCase().includes(search.toLowerCase())));
  async function refresh() {
    loading = true; message = '';
    try { const result = await window.api.listPluginMarketplace(); plugins = result.plugins; source = result.source; variant = result.variant; }
    catch (error) { message = error.message; }
    finally { loading = false; }
  }
  async function finishInstall(result) {
    if (result.canceled) return;
    if (result.kind === 'quota') {
      const accounts = (await window.api.getConfig()).channelAccounts || [];
      if (!accounts.some(account => account.id === result.providerId)) await window.api.addChannelAccount('custom', result.providerId, result.name);
      await window.api.setProviderConfig(result.providerId, {template: 'custom', baseUrl: result.query.baseUrl || '', script: result.script});
      message = `已安装 ${result.name}，在 Coding Plan 管理中填写自己的凭据并连接`;
      if (!result.query.requiresAuth) {
        const auth = await window.api.providerCheckAuth(result.providerId);
        if (auth.status === 'connected') { await window.api.providerFetchData(result.providerId); message = `已安装 ${result.name}，接口已连接`; }
        else message = `已安装 ${result.name}；${auth.error || '请在 Coding Plan 管理中连接'}`;
      }
    } else message = `已安装 ${result.name}，可在已安装插件中启用和预览`;
    const notice = message;
    await onchanged(); await refresh(); message = notice;
  }
  async function install(plugin) {
    busy = plugin.id; message = '';
    try { await finishInstall(await window.api.installMarketplacePlugin(plugin.id)); }
    catch (error) { message = error.message; }
    finally { busy = ''; }
  }
  async function localInstall() {
    busy = 'local'; message = '';
    try { await finishInstall(await window.api.installLocalPluginZip()); }
    catch (error) { message = error.message; }
    finally { busy = ''; }
  }
  async function saveSource() {
    busy = 'source';
    try { await window.api.setPluginMarketplaceSource(source); editingSource = false; await refresh(); }
    catch (error) { message = error.message; }
    finally { busy = ''; }
  }
  onMount(refresh);
</script>

<div class="marketplace">
  <div class="market-heading"><div><h3>发现插件</h3><p>社区独立维护 · 适用于 {variant === 'esp32' ? 'ESP32 主机' : 'Windows 副屏'}</p></div>
    <button class="quiet" onclick={() => window.api.openExternal('https://github.com/Fin2003/monitor-windows/blob/main/docs/plugins.md')}><Icon name="external-link" size={14} /> 提交插件</button>
  </div>
  <div class="toolbar"><input aria-label="搜索插件" placeholder="搜索插件、功能或作者" bind:value={search} /><button class="quiet" onclick={refresh} disabled={loading || !!busy}><Icon name="refresh" size={14} /> 刷新</button></div>
  {#if message}<p class="notice" role="status">{message}</p>{/if}
  {#if loading}<p class="muted">正在读取插件索引…</p>
  {:else if !filtered.length}<div class="empty-market"><Icon name="plugin" size={28} /><p>{search ? '没有匹配的插件' : '暂无插件，可刷新或提交自己的插件'}</p></div>
  {:else}<div class="catalog">{#each filtered as plugin (plugin.id)}
    <article class="market-card">
      <div class="card-top"><span class="mark"><Icon name={plugin.icon || 'plugin'} size={20} /></span><div><h4>{plugin.name}</h4><span class="muted">{plugin.author} · v{plugin.version} · {plugin.license}</span></div></div>
      <p class="description">{plugin.description}</p>
      <div class="tags"><span>{plugin.kind === 'quota' ? '额度查询' : '显示页面'}</span>{#each plugin.targets as target}<span>{target === 'esp32' ? 'ESP32' : 'Windows'}</span>{/each}{#if plugin.requiresAuth}<span>需配置自己的凭据</span>{/if}</div>
      <div class="card-bottom"><button class="quiet" onclick={() => window.api.openExternal(plugin.repository)}>查看源码</button><button class="install" disabled={!!busy || !plugin.compatible || (!!plugin.installedVersion && !plugin.updateAvailable)} onclick={() => install(plugin)}>{busy === plugin.id ? '正在安装…' : !plugin.compatible ? '当前版本不适用' : plugin.updateAvailable ? '更新插件' : plugin.installedVersion ? '已安装' : '安装'}</button></div>
    </article>
  {/each}</div>{/if}
  <div class="market-footer"><button class="quiet" onclick={localInstall} disabled={!!busy}>安装本地 ZIP</button><button class="quiet" onclick={() => editingSource = !editingSource}>市场来源</button></div>
  {#if editingSource}<div class="source-editor"><label>索引地址<input type="url" bind:value={source} placeholder="HTTPS index.json；留空恢复默认" /></label><button class="install" disabled={!!busy} onclick={saveSource}>保存来源</button></div>{/if}
</div>

<style>
  .market-heading,.toolbar,.card-top,.card-bottom,.market-footer { display:flex;align-items:center;gap:12px; }
  .market-heading,.card-bottom { justify-content:space-between; }
  h3,h4,p { margin:0; } h3 { font-size:17px; } h4 { font-size:15px; }
  .market-heading p,.muted { color:var(--text-secondary);font-size:12px; }
  .market-heading p { margin-top:5px; } .toolbar { margin:20px 0 16px; }
  input { flex:1;min-width:0;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text-primary);font:inherit;font-size:13px; }
  input:focus { outline:2px solid var(--accent);outline-offset:1px; }
  .catalog { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px; }
  .market-card { padding:18px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg,14px); }
  .mark { display:flex;padding:10px;background:var(--card-hover);border-radius:11px;color:var(--accent); }
  .description { font-size:13px;line-height:1.65;margin:15px 0;color:var(--text-secondary); }
  .tags { display:flex;flex-wrap:wrap;gap:6px; } .tags span { font-size:11px;padding:4px 7px;background:var(--card-hover);border-radius:6px;color:var(--text-secondary); }
  .card-bottom { margin-top:18px; } button { display:flex;align-items:center;justify-content:center;gap:5px;font:inherit;font-size:12px;border-radius:8px;padding:8px 11px;cursor:pointer; }
  .quiet { background:transparent;color:var(--text-secondary); } .quiet:hover { color:var(--text-primary);background:var(--card-hover); }
  .install { background:var(--accent);color:white;min-width:68px; } button:active:not(:disabled) { transform:scale(.97); } button:disabled { opacity:.5;cursor:default; }
  .notice { font-size:13px;line-height:1.6;padding:12px 14px;background:var(--card-hover);border-radius:10px;margin-bottom:15px; }
  .market-footer { margin-top:20px;border-top:1px solid var(--border);padding-top:12px; }
  .source-editor { display:flex;align-items:end;gap:10px;margin-top:12px; } .source-editor label { display:flex;flex:1;flex-direction:column;gap:7px;font-size:12px;color:var(--text-secondary); }
  .empty-market { padding:40px;text-align:center;color:var(--text-secondary); } .empty-market p { margin-top:12px;font-size:13px; }
</style>
