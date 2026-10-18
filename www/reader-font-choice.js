/* 书隐 r88 · 正文字体选择（系统字体 + 内置字体）
   两层来源：
   1) iOS 自带的宋/楷/圆/黑/系统默认 —— 零体积，永远可用；
   2) `www/fonts/` 里子集化后的开源中文字体（GB2312 一级+二级，每个 1–2 MB），
      清单由 `fonts/manifest.json` 提供，加载失败就只显示系统字体，不报错。
   选择存在 localStorage['zhijian.readerFont']；字体只作用于正文与正文小标题，
   章节大标题仍用衬线，保留层次。 */
(() => {
  'use strict';

  const KEY = 'zhijian.readerFont';
  const SYSTEM = [
    { id: 'sys-songti', label: '宋体 · 典籍感', stack: '"Songti SC","STSong","SimSun","Noto Serif SC",serif' },
    { id: 'sys-kaiti', label: '楷体 · 手写感', stack: '"Kaiti SC","STKaiti","KaiTi","Songti SC",serif' },
    { id: 'sys-yuanti', label: '圆体 · 柔和', stack: '"Yuanti SC","STYuanti","Hiragino Sans GB",sans-serif' },
    { id: 'sys-heiti', label: '黑体 · 清晰', stack: '"PingFang SC","Heiti SC","Hiragino Sans GB",sans-serif' },
    { id: 'sys-default', label: '系统默认', stack: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif' }
  ];

  const $ = (id) => document.getElementById(id);
  const say = (message) => { try { if (typeof toast === 'function') toast(String(message)); } catch {} };
  let bundled = [];
  let loaded = false;

  const saved = () => { try { return localStorage.getItem(KEY) || 'sys-songti'; } catch { return 'sys-songti'; } };

  function stackOf(id) {
    const system = SYSTEM.find((item) => item.id === id);
    if (system) return system.stack;
    const custom = bundled.find((item) => item.id === id);
    if (custom) return '"' + custom.family + '",var(--serif)';
    return SYSTEM[0].stack;
  }

  function labelOf(id) {
    return (SYSTEM.find((item) => item.id === id) || bundled.find((item) => item.id === id))?.label || id;
  }

  function apply(id, { silent = true } = {}) {
    const valid = SYSTEM.some((item) => item.id === id) || bundled.some((item) => item.id === id);
    const font = valid ? id : 'sys-songti';
    $('reader')?.style.setProperty('--reader-font', stackOf(font));
    // 分页模式下换字体行宽变了，要重新分页，否则末页会被截断
    const state = window.getReadingState?.();
    if (state?.mode === 'page' && window.renderReaderContent) {
      const ratio = state.total > 1 ? state.page / (state.total - 1) : 0;
      window.renderReaderContent();
      const after = window.getReadingState?.();
      if (after && window.setReaderPage) window.setReaderPage(Math.round(ratio * Math.max(0, after.total - 1)));
    }
    try { localStorage.setItem(KEY, font); } catch {}
    const select = $('readerFontChoice');
    if (select && select.value !== font) select.value = font;
    if (!silent) say('正文已换成' + labelOf(font));
    return font;
  }

  function optionsMarkup() {
    const groups = ['<optgroup label="系统字体">' +
      SYSTEM.map((item) => '<option value="' + item.id + '">' + item.label + '</option>').join('') + '</optgroup>'];
    if (bundled.length) {
      groups.push('<optgroup label="内置字体（已下载到本机）">' +
        bundled.map((item) => '<option value="' + item.id + '">' + item.label + '</option>').join('') + '</optgroup>');
    }
    return groups.join('');
  }

  function build() {
    const select = $('readerFontChoice');
    if (!select) return;
    select.innerHTML = optionsMarkup();
    select.value = saved();
    apply(select.value);
  }

  async function loadBundled() {
    if (loaded) return;
    loaded = true;
    try {
      const response = await fetch('./fonts/manifest.json', { cache: 'force-cache' });
      if (!response.ok) return;
      const rows = await response.json();
      bundled = (Array.isArray(rows) ? rows : [])
        .filter((row) => row && row.id && row.family && row.file)
        .map((row) => ({ id: row.id, label: row.label || row.id, family: row.family }));
      build();
    } catch {}
  }

  function mount() {
    const controls = document.querySelector('.reader-chapter-controls');
    if (!controls || $('readerFontChoice')) return;
    const wrap = document.createElement('label');
    wrap.className = 'reader-font-picker';
    wrap.setAttribute('for', 'readerFontChoice');
    wrap.innerHTML = '<span>字体</span><select id="readerFontChoice">' + optionsMarkup() + '</select>';
    const anchor = $('readerTtsSettings') || $('readerTts') || null;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else controls.appendChild(wrap);
    const select = $('readerFontChoice');
    select.value = saved();
    select.addEventListener('change', () => apply(select.value, { silent: false }));
    apply(select.value);
    loadBundled();
  }

  // 主题切换会重算阅读页配色，字体变量挂在 #reader 上，重新应用一次最稳
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#readerTheme')) setTimeout(() => apply(saved()), 0);
  }, true);

  document.addEventListener('DOMContentLoaded', mount);
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.ShuyinFontChoice = { apply, fonts: SYSTEM, bundled: () => bundled, current: saved };
})();
