const { StringDecoder } = require('node:string_decoder');
const MAX_LINE = 16384;
function encode(message) {
  const data = Buffer.from(JSON.stringify(message) + '\n');
  if (data.length > MAX_LINE) throw new Error('ESP32 frame exceeds 16KB');
  return data;
}
class Decoder {
  constructor(onMessage) { this.onMessage = onMessage; this.reset(); }
  reset() { this.decoder = new StringDecoder('utf8'); this.line = ''; this.dropping = false; }
  feed(data) {
    for (const part of this.decoder.write(data).split(/(?<=\n)/)) {
      if (!this.dropping) this.line += part;
      if (Buffer.byteLength(this.line) > MAX_LINE) { this.line = ''; this.dropping = true; }
      if (!part.endsWith('\n')) continue;
      if (!this.dropping) {
        try { const message = JSON.parse(this.line); if (message?.v === 1) this.onMessage(message); } catch (_) {}
      }
      this.line = ''; this.dropping = false;
    }
  }
}
module.exports = { Decoder, encode, MAX_LINE };
