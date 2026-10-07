// Adapted from CC Switch subscription_grok.rs (MIT), based on CodexBar's Grok billing parser.
const { QueryError, resetTime } = require('./coding-plan-api');

function parseBilling(data, now = Date.now()) {
  const bytes = Buffer.from(data), payloads = [], trailers = {};
  let cursor = 0;
  while (cursor + 5 <= bytes.length) {
    const flags = bytes[cursor], length = bytes.readUInt32BE(cursor + 1), end = cursor + 5 + length;
    if (end > bytes.length) { payloads.length = 0; break; }
    const payload = bytes.subarray(cursor + 5, end);
    if (flags & 128) {
      for (const line of payload.toString().split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index > 0) trailers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
    } else payloads.push(payload);
    cursor = end;
  }
  if (trailers['grpc-status'] && trailers['grpc-status'] !== '0') throw new QueryError('Grok 账单接口返回 gRPC 状态 ' + trailers['grpc-status'], trailers['grpc-status'] === '16' ? 'auth' : 'api');
  if (!payloads.length && bytes[0] >> 3 > 0 && [0, 1, 2, 5].includes(bytes[0] & 7)) payloads.push(bytes);
  const floats = [], integers = [];
  function scan(buffer, prefix = [], depth = 0) {
    let index = 0;
    const varint = () => { let value = 0, factor = 1; while (index < buffer.length) { const byte = buffer[index++]; value += (byte & 127) * factor; if (!(byte & 128)) return value; factor *= 128; } throw new Error('protobuf'); };
    try {
      while (index < buffer.length) {
        const tag = varint(), field = Math.floor(tag / 8), wire = tag & 7, path = [...prefix, field];
        if (!field) return;
        if (wire === 0) integers.push({ path, value: varint() });
        else if (wire === 1) index += 8;
        else if (wire === 2) { const length = varint(), end = index + length; if (end > buffer.length) return; if (depth < 4) scan(buffer.subarray(index, end), path, depth + 1); index = end; }
        else if (wire === 5) { if (index + 4 > buffer.length) return; floats.push({ path, value: buffer.readFloatLE(index), order: floats.length }); index += 4; }
        else return;
      }
    } catch (_) { /* Length-delimited strings are also scanned by the upstream generic parser. */ }
  }
  for (const payload of payloads) scan(payload);
  const percent = floats.filter(item => item.path.at(-1) === 1 && item.value >= 0 && item.value <= 100)
    .sort((a, b) => a.path.length - b.path.length || a.order - b.order)[0]?.value;
  const future = integers.filter(item => item.value > now / 1000 && item.value >= 1700000000 && item.value <= 2100000000);
  const exact = future.filter(item => item.path.join('.') === '1.5.1');
  const reset = Math.min(...(exact.length ? exact : future).map(item => item.value));
  const period = integers.some(item => item.path.slice(0, 2).join('.') === '1.6' || (item.path.join('.') === '1.8.1' && [1, 2].includes(item.value)));
  const utilization = percent ?? (!floats.length && Number.isFinite(reset) && period ? 0 : null);
  if (utilization === null) throw new QueryError('Grok 接口未返回可识别的个人订阅额度', 'schema');
  const days = Math.round((reset * 1000 - now) / 86400000);
  return { name: days >= 4 && days <= 12 ? 'weekly_limit' : days >= 20 && days <= 45 ? 'monthly' : 'credits', label: 'Grok credits', utilization, resetsAt: Number.isFinite(reset) ? resetTime(reset) : null };
}

async function queryGrok(accessToken, request) {
  const response = await request('https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', {
    method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + accessToken, Origin: 'https://grok.com', Referer: 'https://grok.com/?_s=usage', Accept: '*/*', 'Content-Type': 'application/grpc-web+proto', 'x-grpc-web': '1', 'x-user-agent': 'connect-es/2.1.1' }, body: new Uint8Array(5)
  });
  if (!response.ok) throw new QueryError('Grok 账单接口 HTTP ' + response.status, [401, 403].includes(response.status) ? 'auth' : 'api');
  if (Number(response.headers.get('grpc-status')) > 0) throw new QueryError('Grok 账单接口 gRPC ' + response.headers.get('grpc-status'), response.headers.get('grpc-status') === '16' ? 'auth' : 'api');
  return { tiers: [parseBilling(await response.arrayBuffer())] };
}
module.exports = { queryGrok };
