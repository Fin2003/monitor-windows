const fs = require('node:fs');
const path = require('node:path');
const { buildState } = require('../../plugins/tibo-radar/core.cjs');
const manualResets = require('./manual-resets.cjs');
class SourceMirror {
  constructor({profile=path.resolve(__dirname,'../../.device-profile'),project=path.resolve(__dirname,'../..'),deviceProfile=path.resolve(__dirname,'../../.device-profile')}={}) {
    this.paths={config:path.join(profile,'config.json'),radar:path.join(profile,'tibo-radar-state.json'),system:path.join(project,'plugins/system-monitor/runtime/sensor-cache.json'),translations:path.join(deviceProfile,'esp32-radar-translations.json'),
      manualResets:path.join(profile,manualResets.FILE_NAME),
      configFallback:path.join(deviceProfile,'config.json')};
    this.cache=new Map();this.errors=[];
  }
  load(file) {
    const cached=this.cache.get(file);
    try {
      const stat=fs.statSync(file);
      if(cached?.mtime===stat.mtimeMs&&cached?.size===stat.size)return cached.value;
      const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      this.cache.set(file,{mtime:stat.mtimeMs,size:stat.size,value});return value;
    }catch(error){this.errors.push(`${path.basename(file)}: ${error.code || 'invalid JSON'}`);return cached?.value || null;}
  }
  // The original runtime records lastAttempt every cycle; after failures it backs off up to 8x the
  // interval, so an attempt within that window (plus margin) still means it is running.
  radarRunning(meta,config,now){
    const last=Number(meta?.lastAttempt),interval=Math.max(60,Number(config?.intervalSeconds)||120)*1000;
    return !config?.paused&&Number.isFinite(last)&&now-last<=8*interval+5*60000;
  }
  snapshot(now=Date.now()) {
    this.errors=[];
    let config=this.load(this.paths.config);
    if(!config&&fs.existsSync(this.paths.configFallback)){config=this.load(this.paths.configFallback);if(config)this.errors.push('config.json: using .device-profile copy');}
    config=config||{};
    const saved=this.load(this.paths.radar)||{}, raw=this.load(this.paths.system);
    const rc=config.tiboRadar || {};
    const posts=[...(saved.posts || []),...manualResets.syntheticPosts(manualResets.load(this.paths.manualResets))].filter(p=>rc.repliesEnabled || !p.replyToId).map(p=>{
      if(!rc.repliesEnabled&&(p.analysis?.eta?.timeClass==='inferred'||p.analysis?.timeWindow?.sourcePostId))return {...p,analysis:{...p.analysis,eta:null,timeWindow:null,corroboration:null}};
      return p;
    });
    const radar={...buildState(posts,now,{useLLM:true}),config:rc,meta:{...saved.meta,running:this.radarRunning(saved.meta,rc,now),mirror:true}};
    let translations=null;
    try { if(fs.existsSync(this.paths.translations))translations=this.load(this.paths.translations); } catch (_) {}
    // Live engine data while Monitor's display window is closed and its sensor cache is stale (engine-reader.cjs).
    const live=this.engine?.current(raw,now);
    return {config,cache:config.providerCache||{},providers:[],system:live?{...live,cached:false}:raw?{...raw,fetchedAt:raw.savedAt||0,cached:true}:null,radar,translations,now};
  }
}
module.exports={SourceMirror};
