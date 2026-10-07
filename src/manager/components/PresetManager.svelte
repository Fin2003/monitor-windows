<script>
  import Icon from '@shared/components/Icon.svelte';

  let presets = $state([]);
  let activePresetId = $state(null);
  let isDirty = $state(false);
  let showSaveDialog = $state(false);
  let showPresetList = $state(false);
  let presetName = $state('');
  let dirtyCheckTimer = null;

  async function refresh() {
    try {
      presets = await window.api.getPresets();
      activePresetId = await window.api.getActivePresetId();
    } catch (e) {
      console.error(e);
    }
  }

  async function checkDirty() {
    if (!activePresetId) {
      isDirty = false;
      return;
    }
    try {
      const snapshot = await window.api.snapshotCurrent();
      const preset = presets.find(p => p.id === activePresetId);
      if (!preset) {
        isDirty = false;
        return;
      }
      isDirty = !deepEqual(snapshot, preset.data);
    } catch (_) {
      isDirty = false;
    }
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  function scheduleDirtyCheck() {
    if (dirtyCheckTimer) clearTimeout(dirtyCheckTimer);
    dirtyCheckTimer = setTimeout(checkDirty, 500);
  }

  async function saveCurrentPreset() {
    if (!activePresetId) return;
    try {
      const snapshot = await window.api.snapshotCurrent();
      const preset = presets.find(p => p.id === activePresetId);
      if (preset) {
        const presetCopy = { id: preset.id, name: preset.name, createdAt: preset.createdAt, data: snapshot };
        await window.api.savePreset(presetCopy);
        await refresh();
        isDirty = false;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function saveAsNewPreset() {
    if (!presetName.trim()) return;
    try {
      const snapshot = await window.api.snapshotCurrent();
      const preset = {
        name: presetName.trim(),
        data: snapshot,
      };
      const saved = await window.api.savePreset(preset);
      await refresh();
      isDirty = false;
      showSaveDialog = false;
      presetName = '';
    } catch (e) {
      console.error(e);
    }
  }

  async function loadPreset(presetId) {
    try {
      const preset = await window.api.loadPreset(presetId);
      if (preset) {
        activePresetId = preset.id;
        isDirty = false;
        showPresetList = false;
        window.dispatchEvent(new CustomEvent('preset-applied', { detail: preset }));
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function deletePreset(presetId) {
    try {
      await window.api.deletePreset(presetId);
      if (activePresetId === presetId) {
        activePresetId = null;
        isDirty = false;
      }
      await refresh();
    } catch (e) {
      console.error(e);
    }
  }

  function openSaveDialog() {
    presetName = '';
    showSaveDialog = true;
    showPresetList = false;
  }

  function togglePresetList() {
    showPresetList = !showPresetList;
    showSaveDialog = false;
  }

  function discardChanges() {
    if (activePresetId) {
      loadPreset(activePresetId);
    }
  }

  window.addEventListener('config-changed', () => {
    scheduleDirtyCheck();
  });

  refresh();
</script>

<div class="preset-bar">
  {#if isDirty}
    <div class="dirty-indicator">
      <span class="dirty-dot"></span>
      <span class="dirty-text">未保存修改</span>
      <button class="dirty-btn save" onclick={saveCurrentPreset} title="保存到当前预设">
        <Icon name="save" size={12} /> 保存
      </button>
      <button class="dirty-btn discard" onclick={discardChanges} title="放弃修改，恢复预设">
        <Icon name="x" size={12} /> 放弃
      </button>
      <button class="dirty-btn saveas" onclick={openSaveDialog} title="保存为新预设">
        <Icon name="bookmark" size={12} /> 另存为
      </button>
    </div>
  {/if}

  <div class="preset-actions">
    <button class="preset-btn" onclick={togglePresetList} title="预设管理">
      <Icon name="bookmark" size={14} />
      {#if activePresetId}
        {presets.find(p => p.id === activePresetId)?.name || '未命名'}
      {:else}
        预设
      {/if}
    </button>
    <button class="preset-btn add" onclick={openSaveDialog} title="保存为新预设">
      <Icon name="save" size={14} />
    </button>
  </div>

  {#if showPresetList}
    <div class="preset-dropdown">
      {#if presets.length === 0}
        <div class="preset-empty">暂无预设</div>
      {:else}
        {#each presets as preset}
          <div class="preset-item" class:active={preset.id === activePresetId}>
            <button class="preset-item-name" onclick={() => loadPreset(preset.id)}>
              <Icon name="bookmark" size={14} />
              {preset.name}
            </button>
            <button class="preset-item-delete" onclick={() => deletePreset(preset.id)} title="删除预设">
              <Icon name="trash" size={12} />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  {#if showSaveDialog}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
    <div class="modal-overlay" role="dialog" tabindex="-1" onclick={() => showSaveDialog = false}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
      <div class="modal" role="document" onclick={(e) => e.stopPropagation()}>
        <div class="modal-title">保存为新预设</div>
        <div class="modal-field">
          <label for="preset-name">预设名称</label>
          <input id="preset-name" type="text" bind:value={presetName} placeholder="输入预设名称..."
            onkeydown={(e) => { if (e.key === 'Enter') saveAsNewPreset(); }} />
        </div>
        <div class="modal-btns">
          <button class="modal-btn cancel" onclick={() => showSaveDialog = false}>取消</button>
          <button class="modal-btn confirm" onclick={saveAsNewPreset} disabled={!presetName.trim()}>保存</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .preset-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
  }

  .dirty-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(255, 159, 10, 0.1);
    border: 1px solid rgba(255, 159, 10, 0.3);
    border-radius: var(--radius-btn);
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dirty-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--warning);
    animation: pulse 1.5s ease infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .dirty-text {
    font-size: 12px; color: var(--warning); font-weight: 500;
  }

  .dirty-btn {
    padding: 2px 8px; border-radius: 4px; font-size: 11px;
    display: flex; align-items: center; gap: 3px;
    font-weight: 500;
  }
  .dirty-btn.save { background: var(--accent); color: white; }
  .dirty-btn.save:hover { background: var(--accent-hover); }
  .dirty-btn.discard { background: var(--card-hover); color: var(--text-secondary); }
  .dirty-btn.discard:hover { background: var(--border); color: var(--text-primary); }
  .dirty-btn.saveas { background: rgba(10, 132, 255, 0.12); color: var(--accent); }
  .dirty-btn.saveas:hover { background: rgba(10, 132, 255, 0.2); }

  .preset-actions {
    display: flex; align-items: center; gap: 4px;
  }

  .preset-btn {
    padding: 4px 10px; border-radius: var(--radius-sm);
    background: var(--card-hover); color: var(--text-secondary);
    font-size: 12px; display: flex; align-items: center; gap: 5px;
    transition: all 0.15s;
  }
  .preset-btn:hover { background: var(--border); color: var(--text-primary); }
  .preset-btn.add { padding: 4px 6px; }

  .preset-dropdown {
    position: absolute; top: 100%; right: 0; margin-top: 6px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius-card); min-width: 200px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 100;
    padding: 4px;
  }

  .preset-empty {
    padding: 16px; text-align: center; color: var(--text-secondary); font-size: 13px;
  }

  .preset-item {
    display: flex; align-items: center; gap: 4px;
    border-radius: var(--radius-sm);
  }
  .preset-item.active { background: rgba(10, 132, 255, 0.08); }

  .preset-item-name {
    flex: 1; display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; font-size: 13px; color: var(--text-primary);
    border-radius: var(--radius-sm); background: transparent;
  }
  .preset-item-name:hover { background: var(--card-hover); }
  .preset-item.active .preset-item-name { color: var(--accent); }

  .preset-item-delete {
    padding: 4px 6px; border-radius: 4px; color: var(--text-secondary);
    background: transparent; opacity: 0.4; transition: opacity 0.15s;
  }
  .preset-item:hover .preset-item-delete { opacity: 1; }
  .preset-item-delete:hover { background: rgba(255, 69, 58, 0.1); color: var(--danger); }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
  }
  .modal {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card);
    padding: 24px; max-width: 340px; width: 90%;
  }
  .modal-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
  .modal-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
  .modal-field label { font-size: 12px; color: var(--text-secondary); }
  .modal-field input {
    padding: 8px 12px; border-radius: var(--radius-btn);
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text-primary); font-size: 14px; outline: none;
  }
  .modal-field input:focus { border-color: var(--accent); }
  .modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
  .modal-btn {
    padding: 8px 18px; border-radius: var(--radius-btn); font-size: 14px; font-weight: 500;
  }
  .modal-btn.cancel { background: var(--card-hover); color: var(--text-primary); }
  .modal-btn.cancel:hover { background: var(--border); }
  .modal-btn.confirm { background: var(--accent); color: white; }
  .modal-btn.confirm:hover { background: var(--accent-hover); }
  .modal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
