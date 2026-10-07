<script>
  // Marks a reset by hand when Tibo never posts a "reset finished" tweet (Hard or Banked, with time),
  // or undoes the latest manual mark. Marks are shared with the ESP32 screen.
  import Icon from '@shared/components/Icon.svelte';
  let { manual = null, onChange = () => {} } = $props();
  let dialog;
  let mode = $state('mark');
  let kind = $state('hard');
  let day = $state('');
  let hour = $state(0);
  let minute = $state(0);
  let busy = $state(false);
  let error = $state('');
  const pad = value => String(value).padStart(2, '0');

  export function open(nextMode) {
    if (!manual || !window.api?.manualTiboReset) return;
    if (nextMode === 'mark' && !(manual.canMark && manual.days?.length)) return;
    if (nextMode === 'undo' && !manual.last) return;
    mode = nextMode; kind = 'hard'; error = ''; busy = false;
    day = manual.days?.[0]?.value || ''; hour = manual.hour || 0; minute = manual.minute || 0;
    dialog.showModal();
  }
  async function submit() {
    if (busy) return;
    busy = true; error = '';
    try {
      const value = mode === 'undo' ? { action: 'undo', id: manual.last.id } : { action: 'mark', kind, date: day, hour: +hour, minute: +minute };
      onChange(await window.api.manualTiboReset(value));
      dialog.close();
    } catch (e) {
      error = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    } finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} class="manual-dialog" onclick={event => { if (event.target === dialog) dialog.close(); }}>
  <div class="heading">
    <div><h2>{mode === 'undo' ? '手动标记的重置' : '标记重置已完成'}</h2><p>{mode === 'undo' ? manual?.last?.label : 'Tibo 没有发完成推文时使用 · 电脑与 ESP32 屏幕同步'}</p></div>
    <button class="close" aria-label="关闭" onclick={() => dialog.close()}><Icon name="close" size={24} /></button>
  </div>
  {#if mode === 'undo'}
    <p class="body">最近重置来自手动标记。如果标记有误，撤销后雷达会恢复为等待重置。</p>
  {:else}
    <span class="caption">重置类型</span>
    <div class="kinds">
      <button class="kind hard" class:chosen={kind === 'hard'} onclick={() => kind = 'hard'}>Hard 重置</button>
      <button class="kind banked" class:chosen={kind === 'banked'} onclick={() => kind = 'banked'}>Banked 重置</button>
    </div>
    <span class="caption">完成时间（显示时区）</span>
    <div class="time">
      <select bind:value={day} aria-label="日期">{#each manual?.days || [] as option}<option value={option.value}>{option.label}</option>{/each}</select>
      <select bind:value={hour} aria-label="小时">{#each Array(24) as _, h}<option value={h}>{pad(h)}</option>{/each}</select>
      <span>:</span>
      <select bind:value={minute} aria-label="分钟">{#each Array(60) as _, m}<option value={m}>{pad(m)}</option>{/each}</select>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button class="secondary" onclick={() => dialog.close()}>{mode === 'undo' ? '关闭' : '取消'}</button>
    <button class={mode === 'undo' ? 'danger' : 'primary'} disabled={busy} onclick={submit}>{busy ? '正在保存…' : mode === 'undo' ? '撤销标记' : '确认标记'}</button>
  </div>
</dialog>

<style>
  .manual-dialog { margin:auto; width:640px; max-width:calc(100% - 24px); padding:24px 28px; color:var(--text-primary); background:var(--surface); border:1px solid var(--border); border-radius:20px; font-family:var(--font-main); letter-spacing:0; }
  .manual-dialog::backdrop { background:#000a; }
  .heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
  h2 { margin:0; font-size:26px; font-weight:700; line-height:1.2; }
  .heading p { margin:6px 0 0; color:var(--text-secondary); font-size:16px; }
  .close { display:grid; place-items:center; width:46px; height:46px; flex:none; padding:0; border-radius:50%; background:var(--surface-2); color:var(--text-primary); }
  .caption { display:block; margin:6px 0 10px; color:var(--text-secondary); font-size:16px; }
  .kinds { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }
  .kind { height:60px; border:2px solid var(--surface-2); border-radius:12px; background:var(--surface-2); color:var(--text-secondary); font-size:24px; font-weight:700; }
  .kind.hard.chosen { border-color:var(--green); color:var(--green); background:color-mix(in srgb,var(--green) 18%,var(--surface)); }
  .kind.banked.chosen { border-color:var(--violet); color:var(--violet); background:color-mix(in srgb,var(--violet) 18%,var(--surface)); }
  .time { display:flex; align-items:center; gap:10px; }
  .time select { height:56px; padding:0 14px; border:0; border-radius:12px; background:var(--surface-2); color:var(--text-primary); font-size:22px; font-variant-numeric:tabular-nums; }
  .time select:first-child { flex:1; }
  .time span { color:var(--text-secondary); font-size:24px; font-weight:700; }
  .body { margin:0 0 8px; font-size:20px; line-height:1.6; }
  .error { margin:12px 0 0; color:var(--red); font-size:16px; }
  .actions { display:flex; justify-content:flex-end; gap:12px; margin-top:22px; }
  .actions button { min-width:130px; height:52px; padding:0 18px; border-radius:12px; font-size:20px; }
  .secondary { background:var(--surface-2); color:var(--text-primary); }
  .primary { background:var(--blue); color:#fff; }
  .danger { background:color-mix(in srgb,var(--red) 22%,var(--surface)); color:var(--red); }
  button:disabled { opacity:.6; }
</style>
