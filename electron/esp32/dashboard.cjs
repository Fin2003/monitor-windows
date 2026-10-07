const { codingCards } = require('./coding-data.cjs');
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
function dashboard({config={},cache={},system=null,radar=null,now=Date.now()}={}) {
  const ids=config.selectedProviders||[], sc=config.systemMonitor||{};
  const pct=n=>Number.isFinite(Number(n))&&n!=null?Math.max(0,Math.min(100,Number(n))):null;
  const sensors=(sc.selectedSensors||[]).slice(0,2).map(id=>{
    const s=(system?.sensors||[]).find(s=>s.id===id);
    if(!s)return {name:'暂无数据',value:'--',min:'--',max:'--',pct:null};
    const d=decorateVramSensor(decorateMemorySensor(s,system.sensors,sc.memoryDisplayMode),system.sensors,sc.vramDisplayMode,sc.vramDisplayUnit);
    const layout=d.displayCapacityLayout,parts=layout?.secondary||[];
    return {name:txt(sc.sensorAliases?.[id]||displayVramSensorName(d,sc.sensorLanguage),40),hardware:txt(stripHardwareBrand(s.zhHardware||s.hardware),60),
      type:txt(s.zhType||s.type,20),value:s.available===false?'--':txt(layout?.primary||d.displayValue||s.value,35),
      side:txt(parts.find(p=>p.kind==='percent')?.value,20),total:txt(parts.find(p=>p.kind==='total')?.value,20),
      min:txt(d.displayMin||s.min||'--',25),max:txt(d.displayMax||s.max||'--',25),
      pct:s.available===false?null:pct(parts.find(p=>p.kind==='percent')?.value?.replace('%','')??(s.type==='Load'?s.rawValue:null))};
  });
  const state=radarState(radar,now),outlook=radarOutlook(radar,now);
  return {coding:codingCards({config,cache,now})[0],
    sensors,radar:{type:txt(state.latestType||'--',20),at:txt(formatRadarDate(state.latestAt,radar?.config?.displayTimeZone),30),age:txt(formatRadarAge(state.latestAt,now),25),health:txt(state.label,20),state:txt(outlook.badge,20),...(o=>({outlook:txt(o.outlook,45),outlookDetail:txt(o.outlookDetail,40),outlookLate:o.outlookLate}))(outlookLines(outlook)),posts:radarPosts(radar,3).map(p=>({...p,text:txt(p.text,90),tag:txt(p.tag,20),at:txt(p.at,30)}))},
    sourceAge:system?.fetchedAt?Math.max(0,Math.floor((now-system.fetchedAt)/1000)):null};
}
module.exports={dashboard};
