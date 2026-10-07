<script>
  import { onMount } from 'svelte';
  import Icon from '@shared/components/Icon.svelte';
  import { normalizeOverview, codingChannelKeys } from '../../shared/compact-overview-config.cjs';
  import { appendCodingCards, appendSystemCard } from '../../shared/overview-editor.cjs';
  let { enabled = false, onToggle, onconfigchanged, onpreview, onbusy } = $props();
  let slots = $state(Array(6).fill(null));
  let usedCells = $derived(slots.reduce((total, slot) => total + (slot ? slot.cells || 2 : 0), 0));
  let channels = $state([]);
  let sensors = $state([]);
  let selectedSensorIds = $state([]);
  let aliases = $state({});
  let ready = $state(false);
  let busy = $state(false);
  let error = $state('');
  let sensorSearch = $state('');
  let channelPicks = $state([]);
  const identify = slot => slot ? {...slot,id:slot.id || crypto.randomUUID()} : null;
  $effect(()=>{ onbusy?.(busy || !ready); });
  let section;
  let expanded = $state(true);
  let availableSensors = $derived(sensors.filter(s => selectedSensorIds.includes(s.id)));
  let filteredSensors = $derived(availableSensors.filter(s => [s.name, s.zhName, s.hardware, s.zhHardware, aliases[s.id]].join(' ').toLowerCase().includes(sensorSearch.toLowerCase())));
  $effect(() => { onpreview?.({slots: slots.map(s => s ? {...s, sensorIds:s.sensorIds?.filter(id=>selectedSensorIds.includes(id))} : null)}); });
  const kinds = [{ id: '', name: '不显示' }, { id: 'coding', name: 'Coding Plan' }, { id: 'system', name: '系统监控' }, { id: 'radar', name: 'Tibo 雷达' }];

  function available(kind, index) {
    return true;
  }
  function firstSensor(index) {
    return availableSensors[0]?.id || '';
  }
  function changeSensor(index, cardIndex, value) {
    const ids = [...(slots[index]?.sensorIds || [])];
    ids[cardIndex] = value;
    return changeSlot(index, {...slots[index],kind:'system',sensorIds:ids.filter(Boolean).slice(0, 2)});
  }
  function sensorLabel(sensor) {
    return (sensor.zhHardware || sensor.hardware || '') + ' · ' + (aliases[sensor.id] || sensor.zhName || sensor.name || sensor.id);
  }
  export function open() { expanded = true; section?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  export async function save() {
    if (!ready) throw new Error('缩略配置尚未加载');
    const values = slots.map(s => s?.kind === 'coding' && codingChannelKeys(s).length ? {kind:'coding',channelKey:codingChannelKeys(s)[0],...(s.channelKeys ? {channelKeys:codingChannelKeys(s)} : {})}
      : s?.kind === 'system' ? {kind:'system',sensorIds:(s.sensorIds || []).filter(id=>selectedSensorIds.includes(id))}
      : s?.kind === 'radar' ? {kind:'radar'} : null);
    await window.api.setConfig('compactOverview', { slots: values.map((value, i) => value ? {...value, id:slots[i].id, fontScale:slots[i].fontScale || 1, dataScale:slots[i].dataScale || 1, cells:slots[i].cells || 2, orientation:slots[i].orientation || (value.kind === "radar" ? "vertical" : "horizontal")} : null) });
    onconfigchanged?.();
  }
  async function changeSlot(index, value) {
    if(value?.kind==='coding' && codingChannelKeys(value).length>(value.cells || slots[index]?.cells || 1)) {error='每个渠道至少占用一格，请先增加格数';return;}
    if (value) value = identify({id:slots[index]?.id, fontScale:slots[index]?.fontScale || 1, dataScale:slots[index]?.dataScale || 1, ...value, cells:value.cells || slots[index]?.cells || 1, orientation:value.orientation || slots[index]?.orientation || (value.kind === "radar" ? "vertical" : "horizontal")});
    const previous = slots;
    slots = slots.map((s, i) => i === index ? value : s);
    busy = true; error = '';
    try { await save(); } catch (e) { slots = previous; error = e.message; }
    finally { busy = false; }
  }
  async function moveSlot(index, delta) {
    const next=index+delta;
    if(next<0 || next>=slots.length || busy) return;
    const previous=slots;
    const reordered=[...slots];
    [reordered[index],reordered[next]]=[reordered[next],reordered[index]];
    slots=reordered; busy=true; error='';
    try { await save(); } catch(e) { slots=previous; error=e.message; } finally {busy=false;}
  }
  export async function applySlots(values) {
    if(busy || !ready) throw new Error("设置正在保存，请稍后重试");
    const previous=slots;
    slots=Array.from({length:Math.max(6,values.length)},(_,i)=>identify(values[i]));
    busy=true;error="";
    try { await save(); } catch(e) {slots=previous;error=e.message;throw e;} finally {busy=false;}
  }
  async function addCoding() {
    try {
      await applySlots(appendCodingCards(slots,channelPicks.filter(key=>channels.some(c=>c.key===key))));
      channelPicks=[];
    } catch(e) {error=e.message;}
  }
  async function addSystem() {
    try {await applySlots(appendSystemCard(slots,firstSensor()));} catch(e) {error=e.message;}
  }
  function toggleChannel(index,key,checked) {
    const slot=slots[index],keys=codingChannelKeys(slot);
    const selected=checked ? (slot.cells===1 ? [key] : [...keys,key]) : keys.filter(k=>k!==key);
    if(!selected.length) {error='至少保留一个渠道';return;}
    return changeSlot(index,{...slot,channelKey:selected[0],channelKeys:selected});
  }
  function previewFont(index, key, value) { slots=slots.map((slot,i)=>i===index ? {...slot,[key]:Number(value)} : slot); }
  async function saveFont() { busy=true; error=''; try {await save();} catch(e) {error=e.message;} finally {busy=false;} }
  async function toggle(event) {
    const checked = event.currentTarget.checked;
    busy = true; error = '';
    try { await save(); await onToggle?.(checked); expanded = true; }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  async function refreshSensors() {
    busy = true; error = '';
    try {
      const result = await window.api.fetchSystemMonitorData();
      if (!result.success) throw new Error(result.error || '指标读取失败');
      sensors = result.data?.sensors || [];
      const hardware=await window.api.getSystemMonitorConfig();
      selectedSensorIds=hardware.selectedSensors || [];
      aliases=hardware.sensorAliases || {};
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }
  onMount(() => {
    let disposed = false;
    async function load() {
      try {
        const [config, providers, hardware, cached] = await Promise.all([
          window.api.getConfig(), window.api.getProviders(),
          window.api.getSystemMonitorConfig().catch(() => ({})),
          window.api.getCachedSystemMonitorData().catch(() => null),
        ]);
        if (disposed) return;
        sensors = cached?.data?.sensors || [];
        aliases = hardware.sensorAliases || {};
        selectedSensorIds = hardware.selectedSensors || [];
        const names = { volcengine: '火山方舟', xfyun: '讯飞星火', opencodego: 'OpenCode Go' };
        const candidates = new Map();
        for (const account of config.channelAccounts || []) {
          if (account.enabled === false || !names[account.type]) continue;
          const p = providers.find(p => p.id === account.id);
          let keys = config.accountChannels?.[account.id] || [];
          if (account.type === 'volcengine') keys = [...keys, ...['coding', 'agent'].filter(k => p?.planStatus?.[k] === 'active').map(k => account.id + (k === 'agent' ? ':agent' : ''))];
          else if (account.type === 'xfyun') keys = [...keys, ...(p?.availablePlans || []).map(plan => account.id + ':' + plan.name.replace('讯飞星火 ', ''))];
          else keys = [...keys, account.id];
          for (const key of keys) {
            const suffix = key.includes(':') ? key.split(':').slice(1).join(':') : '';
            candidates.set(key, { key, label: config.providerNames?.[key] || (account.label || account.name || names[account.type]) + (suffix ? ' · ' + suffix : '') });
          }
        }
        channels = [...candidates.values()];
        if (Array.isArray(config.compactOverview?.slots)) slots = normalizeOverview(config.compactOverview).slots;
        else {
          const preferred = (hardware.selectedSensors || []).map(id => sensors.find(s => s.id === id)).filter(Boolean);
          const picks = preferred;
          const channel = channels.find(c => config.selectedProviders?.includes(c.key)) || channels[0];
          slots = [channel ? { kind: 'coding', channelKey: channel.key } : null,
            { kind: 'system', sensorIds: picks.slice(0, 2).map(sensor => sensor.id) }, { kind: 'radar' }, null];
        }
        slots = Array.from({length:Math.max(6,slots.length)}, (_, i) => slots[i] ? identify({...slots[i], cells:slots[i].cells || 2}) : null);
        ready = true;
      } catch (e) { error = e.message; }
    }
    load();
    const unsubscribe = window.api.onPresetLoaded?.(load);
    const unsubscribeHardware = window.api.onSystemMonitorConfig?.(hardware => { selectedSensorIds=hardware.selectedSensors || []; aliases=hardware.sensorAliases || {}; });
    return () => { disposed = true; unsubscribe?.(); unsubscribeHardware?.(); };
  });
</script>

<section class="overview-settings" bind:this={section} aria-label="缩略显示设置">
  <div class="heading">
    <div class="identity"><Icon name="plugin" size={18} /><strong>缩略显示</strong><span>{usedCells} 格</span></div>
    <div class="actions">
      <button class="icon-button" title="调整缩略内容" aria-label="调整缩略内容" aria-expanded={expanded} onclick={() => expanded = !expanded}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={17} /></button>
      <label class="switch" title="开启缩略显示"><input type="checkbox" aria-label="开启缩略显示" checked={enabled} disabled={!ready || busy} onchange={toggle} /><span></span></label>
    </div>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if expanded || enabled}
    <details class="channel-batch">
      <summary>Coding Plan 渠道多选</summary>
      <div class="channel-options">
        {#each channels as channel}
          {@const exists=slots.some(slot=>slot?.kind==='coding' && codingChannelKeys(slot).includes(channel.key))}
          <label><input type="checkbox" aria-label={'添加渠道 ' + channel.label} checked={exists || channelPicks.includes(channel.key)} disabled={busy || exists} onchange={e=>channelPicks=e.target.checked ? [...channelPicks,channel.key] : channelPicks.filter(key=>key!==channel.key)}/><span>{channel.label}</span></label>
        {/each}
      </div>
      <button class="add-channels" disabled={busy || !channelPicks.length} onclick={addCoding}>添加 {channelPicks.length} 个单格</button>
    </details>
    <div class="system-add">
      <strong>系统监控</strong>
      <button class="icon-button" aria-label="添加系统监控单格" title="添加系统监控单格" disabled={!ready || busy || !availableSensors.length} onclick={addSystem}><Icon name="plus" size={18}/></button>
    </div>
    <div class="slots">
      {#each slots as slot, index}
        <div class="slot">
          <span class="index">{index + 1}</span>
          <select aria-label={'位置 ' + (index + 1) + ' 类型'} value={slot?.kind || ''} disabled={!ready || busy}
            onchange={e => changeSlot(index, e.target.value === 'coding' ? {kind: 'coding', channelKey: channels[0]?.key || ''} : e.target.value === 'system' ? {kind: 'system', sensorIds: [firstSensor(index)].filter(Boolean)} : e.target.value === 'radar' ? {kind: 'radar'} : null)}>
            {#each kinds as kind}<option value={kind.id} disabled={!!kind.id && !available(kind.id, index)}>{kind.name}</option>{/each}
          </select>
          {#if slot?.kind === 'coding'}
            <details class="slot-channels">
              <summary>{codingChannelKeys(slot).length} 个渠道</summary>
              <div class="channel-options">
                {#each channels as channel}
                  {@const selected=codingChannelKeys(slot).includes(channel.key)}
                  <label><input type="checkbox" aria-label={'位置 ' + (index+1) + ' 渠道 ' + channel.label} checked={selected} disabled={busy || (slot.cells!==1 && !selected && codingChannelKeys(slot).length >= (slot.cells || 2))} onchange={e=>toggleChannel(index,channel.key,e.target.checked)}/><span>{channel.label}</span></label>
                {/each}
              </div>
            </details>
          {:else if slot?.kind === 'system'}
            <div class="system-selectors">
              {#each (slot.sensorIds?.length>1 ? [0, 1] : [0]) as cardIndex}
                {@const selectedId = slot.sensorIds?.[cardIndex] || ''}
                <label><span>卡片 {cardIndex + 1}</span>
                  <select aria-label={'位置 ' + (index + 1) + ' 卡片 ' + (cardIndex + 1)} value={selectedId} disabled={busy} onchange={e => changeSensor(index, cardIndex, e.target.value)}>
                    <option value="">{cardIndex ? '不显示第二张' : '选择指标'}</option>
                    {#if selectedId && !filteredSensors.some(s => s.id === selectedId)}<option value={selectedId} disabled={!selectedSensorIds.includes(selectedId)}>{selectedSensorIds.includes(selectedId) ? sensorLabel(sensors.find(s=>s.id===selectedId) || {id:selectedId}) : '已从系统监控移除'}</option>{/if}
                    {#each filteredSensors as sensor}<option value={sensor.id} disabled={slot.sensorIds?.some((id, i) => i !== cardIndex && id === sensor.id)}>{sensorLabel(sensor)}</option>{/each}
                  </select>
                </label>
              {/each}
            </div>
          {:else if slot?.kind === 'radar'}<span class="detail">当前状态 · 最近重置</span>
          {:else}<span class="detail">空</span>{/if}
          {#if slot}
            <select aria-label={'位置 ' + (index + 1) + ' 占用格数'} value={slot.cells === 1 ? "single" : slot.orientation || (slot.kind === "radar" ? "vertical" : "horizontal")} disabled={busy} onchange={e => changeSlot(index, {...slot, cells:e.target.value === "single" ? 1 : 2, orientation:e.target.value === "vertical" ? "vertical" : "horizontal"})}>
              <option value="single" disabled={slot.kind==='coding' && codingChannelKeys(slot).length>1}>单格</option>
              <option value="horizontal">横双格</option>
              <option value="vertical">竖双格</option>
            </select>
          {/if}
          {#if slot}
            <div class="slot-options">
              <div class="order-controls">
                <button class="icon-button" aria-label={'移除位置 ' + (index+1)} title="移除" disabled={busy} onclick={()=>changeSlot(index,null)}><Icon name="trash" size={16}/></button>
                <button class="icon-button" aria-label={'位置 ' + (index+1) + ' 前移'} title="前移" disabled={busy || index===0} onclick={()=>moveSlot(index,-1)}><Icon name="chevron-up" size={16}/></button>
                <button class="icon-button" aria-label={'位置 ' + (index+1) + ' 后移'} title="后移" disabled={busy || index===slots.length-1} onclick={()=>moveSlot(index,1)}><Icon name="chevron-down" size={16}/></button>
              </div>
              {#each [{key:"fontScale",label:"文字"},{key:"dataScale",label:"数值"}] as setting}
                <label class="font-control"><span>{setting.label}</span><input aria-label={'位置 ' + (index+1) + ' ' + setting.label} type="range" min="0.6" max="2" step="0.05" value={slot[setting.key] || 1} disabled={busy} oninput={e=>previewFont(index,setting.key,e.target.value)} onchange={saveFont}/><output>{Math.round((slot[setting.key] || 1)*100)}%</output></label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="sensor-tools">
      <input type="search" aria-label="筛选系统指标" placeholder="筛选系统指标" bind:value={sensorSearch} />
      <button class="icon-button" disabled={busy} title="重新读取系统指标" aria-label="重新读取系统指标" onclick={refreshSensors}><Icon name="refresh" size={16} /></button>
    </div>
  {/if}
</section>

<style>
  .overview-settings { margin-bottom: 20px; padding: 14px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); letter-spacing: 0; }
  .heading, .identity, .actions, .sensor-tools { display: flex; align-items: center; gap: 10px; }
  .heading { justify-content: space-between; }
  .identity strong { font-size: 14px; } .identity span, .detail, .index { color: var(--text-secondary); font-size: 12px; }
  .icon-button { width: 30px; height: 30px; display: grid; place-items: center; background: transparent; color: var(--text-secondary); border-radius: 5px; flex-shrink: 0; }
  .icon-button:hover { background: var(--border); } .icon-button:disabled { opacity: .4; }
  .switch { position: relative; display: inline-flex; width: 36px; height: 20px; }
  .switch input { opacity: 0; position: absolute; inset: 0; }
  .switch span { width: 100%; border-radius: 10px; background: var(--border); cursor: pointer; }
  .switch span::before { content: ''; display: block; width: 16px; height: 16px; margin: 2px; border-radius: 50%; background: white; transition: transform .15s; }
  .switch input:checked + span { background: var(--accent); } .switch input:checked + span::before { transform: translateX(16px); }
  .switch input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 3px; }
  .switch input:disabled + span { opacity: .4; cursor: wait; }
  .slots { margin-top: 10px; display: grid; gap: 8px; }
  .system-add { display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid var(--border); font-size:12px; }
  .channel-batch { padding:12px 0; border-bottom:1px solid var(--border); font-size:12px; }
  .channel-batch summary { cursor:pointer; }
  .channel-options { display:grid; gap:8px; padding:12px 0; }
  .channel-options label { display:flex; gap:8px; align-items:center; min-width:0; }
  .channel-options input { width:16px; height:16px; flex-shrink:0; }
  .channel-options span { overflow-wrap:anywhere; }
  .add-channels { background:var(--accent); color:white; border-radius:4px; padding:6px 10px; font-size:12px; }
  .add-channels:disabled { opacity:.4; }
  .system-selectors { min-width: 0; display: grid; gap: 6px; }
  .system-selectors label { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 6px; align-items: center; font-size: 11px; color: var(--text-secondary); }
  .slot { display: grid; grid-template-columns: 18px 100px minmax(0, 1fr) 80px; gap: 8px; align-items: center; min-width: 0; padding:10px 0; border-bottom:1px solid var(--border); }
  .slot-options { grid-column:2 / -1; display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .order-controls { display:flex; gap:3px; }
  .font-control { display:flex; align-items:center; gap:6px; font-size:11px; }
  .font-control input { width:80px; padding:0; }
  .font-control output { width:34px; color:var(--text-secondary); font-variant-numeric:tabular-nums; }
  select, input { min-width: 0; width: 100%; font-size: 12px; padding: 7px; background: var(--bg); color: var(--text-primary); border: 1px solid var(--border); border-radius: 5px; }
  .detail { overflow-wrap: anywhere; } .sensor-tools { margin: 10px 0 0 26px; }
  .error { font-size: 12px; color: var(--danger); overflow-wrap: anywhere; }
  @media (max-width: 600px) { .slot { grid-template-columns: 18px minmax(0, 1fr); } .slot > :nth-child(3) { grid-column: 2; } }
  @media (prefers-reduced-motion: reduce) { .switch span::before { transition: none; } }
</style>
