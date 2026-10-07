const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { QueryError } = require('./coding-plan-api');

function parseCliAuth(type, value) {
  if (type === 'claude') {
    const oauth = value.claudeAiOauth || value;
    return { accessToken: oauth.accessToken, refreshToken: oauth.refreshToken, expiresAt: oauth.expiresAt };
  }
  if (type === 'codex') {
    if (value.auth_mode !== 'chatgpt' || !value.tokens?.access_token) throw new QueryError('请选择 Codex 的 ChatGPT 登录文件；API Key 模式没有官方订阅配额', 'auth');
    return { accessToken: value.tokens.access_token, refreshToken: value.tokens.refresh_token, accountId: value.tokens.account_id };
  }
  if (type === 'gemini') {
    const token = value.token || value;
    return { accessToken: token.access_token || token.accessToken, refreshToken: token.refresh_token || token.refreshToken, expiresAt: token.expiry_date || token.expiresAt };
  }
  if (type === 'grok') {
    const entries = Object.entries(value);
    const selected = entries.find(([key, entry]) => key.startsWith('https://auth.x.ai::') && entry.key)
      || entries.find(([key, entry]) => key === 'https://accounts.x.ai/sign-in' && entry.key);
    const entry = selected?.[1] || value;
    return { accessToken: entry.key || entry.access_token || entry.accessToken, refreshToken: entry.refresh_token, expiresAt: entry.expires_at ? Date.parse(entry.expires_at) : null };
  }
  throw new QueryError('此渠道不使用 CLI 登录文件', 'auth');
}

async function importCliAuth(provider) {
  const { dialog } = require('electron');
  const files = { claude: ['.claude', '.credentials.json'], codex: ['.codex', 'auth.json'], gemini: ['.gemini', 'oauth_creds.json'], grok: ['.grok', 'auth.json'] };
  const parts = files[provider.type];
  const defaultPath = provider.type === 'codex' && process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, 'auth.json') : path.join(os.homedir(), ...parts);
  const chosen = await dialog.showOpenDialog({ title: '选择此账号的 CLI 登录文件', defaultPath, properties: ['openFile'], filters: [{ name: '登录 JSON', extensions: ['json'] }] });
  if (chosen.canceled) return { canceled: true };
  const credentialFile = chosen.filePaths[0];
  const auth = parseCliAuth(provider.type, JSON.parse(fs.readFileSync(credentialFile, 'utf8')));
  if (!auth.accessToken) throw new QueryError('文件没有此渠道的 OAuth 登录凭据', 'auth');
  provider.authStore.remove(provider.id);
  provider.authStore.write(provider.id, { ...auth, credentialFile, importedAccessToken: auth.accessToken });
  return { success: true, ...provider.authStore.flags(provider.id) };
}

function readAccountAuth(provider) {
  const stored = provider.authStore.read(provider.id);
  if (stored.credentialFile) {
    const auth = parseCliAuth(provider.type, JSON.parse(fs.readFileSync(stored.credentialFile, 'utf8')));
    // A refresh token rotation saved by Monitor takes precedence until the CLI updates its file.
    if (auth.accessToken !== stored.importedAccessToken) {
      const updated = { ...stored, ...auth, importedAccessToken: auth.accessToken };
      provider.authStore.write(provider.id, updated);
      return updated;
    }
  }
  return stored;
}

module.exports = { parseCliAuth, importCliAuth, readAccountAuth };
