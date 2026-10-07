const PLUGIN_ID = 'compact-overview';

function codingChannelKeys(slot) {
  const keys=Array.isArray(slot?.channelKeys) ? slot.channelKeys : [slot?.channelKey];
  return [...new Set(keys.filter(key=>typeof key === 'string' && key.length<=512 && /^(kimi|zhipu|minimax|zenmux|commandcode|volcengine|xfyun|opencodego)_[^:]+(?::.+)?$/.test(key)))];
}

function normalizeOverview(value) {
  if (value?.slots?.some(slot => slot && Object.hasOwn(slot, "cells"))) {
    const slots = Array.from({length: Math.max(6,value.slots.length)}, (_, index) => {
      const input = value.slots[index];
      if (!input) return null;
      const slot = normalizeOverview({slots:[{...input, cells: undefined}].map(({cells, ...rest}) => rest)}).slots[0];
      if (!slot) return null;
      const keys = slot.kind === 'coding' ? codingChannelKeys(input).slice(0,2) : [];
      const cells = input.cells === 1 && keys.length<=1 ? 1 : 2;
      const typography = {};
      if(typeof input.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(input.id) && !value.slots.slice(0,index).some(s=>s?.id===input.id)) typography.id=input.id;
      for (const key of ["fontScale", "dataScale"]) {
        if (Number.isFinite(input[key])) typography[key] = Math.max(.6, Math.min(2, input[key]));
      }
      return {...slot, ...typography, cells, orientation: input.orientation === "vertical" ? "vertical" : input.orientation === "horizontal" ? "horizontal" : slot.kind === "radar" ? "vertical" : "horizontal"};
    });
    return {slots};
  }
  const input = Array.isArray(value?.slots) ? value.slots.slice(0, 4) : [];
  const selected = new Set();
  let systemSlot = null;
  const slots = Array.from({ length: 4 }, (_, index) => {
    const slot = input[index];
    if (!slot) return null;
    if (slot.kind === 'sensor' || slot.kind === 'system') {
      const ids = slot.kind === 'sensor' ? [slot.sensorId] : Array.isArray(slot.sensorIds) ? slot.sensorIds : [];
      const valid = ids.filter(id => typeof id === 'string' && id.trim() && id.length <= 512);
      if (systemSlot) {
        systemSlot.sensorIds = [...new Set([...systemSlot.sensorIds, ...valid])].slice(0, 2);
        return null;
      }
      systemSlot = { kind: 'system', sensorIds: [...new Set(valid)].slice(0, 2) };
      return systemSlot;
    }
    if (!['coding', 'radar'].includes(slot.kind) || selected.has(slot.kind)) return null;
    const keys = slot.kind === 'coding' ? codingChannelKeys(slot).slice(0,2) : [];
    if (slot.kind === 'coding' && !keys.length) return null;
    selected.add(slot.kind);
    return slot.kind === 'coding' ? { kind: 'coding', channelKey: keys[0], ...(Array.isArray(slot.channelKeys) ? {channelKeys:keys} : {}) } : { kind: 'radar' };
  });
  return { slots };
}

function overviewDependencies(plugins, value) {
  const enabled = id => plugins.some(plugin => plugin.id === id && plugin.enabled);
  const slots = enabled(PLUGIN_ID) ? normalizeOverview(value).slots.filter(Boolean) : [];
  return {
    system: enabled('system-monitor') || slots.some(slot => slot.kind === 'system' && slot.sensorIds.length),
    radar: enabled('tibo-radar') || slots.some(slot => slot.kind === 'radar'),
    channels: [...new Set(slots.filter(slot => slot.kind === 'coding').flatMap(codingChannelKeys))],
  };
}

function requiredCodingChannels(plugins, value, selected = [], accounts = []) {
  const standalone = plugins.some(plugin => plugin.id === 'coding-plan' && plugin.enabled);
  const channels = [...(standalone ? selected : []), ...overviewDependencies(plugins, value).channels];
  return [...new Set(channels)].filter(key => {
    if (typeof key !== 'string' || !key) return false;
    const id = key.split(':')[0];
    if (id.startsWith('xfyun_') && !key.includes(':')) return false;
    return accounts.some(account => account.id === id && account.enabled !== false);
  });
}

function layoutSlots(slots, columns = 3, rows = 2) {
  const result = [];
  let attempts=0;
  function place(index, occupied) {
    if (index === slots.length) return true;
    if(++attempts>4000) return false;
    const slot = slots[index];
    const vertical = slot.orientation ? slot.orientation === "vertical" : slot.kind === "radar";
    const shapes = slot.cells === 1 ? [[1,1]] : vertical ? [[1,2]] : [[2,1]];
    for (const [width,height] of shapes) for (let row=0;row<=rows-height;row++) for (let col=0;col<=columns-width;col++) {
      const cells = [];
      for(let y=row;y<row+height;y++) for(let x=col;x<col+width;x++) cells.push(y*columns+x);
      if(cells.some(cell=>occupied.has(cell))) continue;
      result[index] = {...slot, column:col+1, row:row+1, width, height};
      if(place(index+1,new Set([...occupied,...cells]))) return true;
    }
    return false;
  }
  return place(0,new Set()) ? result : [];
}
function responsiveLayout(slots, width, height, gap = 8) {
  let best = {slots:[], columns:1, rows:1, unit:0};
  if (!slots.length || width <= 0 || height <= 0) return best;
  const area = slots.reduce((sum, slot)=>sum+(slot.cells === 1 ? 1 : 2),0);
  const limit=Math.max(6,area);
  const candidates=[];
  for(let columns=1;columns<=limit;columns++) for(let rows=1;rows<=limit;rows++) {
    if(columns*rows<area) continue;
    const unit=Math.min((width-gap*(columns-1))/columns,(height-gap*(rows-1))/rows);
    if(unit<=0) continue;
    candidates.push({columns,rows,unit});
  }
  candidates.sort((a,b)=>b.unit-a.unit);
  for(const {columns,rows,unit} of candidates) {
    const placed=layoutSlots(slots,columns,rows);
    if(placed.length===slots.length) return {slots:placed,columns,rows,unit};
  }
  return best;
}
module.exports = { PLUGIN_ID, normalizeOverview, overviewDependencies, requiredCodingChannels, layoutSlots, responsiveLayout, codingChannelKeys };
