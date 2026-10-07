<script>
  import { onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import RadarBoard from './RadarBoard.svelte';
  import ManualResetDialog from './ManualResetDialog.svelte';
  import { formatRadarDate, displayTimeZoneLabel, DISPLAY_TIME_ZONES } from './presentation.cjs';
  let { standalone = false } = $props();
  let data = $state({ events: [], posts: [], pending: [], banked: [], latest: null, config: { intervalSeconds: 120, paused: false }, meta: {} });
  let now = $state(Date.now());
  let error = $state('');
  let refreshing = $state(false);
  let loading = $state(true);
  let settingsDialog;
  let modelDraft = $state({ name: '', baseUrl: '', format: 'chat', model: '', apiKey: '', clearKey: false, hasApiKey: false });
  let modelReady = $state(false);
  let modelBusy = $state(false);
  let modelLoading = $state(false);
  let modelEdited = $state(false);
  let modelLoadError = $state('');
  let modelResult = $state(null);
  let modelTab = $state('glm');
  let jevDraft = $state({ name: 'JEV', baseUrl: 'https://ai-gateway.vercel.sh/v1', format: 'evaluate', model: 'typesafe-ai/jev', apiKey: '', clearKey: false, hasApiKey: false });
  let jevReady = $state(false);
  let jevBusy = $state(false);
  let jevEdited = $state(false);
  let jevLoadError = $state('');
  let jevResult = $state(null);
  let xBusy = $state(false);
  let xError = $state('');
  let xStatus = $state('idle');
  let xStatusError = $state('');
  let xCheckBusy = $state(false);
  let switchingProvider = $state(false);
  let switchError = $state('');
  let replyLabel = $derived(xStatus === 'disconnected' ? '回复待连接'
    : data.meta.repliesStatus === 'ready' ? `回复已获取 · ${date(data.meta.repliesSuccess)}`
    : data.meta.repliesStatus === 'login_required' && xStatus === 'connected' ? '回复待检查'
    : ({ off: '回复待检查', login_required: '回复待连接', page_error: '回复加载失败', rate_limited: '回复限流',
      challenge: 'X 需验证', redirected: '回复跳转', loading: '回复未返回', coverage_incomplete: '回复覆盖不足' })[data.meta.repliesStatus] || '回复待检查');
  async function checkXStatus() {
    if (xCheckBusy || !data.config.repliesEnabled) return;
    xCheckBusy = true;
    xStatus = 'checking';
    xStatusError = '';
    try {
      if (!window.api?.getTiboXStatus) throw new Error('X 状态检查不可用');
      const result = await window.api.getTiboXStatus();
      if (data.config.repliesEnabled) xStatus = result.connected ? 'connected' : 'disconnected';
    } catch (e) {
      if (data.config.repliesEnabled) { xStatus = 'error'; xStatusError = e.message; }
    } finally { xCheckBusy = false; }
  }
  async function connectX() {
    xBusy=true;xError='';
    try { await window.api.connectTiboX(); await checkXStatus(); }
    catch(e) { xError=e.message; }
    finally { xBusy=false; }
  }
  async function toggleReplies(event) {
    const enabled = event.currentTarget.checked;
    if (!await configure({ repliesEnabled: enabled })) { event.currentTarget.checked = data.config.repliesEnabled; return; }
    if (enabled) await checkXStatus();
    else { xStatus = 'idle'; xStatusError = ''; }
  }
  async function openSettings() {
    modelTab = data.config.analysisProvider || 'glm';
    settingsDialog.showModal();
    await Promise.all([modelReady ? Promise.resolve() : loadModelSettings(), jevReady ? Promise.resolve() : loadJevSettings(), checkXStatus()]);
  }
  async function loadJevSettings() {
    jevLoadError = '';
    try {
      if (!window.api?.getTiboJev) throw new Error('JEV_BACKEND_MISSING');
      const saved = await window.api.getTiboJev();
      jevDraft = jevEdited ? { ...jevDraft, hasApiKey: saved.hasApiKey } : { ...jevDraft, ...saved, apiKey: '', clearKey: false };
      jevReady = true;
    } catch (e) {
      jevLoadError = /No handler registered|JEV_BACKEND_MISSING/.test(e.message)
        ? 'JEV 后台未加载'
        : `JEV 读取失败：${e.message}`;
    }
  }
  async function jevAction() {
    if (jevBusy || !jevReady) return;
    jevBusy = true;
    jevResult = null;
    try {
      const draft = { ...jevDraft };
      jevDraft = { ...jevDraft, ...await window.api.saveTiboJev(draft), apiKey: '', clearKey: false };
      jevEdited = false;
      switchError = '';
      jevResult = { ok: true, text: 'JEV 连接已保存' };
    } catch (e) { jevResult = { ok: false, error: e.message }; }
    finally { jevBusy = false; }
  }
  function percent(value) { return `${Math.round((value || 0) * 100)}%`; }
  const kindLabels = { forecast: '普通重置预告', completion: '普通重置完成', mention: '普通重置提及', none: '无普通重置' };
  const bankedLabels = { promised: 'Banked 预告', credited: 'Banked +1', mention: 'Banked 提及', none: '无 Banked' };
  const timingLabels = { clock: '明确时刻', relative: '相对时间', date: '日期线索', unknown: '时间未明确' };
  async function loadModelSettings() {
    if (modelLoading) return;
    modelLoading = true;
    modelLoadError = '';
    let timeout;
    try {
      if (!window.api?.getTiboModel) throw new Error('MODEL_BACKEND_MISSING');
      const saved = await Promise.race([
        window.api.getTiboModel(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('读取超时')), 10000); })
      ]);
      modelDraft = modelEdited ? { ...modelDraft, hasApiKey: saved.hasApiKey } : { ...saved, apiKey: '', clearKey: false };
      modelReady = true;
    } catch (e) {
      modelLoadError = /No handler registered|MODEL_BACKEND_MISSING/.test(e.message)
        ? 'LLM 后台未加载'
        : `LLM 读取失败：${e.message}`;
    } finally { clearTimeout(timeout); modelLoading = false; }
  }
  async function modelAction() {
    if (modelBusy || !modelReady || modelLoading) return;
    modelBusy = true;
    modelResult = null;
    try {
      const draft = { ...modelDraft };
      modelDraft = { ...await window.api.saveTiboModel(draft), apiKey: '', clearKey: false };
      modelEdited = false;
      modelResult = { ok: true, text: 'LLM 连接已保存' };
    } catch (e) { modelResult = { ok: false, error: e.message }; }
    finally { modelBusy = false; }
  }
  let postDialog;
  let manualDialog;
  let expandedPost = $state(null);


  let syncIssue = $derived(error || data.meta.errors?.find(e => !/^(?:GLM|JEV)\b/.test(e)) || '');
  let analysisIssue = $derived(data.meta.errors?.find(e => /^(?:GLM|JEV)\b/.test(e)) || '');


  function date(ms) {
    return ms ? formatRadarDate(ms, data.config.displayTimeZone) : '未明确';
  }
  async function load() {
    if (!window.api?.getTiboRadar) { error = '请在 Monitor 中打开 Tibo 雷达'; loading = false; return; }
    try { data = await window.api.getTiboRadar(); error = ''; } catch (e) { error = e.message; }
    loading = false;
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try { data = await window.api.refreshTiboRadar(); error = ''; } catch (e) { error = e.message; }
    finally { refreshing = false; }
  }
  async function configure(value) {
    try { data = await window.api.configureTiboRadar(value); error = ''; return true; }
    catch (e) { error = e.message; return false; }
  }
  async function switchProvider(provider) {
    if (switchingProvider || data.config.analysisProvider === provider) return;
    switchingProvider = true;
    switchError = '';
    try { data = await window.api.configureTiboRadar({ analysisProvider: provider }); }
    catch (e) { switchError = e.message; }
    finally { switchingProvider = false; }
  }
  function inspect(post) { expandedPost = post; postDialog.showModal(); }
  function open(url) { window.api?.openExternal(url); }
  onMount(() => {
    load();
    if (standalone) window.api?.getConfig().then(c => { document.documentElement.dataset.theme = c.theme || 'dark'; }).catch(() => {});
    const checkOnFocus = () => { if (settingsDialog?.open && data.config.repliesEnabled) checkXStatus(); };
    window.addEventListener('focus', checkOnFocus);
    const poll = setInterval(() => { load(); if (settingsDialog?.open && data.config.repliesEnabled) checkXStatus(); }, 5000);
    const tick = setInterval(() => { now = Date.now(); }, 1000);
    return () => { window.removeEventListener('focus', checkOnFocus); clearInterval(poll); clearInterval(tick); };
  });
</script>

<RadarBoard {data} {now} {loading} {refreshing} {syncIssue} {analysisIssue} onRefresh={refresh} onSettings={openSettings} onInspect={inspect} onManual={mode => manualDialog.open(mode)} />
<ManualResetDialog bind:this={manualDialog} manual={data.manual} onChange={next => { if (next) data = next; }} />

<dialog bind:this={settingsDialog} class="settings-dialog">
  <div class="dialog-heading"><h2>监测设置</h2><button class="icon" title="关闭设置" aria-label="关闭设置" onclick={() => settingsDialog.close()}><Icon name="close" size={25} /></button></div>
  <section class="settings">
    <section class="provider-section" aria-label="判断渠道">
      <div class="channel-heading"><strong>判断渠道</strong></div>
      <div class="provider-options">
        <div class="provider-option"><strong>LLM</strong>{#if (data.config.analysisProvider || 'glm') === 'glm'}<span class="provider-active"><Icon name="check" size={20} />使用中</span>{:else}<button disabled={switchingProvider} onclick={() => switchProvider('glm')}>切换到 LLM</button>{/if}</div>
        <div class="provider-option"><strong>JEV</strong>{#if data.config.analysisProvider === 'jev'}<span class="provider-active"><Icon name="check" size={20} />使用中</span>{:else}<button disabled={switchingProvider} onclick={() => switchProvider('jev')}>切换到 JEV</button>{/if}</div>
      </div>
      {#if switchError}<p class="warning" role="alert">{switchError}</p>{/if}
    </section>
    <fieldset class="model-settings x-connection">
      <legend>X 帖子来源</legend>
      <label class="settings-toggle"><input type="checkbox" checked={data.config.repliesEnabled} onchange={toggleReplies} />读取回复</label>
      <p>主帖 · {date(data.meta.timelineSuccess)}</p>
      {#if data.config.repliesEnabled}
        <p class:warning={xStatus !== 'connected'} title={xStatusError}>{({ checking: 'X 检查中', connected: 'X 已连接', disconnected: 'X 未连接', error: 'X 检查失败' })[xStatus] || 'X 待检查'}</p>
        <p class:warning={data.meta.repliesStatus !== 'ready'} title={data.meta.repliesError || ''}>{replyLabel}</p>
      {:else}<p>仅主帖</p>{/if}
      <div class="model-actions">
        {#if data.config.repliesEnabled}<button disabled={xBusy} onclick={connectX}><Icon name="eye" size={24} />{xBusy ? '正在打开…' : xStatus === 'connected' ? '打开 X' : '连接 X'}</button>{/if}
        {#if data.config.repliesEnabled}<button disabled={xCheckBusy} onclick={checkXStatus}><Icon name="refresh" size={24} />检查连接</button>{/if}
        <button disabled={refreshing || data.meta.fetching || !data.meta.running} onclick={refresh}><Icon name="refresh" size={24} />检查新帖</button>
      </div>
      {#if xError}<p class="warning" role="alert">{xError}</p>{/if}
    </fieldset>
    <div class="channel-heading"><strong>连接参数</strong></div>
    <div class="model-switch" role="tablist" aria-label="编辑连接参数">
      <button role="tab" aria-selected={modelTab === 'glm'} class:chosen={modelTab === 'glm'} onclick={() => modelTab = 'glm'}>LLM 参数</button>
      <button role="tab" aria-selected={modelTab === 'jev'} class:chosen={modelTab === 'jev'} onclick={() => modelTab = 'jev'}>JEV 参数</button>
    </div>
    {#if modelTab === 'glm'}
    {#if modelLoadError}<div class="model-result warning" role="alert">{modelLoadError}<button class="model-retry" disabled={modelLoading} onclick={loadModelSettings}>{modelLoading ? '读取中…' : '重新读取配置'}</button></div>{/if}
    <fieldset class="model-settings" disabled={modelBusy || modelLoading} oninput={() => { modelEdited = true; }} onchange={() => { modelEdited = true; }}>
      <legend>LLM 连接</legend>
      <div class="model-fields">
        <label>名称<input bind:value={modelDraft.name} placeholder="Tibo 帖子分析" /></label>
        <label>API 格式<select bind:value={modelDraft.format}><option value="chat">Chat Completions</option><option value="responses">Responses</option><option value="anthropic">Anthropic Messages</option></select></label>
        <label class="wide">Base URL<input bind:value={modelDraft.baseUrl} placeholder="https://api.example.com/v1" spellcheck="false" /></label>
        <label class="wide">API Key<input type="password" bind:value={modelDraft.apiKey} placeholder={modelDraft.hasApiKey ? '已保存' : 'API Key'} autocomplete="off" /></label>
        {#if modelDraft.hasApiKey}<label class="wide clear-key"><input type="checkbox" bind:checked={modelDraft.clearKey} />清除已保存密钥</label>{/if}
        <label class="wide">模型名<input bind:value={modelDraft.model} placeholder="模型 ID" spellcheck="false" /></label>
      </div>
      <div class="model-actions"><button disabled={!modelReady} onclick={modelAction}>{modelBusy ? '保存中…' : '保存连接'}</button></div>
    </fieldset>
    {#if modelResult}<div class:success={modelResult.ok} class:warning={!modelResult.ok} class="model-result" role="status">{modelResult.ok ? modelResult.text : modelResult.error}{#if modelResult.elapsedMs !== undefined}<small>{modelResult.status ? `HTTP ${modelResult.status} · ` : ''}{modelResult.elapsedMs} ms</small>{/if}</div>{/if}
    {:else}
    <fieldset class="model-settings" disabled={jevBusy} oninput={() => { jevEdited = true; }}>
      <legend>JEV 连接</legend>
      <div class="model-fields">
        <label>名称<input bind:value={jevDraft.name} placeholder="JEV" /></label>
        <label>模型名<input value={jevDraft.model} readonly /></label>
        <label class="wide">Base URL<input value={jevDraft.baseUrl} readonly spellcheck="false" /></label>
        <label class="wide">API Key<input type="password" bind:value={jevDraft.apiKey} placeholder={jevDraft.hasApiKey ? '已保存' : 'API Key'} autocomplete="off" /></label>
        {#if jevDraft.hasApiKey}<label class="wide clear-key"><input type="checkbox" bind:checked={jevDraft.clearKey} />清除已保存密钥</label>{/if}
      </div>
      <div class="model-actions"><button disabled={!jevReady} onclick={jevAction}>{jevBusy ? '保存中…' : '保存连接'}</button></div>
      {#if jevLoadError}<p class="warning" role="alert">{jevLoadError}</p>{/if}
      {#if jevResult}<div class:success={jevResult.ok} class:warning={!jevResult.ok} class="model-result" role="status">{jevResult.ok ? jevResult.text : jevResult.error}{#if jevResult.elapsedMs !== undefined}<small>{jevResult.status ? `HTTP ${jevResult.status} · ` : ''}{jevResult.elapsedMs} ms</small>{/if}</div>{/if}
    </fieldset>
    {/if}
    <label>检查间隔 <select value={data.config.intervalSeconds} onchange={e => configure({ intervalSeconds: +e.currentTarget.value })}><option value="60">1 分钟</option><option value="120">2 分钟</option><option value="300">5 分钟</option><option value="600">10 分钟</option><option value="900">15 分钟</option></select></label>
    <label>显示时区 <select value={data.config.displayTimeZone || 'Asia/Shanghai'} onchange={e => configure({ displayTimeZone: e.currentTarget.value })}>{#each Object.entries(DISPLAY_TIME_ZONES) as [zone,label]}<option value={zone}>{label}</option>{/each}</select></label>
    <label><input type="checkbox" checked={data.config.paused} onchange={e => configure({ paused: e.currentTarget.checked })}>暂停后台检查</label>
    <p>待补全 {data.meta.backlog || 0}</p>
    {#if data.meta.modelEnabled}<p>待判断 {data.meta.analysisPending || 0}</p>{/if}
    {#if syncIssue}<p class="warning">{syncIssue}</p>{/if}
    {#if analysisIssue}<p class="warning">{analysisIssue}</p>{/if}
  </section>
</dialog>
<dialog bind:this={postDialog} class="post-dialog">
  <div class="dialog-heading"><h2>帖子原文</h2><button class="icon" title="关闭原文" aria-label="关闭原文" onclick={() => postDialog.close()}><Icon name="close" size={25} /></button></div>
  {#if expandedPost}
    <p class="post-meta">@thsottiaux · {date(expandedPost.publishedAt)}</p>
    {#if expandedPost.source === 'llm'}<p class="post-meta">LLM · {expandedPost.banked ? 'Banked' : { forecast: '预告', completion: '完成', mention: '提及', irrelevant: '普通帖' }[expandedPost.kind]}</p>{:else if expandedPost.source === 'pending'}<p class="post-meta">待判断</p>{/if}
    {#if expandedPost.source === 'jev' && expandedPost.jev}
      <section class="jev-review" aria-label="JEV 判断">
        <strong>JEV</strong>
        <p>{kindLabels[expandedPost.jev.ordinary.choice]} · {percent(expandedPost.jev.ordinary.probability)}</p>
        {#if expandedPost.jev.banked.choice !== 'none'}<p>{bankedLabels[expandedPost.jev.banked.choice]} · {percent(expandedPost.jev.banked.probability)}</p>{/if}
        {#if expandedPost.jev.ordinary.choice === 'forecast'}<p>{timingLabels[expandedPost.jev.timing.choice]} · {percent(expandedPost.jev.timing.probability)}</p>{/if}
        {#if expandedPost.jev.hour}
          {#if expandedPost.jev.hour.supported}
            <p>{expandedPost.jev.hour.candidate.basis === 'date_policy' ? '预测' : expandedPost.jev.hour.candidate.basis === 'nearby' ? '关联预测' : '预计'}{displayTimeZoneLabel(data.config.displayTimeZone)} {date(expandedPost.jev.hour.estimatedAt)} · {percent(expandedPost.jev.hour.probability)}</p>
          {/if}
        {/if}
      </section>
    {/if}
    {#if expandedPost.eta}<p class="post-meta">{expandedPost.eta.timeClass === 'prediction' ? '预测' : expandedPost.eta.timeClass === 'inferred' ? '关联预测' : '预计'} · {displayTimeZoneLabel(data.config.displayTimeZone)} {date(expandedPost.eta.at)}</p>{:else if expandedPost.kind === 'forecast' && !expandedPost.banked}<p class="post-meta">未通报时间</p>{/if}
    {#if expandedPost.banked}<p class="post-meta">Banked +1</p>{/if}
    <blockquote>{expandedPost.text || expandedPost.keyText}</blockquote>
    {#if expandedPost.corroboration}
      <section aria-label="附近时间参考" class="reply-evidence">
        <p class="post-meta" class:warning={!expandedPost.corroboration.applied}>{expandedPost.corroboration.applied ? '时间线索' : '未采用'}</p>
        <blockquote>{expandedPost.corroboration.evidence}</blockquote>
        <button class="source" onclick={() => open(expandedPost.corroboration.url)}>来源 <Icon name="chevron-right" size={22} /></button>
      </section>
    {/if}
    <button class="source" onclick={() => open(expandedPost.url)}>X 原帖 <Icon name="chevron-right" size={22} /></button>
  {/if}
</dialog>

<style>
  .success { color:var(--success); } .warning { color:var(--warning); }
  .reply-evidence { border-top:1px solid var(--border); margin-top:20px; padding-top:12px; }
  .jev-review { border-left:3px solid var(--accent); padding:8px 14px; margin:16px 0; background:var(--card); font-size:24px; }
  .jev-review p { margin:4px 0; font-size:23px; }
  .model-fields input[readonly] { color:var(--text-secondary); }
  .channel-heading { font-size:26px; font-weight:650; }
  .provider-section { border-bottom:1px solid var(--border); padding-bottom:16px; }
  .provider-options { margin-top:10px; }
  .provider-option { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:54px; border-top:1px solid var(--border); }
  .provider-option strong { font-size:24px; }
  .provider-option button { min-height:40px; padding:4px 10px; border:1px solid var(--accent); border-radius:6px; background:transparent; color:var(--accent); font-size:22px; }
  .provider-option button:disabled { opacity:.45; }
  .provider-active { display:inline-flex; align-items:center; gap:5px; color:var(--success); font-size:22px; }
  .model-switch { display:flex; gap:4px; padding:4px; background:var(--card); border-radius:7px; align-self:flex-start; }
  .model-switch button { min-width:132px; min-height:44px; padding:4px 12px; border:0; border-radius:5px; background:transparent; color:var(--text-secondary); font-size:24px; transition:none; }
  .model-switch button.chosen { background:var(--card-hover); color:var(--text-primary); }
  .settings-toggle { font-size:26px; }
  .x-connection .model-actions button { display:flex; align-items:center; gap:8px; }
  dialog { margin:auto; box-sizing:border-box; width:860px; max-width:calc(100% - 20px); max-height:calc(100% - 20px); padding:0 20px 20px; color:var(--text-primary); background:var(--bg); border:1px solid var(--border); border-radius:8px; overflow:auto; letter-spacing:0; font-size:26px; box-shadow:0 16px 64px #0005; }
  dialog::backdrop { background:#0009; backdrop-filter:blur(6px); }
  .dialog-heading { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:64px; margin-bottom:18px; border-bottom:1px solid var(--border); background:var(--bg); }
  h2 { font-size:30px; line-height:1.15; margin:0; } .icon { display:inline-flex; flex-shrink:0; justify-content:center; align-items:center; width:40px; height:40px; border-radius:6px; background:transparent; color:var(--text-primary); padding:0; }
  button { touch-action:manipulation; } button:active:not(:disabled) { transform:scale(.98); } button:focus-visible,summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; } button:disabled { opacity:.5; cursor:not-allowed; }
  .settings { display:flex; flex-direction:column; gap:18px; min-width:0; } .settings label { display:flex; flex-wrap:wrap; align-items:center; gap:10px; } .settings select { font-size:26px; min-height:44px; max-width:100%; } .settings input[type=checkbox] { width:26px; height:26px; accent-color:var(--accent); }
  .settings p,.post-meta { font-size:24px; line-height:1.4; color:var(--text-secondary); overflow-wrap:anywhere; } .post-meta { margin:8px 0; } .post-meta.warning { color:var(--warning); }
  .post-dialog blockquote { font-size:36px; line-height:1.4; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; margin:20px 0; } .source { display:flex; align-items:center; gap:8px; padding:10px 0; color:var(--accent); background:transparent; font-size:26px; }
  .model-settings { min-width:0; margin:0; padding:0 0 20px; border:0; border-bottom:1px solid var(--border); } legend { font-size:26px; font-weight:650; margin-bottom:16px; } .model-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
  .model-fields label { display:flex; flex-direction:column; align-items:stretch; min-width:0; font-size:24px; } .model-fields .wide { grid-column:1/-1; }
  .model-fields input:not([type=checkbox]),.model-fields select { box-sizing:border-box; width:100%; min-width:0; height:48px; padding:6px 10px; font-size:26px; color:var(--text-primary); background:var(--card); border:1px solid var(--border); border-radius:6px; }
  .model-fields .clear-key { flex-direction:row; align-items:center; } .model-actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:20px; } .model-actions button,.model-retry { font-size:26px; min-height:48px; padding:8px 14px; background:var(--card); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; }
  .model-actions button:last-child { color:var(--accent); border-color:var(--accent); } .model-settings:disabled { opacity:.6; } .model-result { white-space:pre-wrap; overflow-wrap:anywhere; font-size:26px; line-height:1.4; user-select:text; } .model-result small { display:block; font-size:22px; margin-top:6px; } .model-retry { display:block; margin-top:12px; }
  @media(max-width:600px) { .model-fields { grid-template-columns:minmax(0,1fr); } dialog { padding:0 14px 14px; } }
  @media(prefers-reduced-motion:reduce) { button:active:not(:disabled) { transform:none; } }
</style>
