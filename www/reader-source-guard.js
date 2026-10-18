/* 书隐 r86 · 书源健康度与自动拉黑
   做三件事：
   1) 把已经在 `shuyin.source-quality.v1` 里悄悄积累的成功次数/排版分显示出来；
   2) 自动拉黑 —— 同一域名 7 天内失败 4 次且涉及 ≥2 个不同地址，就进黑名单，
      搜索时直接不出现（direct-web.js 里的 isBlocked 负责过滤），7 天后自动放出来重试；
   3) 手动拉黑 / 解除。用户永远能推翻自动判断。
   判定与存储都在 direct-web.js，这里只读它导出的接口，不另建数据结构。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = () => window.ShuyinDirectWeb || null;
  const say = (message) => { try { if (typeof toast === 'function') toast(String(message).slice(0, 110)); } catch {} };

  function when(at) {
    const value = Number(at || 0);
    if (!value) return '';
    const days = Math.ceil((value - Date.now()) / 864e5);
    return days > 0 ? days + ' 天后自动放行' : new Date(value).toLocaleDateString();
  }

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

  function rows() {
    const hub = api();
    if (!hub?.sourceRows) return [];
    try { return hub.sourceRows(); } catch { return []; }
  }

  function rowMarkup(row) {
    const badge = row.blocked
      ? '<span class="source-badge is-blocked">已拉黑</span>'
      : row.fails >= 2
        ? '<span class="source-badge is-warn">' + row.fails + ' 次失败</span>'
        : '<span class="source-badge">正常</span>';
    return '<div class="source-row">' +
      '<div class="source-row-main"><strong>' + esc(row.domain) + '</strong>' + badge + '</div>' +
      '<div class="source-row-meta">成功 ' + row.success + ' 次' +
      (row.fails ? ' · 失败 ' + row.fails + ' 次' : '') +
      (row.layout ? ' · 排版分 ' + row.layout : '') +
      (row.blocked && row.until ? ' · ' + esc(when(row.until)) : '') +
      (row.blocked ? ' · 可用于解除' : '') + '</div>' +
      (row.reason ? '<div class="source-row-reason">最近原因：' + esc(row.reason) + '</div>' : '') +
      '<div class="source-row-actions">' +
      (row.blocked
        ? '<button type="button" data-unblock="' + esc(row.domain) + '">解除拉黑</button>'
        : '<button type="button" class="offline-danger" data-block="' + esc(row.domain) + '">手动拉黑</button>') +
      '</div></div>';
  }

  function render() {
    const list = rows();
    const blocked = list.filter((row) => row.blocked);
    const tried = list.filter((row) => !row.blocked && row.fails > 0);
    const markup = '<p class="form-hint">' +
      (blocked.length ? '已拉黑 <b>' + blocked.length + '</b> 个站点，搜索结果里不会再出现。' : '当前没有拉黑的站点。') +
      (tried.length ? '另有 ' + tried.length + ' 个站点出现过失败但还没到阈值。' : '') +
      '</p>' +
      '<p class="form-hint">自动拉黑规则：同一域名 7 天内失败 4 次、且涉及至少 2 个不同地址；' +
      '拉黑 7 天后自动放出来重试一次。你也可以随时手动拉黑或解除。</p>' +
      '<div class="offline-toolbar"><input id="sourceManual" placeholder="手动输入域名，例如 www.example.com">' +
      '<button type="button" id="sourceManualAdd">加入黑名单</button>' +
      (list.length ? '<button type="button" id="sourceClearAll">清空全部记录</button>' : '') +
      '</div>' +
      (list.length ? list.map(rowMarkup).join('') : '<p class="form-hint">还没有书源记录。读几章之后这里就会有数据。</p>');
    if (!panel('书源', markup)) return;
    bind();
  }

  function bind() {
    const hub = api();
    document.querySelectorAll('#readerExtraBody [data-unblock]').forEach((button) => {
      button.addEventListener('click', () => {
        hub?.unblockDomain?.(button.dataset.unblock);
        say('已解除 ' + button.dataset.unblock);
        render();
      });
    });
    document.querySelectorAll('#readerExtraBody [data-block]').forEach((button) => {
      button.addEventListener('click', () => {
        hub?.setBlocked?.(button.dataset.block, true);
        say('已拉黑 ' + button.dataset.block);
        render();
      });
    });
    const add = $('sourceManualAdd');
    if (add) add.onclick = () => {
      const input = $('sourceManual');
      const domain = String(input?.value || '').trim().replace(/^https?:\/\//i, '').split('/')[0];
      if (!domain.includes('.')) { say('请输入域名，例如 example.com'); return; }
      hub?.setBlocked?.(domain, true);
      say('已拉黑 ' + domain);
      render();
    };
    const clear = $('sourceClearAll');
    if (clear) clear.onclick = () => {
      if (!window.confirm('清空全部书源健康度与黑名单记录？这不会影响书架和已缓存的章节。')) return;
      try { localStorage.removeItem('shuyin.source-quality.v1'); } catch {}
      try { localStorage.removeItem('shuyin.source-blacklist.v1'); } catch {}
      say('已清空书源记录');
      render();
    };
  }

  const anchor = $('readerNotes');
  if (anchor?.parentNode) {
    const button = document.createElement('button');
    button.id = 'readerSourceGuard';
    button.type = 'button';
    button.className = 'reader-tool-button';
    button.textContent = '书源';
    anchor.parentNode.insertBefore(button, anchor);
    button.addEventListener('click', render);
  }

  window.ShuyinSourceGuard = { render, rows };
})();
