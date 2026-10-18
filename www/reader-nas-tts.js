// Shuyin r61: Kokoro continuous playback and recovery. Keeps existing Piper backend unchanged.
(()=>{'use strict';
 // 离线神经语音播完一段后，复用系统语音的「本章读完」回调驱动队列继续
 try{window.Capacitor?.Plugins?.ShuyinNeuralTts?.addListener?.('neuralFinished',()=>window.shuyinNativeSpeechFinished?.())}catch(error){}

const $=id=>document.getElementById(id), button=$('readerTts');if(!button)return;
const audio=new Audio();audio.preload='auto';
const KEY='zhijian_nas_tts_v1', POS='shuyin_r58_listen_position';
let token=0, active=false, paused=false, pieces=[], part=0, deadline=0, prefetched=null, lastSave=0, advancing=false, loading=false, pendingResume=false,nativeSpeaking=false,nativeQueue=[],nativeCharOffset=0,lastNativeProgressSave=0;
const defaults={engine:'system',voice:'system',rate:1,continuous:true,sleep:0,volume:1,pitch:1};
function settings(){try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...defaults}}}
function save(s){localStorage.setItem(KEY,JSON.stringify({...settings(),...s}))}
function position(){try{return JSON.parse(localStorage.getItem(POS)||'null')}catch{return null}}
function bookId(){try{return typeof currentBook!=='undefined'&&currentBook?.id||$('readerBookTitle')?.textContent||''}catch{return $('readerBookTitle')?.textContent||''}}
function chapterId(){return $('readerTitle')?.textContent||''}
function store(){if(!active||!pieces.length)return;try{localStorage.setItem(POS,JSON.stringify({book:bookId(),chapter:chapterId(),chapterIndex:Number(window.currentBook?.currentChapterIndex||0),part:Math.max(0,part-1),seconds:audio.currentTime||0,charOffset:nativeCharOffset,updated:Date.now()}))}catch{}}
function ui(){button.textContent=!active?'▶ 听书':paused?'▶ 继续听书':loading?'◌ 准备音频…':'Ⅱ 暂停听书';const mobile=$('readerMobileTts');if(mobile)mobile.textContent=button.textContent;const toggle=$('nasToggle');if(toggle)toggle.textContent=button.textContent;const seek=$('nasSeek');if(seek){seek.max=Number.isFinite(audio.duration)?Math.max(1,Math.floor(audio.duration)):1;seek.value=Math.floor(audio.currentTime||0)}const label=$('nasTime');if(label)label.textContent=clock(audio.currentTime)+' / '+clock(audio.duration);const count=$('nasPart');if(count)count.textContent=pieces.length?`第 ${Math.min(part,pieces.length)} / ${pieces.length} 段`:''}
function clock(n){if(!Number.isFinite(n)||n<0)return '0:00';n=Math.floor(n);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
function note(msg){const status=$('nasStatus');if(status)status.textContent=String(msg);if(typeof toast==='function')toast(String(msg).slice(0,110));}
function state(msg){const status=$('nasStatus');if(status)status.textContent=String(msg);}
function bridge(){return window.Capacitor?.isNativePlatform?.()?(window.ShuyinAudio||window.Capacitor?.Plugins?.ShuyinAudio):null}
function stop(clear=true){try{window.Capacitor?.Plugins?.ShuyinNeuralTts?.stop?.()}catch(error){}store();token++;if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=0}active=false;paused=false;advancing=false;audio.pause();audio.removeAttribute('src');audio.load();prefetched=null;loading=false;pendingResume=false;nativeSpeaking=false;try{bridge()?.stop()}catch{}if(clear){pieces=[];part=0}ui()}
// Respect punctuation and dialogue, while keeping text unchanged for synthesis.
function segments(raw){const text=String(raw||'').replace(/\s+/g,' ').trim();const sentences=text.match(/[^。！？!?；;]+[。！？!?；;」”]?|[^。！？!?；;]+$/g)||[];const result=[];let buffer='';for(const sentence of sentences){if(buffer.length+sentence.length>260&&buffer){result.push(buffer);buffer=''}buffer+=sentence;if(buffer.length>=110&&/[。！？!?；;」”]$/.test(sentence)){result.push(buffer);buffer=''}}if(buffer)result.push(buffer);return result.flatMap(x=>{const a=[];while(x.length>420){a.push(x.slice(0,420));x=x.slice(420)}if(x)a.push(x);return a})}
function textOfChapter(){return String($('readerContent')?.innerText||'').trim()}
async function fetchPart(index,run){
 const s=settings();let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  if(run!==token)throw Error('cancelled');
  try{
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),120000);
   let r;
   try{r=await fetch('/api/tts/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:pieces[index],engine:s.engine,voice:s.voice,rate:Number(s.rate)}),signal:ctrl.signal})}finally{clearTimeout(timer)}
   if(!r.ok){let j={};try{j=await r.json()}catch{}throw Error(String(j.detail||`HTTP ${r.status}`).slice(0,160))}
   const j=await r.json();if(!j.url)throw Error('服务器未返回音频地址');if(run!==token)throw Error('cancelled');return j.url;
  }catch(e){lastError=e;if(run!==token)throw e;if(attempt<3){state(`第 ${index+1} 段生成暂时失败，重试 ${attempt}/2…`);await new Promise(r=>setTimeout(r,attempt*1800))}}
 }
 throw lastError;
}
function preload(run){
 if(part>=pieces.length||run!==token)return;
 const index=part;
 if(prefetched?.index===index)return;
 prefetched={index,promise:fetchPart(index,run)};
 // Avoid unhandled rejection while audio is still playing.
 prefetched.promise.catch(()=>{});
}
async function playNext(run,seekTo=0){
 if(!active||run!==token||loading)return;
 if(deadline&&Date.now()>=deadline){stop();note('定时听书已结束');return}
 if(part>=pieces.length){if(settings().continuous){await nextChapter(run);return}stop();note('本章朗读完成');return}
 loading=true;const index=part;
 state(`正在准备第 ${index+1}/${pieces.length} 段音频，请稍候…`);
 try{
  const neural=window.Capacitor?.Plugins?.ShuyinNeuralTts;if(neural&&settings().engine==='neural'){try{await neural.speak({text:pieces[index],sid:Number(settings().sid||0),speed:Number(settings().rate)||1});if(run!==token)return;part=index+1;nativeSpeaking=true;paused=false;loading=false;pendingResume=false;state(`正在离线朗读第 ${part}/${pieces.length} 段`);ui();return}catch(error){note('离线语音失败，已改用系统语音：'+error.message);save({engine:'system'})}}const native=bridge();if(native){await native.speak({text:pieces[index],queue:index===0?nativeQueue:[],voice:settings().voice,rate:Number(settings().rate)||1,volume:Number(settings().volume??1),pitch:Number(settings().pitch??1),title:chapterId(),artist:bookId()});if(run!==token)return;part=index+1;nativeSpeaking=true;paused=false;loading=false;pendingResume=false;state(`正在锁屏朗读第 ${part}/${pieces.length} 段`);ui();return}
  let url;
  if(prefetched?.index===index){try{url=await prefetched.promise}catch{}prefetched=null}
  if(!url)url=await fetchPart(index,run);
  if(run!==token)return;
  audio.pause();audio.src=url;audio.load();
  if(seekTo>0)audio.addEventListener('loadedmetadata',()=>{if(run===token)audio.currentTime=Math.min(seekTo,Math.max(0,(audio.duration||seekTo)-0.1))},{once:true});
  try{await audio.play()}catch(e){
   if(run!==token)return;
   if(e.name==='NotAllowedError'){pendingResume=true;paused=true;state('音频已准备好：请点击「继续听书」以允许播放');ui();return}
   throw e;
  }
  if(run!==token)return;
  part=index+1;paused=false;pendingResume=false;state(`正在播放第 ${part}/${pieces.length} 段`);ui();preload(run);
 }catch(e){
  if(run!==token)return;
  paused=true;pendingResume=false;
  note(`第 ${index+1} 段准备失败：${e.message}。点击「继续听书」重试，不会丢失进度`);
  ui();
 }finally{if(run===token)loading=false}
}
async function nextChapter(run){if(advancing)return;advancing=true;const old=chapterId(), oldText=textOfChapter();const next=$('readerNext');if(!next){stop();note('没有下一章');return}note('正在加载下一章…');next.click();const started=Date.now();while(run===token&&Date.now()-started<18000){await new Promise(r=>setTimeout(r,350));if(chapterId()!==old||textOfChapter()!==oldText){const content=textOfChapter();if(content.length>20){pieces=segments(content);part=0;prefetched=null;advancing=false;await playNext(run);return}}}if(run===token){stop();note('下一章尚未加载，请手动切换后继续听书')}}
function start(resume=false){const text=textOfChapter();if(!text){note('本章没有可朗读的正文');return}stop();pieces=bridge()?[text]:segments(text);nativeQueue=[];part=0;let offset=0;const saved=resume?position():null,book=window.currentBook,idx=Number(book?.currentChapterIndex||0),same=saved?.book===bookId()&&(saved.chapter===chapterId()||Number(saved.chapterIndex)===idx);nativeCharOffset=bridge()&&same?Math.max(0,Math.min(text.length,Number(saved.charOffset)||0)):0;if(same){part=Math.min(pieces.length-1,Math.max(0,saved.part||0));offset=saved.seconds||0}if(bridge()){const chapters=book?.chapters||[],cache=book?.cachedChapters||{};nativeQueue=[{index:String(idx),text:nativeCharOffset?text.slice(nativeCharOffset):text,offset:String(nativeCharOffset),title:chapterId()||bookId(),artist:bookId()}];for(let i=idx+1;i<chapters.length;i++){const c=cache[i];if(!c?.content)break;nativeQueue.push({index:String(i),text:c.content,offset:'0',title:chapters[i].title||c.title||`第 ${i+1} 章`,artist:bookId()})}}active=true;deadline=settings().sleep?Date.now()+settings().sleep*60000:0;store();ui();armSleep();playNext(token,offset)}
// 定时关闭必须自己拿一个计时器：原生语音一次 speak() 就覆盖整章，
// 旧实现只在「下一段/下一章」时检查 deadline，于是定时器在原生模式下要等整章读完。
let sleepTimer=0;
function armSleep(){if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=0}const minutes=Number(settings().sleep||0);if(!(minutes>0))return;sleepTimer=setTimeout(()=>{sleepTimer=0;stop();note('定时听书已结束')},minutes*60000)}
function toggle(){if(!active){start(true);return}if(paused){if(nativeSpeaking){bridge()?.resume().then(()=>{paused=false;state('已恢复播放');ui()}).catch(e=>note('继续播放失败：'+e.message));return}if(pendingResume){audio.play().then(()=>{pendingResume=false;paused=false;part++;state('已恢复播放');ui();preload(token)}).catch(e=>note('请再次点击播放：'+e.message));return}if(!audio.src||!audio.getAttribute('src')){paused=false;playNext(token);return}audio.play().then(()=>{paused=false;state('已恢复播放');ui()}).catch(e=>{state('继续播放失败：'+e.message);ui()})}else{if(nativeSpeaking)bridge()?.pause();else audio.pause();paused=true;store();state('已暂停');ui()}}
button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggle()},true);
audio.addEventListener('ended',()=>{if(!active||paused)return;store();state('上一段已播放完，正在衔接下一段…');playNext(token)});audio.addEventListener('timeupdate',()=>{ui();if(Date.now()-lastSave>4000){lastSave=Date.now();store()}});audio.addEventListener('error',()=>{if(active&&!loading){paused=true;state('音频加载中断，可点击「继续听书」重试');ui()}});
window.shuyinNativeSpeechProgress=e=>{const b=window.currentBook;if(!b||!nativeSpeaking)return;const offset=Math.max(0,Number(e?.location)||0);nativeCharOffset=offset;if(Date.now()-lastNativeProgressSave<1800)return;lastNativeProgressSave=Date.now();try{localStorage.setItem(POS,JSON.stringify({book:bookId(),chapter:chapterId(),chapterIndex:Number(e?.index??b.currentChapterIndex??0),part:0,seconds:0,charOffset:offset,updated:Date.now()}))}catch{}};
window.shuyinNativeChapterChanged=e=>{const b=window.currentBook,i=Number(e?.index);if(!b||!Number.isInteger(i)||!b.chapters?.[i])return;nativeCharOffset=0;try{localStorage.setItem(POS,JSON.stringify({book:bookId(),chapter:b.chapters[i].title||'',chapterIndex:i,part:0,seconds:0,charOffset:0,updated:Date.now()}))}catch{}const c=b.cachedChapters?.[i];if(c?.content){b.currentChapterIndex=i;b.currentChapterTitle=b.chapters[i].title||c.title;b.content=c.content;b.activeChapterUrl=c.url||b.activeChapterUrl;const title=document.querySelector('#readerTitle');if(title)title.textContent=b.currentChapterTitle;window.renderReaderContent?.();window.saveCurrentBook?.()}};
window.shuyinNativeSpeechFinished=()=>{if(!active||paused||!nativeSpeaking)return;nativeSpeaking=false;if(part>=pieces.length&&settings().continuous){nextChapter(token);return}if(part>=pieces.length){stop();note('本章朗读完成');return}playNext(token)};
window.addEventListener('pagehide',()=>{store();audio.pause()});
for(const id of ['readerPrev','closeReader','readerToc'])$(id)?.addEventListener('click',()=>{if(active)stop()},true);
$('readerNext')?.addEventListener('click',()=>{if(active&&!advancing)stop()},true);
const settingsBtn=$('readerTtsSettings');settingsBtn?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const panel=$('readerExtraPanel'),body=$('readerExtraBody');if(!panel||!body)return;const s=settings();$('readerExtraTitle').textContent='书隐 · 听书播放器';
body.innerHTML=`<div class="tts-settings r58-player"><label>语音引擎</label><select id="nasEngine"><option value="kokoro">真人感主播 · Kokoro（NAS）</option><option value="local">Piper 本地中文（NAS）</option><option value="edge">Edge 在线语音（可能 403）</option></select><label>朗读音色</label><select id="nasVoice"><option value="female">女声 · 小艺</option><option value="male">男声 · 云希</option><option value="zf_xiaobei">女声 · 小贝</option><option value="zf_xiaoxiao">女声 · 晓晓</option><option value="zf_xiaoyi">女声 · 小艺</option><option value="zm_yunjian">男声 · 云健</option><option value="zm_yunxi">男声 · 云希</option><option value="zm_yunyang">男声 · 云扬</option></select><label>合成语速 <span id="nasRateLabel"></span></label><input id="nasRate" type="range" min="0.7" max="1.4" step="0.1"><label><input id="nasContinuous" type="checkbox"> 自动朗读下一章</label><label>定时关闭</label><select id="nasSleep"><option value="0">不定时</option><option value="15">15分钟</option><option value="30">30分钟</option><option value="60">60分钟</option></select><div class="tts-actions"><button id="nasToggle" type="button">▶ 听书</button><button id="nasStop" type="button">停止</button><button id="nasTest" type="button">试听测试</button><button id="nasSaveAudio" type="button">保存本章音频</button></div><div class="r58-progress"><input id="nasSeek" aria-label="本段播放进度" type="range" min="0" max="1" step="1" value="0"><div><span id="nasTime">0:00 / 0:00</span><span id="nasPart"></span></div></div><div class="tts-actions"><button id="nasBack" type="button">↶ 后退 10 秒</button><button id="nasForward" type="button">前进 10 秒 ↷</button><button id="nasRestart" type="button">从本章开头</button></div><small id="nasStatus">正在检测本地语音服务…</small><small id="syAudioFile"></small></div>`;
panel.classList.remove('hidden');$('nasEngine').value=s.engine;$('nasVoice').value=s.voice;$('nasRate').value=s.rate;$('nasRateLabel').textContent=s.rate+'×';$('nasSleep').value=s.sleep;$('nasContinuous').checked=!!s.continuous;
$('nasEngine').onchange=e=>save({engine:e.target.value});$('nasVoice').onchange=e=>save({voice:e.target.value});$('nasRate').oninput=e=>{$('nasRateLabel').textContent=e.target.value+'×';save({rate:Number(e.target.value)})};$('nasSleep').onchange=e=>save({sleep:Number(e.target.value)});$('nasContinuous').onchange=e=>save({continuous:e.target.checked});$('nasStop').onclick=()=>stop();$('nasToggle').onclick=toggle;$('nasTest').onclick=()=>{stop();pieces=['你好，欢迎使用书隐阅读器。这是本地中文语音试听。'];part=0;active=true;ui();playNext(token)};
$('nasSeek').oninput=e=>{if(active&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(Number(e.target.value),audio.duration);store()}};$('nasBack').onclick=()=>{if(active)audio.currentTime=Math.max(0,audio.currentTime-10)};$('nasForward').onclick=()=>{if(active)audio.currentTime=Math.min(audio.duration||0,audio.currentTime+10)};$('nasRestart').onclick=()=>start(false);
 $('nasSaveAudio').onclick=async()=>{const api=bridge();if(!api){note('保存音频文件仅在 iOS 原生 App 中提供');return}const saveButton=$('nasSaveAudio');saveButton.disabled=true;saveButton.textContent='正在生成音频…';try{const result=await api.saveAudio({text:textOfChapter(),voice:settings().voice,rate:Number(settings().rate)||1,volume:Number(settings().volume??1),pitch:Number(settings().pitch??1),title:chapterId()});$('syAudioFile').textContent=`音频已保存到 App 文件目录：${result.fileName||result.path||''}`;try{const rows=JSON.parse(localStorage.getItem('shuyin.audio.index.v1')||'[]'),name=result.fileName||String(result.path||'').split('/').pop();rows.push({name,bookId:String(window.currentBook?.id||''),bookTitle:window.currentBook?.title||'',chapterIndex:Number(window.currentBook?.currentChapterIndex||0),chapterTitle:chapterId(),bytes:Number(result.bytes)||0,at:Date.now()});localStorage.setItem('shuyin.audio.index.v1',JSON.stringify(rows.slice(-400)))}catch(error){}note('本章音频已保存在 iPhone');}catch(e){note('音频保存失败：'+e.message)}finally{saveButton.disabled=false;saveButton.textContent='保存本章音频'}};
if(bridge()){$('nasEngine').innerHTML='<option value="system">iOS 系统中文语音</option><option value="neural">离线神经语音 · 需下载模型</option>';const neuralPlugin=window.Capacitor?.Plugins?.ShuyinNeuralTts;neuralPlugin?.status?.().then(st=>{const opt=$('nasEngine').querySelector('option[value=neural]');if(st?.installed){opt.textContent='离线神经语音 · '+((Number(st.speakers)||1)>1?(st.speakers+' 个音色'):'中等音质');$('nasEngine').disabled=false;if(settings().engine==='neural')$('nasEngine').value='neural'}else{opt.disabled=true;opt.textContent='离线神经语音 · 模型未安装'}}).catch(()=>{});$('nasEngine').value=settings().engine==='neural'?'neural':'system';$('nasVoice').innerHTML='<option value="system">正在读取 iPhone 中文声音…</option>';$('nasStatus').textContent='使用 iPhone 系统中文语音。可在“设置 > 辅助功能 > 朗读与口述 > 声音”下载增强声音；锁屏控制已启用。';bridge().voices?.().then(result=>{const rows=result?.voices||[];if(!rows.length){$('nasVoice').innerHTML='<option value="system">系统默认中文声音</option>';return}const labels={premium:'高品质',enhanced:'增强',standard:'标准'};const voiceSelect=$('nasVoice');voiceSelect.replaceChildren();rows.forEach(v=>{const option=document.createElement('option');option.value=v.identifier;option.textContent=`${v.name} · ${labels[v.quality]||'系统'}`;voiceSelect.appendChild(option)});const saved=rows.some(v=>v.identifier===s.voice)?s.voice:(rows.find(v=>v.quality==='premium')||rows.find(v=>v.quality==='enhanced')||rows[0]).identifier;$('nasVoice').value=saved;save({voice:saved});if(!rows.some(v=>v.quality==='premium'||v.quality==='enhanced')){$('nasStatus').textContent='当前只有系统标准音色。想要更自然的声音：设置 → 辅助功能 → 朗读与口述 → 声音 → 中文，下载一个「增强」或「高品质」音色，回来后书隐会自动选中最高的那个。'}}).catch(()=>{$('nasVoice').innerHTML='<option value="system">系统默认中文声音</option>'});$('nasSeek').disabled=true;$('nasBack').disabled=true;$('nasForward').disabled=true}else{fetch('/api/tts/status').then(r=>r.json()).then(x=>{if($('nasStatus'))$('nasStatus').textContent=x.kokoroConfigured?'主播服务已配置，可试听；若失败请查看错误提示':(x.localAvailable?'Piper 已连接；主播容器尚未配置':'本地语音服务未连接')}).catch(()=>{if($('nasStatus'))$('nasStatus').textContent='无法检查语音服务'})}ui();
},true);
if('mediaSession' in navigator){try{navigator.mediaSession.setActionHandler('play',()=>{if(paused)toggle()});navigator.mediaSession.setActionHandler('pause',()=>{if(active&&!paused)toggle()});navigator.mediaSession.setActionHandler('seekbackward',()=>{audio.currentTime=Math.max(0,audio.currentTime-10)});navigator.mediaSession.setActionHandler('seekforward',()=>{audio.currentTime=Math.min(audio.duration||0,audio.currentTime+10)})}catch{}}
ui();
})();
