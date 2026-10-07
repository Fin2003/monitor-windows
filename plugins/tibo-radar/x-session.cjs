const {BrowserWindow}=require('electron');
class XSession {
  constructor(onClose){this.onClose=onClose;this.window=null;this.disposed=false;}
  async open(){
    if(this.window && !this.window.isDestroyed()){this.window.show();this.window.focus();return;}
    this.disposed=false;
    const win=new BrowserWindow({width:1050,height:820,title:'Tibo Radar - X',show:true,
      webPreferences:{partition:'persist:tibo-radar-public',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    this.window=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.on('closed',()=>{this.window=null;if(!this.disposed)this.onClose?.();});
    await win.loadURL('https://x.com/thsottiaux/with_replies?lang=en');
  }
  destroy(){this.disposed=true;this.window?.destroy();this.window=null;}
}
module.exports=XSession;
