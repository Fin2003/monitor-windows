const crypto=require('node:crypto');
class Capture {
  constructor(id){this.id=id;this.offset=0;}
  accept(message){
    if(message.id!==this.id)return false;
    if(message.type==='capture_error')throw new Error(message.message);
    if(message.type==='capture_begin'){
      if(this.data)throw new Error('Duplicate capture header');
      const size=message.width===1024&&message.height===600||message.width===512&&message.height===300;
      if(!size||message.bytes!==message.width*message.height*2||message.format!=='rgb565le'||! /^[a-f0-9]{64}$/.test(message.sha256))throw new Error('Invalid capture header');
      this.meta=message;this.data=Buffer.alloc(message.bytes);return true;
    }
    if(message.type==='capture_chunk'){
      if(!this.data||message.offset!==this.offset||typeof message.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data))throw new Error('Invalid capture chunk');
      const chunk=Buffer.from(message.data,'base64');
      if(!chunk.length||chunk.length>768||this.offset+chunk.length>this.data.length)throw new Error('Capture bounds');
      chunk.copy(this.data,this.offset);this.offset+=chunk.length;return true;
    }
    if(message.type==='capture_end'){
      if(!this.data||this.offset!==this.data.length)throw new Error('Incomplete capture');
      const hash=crypto.createHash('sha256').update(this.data).digest('hex');
      if(hash!==this.meta.sha256)throw new Error('Capture checksum mismatch');
      this.complete=true;return true;
    }
    return false;
  }
  bmp(){
    if(!this.complete)throw new Error('Capture not verified');
    const {width:w,height:h}=this.meta,stride=w*3,out=Buffer.alloc(54+stride*h);
    out.write('BM');out.writeUInt32LE(out.length,2);out.writeUInt32LE(54,10);out.writeUInt32LE(40,14);
    out.writeInt32LE(w,18);out.writeInt32LE(h,22);out.writeUInt16LE(1,26);out.writeUInt16LE(24,28);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const pixel=this.data.readUInt16LE((y*w+x)*2),at=54+(h-1-y)*stride+x*3;
      out[at]=Math.round((pixel&31)*255/31);out[at+1]=Math.round(((pixel>>5)&63)*255/63);out[at+2]=Math.round(((pixel>>11)&31)*255/31);
    }
    return out;
  }
}
module.exports={Capture};
