const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'www/app.js'), 'utf8');

test('rapid chapter selection never lets an older slow response replace the latest selection', async () => {
  const begin = app.indexOf('async function loadRemoteChapter(');
  const end = app.indexOf('function addBook(book){', begin);
  const code = app.slice(begin, end);
  const pending = new Map();
  const elements = {'#readerTitle': {textContent: ''}, '#reader': {scrollTop: 100}};
  const book = {id:'b1', chapters:[{title:'第一章',url:'one'},{title:'第二章',url:'two'}], cachedChapters:{}};
  const context = {
    currentBook: book, currentChapterIndex: 0, chapterRequestId: 1, chapterLoading: 0,
    loadedChapterIndexes: new Set(), noMoreChapters: false, readerMode: 'page', readerPageIndex: 0,
    autoLoadReady: true, window: {ShuyinChapterGuard:{ok(){},fail(){throw Error('stale failure shown')}}},
    document: {},
    $: selector => elements[selector] || (elements[selector]={textContent:'',hidden:false,scrollTop:0}),
    remoteChapters: () => book.chapters,
    showChapterLoading: () => {},
    usefulChapterTitle: value => value,
    networkAvailable: () => true,
    syReadChapter: url => new Promise(resolve => pending.set(url, resolve)),
    syPrefetchNeighbors: () => {},
    renderReaderContent: () => {}, save: () => {},
    parseReaderBlocks: () => [], readerBlockHtml: () => '', esc: String,
    toast: message => { throw Error('unexpected toast: '+message) }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const slow = context.loadRemoteChapter(0, false, 1);
  context.chapterRequestId = 2;
  const fast = context.loadRemoteChapter(1, false, 2);
  pending.get('two')({title:'第二章',content:'最新章节内容',url:'two'});
  await fast;
  pending.get('one')({title:'第一章',content:'较慢的旧章节内容',url:'one'});
  await slow;
  assert.equal(book.content, '最新章节内容');
  assert.equal(book.currentChapterIndex, 1);
  assert.equal(context.chapterLoading, 0);
});

test('chapter loading has its own live status and chapter buttons stay outside it', () => {
  const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'www/styles.css'), 'utf8');
  const appCode = fs.readFileSync(path.join(root, 'www/app.js'), 'utf8');
  assert.match(html, /id="readerLoadingStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(style, /\.reader-loading-status\[hidden\]\{display:none\}/);
  assert.match(appCode, /可继续切换章节/);
  const loader = appCode.slice(appCode.indexOf('async function loadRemoteChapter('), appCode.indexOf('function addBook(book){'));
  assert.doesNotMatch(loader, /chapterLoading\)return/, '网络读取中不应直接丢弃用户的章节选择');
});
