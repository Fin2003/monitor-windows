const ID = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TARGETS = ['windows', 'esp32'];
const RESERVED = new Set(['coding-plan', 'system-monitor', 'tibo-radar', 'compact-overview', 'light-control']);

function validateManifest(item) {
  if (!ID.test(item.id) || RESERVED.has(item.id)) throw new Error('插件 ID 必须为独立的小写英文名称，不能覆盖内置插件');
  if (!VERSION.test(item.version) || !VERSION.test(item.minAppVersion)) throw new Error('版本格式应为 x.y.z');
  for (const key of ['name', 'description', 'author', 'license']) if (!item[key]?.trim()) throw new Error(`插件缺少 ${key}`);
  if (!['display', 'quota'].includes(item.kind)) throw new Error('插件类型应为 display 或 quota');
  if (!Array.isArray(item.targets) || !item.targets.length || item.targets.some(target => !TARGETS.includes(target))) throw new Error('请选择支持的 Windows / ESP32 版本');
  if (item.kind === 'display' && item.targets.includes('esp32')) throw new Error('HTML 显示插件只适用于 Windows；ESP32 使用额度查询插件或固件页面');
  if (new URL(item.repository).protocol !== 'https:') throw new Error('插件源码地址应为 HTTPS');
  return item;
}

function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) throw new Error('插件索引格式不正确');
  const ids = new Set();
  for (const item of catalog.plugins) {
    validateManifest(item);
    if (ids.has(item.id)) throw new Error('插件 ID 重复');
    ids.add(item.id);
    if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('请提供 ZIP 的 SHA256');
    if (new URL(item.downloadUrl).protocol !== 'https:') throw new Error('插件下载地址应为 HTTPS');
  }
  return catalog;
}

function atLeast(current, minimum) {
  const a = current.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}

module.exports = {validateManifest, validateCatalog, atLeast};
