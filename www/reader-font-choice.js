/* 书隐 r87 · 正文字体选择
   只挑 iOS 系统自带的字体族，不打包任何字体文件：
   宋体 / 楷体 / 圆体 / 黑体 / 系统默认，五种任选，包体积零增长。
   选择存在 localStorage['zhijian.readerFont']，与字号、主题保持同一套习惯。
   字体只作用于正文与正文小标题；章节大标题仍用衬线，保留层次。 */
(() => {
  'use strict';

  const KEY = 'zhijian.readerFont';
  const FONTS = [
    { id: 'songti', label: '宋体 · 典籍感', stack: '"Songti SC","STSong","SimSun","Noto Serif SC",serif' },
    { id: 'kaiti', label: '楷体 · 手写感', stack: '"Kaiti SC","STKaiti","KaiTi","Songti SC",serif' },
    { id: 'yuanti', label: '圆体 · 柔和', stack: '"Yuanti SC","STYuanti","Hiragino Sans GB",sans-serif' },
    { id: 'heiti', label: '黑体 · 清晰', stack: '"PingFang SC","Heiti SC","Hiragino Sans GB",sans-serif' },
    { id: 'system', label: '系统默认', stack: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif' }
  ];

  const $ = (id) => document.getElementById(id);
  const say = (message) => { try { if (typeof toast === 'function') toast(String(message)); } catch {} };
  const saved = () => { try { return localStorage.getItem(KEY) || 'songti'; } catch { return 'songti'; } };
  const stackOf = (id) => (FONTS.find((item) => item.id === id) || FONTS[0]).stack;

  function apply(id, { silent = true } = {}) {
    const font = FONTS.some((item) => item.id === id) ? id : 'songti';
    const reader = $('reader');
    if (reader) reader.style.setProperty('--reader-font', stackOf(font));
    // 分页模式下换字体，行宽变了要重新分页，否则末页会被截断
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
    if (!silent) say('正文已换成' + (FONTS.find((item) => item.id === font)?.label || font));
    return font;
  }

  function mount() {
    const controls = document.querySelector('.reader-chapter-controls');
    if (!controls || $('readerFontChoice')) return;
    const wrap = document.createElement('label');
    wrap.className = 'reader-font-picker';
    wrap.setAttribute('for', 'readerFontChoice');
    wrap.innerHTML = '<span>字体</span><select id="readerFontChoice">' +
      FONTS.map((item) => '<option value="' + item.id + '">' + item.label + '</option>').join('') +
      '</select>';
    const anchor = $('readerTtsSettings') || $('readerTts') || null;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else controls.appendChild(wrap);
    const select = $('readerFontChoice');
    select.value = saved();
    select.addEventListener('change', () => apply(select.value, { silent: false }));
    apply(select.value);
  }

  // 主题切换会重建阅读页样式，字体变量挂在 #reader 上，重新应用一次最稳
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#readerTheme')) setTimeout(() => apply(saved()), 0);
  }, true);

  document.addEventListener('DOMContentLoaded', mount);
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.ShuyinFontChoice = { apply, fonts: FONTS, current: saved };
})();
