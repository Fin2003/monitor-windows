<script>
  import {onMount} from 'svelte';
  import Icon from './Icon.svelte';
  let appearance = $state({theme:'dark',hasImage:false}), busy = $state(false), error = $state('');
  onMount(() => {
    window.api.getScreenAppearance().then(value => appearance = value);
    return window.api.onScreenAppearanceChange(value => appearance = value);
  });
  async function change(action) {
    busy = true; error = '';
    try { appearance = await action(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>
<div class="appearance">
  <div class="modes" aria-label="屏幕主题">
    <button class:active={appearance.theme === 'dark'} aria-pressed={appearance.theme === 'dark'} disabled={busy} onclick={() => change(() => window.api.setScreenTheme('dark'))}><Icon name="moon" size={13}/>深色</button>
    <button class:active={appearance.theme === 'light'} aria-pressed={appearance.theme === 'light'} disabled={busy} onclick={() => change(() => window.api.setScreenTheme('light'))}><Icon name="sun" size={13}/>亮色</button>
  </div>
  <button class="picture" disabled={busy} onclick={() => change(() => window.api.chooseScreenBackground())}><Icon name="image" size={13}/>{appearance.hasImage ? '更换背景' : '图片背景'}</button>
  {#if appearance.hasImage}<button class="clear" title="恢复默认背景" disabled={busy} onclick={() => change(() => window.api.clearScreenBackground())}>清除</button>{/if}
  {#if error}<span class="error" role="alert">{error}</span>{/if}
  {#if appearance.requiresFirmware}<span class="firmware-note">实体图片背景需要更新板卡固件；安装主机 EXE 不会刷板。</span>{/if}
</div>
<style>
  .appearance{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.modes{display:flex;gap:2px;padding:3px;background:var(--card-hover);border-radius:9px}
  button{display:flex;align-items:center;gap:5px;font:inherit;font-size:12px;cursor:pointer;color:var(--text-secondary);padding:7px 9px;border-radius:6px;background:transparent;border:0}
  button.active{background:var(--card);color:var(--text-primary);box-shadow:0 1px 3px #0002}.picture{border:1px solid var(--border);border-radius:8px}.clear{padding:7px 3px}
  button:active:not(:disabled){transform:scale(.97)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button:disabled{opacity:.5}.error{font-size:12px;color:var(--danger);width:100%}.firmware-note{font-size:12px;color:var(--text-secondary);width:100%;line-height:1.6}
</style>
