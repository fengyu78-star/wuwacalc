/* 站点公共布局组件：顶部运营公告栏 + 底部法律声明栏
 * 数据源：js/site-content.js 默认配置；存在 /api/site-content 时以后端配置覆盖。 */
(function () {
  'use strict';

  var STYLE_ID = 'site-chrome-style';
  var READ_KEY = 'wavecalc-announcement-read';
  var AUTO_KEY = 'wavecalc-announcement-auto-shown';
  var DISMISS_KEY = 'wavecalc-announcement-dismissed';
  var annBound = false;

  var css = [
    '#announcementBar{position:relative;z-index:80}',
    '.sc-announce{position:relative;min-height:40px;box-sizing:border-box;display:flex;align-items:stretch;',
    'background:color-mix(in srgb,var(--accent-primary,#c9a84c) 8%,transparent);',
    'border-top:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 18%,transparent);',
    'border-bottom:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 18%,transparent);}',
    '.sc-announce-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:0 44px 0 12px;',
    'background:transparent;border:none;cursor:pointer;color:inherit;font-family:inherit;text-align:left;}',
    '.sc-announce-main:hover .sc-announce-title{color:var(--accent-primary,#c9a84c);}',
    '.sc-announce-icon{flex:0 0 auto;font-size:16px;line-height:1;}',
    '.sc-announce-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:rgba(220,60,60,0.9);',
    'box-shadow:0 0 6px rgba(220,60,60,0.6);}',
    '.sc-announce-title{flex:1;min-width:0;font-size:13px;color:var(--text-primary,#e8ecf5);',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s;}',
    '.sc-announce-arrow{flex:0 0 auto;font-size:12px;color:var(--accent-primary,#c9a84c);white-space:nowrap;}',
    '.sc-announce-close{position:absolute;top:8px;right:8px;z-index:2;width:34px;height:24px;border:none;',
    'background:transparent;color:rgba(232,224,208,0.35);font-size:18px;line-height:1;cursor:pointer;padding:0;}',
    '.sc-announce-close:hover{color:var(--text-primary,#e8ecf5);}',
    '.sc-announce-body{display:none;max-height:200px;overflow-y:auto;padding:12px 14px;',
    'border-top:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 14%,transparent);}',
    '.sc-announce.is-open .sc-announce-body{display:block;}',
    '.sc-announce.is-open{position:absolute;left:0;right:0;top:0;background:var(--bg-deepest,#0d0f13);',
    'border:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 26%,transparent);',
    'border-radius:0 0 10px 10px;box-shadow:0 14px 34px rgba(0,0,0,0.4);z-index:90;flex-direction:column;}',
    '.sc-announce.is-open .sc-announce-main{min-height:40px;flex:0 0 auto;}',
    '.sc-announce-text{margin:0;font-size:14px;line-height:1.7;color:var(--text-secondary,#f0e8d8);white-space:pre-wrap;}',
    '.sc-announce-time{display:block;margin-top:8px;font-size:11px;color:var(--text-muted,#8b94a8);}',
    '.sc-announce-history{margin-top:12px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.08);}',
    '.sc-announce-history-title{font-size:12px;color:var(--text-muted,#8b94a8);margin-bottom:6px;}',
    '.sc-announce-item{display:block;width:100%;background:transparent;border:none;text-align:left;',
    'font-family:inherit;font-size:12px;color:var(--text-secondary,#aab3c5);padding:6px 2px;cursor:pointer;}',
    '.sc-announce-item:hover{color:var(--accent-primary,#c9a84c);}',
    '.sc-announce-item-body{padding:2px 2px 8px;font-size:12px;line-height:1.7;color:var(--text-muted,#8b94a8);white-space:pre-wrap;}',
    '#siteFooter{width:100%;box-sizing:border-box;background:var(--bg-surface,var(--surface,#161618));',
    'border-top:1px solid rgba(255,255,255,0.04);padding:16px 24px;margin-top:8px;}',
    '.sc-footer-line{margin:0;font-size:11px;line-height:1.8;color:var(--text-muted,#8b94a8);text-align:left;}',
    '.sc-footer-links{margin:4px 0 0;font-size:0;}',
    '.sc-footer-links a{font-size:11px;color:color-mix(in srgb,var(--accent-primary,#c9a84c) 62%,transparent);',
    'text-decoration:none;margin:0 6px;transition:color .2s;}',
    '.sc-footer-links a:first-child{margin-left:0;}',
    '.sc-footer-links a:hover{color:var(--accent-primary,#c9a84c);}',
    '.sc-footer-links .sc-footer-sep{display:inline-block;font-size:11px;color:var(--text-muted,#8b94a8);margin:0 4px;}',
    '@media (max-width:640px){.sc-footer-line,.sc-footer-links a,.sc-footer-links .sc-footer-sep{text-align:center;}',
    '.sc-footer{text-align:center;}.sc-footer-links a{margin:0 4px;}}',
  ].join('');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readList() {
    try {
      var raw = localStorage.getItem(READ_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function markRead(id) {
    try {
      var arr = readList();
      if (arr.indexOf(id) < 0) arr.push(id);
      localStorage.setItem(READ_KEY, JSON.stringify(arr));
    } catch (e) {
      /* ignore */
    }
  }

  function getData() {
    var def = (typeof window.SITE_CONTENT !== 'undefined' && window.SITE_CONTENT) || {};
    return {
      announcements: Array.isArray(def.announcements) ? def.announcements : [],
      footer: def.footer || {},
    };
  }

  function mergeFromServer(remote) {
    if (!remote || typeof remote !== 'object') return;
    var base = getData();
    if (Array.isArray(remote.site_announcements)) {
      base.announcements = remote.site_announcements;
    }
    if (remote.site_footer && typeof remote.site_footer === 'object') {
      base.footer = remote.site_footer;
    }
    window.SITE_CONTENT = base;
  }

  function renderAnnouncement() {
    var host = document.getElementById('announcementBar');
    if (!host) return;
    var prevWrap = host.querySelector('.sc-announce');
    var prevOpen = !!(prevWrap && prevWrap.classList.contains('is-open'));
    var data = getData();
    var list = data.announcements || [];
    if (!list.length) {
      host.hidden = true;
      return;
    }
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') {
        host.hidden = true;
        return;
      }
    } catch (e) {
      /* ignore */
    }
    var latest = list[0];
    var autoOpen = false;
    try {
      if (sessionStorage.getItem(AUTO_KEY) !== '1') {
        autoOpen = true;
        sessionStorage.setItem(AUTO_KEY, '1');
      }
    } catch (e) {
      autoOpen = true;
    }
    if (prevOpen) autoOpen = true;
    var unread = readList().indexOf(String(latest.id || latest.title)) < 0;
    if (autoOpen && unread) {
      markRead(String(latest.id || latest.title));
      unread = false;
    }

    var history = list.slice(1);
    var bodyHtml =
      '<div class="sc-announce-body">' +
      '<p class="sc-announce-text">' + esc(latest.content || '') + '</p>' +
      (latest.time ? '<span class="sc-announce-time">发布时间：' + esc(latest.time) + '</span>' : '') +
      (history.length
        ? '<div class="sc-announce-history"><div class="sc-announce-history-title">历史公告</div>' +
          history
            .map(function (a) {
              return (
                '<button type="button" class="sc-announce-item" data-sc-announce-hist="' + esc(String(a.id || a.title)) + '">' +
                esc(a.title || '') +
                '</button>' +
                '<div class="sc-announce-item-body" hidden>' +
                esc(a.content || '') +
                (a.time ? '<span class="sc-announce-time">发布时间：' + esc(a.time) + '</span>' : '') +
                '</div>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '</div>';

    host.hidden = false;
    host.innerHTML =
      '<div class="sc-announce' + (autoOpen ? ' is-open' : '') + '">' +
      '<button type="button" class="sc-announce-main" data-sc-announce-toggle>' +
      '<span class="sc-announce-icon">📢</span>' +
      (unread ? '<span class="sc-announce-dot" aria-label="有新公告"></span>' : '') +
      '<span class="sc-announce-title">' + esc(latest.title || '') + '</span>' +
      '<span class="sc-announce-arrow">' + (autoOpen ? '收起公告 ▴' : '展开公告 ▾') + '</span>' +
      '</button>' +
      bodyHtml +
      '<button type="button" class="sc-announce-close" data-sc-announce-close aria-label="关闭公告栏">×</button>' +
      '</div>';

    if (!annBound) {
      annBound = true;
      host.addEventListener('click', function (e) {
        var toggle = e.target.closest('[data-sc-announce-toggle]');
        if (toggle) {
          var wrap = host.querySelector('.sc-announce');
          var isOpen = wrap.classList.contains('is-open');
          wrap.classList.toggle('is-open', !isOpen);
          var arrow = wrap.querySelector('.sc-announce-arrow');
          if (arrow) arrow.textContent = !isOpen ? '收起公告 ▴' : '展开公告 ▾';
          if (!isOpen) {
            var cur = getData();
            var curLatest = (cur.announcements || [])[0];
            markRead(String(curLatest && (curLatest.id || curLatest.title)));
            var dot = wrap.querySelector('.sc-announce-dot');
            if (dot) dot.remove();
          }
          return;
        }
        var hist = e.target.closest('[data-sc-announce-hist]');
        if (hist) {
          var body = hist.nextElementSibling;
          if (body) body.hidden = !body.hidden;
          return;
        }
        if (e.target.closest('[data-sc-announce-close]')) {
          try {
            sessionStorage.setItem(DISMISS_KEY, '1');
          } catch (err) {
            /* ignore */
          }
          host.hidden = true;
        }
      });
    }
  }

  function renderFooter() {
    var host = document.getElementById('siteFooter');
    if (!host) return;
    var data = getData();
    var f = data.footer || {};
    var links = Array.isArray(f.links) ? f.links : [];
    var statements = Array.isArray(f.statements) ? f.statements : [];
    host.hidden = false;
    var html = '';
    html += '<p class="sc-footer-line">' + esc(f.brand || '') + (f.copyright ? ' · ' + esc(f.copyright) : '') + '</p>';
    statements.forEach(function (s) {
      html += '<p class="sc-footer-line">' + esc(s) + '</p>';
    });
    if (links.length) {
      html += '<p class="sc-footer-links">';
      links.forEach(function (l, i) {
        if (i > 0) html += '<span class="sc-footer-sep">·</span>';
        var href = String(l.href || '#');
        var target = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        html += '<a href="' + esc(href) + '"' + target + '>' + esc(l.label || href) + '</a>';
      });
      html += '</p>';
    }
    host.innerHTML = html;
  }

  function boot() {
    injectStyle();
    // 关闭标记仅作用于当前页面实例：刷新后清除，保证「刷新后重新显示」的预期
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch (e) {
      /* ignore */
    }
    renderAnnouncement();
    renderFooter();
    if (typeof fetch === 'function') {
      fetch('api/site-content')
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          mergeFromServer(data);
          renderAnnouncement();
          renderFooter();
        })
        .catch(function () {
          /* 后端不可用时保留默认配置 */
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
