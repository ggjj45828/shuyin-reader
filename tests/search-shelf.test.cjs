const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'www');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const direct = fs.readFileSync(path.join(root, 'direct-web.js'), 'utf8');

test('search does not auto-open or auto-import its first result', () => {
  assert.match(app, /id="smartAutoImport"> 自动试读并筛选/);
  assert.doesNotMatch(app, /smartAutoImport" checked/);
  assert.doesNotMatch(app, /results\.querySelector\('\[data-add-search\]'\)\?\.click\(\)/);
  assert.match(app, /if\(!verify\)return/);
});

test('preview is ephemeral and shelf insertion requires the explicit add action', () => {
  assert.match(app, /if\(action==='add'\)\{const book=addBook\(data\);cacheAddedBook\(book\)/);
  assert.match(app, /ephemeral:true\};previewBook=book;openBook\(book.id\)/);
  assert.match(app, /已加入书架，正在后台缓存/);
  assert.match(app, /if\(currentBook\.ephemeral\)return/);
  assert.match(html, /id="addCurrentBookToShelf"/);
});

test('failed links can be removed and candidate links added without auto-trial', () => {
  assert.match(app, /data-remove-failed-link/);
  assert.match(app, /data-remove-and-replenish/);
  assert.match(app, /未自动尝试其他链接/);
  assert.match(app, /data-copy-search-link/);
  assert.match(app, /data-open-search-link/);
});

test('search action buttons use compact dimensions on phone layouts', () => {
  assert.match(css, /\.result-actions button,\.result-actions a\{[^}]*min-height:29px/);
  assert.match(html, /vendor\/shuyin-browser\.js/);
});


test('iPhone search engine selector defaults to Google-first auto and can be changed', () => {
  assert.match(html, /id="searchEngine"/);
  assert.match(html, /value="auto">自动（优先 Google）/);
  assert.match(html, /value="duckduckgo">DuckDuckGo/);
  assert.match(html, /value="baidu">百度/);
  assert.match(html, /value="sogou">搜狗/);
  assert.match(direct, /\['google','bing','duckduckgo','baidu','sogou'\]/);
  assert.match(app, /shuyin\.search-engine\.v1/);
});

test('opt-in trial filtering checks content quality without auto-adding', () => {
  assert.match(direct, /function readableCandidate/);
  assert.match(app, /readableCandidate\(data,q,item\.title\)/);
  assert.match(app, /smartAutoImport[^;]*checked===true/);
});
