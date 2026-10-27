/* ============================================================
 * 手机端视图（阶段 2 · 移动适配）
 * 设计原则：
 *  - 与桌面端共享同一份 state / 计算 / 事件逻辑，只分叉渲染层
 *  - 添加/删除/撤回/阶段切换等沿用桌面全局委托的 data-action，
 *    本文件只新增手机端特有的「上移/下移」处理
 *  - 所有全局依赖运行时 typeof 兜底，加载失败自动回退桌面渲染
 * ========================================================== */
(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 768px)';
  const mql = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;

  function isMobileView() {
    return !!(mql && mql.matches);
  }

  function esc(s) {
    return typeof window.escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  /* ---------- 编轴（列表模式） ---------- */

  function getSortedCatalog(member) {
    const catalog = member?.rotationCatalog || [];
    return [...catalog].sort((a, b) => {
      const oa = typeof window.getCatalogAxisOffset === 'function' ? getCatalogAxisOffset(a) ?? 0 : 0;
      const ob = typeof window.getCatalogAxisOffset === 'function' ? getCatalogAxisOffset(b) ?? 0 : 0;
      return oa - ob;
    });
  }

  function renderMobileAxisMemberTabs(activeIdx) {
    const members = typeof state !== 'undefined' ? state.members || [] : [];
    return members
      .map((m, i) => {
        const seeded = m?.seeded && m?.characterId;
        const label = seeded ? m.name || `角色${i + 1}` : `槽位${i + 1}`;
        const active = i === activeIdx ? ' is-active' : '';
        const empty = seeded ? '' : ' is-empty';
        return `<button type="button" class="maxis-tab${active}${empty}" data-axis-select-member="${i}">${esc(label)}</button>`;
      })
      .join('');
  }

  function renderMobileAxisSkillItem(c, pos, total, memberIndex) {
    const isSpecial =
      typeof window.isAxisLinkedSpecialCatalogEntry === 'function' && isAxisLinkedSpecialCatalogEntry(c);
    const name = c.name || '未命名';
    const dmgType = String(c.damageType || '').trim();
    const mult = Number.isFinite(Number(c.baseMult)) ? `${Number(c.baseMult)}%` : '';
    const upDisabled = pos === 0 ? ' disabled' : '';
    const downDisabled = pos === total - 1 ? ' disabled' : '';
    return `
      <div class="maxis-item${isSpecial ? ' is-special' : ''}" data-type="${esc(dmgType)}" data-maxis-id="${esc(c.id)}">
        <span class="maxis-item-idx">${pos + 1}</span>
        <div class="maxis-item-main">
          <span class="maxis-item-name">${esc(name)}${isSpecial ? '<em class="maxis-item-tag">特殊</em>' : ''}</span>
          <span class="maxis-item-meta">${dmgType ? `<i>${esc(dmgType)}</i>` : ''}${mult ? `<b>${esc(mult)}</b>` : ''}</span>
        </div>
        <div class="maxis-item-ops">
          <button type="button" class="maxis-op" data-maxis-move="up" data-maxis-id="${esc(c.id)}" data-maxis-member="${memberIndex}" aria-label="上移"${upDisabled}>↑</button>
          <button type="button" class="maxis-op" data-maxis-move="down" data-maxis-id="${esc(c.id)}" data-maxis-member="${memberIndex}" aria-label="下移"${downDisabled}>↓</button>
          <button type="button" class="maxis-op is-danger" data-axis-catalog-del="${esc(c.id)}" data-axis-member="${memberIndex}" aria-label="删除">×</button>
        </div>
      </div>`;
  }

  function renderMobileAxisPalette(member) {
    const palette = member?.characterId ? member.skillPalette || [] : [];
    if (!palette.length) {
      return '<p class="maxis-palette-empty hint">当前角色暂无技能库，请先在桌面端配置或套用模板</p>';
    }
    return palette
      .map((p) => {
        const name = p.name || '未命名';
        const rate =
          typeof window.formatSkillMultChipSuffix === 'function' ? formatSkillMultChipSuffix(p) : '';
        const nodeType =
          typeof window.getAxisSkillNodeType === 'function' ? getAxisSkillNodeType(p) : '';
        return `<button type="button" class="maxis-pal-card" data-type="${esc(nodeType)}" data-add-palette-to-catalog="${esc(p.id)}">
          <span class="maxis-pal-name">${esc(name)}</span>${rate ? `<span class="maxis-pal-rate">${esc(rate)}</span>` : ''}
        </button>`;
      })
      .join('');
  }

  function renderMobileAxisBoard() {
    if (typeof state === 'undefined') return '';
    const activeIdx = state.team?.activeIndex ?? 0;
    const activeMember = state.members?.[activeIdx];
    if (activeMember && typeof window.ensureMemberUiState === 'function') {
      ensureMemberUiState(activeMember, { light: true });
    }
    if (typeof window.ensureAllMembersAxisOffsets === 'function') ensureAllMembersAxisOffsets();

    const tabs = renderMobileAxisMemberTabs(activeIdx);
    const catalog = getSortedCatalog(activeMember);
    const hasChar = !!(activeMember?.seeded && activeMember?.characterId);
    const list = !hasChar
      ? '<p class="maxis-empty hint">当前槽位未选择角色，请先在「配装」页选择角色</p>'
      : catalog.length
        ? catalog.map((c, i) => renderMobileAxisSkillItem(c, i, catalog.length, activeIdx)).join('')
        : '<p class="maxis-empty hint">编轴为空 · 从下方技能库点选添加</p>';

    return `
    <div class="panel team-axis-board maxis-board">
      <div class="maxis-toolbar">
        <span class="maxis-title">编轴</span>
        <div class="maxis-toolbar-ops">
          <button type="button" class="maxis-btn" data-edit-undo title="撤回">←撤回</button>
          <button type="button" class="maxis-btn" data-axis-clear-active title="清空当前角色编轴（可撤回）">清空</button>
        </div>
        <div class="maxis-toolbar-ops">
          <button type="button" class="maxis-btn" data-workspace-phase="setup">配装</button>
          <button type="button" class="maxis-btn is-primary" data-workspace-phase="calc">→计算</button>
        </div>
      </div>
      <div class="maxis-tabs" role="tablist">${tabs}</div>
      <div class="maxis-list">${list}</div>
      <div class="maxis-palette">
        <div class="maxis-palette-title">技能库 · ${esc(activeMember?.name || `槽位${activeIdx + 1}`)}${catalog.length ? ` · 已排 ${catalog.length}` : ''}</div>
        <div class="maxis-palette-strip">${renderMobileAxisPalette(activeMember)}</div>
      </div>
      <p class="maxis-footnote hint">列表顺序即出招顺序 · 精细编排（框选/合并/自由摆放）请用桌面端</p>
    </div>`;
  }

  /* ---------- 上移 / 下移（手机端特有，全局唯一新增逻辑） ---------- */

  function moveCatalogItem(memberIndex, catalogId, dir) {
    if (typeof state === 'undefined') return;
    const member = state.members?.[memberIndex];
    if (!member) return;
    const sorted = getSortedCatalog(member);
    const pos = sorted.findIndex((c) => String(c.id) === String(catalogId));
    const swapPos = dir === 'up' ? pos - 1 : pos + 1;
    if (pos < 0 || swapPos < 0 || swapPos >= sorted.length) return;
    const a = sorted[pos];
    const b = sorted[swapPos];
    if (typeof window.setCatalogAxisOffset !== 'function' || typeof window.getCatalogAxisOffset !== 'function') {
      return;
    }
    if (typeof window.pushEditUndo === 'function') {
      pushEditUndo(member, `调整编轴顺序「${a.name || '未命名'}」`);
    }
    const oa = getCatalogAxisOffset(a) ?? 0;
    const ob = getCatalogAxisOffset(b) ?? 0;
    // 相邻同偏移（紧凑排列下少见）：用序号铺开，保证交换后顺序稳定
    if (oa === ob) {
      sorted.forEach((c, i) => setCatalogAxisOffset(c, (i + 1) * 100));
      setCatalogAxisOffset(a, (swapPos + 1) * 100 - 1);
    } else {
      setCatalogAxisOffset(a, ob);
      setCatalogAxisOffset(b, oa);
    }
    if (typeof window.commitAxisVisualOrder === 'function') {
      commitAxisVisualOrder(member, { syncTimeline: false });
    }
    if (typeof window.refreshUndoUi === 'function') refreshUndoUi();
    if (typeof window.renderMain === 'function') renderMain();
    if (typeof window.scheduleSave === 'function') scheduleSave();
  }

  function bindMobileEventsOnce() {
    if (bindMobileEventsOnce.done) return;
    bindMobileEventsOnce.done = true;
    document.addEventListener('click', (e) => {
      const moveBtn = e.target?.closest?.('[data-maxis-move]');
      if (!moveBtn) return;
      e.preventDefault();
      const memberIndex = parseInt(moveBtn.dataset.maxisMember, 10);
      const catalogId = moveBtn.dataset.maxisId;
      const dir = moveBtn.dataset.maxisMove === 'up' ? 'up' : 'down';
      if (Number.isInteger(memberIndex) && catalogId) {
        moveCatalogItem(memberIndex, catalogId, dir);
      }
    });
  }

  /* ---------- 视口切换：桌面 <-> 手机时重渲染 ---------- */

  function bindViewportWatchOnce() {
    if (bindViewportWatchOnce.done || !mql) return;
    bindViewportWatchOnce.done = true;
    const onChange = () => {
      document.body.classList.toggle('wc-mobile-view', isMobileView());
      if (typeof window.getWorkspacePhase === 'function' && getWorkspacePhase() === 'axis') {
        if (typeof window.renderMain === 'function') renderMain();
      }
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    onChange();
  }

  function init() {
    bindMobileEventsOnce();
    bindViewportWatchOnce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.WcMobile = {
    isMobileView,
    renderMobileAxisBoard,
  };
})();
