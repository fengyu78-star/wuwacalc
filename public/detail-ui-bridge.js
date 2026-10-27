/* Presentation only: reuse the live role switch and three view tabs. */
(() => {
  const main = document.getElementById('main');
  if (!main) return;
  const fmt = value => Math.round(Number(value) || 0).toLocaleString('en-US');
  const card = (source, index) => {
    const special = source.hasAttribute('data-switch-special');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `local-team-card${source.classList.contains('active') ? ' active' : ''}${special ? ' local-special-card' : ''}`;
    if (special) button.setAttribute('data-switch-special','');
    else button.setAttribute('data-switch-member',String(index));
    const name = special ? '特殊技能' : source.getAttribute('data-name') || `角色${index + 1}`;
    const amount = special ? source.querySelector('.dock-pct')?.textContent?.trim() || '0%' : fmt(window.state?.members?.[index]?.results?.total);
    const detail = special ? `伤害占比 ${amount}` : `单人总伤 ${amount}`;
    const badge = special ? '✦' : String(index + 1).padStart(2,'0');
    const avatar = document.createElement('span');
    avatar.className = 'local-team-avatar';
    avatar.textContent = badge;
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
    copy.className = 'local-team-copy';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = detail;
    copy.append(strong,small);
    button.append(avatar,copy);
    return button;
  };
  const sync = () => {
    if (!document.getElementById('workspaceLayout')?.classList.contains('phase-calc')) return;
    const page = main.querySelector('.calc-page');
    if (!page || page.dataset.localDetailBridge) return;
    const summary = page.querySelector(':scope > .calc-summary-bar');
    const column = page.querySelector(':scope > .calc-main-col');
    const dock = page.querySelector(':scope > .calc-member-dock');
    if (!summary || !column || !dock) return;
    page.dataset.localDetailBridge = '1';
    const cards = document.createElement('div');
    cards.className = 'local-calc-members';
    dock.querySelectorAll('.calc-member-dock-item[data-switch-member]').forEach((source,index) => cards.append(card(source,index)));
    const special = dock.querySelector('.calc-member-dock-item[data-switch-special]');
    if (special) cards.append(card(special,3));
    page.insertBefore(cards,summary);
    const stepper = column.querySelector(':scope > .local-calc-tabs');
    if (stepper) page.insertBefore(stepper,summary);
  };
  new MutationObserver(sync).observe(main,{childList:true,subtree:true});
  sync();
})();
