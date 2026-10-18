const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const read = (name) => fs.readFileSync(path.join(www, name), 'utf8');

test('字体选择脚本已接入页面与离线壳', () => {
  const html = read('index.html');
  assert.match(html, /reader-font-choice\.js/, '未在 index.html 引入');
  assert.ok(fs.existsSync(path.join(www, 'reader-font-choice.js')));
  assert.match(read('sw.js'), /reader-font-choice\.js/);
});

test('提供五种中文字体，且全部走系统字体、不打包字体文件', () => {
  const source = read('reader-font-choice.js');
  for (const family of ['Songti SC', 'Kaiti SC', 'Yuanti SC', 'PingFang SC']) {
    assert.ok(source.includes(family), '缺少字体族 ' + family);
  }
  assert.equal((source.match(/id: '[a-z]+', label:/g) || []).length, 5, '应为五个选项');
  // 包内不应出现字体文件
  const assets = fs.readdirSync(www, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? fs.readdirSync(path.join(www, entry.name)) : [entry.name]));
  assert.equal(assets.filter((name) => /\.(woff2?|ttf|otf)$/i.test(name)).length, 0, '不应该打包字体文件');
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
  assert.match(source, /zhijian\.readerFont/, '应沿用 zhijian.* 前缀，避免用户设置丢失');
});
