const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const read = (name) => fs.readFileSync(path.join(www, name), 'utf8');

test('字体选择脚本已接入页面与离线壳，并挂了内置字体样式', () => {
  const html = read('index.html');
  assert.match(html, /reader-font-choice\.js/, '未在 index.html 引入');
  assert.match(html, /fonts\/fonts\.css/, '没有挂内置字体样式表');
  assert.ok(fs.existsSync(path.join(www, 'reader-font-choice.js')));
  assert.match(read('sw.js'), /reader-font-choice\.js/);
});

test('系统字体保底五种，不依赖任何文件', () => {
  const source = read('reader-font-choice.js');
  for (const family of ['Songti SC', 'Kaiti SC', 'Yuanti SC', 'PingFang SC']) {
    assert.ok(source.includes(family), '缺少字体族 ' + family);
  }
  assert.equal((source.match(/id: 'sys-[a-z]+'/g) || []).length, 5, '系统字体应为五个');
});

test('内置字体按清单加载，清单缺失时安静回退', () => {
  const source = read('reader-font-choice.js');
  assert.match(source, /fonts\/manifest\.json/, '没有读取内置字体清单');
  assert.match(source, /optgroup label="内置字体/, '没有分组显示内置字体');
  assert.match(source, /catch \{\}/, '清单加载失败时应静默回退');
});

test('换字体后正文跟着变，且分页模式会重新分页', () => {
  const source = read('reader-font-choice.js');
  assert.match(source, /--reader-font/, '没有写入 CSS 变量');
  assert.match(source, /getReadingState/, '没有读取分页状态');
  assert.match(source, /renderReaderContent/, '换字体后没有重新分页');
  assert.match(source, /setReaderPage/, '重新分页后没有回到原位置');
  assert.match(read('styles.css'), /\.reader-content\{font-family:var\(--reader-font,var\(--serif\)\)\}/);
});

test('字体选择会被记住，且与字号主题同一套 localStorage 习惯', () => {
  const source = read('reader-font-choice.js');
  assert.match(source, /localStorage\.getItem\(KEY\)/);
  assert.match(source, /localStorage\.setItem\(KEY, font\)/);
  assert.match(source, /zhijian\.readerFont/, '应沿用 zhijian.* 前缀');
});

test('内置字体清单存在时，每个字体都有真实文件且是 woff2', () => {
  const manifestPath = path.join(www, 'fonts', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return; // 还没跑字体流水线时跳过
  const rows = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(rows.length >= 3, '内置字体少于 3 个');
  for (const row of rows) {
    const file = path.join(www, 'fonts', row.file);
    assert.ok(fs.existsSync(file), '缺文件 ' + row.file);
    const size = fs.statSync(file).size;
    assert.ok(size > 60 * 1024, row.file + ' 太小，可能没切到中文');
    assert.ok(size < 4 * 1024 * 1024, row.file + ' 超过 4 MB，子集没生效');
    const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
    assert.equal(head, 'wOF2', row.file + ' 不是 woff2');
  }
  assert.ok(fs.existsSync(path.join(www, 'fonts', 'LICENSES.md')), '缺少字体许可说明');
});
