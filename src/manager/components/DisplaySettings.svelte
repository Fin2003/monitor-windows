<script>
  import Icon from '@shared/components/Icon.svelte';

  let { onconfigchanged } = $props();

  let displays = $state([]);
  let monitorStatus = $state({ running: false, bounds: null });
  let selectedDisplayId = $state(null);
  let fullscreenLock = $state(true);
  let customWidth = $state(640);
  let customHeight = $state(480);
  let customX = $state(0);
  let customY = $state(0);
  let useCustomResolution = $derived(!fullscreenLock);
  let useCustomPosition = $state(false);
  let ignoreScaleFactor = $state(false);
  let loading = $state(true);
  let applyTimer = null;
  let isDraggingPosition = $state(false);
  let dragStartX = $state(null);
  let displayNames = $state({});
  let editingDisplayName = $state(null);
  let tempDisplayName = $state('');

  function autofocus(node) {
    node.focus();
    node.select();
  }
  let dragStartY = $state(null);
  let dragMoved = $state(false);
  let saveTimer = null;
  let theme = $state('dark');
  let autoStart = $state(false);
  let isRestarting = $state(false);
  let pendingDisplay = $state(null);

  let selectedDisplay = $derived(displays.find(d => d.id === selectedDisplayId));
  let scaleFactor = $derived(selectedDisplay?.scaleFactor || 1);

  let maxSliderX = $derived(() => {
    if (!selectedDisplay) return 3840;
    const d = selectedDisplay;
    return d.bounds.x + d.bounds.width;
  });
  let maxSliderY = $derived(() => {
    if (!selectedDisplay) return 2160;
    const d = selectedDisplay;
    return d.bounds.y + d.bounds.height;
  });

  let effectiveWidth = $derived.by(() => {
    if (fullscreenLock && selectedDisplay) return selectedDisplay.bounds.width;
    return ignoreScaleFactor && scaleFactor !== 1 ? Math.round(customWidth / scaleFactor) : customWidth;
  });
  let effectiveHeight = $derived.by(() => {
    if (fullscreenLock && selectedDisplay) return selectedDisplay.bounds.height;
    return ignoreScaleFactor && scaleFactor !== 1 ? Math.round(customHeight / scaleFactor) : customHeight;
  });

  function buildDisplayConfig() {
    return {
      targetDisplayId: selectedDisplayId,
      targetDisplayMeta: selectedDisplay ? {
        internal: selectedDisplay.internal === true,
        label: selectedDisplay.label || '',
        width: selectedDisplay.bounds.width,
        height: selectedDisplay.bounds.height,
        scaleFactor: selectedDisplay.scaleFactor,
        x: selectedDisplay.bounds.x,
        y: selectedDisplay.bounds.y,
      } : null,
      autoStart,
      fullscreenLock,
      ignoreScaleFactor,
      useCustomPosition,
      customWidth,
      customHeight,
      customX,
      customY,
      displayNames: { ...displayNames },
    };
  }

  function resolveSavedDisplay(config, availableDisplays) {
    const exact = availableDisplays.find(display => String(display.id) === String(config?.targetDisplayId));
    if (exact) return exact;
    const saved = config?.targetDisplayMeta;
    if (saved) {
      return [...availableDisplays].map(display => {
        let score = 0;
        if (display.internal === saved.internal) score += 100;
        if (display.bounds.width === saved.width && display.bounds.height === saved.height) score += 70;
        if (display.bounds.width === saved.height && display.bounds.height === saved.width) score += 35;
        if (display.scaleFactor === saved.scaleFactor) score += 18;
        if (display.bounds.x === saved.x && display.bounds.y === saved.y) score += 20;
        return { display, score };
      }).sort((left, right) => right.score - left.score)[0]?.display || null;
    }
    return availableDisplays.find(display => display.internal === false)
      || availableDisplays[availableDisplays.length - 1]
      || availableDisplays[0]
      || null;
  }

  async function saveConfig() {
    try {
      await window.api.setConfig('display', buildDisplayConfig());
      await window.api.setConfig('theme', theme);
      onconfigchanged?.();
    } catch (_) {}
  }

  async function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    await saveConfig();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfig, 300);
  }

  async function refresh() {
    loading = true;
    try {
      displays = await window.api.getDisplays();
      const config = await window.api.getConfig();
      monitorStatus = await window.api.getMonitorStatus();
      const dc = config.display || {};
      theme = config.theme || 'dark';
      autoStart = dc.autoStart === true;
      document.documentElement.setAttribute('data-theme', theme);

      selectedDisplayId = resolveSavedDisplay(dc, displays)?.id || null;
      fullscreenLock = dc.fullscreenLock !== false;
      ignoreScaleFactor = dc.ignoreScaleFactor || false;
      displayNames = dc.displayNames || {};

      if (dc.customWidth && dc.customHeight) {
        customWidth = dc.customWidth;
        customHeight = dc.customHeight;
        customX = dc.customX ?? (monitorStatus.bounds?.x ?? 0);
        customY = dc.customY ?? (monitorStatus.bounds?.y ?? 0);
      } else if (monitorStatus.bounds) {
        const sf = scaleFactor;
        customWidth = ignoreScaleFactor ? Math.round(monitorStatus.bounds.width * sf) : monitorStatus.bounds.width;
        customHeight = ignoreScaleFactor ? Math.round(monitorStatus.bounds.height * sf) : monitorStatus.bounds.height;
        customX = monitorStatus.bounds.x;
        customY = monitorStatus.bounds.y;
      } else if (selectedDisplay && !dc.fullscreenLock) {
        const lb = selectedDisplay.bounds;
        customWidth = lb.width;
        customHeight = lb.height;
        customX = lb.x;
        customY = lb.y;
      }

      useCustomPosition = dc.useCustomPosition === true || (dc.customX !== null && dc.customX !== undefined);
    } catch (e) {
      console.error(e);
    }
    loading = false;
  }

  async function applyBoundsLive() {
    if (!monitorStatus.running) return;
    try {
      await window.api.updateMonitorBounds({ x: customX, y: customY, width: effectiveWidth, height: effectiveHeight });
      monitorStatus = await window.api.getMonitorStatus();
    } catch (_) {}
  }

  function scheduleApply() {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(applyBoundsLive, 200);
  }

  $effect(() => {
    if (monitorStatus.running && !fullscreenLock && !isDraggingPosition && !isRestarting) {
      customWidth; customHeight; ignoreScaleFactor; fullscreenLock;
      scheduleApply();
    }
  });

  $effect(() => {
    if (!isDraggingPosition && !isRestarting) {
      customX; customY;
      scheduleSave();
    }
  });

  $effect(() => {
    if (isRestarting) return;
    selectedDisplayId; fullscreenLock; useCustomPosition; ignoreScaleFactor;
    scheduleSave();
  });

  function onSliderDown() {
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dragStartX = customX;
    dragStartY = customY;
    dragMoved = false;
    isDraggingPosition = true;
    const bounds = { x: customX, y: customY, width: effectiveWidth, height: effectiveHeight };
    window.api.previewBoundsStart(bounds);
  }

  function onSliderInput(axis, value) {
    dragMoved = true;
    if (axis === 'x') customX = value;
    else customY = value;
    const bounds = { x: customX, y: customY, width: effectiveWidth, height: effectiveHeight };
    window.api.previewBoundsMove(bounds);
  }

  async function onSliderUp() {
    isDraggingPosition = false;
    if (!dragMoved) {
      await window.api.previewBoundsEnd(null);
      customX = dragStartX;
      customY = dragStartY;
      return;
    }
    const bounds = { x: customX, y: customY, width: effectiveWidth, height: effectiveHeight };
    await window.api.previewBoundsEnd(bounds);
    if (monitorStatus.running) {
      monitorStatus = await window.api.getMonitorStatus();
    }
    saveConfig();
  }

  function calcMappedPosition(oldDisplay, newDisplay, winW, winH, oldX, oldY) {
    const oldW = oldDisplay.bounds.width;
    const oldH = oldDisplay.bounds.height;
    const newW = newDisplay.bounds.width;
    const newH = newDisplay.bounds.height;
    const oldAspect = oldW / oldH;
    const newAspect = newW / newH;

    if (Math.abs(oldAspect - newAspect) < 0.05) {
      const ratioX = (oldX - oldDisplay.bounds.x) / oldW;
      const ratioY = (oldY - oldDisplay.bounds.y) / oldH;
      return {
        x: Math.round(newDisplay.bounds.x + ratioX * newW),
        y: Math.round(newDisplay.bounds.y + ratioY * newH),
      };
    }
    return {
      x: Math.round(newDisplay.bounds.x + (newW - winW) / 2),
      y: Math.round(newDisplay.bounds.y + (newH - winH) / 2),
    };
  }

  function onDisplayClick(d) {
    if (d.id === selectedDisplayId) return;
    if (!monitorStatus.running) {
      selectedDisplayId = d.id;
      saveConfig();
      return;
    }
    pendingDisplay = d;
  }

  async function confirmDisplaySwitch() {
    const newDisplay = pendingDisplay;
    pendingDisplay = null;
    if (!newDisplay) return;

    selectedDisplayId = newDisplay.id;

    if (fullscreenLock) {
      await saveConfig();
      if (monitorStatus.running) await startMonitor();
      return;
    }

    const oldDisplay = displays.find(d => d.id !== newDisplay.id);
    const winW = monitorStatus.bounds?.width ? (ignoreScaleFactor ? Math.round(monitorStatus.bounds.width * scaleFactor) : monitorStatus.bounds.width) : customWidth;
    const winH = monitorStatus.bounds?.height ? (ignoreScaleFactor ? Math.round(monitorStatus.bounds.height * scaleFactor) : monitorStatus.bounds.height) : customHeight;
    const oldX = monitorStatus.bounds?.x ?? customX;
    const oldY = monitorStatus.bounds?.y ?? customY;

    const newW = newDisplay.bounds.width;
    const newH = newDisplay.bounds.height;

    let finalW = winW, finalH = winH;
    if (winW > newW || winH > newH) {
      const scale = Math.min(newW / winW, newH / winH) * 0.95;
      finalW = Math.round(winW * scale);
      finalH = Math.round(winH * scale);
    }

    let finalX, finalY;
    if (oldDisplay) {
      const ratioX = (oldX - oldDisplay.bounds.x) / oldDisplay.bounds.width;
      const ratioY = (oldY - oldDisplay.bounds.y) / oldDisplay.bounds.height;
      finalX = Math.round(newDisplay.bounds.x + ratioX * newW);
      finalY = Math.round(newDisplay.bounds.y + ratioY * newH);
    } else {
      finalX = Math.round(newDisplay.bounds.x + (newW - finalW) / 2);
      finalY = Math.round(newDisplay.bounds.y + (newH - finalH) / 2);
    }
    finalX = Math.max(newDisplay.bounds.x, Math.min(finalX, newDisplay.bounds.x + newW - finalW));
    finalY = Math.max(newDisplay.bounds.y, Math.min(finalY, newDisplay.bounds.y + newH - finalH));

    customWidth = finalW;
    customHeight = finalH;
    customX = finalX;
    customY = finalY;

    await saveConfig();
    if (monitorStatus.running) await startMonitor();
  }

  function cancelDisplaySwitch() {
    pendingDisplay = null;
  }

  async function startMonitor() {
    isRestarting = true;
    autoStart = true;
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await saveConfig();
    await window.api.startMonitor(selectedDisplayId, null, fullscreenLock);
    monitorStatus = await window.api.getMonitorStatus();
    if (monitorStatus.bounds && !fullscreenLock) {
      customX = monitorStatus.bounds.x;
      customY = monitorStatus.bounds.y;
    }
    isRestarting = false;
  }

  async function stopMonitor() {
    autoStart = false;
    await window.api.stopMonitor();
    await window.api.setConfig('display', { ...buildDisplayConfig(), autoStart: false });
    monitorStatus = await window.api.getMonitorStatus();
  }

  async function toggleFullscreenLock() {
    fullscreenLock = !fullscreenLock;
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    await saveConfig();
    if (monitorStatus.running) {
      await startMonitor();
    }
  }

  function getDisplayName(d) {
    return displayNames[d.id] || d.label || `显示器 ${d.id}`;
  }

  function startEditDisplayName(d) {
    editingDisplayName = d.id;
    tempDisplayName = displayNames[d.id] || '';
  }

  function saveDisplayName(d) {
    if (tempDisplayName.trim()) {
      displayNames[d.id] = tempDisplayName.trim();
    } else {
      delete displayNames[d.id];
    }
    displayNames = { ...displayNames };
    editingDisplayName = null;
    saveConfig();
  }

  refresh();

  window.api?.onPresetLoaded?.(() => {
    refresh();
  });
</script>

<div class="page">
  <h2 class="page-title">显示设置</h2>

  {#if loading}
    <div class="loading">加载中...</div>
  {:else}
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">选择显示器</h3>
        <button class="btn-ghost btn-refresh" onclick={refresh} title="刷新显示器列表">
          <Icon name="refresh" size={14} />
          刷新
        </button>
      </div>
      <div class="display-grid">
        {#each displays as d}
          <div class="display-card" class:active={selectedDisplayId === d.id}>
            <button class="display-card-btn" onclick={() => onDisplayClick(d)}>
              <div class="display-icon">
                <Icon name="monitor" size={24} />
              </div>
              <div class="display-info">
                {#if editingDisplayName === d.id}
                  <input class="display-name-edit" type="text" value={tempDisplayName}
                    use:autofocus
                    placeholder={d.label || `显示器 ${d.id}`}
                    oninput={(e) => tempDisplayName = e.target.value}
                    onkeydown={(e) => { if (e.key === 'Enter') saveDisplayName(d); if (e.key === 'Escape') editingDisplayName = null; }}
                    onblur={() => saveDisplayName(d)} />
                {:else}
                  <div class="display-name">{getDisplayName(d)}</div>
                {/if}
                <div class="display-res">{d.bounds.width}×{d.bounds.height} · {d.scaleFactor}x</div>
              </div>
            </button>
            {#if editingDisplayName !== d.id}
              <button class="display-edit-btn" onclick={() => startEditDisplayName(d)} title="编辑名称">
                <Icon name="edit" size={14} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <section class="section">
      <label class="toggle-row highlight">
        <div class="toggle-label">
          <span>{theme === 'dark' ? '深色模式' : '亮色模式'}</span>
          <span class="toggle-desc">切换界面主题，同步应用到所有窗口</span>
        </div>
        <button class="theme-toggle" onclick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
      </label>
    </section>

    <section class="section">
      <div class="mode-card">
        <button class="mode-btn" class:active={fullscreenLock} onclick={toggleFullscreenLock}>
          <Icon name="maximize" size={16} />
          <span>全屏锁定</span>
        </button>
        <div class="mode-divider"></div>
        <button class="mode-btn" class:active={!fullscreenLock} onclick={toggleFullscreenLock}>
          <Icon name="settings" size={16} />
          <span>自定义分辨率</span>
        </button>
      </div>
    </section>

    {#if !fullscreenLock}
      <section class="section">
        <h3 class="section-title">分辨率</h3>
        <div class="input-row">
          <div class="input-group">
            <label for="custom-width">宽度</label>
            <input id="custom-width" type="number" value={customWidth} oninput={(e) => customWidth = Number(e.target.value)} min={100} max={4096} />
          </div>
          <div class="input-group">
            <label for="custom-height">高度</label>
            <input id="custom-height" type="number" value={customHeight} oninput={(e) => customHeight = Number(e.target.value)} min={100} max={4096} />
          </div>
        </div>
        {#if scaleFactor !== 1}
          <label class="toggle-row scale-toggle">
            <div class="toggle-label">
              <span>忽略缩放倍数</span>
              <span class="toggle-desc">输入逻辑像素，自动除以 {scaleFactor}x → 实际 {effectiveWidth}×{effectiveHeight}</span>
            </div>
            <input type="checkbox" checked={ignoreScaleFactor} onchange={async () => { ignoreScaleFactor = !ignoreScaleFactor; if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; } await saveConfig(); if (monitorStatus.running) applyBoundsLive(); }} />
          </label>
        {/if}
      </section>

      <section class="section">
        <h3 class="section-title">位置</h3>
        <label class="toggle-row">
          <span>自定义位置</span>
          <input type="checkbox" checked={useCustomPosition} onchange={async () => { useCustomPosition = !useCustomPosition; await saveConfig(); }} />
        </label>
        {#if useCustomPosition}
          <div class="slider-group">
            <div class="slider-row">
              <span class="slider-label">X</span>
              <input type="range" min={-2000} max={maxSliderX()} step={1} value={customX}
                onpointerdown={onSliderDown}
                oninput={(e) => onSliderInput('x', Number(e.target.value))}
                onpointerup={onSliderUp} />
              <input type="number" class="slider-value-input" value={customX}
                oninput={(e) => { customX = Number(e.target.value); if (monitorStatus.running) applyBoundsLive(); }}
                min={-2000} max={maxSliderX()} />
            </div>
            <div class="slider-row">
              <span class="slider-label">Y</span>
              <input type="range" min={-1000} max={maxSliderY()} step={1} value={customY}
                onpointerdown={onSliderDown}
                oninput={(e) => onSliderInput('y', Number(e.target.value))}
                onpointerup={onSliderUp} />
              <input type="number" class="slider-value-input" value={customY}
                oninput={(e) => { customY = Number(e.target.value); if (monitorStatus.running) applyBoundsLive(); }}
                min={-1000} max={maxSliderY()} />
            </div>
          </div>
        {/if}
        <p class="hint">拖拽滑块预览位置（蓝色半透明框），松开后应用。</p>
      </section>
    {/if}

    <section class="section">
      <h3 class="section-title">控制</h3>
      <div class="btn-row">
        {#if monitorStatus.running}
          <button class="btn btn-danger" onclick={stopMonitor}>
            <Icon name="stop" size={14} />
            停止显示
          </button>
        {:else}
          <button class="btn btn-primary" onclick={startMonitor} disabled={!selectedDisplayId}>
            <Icon name="power" size={14} />
            {fullscreenLock ? '全屏锁定启动' : '启动副屏显示'}
          </button>
        {/if}
      </div>
      {#if monitorStatus.running && monitorStatus.bounds}
        <div class="status-info">
          运行中 · {monitorStatus.bounds.width}×{monitorStatus.bounds.height} · 位置 ({monitorStatus.bounds.x}, {monitorStatus.bounds.y})
          {#if fullscreenLock} · 全屏锁定{/if}
        </div>
      {/if}
    </section>
  {/if}
</div>

{#if pendingDisplay}
  <div class="modal-overlay">
    <div class="modal">
      <div class="modal-title">切换显示器</div>
      <div class="modal-desc">
        确定要将监控窗口切换到「{pendingDisplay.label || `显示器 ${pendingDisplay.id}`}」吗？<br/>
        {pendingDisplay.bounds.width}×{pendingDisplay.bounds.height} · {pendingDisplay.scaleFactor}x
      </div>
      <div class="modal-desc sub">
        {#if selectedDisplay}
          {@const oldAspect = selectedDisplay.bounds.width / selectedDisplay.bounds.height}
          {@const newAspect = pendingDisplay.bounds.width / pendingDisplay.bounds.height}
          {#if Math.abs(oldAspect - newAspect) < 0.05}
            长宽比一致，位置将等比例映射。
          {:else}
            长宽比不同，窗口将居中显示。
          {/if}
        {/if}
      </div>
      <div class="modal-btns">
        <button class="modal-btn cancel" onclick={cancelDisplaySwitch}>取消</button>
        <button class="modal-btn confirm" onclick={confirmDisplaySwitch}>确认切换</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { max-width: 560px; }
  .page-title { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
  .loading { color: var(--text-secondary); padding: 40px 0; }
  .section { margin-bottom: 28px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .section-title {
    font-size: 15px; font-weight: 600; color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0;
  }
  .btn-refresh { padding: 4px 10px; font-size: 12px; }

  .mode-card {
    display: flex; align-items: stretch; gap: 0;
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius-card); padding: 4px;
  }
  .mode-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 16px; border-radius: var(--radius-btn);
    color: var(--text-secondary); background: transparent; font-size: 14px; font-weight: 500;
    transition: all 0.15s;
  }
  .mode-btn.active { background: var(--accent); color: white; }
  .mode-btn:not(.active):hover { background: var(--card-hover); color: var(--text-primary); }
  .mode-divider { width: 1px; background: var(--border); margin: 4px 0; }

  .display-grid { display: flex; flex-direction: column; gap: 8px; }
  .display-card {
    display: flex; align-items: center; gap: 4px;
    padding: 0; background: var(--card); border: 2px solid var(--border);
    border-radius: var(--radius-card); color: var(--text-primary);
    overflow: hidden; transition: all 0.15s;
  }
  .display-card:hover { border-color: var(--accent); }
  .display-card.active { border-color: var(--accent); background: rgba(10, 132, 255, 0.08); }
  .display-card-btn {
    flex: 1; display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; background: transparent; text-align: left; color: inherit;
  }
  .display-icon { color: var(--text-secondary); display: flex; }
  .display-card.active .display-icon { color: var(--accent); }
  .display-info { flex: 1; }
  .display-name { font-weight: 500; }
  .display-name-edit {
    width: 100%; padding: 2px 6px; font-size: 14px; font-weight: 500;
    background: var(--bg); border: 1px solid var(--accent); border-radius: 4px;
    color: var(--text-primary); outline: none;
  }
  .display-res { font-size: 12px; color: var(--text-secondary); }
  .display-edit-btn {
    padding: 8px 12px; background: transparent; color: var(--text-secondary);
    opacity: 0.4; transition: opacity 0.15s; flex-shrink: 0;
  }
  .display-card:hover .display-edit-btn { opacity: 1; }
  .display-edit-btn:hover { color: var(--accent); }

  .toggle-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; cursor: pointer;
  }
  .toggle-row.highlight {
    padding: 14px 16px; background: var(--card); border-radius: var(--radius-card);
    border: 1px solid var(--border);
  }
  .toggle-row.scale-toggle {
    margin-top: 8px; padding: 10px 14px; background: var(--card); border-radius: var(--radius-btn);
    border: 1px solid var(--border);
  }
  .toggle-label { display: flex; flex-direction: column; gap: 2px; }
  .toggle-desc { font-size: 12px; color: var(--text-secondary); }
  .toggle-row input[type="checkbox"] {
    width: 40px; height: 22px; appearance: none; background: var(--border);
    border-radius: 11px; position: relative; cursor: pointer; transition: background 0.2s;
    border: none; padding: 0; flex-shrink: 0;
  }
  .toggle-row input[type="checkbox"]::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%; background: white; transition: transform 0.2s;
  }
  .toggle-row input[type="checkbox"]:checked { background: var(--accent); }
  .toggle-row input[type="checkbox"]:checked::after { transform: translateX(18px); }

  .theme-toggle {
    width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; background: var(--card-hover); color: var(--accent);
    flex-shrink: 0; transition: all 0.2s;
  }
  .theme-toggle:hover { background: var(--accent); color: white; }

  .input-row { display: flex; gap: 12px; margin-top: 12px; }
  .input-group { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .input-group label { font-size: 12px; color: var(--text-secondary); }
  .input-group input[type="number"] { width: 100%; }

  .slider-group { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding: 12px 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .slider-row { display: flex; align-items: center; gap: 10px; }
  .slider-label { font-size: 12px; color: var(--text-secondary); min-width: 14px; }
  .slider-row input[type="range"] { flex: 1; appearance: none; height: 4px; background: var(--border); border-radius: 2px; outline: none; border: none; padding: 0; }
  .slider-row input[type="range"]::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); cursor: pointer; }
  .slider-value { min-width: 44px; color: var(--accent); font-weight: 500; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }
  .slider-value-input { width: 64px; padding: 2px 6px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }

  .hint { font-size: 12px; color: var(--text-secondary); margin-top: 8px; line-height: 1.6; }

  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    padding: 10px 20px; border-radius: var(--radius-btn);
    font-size: 14px; font-weight: 500; transition: all 0.15s;
    display: flex; align-items: center; gap: 6px;
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-danger { background: var(--danger); color: white; }
  .btn-danger:hover { opacity: 0.9; }
  .btn-ghost { background: transparent; color: var(--text-secondary); padding: 8px 12px; display: flex; align-items: center; gap: 6px; }
  .btn-ghost:hover { color: var(--text-primary); }

  .status-info {
    margin-top: 12px; padding: 10px 14px;
    background: rgba(48, 209, 88, 0.08); border: 1px solid rgba(48, 209, 88, 0.2);
    border-radius: var(--radius-btn); color: var(--success); font-size: 13px;
  }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
  }
  .modal {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card);
    padding: 24px; max-width: 380px; width: 90%;
  }
  .modal-title { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
  .modal-desc { font-size: 14px; color: var(--text-primary); line-height: 1.6; }
  .modal-desc.sub { font-size: 12px; color: var(--text-secondary); margin-top: 8px; }
  .modal-btns { display: flex; gap: 8px; margin-top: 20px; justify-content: flex-end; }
  .modal-btn {
    padding: 8px 18px; border-radius: var(--radius-btn); font-size: 14px; font-weight: 500;
  }
  .modal-btn.cancel { background: var(--card-hover); color: var(--text-primary); }
  .modal-btn.cancel:hover { background: var(--border); }
  .modal-btn.confirm { background: var(--accent); color: white; }
  .modal-btn.confirm:hover { background: var(--accent-hover); }
</style>
