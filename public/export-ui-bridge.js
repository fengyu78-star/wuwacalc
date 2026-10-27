/* Presentation-only export workbench parity. Live input and button listeners remain in ui.js. */
(() => {
  const main = document.getElementById('main'); if (!main) return;
  const sync = () => {
    const page = main.querySelector('.export-page'); if (!page) return;
    const top = page.querySelector('.export-top-row');
    const stats = top?.querySelector('.export-region-scheme .esm-stats');
    if (!top || !stats) return;
    let summary = page.querySelector('.export-workbench-summary');
    if (!summary) {
      summary = document.createElement('section');
      summary.className = 'export-workbench-summary';
      summary.setAttribute('aria-label', '方案摘要');
      summary.innerHTML = '<div class="export-workbench-summary-head"><span class="export-workbench-summary-kicker">方案摘要</span><span class="export-workbench-summary-note">编辑方案信息后，在右侧生成卡面</span></div>';
      top.before(summary);
    }
    summary.append(stats);
    const editTitle = top.querySelector('.export-region-scheme > .export-region-head .export-region-title');
    const cardTitle = top.querySelector('.export-card-region > .export-region-head .export-region-title');
    if (editTitle) editTitle.textContent = '方案编辑';
    if (cardTitle) cardTitle.textContent = '卡面制作';
  };
  const observer = new MutationObserver(() => {
    observer.disconnect(); try { sync(); } finally { observer.observe(main, { childList:true, subtree:true }); }
  });
  sync(); observer.observe(main, { childList:true, subtree:true });
})();
