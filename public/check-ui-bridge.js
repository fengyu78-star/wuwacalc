/* Enrich the live role tabs with the local visual hierarchy. */
(() => {
  const main = document.getElementById('main');
  if (!main) return;
  const fmt = value => Math.round(Number(value) || 0).toLocaleString('en-US');
  const sync = () => {
    if (!document.getElementById('workspaceLayout')?.classList.contains('phase-check')) return;
    const page = main.querySelector('.calc-check-page');
    if (!page || page.dataset.localCheckBridge) return;
    const tabs = [...page.querySelectorAll('.check-topbar-tab')];
    if (!tabs.length) return;
    page.dataset.localCheckBridge = '1';
    tabs.forEach((button,index) => {
      const special = button.hasAttribute('data-switch-special');
      const name = button.textContent.trim();
      const avatar = document.createElement('span');
      avatar.className = 'local-check-avatar';
      avatar.textContent = special ? '✦' : String(index + 1).padStart(2,'0');
    if (!special) {
      const member = window.state?.members?.[index];
      const wc = window.__WC;
      const def = member?.characterId && wc?.findCharSkillDef?.(member.characterId);
      if (def && typeof wc.renderCharAvatarCard === 'function') {
        avatar.innerHTML = wc.renderCharAvatarCard(def, { plain: true });
        avatar.querySelector('img')?.setAttribute('loading', 'eager');
      }
    }
      const copy = document.createElement('span');
      copy.className = 'local-check-copy';
      const title = document.createElement('strong');
      title.textContent = name;
      const detail = document.createElement('small');
      const members = window.state?.members || [];
      const specialTotal = Math.max(0,(Number(window.state?.teamResults?.total) || 0) - members.reduce((sum,member) => sum + (Number(member.results?.total) || 0),0));
      detail.textContent = special ? `总伤 ${fmt(specialTotal)}` : `单人总伤 ${fmt(members[index]?.results?.total)}`;
      copy.append(title,detail);
      button.replaceChildren(avatar,copy);
      button.setAttribute('aria-label',name);
    });
  };
  new MutationObserver(sync).observe(main,{childList:true,subtree:true});
  sync();
})();
