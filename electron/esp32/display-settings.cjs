const { codingChannelKeys } = require('../../src/shared/compact-overview-config.cjs');
const GROUPS = ['overview', 'coding', 'system', 'radar'];
const DEFAULT_PREFS = Object.freeze({mask:15,order:[0,1,2,3],dark:true,bigValues:false,showMinMax:true,cycleSeconds:0});
function normalizePrefs(value = {}) {
  const mask = Number.isInteger(value.mask) && value.mask > 0 && value.mask <= 15 ? value.mask : 15;
  const order = Array.isArray(value.order) && value.order.length === 4 && new Set(value.order).size === 4 && value.order.every(n => Number.isInteger(n) && n >= 0 && n < 4) ? [...value.order] : [0,1,2,3];
  return {mask,order,dark:typeof value.dark === 'boolean'?value.dark:true,bigValues:value.bigValues===true,
    showMinMax:value.showMinMax!==false,cycleSeconds:[0,5,10,15,30,60].includes(value.cycleSeconds)?value.cycleSeconds:0};
}
function selectedIds(config, kind) {
  return [...new Set(kind === 'sensors'
    ? [...(config.systemMonitor?.selectedSensors || []),...(config.compactOverview?.slots || []).flatMap(s=>s?.kind==='system'?s.sensorIds||[]:[])]
    : [...(config.selectedProviders || []),...(config.compactOverview?.slots || []).filter(s=>s?.kind==='coding').flatMap(codingChannelKeys)])];
}
function catalog(config = {}, system = null, kind) {
  if (kind === 'sensors') return (system?.sensors || []).filter(s=>typeof s.id==='string').map(s=>({id:s.id,label:`${s.zhHardware || s.hardware || ''} / ${config.systemMonitor?.sensorAliases?.[s.id] || s.zhName || s.name || s.id}`}));
  if (kind !== 'channels') throw new Error('Invalid catalog kind');
  const accounts = new Map((config.channelAccounts || []).filter(a=>a.enabled!==false).map(a=>[a.id,a]));
  const keys = [...new Set([...Object.values(config.accountChannels || {}).flat(),...selectedIds(config,'channels')])];
  for (const [id,account] of accounts) if (account.type !== 'xfyun' && !keys.some(k=>k.split(':')[0]===id)) keys.push(id);
  return keys.filter(key=>typeof key==='string' && accounts.has(key.split(':')[0])).map(id=>{
    const account=accounts.get(id.split(':')[0]);
    return {id,label:config.providerNames?.[id] || `${account.label || account.id}${id.includes(':')?' / '+id.split(':').slice(1).join(':'):''}`};
  });
}
class DisplaySettings {
  constructor(read,write) {this.read=read;this.write=write;this.data=read()||{};this.data.prefs=normalizePrefs(this.data.prefs);}
  save() {this.write(this.data);}
  preferences(value) {const prefs=normalizePrefs(value);if(JSON.stringify(prefs)!==JSON.stringify(this.data.prefs)){this.data.prefs=prefs;this.save();}return prefs;}
  ids(config,kind) {const value=this.data[kind];return Array.isArray(value)?value:selectedIds(config,kind);}
  select(config,system,kind,id,enabled) {
    if (!['sensors','channels'].includes(kind) || typeof id!=='string' || typeof enabled!=='boolean') throw new Error('Invalid selection');
    if (!catalog(config,system,kind).some(item=>item.id===id)) throw new Error('Unknown selection');
    const ids=new Set(this.ids(config,kind));if(enabled)ids.add(id);else ids.delete(id);
    if (ids.size>512) throw new Error('Selection limit');
    this.data[kind]=[...ids];this.save();
  }
  page(config,system,kind,offset=0,onlySelected=false) {
    const enabled=new Set(this.ids(config,kind));
    let items=catalog(config,system,kind).map(item=>({...item,enabled:enabled.has(item.id)}));
    if(onlySelected) items=items.filter(item=>item.enabled);
    const start=Math.max(0,Math.min(Math.floor((items.length-1)/8)*8,Number.isInteger(offset)?Math.floor(offset/8)*8:0));
    return {v:1,type:'catalog',kind,offset:start,total:items.length,onlySelected,items:items.slice(start,start+8).map(item=>({...item,label:[...item.label].slice(0,85).join('')}))};
  }
  config(source) {
    const keys=this.ids(source,'channels');
    return {...source,selectedProviders:keys,accountDisplayEnabled:{},compactOverview:{slots:[]},
      systemMonitor:{...source.systemMonitor,selectedSensors:this.ids(source,'sensors'),showMinMax:this.data.prefs.showMinMax}};
  }
}
module.exports={GROUPS,DEFAULT_PREFS,normalizePrefs,selectedIds,catalog,DisplaySettings};
