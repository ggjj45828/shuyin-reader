/* 书隐 r86 · 阅读观感
   两件事，都不改数据结构：
   1) 顶部一条 3px 阅读进度条 —— 长章节里能看出还剩多少；
   2) 给正文容器补排版细节（首段不缩进、段落呼吸、选中色），走 CSS 变量，夜间自动适配。
   进度条只在阅读页可见，切到书架/发现页立刻归零隐藏。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function fillBar() {
    const reader = $('reader');
    const bar = $('readerProgress');
    const fill = bar?.firstElementChild;
    if (!reader || !fill) return;
    if (reader.classList.contains('hidden')) { fill.style.width = '0%'; bar.classList.add('is-idle'); return; }
    bar.classList.remove('is-idle');
    const max = reader.scrollHeight - reader.clientHeight;
    const percent = max > 0 ? Math.min(100, Math.max(0, reader.scrollTop / max * 100)) : 0;
    fill.style.width = percent.toFixed(2) + '%';
  }

  function mount() {
    const reader = $('reader');
    if (!reader || $('readerProgress')) return;
    const bar = document.createElement('div');
    bar.id = 'readerProgress';
    bar.className = 'is-idle';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    reader.appendChild(bar);
    reader.addEventListener('scroll', fillBar, { passive: true });
    window.addEventListener('resize', fillBar);
    new MutationObserver(fillBar).observe(reader, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    fillBar();
  }

  document.addEventListener('DOMContentLoaded', mount);
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.ShuyinReadingPolish = { refresh: fillBar };
})();
