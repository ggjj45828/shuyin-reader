/* 书隐 r70 · 听书增强
   不接管 reader-nas-tts 的播放状态机，只做三件事：
   1) 消费原生插件的 speechProgress 事件，把正在朗读的那一句在正文里高亮并跟随滚动；
   2) 「从这里读」——把当前屏幕位置换算成字符偏移写进听书进度，再从那里开口；
   3) 往听书面板里补音量 / 音高 / 语速 / 跟随开关（写回 zhijian_nas_tts_v1）。
   原生语音一次 speak() 覆盖整章，所以这里的偏移空间就是 #readerContent.innerText。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SETTINGS_KEY = 'zhijian_nas_tts_v1';
  const POS_KEY = 'shuyin_r58_listen_position';
  const FOLLOW_KEY = 'shuyin.tts.follow.v1';

  const plugin = () => window.ShuyinAudio || window.Capacitor?.Plugins?.ShuyinAudio;
  const isNative = () => !!window.Capacitor?.isNativePlatform?.();

  let follow = localStorage.getItem(FOLLOW_KEY) !== '0';
  let mark = null;
  let lastKey = '';
  let lastApply = 0;
  let lastProgressAt = 0;
  let bound = false;

  function settings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings(), ...patch })); } catch {}
  }
  function say(msg) { if (typeof toast === 'function') toast(String(msg).slice(0, 110)); }

  // ---------- innerText 偏移 ↔ DOM 文本节点 ----------
  const BLOCKS = 'p,div,h1,h2,h3,h4,h5,li,blockquote,section,article';
  function leafBlocks(root) {
    return [...root.querySelectorAll(BLOCKS)].filter((el) => !el.querySelector(BLOCKS));
  }
  function relNodes(el) {
    const out = [];
    let off = 0;
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          out.push({ node: child, start: off, len: child.nodeValue.length });
          off += child.nodeValue.length;
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') off += 1;
          else walk(child);
        }
      }
    })(el);
    return out;
  }
  /* 逐块在整章 innerText 里定位，能容忍块之间的换行；对不上就跳过该块，绝不猜。 */
  function buildIndex(root) {
    const full = root.innerText || '';
    const entries = [];
    let cursor = 0;
    for (const el of leafBlocks(root)) {
      const text = el.innerText || '';
      if (!text.trim()) continue;
      const at = full.indexOf(text, cursor);
      if (at < 0) continue;
      cursor = at + text.length;
      for (const row of relNodes(el)) {
        entries.push({ node: row.node, start: at + row.start, end: at + row.start + row.len });
      }
    }
    return entries;
  }

  function clearMark() {
    if (!mark) { lastKey = ''; return; }
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
    mark = null;
    lastKey = '';
  }

  function scrollToMark(el) {
    const reader = $('reader');
    if (!reader) return;
    const box = reader.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.top >= box.top + 56 && rect.bottom <= box.bottom - 80) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { el.scrollIntoView(); }
  }

  function applyMark(location) {
    const root = $('readerContent');
    if (!root) return;
    const entries = buildIndex(root);
    if (!entries.length) return;
    let hit = null;
    for (const entry of entries) {
      if (location >= entry.start && location < entry.end) { hit = entry; break; }
    }
    if (!hit || !hit.node.nodeValue) return;

    const str = hit.node.nodeValue;
    const local = Math.max(0, Math.min(str.length - 1, location - hit.start));
    let start = local;
    let end = local;
    while (start > 0 && !/[。！？!?；;\n]/.test(str[start - 1])) start -= 1;
    while (end < str.length && !/[。！？!?；;\n]/.test(str[end])) end += 1;
    if (end < str.length) end += 1;
    if (end <= start) return;

    const key = hit.start + ':' + start + ':' + end;
    if (key === lastKey && mark && mark.parentNode) return;

    clearMark();
    const tail = hit.node.splitText(start);
    const piece = tail.nodeValue.slice(0, end - start);
    if (end - start < tail.nodeValue.length) tail.splitText(end - start);
    const node = document.createElement('mark');
    node.className = 'shuyin-tts-follow';
    node.textContent = piece;
    if (tail.parentNode) tail.parentNode.replaceChild(node, tail);
    mark = node;
    lastKey = key;
    scrollToMark(node);
  }

  // ---------- 原生事件 ----------
  function bindPlugin() {
    if (bound) return true;
    const api = plugin();
    if (!api || typeof api.addListener !== 'function') return false;
    bound = true;
    api.addListener('speechProgress', (event) => {
      lastProgressAt = Date.now();
      if (!follow) return;
      const now = Date.now();
      if (now - lastApply < 380) return;
      lastApply = now;
      const location = Number(event?.location);
      if (!Number.isFinite(location) || location < 0) return;
      applyMark(location);
    });
    api.addListener('speechChapter', () => clearMark());
    api.addListener('speechFinished', () => clearMark());
    return true;
  }
  if (!bindPlugin()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (bindPlugin() || tries > 40) clearInterval(timer);
    }, 250);
  }
  // 朗读被暂停/停止后不再有事件，靠超时收尾
  setInterval(() => {
    if (mark && lastProgressAt && Date.now() - lastProgressAt > 9000) clearMark();
  }, 3000);
  $('closeReader')?.addEventListener('click', () => clearMark(), true);

  // ---------- 从这里读 ----------
  function offsetAtViewport() {
    const root = $('readerContent');
    const reader = $('reader');
    if (!root || !reader) return null;
    const box = root.getBoundingClientRect();
    const y = Math.max(box.top + 6, reader.getBoundingClientRect().top + 90);
    const x = box.left + 12;
    let node = null;
    let within = 0;
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; within = range.startOffset; }
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) { node = pos.offsetNode; within = pos.offset; }
    }
    if (!node) return null;
    for (const entry of buildIndex(root)) {
      if (entry.node === node) return entry.start + within;
    }
    return null;
  }

  function readFromHere() {
    const book = (typeof currentBook !== 'undefined' && currentBook) || window.currentBook || null;
    const button = $('readerTts');
    if (!button) return;
    if (!book) { say('请先打开一本书再听书'); return; }

    const text = button.textContent || '';
    const playing = text.includes('暂停') || text.includes('继续') || text.includes('准备');
    if (playing) button.click(); // 先停，避免点成暂停

    const offset = offsetAtViewport();
    if (offset != null && offset > 0) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          book: book.id || $('readerBookTitle')?.textContent || '',
          chapter: $('readerTitle')?.textContent || '',
          chapterIndex: Number(book.currentChapterIndex || 0),
          part: 0,
          seconds: 0,
          charOffset: offset,
          updated: Date.now()
        }));
      } catch {}
    }
    button.click();
    say(offset != null && offset > 0 ? '从这里开始朗读（第 ' + offset + ' 字）' : '从本章开头朗读');
  }

  const ttsButton = $('readerTts');
  if (ttsButton?.parentNode) {
    const quick = document.createElement('button');
    quick.id = 'readerReadFromHere';
    quick.type = 'button';
    quick.className = 'reader-tool-button';
    quick.textContent = '从这里读';
    ttsButton.parentNode.insertBefore(quick, ttsButton.nextSibling);
    quick.addEventListener('click', readFromHere);
  }

  // ---------- 听书面板里的音量 / 音高 / 语速 ----------
  function injectPanel() {
    const body = $('readerExtraBody');
    if (!body || body.querySelector('#ttsPlus')) return;
    if (!body.querySelector('#nasEngine')) return; // 不是听书面板
    const current = settings();
    const volume = Number(current.volume ?? 1);
    const pitch = Number(current.pitch ?? 1);
    const rate = Number(current.rate ?? 1);

    const box = document.createElement('div');
    box.id = 'ttsPlus';
    box.className = 'tts-settings tts-plus';
    box.innerHTML =
      '<label>音量 <span id="ttsPlusVolLabel">' + Math.round(volume * 100) + '%</span></label>' +
      '<input id="ttsPlusVol" type="range" min="0.2" max="1" step="0.05" value="' + volume + '">' +
      '<label>音高 <span id="ttsPlusPitchLabel">' + pitch.toFixed(2) + '</span></label>' +
      '<input id="ttsPlusPitch" type="range" min="0.7" max="1.34" step="0.02" value="' + pitch + '">' +
      '<label>语速 <span id="ttsPlusRateLabel">' + rate.toFixed(1) + '×</span></label>' +
      '<input id="ttsPlusRate" type="range" min="0.5" max="1.8" step="0.1" value="' + rate + '">' +
      '<label class="tts-check"><input id="ttsPlusFollow" type="checkbox"' + (follow ? ' checked' : '') + '> 朗读时高亮并跟随当前句</label>' +
      '<div class="tts-actions"><button id="ttsPlusFromHere" type="button">从这里开始读</button></div>' +
      '<small>音量、音高交给 iPhone 系统语音；语速与音高在下一段朗读时生效。</small>';
    body.appendChild(box);

    $('ttsPlusVol').oninput = (event) => {
      const value = Number(event.target.value);
      $('ttsPlusVolLabel').textContent = Math.round(value * 100) + '%';
      saveSettings({ volume: value });
    };
    $('ttsPlusPitch').oninput = (event) => {
      const value = Number(event.target.value);
      $('ttsPlusPitchLabel').textContent = value.toFixed(2);
      saveSettings({ pitch: value });
    };
    $('ttsPlusRate').oninput = (event) => {
      const value = Number(event.target.value);
      $('ttsPlusRateLabel').textContent = value.toFixed(1) + '×';
      saveSettings({ rate: value });
    };
    $('ttsPlusFollow').onchange = (event) => {
      follow = !!event.target.checked;
      try { localStorage.setItem(FOLLOW_KEY, follow ? '1' : '0'); } catch {}
      if (!follow) clearMark();
    };
    $('ttsPlusFromHere').onclick = readFromHere;
  }

  const watch = $('readerExtraBody');
  if (watch && typeof MutationObserver === 'function') {
    new MutationObserver(() => injectPanel()).observe(watch, { childList: true });
  }
  $('readerTtsSettings')?.addEventListener('click', () => setTimeout(injectPanel, 0), true);

  if (isNative()) injectPanel();
})();
