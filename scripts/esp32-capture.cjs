const fs=require('node:fs');
const path=require('node:path');
const {SerialPort}=require('serialport');
const {DeviceTransport}=require('../electron/esp32/transport.cjs');
const {DisplayController}=require('../electron/esp32/controller.cjs');
const {SourceMirror}=require('../electron/esp32/source-mirror.cjs');
const {Capture}=require('../electron/esp32/capture.cjs');
const settingsStore=require('../electron/esp32/settings-store.cjs');
const arg=(key,fallback)=>process.argv.find(s=>s.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const port=arg('port','');if(!/^COM[1-9]\d*$/i.test(port))throw new Error('Explicit --port required');
const buffer=Number(arg('buffer','-1'));if(![-1,0,1,2].includes(buffer))throw new Error('Invalid buffer');
const output=path.resolve(arg('output','artifacts/esp32/device-capture.bmp'));
const rawLog=arg('raw-log','');
const mirror=new SourceMirror(),controller=new DisplayController({...settingsStore,source:()=>mirror.snapshot()});
const capture=new Capture(1);let acks=0,requested=false,finished=false;
let screenStableAt=0;
const started=Date.now(),page=Number(arg('page','0'));
const screen=arg('screen','');
const detail=arg('detail','');
const detailId=arg('detail-id','');
// --manual opens the Radar reset marker (only while a reset is pending) before capturing.
const manual=process.argv.includes('--manual');
const screens={plugins:-1,settings:-1,overview:0,coding:1,system:2,radar:3,close:null};
if(screen&&!(screen in screens))throw new Error('Invalid screen');
if(detail&&!['post','status','resets'].includes(detail))throw new Error('Invalid detail');
if(detailId&&detail!=='post')throw new Error('--detail-id requires --detail=post');
let detailSent=false,detailTimer=null;
const transport=new DeviceTransport({port,SerialPort,
  onData:data=>{if(rawLog)fs.appendFileSync(rawLog,data);},
  getFrame:()=>{controller.update();controller.navigate(page);return controller.frame();},
  onNavigate:p=>controller.navigate(p),onCommand:m=>controller.command(m),
  onMessage(message){
    try{
      if(message.type==='ack'){
        acks++;
        const expected=screen?screens[screen]:undefined;
        const correct=!screen||(screen==='close'
          ? transport.diagnostics?.settingsOpen===false
          : transport.diagnostics?.settingsOpen===true&&transport.diagnostics?.settingsPage===expected);
        if(!correct){screenStableAt=0;transport.replies.push({v:1,type:'ui',action:screen});setImmediate(()=>transport.tick());}
        else if(!screenStableAt)screenStableAt=Date.now();
      }
      if(message.type==='ack'&&acks>=5&&screenStableAt&&Date.now()-screenStableAt>=2000&&!requested){
        if(manual&&!detailSent){
          detailSent=true;transport.paused=true;transport.replies.push({v:1,type:'ui',action:'manual'});
          const sentAt=Date.now();setImmediate(()=>transport.tick());waitForDetailOpen(sentAt+1500,sentAt+6000);
        } else if(detail&&!detailSent){
          const frame=controller.frame();
          const postId=detailId||frame.dashboard?.radar?.posts?.[0]?.id||frame.nativePage?.posts?.[0]?.id||'';
          if(detail==='post'&&!postId)throw new Error('No radar post available for detail capture');
          const response=controller.command({type:'radar_detail_request',mode:detail,id:postId});
          detailSent=true;transport.paused=true;transport.replies.push(response);
          console.error(`Sending ${detail} detail (${Buffer.byteLength(JSON.stringify(response),'utf8')} bytes)`);
          const sentAt=Date.now();setImmediate(()=>transport.tick());waitForDetailOpen(sentAt+2500,sentAt+6000);
        } else if(!detail&&!manual) requestCapture();
      }
      const handled=capture.accept(message);
      if(capture.complete&&!finished){
        fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,capture.bmp());
        fs.writeFileSync(output+'.json',JSON.stringify({capturedAt:new Date().toISOString(),elapsedMs:Date.now()-started,device:transport.diagnostics,capture:capture.meta,sourceErrors:mirror.errors},null,2));
        console.log(JSON.stringify({verified:true,output,bytes:capture.offset,source:capture.meta.source,buffer,sha256:capture.meta.sha256}));finish(0);
      }
      return handled;
    }catch(error){console.error(error.message);finish(1);return true;}
  },log:message=>console.error(message)
});
function waitForDetailOpen(notBefore,deadline){
  clearTimeout(detailTimer);
  detailTimer=setTimeout(()=>{
    if(finished)return;
    const open=manual?transport.diagnostics?.manualOpen:transport.diagnostics?.detailOpen,name=manual?'reset marker':detail+' detail';
    if(Date.now()>=notBefore&&open){console.error(`${name} is open and settled`);requestCapture();return;}
    if(Date.now()>=deadline){console.error(`${name} did not open`);finish(1);return;}
    waitForDetailOpen(notBefore,deadline);
  },100);
}
function requestCapture(){
  if(finished||requested)return;
  if(!transport.diagnostics?.capture){console.error('Firmware does not support capture');finish(1);return;}
  requested=true;transport.paused=true;transport.replies.push({v:1,type:'capture',id:1,buffer});setImmediate(()=>transport.tick());
}
function finish(code){if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(detailTimer);transport.stop();process.exitCode=code;}
const timeout=setTimeout(()=>{console.error('Capture timed out');finish(1);},120000);
transport.start();
process.on('SIGINT',()=>finish(1));
