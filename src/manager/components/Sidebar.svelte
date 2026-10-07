<script>
  import Icon from '@shared/components/Icon.svelte';

  let { tabs, activeTab, collapsed, onTabChange, onToggleCollapse } = $props();
</script>

<nav class="sidebar" class:collapsed>
  <button class="sidebar-toggle" onclick={() => onToggleCollapse?.()}>
    {#if collapsed}
      <Icon name="menu" size={16} />
    {:else}
      <Icon name="sidebar" size={16} />
    {/if}
  </button>

  <ul class="nav-list">
    {#each tabs as tab}
      <li>
        <button
          class="nav-item"
          class:active={activeTab === tab.id}
          onclick={() => onTabChange?.(tab.id)}
          title={tab.label}
        >
          <span class="nav-icon">
            <Icon name={tab.icon} size={16} />
          </span>
          {#if !collapsed}
            <span class="nav-label">{tab.label}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .sidebar {
    width: 180px;
    background: var(--card);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 8px;
    transition: width 0.2s ease;
    flex-shrink: 0;
  }
  .sidebar.collapsed {
    width: 52px;
  }

  .sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    margin-bottom: 8px;
    cursor: pointer;
    color: var(--text-secondary);
    border-radius: var(--radius-btn);
    font-size: 14px;
    background: transparent;
  }
  .sidebar-toggle:hover {
    background: var(--border);
    color: var(--text-primary);
  }

  .nav-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border-radius: var(--radius-btn);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: left;
    transition: all 0.15s;
  }
  .nav-item:hover {
    background: var(--card-hover);
    color: var(--text-primary);
  }
  .nav-item.active {
    background: var(--accent);
    color: white;
  }

  .nav-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
  }
</style>
