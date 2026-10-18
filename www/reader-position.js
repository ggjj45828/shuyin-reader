/* 书隐 r88 · 阅读位置号（按 Kindle 的思路：不存页码，存字符位置）
   为什么不用页码：改字号、换字体、换机型都会让页数变化，恢复到的页码就偏了。
   字符偏移是稳定的，除非这一章正文本身被网站重写。
   行为：
   1) 滚动时记录「当前视口顶端是这一章的第几个字」，按章存在 book.chapterOffsets；
   2) 打开书时优先按字符偏移恢复，偏移失效（正文长度变化过大）再退回百分比；
   3) 页脚显示「位置 1234 / 5678」，与 Kindle 的位置号同一个意思。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { bookId: null, chapter: -1, restoring: false, timer: 0, lastTotal: 0 };

  const reader = () => $('reader');
  const visible = () => !!reader() && !reader().classList.contains('hidden');
  const blocks = () => [...document.querySelectorAll('#readerContent > *')];
  const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

  function totalChars() {
    return blocks().reduce((sum, el) => sum + textOf(el).length, 0);
  }

  // 视口顶端落在第几个字
  function offsetAtTop() {
    const panel = reader();
    if (!panel) return 0;
    const top = panel.getBoundingClientRect().top + 10;
    let carried = 0;
    for (const el of blocks()) {
      const box = el.getBoundingClientRect();
      const length = textOf(el).length;
      if (box.bottom > top) {
        if (box.top >= top) return carried;
        const ratio = (top - box.top) / Math.max(1, box.height);
        return carried + Math.floor(length * Math.min(1, Math.max(0, ratio)));
      }
      carried += length;
    }
    return carried;
  }

  function pointOf(el, chars) {
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = Math.max(0, chars);
    let node = walker.nextNode();
    while (node) {
      const length = node.nodeValue.length;
      if (left <= length) return { node, offset: left };
      left -= length;
      node = walker.nextNode();
    }
    return null;
  }

  function scrollToOffset(offset) {
    const panel = reader();
    if (!panel) return;
    let carried = 0;
    for (const el of blocks()) {
      const length = textOf(el).length;
      if (carried + length >= offset) {
        const point = pointOf(el, offset - carried);
        if (point) {
          try {
            const range = document.createRange();
            range.setStart(point.node, point.offset);
            const rect = range.getBoundingClientRect();
            panel.scrollTop += rect.top - panel.getBoundingClientRect().top - 10;
            return;
          } catch {}
        }
        el.scrollIntoView({ block: 'start' });
        return;
      }
      carried += length;
    }
  }

  function book() {
    try { return window.currentBook || null; } catch { return null; }
  }

  function currentChapter() {
    return Number(book()?.currentChapterIndex || 0);
  }

  function offsets(target = book()) {
    if (!target) return {};
    target.chapterOffsets = target.chapterOffsets || {};
    return target.chapterOffsets;
  }

  function renderLabel() {
    const box = $('readerLoc');
    if (!box) return;
    const offset = Number(offsets()[currentChapter()] || 0);
    const total = state.lastTotal || totalChars();
    box.textContent = total ? '位置 ' + Math.min(offset, total) + ' / ' + total : '';
  }

  function capture() {
    const target = book();
    if (!target || state.restoring || !visible()) return;
    const offset = offsetAtTop();
    state.lastTotal = totalChars();
    const map = offsets(target);
    const index = currentChapter();
    if (Number(map[index] || 0) === offset) return;
    map[index] = offset;
    // 与百分比一起写：老版本读不到偏移时还能靠百分比兜底
    target.positionSavedAt = Date.now();
    renderLabel();
    try { persistReadingProgress?.(); } catch {}
  }

  function scheduleCapture() {
    clearTimeout(state.timer);
    state.timer = setTimeout(capture, 500);
  }

  function restore() {
    const target = book();
    if (!target || !visible()) return;
    const index = currentChapter();
    const offset = Number(offsets(target)[index] || 0);
    const total = totalChars();
    state.lastTotal = total;
    renderLabel();
    if (!offset || !total) return;
    // 正文被网站重写过（长度差一半以上），偏移已无意义，交给百分比兜底
    const savedTotal = Number(offsets(target)['len' + index] || 0);
    if (savedTotal && Math.abs(savedTotal - total) / Math.max(1, savedTotal) > 0.5) return;
    state.restoring = true;
    const mode = window.getReadingState?.()?.mode;
    if (mode === 'page' && window.setReaderPage) {
      const pages = Number(window.getReadingState?.()?.total) || 1;
      window.setReaderPage(Math.min(pages - 1, Math.round(offset / Math.max(1, total) * (pages - 1))));
    } else {
      requestAnimationFrame(() => scrollToOffset(offset));
    }
    state.restoring = false;
  }

  function mount() {
    const page = document.querySelector('#reader .reader-page');
    if (!page || $('readerLoc')) return;
    const box = document.createElement('div');
    box.id = 'readerLoc';
    box.className = 'reader-loc';
    page.appendChild(box);
    renderLabel();
  }

  function watch() {
    mount();
    const panel = reader();
    if (!panel) return;
    panel.addEventListener('scroll', () => {
      if (state.restoring) return;
      state.lastTotal = totalChars();
      renderLabel();
      scheduleCapture();
    }, { passive: true });
  }

  // 内容重建（换章、重新分页、换字体）后恢复一次位置
  let rebuildTimer = 0;
  function onContentRebuilt() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      const target = book();
      if (!target) return;
      const key = String(target.id || target.title || '') + '#' + currentChapter();
      if (state.bookId === key) { renderLabel(); return; }
      state.bookId = key;
      restore();
    }, 120);
  }

  document.addEventListener('DOMContentLoaded', () => {
    watch();
    const content = $('readerContent');
    if (content) new MutationObserver(onContentRebuilt).observe(content, { childList: true });
    const panel = reader();
    if (panel) new MutationObserver(mount).observe(panel, { childList: true });
  });

  window.ShuyinPosition = {
    offsetAtTop,
    restore,
    capture,
    save: () => {
      const target = book();
      if (!target) return 0;
      const index = currentChapter();
      const offset = offsetAtTop();
      offsets(target)[index] = offset;
      offsets(target)['len' + index] = totalChars();
      return offset;
    }
  };
})();
