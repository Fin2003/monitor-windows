const routes = { chat: '/chat/completions', responses: '/responses', anthropic: '/messages', evaluate: '/evaluate' };

function normalize(value) {
  const format = value.format || 'chat';
  if (!routes[format]) throw new Error('不支持的 API 格式');
  let url;
  try { url = new URL(String(value.baseUrl || '').trim()); } catch { throw new Error('请输入完整的 HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('URL 不得包含账号、查询参数或片段');
  const baseUrl = url.href.replace(/\/+$/, '');
  const model = String(value.model || '').trim();
  if (!model) throw new Error('请输入模型名');
  const path = url.pathname.replace(/\/+$/, '');
  const existing = Object.values(routes).find(route => path.endsWith(route));
  if (existing && existing !== routes[format]) throw new Error('URL 端点与 API 格式不匹配');
  const endpoint = existing ? baseUrl : baseUrl + (path ? '' : '/v1') + routes[format];
  return { name: String(value.name || '').trim(), baseUrl, format, model, endpoint };
}

class ModelConnection {
  constructor(store, secure, fetchImpl = fetch) {
    this.store = store;
    this.secure = secure;
    this.fetch = fetchImpl;
    this.busy = false;
  }
  get() {
    const c = this.store.get('tiboRadarModel') || {};
    return { name: c.name || '', baseUrl: c.baseUrl || '', format: c.format || 'chat', model: c.model || '', hasApiKey: !!c.encryptedKey };
  }
  resolve(value) {
    const config = normalize(value);
    const saved = this.store.get('tiboRadarModel') || {};
    let key = String(value.apiKey || '').trim();
    if (!key && !value.clearKey && saved.encryptedKey) {
      if (config.baseUrl !== saved.baseUrl || config.format !== saved.format) throw new Error('更换地址或格式后，请重新输入 API Key，或勾选清除已保存密钥');
      try { key = this.secure.decryptString(Buffer.from(saved.encryptedKey, 'base64')); }
      catch { throw new Error('已保存密钥无法解密，请重新输入'); }
    }
    return { config, key };
  }
  save(value) {
    const { config, key } = this.resolve(value);
    if (key && !this.secure.isEncryptionAvailable()) throw new Error('系统加密不可用，未保存 API Key');
    const { endpoint, ...stored } = config;
    this.store.set('tiboRadarModel', { ...stored, encryptedKey: key ? this.secure.encryptString(key).toString('base64') : '' });
    return this.get();
  }
  async test(value) {
    if (this.busy) return { ok: false, error: '测试正在进行中' };
    this.busy = true;
    let key = '';
    const started = Date.now();
    const clean = text => (key ? String(text).split(key).join('[REDACTED]') : String(text)).slice(0, 4000);
    try {
      const resolved = this.resolve(value);
      key = resolved.key;
      const c = resolved.config;
      const headers = { 'content-type': 'application/json' };
      let body = { model: c.model, messages: [{ role: 'user', content: '你好' }], stream: false };
      if (c.format === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01';
        if (key) headers['x-api-key'] = key;
        body.max_tokens = 256;
      } else {
        if (key) headers.authorization = `Bearer ${key}`;
        if (c.format === 'responses') body = { model: c.model, input: '你好', stream: false };
        if (c.format === 'evaluate') body = { model: c.model, state: '你好', questions: { greeting: { type: 'boolean', instructions: 'Is the state a greeting?' } } };
      }
      const response = await this.fetch(c.endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
      const json = await response.json();
      let text;
      if (c.format === 'chat') text = json.choices?.[0]?.message?.content;
      else if (c.format === 'anthropic') text = json.content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
      else if (c.format === 'evaluate') {
        const probability = json.answers?.greeting?.probability;
        if (typeof probability !== 'number' || probability < 0 || probability > 1) throw new Error('接口未返回有效的问候概率');
        text = `问候概率 ${Math.round(probability * 100)}%`;
      }
      else text = json.output?.flatMap(p => p.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('\n');
      if (typeof text !== 'string' || !text.trim()) throw new Error('接口未返回可读取的文本回复');
      return { ok: true, text: clean(text), status: response.status, elapsedMs: Date.now() - started };
    } catch (error) {
      return { ok: false, error: clean(error.message), elapsedMs: Date.now() - started };
    } finally { this.busy = false; }
  }
  async extract(prompt, signal, timeoutMs = 60000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw new Error('模型请求超时时间无效');
    const { config: c, key } = this.resolve(this.get());
    if (c.format === 'evaluate') throw new Error('JEV 评估接口不提供 JSON 文本提取');
    const headers = { 'content-type': 'application/json' };
    const messages = [{ role: 'user', content: prompt }];
    let body = { model: c.model, messages, stream: false, response_format: { type: 'json_object' } };
    if (c.format === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
      body = { model: c.model, messages, max_tokens: 2048, stream: false };
    } else {
      if (key) headers.authorization = `Bearer ${key}`;
      if (c.format === 'responses') body = { model: c.model, input: prompt, stream: false, text: { format: { type: 'json_object' } } };
    }
    // Classification needs bounded reasoning; GLM defaults can exceed the polling deadline.
    if (/^glm-/i.test(c.model)) {
      if (c.format === 'responses') body.reasoning = { effort: 'low' };
      else if (c.format === 'chat') body.reasoning_effort = 'low';
    }
    try {
      const response = await this.fetch(c.endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`模型 HTTP ${response.status}`);
      const json = await response.json();
      const text = c.format === 'chat' ? json.choices?.[0]?.message?.content : c.format === 'anthropic' ? json.content?.filter(p => p.type === 'text').map(p => p.text).join('\n') : json.output?.flatMap(p => p.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('\n');
      if (typeof text !== 'string') throw Object.assign(new Error('模型未返回 JSON 文本'), { code: 'INVALID_MODEL_OUTPUT' });
      try { return JSON.parse(text); } catch { throw Object.assign(new Error('模型返回的内容不是有效 JSON'), { code: 'INVALID_MODEL_OUTPUT' }); }
    } catch (error) {
      throw Object.assign(new Error(key ? String(error.message).split(key).join('[REDACTED]') : error.message), { code: error.code });
    }
  }
  async evaluate(state, questions, signal, timeoutMs = 15000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw new Error('模型请求超时时间无效');
    const { config: c, key } = this.resolve(this.get());
    if (c.format !== 'evaluate') throw new Error('模型不是评估接口');
    if (!key) throw new Error('请先保存 JEV API Key');
    try {
      const response = await this.fetch(c.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: c.model, state, questions }), redirect: 'error', credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`JEV HTTP ${response.status}`);
      const result = await response.json();
      if (!result || typeof result.answers !== 'object') throw new Error('JEV 未返回评估结果');
      return result;
    } catch (error) {
      throw new Error(key ? String(error.message).split(key).join('[REDACTED]') : error.message);
    }
  }
}

// Keep model credentials independent of the running application's config snapshot.
function createModelStore(file, legacy) {
  const fs = require('node:fs');
  return {
    get() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return legacy?.get('tiboRadarModel'); } },
    set(_key, value) { fs.mkdirSync(require('node:path').dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2)); fs.renameSync(`${file}.tmp`, file); }
  };
}
module.exports = { ModelConnection, normalize, createModelStore };
