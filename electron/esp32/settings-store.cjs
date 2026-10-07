const fs=require('node:fs');
const path=require('node:path');
const {profile}=require('./profile.cjs');
const filename=path.join(profile,'esp32-display.json');
module.exports={
  readSettings(){try{return JSON.parse(fs.readFileSync(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}},
  writeSettings(data){fs.mkdirSync(profile,{recursive:true});const temp=filename+`.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,filename);}
};
