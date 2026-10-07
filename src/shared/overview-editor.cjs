const {codingChannelKeys}=require('./compact-overview-config.cjs');
const cellCount = slots => slots.reduce((sum,s)=>sum+(s ? s.cells === 1 ? 1 : 2 : 0),0);

function reorderCards(slots, from, to) {
  const result=slots.filter(Boolean).map(s=>({...s}));
  if(from<0 || to<0 || from>=result.length || to>=result.length) return result;
  const [card]=result.splice(from,1);result.splice(to,0,card);
  return result;
}

function resizeCard(slots, index, edge, delta, unit) {
  const result=slots.filter(Boolean).map(s=>({...s}));
  if(!result[index] || !["left","right","top","bottom"].includes(edge)) return {slots:result,valid:false};
  const orientation=["left","right"].includes(edge) ? "horizontal" : "vertical";
  const outward=delta*(["left","top"].includes(edge)?-1:1);
  const threshold=Math.max(16,unit*.32);
  if(outward>threshold) result[index]={...result[index],cells:2,orientation};
  else if(outward < -threshold) result[index]={...result[index],cells:1};
  return {slots:result,valid:result.every(s=>s.kind!=='coding' || codingChannelKeys(s).length<=(s.cells || 2))};
}

function appendCodingCards(slots, keys) {
  const result=slots.filter(Boolean).map(s=>({...s}));
  const existing=new Set(result.filter(s=>s.kind==="coding").flatMap(codingChannelKeys));
  const additions=[...new Set(keys)].filter(key=>!existing.has(key));
  return [...result,...additions.map(channelKey=>({kind:"coding",channelKey,cells:1,orientation:"horizontal",fontScale:1,dataScale:1}))];
}
function appendSystemCard(slots,sensorId) {
  return [...slots.filter(Boolean),{kind:'system',sensorIds:sensorId ? [sensorId] : [],cells:1,orientation:'horizontal',fontScale:1,dataScale:1}];
}
module.exports={cellCount,reorderCards,resizeCard,appendCodingCards,appendSystemCard};
