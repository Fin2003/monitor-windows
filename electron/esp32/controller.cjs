const {buildViews,viewFrame}=require('./views.cjs');
const {DisplaySettings}=require('./display-settings.cjs');
const {dashboard}=require('./dashboard.cjs');
const {nativePage}=require('./native-pages.cjs');
const manualResets=require('./manual-resets.cjs');
const {displayTimeZone}=require('../../plugins/tibo-radar/presentation.cjs');
const {codingChannelKeys}=require('../../src/shared/compact-overview-config.cjs');
const {radarDetail}=require('./radar-detail.cjs');
const text=(value,max=72)=>[...String(value??'')].slice(0,max).join('');

function managerSummary({config={},sourceConfig=config,cache={},system=null,radar=null}={}) {
  const source=sourceConfig||config;
  const enabledAccounts=(source.channelAccounts||[]).filter(account=>account.enabled!==false);
  const channels=[...new Set(config.selectedProviders||[])];
  const selectedSensors=[...new Set(config.systemMonitor?.selectedSensors||[])];
  const radarConfig=radar?.config||config.tiboRadar||{};
  const accountChannels=source.accountChannels||{};
  const providerMeta={
    kimi:{kind:'Kimi Coding',subtitle:'CC Switch',description:'套餐接口用量追踪'},
    zhipu:{kind:'智谱 GLM',subtitle:'CC Switch',description:'国内 / 国际版套餐用量'},
    minimax:{kind:'MiniMax',subtitle:'CC Switch',description:'国内 / 国际版套餐用量'},
    zenmux:{kind:'ZenMux',subtitle:'CC Switch',description:'Management API 用量'},
    commandcode:{kind:'Command Code',subtitle:'CC Switch',description:'套餐接口用量追踪'},

    volcengine:{kind:'火山方舟',subtitle:'Volcengine ARK',description:'Coding Plan + Agent Plan 用量追踪'},
    opencodego:{kind:'opencode Go',subtitle:'opencode.ai',description:'用量追踪（GitHub / Google 登录）'},
    xfyun:{kind:'讯飞星火',subtitle:'Xfyun Spark',description:'套餐用量追踪'},
  };
  const accountType=account=>account.type||(account.id.startsWith('volcengine_')?'volcengine':account.id.startsWith('xfyun_')?'xfyun':'opencodego');
  const accounts=Object.keys(providerMeta).map(type=>{
    const account=enabledAccounts.find(candidate=>accountType(candidate)===type);
    const meta=providerMeta[type];
    if(!account)return {label:'无账号',kind:meta.kind,subtitle:meta.subtitle,description:meta.description,selected:0,available:0,status:'未配置'};
    const selected=channels.filter(key=>key.split(':')[0]===account.id).length;
    const available=[...new Set([...(accountChannels[account.id]||[]),...channels.filter(key=>key.split(':')[0]===account.id)])].length;
    const entry=cache?.[account.id];
    return {
      label:text(source.providerNames?.[account.id]||account.label||account.id,32),
      kind:meta.kind,subtitle:meta.subtitle,description:meta.description,selected,available,
      status:entry?.data?'已连接':entry?.error?'需重连':'未登录',
    };
  });
  const sensorMap=new Map((system?.sensors||[]).map(sensor=>[sensor.id,sensor]));
  const sensorNames=selectedSensors.slice(0,6).map(id=>{
    const sensor=sensorMap.get(id);
    return text(config.systemMonitor?.sensorAliases?.[id]||sensor?.zhName||sensor?.name||id,38);
  });
  const slots=(source.compactOverview?.slots||[]).filter(Boolean).slice(0,6).map((slot,index)=>{
    const kind=slot.kind==='coding'?'Coding Plan':slot.kind==='system'?'系统监控':slot.kind==='radar'?'Tibo 雷达':'空';
    const cells=slot.cells===1?'单格':slot.orientation==='vertical'?'竖双格':'横双格';
    return {index:index+1,kind,cells};
  });
  const allSensors=(system?.sensors||[]).filter(sensor=>sensor&&typeof sensor==='object');
  const selectedSet=new Set(selectedSensors);
  const favoriteSet=new Set(config.systemMonitor?.favoriteSensors||[]);
  const aliasMap=config.systemMonitor?.sensorAliases||{};
  const compactSensor=sensor=>({
    name:text(aliasMap[sensor.id]||sensor.zhName||sensor.name||sensor.id,34),
    type:text(sensor.zhType||sensor.type||'',18),
    value:text(sensor.value||'--',18),
    selected:selectedSet.has(sensor.id),
    favorite:favoriteSet.has(sensor.id),
  });
  const coreGroups=new Map();
  for(const sensor of allSensors) {
    const match=String(sensor.name||sensor.zhName||'').match(/(?:CPU\s*)?(?:Core|核心)\s*#(\d+)/i);
    if(!match)continue;
    const number=Number(match[1]);
    if(!Number.isFinite(number)||number<1||number>128)continue;
    if(!coreGroups.has(number))coreGroups.set(number,[]);
    coreGroups.get(number).push(sensor);
  }
  let previewGroups=[...coreGroups.entries()].sort((a,b)=>a[0]-b[0]).slice(0,3).map(([number,sensors])=>{
    const entries=sensors.slice(0,6);
    const primary=entries.find(sensor=>/load/i.test(sensor.type||'')&&new RegExp(`(?:Core|核心)\\s*#${number}(?:\\D|$)`,'i').test(sensor.name||sensor.zhName||''))||entries[0];
    return {
      label:`CPU 核心 #${number}`,
      selected:entries.filter(sensor=>selectedSet.has(sensor.id)).length,
      total:entries.length,
      primary:primary?text(aliasMap[primary.id]||primary.zhName||primary.name,30):'',
      primaryValue:primary?text(primary.value||'--',16):'',
      sensors:entries.map(compactSensor),
    };
  });
  let previewHardware='';
  let previewHardwareCount=allSensors.length;
  if(previewGroups.length) {
    const firstCore=[...coreGroups.values()][0]?.[0];
    const hardwareKey=firstCore?.hardwareRoot||firstCore?.hardware||firstCore?.zhHardwareRoot||firstCore?.zhHardware||'处理器';
    previewHardware=text(hardwareKey,46).replace(/^硬件\s*·\s*/, '');
    previewHardwareCount=allSensors.filter(sensor=>(sensor.hardwareRoot||sensor.hardware||sensor.zhHardwareRoot||sensor.zhHardware||'')===hardwareKey).length||allSensors.length;
  } else {
    const grouped=new Map();
    for(const sensor of allSensors){
      const hardware=sensor.hardwareRoot||sensor.hardware||sensor.zhHardwareRoot||sensor.zhHardware||'系统传感器';
      if(!grouped.has(hardware))grouped.set(hardware,[]);
      grouped.get(hardware).push(sensor);
    }
    const first=[...grouped.entries()].sort((a,b)=>b[1].length-a[1].length)[0];
    if(first){
      previewHardware=text(first[0],46).replace(/^硬件\s*·\s*/, '');
      previewHardwareCount=first[1].length;
      previewGroups=[{label:'传感器',selected:first[1].filter(sensor=>selectedSet.has(sensor.id)).length,total:Math.min(first[1].length,6),primary:'',primaryValue:'',sensors:first[1].slice(0,6).map(compactSensor)}];
    }
  }
  return {
    overview:{channels:channels.length,sensors:selectedSensors.length,slots:slots.length||3,layout:slots},
    coding:{accounts:enabledAccounts.length,channels:channels.length,items:accounts},
    system:{
      selected:selectedSensors.length,total:(system?.sensors||[]).length,
      backend:text(system?.backend||'LibreHardwareMonitor · Windows',52),
      refreshInterval:Number(config.systemMonitor?.refreshInterval)||5,
      language:config.systemMonitor?.sensorLanguage==='en'?'English':'中文',
      colorMode:config.systemMonitor?.colorMode==='device'?'按硬件设备':'按类型',
      names:sensorNames,
      preview:{hardware:previewHardware,count:previewHardwareCount,groups:previewGroups},
    },
    radar:{
      provider:radarConfig.analysisProvider==='jev'?'JEV':'LLM',
      repliesEnabled:radarConfig.repliesEnabled===true,
      intervalSeconds:Number(radarConfig.intervalSeconds)||120,
      timezone:text(radarConfig.displayTimeZone||'Asia/Shanghai',40),
      paused:radarConfig.paused===true,
      running:radar?.meta?.running===true,
    },
  };
}
class DisplayController {
  constructor({readSettings,writeSettings,source,mode='mirror',manualFile=manualResets.DEFAULT_FILE}) {
    this.manualFile=manualFile;
    this.settings=new DisplaySettings(readSettings,writeSettings);this.source=source;this.mode=mode;this.page=0;this.seq=0;
    this.current={config:{},system:null};this.views=buildViews();
  }
  update(){this.current=this.source();this.applyRadarZone();const config=this.settings.config(this.current.config);this.views=buildViews({...this.current,config,prefs:this.settings.data.prefs});this.page=Math.min(this.page,this.views.length-1);}
  frame(){this.update();const config=this.settings.config(this.current.config);const frame={...viewFrame(this.views,this.page,++this.seq,this.mode),prefs:this.settings.data.prefs,
      manager:managerSummary({...this.current,config,sourceConfig:this.current.config})};
    frame.menu=this.views.flatMap((v,i)=>this.views.findIndex(p=>p.group===v.group)===i?[{group:v.group,page:i}]:[]);
    if(frame.group==='overview'){
      const slots=(this.current.config.compactOverview?.slots||[]).filter(Boolean);
      if(!Array.isArray(this.settings.data.channels))config.selectedProviders=[...new Set([...slots.filter(s=>s.kind==='coding').flatMap(codingChannelKeys),...config.selectedProviders])];
      if(!Array.isArray(this.settings.data.sensors))config.systemMonitor.selectedSensors=[...new Set([...slots.filter(s=>s.kind==='system').flatMap(s=>s.sensorIds||[]),...config.systemMonitor.selectedSensors])];
      frame.dashboard=dashboard({...this.current,config});
    } else frame.nativePage=nativePage(frame.group,{...this.current,config});
    const radarView=frame.dashboard?.radar||(frame.nativePage?.type==='radar'?frame.nativePage:null);
    if(radarView)radarView.manual=manualResets.pickerInfo({radar:this.current.radar,now:this.current.now||Date.now(),timeZone:this.radarZone(),list:manualResets.load(this.manualFile)});
    return frame;
  }
  // The editor's Radar time zone only changes what the ESP32 shows.
  applyRadarZone(){const zone=this.settings.data.radarTimeZone,radar=this.current.radar;if(zone&&radar)this.current.radar={...radar,config:{...radar.config,displayTimeZone:zone}};}
  radarZone(){return displayTimeZone(this.current.radar?.config?.displayTimeZone);}
  navigate(page){if(!Number.isInteger(page))throw new Error('Invalid page');this.page=Math.max(0,Math.min(this.views.length-1,page));}
  command(message) {
    this.update();const {config,system}=this.current;
    if(message.type==='prefs'){const before=JSON.stringify(this.settings.data.prefs);this.settings.preferences(message.prefs);if(before!==JSON.stringify(this.settings.data.prefs))this.page=0;return {v:1,type:'prefs_ack',revision:message.revision||0};}
    if(message.type==='catalog_request')return this.settings.page(config,system,message.kind,message.offset,message.onlySelected===true);
    if(message.type==='select') {
      this.settings.select(config,system,message.kind,message.id,message.enabled);
      return this.settings.page(config,system,message.kind,message.offset,message.onlySelected===true);
    }
    if(message.type==='radar_manual_reset'){
      try{
        if(message.action==='undo'){manualResets.undo(message.id,{file:this.manualFile});return {v:1,type:'radar_manual_ack',ok:true,message:'已撤销手动标记'};}
        manualResets.mark({date:message.date,hour:message.hour,minute:message.minute,kind:message.kind},{radar:this.current.radar,now:Date.now(),timeZone:this.radarZone(),file:this.manualFile});
        return {v:1,type:'radar_manual_ack',ok:true,message:message.kind==='banked'?'已标记 Banked 重置':'已标记 Hard 重置'};
      }catch(error){return {v:1,type:'radar_manual_ack',ok:false,message:String(error.message).slice(0,80)};}
    }
    if(message.type==='radar_detail_request')return radarDetail({radar:this.current.radar,translations:this.current.translations,mode:message.mode,id:message.id,now:this.current.now});
    throw new Error('Unsupported device command');
  }
}
module.exports={DisplayController,managerSummary};
