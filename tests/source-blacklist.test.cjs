const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const source = fs.readFileSync(path.join(www, 'direct-web.js'), 'utf8');

// 用可控时钟 + 假 localStorage 把 direct-web.js 跑起来，测真实行为而不是 grep
function boot({ now = Date.now() } = {}) {
  const store = new Map();
  const clock = { t: now };
  const RealDate = Date;
  function FakeDate(...args) { return new RealDate(...args); }
  FakeDate.now = () => clock.t;
  FakeDate.prototype = RealDate.prototype;

  const window = {};
  vm.runInNewContext(source, {
    window,
    URL,
    AbortController,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    },
    fetch: () => Promise.reject(new Error('网络错误')),
    DOMParser: class {},
    Date: FakeDate,
    setTimeout,
    clearTimeout
  });
  return { api: window.ShuyinDirectWeb, store, clock };
}

test('同一站点失败 4 次且涉及 2 个地址才自动拉黑', async () => {
  const { api } = boot();
  for (const url of ['https://bad.example.com/1', 'https://bad.example.com/2']) {
    await assert.rejects(api.readChapter(url));
    await assert.rejects(api.readChapter(url));
  }
  assert.equal(api.isBlocked('https://bad.example.com/9'), true, '达到阈值应拉黑');
  assert.equal(api.isBlocked('https://good.example.com/1'), false, '别的站点不受牵连');
});

test('只失败 3 次不拉黑，同一个地址刷 4 次也不拉黑', async () => {
  const one = boot();
  for (let i = 0; i < 3; i += 1) await assert.rejects(one.api.readChapter('https://a.example.com/1'));
  assert.equal(one.api.isBlocked('https://a.example.com/1'), false, '3 次还没到阈值');

  const same = boot();
  for (let i = 0; i < 6; i += 1) await assert.rejects(same.api.readChapter('https://b.example.com/1'));
  assert.equal(same.api.isBlocked('https://b.example.com/1'), false, '只有 1 个地址不应判定为整站失效');
});

test('手动拉黑、解除、以及 7 天后自动放行', async () => {
  const { api, clock } = boot();
  api.setBlocked('manual.example.com', true);
  assert.equal(api.isBlocked('https://manual.example.com/x'), true);
  api.unblockDomain('manual.example.com');
  assert.equal(api.isBlocked('https://manual.example.com/x'), false);

  api.setBlocked('ttl.example.com', true);
  assert.equal(api.isBlocked('https://ttl.example.com/x'), true);
  clock.t += 8 * 86400000;
  assert.equal(api.isBlocked('https://ttl.example.com/x'), false, '过期后应自动放出来重试');
});

test('读取成功后清掉该站点的失败记录', async () => {
  const { api } = boot();
  for (let i = 0; i < 2; i += 1) await assert.rejects(api.readChapter('https://c.example.com/1'));
  const before = api.sourceRows().find((row) => row.domain === 'c.example.com');
  assert.equal(before.fails, 2);
  api.clearFailures('https://c.example.com/1');
  assert.equal(api.sourceRows().find((row) => row.domain === 'c.example.com'), undefined);
});

test('搜索会过滤已拉黑的站点并说明过滤了多少条', () => {
  assert.match(source, /hidden=dedup\.filter\(x=>isBlocked\(x\.url\)\)/, '没有过滤黑名单');
  assert.match(source, /另有 \$\{hidden\.length\} 条来自已拉黑的站点/, '没有提示被过滤的数量');
});

test('正文清理：去掉站内导航与广告尾注，接回被硬断行的句子', () => {
  const { api } = boot();
  const raw = [
    '上一章',
    '父亲还有一个比他小十岁的妹妹，那年',
    '春天院子里的海棠开得正好。',
    '本章未完，点击下一页继续阅读',
    'www.example-novel.com',
    '下一章'
  ].join('\n');
  const cleaned = api.cleanExtractedText(raw);
  assert.equal(cleaned, '父亲还有一个比他小十岁的妹妹，那年春天院子里的海棠开得正好。');
  assert.doesNotMatch(cleaned, /上一章|下一章|点击下一页|example-novel/);
});

test('正文清理不会把两句完整的话粘成一段', () => {
  const { api } = boot();
  const cleaned = api.cleanExtractedText('他推开门。\n屋里没有人。');
  assert.equal(cleaned, '他推开门。\n\n屋里没有人。');
});

test('阅读观感：进度条挂到阅读页并随滚动更新', () => {
  const polish = fs.readFileSync(path.join(www, 'reader-reading-polish.js'), 'utf8');
  assert.match(polish, /readerProgress/);
  assert.match(polish, /addEventListener\('scroll', fillBar/, '没有监听滚动');
  assert.match(polish, /scrollTop \/ max/, '没有按滚动比例算进度');
  assert.match(fs.readFileSync(path.join(www, 'index.html'), 'utf8'), /reader-reading-polish\.js/);
  assert.match(fs.readFileSync(path.join(www, 'styles.css'), 'utf8'), /#readerProgress\{/);
});

test('默认音色取系统里最高音质，而不是语种默认的紧凑音色', () => {
  const swift = fs.readFileSync(path.join(root, 'native', 'ios', 'ShuyinAudioPlugin.swift'), 'utf8');
  assert.match(swift, /private func voiceRank/, '没有音质排序');
  assert.match(swift, /chinese\.min\(by: \{ voiceRank/, '默认没有挑最高音质');
  assert.match(swift, /quality == \.premium/, '没有考虑高品质音色');
  assert.match(swift, /preUtteranceDelay = queueIndex > 0 \? 0\.12 : 0/, '队列间没有自然停顿');

  const tts = fs.readFileSync(path.join(www, 'reader-nas-tts.js'), 'utf8');
  assert.match(tts, /辅助功能 → 朗读与口述 → 声音/, '没有告诉用户怎么下载增强音色');
});

test('书源面板能手动拉黑与解除', () => {
  const guard = fs.readFileSync(path.join(www, 'reader-source-guard.js'), 'utf8');
  assert.match(guard, /data-unblock/);
  assert.match(guard, /data-block/);
  assert.match(guard, /sourceRows\(\)/);
  assert.match(fs.readFileSync(path.join(www, 'index.html'), 'utf8'), /reader-source-guard\.js/);
});
