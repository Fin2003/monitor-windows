<script>
  import { onMount } from 'svelte';
  let image = $state(''), error = $state(''), revision = 0;
  let surface, pressed = $state(false), pointer = $state(null);
  onMount(() => {
    let disposed = false, polling = false;
    async function refresh() {
      if (polling) return;
      polling = true;
      try {
        const frame = await window.api.getEsp32Preview(revision);
        if (!disposed) { revision = frame.revision; if (frame.image) image = frame.image; error = frame.error; }
      } catch (e) { if (!disposed) error = e.message; }
      finally { polling = false; }
    }
    refresh();
    const timer = setInterval(refresh, 80);
    return () => { disposed = true; clearInterval(timer); window.api.closeEsp32Preview(); };
  });
  function send(event, down) {
    const rect = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(1023, Math.round((event.clientX - rect.left) * 1024 / rect.width)));
    const y = Math.max(0, Math.min(599, Math.round((event.clientY - rect.top) * 600 / rect.height)));
    pointer = { x, y }; pressed = down;
    window.api.inputEsp32Preview({ x, y, pressed: down });
  }
  function start(event) { if (event.button !== 0) return; surface.setPointerCapture(event.pointerId); send(event, true); }
  function move(event) { if (pressed) send(event, true); }
  function end(event) { if (pressed) send(event, false); }
</script>

<section class="preview" aria-label="ESP32 触屏预览">
  <header><h3>屏幕预览</h3><span>1024 × 600</span></header>
  <div class="screen" bind:this={surface} role="application" aria-label="鼠标模拟触屏，点击或拖动" tabindex="0"
    onpointerdown={start} onpointermove={move} onpointerup={end} onpointercancel={end} onlostpointercapture={end}>
    {#if image}<img src={image} alt="ESP32 固件界面实时预览" draggable="false" />
    {:else}<div class="empty">{error || '正在加载屏幕…'}</div>{/if}
    {#if pressed && pointer}<span class="touch" style={`left:${pointer.x/1024*100}%;top:${pointer.y/600*100}%`}></span>{/if}
  </div>
  <p class:error>{error || '鼠标点击模拟轻触；按住拖动模拟滑动。上下切页，左右打开或关闭设置。无需连接设备即可预览。'}</p>
</section>

<style>
  .preview{margin-top:24px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}h3{margin:0;font-size:15px;font-weight:600}header span,p{color:var(--text-secondary);font-size:12px}p{margin:10px 0;line-height:1.6}.error{color:#de5b55}
  .screen{position:relative;width:100%;aspect-ratio:1024/600;background:#101214;overflow:hidden;border:1px solid var(--border);border-radius:12px;touch-action:none;user-select:none;cursor:crosshair;outline:none}.screen:focus-visible{outline:2px solid var(--accent);outline-offset:3px}img{width:100%;height:100%;display:block;pointer-events:none}.empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--text-secondary);font-size:13px}.touch{position:absolute;width:26px;height:26px;margin:-13px;border-radius:50%;border:2px solid #fff;background:#0a84ff66;pointer-events:none;box-shadow:0 0 0 5px #0a84ff22}
</style>
