const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const read = (name) => fs.readFileSync(path.join(www, name), 'utf8');

test('离线资源与章节保护脚本已接入页面与离线壳', () => {
  const html = read('index.html');
  for (const file of ['reader-offline-manager.js', 'reader-chapter-guard.js']) {
    assert.ok(fs.existsSync(path.join(www, file)), `缺少脚本 ${file}`);
    assert.match(html, new RegExp(file.replace('.', '\\.')), `${file} 未在 index.html 引入`);
  }
  const sw = read('sw.js');
  assert.match(sw, /reader-offline-manager\.js/);
  assert.match(sw, /reader-chapter-guard\.js/);
});

test('章节读取失败不清空正文，并把自动加载开关拨回来', () => {
  const app = read('app.js');
  assert.match(app, /window\.ShuyinChapterGuard\?\.fail\(index,error\)/, '失败路径没有交给保护模块');
  assert.match(app, /autoLoadReady=true;currentBook\.cacheFailures/, '失败后没有复位 autoLoadReady');
  assert.match(app, /已保留当前正文/, '提示语没有说明正文已保留');
  // 失败分支不得写入 content
  const failBranch = app.slice(app.indexOf('window.ShuyinChapterGuard?.fail(index,error)') - 260);
  assert.doesNotMatch(failBranch.slice(0, 260), /currentBook\.content=/, '失败分支不应修改正文');
});

test('重试条提供重试、换源修复与关闭三个动作', () => {
  const guard = read('reader-chapter-guard.js');
  assert.match(guard, /chapterRetryGo/);
  assert.match(guard, /chapterRetryRepair/);
  assert.match(guard, /chapterRetryHide/);
  assert.match(guard, /autoLoadReady = true/, 'rearm() 没有复位自动加载');
  assert.match(guard, /loadRemoteChapter/, '重试没有真正重新拉取章节');
  assert.match(guard, /function advise/, '缺少失败原因归因');
  assert.match(read('styles.css'), /\.chapter-retry-bar\{/);
});

test('没有网络时不再误判为「没有下一章」', () => {
  const app = read('app.js');
  assert.match(app, /if\(!activeUrl\)\{noMoreChapters=true;return null\}if\(!networkAvailable\(\)\)/,
    '断网不应把 noMoreChapters 永久置为 true');
});

test('离线资源面板按书统计进度与占用，并可单独删除章节', () => {
  const manager = read('reader-offline-manager.js');
  assert.match(manager, /book\.cachedChapters/, '没有统计 cachedChapters');
  assert.match(manager, /book\.repairedChapters/, '没有统计 repairedChapters');
  assert.match(manager, /navigator\.storage\?\.estimate/, '没有读取本机占用');
  assert.match(manager, /data-drop-chapter/, '缺少单章删除入口');
  assert.match(manager, /data-offline-clear/, '缺少按书清空入口');
  assert.match(manager, /data-drop-audio/, '缺少音频删除入口');
  assert.match(manager, /data-offline-download/, '缺少继续下载入口');
  assert.match(manager, /window\.saveCurrentBook/, '删除后没有落盘');
  assert.doesNotMatch(manager, /localStorage\.setItem\('zhijian/, '不应写入新的 zhijian-* 键');
});

test('听书音频可枚举可删除，且拒绝路径穿越', () => {
  const swift = fs.readFileSync(path.join(root, 'native', 'ios', 'ShuyinAudioPlugin.swift'), 'utf8');
  assert.match(swift, /CAPPluginMethod\(name: "listAudio"/, '没有注册 listAudio');
  assert.match(swift, /CAPPluginMethod\(name: "deleteAudio"/, '没有注册 deleteAudio');
  assert.match(swift, /lastPathComponent/, '删除前没有取文件名防路径穿越');
  assert.match(swift, /hasSuffix\("\.caf"\)/, '没有限制只删 .caf');

  const tts = read('reader-nas-tts.js');
  assert.match(tts, /shuyin\.audio\.index\.v1/, '保存音频后没有登记归属索引');
});

test('版本号三处一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, '0.10.9');
  assert.equal(lock.version, pkg.version, 'lock 顶层版本不一致');
  assert.equal(lock.packages[''].version, pkg.version, 'lock 根包版本不一致');
});
