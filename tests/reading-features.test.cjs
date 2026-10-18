const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const read = (name) => fs.readFileSync(path.join(www, name), 'utf8');

test('听书增强与全库检索脚本已接入页面与离线壳', () => {
  const html = read('index.html');
  for (const file of ['reader-tts-plus.js', 'reader-library-tools.js']) {
    assert.ok(fs.existsSync(path.join(www, file)), `缺少脚本 ${file}`);
    assert.match(html, new RegExp(file.replace('.', '\\.')), `${file} 未在 index.html 引入`);
  }
  const sw = read('sw.js');
  assert.match(sw, /reader-tts-plus\.js/);
  assert.match(sw, /reader-library-tools\.js/);
});

test('听书定时不再依赖「下一段」才检查', () => {
  const tts = read('reader-nas-tts.js');
  assert.match(tts, /function armSleep\(\)/, '缺少独立的睡眠计时器');
  assert.match(tts, /armSleep\(\);playNext/, 'start() 里没有启动计时器');
  assert.match(tts, /clearTimeout\(sleepTimer\)/, 'stop() 里没有清理计时器');
});

test('音量与音高从页面一路传到原生插件', () => {
  const tts = read('reader-nas-tts.js');
  assert.match(tts, /volume:Number\(settings\(\)\.volume/, 'speak() 没有传 volume');
  assert.match(tts, /pitch:Number\(settings\(\)\.pitch/, 'speak() 没有传 pitch');
  assert.match(tts, /volume:1,pitch:1/, '默认设置缺 volume/pitch');

  const swift = fs.readFileSync(path.join(root, 'native', 'ios', 'ShuyinAudioPlugin.swift'), 'utf8');
  assert.match(swift, /utterance\.volume/, '插件没有设置音量');
  assert.match(swift, /utterance\.pitchMultiplier/, '插件没有设置音高');
  assert.match(swift, /0\.28/, '语速映射未放宽');
});

test('朗读高亮只包围当前一句，且偏移有容错', () => {
  const plus = read('reader-tts-plus.js');
  assert.match(plus, /shuyin-tts-follow/);
  assert.match(plus, /speechProgress/);
  assert.match(plus, /if \(at < 0\) continue;/, '找不到块时应跳过而不是硬猜');
  assert.match(plus, /splitText/);
  assert.match(read('styles.css'), /mark\.shuyin-tts-follow/);
});

test('全库检索覆盖元数据与笔记，不触碰 zhijian-* 数据键', () => {
  const tools = read('reader-library-tools.js');
  for (const field of ['book.title', 'book.author', 'book.chapters', 'book.notes', 'book.bookmarks', 'book.content']) {
    assert.ok(tools.includes(field), `检索没有覆盖 ${field}`);
  }
  assert.match(tools, /getBooks/);
  assert.match(tools, /openBookById/);
  assert.doesNotMatch(tools, /localStorage\.setItem\('zhijian/, '不应写入新的 zhijian-* 键');
});
