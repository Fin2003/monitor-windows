<script>
  import { onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import Settings from '../manager/components/CompactOverviewSettings.svelte';
  import Monitor from '../monitor/App.svelte';
  import OverviewEditor from './OverviewEditor.svelte';
  let settings;
  let editorBusy = $state(true);
  let gestureDraft = $state(null);
  let activeDraft = $derived(gestureDraft || draft);
  let enabled = $state(false);
  let draft = $state({slots:[]});
  let width = $state(640);
  let height = $state(960);
  let previewWidth = $state(0);
  let previewHeight = $state(0);
  let error = $state('');
  let followMonitor = $state(true);
  let liveSize = $state(null);
  let disposed = false;
  let syncing = false;
  let targetWidth = $derived(followMonitor ? liveSize?.width || 1 : Math.max(240, Math.min(7680, Number(width) || 640)));
  let targetHeight = $derived(followMonitor ? liveSize?.height || 1 : Math.max(240, Math.min(7680, Number(height) || 960)));
  let zoom = $derived(Math.max(.01, Math.min(1, (previewWidth-24)/targetWidth, (previewHeight-24)/targetHeight)));
  async function syncSize() {
    if (syncing || disposed) return;
    syncing = true;
    try {
      const state = await window.api.getMonitorStatus();
      if(disposed) return;
      const size=state.running ? state.viewport : null;
      liveSize=size?.width>0 && size?.height>0 ? size : null;
      if(followMonitor && liveSize) {width=liveSize.width;height=liveSize.height;}
      error='';
    } catch(e) { if(!disposed) {error=e.message;liveSize=null;} }
    finally {syncing=false;}
  }
  async function toggle(value) {
    const result=await window.api.togglePlugin('compact-overview',value);
    if(result?.success===false) throw new Error(result.error || '切换失败');
    enabled=value;
  }
  onMount(()=>{
    window.api.getPlugins().then(plugins=>{enabled=plugins.some(p=>p.id==='compact-overview' && p.enabled);}).catch(e=>error=e.message);
    syncSize();
    const timer=setInterval(syncSize,1000);
    return ()=>{disposed=true;clearInterval(timer);};
  });
</script>

<main>
  <header><h1>缩略总览管理</h1><span>{Math.round(zoom*100)}%</span></header>
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="workspace">
    <aside><Settings bind:this={settings} {enabled} onToggle={toggle} onpreview={value=>draft=value} onbusy={value=>editorBusy=value} /></aside>
    <section class="preview-panel" aria-label="实时预览">
      <div class="toolbar">
        <label><input class="follow-toggle" type="checkbox" aria-label="跟随实际分辨率" bind:checked={followMonitor} onchange={syncSize}/>跟随实际分辨率</label>
        <label>宽<input aria-label="预览宽度" type="number" min="1" max="7680" disabled={followMonitor} bind:value={width} /></label>
        <label>高<input aria-label="预览高度" type="number" min="1" max="7680" disabled={followMonitor} bind:value={height} /></label>
        <button title="同步监控窗口尺寸" aria-label="同步监控窗口尺寸" onclick={syncSize}><Icon name="refresh" size={16}/></button>
        {#if followMonitor && liveSize}<span class="dimensions">画布 {liveSize.width} × {liveSize.height} · 输出 {liveSize.outputWidth} × {liveSize.outputHeight} px</span>{/if}
      </div>
      <div class="preview-area" bind:clientWidth={previewWidth} bind:clientHeight={previewHeight}>
        <div class="scaled-frame" hidden={followMonitor && !liveSize} style={`width:${targetWidth*zoom}px;height:${targetHeight*zoom}px`}>
          <div class="preview-canvas" style={`width:${targetWidth}px;height:${targetHeight}px;transform:scale(${zoom})`}>
            <Monitor overviewPreview overviewDraft={activeDraft}/>
            <OverviewEditor slots={draft.slots} width={targetWidth} height={targetHeight} disabled={editorBusy || (followMonitor && !liveSize)} onpreview={value=>gestureDraft=value} oncommit={values=>settings.applySlots(values)}/>
          </div>
        </div>
        {#if followMonitor && !liveSize}<span class="dimensions" role="status">等待监控画面尺寸</span>{/if}
      </div>
    </section>
  </div>
</main>

<style>
  main { height:100%; display:flex; flex-direction:column; padding:20px; gap:14px; }
  header { display:flex; align-items:center; justify-content:space-between; }
  h1 { font-size:20px; font-weight:650; }
  header span { color:var(--text-secondary); font-size:12px; }
  .workspace { flex:1; min-height:0; display:grid; grid-template-columns:minmax(400px, 1fr) minmax(320px, 1fr); gap:20px; }
  aside { min-width:0; overflow:auto; padding-right:8px; }
  .preview-panel { min-width:0; min-height:0; display:flex; flex-direction:column; border-left:1px solid var(--border); padding-left:16px; }
  .toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  label { display:flex; align-items:center; gap:6px; font-size:12px; }
  input { width:80px; padding:6px; color:var(--text-primary); background:var(--card); border:1px solid var(--border); border-radius:4px; }
  input.follow-toggle { width:16px; height:16px; }
  .dimensions { color:var(--text-secondary); font-size:12px; }
  button { width:30px; height:30px; display:grid; place-items:center; background:var(--card); color:var(--text-primary); border-radius:4px; }
  .preview-area { flex:1; min-height:0; display:grid; place-items:center; overflow:hidden; }
  .scaled-frame { position:relative; outline:1px solid var(--border); }
  .preview-canvas { transform-origin:top left; overflow:hidden; }
  p { color:var(--danger); }
  @media(max-width:800px) { main { overflow:auto; } .workspace { display:flex; flex-direction:column; flex:none; } aside { overflow:visible; } .preview-panel { height:600px; border-left:0; padding-left:0; } }
</style>
