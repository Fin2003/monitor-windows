const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {app, dialog, nativeImage, BrowserWindow} = require('electron');

class ScreenAppearance {
  constructor(config) { this.config = config; this.file = path.join(app.getPath('userData'), 'screen-background.png'); }
  image() { return fs.existsSync(this.file) ? nativeImage.createFromPath(this.file) : null; }
  get() {
    const saved = this.config.get('screenAppearance') || {};
    const hasImage = !!this.image(), device = app.esp32Backend?.status();
    return {theme:saved.theme || this.config.get('theme') || 'dark', hasImage, revision:saved.revision || '', requiresFirmware:hasImage && !!device?.ready && !device.backgroundSupported};
  }
  render() { const image = this.image(); return {...this.get(), image:image ? image.toDataURL() : ''}; }
  bitmap() {
    const image = this.image();
    if (!image) return null;
    const pixels = image.resize({width:512,height:300,quality:'best'}).toBitmap();
    const rgb = Buffer.alloc(512 * 300 * 2);
    for (let i = 0; i < 512 * 300; i++) rgb.writeUInt16LE(((pixels[i*4+2]>>3)<<11)|((pixels[i*4+1]>>2)<<5)|(pixels[i*4]>>3),i*2);
    return rgb;
  }
  publish() {
    const appearance = this.render();
    app.esp32Backend?.setTheme(appearance.theme);
    app.esp32Backend?.setBackground(this.bitmap(), appearance.revision);
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('screen-appearance-change', appearance);
    return this.get();
  }
  theme(theme) {
    this.config.set('screenAppearance', {...this.config.get('screenAppearance'), theme:theme === 'light' ? 'light' : 'dark'});
    return this.publish();
  }
  async choose(parent) {
    const choice = await dialog.showOpenDialog(parent, {title:'选择屏幕背景图片', properties:['openFile'], filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','bmp']}]});
    if (choice.canceled) return this.get();
    const source = nativeImage.createFromPath(choice.filePaths[0]);
    if (source.isEmpty()) throw new Error('无法读取图片，请选择 PNG、JPEG、WebP 或 BMP');
    const size = source.getSize(), scale = Math.max(1024/size.width, 600/size.height);
    const resized = source.resize({width:Math.ceil(size.width*scale),height:Math.ceil(size.height*scale),quality:'best'});
    const dimensions = resized.getSize();
    const png = resized.crop({x:Math.floor((dimensions.width-1024)/2),y:Math.floor((dimensions.height-600)/2),width:1024,height:600}).toPNG();
    fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,png);
    this.config.set('screenAppearance', {...this.config.get('screenAppearance'), revision:crypto.createHash('sha256').update(png).digest('hex').slice(0,16)});
    return this.publish();
  }
  clear() { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); this.config.set('screenAppearance',{...this.config.get('screenAppearance'),revision:''}); return this.publish(); }
}
module.exports = {ScreenAppearance};
