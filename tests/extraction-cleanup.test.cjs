const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'www', 'direct-web.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, URL, fetch() {} });
const { cleanExtractedText, looksLikeCatalog } = window.ShuyinDirectWeb;

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
