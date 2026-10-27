/**
 * 鳴算屋 · 通用悬停 Tooltip（WcTooltip）
 * 同一时间只显示一个；默认延迟 200ms 出现，移出立即隐藏。
 */
(function (global) {
  const SHOW_DELAY_MS = 200;
  const HIDE_OUT_MS = 80;
  /** 与触发元素的间距 */
  const GAP = 8;
  /** 与视口边缘的最小间距 */
  const VIEW_PAD = 12;

  let rootEl = null;
  let showTimer = null;
  let hideAnimTimer = null;
  let activeAnchor = null;
  let currentToken = 0;
  let viewportListenersBound = false;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Buff 原文：数字 / 效果关键词高亮（先转义再包 span） */
  const BUFF_DESC_KEYWORDS = [
    '全伤害加深',
    '伤害加深',
    '伤害加成',
    '暴击伤害',
    '暴击率',
    '共鸣效率',
    '无视防御',
    '防御穿透',
    '抗性降低',
    '属性伤害',
    '共鸣技能',
    '共鸣解放',
    '共鸣模态',
    '协同攻击',
    '声骸技能',
    '队伍中的角色',
    '下一个登场',
    '登场角色',
    '普攻伤害',
    '重击伤害',
    '技能伤害',
    '加深',
    '增伤',
    '易伤',
    '减抗',
    '穿防',
    '暴击',
    '暴伤',
    '攻击',
    '生命',
    '防御',
    '持续',
    '登场',
    '集谱',
    '集谐',
  ];

  function formatBuffDescHtml(text) {
    const keys = BUFF_DESC_KEYWORDS.slice().sort((a, b) => b.length - a.length);

    function mapTextParts(html, fn) {
      return String(html || '')
        .split(/(<[^>]+>)/g)
        .map((part) => (part.startsWith('<') ? part : fn(part)))
        .join('');
    }

    function highlightLine(escapedLine) {
      let html = String(escapedLine || '').replace(
        /([+\-±]?\d+(?:\.\d+)?)(%|秒|层|点|次|米)?/g,
        (_, num, unit) => `<span class="number">${num}${unit || ''}</span>`
      );
      keys.forEach((kw) => {
        const escapedKw = esc(kw);
        if (!escapedKw) return;
        const re = new RegExp(escapedKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        html = mapTextParts(html, (part) =>
          part.replace(re, `<span class="keyword">${escapedKw}</span>`)
        );
      });
      return html;
    }

    return String(text ?? '')
      .split(/\r\n|\r|\n/)
      .map((line) => highlightLine(esc(line)))
      .join('<br>');
  }

  function ensureRoot() {
    if (rootEl && document.body.contains(rootEl)) return rootEl;
    rootEl = document.createElement('div');
    rootEl.id = 'wcTooltipRoot';
    rootEl.className = 'wc-tooltip';
    rootEl.setAttribute('role', 'tooltip');
    rootEl.hidden = true;
    rootEl.innerHTML = '<div class="wc-tooltip-arrow" aria-hidden="true"></div><div class="wc-tooltip-inner"></div>';
    document.body.appendChild(rootEl);
    return rootEl;
  }

  function clearShowTimer() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function clearHideAnimTimer() {
    if (hideAnimTimer) {
      clearTimeout(hideAnimTimer);
      hideAnimTimer = null;
    }
  }

  function buildInnerHtml(content) {
    if (content == null) return '';
    if (typeof content === 'string') {
      return `<div class="wc-tooltip-body"><div class="wc-tooltip-text">${content}</div></div>`;
    }

    const parts = [];
    const hasHeader = !!(content.title || content.badge);
    if (hasHeader) {
      parts.push('<div class="wc-tooltip-header">');
      if (content.title) {
        parts.push(`<span class="wc-tooltip-title">${esc(content.title)}</span>`);
      }
      if (content.badge) {
        parts.push(`<span class="wc-tooltip-badge">${esc(content.badge)}</span>`);
      }
      parts.push('</div>');
    }

    if (content.subtitle) {
      parts.push(`<div class="wc-tooltip-subtitle">${esc(content.subtitle)}</div>`);
    }

    const rows = Array.isArray(content.rows) ? content.rows : [];
    const hasRows = rows.length > 0;
    const hasHtml = !!content.html;
    const hasDesc = content.desc != null && content.desc !== '';
    const hasText = content.text != null && content.text !== '';
    const hasDebug = content.debug != null && content.debug !== '';

    if (hasRows || hasHtml || hasDesc || hasText || hasDebug) {
      parts.push('<div class="wc-tooltip-body">');
      if (hasRows) {
        rows.forEach((row) => {
          if (!row) return;
          if (row.divider) {
            parts.push('<div class="wc-tooltip-divider"></div>');
            return;
          }
          if (row.section) {
            parts.push(`<div class="wc-tooltip-section-title">${esc(row.section)}</div>`);
            return;
          }
          if (Array.isArray(row.cells) && row.cells.length) {
            const rowCls = row.highlight ? 'wc-tooltip-row highlight multi' : 'wc-tooltip-row multi';
            parts.push(`<div class="${rowCls}">`);
            row.cells.forEach((cell) => {
              if (!cell) return;
              const safeClass =
                cell.valueClass === 'accent' || cell.valueClass === 'crit' ? cell.valueClass : '';
              const vCls = safeClass ? `wc-tooltip-value ${safeClass}` : 'wc-tooltip-value';
              parts.push(
                `<span class="wc-tooltip-label">${esc(cell.label ?? '')}</span><span class="${vCls}">${esc(
                  cell.value ?? ''
                )}</span>`
              );
            });
            parts.push('</div>');
            return;
          }
          const rowCls = row.highlight ? 'wc-tooltip-row highlight' : 'wc-tooltip-row';
          const safeClass =
            row.valueClass === 'accent' || row.valueClass === 'crit' ? row.valueClass : '';
          const vCls = safeClass ? `wc-tooltip-value ${safeClass}` : 'wc-tooltip-value';
          parts.push(
            `<div class="${rowCls}"><span class="wc-tooltip-label">${esc(
              row.label ?? ''
            )}</span><span class="${vCls}">${esc(row.value ?? '')}</span></div>`
          );
        });
      }
      if (hasHtml) parts.push(content.html);
      else if (hasDesc) {
        parts.push(`<p class="wc-tooltip-desc">${formatBuffDescHtml(content.desc)}</p>`);
      } else if (hasText) {
        parts.push(`<div class="wc-tooltip-text">${esc(content.text)}</div>`);
      }
      if (hasDebug) {
        parts.push(`<div class="wc-tooltip-debug">${esc(content.debug)}</div>`);
      }
      parts.push('</div>');
    }

    if (content.footer) {
      const footer =
        typeof content.footer === 'object' && content.footer
          ? content.footer
          : { text: content.footer };
      const footerText = footer.text ?? footer.label ?? '';
      if (footerText !== '' || footer.dotColor) {
        const dot = footer.dotColor
          ? `<span class="source-dot" style="background:${esc(footer.dotColor)}"></span>`
          : '';
        parts.push(
          `<div class="wc-tooltip-footer"><span class="wc-tooltip-source">${dot}${esc(
            footerText
          )}</span></div>`
        );
      }
    }

    return parts.join('') || '<div class="wc-tooltip-body"></div>';
  }

  function getAnchorRect(anchor, pointerEvent) {
    // 定位始终基于触发元素；pointer 仅作无元素时的兜底
    if (anchor && typeof anchor.getBoundingClientRect === 'function') {
      const r = anchor.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        midX: r.left + r.width / 2,
        midY: r.top + r.height / 2,
      };
    }
    if (pointerEvent && Number.isFinite(pointerEvent.clientX) && Number.isFinite(pointerEvent.clientY)) {
      const x = pointerEvent.clientX;
      const y = pointerEvent.clientY;
      return { left: x, right: x, top: y, bottom: y, width: 0, height: 0, midX: x, midY: y };
    }
    return {
      left: VIEW_PAD,
      right: VIEW_PAD,
      top: VIEW_PAD,
      bottom: VIEW_PAD,
      width: 0,
      height: 0,
      midX: VIEW_PAD,
      midY: VIEW_PAD,
    };
  }

  /**
   * 定位优先级：上 → 下 → 右 → 左；贴边钳制，并同步箭头。
   * preferred 非 auto 时将该方向提到最前，仍按空间回退。
   */
  function placeTooltip(el, anchorRect, preferred) {
    const tipW = el.offsetWidth || 200;
    const tipH = el.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const trigger = {
      left: anchorRect.left,
      right: anchorRect.right,
      top: anchorRect.top,
      bottom: anchorRect.bottom,
      width: anchorRect.width,
      height: anchorRect.height,
      midX: anchorRect.midX,
      midY: anchorRect.midY,
    };

    const canTop = trigger.top - tipH - GAP >= VIEW_PAD;
    const canBottom = trigger.bottom + GAP + tipH <= vh - VIEW_PAD;
    const canRight = trigger.right + GAP + tipW <= vw - VIEW_PAD;
    const canLeft = trigger.left - tipW - GAP >= VIEW_PAD;

    let order = ['top', 'bottom', 'right', 'left'];
    if (preferred && preferred !== 'auto') {
      order = [preferred, ...order.filter((p) => p !== preferred)];
    }

    const fits = { top: canTop, bottom: canBottom, right: canRight, left: canLeft };
    let placement = order.find((p) => fits[p]) || 'top';

    let left = 0;
    let top = 0;

    if (placement === 'top') {
      top = trigger.top - tipH - GAP;
      left = trigger.left + (trigger.width - tipW) / 2;
      left = Math.max(VIEW_PAD, Math.min(left, vw - tipW - VIEW_PAD));
    } else if (placement === 'bottom') {
      top = trigger.bottom + GAP;
      left = trigger.left + (trigger.width - tipW) / 2;
      left = Math.max(VIEW_PAD, Math.min(left, vw - tipW - VIEW_PAD));
    } else if (placement === 'right') {
      left = trigger.right + GAP;
      top = trigger.top + (trigger.height - tipH) / 2;
      top = Math.max(VIEW_PAD, Math.min(top, vh - tipH - VIEW_PAD));
    } else {
      left = trigger.left - tipW - GAP;
      top = trigger.top + (trigger.height - tipH) / 2;
      top = Math.max(VIEW_PAD, Math.min(top, vh - tipH - VIEW_PAD));
    }

    // 极端视口：仍保证不溢出
    left = Math.max(VIEW_PAD, Math.min(left, Math.max(VIEW_PAD, vw - tipW - VIEW_PAD)));
    top = Math.max(VIEW_PAD, Math.min(top, Math.max(VIEW_PAD, vh - tipH - VIEW_PAD)));

    el.dataset.placement = placement;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;

    const arrow = el.querySelector('.wc-tooltip-arrow');
    if (arrow) {
      arrow.style.left = '';
      arrow.style.top = '';
      arrow.style.right = '';
      arrow.style.bottom = '';
      if (placement === 'top' || placement === 'bottom') {
        const ax = trigger.midX - left;
        arrow.style.left = `${Math.round(Math.min(tipW - 12, Math.max(12, ax)))}px`;
      } else {
        const ay = trigger.midY - top;
        arrow.style.top = `${Math.round(Math.min(tipH - 12, Math.max(12, ay)))}px`;
      }
    }

    return placement;
  }

  function bindViewportListenersOnce() {
    if (viewportListenersBound || typeof window === 'undefined') return;
    viewportListenersBound = true;
    const onViewportChange = () => {
      if (!isVisible()) return;
      hide(true);
    };
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
  }

  function hideImmediate() {
    clearShowTimer();
    clearHideAnimTimer();
    currentToken += 1;
    activeAnchor = null;
    const el = rootEl || document.getElementById('wcTooltipRoot');
    if (!el) return;
    el.classList.remove('closing');
    el.hidden = true;
    el.style.left = '';
    el.style.top = '';
  }

  function hide(immediate) {
    clearShowTimer();
    const el = rootEl || document.getElementById('wcTooltipRoot');
    if (!el || el.hidden) {
      activeAnchor = null;
      return;
    }
    if (immediate) {
      hideImmediate();
      return;
    }
    clearHideAnimTimer();
    el.classList.add('closing');
    const token = currentToken;
    hideAnimTimer = setTimeout(() => {
      hideAnimTimer = null;
      if (token !== currentToken) return;
      hideImmediate();
    }, HIDE_OUT_MS);
  }

  function showNow(anchor, content, options = {}) {
    clearShowTimer();
    clearHideAnimTimer();
    currentToken += 1;
    const token = currentToken;
    bindViewportListenersOnce();
    const el = ensureRoot();
    const inner = el.querySelector('.wc-tooltip-inner');
    if (inner) inner.innerHTML = buildInnerHtml(content);

    const variant = options.variant || content?.variant || 'default';
    el.dataset.variant = variant;
    el.classList.remove('closing');
    el.hidden = false;
    el.style.visibility = 'hidden';

    activeAnchor = anchor || null;
    const rect = getAnchorRect(anchor, options.pointerEvent);
    placeTooltip(el, rect, options.placement || 'auto');

    el.style.visibility = '';
    // 重触发入场动画
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';

    if (token !== currentToken) return;
  }

  function show(anchor, content, options = {}) {
    const delay = options.delay == null ? 0 : Number(options.delay);
    clearShowTimer();
    // 新的打开时旧的立即关掉（无退场动画）
    hideImmediate();
    if (delay > 0) {
      showTimer = setTimeout(() => {
        showTimer = null;
        showNow(anchor, content, options);
      }, delay);
      return;
    }
    showNow(anchor, content, options);
  }

  function scheduleShow(anchor, content, options = {}) {
    show(anchor, content, { ...options, delay: options.delay == null ? SHOW_DELAY_MS : options.delay });
  }

  function isVisible() {
    const el = rootEl || document.getElementById('wcTooltipRoot');
    return !!(el && !el.hidden);
  }

  function getActiveAnchor() {
    return activeAnchor;
  }

  const api = {
    SHOW_DELAY_MS,
    show,
    scheduleShow,
    hide,
    hideImmediate,
    isVisible,
    getActiveAnchor,
    buildInnerHtml,
    formatBuffDescHtml,
    esc,
  };

  global.WcTooltip = api;
})(typeof window !== 'undefined' ? window : globalThis);
