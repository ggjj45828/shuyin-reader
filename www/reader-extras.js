/* r47 additive reading features; deliberately leaves r44 reading/network code intact */
(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let speech=null, timer=null, activeSince=0,activeBookId=null, lastSave=0;
const current=()=>typeof currentBook!=='undefined'?currentBook:null;
const persist=()=>{if(typeof save==='function')save()};
const body=()=>$('#readerExtraBody');
function panel(title,markup){$('#readerExtraTitle').textContent=title;body().innerHTML=markup;$('#readerExtraPanel').classList.remove('hidden')}
function progress(){const b=current();if(!b)return 0;return Math.max(0,Math.min(100,Number(b.progress||0)))}
function flushStats(){if(!activeSince||!activeBookId)return;const b=(typeof books!=='undefined'?books:[]).find(x=>String(x.id)===String(activeBookId));if(!b)return;const seconds=Math.max(0,Math.min(120,Math.round((Date.now()-activeSince)/1000)));activeSince=Date.now();if(seconds<3)return;b.readSeconds=(b.readSeconds||0)+seconds;b.lastReadAt=Date.now();if(Date.now()-lastSave>45000){lastSave=Date.now();persist()}}
function readerOpen(){return !$('#reader').classList.contains('hidden')}
setInterval(()=>{if(readerOpen()&&document.visibilityState==='visible'){const b=current();if(b){if(activeBookId!==b.id){flushStats();activeBookId=b.id;activeSince=Date.now()}else flushStats()}}else{flushStats();activeSince=0;activeBookId=null}},15000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){flushStats();activeSince=0}else if(readerOpen()&&current()){activeBookId=current().id;activeSince=Date.now()}});
window.addEventListener('pagehide',flushStats);
$('#readerExtraClose').addEventListener('click',()=>$('#readerExtraPanel').classList.add('hidden'));
// r48: use only voices actually provided by the browser/OS.
let ttsRun=0, ttsChunks=[], ttsIndex=0, ttsPaused=false, ttsSleep=null, ttsBookId=null, ttsChapter=null;
const ttsStore='zhijian_tts_settings_v1';
function ttsSettings(){try{return Object.assign({voice:'',rate:1,sleep:0,continuous:false},JSON.parse(localStorage.getItem(ttsStore)||'{}'))}catch{return {voice:'',rate:1,sleep:0,continuous:false}}}
function ttsSave(patch){const next={...ttsSettings(),...patch};localStorage.setItem(ttsStore,JSON.stringify(next));return next}
function voiceList(){return 'speechSynthesis'in window?window.speechSynthesis.getVoices().filter(v=>/^zh(?:-|_)/i.test(v.lang)||/Chinese|Mandarin|中文|普通话|粤语/i.test(v.name)):[]}
function selectedVoice(){const s=ttsSettings(),all=voiceList();return all.find(v=>v.voiceURI===s.voice)||all.find(v=>v.lang==='zh-CN')||all[0]||null}
function ttsButtons(){const btn=$('#readerTts');if(btn)btn.textContent=speech?(ttsPaused?'▶ 继续听书':'Ⅱ 暂停听书'):'▶ 听书'}
function stopSpeech(){ttsRun++;if(ttsSleep){clearTimeout(ttsSleep);ttsSleep=null}if('speechSynthesis'in window)window.speechSynthesis.cancel();speech=null;ttsPaused=false;ttsChunks=[];ttsIndex=0;ttsButtons()}
function splitTtsText(text){const paragraphs=String(text||'').replace(/\r/g,'').split(/\n+/).map(x=>x.trim()).filter(Boolean);const pieces=[];for(const p of paragraphs){let buf='';for(const segment of p.match(/[^。！？；!?;]+[。！？；!?;]?|.+/g)||[p]){if((buf+segment).length>170&&buf){pieces.push(buf);buf=''}while(segment.length>190){pieces.push(segment.slice(0,160));segment=segment.slice(160)}buf+=segment}if(buf)pieces.push(buf)}return pieces}
function speakPreview(){if(!('speechSynthesis'in window))return;const synth=window.speechSynthesis;synth.cancel();const u=new SpeechSynthesisUtterance('你好，欢迎使用书隐阅读器。这是当前声音的试听效果。');const v=selectedVoice();if(v)u.voice=v;u.lang=v?.lang||'zh-CN';u.rate=ttsSettings().rate;synth.speak(u)}
function ttsScheduleSleep(){if(ttsSleep){clearTimeout(ttsSleep);ttsSleep=null}const minutes=Number(ttsSettings().sleep||0);if(minutes>0)ttsSleep=setTimeout(()=>{stopSpeech();if(typeof toast==='function')toast('听书定时已结束')},minutes*60000)}
async function ttsNextChapter(run){
 const b=current();if(!b||run!==ttsRun||!ttsSettings().continuous)return false;
 const old=Number(b.currentChapterIndex??0);
 if(!Array.isArray(b.chapters)||old>=b.chapters.length-1)return false;
 const next=$('#readerNext');if(!next||next.disabled)return false;
 next.click();
 // The reader's chapter request is asynchronous; never read stale chapter text.
 for(let i=0;i<40&&run===ttsRun;i++){
  await new Promise(resolve=>setTimeout(resolve,350));
  const now=current();if(now&&Number(now.currentChapterIndex??0)!==old&&String(now.content||'').trim().length>50){startSpeech();return true}
 }
 return false;
}
function speakChunk(run){if(run!==ttsRun||!speech||ttsPaused)return;
 if(ttsIndex>=ttsChunks.length){ttsNextChapter(run).then(ok=>{if(!ok&&run===ttsRun)stopSpeech()});return}
 const utter=new SpeechSynthesisUtterance(ttsChunks[ttsIndex++]);const v=selectedVoice();if(v)utter.voice=v;utter.lang=v?.lang||'zh-CN';utter.rate=Number(ttsSettings().rate)||1;
 utter.onend=()=>speakChunk(run);utter.onerror=e=>{if(e.error==='interrupted'||e.error==='canceled')return;stopSpeech()};
 window.speechSynthesis.speak(utter);
}
function startSpeech(){if(!('speechSynthesis'in window)){alert('当前浏览器不支持语音朗读');return}const b=current(),text=String(b?.content||'').trim();if(!text){alert('当前章节没有可朗读正文');return}
 stopSpeech();ttsChunks=splitTtsText(text);if(!ttsChunks.length)return;ttsBookId=b.id;ttsChapter=b.currentChapterIndex;speech={};ttsPaused=false;ttsIndex=0;ttsButtons();ttsScheduleSleep();speakChunk(ttsRun)}
$('#readerTts').addEventListener('click',()=>{if(!speech){startSpeech();return}if(ttsPaused){window.speechSynthesis.resume();ttsPaused=false}else{window.speechSynthesis.pause();ttsPaused=true}ttsButtons()});
function renderTtsSettings(){const s=ttsSettings(),voices=voiceList();panel('听书声音与播放设置',`<div class="tts-settings"><label for="ttsVoice">朗读声音</label><select id="ttsVoice"><option value="">自动选择中文声音</option>${voices.map(v=>`<option value="${esc(v.voiceURI)}" ${s.voice===v.voiceURI?'selected':''}>${esc(v.name)} · ${esc(v.lang)}${v.localService?' · 本地':''}</option>`).join('')}</select><small>${voices.length?`当前浏览器检测到 ${voices.length} 个中文音色`:'当前浏览器暂未返回中文音色；可稍后刷新声音列表。'}</small><label for="ttsRate">语速 <span id="ttsRateLabel">${s.rate.toFixed(1)}×</span></label><input id="ttsRate" type="range" min="0.5" max="2" step="0.1" value="${s.rate}"><label for="ttsSleep">定时关闭</label><select id="ttsSleep">${[0,15,30,60].map(x=>`<option value="${x}" ${s.sleep===x?'selected':''}>${x?x+' 分钟':'不定时'}</option>`).join('')}</select><label class="tts-check"><input id="ttsContinuous" type="checkbox" ${s.continuous?'checked':''}> 本章结束自动朗读下一章（实验功能）</label><div class="tts-actions"><button id="ttsPreview" type="button">试听声音</button><button id="ttsRefresh" type="button">刷新音色</button><button id="ttsStop" type="button">停止朗读</button></div><small>音色来自当前设备和浏览器。iPhone 锁屏后持续朗读受 iOS 限制；本版不调用收费语音接口。</small></div>`);
 $('#ttsVoice').onchange=e=>ttsSave({voice:e.target.value});$('#ttsRate').oninput=e=>{$('#ttsRateLabel').textContent=Number(e.target.value).toFixed(1)+'×';ttsSave({rate:Number(e.target.value)})};$('#ttsSleep').onchange=e=>{ttsSave({sleep:Number(e.target.value)});if(speech)ttsScheduleSleep()};$('#ttsContinuous').onchange=e=>ttsSave({continuous:e.target.checked});$('#ttsPreview').onclick=speakPreview;$('#ttsRefresh').onclick=renderTtsSettings;$('#ttsStop').onclick=stopSpeech;
}
$('#readerTtsSettings')?.addEventListener('click',renderTtsSettings);
if('speechSynthesis'in window)window.speechSynthesis.addEventListener?.('voiceschanged',()=>{if($('#ttsVoice')&&!$('#readerExtraPanel').classList.contains('hidden'))renderTtsSettings()});
// Switching chapters manually invalidates the old speech queue.
$('#readerPrev')?.addEventListener('click',stopSpeech);
$('#readerNext')?.addEventListener('click',()=>{if(!speech)return;stopSpeech()});
$('#closeReader')?.addEventListener('click',()=>{stopSpeech();flushStats();$('#readerExtraPanel').classList.add('hidden')});
$('#readerBookmark').addEventListener('click',()=>{const b=current();if(!b)return;b.bookmarks=b.bookmarks||[];const mark={at:Date.now(),chapter:Number(b.currentChapterIndex||0),title:b.currentChapterTitle||b.title,progress:progress()};b.bookmarks.push(mark);persist();if(typeof toast==='function')toast('已保存书签');});
$('#readerNotes').addEventListener('click',()=>{const b=current();if(!b)return;b.notes=b.notes||[];const selected=String(window.getSelection()?.toString()||'').slice(0,500);panel('书签、笔记与高亮',`<p>选中正文文字后点击“笔记”，可保存引用与批注。已保存 ${b.notes.length} 条。</p><textarea id="extraQuote" rows="3" placeholder="引用的正文">${esc(selected)}</textarea><textarea id="extraNote" rows="3" placeholder="写下你的想法"></textarea><button id="extraSaveNote">保存笔记</button><div class="reader-extra-list">${b.notes.slice(-30).reverse().map(n=>`<div class="reader-extra-entry"><small>${esc(n.title||'')} · ${new Date(n.at).toLocaleDateString()}</small><p>${esc(n.quote||'')}</p><p>${esc(n.note||'')}</p></div>`).join('')}</div>`);$('#extraSaveNote').onclick=()=>{const quote=$('#extraQuote').value.trim().slice(0,1500),note=$('#extraNote').value.trim().slice(0,2000);if(!quote&&!note)return;b.notes.push({at:Date.now(),chapter:Number(b.currentChapterIndex||0),title:b.currentChapterTitle||b.title,quote,note});persist();$('#readerNotes').click()}});
$('#readerStats').addEventListener('click',()=>{flushStats();const b=current();if(!b)return;const mins=Math.floor((b.readSeconds||0)/60);panel('阅读统计',`<p><strong>${esc(b.title)}</strong></p><p>累计阅读约 <strong>${mins}</strong> 分钟</p><p>当前进度约 <strong>${progress().toFixed(1)}%</strong></p><p>书签：${(b.bookmarks||[]).length} 个 · 笔记：${(b.notes||[]).length} 条</p><small>统计从 r47 开始；跨设备通过现有 NAS 书库同步，多个设备同时编辑可能覆盖数据。</small>`)});
$('#readerAi').addEventListener('click',()=>{const b=current();if(!b)return;panel('AI 阅读助手',`<p>仅发送当前已读章节的部分正文，不自动获取后续章节，尽量避免剧透。</p><textarea id="extraQuestion" rows="3" placeholder="例如：总结本章人物关系"></textarea><button id="extraAsk">提问</button><div id="extraAnswer" aria-live="polite"></div><small>需要 NAS 环境变量 DEEPSEEK_API_KEY；正文会发送到 DeepSeek 服务。</small>`);$('#extraAsk').onclick=async()=>{const q=$('#extraQuestion').value.trim();if(!q)return;const out=$('#extraAnswer');out.textContent='正在分析…';try{const r=await fetch('/api/reading-assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,context:String(current()?.content||'').slice(0,6000)})});const d=await r.json();if(!r.ok)throw Error(d.detail||'请求失败');out.textContent=d.answer||'没有返回内容'}catch(e){out.textContent='AI 不可用：'+e.message}}});
// Show existing bookmarks in notes panel without modifying core chapter navigation.

/* r49 enhancements: export, backup recovery, in-book search, highlighting, themes and exact scroll position */
const R49_PREF='zhijian.r49.prefs';
const r49Prefs=(()=>{try{return JSON.parse(localStorage.getItem(R49_PREF)||'{}')}catch{return {}}})();
function savePrefs(){localStorage.setItem(R49_PREF,JSON.stringify(r49Prefs))}
function setReadingTheme(name){
 const themes=['paper','ivory','sepia','sage','night','black'];
 if(!themes.includes(name))name='paper';
 document.querySelector('#reader')?.setAttribute('data-reading-palette',name);
 r49Prefs.theme=name;savePrefs();
}
function savePrecisePosition(){
 const b=current(),reader=$('#reader');
 if(!b||!reader||reader.classList.contains('hidden'))return;
 const max=Math.max(1,reader.scrollHeight-reader.clientHeight);
 b.precisePosition={chapter:Number(b.currentChapterIndex||0),ratio:Math.max(0,Math.min(1,reader.scrollTop/max)),at:Date.now()};
 // Existing NAS save handles persistence; throttle to avoid saving on every pixel.
}
let posSaveTimer;
$('#reader')?.addEventListener('scroll',()=>{clearTimeout(posSaveTimer);posSaveTimer=setTimeout(()=>{savePrecisePosition();persist()},2400)},{passive:true});
const originalOpenBook=openBook;
openBook=function(id){
 originalOpenBook(id);
 const b=current();
 if(!b||!b.precisePosition||b.precisePosition.chapter!==Number(b.currentChapterIndex||0))return;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  const reader=$('#reader'),max=Math.max(0,reader.scrollHeight-reader.clientHeight);
  if(reader&&!reader.classList.contains('hidden'))reader.scrollTop=max*b.precisePosition.ratio;
 }));
};
function highlightSavedQuotes(){
 const b=current();if(!b)return;
 const quotes=(b.notes||[]).filter(n=>n.highlight&&Number(n.chapter)===Number(b.currentChapterIndex||0)).map(n=>n.quote).filter(x=>x&&x.length>=3).slice(-30);
 const container=$('#readerContent');if(!container||!quotes.length)return;
 // Highlight exact text nodes without interpreting user quotes as HTML.
 const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
 const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){
  const str=node.nodeValue;if(!str||str.length>30000)continue;
  let matched=null,offset=-1;
  for(const quote of quotes){const at=str.indexOf(quote);if(at>=0&&(offset<0||at<offset)){matched=quote;offset=at}}
  if(!matched)continue;
  const mark=document.createElement('mark');mark.className='zhijian-highlight';mark.textContent=matched;
  const after=node.splitText(offset);after.splitText(matched.length);after.parentNode.replaceChild(mark,after);
 }
}
const r49Render=renderReaderContent;
renderReaderContent=function(){r49Render();highlightSavedQuotes()};
function addReaderTool(id,label){const target=$('#readerNotes')||$('#readerTts');if(!target)return null;const b=document.createElement('button');b.id=id;b.className='reader-tool-button';b.textContent=label;target.parentNode.insertBefore(b,target);return b}
addReaderTool('readerSearchInside','全文查找')?.addEventListener('click',()=>{
 const b=current();if(!b)return;
 panel('书内查找',`<input id="r49Search" placeholder="输入人物、词语或句子"><button id="r49Find">查找本章</button><div id="r49Hits"></div>`);
 $('#r49Find').onclick=()=>{
  const q=$('#r49Search').value.trim();if(!q)return;
  const text=String(current()?.content||'');let i=0,at=0,html='';
  while((at=text.toLowerCase().indexOf(q.toLowerCase(),at))>=0&&i<50){
   html+=`<div class="reader-extra-entry">${esc(text.slice(Math.max(0,at-32),Math.min(text.length,at+q.length+48)))}</div>`;
   at+=q.length;i++;
  }
  $('#r49Hits').innerHTML=html||'<p>本章未找到匹配内容</p>';
 };
});
addReaderTool('readerAppearance','阅读外观')?.addEventListener('click',()=>{
 panel('阅读外观',`<p>主题、字号与行距即时生效，当前浏览器自动记住。</p>
 <label>主题 <select id="r49Theme"><option value="paper">默认纸张</option><option value="ivory">米白</option><option value="sepia">羊皮纸</option><option value="sage">浅绿</option><option value="night">深灰</option><option value="black">纯黑</option></select></label>
 <label>字号 <input id="r49Font" type="range" min="14" max="30" value="${r49Prefs.font||18}"><output id="r49FontValue">${r49Prefs.font||18}px</output></label>
 <label>行距 <input id="r49Line" type="range" min="1.5" max="2.7" step=".1" value="${r49Prefs.line||2}"></label>
 <label>字间距 <input id="r49Spacing" type="range" min="0" max="3" step=".2" value="${r49Prefs.spacing||0}"></label>`);
 $('#r49Theme').value=r49Prefs.theme||'paper';
 $('#r49Theme').onchange=e=>setReadingTheme(e.target.value);
 for(const [key,cssVar,unit] of [['Font','--r49-font','px'],['Line','--r49-line',''],['Spacing','--r49-spacing','px']]){
  $('#r49'+key).oninput=e=>{const v=e.target.value;document.querySelector('#reader')?.style.setProperty(cssVar,v+unit);r49Prefs[key.toLowerCase()]=Number(v);savePrefs();if(key==='Font')$('#r49FontValue').textContent=v+'px'};
 }
});
addReaderTool('readerBackup','备份')?.addEventListener('click',async()=>{
 panel('NAS 书库备份',`<p>自动保留最近72个按小时生成的历史快照。恢复前请确认所有设备停止编辑。</p>
 <button id="r49Export">导出完整书库 JSON</button><button id="r49Reload">刷新备份列表</button><div id="r49BackupList">读取中…</div>`);
 $('#r49Export').onclick=()=>{location.href='/api/library/export'};
 const reload=async()=>{
  try{
   const res=await(await apiRequest('/api/library/backups')).json();
   $('#r49BackupList').innerHTML=res.backups.length?res.backups.map(x=>`<div class="reader-extra-entry"><span>${esc(x.name)} · ${(x.size/1024).toFixed(0)} KB</span> <button data-restore="${esc(x.name)}">恢复</button></div>`).join(''):'暂无历史备份';
  }catch(e){$('#r49BackupList').textContent=e.message}
 };
 $('#r49Reload').onclick=reload;
 $('#r49BackupList').onclick=async e=>{
  const btn=e.target.closest('[data-restore]');if(!btn)return;
  if(!confirm('确定恢复此历史书架？会替换当前 NAS 书库，建议先导出当前书库。'))return;
  try{
   await apiRequest('/api/library/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:btn.dataset.restore})});
   location.reload();
  }catch(e){alert('恢复失败：'+e.message)}
 };
 reload();
});
const notesClick=$('#readerNotes');
notesClick?.addEventListener('click',()=>{
 // Add a highlight toggle to the existing note dialog after its synchronous rendering.
 const saveBtn=$('#extraSaveNote');
 if(!saveBtn||$('#r49Highlight'))return;
 const wrap=document.createElement('label');wrap.innerHTML='<input type="checkbox" id="r49Highlight" checked> 在正文中高亮引用';
 saveBtn.before(wrap);
 saveBtn.addEventListener('click',()=>{
  const b=current();if(!b)return;
  const last=(b.notes||[]).slice(-1)[0];
  if(last&&Date.now()-last.at<2000)last.highlight=!!$('#r49Highlight')?.checked;
  persist();highlightSavedQuotes();
 });
});
setReadingTheme(r49Prefs.theme||'paper');
for(const [k,v] of [['font','px'],['line',''],['spacing','px']]){
 if(r49Prefs[k]!=null)$('#reader')?.style.setProperty('--r49-'+k,r49Prefs[k]+v);
}


// r50: native iOS tracks chapter updates directly on device; NAS is not involved.
const LOCAL_UPDATE_KEY='shuyin.local-updates.v1';let localUpdateChecking=false,localUpdateTimer=0;
function localUpdateState(){try{return JSON.parse(localStorage.getItem(LOCAL_UPDATE_KEY)||'{}')}catch{return {}}}
function saveLocalUpdateState(value){localStorage.setItem(LOCAL_UPDATE_KEY,JSON.stringify(value))}
function renderLocalUpdateRows(state){const root=$('#r50Results');if(!root)return;const rows=state.books||[];root.innerHTML=`<p>${state.running?'正在通过手机检查…':(state.checked_at?'上次检查：'+new Date(state.checked_at).toLocaleString():'尚未检查')} · ${rows.length} 本</p>`+rows.map(b=>`<div class="reader-extra-entry"><strong>${esc(b.title)}</strong> · ${b.status==='new'?'疑似新增 '+b.added+' 章':b.status==='same'?'目录无新增':b.status==='unknown'?'未识别目录':'检查失败'}</div>`).join('')}
async function runLocalUpdateCheck(){if(localUpdateChecking)return;localUpdateChecking=true;const state=localUpdateState(),books=(window.getBooks?.()||[]).filter(b=>b.sourceUrl).slice(0,8),known=state.snapshots||{},results=[];state.running=true;renderLocalUpdateRows(state);try{for(const book of books){try{const data=await window.ShuyinDirectWeb.extract(book.sourceUrl),chapters=Array.isArray(data.chapters)?data.chapters:[];if(!chapters.length){results.push({title:book.title,status:'unknown',added:0});continue}const old=known[String(book.id)]||(book.chapters||[]),oldKeys=new Set(old.map(c=>c.url||c.title).filter(Boolean)),added=chapters.filter(c=>!oldKeys.has(c.url||c.title));known[String(book.id)]=chapters;results.push({title:book.title,status:added.length?'new':'same',added:added.length})}catch{results.push({title:book.title,status:'failed',added:0})}}state.snapshots=known;state.books=results;state.checked_at=Math.floor(Date.now()/1000)}finally{state.running=false;saveLocalUpdateState(state);localUpdateChecking=false;renderLocalUpdateRows(state)}}
async function showLocalUpdatePanel(){let state=localUpdateState();panel('本机小说追更',`<p>由 iPhone 直接检查公开目录，不经过 NAS；最多检查 8 本。检查仅在 App 前台运行。</p><label><input type="checkbox" id="r50Enable"> 开启前台定期检查</label><label>检查间隔 <select id="r50Hours"><option value="6">每 6 小时</option><option value="12">每 12 小时</option><option value="24">每天</option><option value="72">每 3 天</option></select></label><button id="r50Save">保存设置</button> <button id="r50Check">立即检查</button><div id="r50Results"></div>`);$('#r50Enable').checked=!!state.enabled;$('#r50Hours').value=String(state.interval_hours||12);renderLocalUpdateRows(state);$('#r50Save').onclick=()=>{state={...localUpdateState(),enabled:$('#r50Enable').checked,interval_hours:Number($('#r50Hours').value)||12};saveLocalUpdateState(state);toast('本机追更设置已保存')};$('#r50Check').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await runLocalUpdateCheck()}finally{b.disabled=false}};if(!localUpdateTimer){localUpdateTimer=setInterval(()=>{const s=localUpdateState();if(document.visibilityState==='visible'&&s.enabled&&Date.now()/1000-Number(s.checked_at||0)>Number(s.interval_hours||12)*3600)runLocalUpdateCheck().catch(()=>{})},60000)}}
const updateBtn=document.createElement('button');
updateBtn.id='readerUpdateCheck';updateBtn.className='reader-tool-button';updateBtn.textContent='追更';
($('#readerTtsSettings')||$('#readerTts'))?.parentNode?.appendChild(updateBtn);
async function showUpdatePanel(){
 if(window.Capacitor?.isNativePlatform?.())return showLocalUpdatePanel();
 panel('NAS 小说追更',`<p>仅检查目录是否新增章节，不会自动替换正文或修改阅读进度。每次最多检查8本。</p>
 <label><input type="checkbox" id="r50Enable"> 开启 NAS 后台自动检查</label>
 <label>检查间隔 <select id="r50Hours"><option value="6">每6小时</option><option value="12">每12小时</option><option value="24">每天</option><option value="72">每3天</option></select></label>
 <button id="r50Save">保存设置</button> <button id="r50Check">立即检查</button>
 <div id="r50Results">正在读取…</div>`);
 const results=$('#r50Results');
 const render=d=>{
  $('#r50Enable').checked=!!d.settings.enabled;
  $('#r50Hours').value=String(d.settings.interval_hours||12);
  const list=d.results.books||[];
  results.innerHTML=`<p>${d.running?'正在检查…':(d.results.checked_at?'上次检查：'+new Date(d.results.checked_at*1000).toLocaleString():'尚未检查')} · ${list.length} 本</p>`+
   list.map(b=>`<div class="reader-extra-entry"><strong>${esc(b.title)}</strong> · ${b.status==='new'?'疑似新增 '+b.added+' 章':b.status==='same'?'目录无新增':b.status==='unknown'?'未识别目录':'检查失败'}</div>`).join('');
 };
 try{render(await(await apiRequest('/api/updates/settings')).json())}catch(e){results.textContent=e.message}
 $('#r50Save').onclick=async()=>{
  try{
   await apiRequest('/api/updates/settings',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({enabled:$('#r50Enable').checked,interval_hours:Number($('#r50Hours').value)})});
   results.textContent='设置已保存。';
  }catch(e){results.textContent='保存失败：'+e.message}
 };
 $('#r50Check').onclick=async()=>{
  const b=$('#r50Check');b.disabled=true;results.textContent='正在逐本检查，可能需要约2分钟…';
  try{
   await apiRequest('/api/updates/check',{method:'POST'});
   render(await(await apiRequest('/api/updates/settings')).json());
  }catch(e){results.textContent='检查失败：'+e.message}finally{b.disabled=false}
 };
}
updateBtn.addEventListener('click',showUpdatePanel);

})();
