<script>
  let { accountId, type, onverified = () => {} } = $props();
  let config = $state({});
  let mode = $state('auto');
  let apiKey = $state('');
  let accessKeyId = $state('');
  let secretAccessKey = $state('');
  let baseUrl = $state('');
  let busy = $state(false);
  let message = $state('');
  const sessionTypes = ['volcengine', 'opencodego'];
  const defaults = { zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4', minimax: 'https://api.minimaxi.com', zenmux: 'https://zenmux.ai/api/v1/management/subscription/detail' };
  $effect(() => {
    const id = accountId;
    config = {}; apiKey = ''; accessKeyId = ''; secretAccessKey = ''; message = '';
    window.api.getProviderConfig(id).then(value => { config = value || {}; mode = config.mode || 'auto'; baseUrl = config.baseUrl || defaults[type] || ''; });
  });
  async function save() {
    busy = true; message = '正在验证接口…';
    try {
      await window.api.setProviderConfig(accountId, { mode, baseUrl, apiKey, accessKeyId, secretAccessKey });
      apiKey = ''; accessKeyId = ''; secretAccessKey = '';
      config = await window.api.getProviderConfig(accountId);
      const result = await window.api.providerCheckAuth(accountId);
      if (result.status === 'connected') { await window.api.providerFetchData(accountId); message = '接口验证成功'; }
      else message = result.error || '请完成网页登录后点确认';
      onverified();
    } catch (error) { message = error.message; }
    finally { busy = false; }
  }
</script>

<div class="query-settings">
  <div class="query-title">接口查询</div>
  {#if sessionTypes.includes(type)}
    <label>认证方式
      <select bind:value={mode}>
        <option value="auto">自动：已保存 Key 优先，否则使用登录会话</option>
        <option value="api">{type === 'volcengine' ? 'AK/SK（CC Switch）' : 'API Key（CC Switch）'}</option>
        <option value="web">网页登录会话</option>
      </select>
    </label>
  {/if}
  {#if type === 'volcengine'}
    <label>AccessKey ID<input type="password" bind:value={accessKeyId} autocomplete="off" placeholder={config.hasAccessKeyId ? '已加密保存；留空保留' : '账号级 AccessKey ID'} /></label>
    <label>Secret Access Key<input type="password" bind:value={secretAccessKey} autocomplete="off" placeholder={config.hasSecretAccessKey ? '已加密保存；留空保留' : '账号级 Secret Access Key'} /></label>
    <p>使用账号级 AK/SK 和 Ark 用量查询权限。模型推理 Key 不适用。</p>
  {:else}
    <label>{type === 'zenmux' ? 'Management API Key' : '套餐 API Key'}<input type="password" bind:value={apiKey} autocomplete="off" placeholder={config.hasApiKey ? '已加密保存；留空保留' : '套餐 API Key'} /></label>
  {/if}
  {#if defaults[type]}
    <label>{type === 'zenmux' ? '官方用量接口地址' : '套餐 API 地址'}<input type="url" bind:value={baseUrl} spellcheck="false" /></label>
    {#if type === 'zenmux'}<p>需要控制台创建的 Management API Key；普通推理 Key 不适用。</p>{/if}
    {#if type === 'zhipu'}<p>支持 bigmodel.cn 国内版和 api.z.ai 国际版。</p>{/if}
    {#if type === 'minimax'}<p>国内版使用 api.minimaxi.com，国际版使用 api.minimax.io。</p>{/if}
  {/if}
  <div class="query-actions"><button onclick={save} disabled={busy}>{busy ? '验证中…' : '保存并验证'}</button><span role="status">{message}</span></div>
  <p class="query-source">Key 查询：<button class="source-link" onclick={() => window.api.openExternal('https://github.com/farion1231/cc-switch')}>CC Switch · MIT</button>{#if sessionTypes.includes(type)} · 登录会话：<button class="source-link" onclick={() => window.api.openExternal('https://github.com/Asklear/QuotaRadar')}>QuotaRadar · MIT</button>{/if}</p>
</div>

<style>
  .query-settings { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color, #ffffff18); }
  .query-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; margin: 8px 0; color: var(--text-secondary, #90949d); }
  input, select { width: 100%; box-sizing: border-box; border: 1px solid var(--border-color, #ffffff20); border-radius: 7px; background: var(--bg-tertiary, #202329); color: var(--text-primary, #e6e8ed); padding: 8px; font: inherit; }
  p { font-size: 10px; line-height: 1.5; color: var(--text-secondary, #90949d); margin: 7px 0; }
  .query-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11px; }
  button { border: 1px solid var(--border-color, #ffffff20); border-radius: 7px; background: var(--bg-tertiary, #202329); color: var(--text-primary, #e6e8ed); padding: 7px 10px; cursor: pointer; white-space: nowrap; }
  button:active { transform: scale(.98); }
  button:disabled { opacity: .5; cursor: default; }
  .source-link { border: 0; background: none; padding: 0; font: inherit; color: var(--accent-color, #76aaff); }
</style>
