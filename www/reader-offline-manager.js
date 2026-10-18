/* 书隐 r85 · 离线资源管理
   解决三件原本看不见的事：
   1) 每本书整本缓存了多少章、占多大空间（原来只有一个「已保存 x/y 章」的瞬时提示）；
   2) 能删单章，也能一次清空某本书的章节缓存（原来只能整本删书）；
   3) 能按书查看和删除「保存本章音频」生成的 CAF 文件（原来生成后无从管理）。
   章节数据仍放在 book.cachedChapters / book.repairedChapters，不新增存储键；
   只有一个音频归属索引 shuyin.audio.index.v1，记录文件名属于哪本书哪一章。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AUDIO_INDEX = 'shuyin.audio.index.v1';

  const say = (message) => { try { if (typeof toast === 'function') toast(String(message).slice(0, 110)); } catch {} };
  const shelf = () => { try { return window.getBooks?.() || []; } catch { return []; } };
  const native = () => !!window.Capacitor?.isNativePlatform?.();

  function bytesOf(text) {
    const raw = String(text || '');
    try { return new Blob([raw]).size; } catch { return raw.length * 3; }
  }
  function size(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
    return (value / 1073741824).toFixed(2) + ' GB';
  }
  function when(at) {
    const value = Number(at || 0);
    return value ? new Date(value).toLocaleDateString() : '';
  }

  // ---------------- 章节缓存统计 ----------------
  function cachedRows(book) {
    const rows = [];
    const cached = book?.cachedChapters || {};
    Object.keys(cached).forEach((key) => {
      const item = cached[key];
      if (!item || !item.content) return;
      rows.push({ index: Number(key), title: item.title || ('第 ' + (Number(key) + 1) + ' 章'), bytes: bytesOf(item.content), chars: String(item.content).length, at: item.cachedAt, url: item.url, kind: '缓存' });
    });
    const repaired = book?.repairedChapters || {};
    Object.keys(repaired).forEach((key) => {
      if (cached[key]?.content) return;
      const item = repaired[key];
      if (!item || !item.content) return;
      rows.push({ index: Number(key), title: item.title || ('第 ' + (Number(key) + 1) + ' 章'), bytes: bytesOf(item.content), chars: String(item.content).length, at: item.at, url: item.url, kind: '修复' });
    });
    rows.sort((a, b) => a.index - b.index);
    return rows;
  }

  function stats(book) {
    const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
    const rows = cachedRows(book);
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    const chars = rows.reduce((sum, row) => sum + row.chars, 0);
    const total = chapters.length || (book?.content ? 1 : 0);
    return {
      rows,
      bytes,
      chars,
      total,
      done: rows.length,
      percent: total ? Math.min(100, Math.round(rows.length / total * 100)) : 0,
      failed: Object.keys(book?.cacheFailures || {}).length
    };
  }

  // ---------------- 听书音频 ----------------
  function audioIndex() {
    try {
      const rows = JSON.parse(localStorage.getItem(AUDIO_INDEX) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }
  function writeAudioIndex(rows) {
    try { localStorage.setItem(AUDIO_INDEX, JSON.stringify(rows.slice(-400))); } catch {}
  }
  function audioPlugin() {
    if (!native()) return null;
    return window.ShuyinAudio || window.Capacitor?.Plugins?.ShuyinAudio || null;
  }
  async function audioFiles() {
    const api = audioPlugin();
    if (!api?.listAudio) return { supported: false, files: [] };
    try {
      const result = await api.listAudio();
      const files = Array.isArray(result?.files) ? result.files : [];
      return { supported: true, files };
    } catch (error) {
      return { supported: false, files: [], error: error?.message || '无法读取音频目录' };
    }
  }
  async function deleteAudioFile(name) {
    const api = audioPlugin();
    if (!api?.deleteAudio) { say('这一版还不支持删除音频，请升级后重试'); return false; }
    try {
      await api.deleteAudio({ name });
      writeAudioIndex(audioIndex().filter((row) => row.name !== name));
      return true;
    } catch (error) {
      say('删除失败：' + (error?.message || error));
      return false;
    }
  }

  function indexOfAudio(name) {
    return audioIndex().find((row) => row.name === name) || null;
  }

  // ---------------- 删除操作 ----------------
  function dropChapter(book, index) {
    const rows = cachedRows(book);
    const target = rows.find((row) => row.index === Number(index));
    if (!target) return;
    if (book.cachedChapters) delete book.cachedChapters[index];
    if (book.repairedChapters) delete book.repairedChapters[index];
    if (book.cacheFailures) delete book.cacheFailures[index];
    const active = window.currentBook;
    if (active && String(active.id) === String(book.id) && Number(active.currentChapterIndex) === Number(index)) {
      say('已删除第 ' + (Number(index) + 1) + ' 章的本机缓存；屏幕上的正文保留到离开这一章');
    } else {
      say('已删除第 ' + (Number(index) + 1) + ' 章 · 释放 ' + size(target.bytes));
    }
    window.saveCurrentBook?.();
    render();
  }

  function dropBookChapters(book) {
    const rows = cachedRows(book);
    if (!rows.length) { say('这本书没有本机章节缓存'); return; }
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    if (!window.confirm('删除《' + (book.title || '未命名') + '》的 ' + rows.length + ' 章本机缓存？可释放 ' + size(bytes) + '。正文还在书源网站上，随时可以重新下载。')) return;
    if (book.cachedChapters) book.cachedChapters = {};
    if (book.repairedChapters) book.repairedChapters = {};
    if (book.cacheFailures) book.cacheFailures = {};
    say('已清空《' + (book.title || '未命名') + '》的章节缓存 · 释放 ' + size(bytes));
    window.saveCurrentBook?.();
    render();
  }

  // ---------------- 界面 ----------------
  function panel(title, markup) {
    const titleNode = $('readerExtraTitle');
    const body = $('readerExtraBody');
    const shellNode = $('readerExtraPanel');
    if (!titleNode || !body || !shellNode) return false;
    titleNode.textContent = title;
    body.innerHTML = markup;
    shellNode.classList.remove('hidden');
    return true;
  }

  let viewBookId = null;   // null = 总览
  let audioCache = { supported: false, files: [] };
  let storageCache = null;

  function chapterDetail(book) {
    const info = stats(book);
    if (!info.rows.length) return '<p class="form-hint">这本书还没有任何章节保存在本机。</p>';
    return '<div class="offline-chapter-list">' + info.rows.map((row) =>
      '<div class="offline-chapter-row"><span class="offline-chapter-title">' + esc(row.title) + '</span>' +
      '<small>' + size(row.bytes) + ' · ' + row.chars.toLocaleString() + ' 字 · ' + esc(row.kind) +
      (row.at ? ' · ' + esc(when(row.at)) : '') + '</small>' +
      '<button type="button" data-drop-chapter="' + row.index + '">删除</button></div>'
    ).join('') + '</div>';
  }

  function bookRow(book) {
    const info = stats(book);
    const mine = audioCache.files.filter((file) => indexOfAudio(file.name)?.bookId === String(book.id));
    const audioBytes = mine.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
    const open = String(viewBookId) === String(book.id);
    return '<div class="offline-book' + (open ? ' is-open' : '') + '">' +
      '<div class="offline-book-head"><strong>' + esc(book.title || '未命名') + '</strong>' +
      '<span class="offline-book-size">' + size(info.bytes + audioBytes) + '</span></div>' +
      '<div class="offline-meter"><i style="width:' + info.percent + '%"></i></div>' +
      '<p class="offline-book-meta">章节 ' + info.done + '/' + (info.total || '?') + ' · ' + info.percent + '% · ' + size(info.bytes) +
      (info.failed ? ' · <b class="offline-warn">' + info.failed + ' 章上次失败</b>' : '') +
      (mine.length ? ' · 音频 ' + mine.length + ' 个 · ' + size(audioBytes) : '') + '</p>' +
      '<div class="offline-book-actions">' +
      '<button type="button" data-offline-download="' + esc(book.id) + '">' + (info.done && info.done < info.total ? '继续下载' : '下载整本') + '</button>' +
      '<button type="button" data-offline-open="' + esc(book.id) + '">' + (open ? '收起明细' : '章节明细') + '</button>' +
      '<button type="button" class="offline-danger" data-offline-clear="' + esc(book.id) + '">清空章节</button>' +
      '</div>' +
      (open ? chapterDetail(book) + (mine.length ? '<div class="offline-chapter-list">' + mine.map((file) =>
        '<div class="offline-chapter-row"><span class="offline-chapter-title">' + esc(indexOfAudio(file.name)?.chapterTitle || file.name) + '</span>' +
        '<small>听书音频 · ' + size(file.bytes) + ' · ' + esc(when(file.at)) + '</small>' +
        '<button type="button" data-drop-audio="' + esc(file.name) + '">删除</button></div>'
      ).join('') + '</div>' : '') : '') +
      '</div>';
  }

  function overview(books) {
    const chapterBytes = books.reduce((sum, book) => sum + stats(book).bytes, 0);
    const audioBytes = audioCache.files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
    const quota = storageCache
      ? '本机已用 ' + size(storageCache.usage) + ' / 可用 ' + size(storageCache.quota)
      : '本机用量暂时读不到';
    return '<p class="form-hint">' + quota + ' · 章节正文 ' + size(chapterBytes) + ' · 听书音频 ' + size(audioBytes) + '</p>' +
      (audioCache.supported ? '' : '<p class="form-hint">音频清单位于 iOS App 内，网页版看不到；章节缓存管理不受影响。</p>') +
      '<div class="offline-toolbar"><button type="button" id="offlineDropAllAudio">清空全部听书音频</button>' +
      '<span id="offlineHint">' + books.length + ' 本书</span></div>';
  }

  function render() {
    const books = shelf();
    const markup = overview(books) + (books.length
      ? books.map(bookRow).join('')
      : '<p class="form-hint">书架还是空的。</p>');
    if (!panel('离线资源', markup)) return;

    document.querySelectorAll('#readerExtraBody [data-offline-download]').forEach((button) => {
      button.addEventListener('click', () => {
        const book = books.find((row) => String(row.id) === button.dataset.offlineDownload);
        if (!book) return;
        if (!book.chapters?.length) { say('这本书没有章节目录，无法整本缓存'); return; }
        say('已加入后台缓存队列，可继续阅读');
        window.ShuyinOfflineDownload?.start(book);
        setTimeout(render, 1200);
      });
    });
    document.querySelectorAll('#readerExtraBody [data-offline-open]').forEach((button) => {
      button.addEventListener('click', () => {
        viewBookId = String(viewBookId) === button.dataset.offlineOpen ? null : button.dataset.offlineOpen;
        render();
      });
    });
    document.querySelectorAll('#readerExtraBody [data-offline-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        const book = books.find((row) => String(row.id) === button.dataset.offlineClear);
        if (book) dropBookChapters(book);
      });
    });
    document.querySelectorAll('#readerExtraBody [data-drop-chapter]').forEach((button) => {
      button.addEventListener('click', () => {
        const book = books.find((row) => String(row.id) === String(viewBookId));
        if (book) dropChapter(book, button.dataset.dropChapter);
      });
    });
    document.querySelectorAll('#readerExtraBody [data-drop-audio]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ok = await deleteAudioFile(button.dataset.dropAudio);
        if (ok) { say('已删除音频'); await refreshAudio(); }
      });
    });
    const allAudio = $('offlineDropAllAudio');
    if (allAudio) allAudio.onclick = async () => {
      if (!audioCache.files.length) { say('没有可删除的音频'); return; }
      if (!window.confirm('删除全部 ' + audioCache.files.length + ' 个听书音频？章节正文不受影响。')) return;
      for (const file of audioCache.files.slice()) await deleteAudioFile(file.name);
      await refreshAudio();
    };
  }

  async function refreshAudio() {
    audioCache = await audioFiles();
    render();
  }

  async function show() {
    panel('离线资源', '<p class="form-hint">正在统计本机缓存…</p>');
    try {
      storageCache = await navigator.storage?.estimate?.() || null;
    } catch { storageCache = null; }
    audioCache = await audioFiles();
    render();
  }

  // 挂一个入口按钮，跟「全库检索 / 笔记汇总」并排
  const anchor = $('readerNotes');
  if (anchor?.parentNode) {
    const button = document.createElement('button');
    button.id = 'readerOfflineManager';
    button.type = 'button';
    button.className = 'reader-tool-button';
    button.textContent = '离线资源';
    anchor.parentNode.insertBefore(button, anchor.nextSibling);
    button.addEventListener('click', show);
  }

  window.ShuyinOfflineManager = { show, stats, cachedRows, dropChapter, dropBookChapters, refreshAudio };
})();
