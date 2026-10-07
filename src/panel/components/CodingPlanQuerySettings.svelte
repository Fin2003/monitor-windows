<script>
  import { onDestroy } from 'svelte';
  import catalog from '../../../electron/providers/quota-catalog.json';
  let { accountId, type, onverified = () => {} } = $props();
  let config = $state({}), mode = $state('auto'), fields = $state({}), baseUrl = $state('');
  let template = $state('general'), newApiMode = $state('account'), quotaScale = $state(500000), unit = $state('USD'), githubDomain = $state('github.com');
  let busy = $state(false), message = $state(''), device = $state(null);
  let loginTimer;
  const sessionTypes = ['volcengine', 'opencodego'];
  const editableUrls = ['zhipu', 'minimax', 'siliconflow', 'zenmux', 'newapi', 'custom'];
  let oauth = $derived(catalog[type]?.auth === 'oauth');
  let secretFields = $derived(
    sessionTypes.includes(type) && mode === 'web' ? [] :
    type === 'volcengine' ? [['accessKeyId', 'AccessKey ID'], ['secretAccessKey', 'Secret Access Key']] :
    oauth ? [['accessToken', 'OAuth Access Token'], ...(type === 'gemini' ? [['refreshToken', 'Refresh Token']] : []), ...(type === 'codex' ? [['accountId', 'ChatGPT Account ID']] : [])] :
    type === 'newapi' && newApiMode === 'account' ? [['accessToken', '账户 Access Token'], ['userId', 'User ID']] :
    type === 'custom' ? [['apiKey', 'API Key'], ['accessToken', 'Access Token'], ['userId', 'User ID']] :
    [['apiKey', type === 'zenmux' ? 'Management API Key' : type === 'copilot' ? 'GitHub Token（可选）' : 'API Key'], ...(type === 'zhiputeam' ? [['organizationId', '组织 ID'], ['projectId', '项目 ID']] : [])]);
  $effect(() => {
    const id = accountId;
    clearTimeout(loginTimer); device = null; busy = false;
    config = {}; fields = {}; message = '';
    window.api.getProviderConfig(id).then(value => {
      if (accountId !== id) return;
      config = value || {}; mode = config.mode || 'auto'; baseUrl = config.baseUrl || catalog[type]?.url || '';
      template = config.template || 'general'; newApiMode = config.newApiMode || 'account'; quotaScale = config.quotaScale || 500000; unit = config.unit || 'USD'; githubDomain = config.githubDomain || 'github.com';
    });
  });
  onDestroy(() => clearTimeout(loginTimer));
  const saved = key => config['has' + key[0].toUpperCase() + key.slice(1)] ? '已加密保存；留空保留' : '';
  async function verify() {
    const result = await window.api.providerCheckAuth(accountId);
    if (result.status === 'connected') { await window.api.providerFetchData(accountId); message = '接口验证成功'; }
    else message = result.error || '请完成网页登录后点确认';
    onverified();
  }
  async function persist() {
    await window.api.setProviderConfig(accountId, { mode, baseUrl, template, newApiMode, quotaScale, unit, githubDomain, ...$state.snapshot(fields) });
    fields = {}; config = await window.api.getProviderConfig(accountId);
  }
  async function save() {
    busy = true; message = '正在验证接口…';
    try { await persist(); await verify(); } catch (error) { message = error.message; } finally { busy = false; }
  }
  async function importLogin() {
    busy = true;
    try { const result = await window.api.importProviderAuth(accountId); if (!result.canceled) { config = await window.api.getProviderConfig(accountId); await verify(); } }
    catch (error) { message = error.message; } finally { busy = false; }
  }
  async function githubLogin() {
    clearTimeout(loginTimer); busy = true;
    const id = accountId;
    try {
      await persist(); device = await window.api.beginCopilotLogin(id); message = '在 GitHub 输入设备码完成授权';
      await window.api.openExternal(device.verificationUri);
      async function poll() {
        if (accountId !== id) return;
        try {
          const result = await window.api.pollCopilotLogin(id);
          if (result.pending) loginTimer = setTimeout(poll, result.interval * 1000);
          else { device = null; busy = false; config = await window.api.getProviderConfig(id); await verify(); }
        } catch (error) { device = null; busy = false; message = error.message; }
      }
      loginTimer = setTimeout(poll, device.interval * 1000);
    } catch (error) { busy = false; message = error.message; }
  }
</script>

<div class="query-settings">
  <div class="query-title">额度查询</div>
  {#if sessionTypes.includes(type)}
    <label>认证方式<select bind:value={mode}><option value="auto">自动：已保存 Key 优先，否则使用登录会话</option><option value="api">{type === 'volcengine' ? 'AK/SK' : 'API Key'}</option><option value="web">网页登录会话</option></select></label>
  {/if}
  {#if sessionTypes.includes(type) && mode === 'web'}<p>在账号的连接窗口登录，完成后自动验证套餐接口。</p>{/if}
  {#if oauth}
    <button class="import-button" onclick={importLogin} disabled={busy}>导入本机 CLI 登录</button>
    <p>选择此账号的登录 JSON。{config.hasCredentialFile ? '已绑定；CLI 更新登录后自动读取新凭据。' : '也可以填写 OAuth Token；推理 API Key 不适用。'}</p>
  {/if}
  {#if type === 'newapi'}
    <label>查询范围<select bind:value={newApiMode}><option value="account">账户额度</option><option value="key">API Key 额度</option></select></label>
    <label>每单位对应额度<input type="number" bind:value={quotaScale} min="1" /></label>
    <label>显示单位<input type="text" bind:value={unit} /></label>
  {/if}
  {#if type === 'custom'}<label>查询模板<select bind:value={template}><option value="general">通用余额 /user/balance</option><option value="newapi">New API 账户额度</option><option value="custom">CC Switch 自定义脚本</option></select></label>{/if}
  {#if type === 'copilot'}
    <label>GitHub 域名<input type="text" bind:value={githubDomain} placeholder="github.com" /></label>
    <button class="import-button" onclick={githubLogin} disabled={busy}>GitHub 设备码登录</button>
    {#if device}<p class="device-code">设备码：<strong>{device.userCode}</strong></p>{/if}
  {/if}
  {#each secretFields as [key, label]}
    <label>{label}<input type="password" bind:value={fields[key]} autocomplete="off" placeholder={saved(key) || label} /></label>
  {/each}
  {#if type === 'volcengine' && mode !== 'web'}<p>使用账号级 AK/SK 和 Ark 用量查询权限。模型推理 Key 不适用。</p>{/if}
  {#if type === 'custom' && template === 'custom'}
    <label>查询脚本<textarea bind:value={fields.script} rows="12" spellcheck="false" placeholder={config.hasScript ? '脚本已加密保存；留空保留' : '粘贴 CC Switch 的 ({ request: {...}, extractor: function(response) {...} }) 脚本'}></textarea></label>
    <p>支持单个结果或多个套餐数组；变量：{'{{baseUrl}}、{{apiKey}}、{{accessToken}}、{{userId}}'}。</p>
  {/if}
  {#if editableUrls.includes(type)}
    <label>{type === 'zenmux' ? '官方用量接口地址' : 'API 地址'}<input type="url" bind:value={baseUrl} spellcheck="false" /></label>
    {#if type === 'zenmux'}<p>需要 Management API Key。</p>{/if}
    {#if type === 'zhipu'}<p>国内版：open.bigmodel.cn；国际版：api.z.ai。</p>{/if}
    {#if type === 'minimax'}<p>国内版：api.minimaxi.com；国际版：api.minimax.io。</p>{/if}
    {#if type === 'siliconflow'}<p>国内版：api.siliconflow.cn；国际版：api.siliconflow.com。</p>{/if}
  {/if}
  <div class="query-actions"><button onclick={save} disabled={busy}>{busy ? '处理中…' : '保存并验证'}</button><span role="status">{message}</span></div>
  <p class="query-source"><button class="source-link" onclick={() => window.api.openExternal('https://github.com/farion1231/cc-switch')}>CC Switch · MIT</button>{#if sessionTypes.includes(type)} · 登录会话：<button class="source-link" onclick={() => window.api.openExternal('https://github.com/Asklear/QuotaRadar')}>QuotaRadar · MIT</button>{/if}</p>
</div>

<style>
  .query-settings { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color, #ffffff18); }
  .query-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; margin: 8px 0; color: var(--text-secondary, #90949d); }
  input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border-color, #ffffff20); border-radius: 7px; background: var(--bg-tertiary, #202329); color: var(--text-primary, #eee); padding: 7px 9px; }
  textarea { font: 11px/1.5 Consolas, monospace; resize: vertical; }
  p { font-size: 10px; line-height: 1.5; color: var(--text-secondary, #90949d); margin: 6px 0; }
  .query-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 11px; }
  button { border: 0; border-radius: 7px; padding: 7px 10px; background: var(--accent-color, #367dea); color: white; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .query-source { margin-top: 10px; }
  .source-link { background: none; color: var(--text-secondary, #90949d); padding: 0; font-size: inherit; text-decoration: underline; }
  .import-button { font-size: 11px; }
  .device-code { font-size: 14px; letter-spacing: 1px; }
</style>
