const fs = require('node:fs');
const path = require('node:path');
const { app, net, safeStorage } = require('electron');
const { ModelConnection } = require('../plugins/tibo-radar/model-connection.cjs');
const { buildState } = require('../plugins/tibo-radar/core.cjs');
const { latestRadarPosts } = require('../plugins/tibo-radar/presentation.cjs');
const { textHash } = require('../electron/esp32/radar-detail.cjs');

const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const sourceProfile = path.resolve(argument('source-profile', require('../electron/esp32/profile.cjs').profile));
const deviceProfile = path.resolve(argument('device-profile', require('../electron/esp32/profile.cjs').profile));
fs.mkdirSync(deviceProfile, { recursive: true });
const translationProfile = path.join(deviceProfile, 'translation-worker');
fs.mkdirSync(translationProfile, { recursive: true });
const sourceLocalState = path.join(sourceProfile, 'Local State');
if (fs.existsSync(sourceLocalState)) fs.copyFileSync(sourceLocalState, path.join(translationProfile, 'Local State'));
app.setName('Monitor ESP32 Translation');
app.setPath('userData', translationProfile);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

app.whenReady().then(async () => {
  const output = path.join(deviceProfile, 'esp32-radar-translations.json');
  const cache = readJson(output, { version: 1, items: {}, meta: {} });
  cache.version = 1; cache.items ||= {}; cache.meta ||= {}; cache.meta.lastAttempt = Date.now();
  try {
    const state = readJson(path.join(sourceProfile, 'tibo-radar-state.json'));
    const modelConfig = readJson(path.join(sourceProfile, 'tibo-radar-model.json'));
    if (!state || !modelConfig?.encryptedKey) throw new Error('Windows Tibo 翻译模型未配置');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储不可用');
    const snapshot = buildState(state.posts || [], Date.now(), { useLLM: true });
    const posts = latestRadarPosts(snapshot).slice(0, 12);
    const missing = posts.filter(post => cache.items[post.id]?.sourceHash !== textHash(post.text)).slice(0, 4);
    if (missing.length) {
      const model = new ModelConnection({ get: () => modelConfig }, safeStorage, (url, options) => net.fetch(url, options));
      const input = missing.map(post => ({ id: String(post.id), text: String(post.text || '') }));
      const prompt = [
        '把下列英文 X 帖子忠实翻译成简体中文。保留段落、@用户名、产品名、数字、时间与语气；不要总结，不要解释。',
        '只返回 JSON 对象，格式为 {"translations":[{"id":"原 id","text":"完整中文译文"}]}。',
        JSON.stringify(input),
      ].join('\n');
      const result = await model.extract(prompt, null, 120000);
      if (!Array.isArray(result?.translations)) throw new Error('翻译模型未返回 translations 数组');
      const byId = new Map(result.translations.map(item => [String(item?.id || ''), String(item?.text || '').trim()]));
      for (const post of missing) {
        const translated = byId.get(String(post.id));
        if (!translated) continue;
        cache.items[post.id] = { sourceHash: textHash(post.text), text: translated, translatedAt: Date.now() };
      }
    }
    const keep = new Set(posts.slice(0, 32).map(post => String(post.id)));
    for (const id of Object.keys(cache.items)) if (!keep.has(id)) delete cache.items[id];
    cache.meta.updatedAt = Date.now(); cache.meta.lastError = '';
    writeJson(output, cache);
    app.exit(0);
  } catch (error) {
    cache.meta.lastError = String(error?.message || error).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 300);
    writeJson(output, cache);
    app.exit(1);
  }
});
