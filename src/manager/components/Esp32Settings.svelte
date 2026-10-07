<script>
  import { onMount } from 'svelte';
  import Esp32Preview from './Esp32Preview.svelte';
  import Icon from '@shared/components/Icon.svelte';
  let state = $state(null), port = $state('auto'), error = $state(''), busy = $state(false);
  onMount(() => {
    let disposed = false, pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try { const next = await window.api.getEsp32Status(); if (!disposed) state = next; }
      catch (e) { if (!disposed) error = e.message; }
      finally { pending = false; }
    }
    poll(); const timer = setInterval(poll, 1500);
    return () => { disposed = true; clearInterval(timer); };
  });
  async function action(fn) {
    busy = true; error = '';
    try { state = await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>

<section class="device">
  <header><h2>ESP32-S3-Touch-LCD-5B</h2><span class:ready={state?.ready}>{state?.ready ? '已连接' : state?.open ? '等待固件握手' : '未连接'}</span></header>
  <dl><div><dt>分辨率</dt><dd>1024 × 600</dd></div><div><dt>数据模式</dt><dd>{state?.mode === 'live' ? '实时采集' : '历史缓存'}</dd></div><div><dt>传输</dt><dd>USB / JSON v1</dd></div></dl>
  <div class="controls">
    <label for="esp32-port">串口</label>
    <select id="esp32-port" bind:value={port} disabled={busy || !!state?.port}>
      <option value="auto">自动识别 USB 设备</option>
      {#each state?.candidates || [] as candidate}<option value={candidate.path}>{candidate.label}</option>{/each}
    </select>
    {#if state?.port}
      <button disabled={busy} onclick={() => action(() => window.api.disconnectEsp32())}><Icon name="close" size={16} />断开</button>
    {:else}
      <button disabled={busy} onclick={() => action(() => window.api.connectEsp32(port))}><Icon name="display" size={16} />连接</button>
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !state?.ready && state?.connectionMessage}<p>{state.connectionMessage}</p>{/if}
  <div class="page-controls">
    <button class="icon" title="上一页" aria-label="上一页" disabled={busy || !state || state.page <= 0} onclick={() => action(() => window.api.setEsp32Page(state.page - 1))}><Icon name="chevron-left" size={18} /></button>
    <label class="page-label" for="esp32-page">页面</label>
    <select id="esp32-page" value={state?.page ?? 0} disabled={!state || busy} onchange={e => action(() => window.api.setEsp32Page(Number(e.currentTarget.value)))}>
      {#each state?.pages || [] as page}<option value={page.id}>{page.id + 1}. {page.title}</option>{/each}
    </select>
    <button class="icon" title="下一页" aria-label="下一页" disabled={busy || !state || state.page + 1 >= state.pages.length} onclick={() => action(() => window.api.setEsp32Page(state.page + 1))}><Icon name="chevron-right" size={18} /></button>
  </div>
  <p class="source-health" class:error={!!state?.system?.error}>
    硬件采集：{!state?.system?.enabled ? '未启用系统监控' : state?.system?.error || (state?.system?.fresh ? '已连接 · ' + new Date(state.system.fetchedAt).toLocaleTimeString() : '正在连接硬件引擎…')}
  </p>
  <Esp32Preview />
  <div class="data-view">
    {#each state?.frame?.rows || [] as row}
      <div class="data-row"><strong>{row.label}</strong><b>{row.value}</b><small>{row.detail}</small></div>
    {/each}
  </div>
</section>

<style>
  .device{max-width:100%;color:var(--text-primary);letter-spacing:0}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  h2{font-size:18px;margin:0;overflow-wrap:anywhere}header span{font-size:12px;color:#c17d29}header .ready{color:#229c85}
  dl{display:flex;gap:30px;flex-wrap:wrap;padding:18px 0;margin:0;border-bottom:1px solid var(--border)}dt{font-size:12px;color:var(--text-secondary)}dd{margin:6px 0 0;font-size:14px}
  .controls,.page-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 0;font-size:13px}
  input,select{border:1px solid var(--border);background:var(--card);color:var(--text-primary);border-radius:4px;height:34px;padding:0 9px;min-width:0}
  input{width:100px}select{flex:1;max-width:100%}button{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 12px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text-primary);cursor:pointer}
  button:disabled{opacity:.4;cursor:default}button:active:not(:disabled){background:var(--border)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.icon{width:34px;padding:0;flex-shrink:0}.page-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .data-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:13px 0;border-bottom:1px solid var(--border);font-size:13px}.data-row strong{font-weight:500;overflow-wrap:anywhere}.data-row b{color:#229c85;font-variant-numeric:tabular-nums;max-width:150px;overflow-wrap:anywhere}.data-row small{grid-column:1/-1;color:var(--text-secondary);overflow-wrap:anywhere}.error{color:#de5b55;font-size:13px;overflow-wrap:anywhere}
</style>
