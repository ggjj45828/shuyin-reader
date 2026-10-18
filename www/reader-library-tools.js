/* 书隐 r70 · 全库检索与笔记整理
   补两件原本缺失的读书能力：
   1) 跨书检索 —— 同时搜书名、作者、章节标题、笔记、书签，以及每本书最后载入的那一章正文；
   2) 笔记/书签汇总 —— 全库按书分组列出，可导出 Markdown 交给系统分享。
   只用 window.getBooks() / window.openBookById() 这两个既有出口，不改核心数据结构。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function panel(title, markup) {
    const titleNode = $('readerExtraTitle');
    const body = $('readerExtraBody');
    const shell = $('readerExtraPanel');
    if (!titleNode || !body || !shell) return false;
    titleNode.textContent = title;
    body.innerHTML = markup;
    shell.classList.remove('hidden');
    return true;
  }
  function say(msg) { if (typeof toast === 'function') toast(String(msg).slice(0, 110)); }
  function shelf() {
    try { return window.getBooks?.() || []; } catch { return []; }
  }
  function openBook(book) {
    if (!book) return;
    try { window.openBookById?.(book.id); } catch {}
    say('已打开《' + (book.title || '未命名') + '》');
  }
  function when(timestamp) {
    const value = Number(timestamp || 0);
    return value ? new Date(value).toLocaleString() : '';
  }

  // ---------------- 全库检索 ----------------
  const KIND_ORDER = ['书名', '作者', '章节', '笔记', '引用', '书签', '正文'];

  function collect(book, query) {
    const needle = query.toLowerCase();
    const rows = [];
    const push = (kind, text, extra) => {
      const raw = String(text || '');
      if (!raw) return;
      const at = raw.toLowerCase().indexOf(needle);
      if (at < 0) return;
      const from = Math.max(0, at - 26);
      const snippet = (from > 0 ? '…' : '') + raw.slice(from, at + needle.length + 40) + (at + needle.length + 40 < raw.length ? '…' : '');
      rows.push({ kind, snippet, ...extra });
    };
    push('书名', book.title, {});
    push('作者', book.author, {});
    (book.chapters || []).forEach((chapter, index) => push('章节', chapter?.title, { chapterIndex: index }));
    (book.notes || []).forEach((note) => {
      push('笔记', note?.note, { chapterIndex: note?.chapter });
      push('引用', note?.quote, { chapterIndex: note?.chapter });
    });
    (book.bookmarks || []).forEach((bookmark) => push('书签', bookmark?.title, { chapterIndex: bookmark?.chapter }));
    if (book.content) push('正文', book.content, { chapterIndex: book.currentChapterIndex || 0 });
    return rows;
  }

  function searchLibrary(query) {
    const books = shelf();
    const grouped = [];
    let total = 0;
    for (const book of books) {
      const rows = collect(book, query);
      if (!rows.length) continue;
      rows.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
      grouped.push({ book, rows });
      total += rows.length;
      if (total >= 80) break;
    }
    return { grouped, total, scanned: books.length };
  }

  function renderHits(result, query) {
    const root = $('libHits');
    if (!root) return;
    if (!result.grouped.length) {
      root.innerHTML = '<p class="form-hint">在 ' + result.scanned + ' 本书里没有找到「' + esc(query) + '」。' +
        '跨书检索覆盖书名、作者、章节标题、笔记与书签，以及每本书最后读过的那一章正文。</p>';
      return;
    }
    root.innerHTML = '<p class="form-hint">在 ' + result.scanned + ' 本书里命中 ' + result.total + ' 处。</p>' +
      result.grouped.map((group, bookIndex) =>
        '<div class="lib-hit-book"><strong class="lib-hit-title" data-book="' + bookIndex + '">' + esc(group.book.title || '未命名') + '</strong>' +
        group.rows.map((row) =>
          '<div class="reader-extra-entry lib-hit"><span class="lib-hit-kind">' + esc(row.kind) + '</span>' +
          '<span>' + esc(row.snippet) + '</span></div>'
        ).join('') + '</div>'
      ).join('');
    root.querySelectorAll('[data-book]').forEach((node) => {
      node.addEventListener('click', () => openBook(result.grouped[Number(node.dataset.book)].book));
    });
  }

  function showSearch() {
    panel('全库检索', '<p>一次搜完所有书：书名、作者、章节标题、笔记、书签，以及每本书最后读过的那一章正文。</p>' +
      '<input id="libQuery" placeholder="输入人名、地名、句子或书名"><button id="libGo">开始检索</button><div id="libHits"></div>');
    const input = $('libQuery');
    $('libGo').onclick = () => {
      const query = input.value.trim();
      if (!query) return;
      $('libHits').innerHTML = '<p class="form-hint">正在检索…</p>';
      renderHits(searchLibrary(query), query);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') $('libGo').click();
    });
  }

  // ---------------- 笔记与书签汇总 ----------------
  function gatherNotes() {
    return shelf().map((book) => ({
      book,
      notes: [...(book.notes || [])].sort((a, b) => Number(a?.at || 0) - Number(b?.at || 0)),
      bookmarks: [...(book.bookmarks || [])].sort((a, b) => Number(a?.at || 0) - Number(b?.at || 0))
    })).filter((row) => row.notes.length || row.bookmarks.length);
  }

  function toMarkdown(rows) {
    const lines = ['# 书隐 · 笔记与书签', '', '导出时间：' + new Date().toLocaleString(), ''];
    let noteCount = 0;
    let bookmarkCount = 0;
    for (const row of rows) {
      lines.push('## ' + (row.book.title || '未命名'));
      if (row.book.author) lines.push('*' + row.book.author + '*');
      lines.push('');
      if (row.notes.length) {
        lines.push('### 笔记');
        for (const note of row.notes) {
          noteCount += 1;
          lines.push('- ' + (note.title || '') + (note.at ? '（' + when(note.at) + '）' : ''));
          if (note.quote) lines.push('  > ' + String(note.quote).replace(/\n+/g, ' '));
          if (note.note) lines.push('  ' + String(note.note).replace(/\n+/g, ' '));
        }
        lines.push('');
      }
      if (row.bookmarks.length) {
        lines.push('### 书签');
        for (const bookmark of row.bookmarks) {
          bookmarkCount += 1;
          lines.push('- ' + (bookmark.title || '') + (bookmark.progress != null ? ' · ' + Number(bookmark.progress).toFixed(1) + '%' : ''));
        }
        lines.push('');
      }
    }
    lines.push('---', '共 ' + rows.length + ' 本、' + noteCount + ' 条笔记、' + bookmarkCount + ' 个书签。');
    return lines.join('\n');
  }

  function base64Of(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function exportNotes() {
    const rows = gatherNotes();
    if (!rows.length) { say('还没有笔记或书签可导出'); return; }
    const markdown = toMarkdown(rows);
    const fileName = '书隐笔记-' + new Date().toISOString().slice(0, 10) + '.md';
    const share = window.ShuyinShare;
    if (window.Capacitor?.isNativePlatform?.() && share?.shareFile) {
      try {
        await share.shareFile({ fileName, dataBase64: base64Of(markdown) });
        say('已调起系统分享');
        return;
      } catch (error) {
        say('分享失败：' + error.message);
        return;
      }
    }
    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say('已导出 ' + fileName);
    } catch (error) {
      say('导出失败：' + error.message);
    }
  }

  function showNotes() {
    const rows = gatherNotes();
    if (!rows.length) { say('还没有笔记或书签'); return; }
    const noteCount = rows.reduce((sum, row) => sum + row.notes.length, 0);
    const bookmarkCount = rows.reduce((sum, row) => sum + row.bookmarks.length, 0);
    const markup = '<p class="form-hint">' + rows.length + ' 本书里有 ' + noteCount + ' 条笔记、' + bookmarkCount + ' 个书签。</p>' +
      '<div class="tts-actions"><button id="libExport" type="button">导出 Markdown</button><button id="libCopy" type="button">复制到剪贴板</button></div>' +
      rows.map((row, index) =>
        '<div class="lib-hit-book"><strong>' + esc(row.book.title || '未命名') + '</strong>' +
        row.notes.map((note) =>
          '<div class="reader-extra-entry"><small>' + esc(note.title || '') + ' · ' + esc(when(note.at)) + '</small>' +
          (note.quote ? '<p class="lib-quote">' + esc(note.quote) + '</p>' : '') +
          (note.note ? '<p>' + esc(note.note) + '</p>' : '') + '</div>'
        ).join('') +
        row.bookmarks.map((bookmark) =>
          '<div class="reader-extra-entry"><span class="lib-hit-kind">书签</span> ' + esc(bookmark.title || '') +
          (bookmark.progress != null ? ' · ' + Number(bookmark.progress).toFixed(1) + '%' : '') + '</div>'
        ).join('') +
        '<button type="button" data-open="' + index + '">打开这本书</button></div>'
      ).join('');
    panel('笔记与书签', markup);
    $('libExport').onclick = exportNotes;
    $('libCopy').onclick = async () => {
      const markdown = toMarkdown(gatherNotes());
      try {
        await navigator.clipboard.writeText(markdown);
        say('整份笔记已复制到剪贴板');
      } catch {
        say('剪贴板不可用，请改用导出');
      }
    };
    document.querySelectorAll('#readerExtraBody [data-open]').forEach((button) => {
      button.addEventListener('click', () => openBook(rows[Number(button.dataset.open)].book));
    });
  }

  // ---------------- 挂两个按钮 ----------------
  const anchor = $('readerNotes');
  if (anchor?.parentNode) {
    const add = (id, label, handler) => {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'reader-tool-button';
      button.textContent = label;
      anchor.parentNode.insertBefore(button, anchor);
      button.addEventListener('click', handler);
      return button;
    };
    add('readerLibrarySearch', '全库检索', showSearch);
    add('readerNoteBoard', '笔记汇总', showNotes);
  }
})();
