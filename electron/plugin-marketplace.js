const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const extract = require('extract-zip');
const {app, session, dialog} = require('electron');
const {validateCatalog, validateManifest, atLeast} = require('../src/shared/plugin-catalog.cjs');

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/Fin2003/monitor-windows/main/marketplace/index.json';
const CONTRIBUTING = 'https://github.com/Fin2003/monitor-windows/blob/main/docs/plugins.md';
const hostVariant = () => require('../package.json').name.includes('esp32') ? 'esp32' : 'windows';

class PluginMarketplace {
  constructor(configStore, pluginManager) { this.config = configStore; this.manager = pluginManager; }
  source() { return this.config.get('pluginMarketplaceUrl') || DEFAULT_SOURCE; }
  async fetch(url) {
    if (new URL(url).protocol !== 'https:') throw new Error('市场与下载地址必须使用 HTTPS');
    const response = await session.fromPartition('monitor-plugin-marketplace').fetch(url, {credentials: 'omit'});
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络与插件发布地址`);
    return response;
  }
  async list() {
    const catalog = validateCatalog(await (await this.fetch(this.source())).json());
    const variant = hostVariant(), version = require('../package.json').version;
    const installed = new Map(this.manager.getPluginList().filter(plugin => plugin.type === 'user').map(plugin => [plugin.id, plugin]));
    return {source: this.source(), variant, contributing: CONTRIBUTING, plugins: catalog.plugins.map(plugin => {
      const local = installed.get(plugin.id);
      return {...plugin, installedVersion: local?.version || null, compatible: plugin.targets.includes(variant) && atLeast(version, plugin.minAppVersion), updateAvailable: !!local && local.version !== plugin.version};
    })};
  }
  async setSource(url) {
    const source = String(url).trim() || DEFAULT_SOURCE;
    validateCatalog(await (await this.fetch(source)).json());
    this.config.set('pluginMarketplaceUrl', source);
    return true;
  }
  async install(id) {
    const listing = await this.list();
    const item = listing.plugins.find(plugin => plugin.id === id);
    if (!item?.compatible) throw new Error('此插件不适用于当前版本，请查看兼容范围');
    const bytes = Buffer.from(await (await this.fetch(item.downloadUrl)).arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('插件下载内容与索引校验值不一致，请作者更新发布信息');
    return this.installBytes(bytes, item);
  }
  async installLocal(parent) {
    const selected = await dialog.showOpenDialog(parent, {title: '安装本地插件 ZIP', filters: [{name: 'Monitor 插件', extensions: ['zip']}], properties: ['openFile']});
    if (selected.canceled) return {canceled: true};
    return this.installBytes(fs.readFileSync(selected.filePaths[0]));
  }
  async installBytes(bytes, expected) {
    const temporaryRoot = path.join(app.getPath('userData'), '.plugin-downloads');
    fs.mkdirSync(temporaryRoot, {recursive: true});
    const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'install-'));
    const archive = path.join(temporary, 'plugin.zip'), output = path.join(temporary, 'package');
    fs.writeFileSync(archive, bytes);
    try {
      await extract(archive, {dir: output, onEntry: entry => {
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('插件包应包含实际文件，不能包含符号链接');
      }});
      let root = output;
      if (!fs.existsSync(path.join(root, 'manifest.json'))) {
        const folders = fs.readdirSync(root, {withFileTypes: true}).filter(item => item.isDirectory());
        if (folders.length !== 1) throw new Error('ZIP 根目录或单一子目录需要 manifest.json');
        root = path.join(root, folders[0].name);
      }
      const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')));
      if (!manifest.targets.includes(hostVariant()) || !atLeast(require('../package.json').version, manifest.minAppVersion)) throw new Error('插件不支持当前应用版本');
      if (expected && ['id', 'version', 'kind', 'license', 'repository'].some(key => manifest[key] !== expected[key])) throw new Error('插件包与索引声明不一致');
      const result = this.manager.install(root);
      if (result.error) throw new Error(result.error);
      return {...result, kind: manifest.kind, name: manifest.name, providerId: 'custom_' + manifest.id, ...(manifest.kind === 'quota' ? {query: JSON.parse(fs.readFileSync(path.join(root, 'quota.json'), 'utf8')), script: fs.readFileSync(path.join(root, 'query.js'), 'utf8')} : {})};
    } finally {
      if (!path.resolve(temporary).startsWith(path.resolve(temporaryRoot) + path.sep)) throw new Error('下载临时目录超出本地数据范围');
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  }
}

module.exports = {PluginMarketplace, DEFAULT_SOURCE};
