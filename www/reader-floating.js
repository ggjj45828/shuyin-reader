(function(){'use strict';
function start(){
 const reader=document.getElementById('reader');if(!reader)return;
 document.getElementById('sy-float')?.remove();
 const dock=document.createElement('div');dock.id='sy-float';dock.setAttribute('aria-label','阅读快捷工具');
 dock.innerHTML='<div class="sy-menu" id="sy-float-menu" role="group" aria-label="阅读设置"><button data-target="readerFontDown">A− 字体缩小</button><button data-target="readerFontUp">A＋ 字体放大</button><button data-target="readerTheme">◐ 切换主题</button><button data-target="readerTtsSettings">♫ 声音设置</button><button data-target="readerTts">▶ 听书/暂停</button><button data-target="readerToc">☷ 章节目录</button><button data-target="readerPrev">← 上一章</button><button data-target="readerNext">下一章 →</button><button data-target="readerBookmark">☆ 书签</button><button data-target="readerNotes">✎ 阅读笔记</button><button data-target="readerChangeSource">⇄ 更换书源</button><button data-target="readerRepairChapter">↻ 修复本章</button></div><button type="button" class="sy-fab sy-up" id="sy-back-top" aria-label="返回章节顶部">↑ 顶部</button><button type="button" class="sy-fab" id="sy-toggle" aria-controls="sy-float-menu" aria-expanded="false">⚙ 阅读设置</button>';
 document.body.appendChild(dock);
 const footer=document.getElementById('readerFooter');
 if(footer && !document.getElementById('sy-chapter-bottom')){
   const bar=document.createElement('nav');bar.id='sy-chapter-bottom';bar.setAttribute('aria-label','章节切换');
   bar.innerHTML='<button type="button" data-target="readerPrev">← 上一章</button><span id="readerPageLabel" aria-live="polite">书隐 · 静心阅读</span><button type="button" data-target="readerNext">下一章 →</button>';
   footer.insertAdjacentElement('afterend',bar);
   bar.querySelectorAll('[data-target]').forEach(btn=>btn.addEventListener('click',()=>{const original=document.getElementById(btn.dataset.target);if(original&&!original.disabled)original.click()}));
   const sync=()=>{bar.querySelectorAll('[data-target]').forEach(btn=>{const original=document.getElementById(btn.dataset.target);if(original){btn.disabled=original.disabled;btn.title=original.disabled?'当前不可切换':''}})};
   new MutationObserver(sync).observe(document.getElementById('reader'),{subtree:true,attributes:true,attributeFilter:['disabled']});sync();
 }
 
 const toggle=dock.querySelector('#sy-toggle');const toc=document.getElementById('readerTocPanel');
 function setOpen(open){dock.classList.toggle('sy-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'× 收起工具':'⚙ 阅读设置'}
 function closeToc(){toc?.classList.add('hidden')}
 toggle.addEventListener('click',()=>setOpen(!dock.classList.contains('sy-open')));
 dock.querySelector('#sy-back-top').addEventListener('click',()=>{setOpen(false);reader.scrollTo({top:0,behavior:'smooth'});});
 dock.querySelectorAll('[data-target]').forEach(btn=>btn.addEventListener('click',()=>{const target=document.getElementById(btn.dataset.target);if(!target)return;target.click();setOpen(false)}));
 function active(){return !reader.classList.contains('hidden')&&getComputedStyle(reader).display!=='none'}
 function update(){for(const id of ['readerPrev','readerNext']){const origin=document.getElementById(id);const proxy=dock.querySelector('[data-target="'+id+'"]');if(proxy&&origin){proxy.disabled=origin.disabled;proxy.title=origin.disabled?'当前不可切换':(origin.textContent||'').trim()}}const visible=active();dock.classList.toggle('sy-visible',visible);if(!visible){setOpen(false);closeToc()}dock.querySelector('#sy-back-top').hidden=reader.scrollTop<180}
 let pending=false;function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;update()})}
 reader.addEventListener('scroll',schedule,{passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
 new MutationObserver(schedule).observe(reader,{attributes:true,attributeFilter:['class','style']});
 document.getElementById('sy-toc-close')?.addEventListener('click',closeToc);
 // Outside tap closes the TOC; chapter buttons keep their existing app.js behavior.
 document.addEventListener('pointerdown',event=>{if(!active())return;const el=event.target;if(dock.classList.contains('sy-open')&&!dock.contains(el))setOpen(false);if(toc&&!toc.classList.contains('hidden')&&!toc.contains(el)&&!el.closest('#readerToc, #readerMobileToc, [data-target="readerToc"]'))closeToc()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){setOpen(false);closeToc()}});
 // Mobile TOC shortcut should toggle the same existing panel.
 document.getElementById('readerMobileToc')?.addEventListener('click',()=>{document.getElementById('readerToc')?.click()});
 update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
