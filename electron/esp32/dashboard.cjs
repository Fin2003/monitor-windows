const {responsiveLayout,codingChannelKeys}=require('../../src/shared/compact-overview-config.cjs');
const {codingCards,codingCard,emptyCard}=require('./coding-data.cjs');
const {decorateMemorySensor}=require('../../plugins/system-monitor/runtime/memory-display.js');
const {decorateVramSensor,displayVramSensorName}=require('../../plugins/system-monitor/runtime/vram-display.js');
const {stripHardwareBrand}=require('../../plugins/system-monitor/runtime/hardware-display.js');
const {radarState,radarOutlook,formatRadarDate,formatRadarAge}=require('../../plugins/tibo-radar/presentation.cjs');
const {radarPosts}=require('./radar-detail.cjs');
const txt=(value,max=100)=>[...String(value??'')].slice(0,max).join('');
const span=minutes=>{const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
  return d?`${d} 天 ${h} 小时`:h?`${h} 小时 ${m} 分`:`${m} 分`;};
// Big line carries the exact day ("10/04 18:00"); the line under it says how long is left or how late it is.
function outlookLines(o){
  const minutes=s=>Number(String(s||'').match(/\d+/)?.[0]);
  const detail=o.countdown?`剩余时间 ${span(minutes(o.countdown))}`:o.elapsed?`已超时 ${span(minutes(o.elapsed))}`:o.prediction&&o.detail?`预测 ${o.detail}`:'';
  return {outlook:o.dateLabel?`${o.dateLabel} ${o.label}`:o.label,outlookDetail:detail,outlookLate:!!o.late};
}
// Screen geometry of the firmware (UI_MARGIN / UI_GAP in monitor_theme.h).
const SCREEN={width:1024,height:600,margin:16,gap:12};
// The Windows overview's slot packing (same order, 单格/横双格/竖双格 rules), stretched to fill 1024x600.
// Text sizes follow the Windows formula: text = max(9, unit/22) x 文字, data = max(16, unit/11) x 数值; the
// firmware picks its nearest font. System cards size like the Windows system page: relative to their design.
function overviewLayout(slots,{coding,sensor}) {
  const usable=slots.filter(s=>s&&['coding','system','radar'].includes(s.kind));
  if(!usable.length)return null;
  const {gap,margin}=SCREEN,W=SCREEN.width-2*margin,H=SCREEN.height-2*margin;
  const placed=responsiveLayout(usable,W,H,gap);
  if(!placed.slots.length)return null;
  const cellW=(W-(placed.columns-1)*gap)/placed.columns,cellH=(H-(placed.rows-1)*gap)/placed.rows,unit=Math.min(cellW,cellH);
  const entries=[],codings=[],sensors=[];
  for(const slot of placed.slots){
    const x=Math.round(margin+(slot.column-1)*(cellW+gap)),y=Math.round(margin+(slot.row-1)*(cellH+gap));
    const w=Math.round(slot.width*cellW+(slot.width-1)*gap),h=Math.round(slot.height*cellH+(slot.height-1)*gap);
    const fs=Number(slot.fontScale)||1,ds=Number(slot.dataScale)||1;
    const t=Math.round(Math.max(9,unit/22)*fs*1.25),d=Math.round(Math.max(16,unit/11)*ds);
    if(slot.kind==='coding'){codings.push(coding(codingChannelKeys(slot)[0]));entries.push({k:'c',i:codings.length-1,x,y,w,h,t,d});}
    else if(slot.kind==='radar')entries.push({k:'r',x,y,w,h,t,d});
    else {
      // Sensors side by side in a wide slot, stacked otherwise (Windows SystemMonitorPage compact/horizontal).
      const ids=(slot.sensorIds||[]).slice(0,4),n=Math.max(1,ids.length),across=slot.width===2&&slot.height===1;
      for(let k=0;k<n;k++){
        const cw=across?(w-(n-1)*gap)/n:w,ch=across?h:(h-(n-1)*gap)/n;
        sensors.push(sensor(ids[k]));
        entries.push({k:'s',i:sensors.length-1,x:Math.round(across?x+k*(cw+gap):x),y:Math.round(across?y:y+k*(ch+gap)),w:Math.round(cw),h:Math.round(ch),t:Math.round(32*fs),d:Math.round(64*ds)});
      }
    }
  }
  return {entries,codings,sensors};
}
function dashboard({config={},cache={},system=null,radar=null,now=Date.now()}={}) {
  const ids=config.selectedProviders||[], sc=config.systemMonitor||{};
  const pct=n=>Number.isFinite(Number(n))&&n!=null?Math.max(0,Math.min(100,Number(n))):null;
  // Each Coding slot shows its own channel with the generic period card (5 小时 / 周 / 月).
  const codingFor=key=>codingCard(key,{config,cache,now})||emptyCard();
  const sensorFor=id=>{
    const s=(system?.sensors||[]).find(s=>s.id===id);
    if(!s)return {name:'暂无数据',value:'--',min:'--',max:'--',pct:null};
    const d=decorateVramSensor(decorateMemorySensor(s,system.sensors,sc.memoryDisplayMode),system.sensors,sc.vramDisplayMode,sc.vramDisplayUnit);
    const layout=d.displayCapacityLayout,parts=layout?.secondary||[];
    return {name:txt(sc.sensorAliases?.[id]||displayVramSensorName(d,sc.sensorLanguage),40),hardware:txt(stripHardwareBrand(s.zhHardware||s.hardware),60),
      type:txt(s.zhType||s.type,20),value:s.available===false?'--':txt(layout?.primary||d.displayValue||s.value,35),
      side:txt(parts.find(p=>p.kind==='percent')?.value,20),total:txt(parts.find(p=>p.kind==='total')?.value,20),
      min:txt(d.displayMin||s.min||'--',25),max:txt(d.displayMax||s.max||'--',25),
      pct:s.available===false?null:pct(parts.find(p=>p.kind==='percent')?.value?.replace('%','')??(s.type==='Load'?s.rawValue:null))};
  };
  const state=radarState(radar,now),outlook=radarOutlook(radar,now);
  // With overview slots the cards follow them; without, the firmware's default layout uses coding + 2 sensors.
  const overview=overviewLayout(config.compactOverview?.slots||[],{coding:codingFor,sensor:sensorFor});
  const sensors=overview?overview.sensors:(sc.selectedSensors||[]).slice(0,2).map(sensorFor);
  return {coding:codingCards({config,cache,now})[0],...(overview?{codings:overview.codings,layout:overview.entries}:{}),
    sensors,radar:{type:txt(state.latestType||'--',20),at:txt(formatRadarDate(state.latestAt,radar?.config?.displayTimeZone),30),age:txt(formatRadarAge(state.latestAt,now),25),health:txt(state.overviewLabel,20),healthKind:state.kind,state:txt(outlook.badge,20),...(o=>({outlook:txt(o.outlook,45),outlookDetail:txt(o.outlookDetail,40),outlookLate:o.outlookLate}))(outlookLines(outlook)),posts:radarPosts(radar,3).map(p=>({...p,text:txt(p.text,90),tag:txt(p.tag,20),at:txt(p.at,30)}))},
    sourceAge:system?.fetchedAt?Math.max(0,Math.floor((now-system.fetchedAt)/1000)):null};
}
module.exports={dashboard};
