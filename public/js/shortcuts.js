/* 快捷键汇总：顶部条「快捷键」按钮 → 弹窗展示全站快捷键 */
(function () {
  'use strict';

  var STYLE_ID = 'wc-shortcuts-style';
  var MODAL_SEL = '[data-wc-shortcuts-modal]';
  var OPEN_SEL = '[data-open-shortcuts]';
  var bound = false;

  var css = [
    '.app-shortcuts-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;',
    'margin-right:10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 26%,transparent);',
    'background:color-mix(in srgb,var(--accent-primary,#c9a84c) 7%,transparent);color:var(--text-secondary,#e8ecf5);',
    'font-size:13px;font-family:inherit;cursor:pointer;transition:color .2s,background .2s,border-color .2s;}',
    '.app-shortcuts-btn:hover{color:var(--accent-primary,#c9a84c);border-color:color-mix(in srgb,var(--accent-primary,#c9a84c) 52%,transparent);',
    'background:color-mix(in srgb,var(--accent-primary,#c9a84c) 12%,transparent);}',
    '.app-shortcuts-btn .sc-kbd-icon{width:15px;height:15px;flex:0 0 auto;}',
    '.wc-shortcuts-overlay{position:fixed;inset:0;z-index:200300;display:flex;align-items:center;justify-content:center;',
    'padding:20px;box-sizing:border-box;background:color-mix(in srgb,var(--bg-deepest,#0d0f13) 72%,transparent);',
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
    '.wc-shortcuts{width:min(560px,94vw);max-height:82vh;display:flex;flex-direction:column;border-radius:14px;',
    'border:1px solid var(--border,rgba(255,255,255,0.08));background:var(--surface,#161618);color:var(--text-primary,#e8ecf5);',
    'box-shadow:0 24px 70px rgba(0,0,0,0.55);overflow:hidden;}',
    '.wc-shortcuts-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;',
    'border-bottom:1px solid var(--border,rgba(255,255,255,0.08));flex-shrink:0;}',
    '.wc-shortcuts-head strong{font-size:15px;font-weight:700;}',
    '.wc-shortcuts-close{width:30px;height:30px;border:none;border-radius:8px;background:transparent;color:var(--text-muted,#8b94a8);',
    'cursor:pointer;font-size:16px;line-height:1;}',
    '.wc-shortcuts-close:hover{color:var(--text-primary,#e8ecf5);background:var(--hover-bg,rgba(255,255,255,0.06));}',
    '.wc-shortcuts-body{padding:14px 18px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;}',
    '.wc-sc-group-title{font-size:12px;font-weight:700;letter-spacing:0.08em;color:color-mix(in srgb,var(--accent-primary,#c9a84c) 78%,transparent);',
    'margin:0 0 8px;}',
    '.wc-sc-row{display:flex;align-items:flex-start;gap:12px;padding:6px 2px;}',
    '.wc-sc-row + .wc-sc-row{border-top:1px solid rgba(255,255,255,0.04);}',
    '.wc-sc-keys{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:5px;min-width:128px;padding-top:1px;}',
    '.wc-sc-key{display:inline-block;padding:2px 8px;border-radius:6px;border:1px solid color-mix(in srgb,var(--accent-primary,#c9a84c) 36%,transparent);',
    'background:color-mix(in srgb,var(--accent-primary,#c9a84c) 9%,transparent);color:var(--accent-primary,#c9a84c);',
    'font-size:12px;font-weight:600;white-space:nowrap;}',
    '.wc-sc-desc{flex:1;min-width:0;font-size:13px;line-height:1.55;color:var(--text-secondary,#c6cfdd);}',
    '.wc-sc-desc b{color:var(--text-primary,#e8ecf5);font-weight:600;}',
    '@media (max-width:640px){.app-shortcuts-btn span{display:none;}.app-shortcuts-btn{margin-right:6px;padding:0 9px;}}',
  ].join('');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  var GROUPS = [
    {
      title: '通用',
      rows: [
        { keys: ['Esc'], desc: '关闭当前弹窗 / 面板 / 下拉（详情、上传、叠层、Buff 抽屉等）' },
        { keys: ['Enter'], desc: '确认当前输入（搜索、表单、叠层数值）' },
      ],
    },
    {
      title: '配置选择 & 编轴',
      rows: [
        { keys: ['Ctrl / ⌘', 'Z'], desc: '撤回上一步操作' },
        { keys: ['Shift', '点选'], desc: '技能加入时<b>指定插入位置</b>' },
        { keys: ['Ctrl / ⌘', '点选'], desc: '多选技能（时间线 / 技能列表）' },
        { keys: ['拖拽框选'], desc: '在空白处拖拽框选多个技能' },
        { keys: ['右键技能'], desc: '改名 / 复制 / 合并 / 删除' },
        { keys: ['双击技能'], desc: '直接进入改名' },
        { keys: ['Esc'], desc: '取消当前选择 / 退出合并选取' },
      ],
    },
    {
      title: '计算页',
      rows: [
        { keys: ['Tab'], desc: '开关 Buff 明细抽屉' },
        { keys: ['Esc'], desc: '关闭 Buff 抽屉' },
      ],
    },
    {
      title: 'Buff 检查',
      rows: [
        { keys: ['按住 V', '点击'], desc: '标记该技能已检查完毕（高亮）' },
      ],
    },
    {
      title: '循环轴',
      rows: [
        { keys: ['拖动轮次标签'], desc: '调整多轮循环顺序' },
      ],
    },
  ];

  function groupHtml(g) {
    return (
      '<div class="wc-sc-group">' +
      '<h4 class="wc-sc-group-title">' + g.title + '</h4>' +
      g.rows
        .map(function (r) {
          return (
            '<div class="wc-sc-row">' +
            '<div class="wc-sc-keys">' + r.keys.map(function (k) { return '<span class="wc-sc-key">' + k + '</span>'; }).join('') + '</div>' +
            '<div class="wc-sc-desc">' + r.desc + '</div>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function close() {
    var el = document.querySelector(MODAL_SEL);
    if (el) el.remove();
    document.body.classList.remove('wc-shortcuts-lock');
  }

  function open() {
    close();
    var overlay = document.createElement('div');
    overlay.className = 'wc-shortcuts-overlay';
    overlay.setAttribute('data-wc-shortcuts-modal', '');
    overlay.innerHTML =
      '<div class="wc-shortcuts" role="dialog" aria-modal="true" aria-labelledby="wcShortcutsTitle">' +
      '<div class="wc-shortcuts-head">' +
      '<strong id="wcShortcutsTitle">快捷键汇总</strong>' +
      '<button type="button" class="wc-shortcuts-close" data-wc-shortcuts-close aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="wc-shortcuts-body">' + GROUPS.map(groupHtml).join('') + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('wc-shortcuts-lock');
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest(OPEN_SEL)) {
        open();
        return;
      }
      if (e.target.closest('[data-wc-shortcuts-close]') || (e.target.closest(MODAL_SEL) && e.target.hasAttribute('data-wc-shortcuts-modal'))) {
        close();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function boot() {
    injectStyle();
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
