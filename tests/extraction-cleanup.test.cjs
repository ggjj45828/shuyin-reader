const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'www', 'direct-web.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, URL, fetch() {} });
const { cleanExtractedText, looksLikeCatalog, readableCandidate } = window.ShuyinDirectWeb;

test('removes isolated Latin separator noise but preserves short Chinese prose', () => {
  const result = cleanExtractedText('父亲还有一个比他小十岁的妹妹。\no\n在我三岁那年，父亲不幸暴病身亡。');
  assert.equal(result, '父亲还有一个比他小十岁的妹妹。\n\n在我三岁那年，父亲不幸暴病身亡。');
});

test('recognizes ranking/list pages and strips their metadata lines', () => {
  const listing = '佚名\n连载中 · 46章\n·30万字\n6\n斗罗大陆2蚕淫\n小六六\n连载中 · 172章\n·89万字\n7\n催眠眼镜';
  assert.equal(looksLikeCatalog(listing), true);
  assert.doesNotMatch(cleanExtractedText(listing), /连载中|万字|^6$|^7$/m);
});

test('does not classify short stories with ordinary punctuation as a catalog', () => {
  const prose = '父亲还有一个比他小十岁的妹妹。\n\n在我三岁那年，父亲不幸暴病身亡。';
  assert.equal(looksLikeCatalog(prose), false);
  assert.equal(cleanExtractedText(prose), prose);
});

test('preserves paragraph breaks and rejoins hard-wrapped lines inside a paragraph', () => {
  const text = '这是一段被网站排版硬拆开的正文\n中间没有句号所以需要接回去。\n\n这是下一段，段落边界应该保留。';
  assert.equal(cleanExtractedText(text), '这是一段被网站排版硬拆开的正文中间没有句号所以需要接回去。\n\n这是下一段，段落边界应该保留。');
});


test('trial filter rejects catalog noise and accepts a sufficiently long matching chapter', () => {
  const rejected = readableCandidate({ content: '少年阿宾\n连载中 · 46章\n·30万字\n6\n斗罗大陆2蚕淫\n小六六\n连载中 · 172章\n·89万字\n7\n催眠眼镜' }, '少年阿宾');
  assert.equal(rejected.ok, false);
  const prose = '父亲还有一个比他小十岁的妹妹。那年春天，院子里的海棠开得正好。她把信放在桌上，转身走进雨里。母亲读完信后沉默了很久，最后只说了一句，我们明天就出发。'.repeat(4);
  const accepted = readableCandidate({ title: '少年阿宾', chapterTitle: '第1章 房东太太', content: prose }, '少年阿宾', '少年阿宾 第1章');
  assert.equal(accepted.ok, true);
  assert.ok(accepted.readable_chars >= 150);
});
