// Enumerates USB descriptors only. Firmware hello confirms the selected board.
async function candidatePorts(SerialPort) {
  const ports = await SerialPort.list();
  return ports.filter(port => /^COM[1-9]\d*$/i.test(port.path) &&
    String(port.vendorId || '').toLowerCase() === '303a' &&
    ['1001', '0002'].includes(String(port.productId || '').toLowerCase()))
    .map(port => ({ path: port.path, label: `${port.path} · ${port.manufacturer || 'Espressif USB'}` }));
}
async function resolvePort(requested, SerialPort) {
  const candidates = await candidatePorts(SerialPort);
  if (requested && requested !== 'auto') return { port: requested, candidates, message: '' };
  if (candidates.length > 1) {
    const screens = [];
    for (const candidate of candidates) if (await isMonitorScreen(candidate.path, SerialPort)) screens.push(candidate);
    return { port: screens.length === 1 ? screens[0].path : '', candidates,
      message: screens.length > 1 ? '发现多个监控屏幕，请选择串口' : screens.length ? '' : '等待监控屏幕固件响应，可手动选择串口' };
  }
  return { port: candidates.length === 1 ? candidates[0].path : '', candidates,
    message: candidates.length > 1 ? '发现多个 ESP32，请选择串口' : candidates.length ? '' : '等待插入 ESP32 USB 设备' };
}
function isMonitorScreen(path, SerialPort) {
  const { Decoder } = require('./protocol.cjs');
  return new Promise(resolve => {
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false, hupcl: false });
    let done = false;
    const finish = matches => { if (done) return; done = true; clearTimeout(timer); if (port.isOpen) port.close(() => resolve(matches)); else resolve(matches); };
    const decoder = new Decoder(message => { if (message.type === 'hello' && message.board === 'ESP32-S3-Touch-LCD-5B' && message.width === 1024 && message.height === 600) finish(true); });
    const timer = setTimeout(() => finish(false), 3200);
    port.on('data', data => decoder.feed(data));
    port.on('error', () => finish(false));
    port.open(error => { if (error) finish(false); });
  });
}
module.exports = { candidatePorts, resolvePort };
