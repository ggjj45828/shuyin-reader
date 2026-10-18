/* 书隐 r85 · 章节加载失败保护
   目标：任何一次章节读取失败都不清空当前正文，也不让阅读器卡死在「正在加载」。
   做法：
   1) 失败时保留屏幕上的正文（app.js 原本就不改 content，这里只补界面和状态复位）；
   2) 在阅读区底部挂一条常驻重试条 —— 重试这一章 / 换源修复 / 知道了；
   3) 把 autoLoadReady 复位，滚到底部的自动加载还能再次触发（原来失败后就再也不触发）。
   不引入新数据键，不改 cachedChapters 结构。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lastIndex = null;

  function say(message) {
    try { if (typeof toast === 'function') toast(String(message).slice(0, 110)); } catch {}
  }

  function shell() {
    return $('chapterRetryBar');
  }

  function ensureBar() {
    let node = shell();
    if (node) return node;
    const host = $('reader');
    if (!host) return null;
    node = document.createElement('div');
    node.id = 'chapterRetryBar';
    node.className = 'chapter-retry-bar hidden';
    node.setAttribute('role', 'status');
    host.appendChild(node);
    return node;
  }

  // 把技术性报错翻成能照着做的建议，避免用户只看到「Failed to fetch」
  function advise(message) {
    const text = String(message || '');
    if (/超时|timeout|连接超时/i.test(text)) return '网络像是断了一下，等几秒再点重试通常就能读到。';
    if (/HTTP 5\d\d/.test(text)) return '对方站点自己出错了，可以点换源修复找同编号章节。';
    if (/HTTP 404|不存在|not found|410/i.test(text)) return '这一章的地址已经失效，换源能找到同一章的另一份。';
    if (/登录|验证码|人机|拦截|javascript|访问受限/i.test(text)) return '对方站点要求登录或人机验证，手机直连读不到，建议换源。';
    if (/网络|network|Failed to fetch/i.test(text)) return '手机当前可能没有网络，已缓存的章节仍然能看。';
    return '屏幕上的正文已经保留，不会变成空白页。';
  }

  function renderRetry(index, reason) {
    const node = ensureBar();
    if (!node) return;
    node.dataset.index = index == null ? '' : String(index);
    node.innerHTML = '<div class="chapter-retry-text"><strong>第 ' + (index == null ? '?' : index + 1) + ' 章没读下来</strong>' +
      '<span>' + esc(reason) + '</span><small>' + esc(advise(reason)) + '</small></div>' +
      '<div class="chapter-retry-actions"><button type="button" id="chapterRetryGo">重试这一章</button>' +
      '<button type="button" id="chapterRetryRepair">换源修复</button>' +
      '<button type="button" id="chapterRetryHide">知道了</button></div>';
    node.classList.remove('hidden');
    $('chapterRetryGo').onclick = () => { node.classList.add('hidden'); retry(); };
    $('chapterRetryRepair').onclick = () => { node.classList.add('hidden'); $('readerRepairChapter')?.click(); };
    $('chapterRetryHide').onclick = () => node.classList.add('hidden');
  }

  // 失败后必须把自动加载开关拨回来，否则滚到底再也不会尝试下一章
  function rearm() {
    try { autoLoadReady = true; } catch {}
  }

  function fail(index, error) {
    const value = Number(index);
    lastIndex = Number.isFinite(value) && value >= 0 ? value : null;
    rearm();
    renderRetry(lastIndex, String(error?.message || error || '未知错误'));
  }

  function ok() {
    lastIndex = null;
    const node = shell();
    if (node) node.classList.add('hidden');
  }

  function retry() {
    const runner = window.loadRemoteChapter || (typeof loadRemoteChapter === 'function' ? loadRemoteChapter : null);
    if (!runner) { say('阅读器还没准备好，请重新打开这本书'); return; }
    if (lastIndex == null) {
      window.advanceChapter?.();
      return;
    }
    const node = ensureBar();
    if (node) {
      node.innerHTML = '<div class="chapter-retry-text"><strong>正在重试第 ' + (lastIndex + 1) + ' 章…</strong>' +
        '<span>屏幕上的正文先保留，读回来再替换。</span></div>';
      node.classList.remove('hidden');
    }
    rearm();
    Promise.resolve().then(() => runner(lastIndex, false)).catch((error) => {
      fail(lastIndex, error);
    });
  }

  window.ShuyinChapterGuard = { fail, ok, retry, advise, rearm };

  // 阅读器重新打开（换书）时把上一条失败提示收掉，避免串书
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#closeReader')) ok();
  }, true);
})();
