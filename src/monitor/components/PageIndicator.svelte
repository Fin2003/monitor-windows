<script>
  import Icon from '@shared/components/Icon.svelte';

  let { plugins, currentPageIndex, onSelect, onPrev, onNext } = $props();
</script>

<div class="indicator">
  <button class="nav-btn" aria-label="上一页" onclick={onPrev}>
    <Icon name="chevron-left" size={10} />
  </button>
  <div class="dots">
    {#each plugins as _, idx}
      <button
        class="dot"
        class:active={idx === currentPageIndex}
        aria-label="第{idx + 1}页"
        onclick={() => onSelect(idx)}
      ></button>
    {/each}
  </div>
  <button class="nav-btn" aria-label="下一页" onclick={onNext}>
    <Icon name="chevron-right" size={10} />
  </button>
</div>

<style>
  .indicator {
    display: flex; align-items: center; justify-content: center;
    gap: 12px; padding: 8px 0 12px; flex-shrink: 0;
  }

  .nav-btn {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--card); color: var(--text-secondary);
  }
  .nav-btn:hover { background: var(--card-hover); color: var(--text-primary); }

  .dots { display: flex; gap: 6px; }

  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--border);
    padding: 0; transition: all 0.2s;
  }
  .dot.active { background: var(--accent); width: 20px; border-radius: 4px; }
  .dot:hover { background: var(--text-secondary); }
</style>
