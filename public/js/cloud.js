/* 云端方案库（阶段3）— 登录 / 公开库 / 上传 / 我的方案 / 管理审核 */
(function () {
  'use strict';

  var SUPABASE_URL = ''; // 本地源码版不连接正式账号服务
  var SUPABASE_ANON_KEY = ''; // 如自行接入，使用自己的服务配置
  var SESSION_KEY = 'wuwacalc_cloud_session_v1';
  var USER_DOMAIN = 'source.local';

  // 账号可以是用户名或邮箱：用户名转成内部邮箱标识（u+hex@wuwacalc.cn），老邮箱账号原样登录
  function accountToEmail(account) {
    var s = String(account || '').trim();
    if (!s) return '';
    if (s.indexOf('@') >= 0) return s;
    var utf8 = unescape(encodeURIComponent(s));
    var hex = '';
    for (var i = 0; i < utf8.length; i++) {
      var h = utf8.charCodeAt(i).toString(16);
      hex += h.length < 2 ? '0' + h : h;
    }
    return 'u' + hex + '@' + USER_DOMAIN;
  }

  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function getToken() { var s = loadSession(); return (s && s.access_token) || null; }
  function getUser() { var s = loadSession(); return (s && s.user) || null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { var v = Number(n); if (!Number.isFinite(v)) return '-'; return v >= 10000 ? (v / 10000).toFixed(2) + '万' : Math.round(v).toLocaleString(); }
  function fmtDate(s) { if (!s) return ''; try { return new Date(s).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(s); } }

  async function sbAuth(path, body, token, method) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('本地源码版未配置账号服务，请使用游客访问。');
    var res = await fetch(SUPABASE_URL + path, {
      method: method || 'POST',
      headers: Object.assign(
        { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      body: JSON.stringify(body),
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || ('请求失败 ' + res.status));
    return data;
  }

  async function signUp(account, password) {
    var email = accountToEmail(account);
    var data = await sbAuth('/auth/v1/signup', { email: email, password: password });
    if (data.access_token && data.user) {
      saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      if (window.__notifyRefresh) window.__notifyRefresh();
    }
    return data;
  }
  async function signIn(account, password) {
    var email = accountToEmail(account);
    var data = await sbAuth('/auth/v1/token?grant_type=password', { email: email, password: password });
    saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    if (window.__notifyRefresh) window.__notifyRefresh();
    return data.user;
  }
  async function refreshSession() {
    var s = loadSession();
    if (!s || !s.refresh_token) return null;
    try {
      var data = await sbAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      if (window.__notifyRefresh) window.__notifyRefresh();
      return data;
    } catch (e) { clearSession(); return null; }
  }
  async function signOut() {
    var token = getToken();
    if (token) { try { await sbAuth('/auth/v1/logout', {}, token); } catch (e) {} }
    clearSession();
    if (window.__notifyRefresh) window.__notifyRefresh();
  }

  async function changePassword(newPass) {
    var token = getToken();
    if (!token) throw new Error('请先登录');
    return sbAuth('/auth/v1/user', { password: newPass }, token, 'PUT');
  }

  async function api(path, opts) {
    opts = opts || {};
    var token = getToken();
    if (opts.auth && !token) {
      var refreshed = await refreshSession();
      if (!refreshed) throw new Error('请先登录');
      token = getToken();
    }
    var attempt = async function (tk) {
      return fetch('/api' + path, {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          tk ? { Authorization: 'Bearer ' + tk } : {}
        ),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    };
    var res = await attempt(token);
    // access_token 过期（401）：自动用 refresh_token 续期并重试一次
    if (res.status === 401 && opts.auth) {
      var refreshed = await refreshSession();
      if (refreshed) {
        res = await attempt(getToken());
      } else {
        clearSession();
        throw new Error('登录已失效，请重新登录');
      }
    }
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
    return data;
  }

  async function fetchMyRole() {
    var token = getToken();
    var user = getUser();
    if (!token || !user) return null;
    try {
      var res = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id), {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return null;
      var rows = await res.json();
      return (rows && rows[0] && rows[0].role) || null;
    } catch (e) { return null; }
  }

  var overlayEl = null;
  var cloudOpenOrigin = '';
  var cloudOpenFocus = '';
  var currentTab = 'auth';
  var detailCache = {};
  var stateInfo = { status: '', user: null, role: null };

  function setStatus(msg, isError) {
    stateInfo.status = msg;
    var el = overlayEl && overlayEl.querySelector('[data-cloud-status]');
    if (el) {
      el.textContent = msg || '';
      el.classList.toggle('is-error', !!isError);
    }
  }

  function syncDialogChrome(isAdmin) {
    if (!overlayEl) return;
    var tabs = overlayEl.querySelector('[data-cloud-tabs]');
    var title = overlayEl.querySelector('[data-cloud-title]');
    var dialog = overlayEl.querySelector('[data-cloud-dialog]');
    var isAuthView = currentTab === 'auth';
    if (tabs) tabs.hidden = !isAdmin;
    if (dialog) dialog.classList.toggle('is-compact', isAuthView);
    if (title) {
      if (isAuthView) title.textContent = '修改密码';
      else if (currentTab === 'admin') title.textContent = '管理审核';
      else title.textContent = '云端方案库';
    }
    overlayEl.querySelectorAll('[data-cloud-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.cloudTab === currentTab);
    });
  }

  function openCloud(tab, opts) {
    cloudOpenOrigin = (opts && opts.origin) || '';
    cloudOpenFocus = (opts && opts.focus) || '';
    if (tab) currentTab = tab;
    // 未登录时走独立鸣潮风登录页（不跟主题、不塞进云端弹窗）
    if (currentTab === 'auth' && !getUser() && window.WaveCalcAuth && typeof WaveCalcAuth.open === 'function') {
      WaveCalcAuth.open({ origin: cloudOpenOrigin });
      return;
    }
    if (overlayEl) {
      overlayEl.style.display = 'flex';
      void renderTab(currentTab);
      return;
    }
    overlayEl = document.createElement('div');
    overlayEl.className = 'cloud-overlay';
    overlayEl.setAttribute('data-cloud-overlay', '');
    overlayEl.innerHTML =
      '<div class="cloud-dialog is-compact" data-cloud-dialog role="dialog" aria-modal="true" aria-labelledby="cloudDialogTitle">' +
      '<header class="cloud-dialog-head">' +
      '<strong class="cloud-dialog-title" id="cloudDialogTitle" data-cloud-title>修改密码</strong>' +
      '<nav class="cloud-dialog-tabs" data-cloud-tabs hidden>' +
      '<button type="button" class="cloud-tab" data-cloud-tab="library">公开方案库</button>' +
      '<button type="button" class="cloud-tab" data-cloud-tab="auth">账号</button>' +
      '<button type="button" class="cloud-tab" data-cloud-tab="admin">管理审核</button>' +
      '</nav>' +
      '<button type="button" class="cloud-dialog-close" data-cloud-close title="关闭" aria-label="关闭">✕</button>' +
      '</header>' +
      '<p class="cloud-status" data-cloud-status></p>' +
      '<div class="cloud-dialog-body" data-cloud-body></div>' +
      '</div>';
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) { closeCloud(); return; }
      var close = e.target.closest('[data-cloud-close]');
      if (close) { closeCloud(); return; }
      var tabBtn = e.target.closest('[data-cloud-tab]');
      if (tabBtn) {
        currentTab = tabBtn.dataset.cloudTab;
        if (currentTab === 'auth' && !getUser() && window.WaveCalcAuth && typeof WaveCalcAuth.open === 'function') {
          WaveCalcAuth.open({ origin: 'cloud' });
          return;
        }
        void renderTab(currentTab);
        return;
      }
      var importBtn = e.target.closest('[data-cloud-import]');
      if (importBtn) { void importFromCode(importBtn.dataset.cloudImport); return; }
      var copyBtn = e.target.closest('[data-cloud-copy]');
      if (copyBtn) { copyText(copyBtn.dataset.cloudCopy); return; }
      var uploadBtn = e.target.closest('[data-cloud-upload]');
      if (uploadBtn) { void doUpload(uploadBtn); return; }
      var updateBtn = e.target.closest('[data-cloud-update]');
      if (updateBtn) { void doUpdate(updateBtn.dataset.cloudUpdate); return; }
      var approveBtn = e.target.closest('[data-cloud-approve]');
      if (approveBtn) { void doApprove(approveBtn.dataset.cloudApprove); return; }
      var rejectBtn = e.target.closest('[data-cloud-reject]');
      if (rejectBtn) { void doReject(rejectBtn.dataset.cloudReject); return; }
      var loginBtn = e.target.closest('[data-cloud-login]');
      if (loginBtn) { void doLogin(); return; }
      var signupBtn = e.target.closest('[data-cloud-signup]');
      if (signupBtn) { void doSignup(); return; }
      var logoutBtn = e.target.closest('[data-cloud-logout]');
      if (logoutBtn) { void doLogout(); return; }
      var changePassBtn = e.target.closest('[data-cloud-changepass]');
      if (changePassBtn) {
        var passForm = overlayEl.querySelector('[data-cloud-passchange]');
        if (passForm) passForm.hidden = !passForm.hidden;
        return;
      }
      var changePassConfirm = e.target.closest('[data-cloud-changepass-confirm]');
      if (changePassConfirm) { void doChangePassword(); return; }
      var searchBtn = e.target.closest('[data-cloud-search]');
      if (searchBtn) { void renderLibrary(); return; }
      var refreshBtn = e.target.closest('[data-cloud-refresh]');
      if (refreshBtn) { void renderTab(currentTab); return; }
      var backBtn = e.target.closest('[data-cloud-back]');
      if (backBtn) { detailCache = {}; void renderLibrary(); return; }
    });
    overlayEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCloud(); });
    void renderTab(currentTab || 'auth');
  }
  function closeCloud() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    cloudOpenFocus = '';
  }
  function tabStyle(tab) {
    // 保留兼容；实际样式由 .cloud-tab.is-active 控制
    return '';
  }

  async function renderTab(tab) {
    currentTab = tab || 'auth';
    if (!overlayEl) return;
    var body = overlayEl.querySelector('[data-cloud-body]');
    if (!body) return;
    stateInfo.user = getUser();
    stateInfo.role = await fetchMyRole();
    var adminVisible = stateInfo.role === 'admin';
    // 普通用户不得进入公开方案库 / 管理审核（后续另做管理页）
    if (!adminVisible && (currentTab === 'library' || currentTab === 'admin')) {
      currentTab = 'auth';
    }
    syncDialogChrome(adminVisible);
    if (currentTab === 'library') { void renderLibrary(); return; }
    if (currentTab === 'admin') {
      if (!adminVisible) {
        setStatus('仅管理员可查看', true);
        void renderAuth();
        return;
      }
      void renderAdmin();
      return;
    }
    void renderAuth();
  }

  function renderLibrary() {
    var body = overlayEl.querySelector('[data-cloud-body]');
    setStatus('加载中…');
    body.innerHTML =
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<input data-cloud-q type="text" placeholder="搜索标题或分享码" value="' + esc(currentQuery || '') + '" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #384055;background:#141824;color:#e8ecf5" />' +
      '<button type="button" data-cloud-search class="btn sm primary" style="padding:8px 16px;border-radius:8px;border:none;background:#2f6feb;color:#fff;cursor:pointer">搜索</button>' +
      '<button type="button" data-cloud-refresh style="padding:8px 14px;border-radius:8px;border:1px solid #384055;background:#1d2230;color:#cfd6e6;cursor:pointer">刷新</button>' +
      '</div><div data-cloud-list></div>';
    void loadLibrary('');
  }
  async function loadLibrary(q) {
    var listEl = overlayEl.querySelector('[data-cloud-list]');
    try {
      var data = await api('/schemes?limit=50' + (q ? '&q=' + encodeURIComponent(q) : ''));
      var items = data.items || [];
      currentQuery = q;
      if (!items.length) {
        listEl.innerHTML = '<p style="color:#8b94a8;text-align:center;padding:40px 0">还没有公开方案，快来发布第一个吧</p>';
        setStatus('共 0 条');
        return;
      }
      listEl.innerHTML = items.map(function (it) {
        var sum = it.summary || {};
        var author = (it.profiles && it.profiles.display_name) || '匿名';
        return '<div style="border:1px solid #2c3345;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#171b26">' +
          '<div style="display:flex;gap:10px;align-items:center">' +
          '<strong>' + esc(it.title) + '</strong>' +
          '<span style="color:#7c8699;font-size:12px">' + esc(it.share_code) + '</span>' +
          '<span style="flex:1"></span>' +
          '<span style="color:#ffd166;font-size:12px">总伤 ' + fmtNum(sum.teamTotal) + ' · DPS ' + fmtNum(sum.teamDps) + '</span>' +
          '</div>' +
          '<div style="color:#8b94a8;font-size:12px;margin-top:6px">作者 ' + esc(author) + ' · ' + fmtDate(it.updated_at) +
          (it.tags && it.tags.length ? ' · ' + it.tags.map(esc).join(' / ') : '') + '</div>' +
          '<div style="margin-top:8px;display:flex;gap:8px">' +
          '<button type="button" data-cloud-import="' + esc(it.share_code) + '" style="padding:5px 12px;border-radius:7px;border:none;background:#2f6feb;color:#fff;cursor:pointer">导入到工作区</button>' +
          '<button type="button" data-cloud-copy="' + esc(it.share_code) + '" style="padding:5px 12px;border-radius:7px;border:1px solid #384055;background:#1d2230;color:#cfd6e6;cursor:pointer">复制分享码</button>' +
          '</div></div>';
      }).join('');
      setStatus('共 ' + items.length + ' 条公开方案');
    } catch (err) {
      listEl.innerHTML = '<p style="color:#e07b7b">加载失败：' + esc(err.message) + '</p>';
      setStatus(err.message, true);
    }
  }

  async function importFromCode(code) {
    if (typeof window.parseSchemeImport !== 'function' || typeof window.importWorkspaceFromData !== 'function') {
      setStatus('导入函数未就绪', true);
      return;
    }
    try {
      setStatus('下载方案中…');
      var detail = await api('/schemes/' + encodeURIComponent(code));
      var payload = detail.payload;
      if (!payload) throw new Error('方案无数据');
      var parsed = parseSchemeImport(payload);
      if (parsed.type !== 'scheme') throw new Error('该方案不是完整工作区格式');
      await importWorkspaceFromData(parsed.data, parsed.meta || { name: detail.title });
      // 导入自己的方案：记住来源分享码，重新上传走「覆盖更新」；导入他人方案则清空，避免误覆盖
      var importedShareCode = '';
      try {
        var me = typeof getUser === 'function' ? getUser() : null;
        var authorId = detail && detail.profiles && detail.profiles.id;
        if (me && authorId && String(authorId) === String(me.id)) importedShareCode = String(code || '');
      } catch (e) { /* 忽略 */ }
      if (importedShareCode && /^MC-[A-Z0-9]{6}$/i.test(importedShareCode)) {
        if (!state.exportCardDraft) state.exportCardDraft = {};
        state.exportCardDraft.shareCode = importedShareCode;
        if (typeof scheduleSave === 'function') scheduleSave();
      } else if (state.exportCardDraft) {
        state.exportCardDraft.shareCode = '（网页上线后生成）';
      }
      setStatus('已导入「' + detail.title + '」到工作区');
      closeCloud();
    } catch (err) {
      setStatus('导入失败：' + err.message, true);
    }
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { setStatus('已复制 ' + text); }, function () { setStatus('复制失败', true); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        setStatus('已复制 ' + text);
      }
    } catch (e) { setStatus('复制失败', true); }
  }

  function renderAuth() {
    var body = overlayEl.querySelector('[data-cloud-body]');
    var user = stateInfo.user;
    if (!user) {
      if (window.WaveCalcAuth && typeof WaveCalcAuth.open === 'function') {
        body.innerHTML = '<p class="cloud-muted" style="text-align:center;padding:28px 0">正在打开登录页…</p>';
        WaveCalcAuth.open({ origin: cloudOpenOrigin || 'cloud' });
        return;
      }
      body.innerHTML = '<p class="cloud-error" style="text-align:center;padding:28px 0">登录模块未加载</p>';
      return;
    }
    var isAdmin = stateInfo.role === 'admin';
    var initial = esc(String(user.email || '用').trim().slice(0, 1).toUpperCase() || '用');
    setStatus('');
    body.innerHTML =
      '<div class="cloud-auth">' +
      '<div class="cloud-auth-user">' +
      '<div class="cloud-auth-avatar" aria-hidden="true">' + initial + '</div>' +
      '<div class="cloud-auth-meta">' +
      '<div class="cloud-auth-email">' + esc(user.email) + '</div>' +
      '<span class="cloud-auth-role' + (isAdmin ? ' is-admin' : '') + '">' + (isAdmin ? '管理员' : '普通用户') + '</span>' +
      '</div>' +
      '</div>' +
      '<form class="cloud-auth-form" data-cloud-passchange onsubmit="return false">' +
      '<label class="cloud-field">' +
      '<span>新密码</span>' +
      '<input data-cloud-newpass type="password" autocomplete="new-password" placeholder="至少 6 位" />' +
      '</label>' +
      '<label class="cloud-field">' +
      '<span>确认新密码</span>' +
      '<input data-cloud-newpass2 type="password" autocomplete="new-password" placeholder="再次输入新密码" />' +
      '</label>' +
      '<button type="button" class="cloud-btn cloud-btn-primary" data-cloud-changepass-confirm>确认修改密码</button>' +
      '</form>' +
      '<button type="button" class="cloud-btn cloud-btn-danger" data-cloud-logout>退出登录</button>' +
      '<p class="cloud-auth-hint">上传 / 更新公开方案请到「数据导出」页操作。</p>' +
      '</div>';
    cloudOpenFocus = '';
  }

  async function loadMySchemes() {
    var el = overlayEl.querySelector('[data-cloud-mine]');
    if (!el) return;
    try {
      var data = await api('/my/schemes', { auth: true });
      var items = data.items || [];
      if (!items.length) { el.innerHTML = '<p style="color:#8b94a8">还没有上传过方案</p>'; return; }
      var statusMap = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
      el.innerHTML = items.map(function (it) {
        return '<div style="border:1px solid #2c3345;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#171b26">' +
          '<div style="display:flex;align-items:center;gap:10px"><strong>' + esc(it.title) + '</strong>' +
          '<span style="font-size:12px;color:#7c8699">' + esc(it.share_code) + '</span>' +
          '<span style="font-size:12px;color:' + (it.status === 'approved' ? '#58d68d' : it.status === 'rejected' ? '#e07b7b' : '#ffd166') + '">' + (statusMap[it.status] || it.status) + '</span>' +
          '<span style="flex:1"></span>' +
          '<button type="button" data-cloud-copy="' + esc(it.share_code) + '" style="padding:4px 10px;border-radius:7px;border:1px solid #384055;background:#1d2230;color:#cfd6e6;cursor:pointer">复制分享码</button>' +
          '</div>' +
          (it.reject_reason ? '<div style="color:#e07b7b;font-size:12px;margin-top:4px">驳回原因：' + esc(it.reject_reason) + '</div>' : '') +
          '</div>';
      }).join('');
    } catch (err) {
      if (el) el.innerHTML = '<p style="color:#e07b7b">' + esc(err.message) + '</p>';
    }
  }

  function collectUploadFields(override) {
    override = override || {};
    var titleEl = overlayEl && overlayEl.querySelector('[data-cloud-title]');
    var descEl = overlayEl && overlayEl.querySelector('[data-cloud-desc]');
    var tagsEl = overlayEl && overlayEl.querySelector('[data-cloud-tags]');
    var title = (override.title != null ? override.title : (titleEl && titleEl.value || '')).trim();
    if (!title) throw new Error('请填写方案名称');
    var refVideo = String(override.refVideoUrl || '').trim();
    if (!refVideo) {
      try {
        if (typeof state !== 'undefined' && state && state.refVideoUrl) refVideo = String(state.refVideoUrl).trim();
      } catch (e) {}
    }
    var tags = override.tags;
    if (!tags) {
      tags = (tagsEl && tagsEl.value || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 10);
    }
    return {
      title: title,
      description: override.description != null ? String(override.description || '') : ((descEl && descEl.value || '').trim()),
      tags: tags,
      meta: { name: title, author: (getUser() && getUser().email) || '', refVideoUrl: refVideo },
    };
  }
  async function buildUploadBody(fieldOverride, extra) {
    if (typeof window.assertNoCustomCharactersForPublicUpload === 'function') {
      assertNoCustomCharactersForPublicUpload();
    }
    // Batch A（P0-5）：公开上传前预检测试服（CSF）角色/武器（仅 9xxx 临时段拦截；1212 景燃 / 21010076 千般渡 / 清宵 1413 / 云琅 21020106 已批准上线勿拦）
    if (typeof state !== 'undefined' && Array.isArray(state.members)) {
      var csfBad = state.members.some(function (m) {
        var cid = String(m && m.characterId || '').trim();
        var wid = String(m && (m.weaponSelection && m.weaponSelection.id || m.weaponId) || '').trim();
        return /^9\d{3}$/.test(cid);
      });
      if (csfBad) throw new Error('公开库不允许上传测试服（CSF）角色/武器方案');
    }
    if (typeof window.buildWorkspacePayload !== 'function') throw new Error('工作区打包函数未就绪');
    var fields = collectUploadFields(fieldOverride || null);
    var summary = null;
    try {
      // 上传前强制现算：summary 与注入的 results 必须来自本次计算，杜绝过期客户端快照
      if (typeof window.buildExportSummary === 'function') summary = buildExportSummary({ skipCompute: false });
    } catch (e) {
      throw new Error('计算未完成，请先完成一次计算后再上传');
    }
    if (summary) {
      fields.meta.summary = summary;
      fields.summary = summary;
    }
    var payload = { meta: fields.meta, data: buildWorkspacePayload() };
    if (
      payload &&
      payload.data &&
      Array.isArray(payload.data.exportConfigSnapshots) &&
      payload.data.exportConfigSnapshots.length &&
      typeof window.embedConfigSnapshotPayloads === 'function'
    ) {
      payload.data.exportConfigSnapshots = await window.embedConfigSnapshotPayloads(
        payload.data.exportConfigSnapshots
      );
    }
    // serializeMember 不写 results：上传时把成员计算结果注入 payload，服务端据此标记 _serverComputed:true
    if (payload && payload.data && Array.isArray(payload.data.members) && Array.isArray(state && state.members)) {
      payload.data.members.forEach(function (m, i) {
        var mm = state.members[i];
        if (mm && mm.results) {
          m.results = {
            total: Number(mm.results.total) || 0,
            dps: Number(mm.results.dps) || 0,
            axisDuration: Number(mm.results.axisDuration) || 0,
            cycleGrandTotal: Number(mm.results.cycleGrandTotal) || 0,
            cycleMode: mm.results.cycleMode || '',
          };
        }
      });
    }
    // 特殊技能（处决/效应等）结果注入：供服务端 buildSummary 累加
    try {
      if (typeof state !== 'undefined' && state && state.specialSkills && state.specialSkills.results) {
        var sr = state.specialSkills.results;
        if (Number(sr.total) > 0) {
          if (!payload.data.specialSkills) payload.data.specialSkills = {};
          payload.data.specialSkills.results = {
            total: Number(sr.total) || 0,
            dps: Number(sr.dps) || 0,
            axisDuration: Number(sr.axisDuration) || 0,
            cycleGrandTotal: Number(sr.cycleGrandTotal) || 0,
            cycleMode: sr.cycleMode || '',
          };
        }
      }
    } catch (e) {}
    return Object.assign({ payload: payload, summary: fields.summary }, fields, extra || {});
  }

  async function uploadCurrentScheme(opts) {
    opts = opts || {};
    return api('/schemes', { method: 'POST', auth: true, body: await buildUploadBody(opts) });
  }

  /** 用当前工作区覆盖更新已上传方案（分享码不变，版本+1，重新待审核） */
  async function updateCurrentScheme(shareCode, opts) {
    opts = opts || {};
    return api('/schemes/' + encodeURIComponent(String(shareCode || '')), {
      method: 'PUT',
      auth: true,
      body: await buildUploadBody(opts),
    });
  }

  async function doUpload(btn) {
    try {
      var kind = '';
      try {
        if (typeof window.normalizeAxisKind === 'function' && state?.exportCardDraft) {
          kind = normalizeAxisKind(state.exportCardDraft.axisKind);
        }
      } catch (e) {}
      if (!kind) {
        setStatus('请先在导出页选择轴类型（全局轴 / 循环轴）', true);
        return;
      }
      var body = await buildUploadBody();
      if (!body.tags || !body.tags.length) {
        body.tags = [kind === 'loop' ? '循环轴' : '全局轴'];
      }
      setStatus('提交中…');
      var res = await api('/schemes', { method: 'POST', auth: true, body: body });
      setStatus('已提交，分享码 ' + res.share_code + '（待审核）');
      void loadMySchemes();
    } catch (err) { setStatus('上传失败：' + err.message, true); }
  }
  async function doUpdate(code) {
    try {
      var body = await buildUploadBody();
      setStatus('更新中…');
      var res = await api('/schemes/' + encodeURIComponent(code), { method: 'PUT', auth: true, body: body });
      setStatus('已更新为 v' + res.version + '（重新待审核）');
      void loadMySchemes();
    } catch (err) { setStatus('更新失败：' + err.message, true); }
  }

  function renderAdmin() {
    var body = overlayEl.querySelector('[data-cloud-body]');
    body.innerHTML = '<h3 style="margin:0 0 12px">待审核方案</h3><div data-cloud-admin></div>';
    void loadAdmin();
  }
  async function loadAdmin() {
    var el = overlayEl.querySelector('[data-cloud-admin]');
    try {
      var data = await api('/admin/schemes?status=pending&limit=50', { auth: true });
      var items = data.items || [];
      if (!items.length) { el.innerHTML = '<p style="color:#8b94a8">暂无待审核方案</p>'; return; }
      el.innerHTML = items.map(function (it) {
        var author = (it.profiles && (it.profiles.display_name || it.profiles.email)) || '未知';
        return '<div style="border:1px solid #2c3345;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#171b26">' +
          '<div style="display:flex;align-items:center;gap:10px"><strong>' + esc(it.title) + '</strong>' +
          '<span style="font-size:12px;color:#7c8699">' + esc(it.share_code) + '</span>' +
          '<span style="flex:1"></span>' +
          '<button type="button" data-cloud-approve="' + esc(it.id) + '" style="padding:4px 12px;border:none;border-radius:7px;background:#27ae60;color:#fff;cursor:pointer">通过</button>' +
          '<button type="button" data-cloud-reject="' + esc(it.id) + '" style="padding:4px 12px;border:none;border-radius:7px;background:#c0392b;color:#fff;cursor:pointer">驳回</button>' +
          '</div>' +
          '<div style="color:#8b94a8;font-size:12px;margin-top:4px">作者 ' + esc(author) + ' · ' + fmtDate(it.submitted_at) + '</div>' +
          '</div>';
      }).join('');
    } catch (err) {
      el.innerHTML = '<p style="color:#e07b7b">' + esc(err.message) + '</p>';
    }
  }
  async function doApprove(id) {
    try {
      setStatus('审核中…');
      await api('/admin/schemes/' + encodeURIComponent(id) + '/approve', { method: 'POST', auth: true, body: {} });
      setStatus('已通过');
      void loadAdmin();
    } catch (err) { setStatus('操作失败：' + err.message, true); }
  }
  async function doReject(id) {
    var reason = await DialogKit.prompt({ title: '驳回原因', placeholder: '驳回原因', max: 300 });
    if (reason === null) return;
    try {
      setStatus('审核中…');
      await api('/admin/schemes/' + encodeURIComponent(id) + '/reject', { method: 'POST', auth: true, body: { reason: reason } });
      setStatus('已驳回');
      void loadAdmin();
    } catch (err) { setStatus('操作失败：' + err.message, true); }
  }

  async function doLogin() {
    var emailEl = overlayEl.querySelector('[data-cloud-email]');
    var passEl = overlayEl.querySelector('[data-cloud-pass]');
    var email = emailEl && emailEl.value || '';
    var pass = passEl && passEl.value || '';
    if (!email || !pass) { setStatus('请填写账号和密码', true); return; }
    try {
      setStatus('登录中…');
      var user = await signIn(email, pass);
      setStatus('欢迎，' + email);
      renderAuth();
      if (window.SiteIntro && typeof SiteIntro.onAuthMaybeEnter === 'function') {
        SiteIntro.onAuthMaybeEnter();
      }
      if (cloudOpenOrigin === 'profile') {
        cloudOpenOrigin = '';
        closeCloud();
        if (window.WaveCalcProfile && typeof WaveCalcProfile.refresh === 'function') {
          WaveCalcProfile.refresh();
        }
      }
    } catch (err) { setStatus('登录失败：' + err.message, true); }
  }
  async function doSignup() {
    var emailEl = overlayEl.querySelector('[data-cloud-email]');
    var passEl = overlayEl.querySelector('[data-cloud-pass]');
    var agreeEl = overlayEl.querySelector('[data-cloud-agree]');
    var email = emailEl && emailEl.value || '';
    var pass = passEl && passEl.value || '';
    if (!email) { setStatus('请填写账号', true); return; }
    if (email.indexOf('@') < 0 && (email.length < 2 || email.length > 20)) { setStatus('用户名需 2-20 个字符', true); return; }
    if (pass.length < 6) { setStatus('密码至少 6 位', true); return; }
    if (!agreeEl || !agreeEl.checked) { setStatus('请先阅读并同意《用户协议》和《隐私政策》', true); return; }
    try {
      setStatus('注册中…');
      var data = await signUp(email, pass);
      if (data.access_token) {
        setStatus('注册成功，已自动登录');
        renderAuth();
        if (window.SiteIntro && typeof SiteIntro.onAuthMaybeEnter === 'function') {
          SiteIntro.onAuthMaybeEnter();
        }
        if (cloudOpenOrigin === 'profile') {
          cloudOpenOrigin = '';
          closeCloud();
          if (window.WaveCalcProfile && typeof WaveCalcProfile.refresh === 'function') {
            WaveCalcProfile.refresh();
          }
        }
      }
      else setStatus('注册成功，请前往邮箱完成验证后登录');
    } catch (err) { setStatus('注册失败：' + err.message, true); }
  }
  async function doLogout() {
    await signOut();
    // 一并清除本机个人资料（昵称/头像），退出即回到访客状态
    try { localStorage.removeItem('wavecalc-user-profile-v1'); } catch (e) {}
    try {
      var nameEl = document.querySelector('.app-user-name');
      if (nameEl) nameEl.textContent = '用户昵称';
      var avatarEl = document.querySelector('.app-user-avatar');
      if (avatarEl) {
        avatarEl.style.backgroundImage = '';
        avatarEl.classList.remove('has-image');
        avatarEl.textContent = '用';
      }
    } catch (e) {}
    // 从个人主页等非弹窗入口退出时，弹窗可能未打开，跳过界面刷新即可
    if (overlayEl) {
      setStatus('已退出登录');
      renderAuth();
    }
  }

  async function doChangePassword() {
    var p1El = overlayEl.querySelector('[data-cloud-newpass]');
    var p2El = overlayEl.querySelector('[data-cloud-newpass2]');
    var p1 = p1El && p1El.value || '';
    var p2 = p2El && p2El.value || '';
    if (p1.length < 6) { setStatus('新密码至少 6 位', true); return; }
    if (p1 !== p2) { setStatus('两次输入的密码不一致', true); return; }
    try {
      setStatus('修改中…');
      await changePassword(p1);
      await signOut();
      setStatus('密码修改成功，请用新密码重新登录');
      renderAuth();
    } catch (err) { setStatus('修改失败：' + err.message, true); }
  }

  var currentQuery = '';
  // 侧栏「公开数据库」由 public-db.js 接管独立页；上传公开方案仅在数据导出页

  window.Cloud = (window.__WC || (window.__WC = {})).Cloud = {
    open: openCloud,
    close: closeCloud,
    api: api,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    getUser: getUser,
    fetchMyRole: fetchMyRole,
    refreshSession: refreshSession,
    uploadCurrentScheme: uploadCurrentScheme,
    updateCurrentScheme: updateCurrentScheme,
    logout: doLogout,
    changePassword: changePassword,
  };
})();
