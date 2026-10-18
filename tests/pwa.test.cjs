const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'www');

test('PWA manifest declares real install icons and a same-origin scope', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\.\//, ''))));
  assert.ok(fs.existsSync(path.join(root, 'icons/apple-touch-icon.png')));
});

test('PWA shell cache assets all exist in the web bundle', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\]\.map/)[1];
  const assets = [...shell.matchAll(/'\.\/([^']+)'/g)].map(match => match[1].split('?')[0]);
  assert.ok(assets.length >= 20);
  for (const asset of assets) assert.ok(fs.existsSync(path.join(root, asset)), `missing PWA shell asset: ${asset}`);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /serviceWorker\.register/);
});
