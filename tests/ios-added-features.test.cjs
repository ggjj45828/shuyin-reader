const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'www/app.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'www/nas-sync.js'),'utf8');
const exporter=fs.readFileSync(path.join(root,'www/ebook-export.js'),'utf8');
const html=fs.readFileSync(path.join(root,'www/index.html'),'utf8');
const extras=fs.readFileSync(path.join(root,'www/reader-extras.js'),'utf8');
test('iOS reading and whole-book cache stay on device; NAS is used for sync',()=>{
 assert.match(app,/function cacheAddedBook\(book\)\{if\(book\?\.chapters\?\.length\)window\.ShuyinOfflineDownload\?\.start\(book\)\}/);
 assert.doesNotMatch(app,/pollAddedBookCache/);
 assert.match(app,/cachedChapters\?\.\[localIndex\]/);
 assert.match(app,/window\.ShuyinDirectWeb\.readChapter\(url\)/);
 assert.match(app,/NAS 仅用于书架和阅读进度同步/);
 assert.match(sync,/chapters:b\.chapters/);assert.match(sync,/async function sync/);
 assert.match(extras,/showLocalUpdatePanel/);assert.match(extras,/window\.ShuyinDirectWeb\.extract\(book\.sourceUrl\)/);
 assert.match(app,/iOS 只通过 NAS 同步书架与阅读进度/);
});
test('complete books can be exported to native system sharing as EPUB',()=>{
 assert.match(html,/id="readerExportEpub"/);assert.match(exporter,/window\.ShuyinShare\.shareFile/);assert.match(exporter,/本机缓存还不完整/);
 assert.match(exporter,/async function exportBook\(book\)\{const file=await makeLocal\(book\)/);
});
test('local EPUB export contains an EPUB container and every cached chapter',async()=>{
 const vm=require('node:vm');const JSZip=require('jszip');const context={window:{JSZip},JSZip,crypto:require('node:crypto').webcrypto,btoa,Uint8Array};
 vm.runInNewContext(exporter,context);
 const built=await context.window.ShuyinEbookExport.buildLocal({title:'测试书',author:'作者',chapters:[{title:'第一章',url:'https://example.com/1'},{title:'下一页',url:'https://example.com/2'}],cachedChapters:{0:{title:'第一章',content:'第一章\n\n正文一'},1:{title:'第二章 标题',content:'第二章 标题\n\n正文二'}}});
 const zip=await JSZip.loadAsync(Buffer.from(built.dataBase64,'base64'));
 assert.equal(await zip.file('mimetype').async('string'),'application/epub+zip');
 assert.match(await zip.file('OEBPS/nav.xhtml').async('string'),/第二章 标题/);
 assert.match(await zip.file('OEBPS/chapter-00002.xhtml').async('string'),/正文二/);
});
test('search results prioritize distinct add and preview actions',()=>{
 assert.match(app,/class="result-add"[^>]*data-search-action="add"/);assert.match(app,/class="result-preview"[^>]*data-search-action="preview"/);
 assert.match(app,/result-utilities/);
});
