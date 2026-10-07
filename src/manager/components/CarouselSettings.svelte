<script>
  import Icon from '@shared/components/Icon.svelte';

  let config = $state({});
  let enabled = $state(true);
  let interval = $state(10);
  let loading = $state(true);

  async function refresh() {
    loading = true;
    try {
      config = await window.api.getConfig();
    } catch (e) {
      console.error(e);
    }
    loading = false;

    const cc = config.carousel || {};
    enabled = cc.enabled !== false;
    interval = cc.interval || 10;
  }

  async function save() {
    await window.api.setConfig('carousel', { enabled, interval });
    await window.api.setCarouselConfig({ enabled, interval });
  }

  refresh();
</script>

<div class="page">
  <h2 class="page-title">轮播设置</h2>

  {#if loading}
    <div class="loading">加载中...</div>
  {:else}
    <section class="section">
      <label class="toggle-row">
        <span>自动轮播</span>
        <input type="checkbox" checked={enabled} onchange={() => { enabled = !enabled; save(); }} />
      </label>
    </section>

    <section class="section">
      <h3 class="section-title">轮播间隔</h3>
      <div class="slider-row">
        <input
          type="range"
          min={3}
          max={60}
          step={1}
          value={interval}
          oninput={(e) => interval = Number(e.target.value)}
          onchange={save}
          disabled={!enabled}
        />
        <span class="slider-value">{interval}秒</span>
      </div>
    </section>

    <section class="section">
      <button class="btn btn-primary" onclick={save}>
        <Icon name="check" size={14} />
        保存设置
      </button>
    </section>
  {/if}
</div>

<style>
  .page { max-width: 560px; }
  .page-title { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
  .loading { color: var(--text-secondary); padding: 40px 0; }

  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 15px; font-weight: 600; color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;
  }

  .toggle-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; cursor: pointer;
  }
  .toggle-row input[type="checkbox"] {
    width: 40px; height: 22px; appearance: none; background: var(--border);
    border-radius: 11px; position: relative; cursor: pointer; transition: background 0.2s;
    border: none; padding: 0;
  }
  .toggle-row input[type="checkbox"]::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%; background: white; transition: transform 0.2s;
  }
  .toggle-row input[type="checkbox"]:checked { background: var(--accent); }
  .toggle-row input[type="checkbox"]:checked::after { transform: translateX(18px); }

  .slider-row { display: flex; align-items: center; gap: 16px; }
  .slider-row input[type="range"] {
    flex: 1; appearance: none; height: 4px; background: var(--border);
    border-radius: 2px; outline: none; border: none; padding: 0;
  }
  .slider-row input[type="range"]::-webkit-slider-thumb {
    appearance: none; width: 18px; height: 18px; border-radius: 50%;
    background: var(--accent); cursor: pointer;
  }
  .slider-row input[type="range"]:disabled { opacity: 0.4; }
  .slider-value { min-width: 40px; color: var(--accent); font-weight: 500; font-size: 14px; }

  .btn {
    padding: 10px 20px; border-radius: var(--radius-btn);
    font-size: 14px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
  }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); }
</style>
