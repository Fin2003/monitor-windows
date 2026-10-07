const fs = require('node:fs');
const path = require('node:path');
const {validateCatalog, validateManifest} = require('../src/shared/plugin-catalog.cjs');

const target = path.resolve(process.argv[2] || path.join(__dirname, '../marketplace/index.json'));
const data = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
if (path.basename(target) === 'manifest.json') {
  validateManifest(data);
  const root = path.dirname(target);
  for (const name of ['LICENSE', ...(data.kind === 'quota' ? ['quota.json', 'query.js'] : ['index.html'])]) {
    if (!fs.statSync(path.join(root, name)).isFile()) throw new Error(`Missing ${name}`);
  }
  if (data.kind === 'quota') JSON.parse(fs.readFileSync(path.join(root, 'quota.json'), 'utf8'));
  console.log(`Valid plugin: ${data.id} ${data.version}`);
} else {
  validateCatalog(data);
  console.log(`Valid catalog: ${data.plugins.length} plugins`);
}
