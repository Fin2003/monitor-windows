<script>
  import { onDestroy, onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import SystemMonitorPage from './SystemMonitorPage.svelte';
  import { responsiveLayout, codingChannelKeys } from '../../shared/compact-overview-config.cjs';
  import avatar from '../../../plugins/tibo-radar/assets/tibo.jpg';
  import ManualResetDialog from '../../../plugins/tibo-radar/ManualResetDialog.svelte';
  import { formatRadarAge, formatRadarDate, radarState, radarOutlook, latestRadarPosts } from '../../../plugins/tibo-radar/presentation.cjs';
  import {
    formatCountdown,
    getCodingEntry,
    normalizeSlots,
    ringFraction,
    slotKey,
  } from './compact-overview-data.js';

  let { slots = [], coding = {} } = $props();

  let radarSnapshot = $state(null);
  let radarError = $state('');
  let now = $state(Date.now());

  let mounted = false;
  let disposed = false;
  let clockTimer = null;
  let radarTimer = null;
  let radarPending = false;
  let radarStarted = false;
  let radarStarting = false;

  let availableWidth = $state(0);
  let availableHeight = $state(0);
  let layout = $derived(responsiveLayout(normalizeSlots(slots), availableWidth, availableHeight));
  let visibleSlots = $derived(layout.slots);
  let radarSlotCount = $derived(visibleSlots.filter(slot => slot.kind === 'radar').length);
  let slotSignature = $derived.by(() => visibleSlots.map((slot, index) => slotKey(slot, index)).join('\u001e'));
  let radarView = $derived.by(() => {
    const base = radarState(radarSnapshot, now);
    const status = radarError ? { ...base, kind: 'error', label: '读取失败', issue: radarError } : base;
    return {
      status,
      latestAge: formatRadarAge(base.latestAt, now),
      latestDate: formatRadarDate(base.latestAt, radarSnapshot?.config?.displayTimeZone),
      latestType: base.latestType,
      outlook: radarOutlook(radarSnapshot, now),
    };
  });
  let radarPosts = $derived(latestRadarPosts(radarSnapshot));
  let manualDialog;
  let canMark = $derived(!!radarSnapshot?.manual?.canMark);
  let manualLast = $derived(radarSnapshot?.manual?.last || null);
  function manualKey(event, mode) { if (event.type === 'click' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); manualDialog?.open(mode); } }

  $effect(() => {
    const signature = slotSignature;
    const needsRadar = radarSlotCount > 0;
    if (mounted) syncPolling(needsRadar);
  });

  function syncPolling(needsRadar) {
    if (needsRadar) startRadarPolling();
    else stopRadarPolling();
  }

  async function refreshRadarSnapshot() {
    if (disposed || !radarSlotCount || radarPending || !window.api?.getTiboRadar) return;
    radarPending = true;
    try {
      const result = await window.api.getTiboRadar();
      if (!disposed) {
        radarSnapshot = result || null;
        radarError = '';
      }
    } catch (error) {
      if (!disposed) radarError = error?.message || '读取雷达快照失败';
    } finally {
      radarPending = false;
    }
  }

  function scheduleRadarPolling() {
    clearInterval(radarTimer);
    radarTimer = null;
    if (!radarStarted || disposed || !radarSlotCount) return;
    radarTimer = setInterval(refreshRadarSnapshot, 5000);
  }

  async function startRadarPolling() {
    if (radarStarted || radarStarting || disposed || !radarSlotCount) return;
    radarStarted = true;
    radarStarting = true;
    try {
      await refreshRadarSnapshot();
    } finally {
      radarStarting = false;
      if (mounted && !disposed && radarStarted && radarSlotCount) scheduleRadarPolling();
    }
  }

  function stopRadarPolling() {
    clearInterval(radarTimer);
    radarTimer = null;
    radarStarted = false;
  }

  function ringPath(radius) {
    const left = 160 - radius;
    const right = 160 + radius;
    return `M ${left} 126 A ${radius} ${radius} 0 0 1 ${right} 126`;
  }

  function fitText(node, key) {
    let pending=false;
    let stopped=false;
    const update = () => {
      if(pending || stopped) return;
      pending=true;
      queueMicrotask(()=>{
        pending=false;if(stopped) return;
        for(const element of node.querySelectorAll(".card-title strong,.ring-item strong,.ring-item small,.radar-metric strong,.radar-metric small,.radar-metric > span")) {
          element.style.removeProperty("font-size");
          const width=element.clientWidth;
          if(width>0 && element.scrollWidth>width) {
            const font=parseFloat(getComputedStyle(element).fontSize);
            element.style.fontSize=Math.max(7,font*width/element.scrollWidth-.25)+"px";
          }
        }
      });
    };
    const observer=new ResizeObserver(update);observer.observe(node);update();
    return {update, destroy(){stopped=true;observer.disconnect();}};
  }

  function ringRadius(index, count) {
    const step = count > 3 ? 80 / (count - 1) : count >= 3 ? 28 : 32;
    return 112 - index * step;
  }
  function fitPost(node) {
    const text=node.querySelector('p');
    const update=()=>{
      text.style.removeProperty('font-size');
      const height=node.clientHeight;
      if(height<=0) return;
      const base=parseFloat(getComputedStyle(text).fontSize);
      const size=Math.min(base,height/1.35);
      if(size<base) text.style.fontSize=size+'px';
      const line=parseFloat(getComputedStyle(text).lineHeight);
      text.style.setProperty('--post-lines',String(Math.max(1,Math.floor(height/line))));
    };
    const observer=new ResizeObserver(update);observer.observe(node);
    return {update,destroy(){observer.disconnect();}};
  }

  function statusIcon(kind) {
    if (kind === 'error' || kind === 'auth') return 'unlock';
    if (kind === 'loading') return 'refresh';
    if (kind === 'missing' || kind === 'muted') return 'minus';
    if (kind === 'warning') return 'clock';
    return 'check';
  }

  function cleanup() {
    disposed = true;
    mounted = false;
    clearInterval(clockTimer);
    clearInterval(radarTimer);
    clockTimer = null;
    radarTimer = null;
    radarStarted = false;
  }

  onMount(() => {
    mounted = true;
    disposed = false;
    clockTimer = setInterval(() => { now = Date.now(); }, 1000);
    syncPolling(radarSlotCount > 0);
  });

  onDestroy(cleanup);
</script>

<ManualResetDialog bind:this={manualDialog} manual={radarSnapshot?.manual} onChange={next => { if (next) radarSnapshot = next; }} />
<div class="compact-overview" aria-label="紧凑总览" bind:clientWidth={availableWidth} bind:clientHeight={availableHeight}>
  {#if !visibleSlots.length}<div class="overview-empty" role="status">未选择缩略内容</div>{/if}
  <div class={`overview-grid count-${visibleSlots.length}`} style={`--unit:${layout.unit}px;--columns:${layout.columns};--rows:${layout.rows}`}>
    {#each visibleSlots as slot, index (slotKey(slot, index))}
      <div class="grid-slot" data-slot-id={slot.id || index} class:single={slot.cells === 1} class:wide={slot.width === 2} use:fitText={`${layout.unit}:${slot.fontScale}:${slot.dataScale}:${now}`} style={`left:${(availableWidth-layout.columns*layout.unit-(layout.columns-1)*8)/2+(slot.column-1)*(layout.unit+8)}px;top:${(availableHeight-layout.rows*layout.unit-(layout.rows-1)*8)/2+(slot.row-1)*(layout.unit+8)}px;width:${slot.width*layout.unit+(slot.width-1)*8}px;height:${slot.height*layout.unit+(slot.height-1)*8}px;--overview-text:${Math.max(9,layout.unit/22)*(slot.fontScale || 1)}px;--overview-data:${Math.max(16,layout.unit/11)*(slot.dataScale || 1)}px`}>
      {#if slot.kind === 'coding'}
        {@const keys = codingChannelKeys(slot)}
        <div class="coding-group" class:stacked={slot.height===2} style={`--channel-count:${keys.length}`}>
        {#each keys as channelKey (channelKey)}
        {@const entry = getCodingEntry(coding, channelKey)}
        {@const compact = slot.cells===1 || keys.length>1}
        <article class="overview-card coding-card" class:compact class:vertical={!compact && slot.height===2} aria-label={entry.label}>
          <div class="card-head">
            <div class="card-title">
              <span class="card-icon coding-icon"><Icon name="coding" size={15} /></span>
              <strong title={entry.label}>{entry.label}</strong>
            </div>
            <span class="status-badge" class:error={entry.statusInfo.kind === 'error' || entry.statusInfo.kind === 'auth'} class:warning={entry.statusInfo.kind === 'loading' || entry.statusInfo.kind === 'missing'}>
              <i title={entry.statusInfo.label}></i><span>{entry.statusInfo.label}</span>
            </span>
          </div>

          {#if entry.rings.length}
            {#if compact}
              
              <div class="coding-bars">
                {#each entry.rings as ring (ring.key)}
                  <div class="bar-item">
                    <div class="bar-label"><span>{ring.compactLabel}</span><strong>{ring.displayValue}</strong>{#if ring.countdownMs !== null && ring.countdownMs !== undefined}<small>{formatCountdown(ring.countdownMs)}</small>{/if}</div>
                    <div class="bar-track" role="meter" aria-label={ring.compactLabel} aria-valuemin="0" aria-valuemax={ring.maxPct || 100} aria-valuenow={ring.pct ?? 0}><i style={`width:${ringFraction(ring)*100}%;background:${ring.color || "var(--accent)"}`}></i></div>
                  </div>
                {/each}
              </div>
              
            {:else}
            <div class="coding-rings">
              <svg class="ring-svg" viewBox="0 0 320 152" role="img" aria-label={`${entry.label}额度`}>
                {#each entry.rings as ring, ringIndex (ring.key)}
                  {@const radius = ringRadius(ringIndex, entry.rings.length)}
                  {@const length = Math.PI * radius}
                  {@const usedLength = length * ringFraction(ring)}
                  {@const stroke = entry.rings.length > 3 ? Math.max(4, Math.floor(72 / entry.rings.length)) : ring.strokeWidth || 18}
                  <path d={ringPath(radius)} fill="none" stroke="var(--ring-track)" stroke-width={stroke} stroke-linecap="round" />
                  {#if ring.pct !== null || ring.infinite}
                    <path d={ringPath(radius)} fill="none" stroke={ring.color || 'var(--accent)'} stroke-width={stroke} stroke-linecap="round" stroke-dasharray={`${usedLength} ${Math.max(0, length - usedLength)}`} class="ring-arc" />
                  {/if}
                {/each}
              </svg>
              <div class="ring-legend">
                
                {#each entry.rings as ring (ring.key)}
                  <div class="ring-item" title={ring.label || ring.key}>
                    <span class="ring-dot" style={`background:${ring.color || 'var(--accent)'}`}></span>
                    <span class="ring-name">{ring.compactLabel}</span>
                    <strong>{ring.displayValue}</strong>
                    {#if ring.countdownMs !== null && ring.countdownMs !== undefined}<small>{formatCountdown(ring.countdownMs)}</small>{/if}
                  </div>
                {/each}
                
              </div>
              
            </div>
            {/if}
            
          {:else}
            <div class="card-empty" role="status">
              <Icon name={statusIcon(entry.statusInfo.kind)} size={22} />
              <strong>{entry.statusInfo.label}</strong>
              {#if entry.statusInfo.detail}<small title={entry.statusInfo.detail}>{entry.statusInfo.detail}</small>{/if}
            </div>
          {/if}
        </article>
        {/each}
        </div>
      {:else if slot.kind === 'system'}
        <section class="system-block" aria-label="系统监控插件分块">
          <div class="system-heading"><Icon name="system-monitor" size={16} /><strong>系统监控</strong><span>{slot.sensorIds.length} 项</span></div>
          <div class="system-content"><SystemMonitorPage compact horizontal={slot.width === 2} sensorIds={slot.sensorIds} fontScale={slot.fontScale || 1} dataScale={slot.dataScale || 1} /></div>
        </section>
      {:else}
        <article class="overview-card radar-card" aria-label="Tibo 雷达">
          <div class="radar-status">
          <div class="card-head">
            <div class="card-title radar-title">
              <img src={avatar} alt="Tibo" />
              <strong>Tibo 雷达</strong>
            </div>
            <span class="status-badge" title={radarView.status.issue || radarView.status.label} class:error={radarView.status.kind === 'error'} class:warning={radarView.status.kind === 'warning'}>
              <i title={radarView.status.label}></i><span>{radarView.status.label}</span>
            </span>
          </div>

          {#if radarSnapshot}
            <div class="radar-summary">
              <div class="reset-summary" class:actionable={!!manualLast} role={manualLast ? 'button' : undefined} tabindex={manualLast ? 0 : undefined} title={manualLast ? '手动标记的重置 · 可撤销' : undefined} onclick={e => manualLast && manualKey(e, 'undo')} onkeydown={e => manualLast && manualKey(e, 'undo')}>
                <div class="radar-label"><span><Icon name="refresh" size={13} />最近重置{#if radarView.latestType}<b class="radar-reset-type" class:banked={radarView.latestType === 'Banked'}>{radarView.latestType}</b>{/if}{#if manualLast}<small class="manual-note">手动</small>{/if}</span><time>{radarView.latestDate === '无记录' ? '—' : radarView.latestDate}</time></div>
                <div class="reset-value"><strong>{radarView.latestAge}</strong></div>
              </div>
              <div class="outlook-summary" class:actionable={canMark} role={canMark ? 'button' : undefined} tabindex={canMark ? 0 : undefined} title={canMark ? 'Tibo 没发完成推文？点击手动标记重置' : undefined} onclick={e => canMark && manualKey(e, 'mark')} onkeydown={e => canMark && manualKey(e, 'mark')}>
                <div class="radar-label"><span>当前状态</span>{#if radarView.outlook.badge}<span class="outlook-tag {radarView.outlook.tone}">{#if radarView.outlook.tone !== 'confirmed' && radarView.outlook.tone !== 'banked'}<Icon name="clock" size={11} />{/if}{radarView.outlook.badge}</span>{/if}</div>
                <strong class="outlook-time" class:late={radarView.outlook.late}>{radarView.outlook.label}</strong>
                {#if radarView.outlook.detail}<small class="outlook-detail">{#if radarView.outlook.countdown || radarView.outlook.elapsed}<span>{radarView.outlook.dateLabel}</span><span class="outlook-tag countdown-tag" class:overdue={radarView.outlook.late}>{radarView.outlook.countdown || radarView.outlook.elapsed}</span>{:else}{radarView.outlook.detail}{/if}</small>{/if}
              </div>
            </div>
          {:else if slot.cells === 1}
            <div class="card-empty" role="status"><strong>{radarError || '读取雷达快照中'}</strong></div>
          {/if}
          </div>
          {#if slot.cells !== 1}
          {#if radarSnapshot}
            <div class="radar-feed">
              <div class="radar-posts">
                {#each radarPosts.slice(0, slot.width === 2 ? 2 : 3) as post}
                  <div class="radar-message">
                    <img class="message-avatar" src={avatar} alt="Tibo" />
                    <div class="radar-post {post.display.tone}">
                      <div class="post-body" use:fitPost={post.text + ':' + slot.fontScale + ':' + layout.unit}><p title={post.text}>{post.display.excerpt}</p></div>
                      <div class="post-meta">{#if post.display.label}<span>{post.display.label}</span>{/if}<time>{formatRadarDate(post.publishedAt, radarSnapshot?.config?.displayTimeZone)}</time></div>
                    </div>
                  </div>
                {:else}
                  <div class="feed-empty">暂无动态</div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="card-empty" role="status">
              <Icon name={radarError ? 'unlock' : 'refresh'} size={22} />
              <strong>{radarError || '读取雷达快照中'}</strong>
            </div>
          {/if}
          {/if}
        </article>
      {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .compact-overview {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    color: var(--text-primary);
    background: var(--bg);
    font-family: var(--font-main);
    letter-spacing: 0;
    container-type: size;
  }

  .overview-grid {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(var(--columns), var(--unit));
    grid-template-rows: repeat(var(--rows), var(--unit));
    justify-content: center;
    align-content: center;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .overview-grid.count-0 { display: block; }
  .grid-slot { position:absolute; min-width: 0; min-height: 0; overflow: hidden; transition:left .2s ease,top .2s ease,width .2s ease,height .2s ease; }
  .grid-slot > .overview-card, .grid-slot > .system-block { height: 100%; }
  .wide .coding-rings { grid-template-columns: minmax(0, 1fr) 130px; grid-template-rows: minmax(0, 1fr); align-items: center; }
  .wide .ring-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  .overview-card {
    --state-color: var(--accent);
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--surface);
    container-type: size;
  }

  .overview-empty { display: grid; place-items: center; height: 100%; color: var(--text-secondary); font-size: 16px; }
  .radar-card { --state-color: var(--cyan); }
  .overview-card.radar-card { display:grid; grid-template-rows:repeat(2,minmax(0,1fr)); gap:0; padding:0; background:var(--surface); --bubble-border:var(--border); }
  .radar-status { min-width:0; min-height:0; display:flex; flex-direction:column; gap:6px; padding:12px 14px 8px; overflow:hidden; }
  .wide .overview-card.radar-card { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(0,1fr); }
  .wide .radar-card .radar-feed { border-top:0; border-left:1px solid var(--bubble-border); }
  .single .overview-card.radar-card { grid-template-rows:minmax(0,1fr); }
  .card-head,
  .card-title,
  .status-badge { display:flex; align-items:center; }
  .card-head { justify-content: space-between; gap: 6px; min-width: 0; flex-shrink: 0; }
  .card-title { min-width: 0; gap: 8px; color: var(--text-secondary); }
  .card-title strong { min-width: 0; overflow: hidden; color: var(--text-primary); font-size: clamp(12px, 5.6cqw, 18px); font-weight: 700; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
  .card-icon { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; color: var(--state-color); }
  .coding-icon { color: var(--accent); }
  .radar-title img { width: 28px; height: 28px; flex: 0 0 28px; object-fit: cover; border-radius: 50%; }

  .status-badge { flex: 0 0 auto; gap: 6px; max-width: 45%; overflow: hidden; color: var(--text-secondary); font-size: clamp(8px, 3.4cqw, 11px); line-height: 1; white-space: nowrap; }
  .status-badge i { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--green); }
  .status-badge.warning i { background: var(--amber); }
  .status-badge.error i { background: var(--red); }
  .status-badge.error { color: var(--red); }
  .status-badge.cached i { background: var(--text-3); }

  .coding-rings { min-height: 0; flex: 1; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 2px; }
  .ring-svg { width: 100%; height: 100%; min-height: 0; overflow: visible; }
  .ring-arc { transition: stroke-dasharray .35s ease; }
  .ring-legend { min-width: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 3px 5px; }
  .ring-item { min-width: 0; display: grid; grid-template-columns: 6px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 4px; align-items: baseline; color: var(--text-secondary); font-size: clamp(8px, 3.4cqw, 11px); line-height: 1.05; }
  .ring-dot { width: 6px; height: 6px; grid-row: 1 / span 2; align-self: center; border-radius: 50%; }
  .ring-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ring-item strong { color: var(--text-primary); font-size: 1.08em; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ring-item small { grid-column: 2; color: var(--text-secondary); font-size: .82em; font-variant-numeric: tabular-nums; white-space: nowrap; }


  .card-empty { min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; overflow: hidden; color: var(--text-secondary); text-align: center; }
  .card-empty strong { max-width: 100%; overflow: hidden; color: currentColor; font-size: clamp(11px, 4.6cqw, 16px); font-weight: 650; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
  .card-empty small { max-width: 100%; overflow: hidden; color: var(--text-secondary); font-size: clamp(8px, 3.2cqw, 10px); line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }


  @container (max-width: 420px) {
    .overview-card { gap: 5px; padding: 8px; border-radius: 8px; }
  }

  @container (max-width: 260px) {
    .overview-card { padding: 7px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring-arc { transition: none; }
  }

  .ring-item { font-size: 12px; line-height: 1.15; }
  .ring-item strong { font-size: 22px; }
  .ring-item small { font-size: 11px; }
  @container (max-width: 220px) {
    .status-badge span { display: none; }
    .card-title strong { font-size: 12px; }
    .ring-item { font-size: 11px; }
    .ring-item strong { font-size: 18px; }
  }
  .system-block { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 7px; }
  .system-heading { display: flex; gap: 6px; align-items: center; font-size: 13px; padding: 1px 4px; color: var(--text-secondary); }
  .system-heading strong { font-weight: 500; }
  .system-heading span { margin-left: auto; color: var(--text-3); font-size: 11px; }
  .system-content { flex: 1; min-width: 0; min-height: 0; }
  @container (max-height: 180px) {
    .coding-rings { grid-template-columns: minmax(0, 1fr) 105px; grid-template-rows: minmax(0, 1fr); align-items: center; }
    .ring-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .grid-slot .card-title strong { font-size:calc(var(--overview-text) * 1.25); }
  .grid-slot .status-badge { font-size:calc(var(--overview-text) * .8); }
  .grid-slot .ring-item { font-size:var(--overview-text); }
  .grid-slot .ring-item strong { font-size:var(--overview-data); }
  .grid-slot .ring-item small { font-size:calc(var(--overview-text) * .8); }
  .grid-slot .system-heading { font-size:var(--overview-text); }
  .wide .coding-rings { grid-template-columns:minmax(0,1fr) minmax(125px, 35%); }
  .single .coding-rings { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) auto; gap:6px; }
  .single .ring-legend { gap:6px 8px; padding-top:4px; border-top:1px solid var(--border); }
  .single .ring-item { grid-template-columns:5px minmax(0,1fr); gap:3px; }
  .single .card-title strong { font-size:var(--overview-text); }
  .single .status-badge span { display:none; }
  .single .system-heading { font-size:var(--overview-text); gap:4px; }
  .coding-group { display:grid; grid-template-columns:repeat(var(--channel-count),minmax(0,1fr)); gap:8px; width:100%; height:100%; min-height:0; }
  .coding-group.stacked { grid-template-columns:minmax(0,1fr); grid-template-rows:repeat(var(--channel-count),minmax(0,1fr)); }
  .coding-card .coding-rings { grid-template-rows:minmax(0,1fr) auto auto; gap:8px; }
  .wide .coding-card .coding-rings { grid-template-rows:minmax(0,1fr) auto; }
  .wide .coding-card .ring-svg { grid-column:1; grid-row:1; }
  .wide .coding-card .ring-legend { grid-column:2; grid-row:1 / span 2; align-self:center; }
  .coding-card.vertical .coding-rings { flex:1; height:auto; margin-top:0; padding-bottom:20%; align-content:center; grid-template-rows:auto auto auto; gap:10px; }
  .coding-card.vertical .ring-svg { height:auto; aspect-ratio:320 / 152; }
  .coding-card.vertical .ring-legend { text-align:center; padding-top:8px; }
  .coding-card.vertical .ring-item strong { grid-column:2; }
  .coding-card.compact .card-title strong { font-size:var(--overview-text); }
  .coding-card.compact .status-badge span { display:none; }
  .coding-bars { flex:1; min-height:0; display:grid; grid-auto-rows:minmax(0,1fr); gap:8px; align-content:center; padding:4px 0; }
  .bar-item { min-width:0; min-height:0; display:flex; flex-direction:column; justify-content:center; gap:7px; }
  .bar-label { display:flex; align-items:baseline; gap:7px; min-width:0; font-size:var(--overview-text); color:var(--text-secondary); }
  .bar-label strong { margin-left:auto; font-size:var(--overview-data); color:var(--text-primary); font-variant-numeric:tabular-nums; }
  .bar-label small { font-size:calc(var(--overview-text) * .8); white-space:nowrap; }
  .bar-track { height:6px; flex:none; background:var(--ring-track); border-radius:3px; overflow:hidden; }
  .bar-track i { height:100%; display:block; border-radius:inherit; transition:width .25s ease; }
  @media(prefers-reduced-motion:reduce) { .bar-track i { transition:none; } }
  .radar-summary { flex:1; min-height:0; display:grid; grid-template-rows:repeat(2,minmax(0,1fr)); gap:5px; font-size:var(--overview-text); align-items:center; }
  .radar-label,.radar-label > span,.reset-value { display:flex; align-items:center; gap:5px; min-width:0; }
  .radar-label { justify-content:space-between; flex-wrap:wrap; color:var(--text-secondary); }
  .radar-label time { font-size:.8em; font-variant-numeric:tabular-nums; }
  .radar-reset-type { border-radius:999px; padding:2px 8px; color:var(--green); background:color-mix(in srgb,var(--green) 18%,var(--surface)); font-size:.72em; font-weight:600; line-height:1.2; }
  .radar-reset-type.banked { color:var(--violet); background:color-mix(in srgb,var(--violet) 18%,var(--surface)); }
  .manual-note { color:var(--text-3); font-size:.72em; }
  .reset-value { margin-top:4px; flex-wrap:wrap; }
  .reset-value strong { font-size:calc(var(--overview-data) * .8); font-weight:700; line-height:1.15; overflow-wrap:anywhere; }
  .outlook-summary { padding-top:7px; border-top:1px solid var(--border); }
  .outlook-summary strong { color:var(--text-primary); font-size:var(--overview-text); overflow-wrap:anywhere; }
  .outlook-summary strong.late { color:var(--red); }
  .outlook-tag { --tone:var(--amber); display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:999px; color:var(--tone); background:color-mix(in srgb,var(--tone) 18%,var(--surface)); font-size:calc(var(--overview-text) * .75); font-weight:600; white-space:nowrap; }
  .outlook-tag.overdue { --tone:var(--red); }
  .outlook-tag.confirmed { --tone:var(--green); }
  .outlook-tag.banked { --tone:var(--violet); }
  .actionable { cursor:pointer; border-radius:10px; margin-left:-6px; margin-right:-6px; padding-left:6px; padding-right:6px; transition:background .15s; }
  .actionable:hover,.actionable:focus-visible { background:var(--surface-2); outline:none; }
  .outlook-summary .outlook-time { display:block; margin-top:4px; font-size:calc(var(--overview-data) * .65); font-weight:700; line-height:1.15; }
  .outlook-summary small { display:block; margin-top:3px; color:var(--text-secondary); font-size:.8em; }
  .outlook-summary .outlook-detail { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }
  .outlook-summary .countdown-tag { font-size:1em; line-height:1.2; padding:2px 5px; font-variant-numeric:tabular-nums; }
  .radar-feed { min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; padding:4px 10px 10px; }
  .radar-message { min-width:0; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); align-items:stretch; }
  .message-avatar { display:none; }
  .radar-posts { flex:1; min-height:0; display:grid; grid-auto-rows:minmax(0,1fr); gap:6px; }
  .radar-post { --tone:var(--text-3); min-width:0; min-height:0; overflow:hidden; display:flex; flex-direction:column; padding:8px 12px; border:0; border-radius:10px; color:var(--text-primary); background:var(--surface-2); }
  .radar-post.related { --tone:var(--blue); }
  .radar-post.forecast { --tone:var(--amber); }
  .radar-post.completed { --tone:var(--green); }
  .radar-post.banked { --tone:var(--violet); }
  /* Tagged posts take a card tinted with their tag tone; untagged posts stay neutral. */
  .radar-post:is(.related,.forecast,.completed,.banked) { background:color-mix(in srgb,var(--tone) 16%,var(--surface-2)); }
  .post-meta { display:flex; flex:none; flex-wrap:wrap; justify-content:space-between; gap:3px; margin-top:4px; font-size:calc(var(--overview-text) * .7); line-height:1.25; color:var(--text-3); }
  .post-meta span { color:var(--tone); font-weight:600; }
  .post-meta time { margin-left:auto; }
  .post-body { flex:1; min-height:0; overflow:hidden; }
  .radar-post p { margin:0; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:var(--post-lines,1); overflow:hidden; font-size:calc(var(--overview-text) * .9); line-height:1.35; overflow-wrap:anywhere; white-space:pre-wrap; }
  .feed-empty { font-size:var(--overview-text); color:var(--text-secondary); align-self:center; }
  @media(prefers-reduced-motion:reduce) { .grid-slot { transition:none; } }
</style>
