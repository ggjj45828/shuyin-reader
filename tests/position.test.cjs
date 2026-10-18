const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const read = (name) => fs.readFileSync(path.join(www, name), 'utf8');

test('位置号脚本已接入页面与离线壳', () => {
  assert.ok(fs.existsSync(path.join(www, 'reader-position.js')));
  assert.match(read('index.html'), /reader-position\.js/);
  assert.match(read('sw.js'), /reader-position\.js/);
});

test('位置按「章节 + 字符偏移」存，不存页码', () => {
  const source = read('reader-position.js');
  assert.match(source, /chapterOffsets/, '没有按章存偏移');
  assert.match(source, /offsetAtTop/, '没有计算视口顶端字符位置');
  assert.match(source, /createTreeWalker/, '没有用文本节点定位到字');
  assert.match(source, /createRange/, '没有用 Range 精确跳转');
  // 存页码就会在换字号后漂移，这里不允许把 pageIndex 当位置写进书对象
  const persist = source.slice(source.indexOf('function capture()'), source.indexOf('function scheduleCapture()'));
  assert.doesNotMatch(persist, /pageIndex\s*=/, 'capture 不应写页码');
});

test('正文长度变化过大时不用偏移恢复，交给百分比兜底', () => {
  const source = read('reader-position.js');
  assert.match(source, /len' \+ index/, '没有记录上次正文总长度');
  assert.match(source, /> 0\.5/, '没有长度差异阈值判断');
  assert.match(source, /return;/, '差异过大时应直接返回');
});

test('位置号显示在页脚，形如「位置 1234 / 5678」', () => {
  const source = read('reader-position.js');
  assert.match(source, /'位置 ' \+ Math\.min/, '没有渲染位置文本');
  assert.match(source, /readerLoc/, '没有位置号容器');
  assert.match(read('styles.css'), /\.reader-loc\{/);
});

test('滚动与换章都会更新位置，且恢复期间不覆盖已存位置', () => {
  const source = read('reader-position.js');
  assert.match(source, /addEventListener\('scroll'/, '没有监听滚动');
  assert.match(source, /state\.restoring/, '没有恢复中的互斥标记');
  assert.match(source, /MutationObserver/, '换章重建后没有重新定位');
  assert.match(source, /persistReadingProgress/, '没有落盘');
});
