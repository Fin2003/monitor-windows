<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { responsiveLayout } from '../shared/compact-overview-config.cjs';
  import { reorderCards, resizeCard } from '../shared/overview-editor.cjs';
  let {slots=[],width,height,disabled=false,onpreview,oncommit}=$props();
  let surface;
  let ghostHost;
  let gesture=$state(null);
  let settling=$state(false);
  let message=$state('');
  let layout=$derived(responsiveLayout(gesture?.candidate || slots.filter(Boolean),width,height));
  let signature=$derived(`${width}:${height}`);
  const names={coding:'Coding Plan',system:'系统监控',radar:'Tibo 雷达'};
  function rectFor(item,grid=layout) {
    return {x:(width-grid.columns*grid.unit-(grid.columns-1)*8)/2+(item.column-1)*(grid.unit+8),
      y:(height-grid.rows*grid.unit-(grid.rows-1)*8)/2+(item.row-1)*(grid.unit+8),
      w:item.width*grid.unit+(item.width-1)*8,h:item.height*grid.unit+(item.height-1)*8};
  }
  const styleFor=r=>`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  function point(event) {const r=surface.getBoundingClientRect();return {x:(event.clientX-r.left)*width/r.width,y:(event.clientY-r.top)*height/r.height};}
  function removeGhost() {ghostHost?.replaceChildren();}
  async function begin(event,index,edge=null) {
    if(disabled || settling || gesture || event.button!==0) return;
    event.preventDefault();event.stopPropagation();message='';
    const base=$state.snapshot(slots).filter(Boolean);
    const startLayout=responsiveLayout(base,width,height);
    const origin=rectFor(startLayout.slots[index],startLayout);
    const source=surface.parentElement.querySelectorAll('.grid-slot')[index];
    if(!source) return;
    const clone=source.cloneNode(true);
    clone.removeAttribute('id');clone.setAttribute('aria-hidden','true');
    clone.style.cssText+=';position:relative;left:0;top:0;width:100%;height:100%;transition:none;pointer-events:none';
    clone.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
    gesture={index,id:base[index].id,pointerId:event.pointerId,edge,start:point(event),origin,ghost:origin,base,startLayout,candidate:base,valid:true,moved:false};
    surface.setPointerCapture(event.pointerId);
    surface.focus({preventScroll:true});
    await tick();ghostHost?.replaceChildren(clone);
  }
  function move(event) {
    if(!gesture || event.pointerId!==gesture.pointerId || settling) return;
    const g=gesture,p=point(event),dx=p.x-g.start.x,dy=p.y-g.start.y;
    if(!g.moved && Math.hypot(dx,dy)<5) return;
    let candidate=g.base,valid=true,ghost={...g.origin};
    if(g.edge) {
      const horizontal=g.edge==='left' || g.edge==='right';
      const resized=resizeCard(g.base,g.index,g.edge,horizontal?dx:dy,g.startLayout.unit);
      candidate=resized.slots;valid=resized.valid;
      if(horizontal) {ghost.w=Math.max(g.startLayout.unit*.65,g.origin.w+(g.edge==='left'?-dx:dx));if(g.edge==='left') ghost.x=g.origin.x+g.origin.w-ghost.w;}
      else {ghost.h=Math.max(g.startLayout.unit*.65,g.origin.h+(g.edge==='top'?-dy:dy));if(g.edge==='top') ghost.y=g.origin.y+g.origin.h-ghost.h;}
    } else {
      ghost.x+=dx;ghost.y+=dy;
      valid=p.x>=0 && p.y>=0 && p.x<=width && p.y<=height;
      let nearest=g.index,distance=Infinity;
      g.startLayout.slots.forEach((item,index)=>{const r=rectFor(item,g.startLayout),d=(p.x-r.x-r.w/2)**2+(p.y-r.y-r.h/2)**2;if(d<distance){nearest=index;distance=d;}});
      candidate=reorderCards(g.base,g.index,nearest);
    }
    gesture={...g,candidate:valid?candidate:g.base,valid,ghost,moved:true};
    onpreview?.({slots:valid?candidate:g.base});
  }
  async function finish(event,cancel=false) {
    if(!gesture || settling || (event?.pointerId!==undefined && event.pointerId!==gesture.pointerId)) return;
    const g=gesture;settling=true;
    if(surface.hasPointerCapture(g.pointerId)) surface.releasePointerCapture(g.pointerId);
    let accepted=!cancel && g.valid && g.moved;
    if(accepted) {
      try {await oncommit?.(g.candidate);} catch(e) {accepted=false;message=e.message;}
    }
    if(!accepted) {onpreview?.({slots:g.base});if(!cancel && !g.valid) message=g.edge?'格数不足，已恢复原尺寸':'已恢复原位置';}
    const finalSlots=accepted?g.candidate:g.base;
    const finalLayout=responsiveLayout(finalSlots,width,height);
    const item=finalLayout.slots.find(s=>s.id===g.id) || finalLayout.slots[g.index];
    const target=rectFor(item,finalLayout);
    const ghost=ghostHost?.parentElement;
    if(ghost && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation=ghost.animate([{left:g.ghost.x+'px',top:g.ghost.y+'px',width:g.ghost.w+'px',height:g.ghost.h+'px',opacity:.58},{left:target.x+'px',top:target.y+'px',width:target.w+'px',height:target.h+'px',opacity:0}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
      let timer;
      await Promise.race([animation.finished.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,260);})]);
      clearTimeout(timer);animation.cancel();
    }
    removeGhost();gesture=null;settling=false;onpreview?.(null);
  }
  $effect(()=>{signature;untrack(()=>{if(gesture && !settling) finish(null,true);});});
  $effect(()=>{if(message) {const timer=setTimeout(()=>{message='';},2500);return ()=>clearTimeout(timer);}});
  onDestroy(removeGhost);
</script>

<svelte:window onpointermove={move} onpointerup={event=>finish(event)} onpointercancel={event=>finish(event,true)} onblur={()=>finish(null,true)} />

<div class="editor" data-gesture-mode={gesture?.edge || (gesture ? "move" : "idle")} data-target-cells={gesture?.candidate.find(s=>s.id===gesture.id)?.cells} bind:this={surface} role="group" aria-label="预览布局编辑" tabindex="0" onlostpointercapture={event=>{if(!settling) finish(event,true);}} onkeydown={event=>{if(event.key==='Escape') {event.preventDefault();finish(null,true);}}} class:dragging={!!gesture}>
  {#each layout.slots as slot,index (slot.id || index)}
    {@const r=rectFor(slot)}
    <div class="edit-card" class:selected={gesture?.id===slot.id} style={styleFor(r)} data-editor-index={index}>
      <button class="move-handle" disabled={disabled || settling} aria-label={`移动 ${names[slot.kind]} ${index+1}`} title="拖动换位" onpointerdown={event=>begin(event,index)}></button>
      {#each ['left','right','top','bottom'] as edge}
        <button class={`resize-handle ${edge}`} disabled={disabled || settling} aria-label={`调整 ${index+1} ${edge}`} title="拖动边缘调整单格或双格" onpointerdown={event=>begin(event,index,edge)}></button>
      {/each}
    </div>
  {/each}
  {#if gesture}
    {@const item=layout.slots.find(s=>s.id===gesture.id) || layout.slots[gesture.index]}
    <div class="drop-target" class:invalid={!gesture.valid} style={styleFor(rectFor(item))}></div>
    <div class="drag-ghost" class:invalid={!gesture.valid} style={styleFor(gesture.ghost)} aria-hidden="true"><div class="ghost-content" bind:this={ghostHost}></div></div>
  {/if}
  {#if message}<div class="gesture-message" role="status">{message}</div>{/if}
</div>

<style>
  .editor { position:absolute; inset:0; z-index:5; pointer-events:none; outline:none; touch-action:none; }
  .editor.dragging { pointer-events:auto; }
  .edit-card { position:absolute; pointer-events:none; border-radius:8px; transition:left .2s,top .2s,width .2s,height .2s; }
  button { position:absolute; padding:0; border:0; background:transparent; pointer-events:auto; touch-action:none; }
  .move-handle { inset:0; width:100%; height:100%; cursor:grab; border-radius:8px; }
  .move-handle:hover,.move-handle:focus-visible { outline:2px solid color-mix(in srgb,var(--accent) 60%,transparent); outline-offset:-2px; }
  .dragging .move-handle { cursor:grabbing; }
  .resize-handle { opacity:0; z-index:2; background:color-mix(in srgb,var(--accent) 55%,transparent); border-radius:4px; }
  .edit-card:hover .resize-handle,.resize-handle:focus-visible { opacity:1; }
  .left,.right { top:20%; height:60%; width:12px; cursor:ew-resize; }
  .left { left:0; } .right { right:0; }
  .top,.bottom { left:20%; width:60%; height:12px; cursor:ns-resize; }
  .top { top:0; } .bottom { bottom:0; }
  .drag-ghost { position:absolute; z-index:5; opacity:.58; pointer-events:none; border-radius:8px; outline:2px solid var(--accent); box-shadow:0 12px 30px #0005; overflow:hidden; }
  .ghost-content { width:100%; height:100%; }
  .drop-target { position:absolute; background:color-mix(in srgb,var(--accent) 16%,transparent); border:2px dashed var(--accent); border-radius:8px; transition:left .2s,top .2s,width .2s,height .2s; }
  .invalid { outline-color:var(--danger); border-color:var(--danger); }
  .gesture-message { position:absolute; bottom:8px; left:8px; max-width:calc(100% - 16px); background:var(--card); color:var(--warning); border:1px solid var(--border); padding:8px; font-size:14px; border-radius:4px; }
  @media(prefers-reduced-motion:reduce) { .edit-card,.drop-target { transition:none; } }
</style>
