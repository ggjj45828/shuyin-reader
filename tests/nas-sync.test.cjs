const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const listeners={};const window={Capacitor:{isNativePlatform:()=>false}};
const context={window,document:{addEventListener:(name,fn)=>{listeners[name]=fn}},localStorage:{getItem:()=>null,setItem:()=>{}},indexedDB:{},Response,fetch};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../www/nas-sync.js'),'utf8'),context);
const merge=window.ShuyinNas.merge;
test('merge keeps the newer same-ID local record',()=>{
 const result=merge([{id:'a',title:'local',updatedAt:20}],[{id:'a',title:'nas',updatedAt:10}]);
 assert.equal(result.length,1);assert.equal(result[0].title,'local');
});
test('merge keeps remote-only books and excludes tombstones',()=>{
 const result=merge([{id:'a',title:'local'}],[{id:'b',title:'remote'},{id:'c',title:'deleted'}],new Set(['c']));
 assert.deepEqual(Array.from(result,x=>x.id),['b','a']);
});
test('merge accepts newer remote changes',()=>{
 const result=merge([{id:'a',title:'old',updatedAt:10}],[{id:'a',title:'new',updatedAt:15}]);
 assert.equal(result[0].title,'new');
});

test('metadata-only sync preserves NAS content and cache while updating progress',()=>{
 const remote=[{id:'a',title:'Remote title',content:'full text',cachedChapters:{0:{content:'chapter'}},progress:12,updatedAt:10}];
 const local=[{id:'a',title:'Local title',content:'device text',cachedChapters:{0:{content:'new chapter'}},progress:48,currentChapterIndex:4,updatedAt:20},{id:'b',title:'New local',content:'new book'}];
 const result=window.ShuyinNas.prepareUpload(local,remote,false);
 assert.equal(result[0].content,'full text');assert.equal(result[0].cachedChapters[0].content,'chapter');assert.equal(result[0].title,'Local title');assert.equal(result[0].progress,48);assert.equal(result[0].currentChapterIndex,4);
 assert.equal(result[1].content,undefined);assert.equal(result[1].title,'New local');
});
test('sync records close competing progress edits',()=>{
 const conflicts=window.ShuyinNas.detectConflicts([{id:'a',title:'A',progress:25,currentChapterIndex:2,updatedAt:100000}],[{id:'a',progress:50,currentChapterIndex:3,updatedAt:150000}],160000);
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].winner,'NAS');
 assert.equal(window.ShuyinNas.detectConflicts([{id:'a',progress:25,updatedAt:1000}],[{id:'a',progress:50,updatedAt:500000}],500000).length,0);
});
test('metadata-only is the default while full content sync remains opt-in',()=>{
 const local=[{id:'a',title:'A',content:'chapter body',cachedChapters:{0:{content:'cache'}}}];
 assert.equal(window.ShuyinNas.prepareUpload(local,[])[0].content,undefined);
 assert.equal(window.ShuyinNas.prepareUpload(local,[],true)[0].content,'chapter body');
});
