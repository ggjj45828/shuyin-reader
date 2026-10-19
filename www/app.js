const STORE_KEY='zhijian.library.v1';
const palettes=[['#89988b','#43564c'],['#b88a72','#725349'],['#7f9296','#435c63'],['#9d927a','#5c5946'],['#9b8290','#634e64'],['#8392a1','#4b5b73'],['#b18f65','#685238']];
let serverRevision=null, savingPromise=Promise.resolve();
let books=[], currentBook=null, previewBook=null, activeShelf="全部书籍", fontSize=Math.max(14,Math.min(30,Number(localStorage.getItem('zhijian.readerFontSize'))||18)), currentTheme=localStorage.getItem('zhijian.theme')||'paper', toastTimer, readingSaveTimer, libraryDb=null, apiMode=false, searchHistory=readSearchHistory(), selectedBookIds=new Set(), manageBooksMode=false, readerMode=localStorage.getItem('zhijian.readerMode')||'scroll', readerPages=[], readerPageIndex=0, readerBlocks=[], currentChapterIndex=0, chapterLoading=0, chapterRequestId=0, loadedChapterIndexes=new Set(), noMoreChapters=false;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function loadBooks(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'[]')}catch{return []}}
function readSearchHistory(){try{return JSON.parse(localStorage.getItem('zhijian.searchHistory')||'[]')}catch{return []}}
function persistSearchHistory(){localStorage.setItem('zhijian.searchHistory',JSON.stringify(searchHistory));renderSearchHistory()}
function recordSearch(query){searchHistory=[query,...searchHistory.filter(x=>x!==query)].slice(0,12);persistSearchHistory()}
function openLibraryDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('zhijian-reader',1);req.onupgradeneeded=()=>req.result.createObjectStore('books',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function directNative(){return !!(window.Capacitor?.isNativePlatform?.()&&window.ShuyinDirectWeb)}
function networkAvailable(){return window.Capacitor?.isNativePlatform?.()?directNative():apiMode||directNative()}
async function apiRequest(path,options={}){
 let response;
 if(window.Capacitor?.isNativePlatform?.()&&(/^\/api\/(?:search|extract|chapter)(?:[/?]|$)/.test(path))&&!directNative())throw Error('iOS 本机网页读取组件未加载；NAS 仅用于书架和阅读进度同步');
 if(directNative()&&(/^\/api\/(?:search|extract|chapter)(?:[/?]|$)/.test(path))){
  try{let data;if(path.startsWith('/api/search/quick')||path.startsWith('/api/search?')){const q=new URLSearchParams(path.split('?')[1]||'').get('q')||'',results=await window.ShuyinDirectWeb.search(q,options.signal,options.searchEngine||'auto');data={results,more_results:results,checked:{tested:0},tested:0,source_results:results.length}}
   else if(path==='/api/extract'){const body=typeof options.body==='string'?JSON.parse(options.body):options.body||{};data=await window.ShuyinDirectWeb.extract(body.url,options.signal)}
   else{const url=new URLSearchParams(path.split('?')[1]||'').get('url');data=await window.ShuyinDirectWeb.readChapter(url,options.signal)}
   response=new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
  }catch(error){throw error}
 }else if(window.Capacitor?.isNativePlatform?.()){
  if(!/^\/api\/books(?:[/?]|$)/.test(path))throw Error('iOS 只通过 NAS 同步书架与阅读进度；其他功能由手机本机处理');
  if(!window.ShuyinNas?.getBase())throw Error('尚未连接 NAS；本机书库与阅读不受影响');
  response=await window.ShuyinNas.request(path,options);
 }else response=await fetch(path,options);
 if(!response.ok){let message=`请求失败（${response.status}）`;try{message=(await response.json()).detail||message}catch{}throw Error(message)}return response
}
async function initializeLibrary(){if(!window.Capacitor?.isNativePlatform?.()&&(location.protocol==='http:'||location.protocol==='https:')){try{const result=await(await apiRequest('/api/books')).json();books=result.books||[];serverRevision=result.revision??null;apiMode=true;$('#syncLabel').textContent='NAS 共享书库';$('.status-dot').classList.add('connected');$('#nasStatusText').textContent='已连接 NAS 共享书库';$('#nasStatusDot').classList.add('online');$('#searchModeHint').textContent='已连接 NAS 书架；书源搜索、试读和正文读取仍由手机执行，试读不会自动入架。';render();return}catch{}}$('#nasStatusText').textContent='当前使用本机浏览器书库';$('#searchModeHint').textContent=directNative()?'手机直连搜索引擎；书籍保存在本机，NAS 仅用于可选同步。':'当前未连接 NAS 搜索服务；连接后会先显示网页候选，点击后再读取正文。';try{const timeout=(label)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),6000));libraryDb=await Promise.race([openLibraryDb(),timeout('打开本机书库超时')]);books=await Promise.race([new Promise((resolve,reject)=>{const req=libraryDb.transaction('books').objectStore('books').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)}),timeout('读取本机书库超时')])}catch{books=loadBooks()}render()}
function save(){if(window.Capacitor?.isNativePlatform?.()){if(currentBook)currentBook.updatedAt=Date.now();if(libraryDb){const tx=libraryDb.transaction('books','readwrite'),store=tx.objectStore('books');store.clear();books.forEach(book=>store.put(book));tx.oncomplete=()=>{render();window.ShuyinNas?.schedule()};tx.onerror=()=>toast('保存失败，请检查设备空间')}else{try{localStorage.setItem(STORE_KEY,JSON.stringify(books));render();window.ShuyinNas?.schedule()}catch{toast('本地存储空间不足，请导出备份后移除部分书籍')}}}else if(apiMode){
 const snapshot=JSON.parse(JSON.stringify(books));
 savingPromise=savingPromise.catch(()=>{}).then(async()=>{
  const res=await apiRequest('/api/books',{method:'PUT',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({books:snapshot,expected_revision:serverRevision})});
  const data=await res.json();serverRevision=data.revision;
 }).catch(error=>{toast('保存失败：'+error.message);console.error('书架同步冲突',error)});
 render();
}else if(libraryDb){const tx=libraryDb.transaction('books','readwrite'),store=tx.objectStore('books');store.clear();books.forEach(book=>store.put(book));tx.oncomplete=render;tx.onerror=()=>toast('保存失败，请检查设备空间')}else{try{localStorage.setItem(STORE_KEY,JSON.stringify(books));render()}catch{toast('本地存储空间不足，请导出备份后移除部分书籍')}}}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function coverStyle(book){const p=palettes[(book.colorIndex||0)%palettes.length];return `background:linear-gradient(140deg,${p[0]},${p[1]})`}
function card(book,selectable=false){const selected=selectedBookIds.has(book.id);return `<article class="book-card ${selectable&&manageBooksMode?'selectable-book':''} ${selected?'book-selected':''}" data-book="${esc(book.id)}" data-selectable="${selectable}"><div class="book-cover" style="${coverStyle(book)}">${selectable&&manageBooksMode?`<span class="book-select-mark">${selected?'✓':''}</span>`:''}<span class="cover-glyph">${esc((book.title||'书').slice(0,1))}</span><div class="cover-copy"><strong>${esc(book.title)}</strong><span>${esc(book.author||'未知作者')}</span></div></div><div class="book-info"><div><strong>${esc(book.title)}</strong><span>${esc(book.author||book.format||'本地书籍')}</span></div>${manageBooksMode&&selectable?'':`<button class="book-menu" data-remove="${esc(book.id)}" aria-label="移除 ${esc(book.title)}">···</button>`}</div>${book.progress?`<div class="book-progress"><span style="width:${Math.min(99,book.progress)}%"></span></div>`:''}</article>`}
function updateBookSelectionBar(){const bar=$('#bookSelectionBar');if(!bar)return;bar.classList.toggle('hidden',!manageBooksMode);$('#toggleManageBooks').textContent=manageBooksMode?'完成':'多选';$('#selectedBooksCount').textContent=`已选 ${selectedBookIds.size} 本`}
function render(){const recent=[...books].sort((a,b)=>(b.openedAt||0)-(a.openedAt||0)).slice(0,4);$('#recentBooks').innerHTML=recent.map(b=>card(b)).join('');const query=$('#librarySearch').value.trim().toLowerCase();let filtered=books.filter(b=>(activeShelf==='全部书籍'||(b.shelf||'全部书籍')===activeShelf)&&(b.title+' '+(b.author||'')).toLowerCase().includes(query));if($('#sortBooks').value==='title')filtered.sort((a,b)=>a.title.localeCompare(b.title,'zh'));else filtered.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));$('#allBooks').innerHTML=filtered.map(b=>card(b,true)).join('');$('#bookCount').textContent=`${books.length} 本书`;$('#emptyLibrary').classList.toggle('hidden',books.length>0);$('#allBooks').classList.toggle('hidden',books.length===0);$('#continueCard').innerHTML=recent.length?`<div class="continue-copy"><p class="continue-kicker">PICK UP WHERE YOU LEFT OFF</p><h3 class="continue-title">${esc(recent[0].title)}</h3><p class="continue-desc">${esc(recent[0].author||'本地书籍')} · ${recent[0].progress?`阅读进度 ${recent[0].progress}%`:'刚加入书架'}</p><button class="primary-button" data-open="${esc(recent[0].id)}">继续阅读 →</button></div>`:`<div class="continue-copy"><p class="continue-kicker">A QUIET PLACE FOR STORIES</p><h3 class="continue-title">从一本书开始</h3><p class="continue-desc">你导入的作品会安静地留在这里。</p><button class="primary-button" data-go="import">导入一本书 →</button></div>`;updateBookSelectionBar();renderShelves();renderReadingHistory()}
function renderReadingHistory(){const rows=[...books].filter(b=>b.openedAt).sort((a,b)=>b.openedAt-a.openedAt).slice(0,12);$('#readingHistory').innerHTML=rows.length?rows.map(b=>`<div class="history-row"><button class="history-open" data-open="${esc(b.id)}"><strong>${esc(b.title)}</strong><span>${esc(b.author||'未知作者')} · ${new Date(b.openedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></button><span class="history-progress">${b.progress||0}%</span><button class="history-remove" data-clear-reading="${esc(b.id)}" aria-label="删除 ${esc(b.title)} 阅读记录">×</button></div>`).join(''):'<p class="history-empty">还没有阅读记录</p>';$('#clearReadingHistory').classList.toggle('hidden',!rows.length)}
function renderSearchHistory(){const block=$('#searchHistoryBlock');if(!block)return;block.classList.toggle('hidden',!searchHistory.length);$('#searchHistory').innerHTML=searchHistory.map((q,i)=>`<span class="search-history-chip"><button data-repeat-search="${i}">${esc(q)}</button><button class="chip-remove" data-remove-search="${i}" aria-label="删除搜索词">×</button></span>`).join('')}
function renderShelves(){let custom=[];try{custom=JSON.parse(localStorage.getItem('shuyin.custom-shelves.v1')||'[]')}catch{}const shelves=[...new Set(['全部书籍',...custom,...books.map(b=>b.shelf||'全部书籍')])];$('#shelfList').innerHTML=shelves.map(s=>`<button class="shelf-link" data-shelf="${esc(s)}"><span>◦</span>${esc(s)}<span class="shelf-count">${books.filter(b=>(b.shelf||'全部书籍')===s).length}</span></button>`).join('')||'<button class="shelf-link"><span>◦</span>全部书籍<span class="shelf-count">0</span></button>'}
function navigate(name){$('#reader').classList.add('hidden');$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#view-${name}`).classList.add('active-view');$$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));const titles={home:'书架',discover:'发现与搜索',import:'导入书籍',settings:'设置与同步'};$('#pageTitle').textContent=titles[name]||'书架';window.scrollTo(0,0)}
const chapterHeading=/^(?:第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回卷部篇].*|序章.*|楔子.*|番外.*|chapter\s+\d+.*)$/i;
function parseReaderBlocks(content){
 const raw=String(content||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').trim();
 let parts=raw.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
 if(parts.length<3&&raw.split('\n').length>4)parts=raw.split('\n').map(x=>x.trim()).filter(Boolean);
 return parts.map(text=>({type:chapterHeading.test(text.replace(/\s+/g,' '))?'heading':'paragraph',text:text.replace(/^[\u3000 ]{1,2}/,'').replace(/\n[\u3000 ]+/g,'\n')}));
}
function readerBlockHtml(block){return block.type==='heading'?`<h2 class="reader-chapter-heading">${esc(block.text)}</h2>`:`<p>${esc(block.text).replace(/\n/g,'<br>')}</p>`}
function splitLongText(text,limit){const chars=[...text],parts=[];while(chars.length>limit){let end=limit;for(let i=limit-1;i>limit*.55;i--){if('。！？!?；;'.includes(chars[i])){end=i+1;break}}parts.push(chars.splice(0,end).join(''))}if(chars.length)parts.push(chars.join(''));return parts}
function paginateReaderBlocks(blocks){const width=Math.max(260,Math.min(690,$('#reader').clientWidth-54)),height=Math.max(360,window.innerHeight-270),lineChars=Math.max(12,Math.floor(width/(fontSize*1.08))),lines=Math.max(8,Math.floor(height/(fontSize*2.12))),limit=Math.max(160,Math.floor(lineChars*lines*.68)),pages=[];let page=[],used=0;const flush=()=>{if(page.length){pages.push(page);page=[];used=0}};blocks.forEach(block=>{const pieces=block.type==='paragraph'&&block.text.length>limit?splitLongText(block.text,limit):[block.text];pieces.forEach((text,index)=>{const item={type:block.type,text:index?`　${text}`:text};const weight=Math.ceil([...text].length/lineChars)+(item.type==='heading'?2:1);if(used+weight>lines&&page.length)flush();page.push(item);used+=weight})});flush();return pages.length?pages:[[{type:'paragraph',text:''}]]}
// r64: in-memory chapter request deduplication and adjacent chapter prefetch.
const syChapterRequests=new Map();
const syChapterCache=new Map();
const SY_CACHE_LIMIT=18;
function syReadChapter(url,book=currentBook){
 if(!url)return Promise.reject(Error('章节地址为空'));
 const localIndex=book?.chapters?.findIndex(c=>c.url===url);if(localIndex>=0&&book.cachedChapters?.[localIndex]?.content)return Promise.resolve({title:book.cachedChapters[localIndex].title,content:book.cachedChapters[localIndex].content,url});
 if(syChapterCache.has(url))return Promise.resolve(syChapterCache.get(url));
 if(syChapterRequests.has(url))return syChapterRequests.get(url);
 const job=(window.Capacitor?.isNativePlatform?.()?window.ShuyinDirectWeb.readChapter(url):apiRequest(`/api/chapter?url=${encodeURIComponent(url)}`).then(r=>r.json())).then(data=>{
  syChapterCache.set(url,data);
  while(syChapterCache.size>SY_CACHE_LIMIT)syChapterCache.delete(syChapterCache.keys().next().value);
  return data;
 }).finally(()=>syChapterRequests.delete(url));
 syChapterRequests.set(url,job);
 return job;
}
function syPrefetchNeighbors(book,index){
 if(!networkAvailable()||!book||book!==currentBook)return;
 const list=Array.isArray(book.chapters)?book.chapters:[];
 for(const i of [index+1,index-1]){
  if(i>=0&&i<list.length&&list[i]?.url)syReadChapter(list[i].url).catch(()=>{});
 }
}
function remoteChapters(){return Array.isArray(currentBook?.chapters)?currentBook.chapters:[]}
function usefulChapterTitle(value){const t=String(value||'').trim();return t&&!/^(?:下一页|下页|下一章|下一节|第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回卷部篇话]?)$/i.test(t)?t:''}
function renderToc(){const toc=$('#readerTocList');if(!toc)return;const remote=remoteChapters(),local=readerBlocks.map((b,i)=>({...b,index:i})).filter(b=>b.type==='heading');const entries=remote.length?remote.map((c,i)=>`<button class="reader-toc-item ${i===currentChapterIndex?'current':''}" data-toc-remote="${i}">${esc(usefulChapterTitle(c.title)||`第 ${i+1} 节`)}</button>`).join(''):local.map(b=>`<button class="reader-toc-item" data-toc-local="${b.index}">${esc(b.text)}</button>`).join('');toc.innerHTML=entries||'<p class="reader-toc-empty">暂未识别到章节目录</p>'}
function persistReadingProgress(){if(!currentBook)return;currentBook.updatedAt=Date.now();if(currentBook.ephemeral)return;if(libraryDb){const tx=libraryDb.transaction('books','readwrite');tx.objectStore('books').put(currentBook);tx.oncomplete=()=>{render();if(window.Capacitor?.isNativePlatform?.())window.ShuyinNas?.schedule()};tx.onerror=()=>toast('保存进度失败，请检查设备空间')}else save()}
function persistPagedProgress(){if(!currentBook||readerMode!=='page'||!readerPages.length)return;const page=Math.max(0,Math.min(readerPages.length-1,readerPageIndex));currentBook.pageIndex=page;currentBook.progress=readerPages.length>1?Math.round(page/(readerPages.length-1)*100):0;currentBook.currentChapterIndex=currentChapterIndex;currentBook.openedAt=Date.now();persistReadingProgress()}
function persistCurrentReadingPosition(){if(!currentBook)return;if(readerMode==='page'&&readerPages.length){persistPagedProgress();return}const panel=$('#reader'),span=panel.scrollHeight-panel.clientHeight;if(span>0)currentBook.progress=Math.max(0,Math.min(100,Math.round(panel.scrollTop/span*100)));currentBook.currentChapterIndex=currentChapterIndex;currentBook.openedAt=Date.now();persistReadingProgress()}
function turnReaderPage(index){if(readerMode!=='page'||!readerPages.length)return false;const content=$('#readerContent'),previous=readerPageIndex;const target=Math.max(0,Math.min(readerPages.length-1,Number(index)||0));if(target===readerPageIndex)return false;content.dataset.turn=target>previous?'next':'previous';readerPageIndex=target;content.classList.remove('reader-page-turn');renderReaderContent();void content.offsetWidth;content.classList.add('reader-page-turn');content.dataset.lastPage=String(target);persistPagedProgress();return true}
function renderReaderContent(){readerBlocks=parseReaderBlocks(currentBook?.content||'');const content=$('#readerContent');const modeControl=$('#readerMode');if(!modeControl)readerMode='scroll';else modeControl.value=readerMode;$('#reader').classList.toggle('is-paged',readerMode==='page');if(readerMode==='page'){readerPages=paginateReaderBlocks(readerBlocks);readerPageIndex=Math.max(0,Math.min(readerPageIndex,readerPages.length-1));content.innerHTML=readerPages[readerPageIndex].map(readerBlockHtml).join('');$('#readerPager')?.classList.remove('hidden');if($('#readerPageLabel'))$('#readerPageLabel').textContent=`第 ${readerPageIndex+1} / ${readerPages.length} 页`;if($('#readerPrev'))$('#readerPrev').textContent=readerPageIndex?'上一页':(currentChapterIndex>0?'上一章':'上一页');if($('#readerNext'))$('#readerNext').textContent=readerPageIndex<readerPages.length-1?'下一页':(currentBook?.activeChapterUrl||remoteChapters().length?'下一章':'下一页')}else{const html=readerBlocks.map((b,i)=>b.type==='heading'?`<h2 class="reader-chapter-heading" id="local-chapter-${i}">${esc(b.text)}</h2>`:readerBlockHtml(b)).join('');content.innerHTML=remoteChapters().length?`<section class="reader-remote-chapter" data-remote-chapter="${currentChapterIndex}">${html}</section>`:html;$('#readerPager')?.classList.toggle('hidden',!currentBook?.activeChapterUrl&&!remoteChapters().length);if($('#readerPageLabel'))$('#readerPageLabel').textContent='滚动到底自动加载下一章，也可点此继续';if($('#readerPrev'))$('#readerPrev').textContent='上一章';if($('#readerNext'))$('#readerNext').textContent='加载下一章'}renderToc()}
function openBook(id){chapterRequestId++;showChapterLoading('');const b=books.find(x=>x.id===id)||(previewBook&&previewBook.id===id?previewBook:null);if(!b)return;if(!b.content&&!b.chapters?.length&&!b.sourceUrl&&!b.activeChapterUrl){toast(`${b.format} 文件已收入书架；这个格式的正文解析还未启用。`);return}currentBook=b;currentChapterIndex=Math.max(0,Number(b.currentChapterIndex)||0);queueMicrotask(()=>syPrefetchNeighbors(b,currentChapterIndex));loadedChapterIndexes=new Set([currentChapterIndex]);noMoreChapters=false;b.openedAt=Date.now();if(!b.ephemeral)save();$('#readerBookTitle').textContent=b.title;if(!b.ephemeral)queueMicrotask(()=>cacheAddedBook(b));$('#addCurrentBookToShelf')?.classList.toggle('hidden',!b.ephemeral);$('#readerTitle').textContent=b.currentChapterTitle||b.title;$('#readerMeta').textContent=`${b.author||'未知作者'}  ·  ${b.format||'文本'}`;$('#readerFooter').textContent=`— ${esc(b.title)} —`;$('#reader').style.setProperty('--reader-size',`${fontSize}px`);$('#fontSizeLabel').textContent=`${fontSize}px`;readerPageIndex=Number(b.pageIndex)||0;renderReaderContent();$('#reader').classList.remove('hidden');requestAnimationFrame(()=>{const panel=$('#reader');panel.scrollTop=0;if(readerMode==='page'){readerPageIndex=Number.isFinite(Number(b.pageIndex))?Number(b.pageIndex):Math.round((Number(b.progress)||0)/100*Math.max(0,readerPages.length-1));readerPageIndex=Math.max(0,Math.min(readerPages.length-1,readerPageIndex));renderReaderContent()}else{const ratio=Math.max(0,Math.min(100,Number(b.progress)||0))/100;panel.scrollTop=Math.max(0,panel.scrollHeight-panel.clientHeight)*ratio}});window.scrollTo(0,0);if(!String(b.content||'').trim()&&remoteChapters().length){const host=$('#readerContent');if(host)host.innerHTML=`<p class="form-hint">正在读取第 ${currentChapterIndex+1} 章…</p>`;window.ShuyinChapterGuard?.rearm();loadRemoteChapter(currentChapterIndex,false)}}
function showChapterLoading(message){const node=$('#readerLoadingStatus');if(!node)return;node.textContent=message||'';node.hidden=!message}
async function ensureNextChapter(requestId=chapterRequestId){
 const book=currentBook;if(!book)return null;
 const chapters=Array.isArray(book.chapters)?book.chapters:[];
 if(currentChapterIndex+1<chapters.length)return currentChapterIndex+1;
 if(noMoreChapters)return null;
 const activeUrl=book.activeChapterUrl||book.sourceUrl;
 if(!activeUrl){noMoreChapters=true;return null}
 if(!networkAvailable()){toast('读取下一章需要网络连接；已缓存章节仍可继续阅读');return null}
 chapterLoading++;
 try{
  const data=await syReadChapter(activeUrl,book);
  if(currentBook!==book||requestId!==chapterRequestId)return null;
  if(!data.next){noMoreChapters=true;return null}
  const existing=(book.chapters||[]).findIndex(c=>c.url===data.next.url);
  if(existing>=0)return existing;
  book.chapters=book.chapters||[];book.chapters.push(data.next);noMoreChapters=false;save();renderToc();
  return book.chapters.length-1;
 }catch(error){
  if(currentBook===book&&requestId===chapterRequestId){autoLoadReady=true;showChapterLoading('');toast(`查找下一章失败：${error.message}，可以继续点下一章重试`)}
  return null;
 }finally{chapterLoading=Math.max(0,chapterLoading-1)}
}
async function advanceChapter(append=readerMode==='scroll'){
 const requestId=++chapterRequestId;
 showChapterLoading('正在查找下一章…仍可继续选择章节');
 const index=await ensureNextChapter(requestId);
 if(requestId!==chapterRequestId)return;
 if(index===null){showChapterLoading('');toast(noMoreChapters?'没有识别到下一章链接':'下一章信息暂不可用，请重试');return}
 return loadRemoteChapter(index,append,requestId);
}
async function loadRemoteChapter(index,append=false,requestId=++chapterRequestId){
 const book=currentBook;
 if(!book||requestId!==chapterRequestId||index<0||index>=remoteChapters().length)return;
 if(append&&loadedChapterIndexes.has(index))return;
 const chapter=book.chapters[index];
 const offline=book.cachedChapters?.[index],repaired=book.repairedChapters?.[index];
 if(offline?.content||repaired?.content){
  const saved=offline||repaired;
  currentChapterIndex=index;book.currentChapterIndex=index;book.content=saved.content;
  book.currentChapterTitle=usefulChapterTitle(chapter.title)||usefulChapterTitle(saved.title)||`第 ${index+1} 章`;
  chapter.title=book.currentChapterTitle;book.activeChapterUrl=chapter.url;book.pageIndex=0;book.progress=0;readerPageIndex=0;
  $('#readerTitle').textContent=book.currentChapterTitle||book.title;showChapterLoading('');window.ShuyinChapterGuard?.ok();renderReaderContent();save();return {content:saved.content,cached:true};
 }
 if(!networkAvailable()){showChapterLoading('');toast('读取在线章节需要网络连接；已缓存章节可离线阅读');return}
 chapterLoading++;showChapterLoading(`正在读取第 ${index+1} 章…可继续切换章节`);
 try{
  const data=await syReadChapter(chapter.url,book);
  // 快速连点章节时只让最后一次选择更新画面，慢返回的旧请求不能覆盖新章节。
  if(currentBook!==book||requestId!==chapterRequestId)return data;
  const chapters=remoteChapters();
  if(data.next&&!chapters.some(c=>c.url===data.next.url)){book.chapters.push(data.next);noMoreChapters=false}
  currentChapterIndex=index;book.currentChapterIndex=index;
  book.currentChapterTitle=usefulChapterTitle(data.title)||usefulChapterTitle(chapter.title)||`第 ${index+1} 章`;
  chapter.title=book.currentChapterTitle;book.activeChapterUrl=data.url;book.content=data.content;
  book.cachedChapters=book.cachedChapters||{};
  book.cachedChapters[index]={title:book.currentChapterTitle,content:data.content,url:data.url||chapter.url,cachedAt:Date.now()};
  book.pageIndex=0;loadedChapterIndexes.add(index);syPrefetchNeighbors(book,index);
  if(append&&readerMode==='scroll'){
   const section=document.createElement('section');section.className='reader-remote-chapter';section.dataset.remoteChapter=index;
   section.innerHTML=`<h2>${esc(usefulChapterTitle(data.title)||usefulChapterTitle(chapter.title)||`第 ${index+1} 节`)}</h2>${parseReaderBlocks(data.content).map(readerBlockHtml).join('')}`;
   $('#readerContent').append(section);renderToc();
  }else{
   $('#readerTitle').textContent=book.currentChapterTitle||book.title;readerPageIndex=0;renderReaderContent();$('#reader').scrollTop=0;
  }
  delete book.cacheFailures?.[index];showChapterLoading('');window.ShuyinChapterGuard?.ok();save();return data;
 }catch(error){
  if(currentBook===book&&requestId===chapterRequestId){
   autoLoadReady=true;book.cacheFailures=book.cacheFailures||{};book.cacheFailures[index]={message:String(error.message||error),at:Date.now(),url:chapter.url};
   showChapterLoading('');window.ShuyinChapterGuard?.fail(index,error);toast(`第 ${index+1} 章读取失败；当前正文已保留，可以继续切换或重试`);
  }
 }finally{
  chapterLoading=Math.max(0,chapterLoading-1);
  if(requestId===chapterRequestId&&chapterLoading===0)showChapterLoading('');
 }
}
function addBook(book){const existing=books.find(b=>b.title===book.title&&b.format===book.format);if(existing){toast('这本书已在书架');return existing}const saved={id:crypto.randomUUID(),addedAt:Date.now(),colorIndex:Math.floor(Math.random()*palettes.length),shelf:'全部书籍',...book};books.unshift(saved);save();toast(`《${book.title}》已加入书架`);return saved}
function cacheAddedBook(book){if(book?.chapters?.length)window.ShuyinOfflineDownload?.start(book)}
$$('.nav-item[data-view]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));$$('[data-go]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.go)));$('#showAll')?.addEventListener('click',()=>{$('#librarySearch').focus();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})});$('#topSearch')?.addEventListener('click',()=>{navigate('discover');$('#discoverInput').focus()});$('#librarySearch')?.addEventListener('input',render);$('#sortBooks')?.addEventListener('change',render);
document.addEventListener('click',e=>{const open=e.target.closest('[data-open]'), cardEl=e.target.closest('.book-card'), remove=e.target.closest('[data-remove]');if(open)openBook(open.dataset.open);else if(remove){e.stopPropagation();if(confirm('从书架移除这本书？')){books=books.filter(b=>b.id!==remove.dataset.remove);selectedBookIds.delete(remove.dataset.remove);save();toast('已从书架移除')}}else if(cardEl){if(manageBooksMode&&cardEl.dataset.selectable==='true'){const id=cardEl.dataset.book;selectedBookIds.has(id)?selectedBookIds.delete(id):selectedBookIds.add(id);render()}else openBook(cardEl.dataset.book)}});
$('#toggleManageBooks')?.addEventListener('click',()=>{manageBooksMode=!manageBooksMode;if(!manageBooksMode)selectedBookIds.clear();render()});$('#cancelManageBooks')?.addEventListener('click',()=>{manageBooksMode=false;selectedBookIds.clear();render()});$('#selectAllBooks')?.addEventListener('click',()=>{const filtered=[...document.querySelectorAll('#allBooks .book-card')].filter(el=>!el.hidden).map(el=>el.dataset.book);const allSelected=filtered.length&&filtered.every(id=>selectedBookIds.has(id));filtered.forEach(id=>allSelected?selectedBookIds.delete(id):selectedBookIds.add(id));render()});$('#deleteSelectedBooks')?.addEventListener('click',()=>{if(!selectedBookIds.size){toast('请先选择要删除的书');return}if(!confirm(`确定从书架删除选中的 ${selectedBookIds.size} 本书吗？`))return;books=books.filter(b=>!selectedBookIds.has(b.id));selectedBookIds.clear();save();toast('所选书籍已删除')});
$('#fileInput')?.addEventListener('change',e=>importFiles([...e.target.files]));const zone=$('#dropZone');zone?.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover')});zone?.addEventListener('dragleave',()=>zone.classList.remove('dragover'));zone?.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');importFiles([...e.dataTransfer.files])});
async function importFiles(files){const queue=$('#importQueue');for(const file of files){if(file.size>32*1024*1024){toast(`${file.name} 超过 32 MB 限制`);continue}const ext=file.name.split('.').pop().toLowerCase(),format={txt:'TXT',md:'Markdown',markdown:'Markdown',epub:'EPUB',pdf:'PDF',docx:'DOCX',html:'HTML',htm:'HTML',fb2:'FB2'}[ext];if(!format){toast(`暂不支持 ${file.name}`);continue}queue.insertAdjacentHTML('afterbegin',`<div class="queue-item"><span>${esc(file.name)}</span><span>正在导入…</span></div>`);try{let book;if(apiMode&&!window.Capacitor?.isNativePlatform?.()){const form=new FormData();form.append('file',file);book=(await(await apiRequest('/api/import',{method:'POST',body:form})).json()).book}else{const item=queue.firstElementChild;const parsed=await parseLocalBook(file,ext,{onProgress:(page,total,phase)=>{if(item)item.lastElementChild.textContent=`${phase} ${page}/${total} 页`}});book={title:file.name.replace(/\.[^.]+$/,''),author:'本地导入',format,content:parsed.content,size:file.size,...parsed.metadata}}addBook(book);const item=queue.firstElementChild;if(item)item.innerHTML=`<span>${esc(file.name)}</span><span>已加入书架</span>`}catch(err){toast(`${file.name} 导入失败：${err.message}`)}}$('#fileInput').value=''}
let searchReserve=[];
function searchCard(d){const payload=encodeURIComponent(JSON.stringify({title:d.title||'网页正文',url:d.url,author:d.engine||'网页来源'}));const status=d.verified?`试读可读 · ${Number(d.readable_chars||0)} 字`:'搜索候选 · 尚未试读';return `<article class="result-item" data-result-url="${esc(d.url)}"><div class="result-copy"><strong class="result-title">${esc(d.title||'未命名')}</strong><p class="result-summary">${esc(d.content||'暂无摘要')}</p><span class="result-kind">${status}</span><span class="result-source">${esc(d.engine||new URL(d.url).hostname)}</span></div><div class="result-actions"><button class="result-add" type="button" data-search-action="add" data-search-book="${payload}">＋ 加入书架</button><button class="result-preview" type="button" data-search-action="preview" data-search-book="${payload}">试读</button><div class="result-utilities"><button type="button" data-copy-search-link="${esc(d.url)}">复制链接</button><button type="button" data-open-search-link="${esc(d.url)}">浏览器打开 ↗</button></div></div></article>`}
function appendSearchAlternatives({removeRow=null}={}){const host=$('#searchResults');if(removeRow)removeRow.remove();const shown=new Set([...host.querySelectorAll('.result-item')].map(row=>row.dataset.resultUrl)),picked=[];while(searchReserve.length&&picked.length<5){const item=searchReserve.shift();if(item?.url&&!shown.has(item.url)){shown.add(item.url);picked.push(item)}}if(picked.length)host.insertAdjacentHTML('beforeend',picked.map(searchCard).join(''));else toast('没有更多候选链接，请重新搜索其他关键词')}

let searchBusy=false, searchController=null, searchSequence=0;
function cancelActiveSearch(){if(searchController){searchController.abort();searchController=null;}searchSequence++;searchBusy=false;$('#cancelSearch')?.classList.add('hidden');const button=$('#discoverSubmit');if(button){button.disabled=false;button.textContent='搜索小说';}$('#discoverForm')?.removeAttribute('aria-busy');}
const searchEngineControl=$('#searchEngine');if(searchEngineControl){searchEngineControl.value=localStorage.getItem('shuyin.search-engine.v1')||'auto';searchEngineControl.closest('.engine-picker')?.classList.toggle('hidden',!directNative());searchEngineControl.addEventListener('change',()=>localStorage.setItem('shuyin.search-engine.v1',searchEngineControl.value))}
$('#cancelSearch')?.addEventListener('click',()=>{if(!searchBusy)return;cancelActiveSearch();$('#searchResults').innerHTML='<p class="form-hint">已停止等待本次搜索。</p>';});
// Smart search: search by title, then try the first candidate without a manual click.
const discoverForm=$('#discoverForm');
if(discoverForm){
 const smartLabel=document.createElement('label');smartLabel.className='search-verify-option';
 smartLabel.innerHTML='<input type="checkbox" id="smartAutoImport"> 自动试读并筛选（可选，不会加入书架）';
 discoverForm.insertAdjacentElement('afterend',smartLabel);
}
$('#discoverForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const q=$('#discoverInput').value.trim(),results=$('#searchResults'),button=$('#discoverSubmit');
  if(!q)return;
  if(searchBusy)cancelActiveSearch()
  recordSearch(q);searchReserve=[];
  if(!networkAvailable()){results.innerHTML='<p class="form-hint">当前设备无法连接网络；导入书籍和已缓存内容仍可离线使用。</p>';return}
  searchBusy=true;const seq=++searchSequence;searchController=new AbortController();const controller=searchController;button.disabled=false;button.textContent='重新搜索';$('#cancelSearch')?.classList.remove('hidden');$('#discoverForm').setAttribute('aria-busy','true');
  results.innerHTML=`<p class="form-hint">${directNative()?'正在由 iPhone 直连搜索引擎，读取网页候选…':'正在搜索并读取网页候选…'}</p>`;
  try{
    const quick=await(await apiRequest(`/api/search/quick?q=${encodeURIComponent(q)}`,{signal:controller.signal,searchEngine:searchEngineControl?.value||'auto'})).json();
    if(seq!==searchSequence)return;
    const candidates=quick.results||[],visible=candidates.slice(0,8),verify=$('#smartAutoImport')?.checked===true;
    searchReserve=candidates.slice(8).filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
    results.innerHTML=candidates.length?`<p class="form-hint">找到 ${candidates.length} 个候选，先显示 ${visible.length} 个。试读不会加入书架；可复制或在浏览器打开。</p>${visible.map(searchCard).join('')}`:'<p class="form-hint">没有找到候选网页，请调整书名后重试。</p>';
    if(!verify)return;
    let items=[],tested=0;
    if(directNative()){
      results.insertAdjacentHTML('afterbegin','<p class="form-hint" id="verifyProgress">按你的选择，在手机上试读候选并筛选可读正文…</p>');
      const queue=visible.slice(),accepted=[];
      const worker=async()=>{while(queue.length){const item=queue.shift();if(controller.signal.aborted)return;tested++;try{const response=await apiRequest('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:item.url}),signal:controller.signal}),data=await response.json(),quality=window.ShuyinDirectWeb.readableCandidate(data,q,item.title);if(response.ok&&quality.ok)accepted.push({...item,verified:true,readable_chars:quality.readable_chars});}catch(error){if(controller.signal.aborted)return}const progress=$('#verifyProgress');if(progress)progress.textContent=`正在筛选 ${tested}/${visible.length} 个候选；检查正文、目录噪声和书名匹配，不会加入书架…`}};
      await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));if(seq!==searchSequence)return;items=accepted;
    }else{
      const searchData=await(await apiRequest(`/api/search?q=${encodeURIComponent(q)}`,{signal:controller.signal})).json();if(seq!==searchSequence)return;items=searchData.results||[];tested=searchData.checked?.tested||0;searchReserve=[...(searchData.more_results||[]),...searchReserve];
    }
    if(items.length){results.innerHTML=`<p class="form-hint">试读筛选完成：${tested||visible.length} 个候选中，${items.length} 个正文可读。筛选只检查链接，不会入架。</p>${items.map(searchCard).join('')}`;}
    else if(candidates.length){results.innerHTML='<p class="form-hint">未筛选到可读正文。可手动试读候选，删除失败链接，或显示其他候选。</p>'+visible.map(searchCard).join('');}
    else{results.innerHTML='<div class="search-diagnostic"><strong>没有找到可读链接</strong><p>请尝试更准确的书名或作者。</p></div>';}

  }catch(err){if(seq!==searchSequence)return;if(err.name==='AbortError'){results.innerHTML='<p class="form-hint">搜索已取消</p>';return;}if(!results.querySelector('.result-item'))results.innerHTML=`<div class="search-diagnostic error"><strong>搜索失败</strong><p>${esc(err.message)}</p><p>书隐已恢复搜索按钮。请检查当前网络或稍后重试。</p></div>`}
  finally{if(seq===searchSequence){searchBusy=false;searchController=null;button.disabled=false;button.textContent='搜索小说';$('#cancelSearch')?.classList.add('hidden');$('#discoverForm').removeAttribute('aria-busy')}}
});
function googleSearchUrl(value){try{const u=new URL(value);return /(^|\.)google\.[a-z.]+$/i.test(u.hostname)&&u.pathname==='/search'&&!!u.searchParams.get('q')?u:null}catch{return null}}
function updateGoogleSerpHint(){const input=$('#urlInput'),btn=$('#urlSubmitButton'),help=$('#googleSerpHelp'),isGoogle=!!googleSearchUrl(input.value.trim());help?.classList.toggle('hidden',!isGoogle);if(btn)btn.textContent=isGoogle?'搜索此关键词':'读取页面'}
$('#urlInput')?.addEventListener('input',updateGoogleSerpHint);
const urlField=$('#urlInput');
if(urlField){
  const clearUrl=document.createElement('button');
  clearUrl.type='button';clearUrl.id='clearUrlInput';
  clearUrl.textContent='清空链接';
  clearUrl.setAttribute('aria-label','清空链接输入框');
  clearUrl.style.cssText='margin:8px 0;padding:8px 12px;border-radius:10px;border:1px solid #aaa;background:transparent;color:inherit;cursor:pointer;min-height:40px';
  urlField.insertAdjacentElement('afterend',clearUrl);
  clearUrl.addEventListener('click',()=>{urlField.value='';urlField.focus();updateGoogleSerpHint();const m=$('#urlMessage');if(m)m.textContent='链接已清空';});
}

// Separate health, direct and proxy checks: show each result as it arrives.
if(urlField){
  const testButton=document.createElement('button');
  testButton.type='button';testButton.textContent='检测链接连接';
  testButton.style.cssText='margin:8px;padding:8px 12px;border-radius:10px;border:1px solid #aaa;background:transparent;color:inherit;cursor:pointer;min-height:40px';
  urlField.insertAdjacentElement('afterend',testButton);
  testButton.addEventListener('click',async()=>{
    const msg=$('#urlMessage'),url=urlField.value.trim();
    if(!/^https?:\/\//i.test(url)){msg.textContent='请先输入完整的 http/https 网页链接';return;}
    if(!apiMode){msg.textContent='请通过 NAS 服务器版打开网络诊断';return;}
    testButton.disabled=true;
    const status={server:'检查中',direct:'等待中',proxy:'等待中'};
    const render=()=>{msg.textContent='阅读器接口：'+status.server+'；直连：'+status.direct+'；Mihomo代理：'+status.proxy;};
    const timedFetch=async(path,options,ms)=>{
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),ms);
      try{return await apiRequest(path,{...options,signal:ctrl.signal});}finally{clearTimeout(timer)}
    };
    const check=async(mode)=>{
      const key=mode==='direct'?'direct':'proxy';
      status[key]='检测中';render();
      try{
        const r=await timedFetch('/api/diagnose-url?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})},16000);
        const data=await r.json();
        if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'HTTP '+r.status);
        status[key]=data.result+(data.status?' (HTTP '+data.status+')':'');
      }catch(err){status[key]=err.name==='AbortError'?'16秒未收到诊断结果（可能是网关或后端阻塞）':err.message;}
      render();
    };
    try{
      render();
      try{
        const r=await timedFetch('/api/diagnose-health',{method:'GET'},4000);
        if(!r.ok)throw Error('HTTP '+r.status);
        const data=await r.json();status.server=data.ok?'正常':'异常';
        if(!data.proxy_configured)status.proxy='未配置代理';
      }catch(err){status.server=err.name==='AbortError'?'4秒无响应':err.message;status.direct='未执行';status.proxy='未执行';render();return;}
      render();
      await Promise.all([check('direct'),status.proxy==='未配置代理'?Promise.resolve():check('proxy')]);
    }finally{testButton.disabled=false;}
  });
}

$('#toggleManualImport')?.addEventListener('click',()=>$('#manualImportPanel')?.classList.toggle('hidden'));
$('#saveManualImport')?.addEventListener('click',()=>{const title=$('#manualImportTitle').value.trim()||'网页摘录',content=$('#manualImportContent').value.trim();if(content.replace(/\s/g,'').length<80){toast('正文太短，请至少粘贴 80 个字');return}const sourceUrl=$('#urlInput').value.trim();const book=addBook({title,author:'网页导入',format:'网页正文',content,sourceUrl:sourceUrl||undefined});$('#manualImportContent').value='';$('#manualImportPanel').classList.add('hidden');openBook(book.id)});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-search-action]');if(!b)return;const row=b.closest('.result-item'),info=JSON.parse(decodeURIComponent(b.dataset.searchBook)),action=b.dataset.searchAction,buttons=[...(row?.querySelectorAll('[data-search-action]')||[b])];buttons.forEach(x=>x.disabled=true);b.textContent='读取中…';try{const extracted=await(await apiRequest('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:info.url})})).json();if(!extracted.content||extracted.content.replace(/\s/g,'').length<80)throw Error('正文过短或页面无法读取');row?.querySelector('.result-failure-actions')?.remove();const chapters=extracted.chapters||((extracted.activeUrl||extracted.url)?[{title:extracted.chapterTitle||extracted.title||info.title,url:extracted.activeUrl||extracted.url}]:[]);const data={id:crypto.randomUUID(),title:extracted.title||info.title,author:extracted.author||info.author,format:'网页正文',content:extracted.content,sourceUrl:extracted.url,activeChapterUrl:extracted.activeUrl,currentChapterIndex:extracted.currentChapterIndex||0,currentChapterTitle:extracted.chapterTitle||'',chapters};if(action==='add'){const book=addBook(data);cacheAddedBook(book);toast(`《${book.title}》已加入书架，正在后台缓存；可继续搜索`)}else{const book={...data,ephemeral:true};previewBook=book;openBook(book.id);toast('已开始试读；这本书没有加入书架')}}catch(error){const message=error.message||'未知错误';if(row){let panel=row.querySelector('.result-failure-actions');if(!panel){panel=document.createElement('div');panel.className='result-failure-actions';row.append(panel)}panel.innerHTML=`<p class="form-hint">试读失败：${esc(message)}</p><button type="button" data-remove-failed-link>删除此链接</button><button type="button" data-remove-and-replenish>删除并补充其他链接</button>`}toast(`试读失败：${message}；未自动尝试其他链接`)}finally{buttons.forEach(x=>{x.disabled=false;x.textContent=x.dataset.searchAction==='add'?'＋ 加入书架':'试读'})}});
document.addEventListener('click',e=>{const remove=e.target.closest('[data-remove-failed-link]'),replace=e.target.closest('[data-remove-and-replenish]');if(remove){remove.closest('.result-item')?.remove();return}if(replace){appendSearchAlternatives({removeRow:replace.closest('.result-item')});return}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy-search-link]');if(b){const url=b.dataset.copySearchLink;try{await navigator.clipboard.writeText(url);toast('链接已复制，可粘贴到浏览器')}catch{prompt('复制此链接到浏览器打开：',url)}return}const link=e.target.closest('[data-open-search-link]');if(link){e.preventDefault();const url=link.dataset.openSearchLink;try{const browser=window.ShuyinBrowser||window.Capacitor?.Plugins?.Browser;if(browser?.open)await browser.open({url,toolbarColor:'#f7f6f2'});else window.open(url,'_blank','noopener,noreferrer')}catch{prompt('无法自动打开，请复制链接到浏览器：',url)}}});
document.addEventListener('click',e=>{const repeat=e.target.closest('[data-repeat-search]'),removeSearch=e.target.closest('[data-remove-search]'),clearReading=e.target.closest('[data-clear-reading]');if(repeat){const q=searchHistory[Number(repeat.dataset.repeatSearch)];if(q){$('#discoverInput').value=q;$('#discoverForm').requestSubmit()}}if(removeSearch){searchHistory.splice(Number(removeSearch.dataset.removeSearch),1);persistSearchHistory()}if(clearReading){const book=books.find(b=>b.id===clearReading.dataset.clearReading);if(book){delete book.openedAt;delete book.progress;save()}}});
$('#clearSearchHistory')?.addEventListener('click',()=>{searchHistory=[];persistSearchHistory()});$('#clearReadingHistory')?.addEventListener('click',()=>{if(!confirm('清除所有阅读记录和阅读进度？书籍仍会保留在书架。'))return;books.forEach(book=>{delete book.openedAt;delete book.progress});save()});
let urlImportController=null;
const urlImportForm=$('#urlForm');
if(urlImportForm){
 const stop=document.createElement('button');stop.type='button';stop.id='cancelUrlImport';stop.textContent='取消整理';
 stop.style.cssText='margin:8px;padding:8px 12px;border:1px solid #aaa;border-radius:10px;background:transparent;color:inherit;cursor:pointer;min-height:40px';
 stop.hidden=true;urlImportForm.appendChild(stop);
 stop.addEventListener('click',()=>{if(urlImportController){urlImportController.abort();urlImportController=null;}stop.hidden=true;const m=$('#urlMessage');if(m)m.textContent='已取消本次整理';});
}
$('#urlForm')?.addEventListener('submit',async e=>{e.preventDefault();const url=$('#urlInput').value.trim(),msg=$('#urlMessage'),google=googleSearchUrl(url);if(google){const query=google.searchParams.get('q')?.trim();if(!query){msg.textContent='没有从 Google 链接中读到搜索词，请直接输入书名搜索。';return}$('#discoverInput').value=query;msg.textContent=`已读取搜索词“${query}”，正在由手机搜索引擎查找候选…`;navigate('discover');$('#discoverForm').requestSubmit();return}msg.textContent='正在读取网页；目录页会快速尝试章节，遇到无法访问的站点将明确报错…';try{let book,extracted=null;if(networkAvailable()){if(urlImportController)urlImportController.abort();
const ctrl=new AbortController();urlImportController=ctrl;
const cancelBtn=$('#cancelUrlImport');if(cancelBtn)cancelBtn.hidden=false;
const timeout=setTimeout(()=>ctrl.abort(),22000);
try{
 const response=await apiRequest('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:ctrl.signal});
 const data=await response.json();
 if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:`服务器返回 HTTP ${response.status}`);
 if(ctrl.signal.aborted)throw new DOMException('已取消','AbortError');
 extracted=data;
}finally{clearTimeout(timeout);if(urlImportController===ctrl)urlImportController=null;if(cancelBtn)cancelBtn.hidden=true};book=addBook({title:extracted.title,author:extracted.author,format:'网页正文',content:extracted.content,sourceUrl:extracted.url,activeChapterUrl:extracted.activeUrl,currentChapterIndex:extracted.currentChapterIndex||0,currentChapterTitle:extracted.chapterTitle||'',chapters:extracted.chapters||[]})}else{const res=await fetch(url,{credentials:'omit'});if(!res.ok)throw Error('页面不可访问');const html=await res.text(),doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style,nav,header,footer,aside,form,iframe,button,[class*=ad],[id*=ad]').forEach(n=>n.remove());const main=doc.querySelector('article,main')||doc.body;const title=(doc.querySelector('h1')?.textContent||doc.title||new URL(url).hostname).trim();const text=(main.innerText||main.textContent||'').replace(/\n{3,}/g,'\n\n').trim();if(text.length<80)throw Error('页面没有检测到足够的正文');book=addBook({title,author:new URL(url).hostname,format:'网页正文',content:text,sourceUrl:url})}msg.textContent=`已整理《${book.title}》${(extracted.chapters||[]).length?`，识别到 ${(extracted.chapters||[]).length} 个章节，当前打开：${extracted.chapterTitle||'首个可读章节'}`:''}，正在打开阅读页。`;openBook(book.id)}catch(err){if(urlImportController&&urlImportController.signal.aborted)return;msg.textContent=`${err.name==='AbortError'?'已取消或超过22秒，停止等待':'读取失败：'+err.message}。请检查手机网络；如果已配置 NAS，也可让它作为备用网页解析服务。`}});
updateGoogleSerpHint();
function applyTheme(theme=currentTheme){const allowed=['paper','white','green','night'];currentTheme=allowed.includes(theme)?theme:'paper';localStorage.setItem('zhijian.theme',currentTheme);document.body.classList.remove('theme-white','theme-green','theme-night');if(currentTheme!=='paper')document.body.classList.add(`theme-${currentTheme}`);$$('[data-theme]').forEach(x=>x.classList.toggle('selected',x.dataset.theme===currentTheme));document.querySelector('meta[name="theme-color"]')?.setAttribute('content',({paper:'#f7f6f2',white:'#ffffff',green:'#edf2eb',night:'#232620'})[currentTheme])}applyTheme();$$('[data-theme]').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.theme)));function changeFont(n){const oldTotal=readerPages.length,oldPage=readerPageIndex;const ratio=oldTotal>1?oldPage/(oldTotal-1):0;fontSize=Math.max(14,Math.min(30,fontSize+n));localStorage.setItem('zhijian.readerFontSize',String(fontSize));$('#fontSizeLabel').textContent=`${fontSize}px`;$('#reader').style.setProperty('--reader-size',`${fontSize}px`);if(readerMode==='page'&&currentBook){renderReaderContent();readerPageIndex=Math.round(ratio*Math.max(0,readerPages.length-1));renderReaderContent();persistPagedProgress()}}$('#fontDown')?.addEventListener('click',()=>changeFont(-1));$('#fontUp')?.addEventListener('click',()=>changeFont(1));$('#readerFontDown')?.addEventListener('click',()=>changeFont(-1));$('#readerFontUp')?.addEventListener('click',()=>changeFont(1));$('#readerTheme')?.addEventListener('click',()=>{const themes=['paper','white','green','night'];applyTheme(themes[(themes.indexOf(currentTheme)+1)%themes.length])});$('#reader')?.addEventListener('scroll',()=>{if(!currentBook||$('#reader').classList.contains('hidden'))return;clearTimeout(readingSaveTimer);readingSaveTimer=setTimeout(()=>{const panel=$('#reader'),span=panel.scrollHeight-panel.clientHeight;if(span>0){const progress=Math.min(100,Math.round(panel.scrollTop/span*100));if(progress!==currentBook.progress){currentBook.progress=progress;currentBook.openedAt=Date.now();persistReadingProgress()}}},700)});let readerLayoutTimer;window.addEventListener('resize',()=>{if(readerMode!=='page'||!currentBook||$('#reader').classList.contains('hidden'))return;clearTimeout(readerLayoutTimer);readerLayoutTimer=setTimeout(()=>{const ratio=readerPages.length>1?readerPageIndex/(readerPages.length-1):0;readerPages=paginateReaderBlocks(readerBlocks);readerPageIndex=Math.round(ratio*Math.max(0,readerPages.length-1));renderReaderContent();persistPagedProgress()},160)});$('#closeReader')?.addEventListener('click',()=>{chapterRequestId++;showChapterLoading('');persistCurrentReadingPosition();$('#reader').classList.add('hidden')});$('#addCurrentBookToShelf')?.addEventListener('click',()=>{if(!currentBook?.ephemeral)return;const book=currentBook;delete book.ephemeral;previewBook=null;books.unshift(book);save();cacheAddedBook(book);$('#addCurrentBookToShelf').classList.add('hidden');toast(`《${book.title}》已加入书架，正在后台缓存`)});;document.addEventListener('visibilitychange',()=>{if(document.hidden&&!$('#reader').classList.contains('hidden'))persistCurrentReadingPosition()});window.addEventListener('pagehide',()=>{if(!$('#reader').classList.contains('hidden'))persistCurrentReadingPosition()});
$('#addShelf')?.addEventListener('click',()=>{const name=prompt('给新书架起个名字');if(!name?.trim())return;toast(`已创建书架“${name.trim()}”`)});
$('#exportLibrary')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify({format:'shuyin-local-backup',version:1,exportedAt:new Date().toISOString(),books},null,2)],{type:'application/json'});const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`书隐书库备份-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)});$('#backupInput')?.addEventListener('change',async e=>{const file=e.target.files?.[0];try{if(!file||file.size>150*1024*1024)throw Error('备份文件为空或超过 150MB');const data=JSON.parse(await file.text());if(!Array.isArray(data.books)||data.books.length>20000)throw Error('备份格式或记录数量异常');const incoming=data.books,seen=new Set();for(const b of incoming){if(!b||typeof b.title!=='string'||typeof b.content!=='string'||b.id!=null&&typeof b.id!=='string'||b.chapters!=null&&!Array.isArray(b.chapters)||b.tags!=null&&!Array.isArray(b.tags))throw Error('备份包含无效书籍记录');if(!b.id)b.id=crypto.randomUUID();if(seen.has(b.id))throw Error('备份中存在重复书籍 ID');seen.add(b.id)}const replacements=incoming.filter(b=>books.some(x=>x.id===b.id)),additions=incoming.filter(b=>!books.some(x=>x.id===b.id)&&!books.some(x=>x.title===b.title&&x.format===b.format));if(!confirm(`备份包含 ${incoming.length} 本书；将新增 ${additions.length} 本、更新 ${replacements.length} 本同 ID 记录，并跳过书名与格式都重复的条目。继续恢复？`))return;const map=new Map(books.map(b=>[b.id,b]));for(const b of incoming){const old=map.get(b.id);if(old){if(Number(b.updatedAt||0)>=Number(old.updatedAt||0))map.set(b.id,b)}else if(!books.some(x=>x.title===b.title&&x.format===b.format))map.set(b.id,b)}books=[...map.values()];save();toast(`书库恢复完成：新增 ${additions.length} 本，更新 ${replacements.length} 本`)}catch(err){toast(`恢复失败：${err.message}`)}finally{e.target.value=''}});

let readerSourceCandidates=[],readerSourceBusy=false,readerSourceController=null;
function readerSourceStatus(message){const node=$('#readerSourceStatus');if(node)node.textContent=message}
function sourceLooksReadable(data){
 const body=String(data?.content||'').trim(),flat=body.replace(/\s/g,'');
 if(flat.length<220)return false;
 if(/(验证码|访问频繁|人机验证|安全验证|请先登录|403 forbidden|404 not found|502 bad gateway)/i.test(body.slice(0,500))&&flat.length<1200)return false;
 const paras=body.split(/\n\s*\n/).filter(x=>x.trim().length>25);
 return paras.length>=2||flat.length>=900;
}
async function findReaderSources(){
 if(!currentBook||!networkAvailable())return;
 if(readerSourceController)readerSourceController.abort();
 const controller=new AbortController();readerSourceController=controller;
 readerSourceBusy=true;readerSourceStatus('正在查找其他书源…');
 $('#readerSourceList').innerHTML='';
 $('#readerSourceRetry').disabled=true;
 try{
  const query=(currentBook.originalSearchTitle||currentBook.title||'').replace(/(?:第.{1,12}[章节]).*$/,'').trim();
  const data=await(await apiRequest('/api/search/quick?q='+encodeURIComponent(query),{signal:controller.signal})).json();
  if(controller!==readerSourceController)return;
  const unique=new Set();
  readerSourceCandidates=(data.results||[]).sort((a,b)=>(Number(b.chapter_count||0)-Number(a.chapter_count||0))||(Number(b.readable_chars||0)-Number(a.readable_chars||0))).filter(x=>{if(!x.url||unique.has(x.url)||x.url===currentBook.sourceUrl)return false;unique.add(x.url);return true}).slice(0,18);
  readerSourceStatus(readerSourceCandidates.length?`找到 ${readerSourceCandidates.length} 个其他来源，选择一个或自动试读。`:'暂未找到其他来源，可重新搜索。');
  $('#readerSourceList').innerHTML=readerSourceCandidates.map((x,i)=>`<button class="reader-source-item" data-reader-source="${i}"><strong>${esc(x.title||'候选书源')}</strong><small>${esc((()=>{try{return new URL(x.url).hostname}catch{return '未知网站'}})())}</small></button>`).join('');
  if(readerSourceCandidates.length)$('#readerSourceList').insertAdjacentHTML('beforeend','<button class="reader-source-auto" id="readerSourceAuto">自动逐个试读并换源</button>');
 }catch(e){if(e.name!=='AbortError')readerSourceStatus('查找失败：'+e.message)}
 finally{if(controller===readerSourceController){readerSourceBusy=false;$('#readerSourceRetry').disabled=false}}
}
async function swapReaderSource(indices){
 if(!currentBook||readerSourceBusy)return;
 const book=currentBook;readerSourceBusy=true;
 $('#readerSourceRetry').disabled=true;
 const buttons=$$('#readerSourceList button');buttons.forEach(b=>b.disabled=true);
 let failure='没有可用正文';
 try{
  for(let j=0;j<indices.length;j++){
   if(currentBook!==book)break;
   const item=readerSourceCandidates[indices[j]];
   if(!item)continue;
   readerSourceStatus(`正在试读 ${j+1}/${indices.length}：${item.title||item.url}`);
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),21000);
   try{
    const data=await(await apiRequest('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:item.url}),signal:ctrl.signal})).json();
    if(!sourceLooksReadable(data))throw Error('网页内容不完整或正文过短');
    const score=estimateReaderQuality(data.content,data.chapters);
    if(score.score<38)throw Error('质量检测未通过：'+score.issues.join('、'));
    if(currentBook!==book)return;
    // Only commit after successful extraction; keep the book ID and existing shelf.
    book.originalSearchTitle=book.originalSearchTitle||book.title;
    book.sourceUrl=data.url||item.url;
    book.activeChapterUrl=data.activeUrl||data.url||item.url;
    book.chapters=data.chapters||[];
    book.content=data.content;
    book.currentChapterIndex=data.currentChapterIndex||0;
    book.currentChapterTitle=data.chapterTitle||'';
    book.pageIndex=0;book.progress=0;
    currentChapterIndex=book.currentChapterIndex;
    loadedChapterIndexes=new Set([currentChapterIndex]);noMoreChapters=false;readerPageIndex=0;
    $('#readerTitle').textContent=book.currentChapterTitle||book.title;
    $('#readerMeta').textContent=`${book.author||'未知作者'} · 网页正文 · ${new URL(book.sourceUrl).hostname}`;
    renderReaderContent();$('#reader').scrollTop=0;save();
    $('#readerSourcePanel').classList.add('hidden');
    toast('换源成功，已更新当前书籍');
    return;
   }catch(e){failure=e.name==='AbortError'?'该书源响应超时':e.message}
   finally{clearTimeout(timer)}
  }
  readerSourceStatus('未找到完整正文：'+failure+'。原书和阅读进度未改变。');
 }finally{readerSourceBusy=false;$('#readerSourceRetry').disabled=false;buttons.forEach(b=>b.disabled=false)}
}
$('#readerChangeSource')?.addEventListener('click',()=>{const panel=$('#readerSourcePanel');const show=panel.classList.contains('hidden');panel.classList.toggle('hidden',!show);if(show)findReaderSources()});
$('#readerSourceClose')?.addEventListener('click',()=>$('#readerSourcePanel').classList.add('hidden'));
$('#readerSourceRetry')?.addEventListener('click',findReaderSources);
document.addEventListener('click',e=>{
 const candidate=e.target.closest('[data-reader-source]');
 if(candidate){swapReaderSource([Number(candidate.dataset.readerSource)]);return}
 if(e.target.closest('#readerSourceAuto'))swapReaderSource(readerSourceCandidates.map((_,i)=>i));
});


function estimateReaderQuality(content,chapters){
 const text=String(content||'').replace(/\s/g,'');const issues=[];
 if(text.length<250)issues.push('正文偏短');
 if(/验证码|人机验证|访问频繁|登录后阅读|404 not found/i.test(text.slice(0,700)))issues.push('疑似拦截页面');
 if(text.length>300&&new Set([...text.slice(0,1000)]).size<25)issues.push('文字重复异常');
 if(!chapters?.length)issues.push('未识别目录');
 return {score:Math.max(0,Math.min(100,Math.round(40+Math.min(text.length,2000)/100+Math.min(chapters?.length||0,60)*.65-issues.length*12))),issues};
}
function showReaderQuality(){
 const el=$('#readerQuality');if(!el||!currentBook)return;
 const q=estimateReaderQuality(currentBook.content,currentBook.chapters);
 el.textContent=`质量参考 ${q.score}分 · ${q.issues.length?q.issues.join('、'):'正文初检正常'}`;
 el.title='启发式检测，不代表整本书已验证完整';
}
const baseRenderReaderContent=renderReaderContent;
renderReaderContent=function(){baseRenderReaderContent();showReaderQuality()};
let currentCacheTask='',cachePolling=null;
async function startFullCache(){
 if(window.Capacitor?.isNativePlatform?.()){window.ShuyinOfflineDownload?.start(currentBook);return}
 if(!networkAvailable()||!currentBook?.chapters?.length){toast('请先联网并导入带章节目录的网页小说');return}
 try{const r=await(await apiRequest('/api/cache/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({book_id:currentBook.id,chapters:currentBook.chapters})})).json();
 currentCacheTask=r.task_id;$('#readerCacheStart').disabled=true;$('#readerCacheCancel').classList.remove('hidden');
 clearInterval(cachePolling);cachePolling=setInterval(pollCache,1500);pollCache();
 }catch(e){toast('缓存任务启动失败：'+e.message)}
}
async function pollCache(){if(!currentCacheTask)return;
 try{const r=await(await apiRequest('/api/cache/status/'+encodeURIComponent(currentCacheTask))).json();
 $('#readerCacheProgress').textContent=`缓存 ${r.done}/${r.total} 章，失败 ${r.failed} · ${r.status}`;
 if(r.status!=='running'){clearInterval(cachePolling);$('#readerCacheStart').disabled=false;$('#readerCacheCancel').classList.add('hidden');}}
 catch(e){clearInterval(cachePolling);$('#readerCacheStart').disabled=false;toast(e.message)}
}
$('#readerCacheStart')?.addEventListener('click',startFullCache);
$('#readerExportEpub')?.addEventListener('click',async()=>{if(!currentBook)return;const button=$('#readerExportEpub');button.disabled=true;button.textContent='准备 EPUB…';try{await window.ShuyinEbookExport.export(currentBook)}catch(e){toast(`导出失败：${e.message}`)}finally{button.disabled=false;button.textContent='导出 EPUB'}});
$('#readerCacheCancel')?.addEventListener('click',async()=>{if(currentCacheTask)await apiRequest('/api/cache/cancel/'+encodeURIComponent(currentCacheTask),{method:'POST'});});
// Attempt chapter repair only when a same-number/title match exists; never silently substitute a different chapter.
$('#readerRepairChapter')?.addEventListener('click',async()=>{
 if(!currentBook||!networkAvailable())return;
 const target=currentBook.chapters?.[currentChapterIndex];
 if(!target){toast('没有当前章节目录，建议使用「换源」');return}
 const button=$('#readerRepairChapter');button.disabled=true;
 try{
  const query=currentBook.originalSearchTitle||currentBook.title;
  const hits=(await(await apiRequest('/api/search/quick?q='+encodeURIComponent(query))).json()).results||[];
  const targetNum=(target.title||'').match(/第[零〇一二三四五六七八九十百千万两\d]+[章节回]/)?.[0];
  if(!targetNum){toast('无法确定章节编号，请手动换源以免串章');return}
  for(const hit of hits.slice(0,8)){
   if(hit.url===currentBook.sourceUrl)continue;
   try{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),18000);
    let d;try{d=await(await apiRequest('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:hit.url}),signal:ctrl.signal})).json()}finally{clearTimeout(timer)}
    const matched=(d.chapters||[]).find(x=>String(x.title||'').includes(targetNum));
    if(!matched)continue;
    const chapter=(await(await apiRequest('/api/chapter?url='+encodeURIComponent(matched.url))).json());
    if(!sourceLooksReadable(chapter))continue;
    currentBook.content=chapter.content;currentBook.currentChapterTitle=target.title;
    currentBook.repairedChapters=currentBook.repairedChapters||{};
    currentBook.repairedChapters[currentChapterIndex]={url:matched.url,content:chapter.content,title:target.title};
    readerPageIndex=0;renderReaderContent();save();toast('本章修复成功，已保存在书库');return;
   }catch(e){}
  }
  toast('没有找到编号匹配的可用章节，原文未修改');
 }catch(e){toast('修复失败：'+e.message)}finally{button.disabled=false}
});

$('#readerMode')?.addEventListener('change',e=>{const panel=$('#reader'),span=Math.max(0,panel.scrollHeight-panel.clientHeight),scrollRatio=span?panel.scrollTop/span:0,pageRatio=readerPages.length>1?readerPageIndex/(readerPages.length-1):0;readerMode=e.target.value;localStorage.setItem('zhijian.readerMode',readerMode);if(readerMode==='page'){renderReaderContent();readerPageIndex=Math.round(scrollRatio*Math.max(0,readerPages.length-1));renderReaderContent();persistPagedProgress()}else{renderReaderContent();requestAnimationFrame(()=>{const max=Math.max(0,panel.scrollHeight-panel.clientHeight);panel.scrollTop=max*pageRatio})}});
$('#readerNext')?.addEventListener('click',async()=>{if(readerMode==='page'){if(readerPageIndex<readerPages.length-1){turnReaderPage(readerPageIndex+1);return}if(!currentBook?.activeChapterUrl&&!remoteChapters().length){toast('已经是最后一页');return}}await advanceChapter(false)});
$('#readerPrev')?.addEventListener('click',async()=>{if(readerMode==='page'&&readerPageIndex>0){turnReaderPage(readerPageIndex-1);return}const index=currentChapterIndex-1;if(index<0){toast('已经是第一章');return}if(readerMode==='scroll'){const section=$(`#readerContent [data-remote-chapter="${index}"]`);if(section){section.scrollIntoView({behavior:'smooth',block:'start'});return}}await loadRemoteChapter(index,false)});
$('#readerToc')?.addEventListener('click',()=>$('#readerTocPanel').classList.toggle('hidden'));
document.addEventListener('click',e=>{const remote=e.target.closest('[data-toc-remote]'),local=e.target.closest('[data-toc-local]');if(remote){const index=Number(remote.dataset.tocRemote);$('#readerTocPanel').classList.add('hidden');if(readerMode==='scroll'){const section=$(`#readerContent [data-remote-chapter="${index}"]`);if(section){section.scrollIntoView({behavior:'smooth',block:'start'});return}}loadRemoteChapter(index,false)}else if(local){$('#readerTocPanel').classList.add('hidden');const index=Number(local.dataset.tocLocal);if(readerMode==='page'){const page=readerPages.findIndex(items=>items.some(item=>item.text===readerBlocks[index]?.text));if(page>=0)turnReaderPage(page)}else $(`#local-chapter-${index}`)?.scrollIntoView({behavior:'smooth',block:'start'})}});
let autoLoadReady=true;
$('#reader')?.addEventListener('scroll',()=>{if($('#reader').classList.contains('hidden')||readerMode!=='scroll')return;const panel=$('#reader'),nearBottom=panel.scrollHeight-panel.scrollTop-panel.clientHeight<420;if(!nearBottom){autoLoadReady=true;return}if(autoLoadReady&&!chapterLoading&&!noMoreChapters&&(remoteChapters().length||currentBook?.activeChapterUrl)){autoLoadReady=false;advanceChapter(true)}});
// Wire bookshelf filters and settings shortcuts.
$('#shelfList')?.addEventListener('click',e=>{const item=e.target.closest('[data-shelf]');if(!item)return;activeShelf=item.dataset.shelf;$('#librarySearch').value='';$('#sortBooks').value='recent';navigate('home');$('#pageTitle').textContent=activeShelf;render()});
$$('.settings-tab').forEach((tab,index)=>tab.addEventListener('click',()=>{const targets=['#settings-reading','#settings-backup','#settings-nas'];$$('.settings-tab').forEach(x=>x.classList.toggle('selected',x===tab));$(targets[index]).scrollIntoView({behavior:'smooth',block:'start'})}));
$('#testGoogle')?.addEventListener('click',async e=>{const button=e.currentTarget,label=$('#googleTestResult');button.disabled=true;button.textContent='检测中…';label.textContent='正在从 iPhone 本机测试网络…';label.classList.remove('success','failure');try{let reachable=false,latency=0;if(window.Capacitor?.isNativePlatform?.()&&window.CapacitorHttp?.request){const start=performance.now(),response=await window.CapacitorHttp.request({url:'https://www.google.com/generate_204',method:'GET',connectTimeout:8000,readTimeout:8000});latency=Math.round(performance.now()-start);reachable=response.status===204||response.status===200}else{const start=performance.now(),response=await fetch('https://www.google.com/generate_204',{mode:'no-cors'});latency=Math.round(performance.now()-start);reachable=response.type==='opaque'||response.ok}label.textContent=`${reachable?'手机可以访问 Google':'手机暂时无法访问 Google'} · ${latency} ms`;label.classList.add(reachable?'success':'failure')}catch(error){label.textContent=`手机网络检测失败：${error.message}`;label.classList.add('failure')}finally{button.disabled=false;button.textContent='重新测试'}});
window.render=render;window.toast=toast;window.saveCurrentBook=save;window.getBooks=()=>books;window.renderReaderContent=renderReaderContent;window.openBookById=openBook;window.getReadingState=()=>({mode:readerMode,page:readerPageIndex,total:readerPages.length,chapter:currentChapterIndex});window.setReaderPage=index=>turnReaderPage(index);window.goToReaderPage=delta=>window.setReaderPage(readerPageIndex+Number(delta||0));window.jumpToBookLocation=async(id,chapter,quote,progress)=>{const b=books.find(x=>String(x.id)===String(id));if(!b)return false;openBook(b.id);const i=Math.max(0,Number(chapter)||0);if(i!==Number(currentBook?.currentChapterIndex||0)&&currentBook?.chapters?.[i])await loadRemoteChapter(i,false);requestAnimationFrame(()=>{if(readerMode==='page'){let page=-1;if(quote){page=readerPages.findIndex(items=>items.some(item=>item.text.includes(quote)))}if(page<0&&Number.isFinite(Number(progress))&&Number(progress)>0)page=Math.round(Number(progress)/100*Math.max(0,readerPages.length-1));if(page>=0)readerPageIndex=page;renderReaderContent();persistPagedProgress()}else if(Number.isFinite(Number(progress))&&Number(progress)>0){const r=document.querySelector('#reader');r.scrollTop=Math.max(0,r.scrollHeight-r.clientHeight)*Number(progress)/100}if(quote){const root=document.querySelector('#readerContent'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(n.nodeValue.includes(quote)){n.parentElement?.scrollIntoView({behavior:'smooth',block:'center'});break}}}});return true};window.replaceBooks=rows=>{const activeId=currentBook?.id;books=rows;currentBook=activeId?books.find(x=>x.id===activeId)||null:null;render()};Object.defineProperty(window,'currentBook',{get:()=>currentBook});Object.defineProperty(window,'apiMode',{get:()=>apiMode,set:v=>{apiMode=!!v}});renderSearchHistory();initializeLibrary().then(()=>{window.__shuyinBoot?.done();window.ShuyinNas?.boot()}).catch(error=>{window.__shuyinBoot?.note('书库初始化失败：'+(error&&error.message||error));console.error('书库初始化失败',error)});
