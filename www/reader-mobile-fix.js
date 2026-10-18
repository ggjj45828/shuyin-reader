(function(){
'use strict';
function ready(){
 const reader=document.getElementById('reader'), more=document.getElementById('readerMobileMore'),menu=document.getElementById('readerMobileMenu'),items=document.getElementById('readerMobileMenuItems');
 if(!reader||!more||!menu||!items)return;
 const toolbar=reader.querySelector('.reader-toolbar');
 const moveIds=['readerFontDown','readerFontUp','readerRepairChapter','readerChangeSource','readerTtsSettings','readerBookmark','readerNotes','readerStats','readerAi','readerCacheStart','readerCacheCancel','readerSearchInside','readerAppearance','readerBackup','readerUpdateCheck'];
 // Move the actual buttons (not clones) so existing handlers remain attached.
 for(const id of moveIds){const node=document.getElementById(id);if(node&&node.parentElement!==items)items.appendChild(node)}
 const quality=document.getElementById('readerQuality'),progress=document.getElementById('readerCacheProgress');
 if(quality)items.prepend(quality);if(progress)items.appendChild(progress);
 function close(){menu.classList.add('hidden');more.setAttribute('aria-expanded','false')}
 more.addEventListener('click',()=>{const isOpen=menu.classList.toggle('hidden')===false;more.setAttribute('aria-expanded',String(isOpen))});
 document.getElementById('readerMobileTts')?.addEventListener('click',()=>document.getElementById('readerTts')?.click());
 document.getElementById('readerMobileToc')?.addEventListener('click',()=>document.getElementById('readerToc')?.click());
 items.addEventListener('click',e=>{if(e.target.closest('button'))close()});
 document.getElementById('closeReader')?.addEventListener('click',close);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
