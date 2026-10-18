/* Reader utilities: reading statistics, in-chapter search, offline storage inspection.
 * Local-only, no telemetry and no server calls. */
(()=>{'use strict';
 const K='shuyin-ios-reading-stats-v1';
 const now=()=>Date.now();
 let state={date:new Date().toLocaleDateString('sv-SE'),seconds:0,days:{},lastTick:now()};
 try{const saved=JSON.parse(localStorage.getItem(K)||'null');if(saved&&typeof saved==='object')state={...state,...saved,lastTick:now()}}catch{}
 const today=()=>new Date().toLocaleDateString('sv-SE');
 function save(){try{localStorage.setItem(K,JSON.stringify(state))}catch{}}
 function tick(){
   const date=today();if(state.date!==date){state.date=date;state.seconds=0}
   const t=now(),delta=Math.max(0,Math.min(30,(t-state.lastTick)/1000));state.lastTick=t;
   const reader=document.querySelector('#readerContent');
   if(!reader||!reader.getClientRects().length||document.hidden)return;
   if((reader.textContent||'').trim().length<30)return;
   state.seconds+=delta;state.days[date]=(state.days[date]||0)+delta;
   const days=Object.keys(state.days).sort();if(days.length>365)for(const d of days.slice(0,-365))delete state.days[d];
   save();
 }
 setInterval(tick,15000);
 document.addEventListener('visibilitychange',()=>{tick();state.lastTick=now()});
 const style=document.createElement('style');style.textContent=`
 #syReadingTools{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0}
 #syReadingTools button{border:1px solid #b2b5ac;border-radius:12px;padding:9px 12px;background:transparent;color:inherit;font:inherit}
 #syReadingGoalPicker{border:1px solid #b2b5ac;border-radius:10px;padding:8px;background:transparent;color:inherit;font:inherit}
 #syGoalTrack{height:6px;width:100%;overflow:hidden;border-radius:99px;background:rgba(110,120,105,.18)}
 #syGoalTrack span{display:block;height:100%;width:0;background:#829579;border-radius:inherit;transition:width .25s ease}
 #syReaderSearchBox{display:none;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;padding:12px;border:1px solid #b2b5ac;border-radius:12px}
 #syReaderSearchBox.open{display:flex}
 #syReaderSearchBox input{flex:1;min-width:120px;border:1px solid #b2b5ac;border-radius:8px;padding:8px;background:transparent;color:inherit}
 #syReaderSearchBox button{padding:8px;border:1px solid #b2b5ac;border-radius:8px;background:transparent;color:inherit}
 mark.sy-reader-match{background:#ffd970;color:#30240b;border-radius:2px}
 mark.sy-reader-match.active{outline:2px solid #bd8130}
 #syReaderToolsInfo{font-size:12px;opacity:.75;width:100%}
 `;document.head.append(style);
 const panel=document.createElement('section');panel.id='syReadingTools';panel.setAttribute('aria-label','阅读工具');
 let goalMinutes=30;try{goalMinutes=Math.max(5,Math.min(240,Number(localStorage.getItem('shuyin.daily-reading-goal.v1'))||30))}catch{}
 panel.innerHTML=`<button type="button" id="syFindInChapter">⌕ 本章搜索</button><button type="button" id="syReadingStats">◷ 阅读统计</button><button type="button" id="syStorageStats">▤ 本地存储</button><label for="syReadingGoalPicker">每日目标</label><select id="syReadingGoalPicker" aria-label="每日阅读目标">${[10,15,20,30,45,60,90,120].map(n=>`<option value="${n}" ${n===goalMinutes?'selected':''}>${n} 分钟</option>`).join('')}</select><div id="syGoalTrack" role="progressbar" aria-label="今日阅读目标进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><div id="syReaderToolsInfo" role="status"></div>`;
 const search=document.createElement('div');search.id='syReaderSearchBox';
 search.innerHTML=`<input id="syFindText" placeholder="搜索当前章节文字" aria-label="搜索当前章节文字"><button type="button" id="syFindPrev">上一处</button><button type="button" id="syFindNext">下一处</button><button type="button" id="syFindClose">关闭</button><span id="syFindCount" aria-live="polite"></span>`;
 let matches=[],pos=-1;
 const content=()=>document.querySelector('#readerContent');
 function clear(){
  const root=content();if(!root)return;
  root.querySelectorAll('mark.sy-reader-match').forEach(mark=>mark.replaceWith(document.createTextNode(mark.textContent)));
  root.normalize();matches=[];pos=-1;
 }
 function go(i){if(!matches.length)return;matches.forEach(m=>m.classList.remove('active'));pos=(i+matches.length)%matches.length;matches[pos].classList.add('active');matches[pos].scrollIntoView({behavior:'smooth',block:'center'});search.querySelector('#syFindCount').textContent=`${pos+1}/${matches.length}`}
 function find(q){
  clear();if(!q.trim())return;
  const root=content();if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(n){return n.parentElement?.closest('script,style,button,mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  const term=q.toLocaleLowerCase();
  let total=0;
  for(const node of nodes){
   const raw=node.nodeValue,lower=raw.toLocaleLowerCase();let at=0,hit=lower.indexOf(term,at);
   if(hit<0)continue;
   const frag=document.createDocumentFragment();
   while(hit>=0&&total<250){
    frag.append(document.createTextNode(raw.slice(at,hit)));
    const mark=document.createElement('mark');mark.className='sy-reader-match';mark.textContent=raw.slice(hit,hit+q.length);frag.append(mark);
    matches.push(mark);total++;at=hit+q.length;hit=lower.indexOf(term,at);
   }
   frag.append(document.createTextNode(raw.slice(at)));node.replaceWith(frag);
   if(total>=250)break;
  }
  search.querySelector('#syFindCount').textContent=matches.length?`${matches.length} 处匹配`:'没有找到';
  if(matches.length)go(0);
 }
 function message(t){panel.querySelector('#syReaderToolsInfo').textContent=t}
 async function storage(){
  let count='未知',size='未知';
  try{const db=await new Promise((ok,no)=>{const r=indexedDB.open('zhijian-reader');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);r.onupgradeneeded=()=>{r.transaction.abort();no(Error('未初始化'))}});
   count=await new Promise((ok,no)=>{const r=db.transaction('books','readonly').objectStore('books').count();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});db.close();
  }catch{}
  try{const e=await navigator.storage.estimate();size=`${(e.usage/1048576).toFixed(1)} MB / ${Math.round(e.quota/1048576)} MB（设备浏览器配额）`}catch{}
  message(`本机书籍：${count} 本；存储占用：${size}`);
 }
 function stats(){
  tick();const days=Object.keys(state.days).sort(),total=days.reduce((n,d)=>n+state.days[d],0);
  const streak=(()=>{let s=0,d=new Date();if(!state.days[today()])d.setDate(d.getDate()-1);while(state.days[d.toLocaleDateString('sv-SE')]){s++;d.setDate(d.getDate()-1)}return s})();
  const minutes=Math.floor((state.days[today()]||0)/60),percent=Math.min(100,Math.round(minutes/goalMinutes*100));
  panel.querySelector('#syGoalTrack span').style.width=`${percent}%`;panel.querySelector('#syGoalTrack').setAttribute('aria-valuenow',String(percent));
  message(`今日阅读 ${minutes}/${goalMinutes} 分钟 · 累计 ${Math.floor(total/60)} 分钟 · 连续 ${streak} 天（仅本设备统计）`);
 }
 document.addEventListener('DOMContentLoaded',()=>{
  const reader=document.querySelector('#readerContent');if(!reader)return;
  const target=document.querySelector('#readerFooter')||reader.parentElement;
  target.append(panel,search);
  panel.querySelector('#syFindInChapter').onclick=()=>{search.classList.add('open');search.querySelector('input').focus()};
  panel.querySelector('#syReadingStats').onclick=stats;
  panel.querySelector('#syReadingGoalPicker').onchange=e=>{goalMinutes=Number(e.target.value)||30;try{localStorage.setItem('shuyin.daily-reading-goal.v1',String(goalMinutes))}catch{}stats()};
  panel.querySelector('#syStorageStats').onclick=storage;
  search.querySelector('#syFindText').addEventListener('input',e=>find(e.target.value));
  search.querySelector('#syFindNext').onclick=()=>go(pos+1);
  search.querySelector('#syFindPrev').onclick=()=>go(pos-1);
  search.querySelector('#syFindClose').onclick=()=>{clear();search.classList.remove('open')};
  // Chapter changes re-render the content. Reset stale references without modifying reader data.
  new MutationObserver(()=>{if(matches.some(m=>!m.isConnected)){matches=[];pos=-1;search.querySelector('#syFindCount').textContent='章节已切换，请重新搜索'}}).observe(reader,{childList:true});
 });
})();
