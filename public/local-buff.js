/* Display-only subpages. Original nodes and engine events are preserved. */
(() => {
  let selected = '0';
  let view = 'team';
  const memberViews = new Map();
  function setView(page, next) {
    view = next;
    if (next !== 'environment') memberViews.set(selected, next);
    page.dataset.buffView = next;
    page.querySelectorAll('[data-buff-view-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.buffViewChoice === next)));
    page.querySelector('.local-buff-workspace').hidden = next === 'environment';
    page.querySelector('.local-buff-environment').hidden = next !== 'environment';
  }
  const root = document.querySelector('#main');
  if (!root) return;
  let effectDialog;
  function openEffect(hit) {
    const api = window.__WC;
    const buff = api?.findBuffByIdAnywhere?.(hit.dataset.teamBuffFocus);
    if (!effectDialog) {
      effectDialog = document.createElement('dialog');
      effectDialog.className = 'local-buff-effect-dialog';
      effectDialog.setAttribute('aria-labelledby', 'local-buff-effect-title');
      effectDialog.innerHTML = '<header><h2 id="local-buff-effect-title"></h2><button type="button" aria-label="关闭 Buff 效果">×</button></header><div class="local-buff-effect-copy"></div>';
      effectDialog.querySelector('button').addEventListener('click', () => effectDialog.close());
      effectDialog.addEventListener('click', event => { if (event.target === effectDialog) { const r = effectDialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) effectDialog.close(); } });
      document.body.append(effectDialog);
    }
    effectDialog.querySelector('h2').textContent = buff ? api.formatBuffTooltipTitle?.(buff) || hit.textContent : hit.textContent;
    const copy = effectDialog.querySelector('.local-buff-effect-copy');
    copy.replaceChildren();
    const effects = buff?.category === 'composite' ? buff.effects || [] : buff ? [buff] : [];
    const number = value => Number.isFinite(Number(value)) ? String(Number(value)) : '待确认';
    effects.forEach(effect => {
      const composite = buff.category === 'composite';
      const zone = composite ? effect.zone : effect.category;
      const meta = api.BUFF_CATS?.[zone];
      const unit = meta?.unit ?? '';
      const stacked = composite ? effect.valueMode !== 'fixed' : buff.mode === 'stack';
      const row = document.createElement('section'); row.className = 'local-buff-value-row';
      const title = document.createElement('h3'); title.textContent = meta?.label || zone || '未知乘区';
      const value = document.createElement('strong');
      if (stacked && composite) {
        value.textContent = (effect.segments || []).map((segment, i) => {
          const start = i === 0 ? 1 : Number(effect.segments[i - 1].upTo) + 1;
          const range = effect.segments.length > 1 ? `${start}～${segment.upTo ?? '上限'}层：` : '';
          return `${range}${number(segment.perStack)}${unit}/层`;
        }).join('；') || '叠层数值待确认';
      } else value.textContent = `${number(stacked ? buff.perStack ?? buff.value : effect.value)}${unit}${stacked ? '/层' : ''}`;
      row.append(title, value);
      const scopes = [effect.element, effect.damageType, effect.effectType].filter(Boolean);
      if (effect.skillScope && effect.skillScope !== 'all') scopes.push(...(effect.skillNames || effect.catalogIds || []));
      const conditions = [];
      if (buff.mode === 'stack') conditions.push(`最多 ${buff.maxStacks ?? '待确认'} 层`);
      if (effect.minStacks) conditions.push(`达到 ${effect.minStacks} 层生效`);
      if (effect.minResonance) conditions.push(`${effect.minResonance} 链解锁`);
      if (effect.defenseKind) conditions.push(effect.defenseKind === 'pen' ? '防御穿透' : effect.defenseKind === 'reduce' ? '防御降低' : effect.defenseKind);
      if (effect.onlyCharacterIds?.length) conditions.push(`限定角色：${effect.onlyCharacterIds.join('、')}`);
      if (effect.onlyCombatModes?.length) conditions.push(`限定模态：${effect.onlyCombatModes.join('、')}`);
      const detail = document.createElement('p'); detail.textContent = [...scopes, ...conditions].join(' · ') || '泛用';
      row.append(detail); copy.append(row);
    });
    if (!effects.length) copy.textContent = '暂无可展示的数值效果。';
    effectDialog.showModal();
  }
  root.addEventListener('click', event => {
    const hit = event.target.closest('.local-buff-table [data-team-buff-focus]');
    if (!hit) return;
    event.preventDefault(); event.stopImmediatePropagation(); openEffect(hit);
  }, true);
  root.addEventListener('keydown', event => {
    const hit = event.target.closest('.local-buff-table [data-team-buff-focus]');
    if (!hit || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); openEffect(hit);
  }, true);
  const expanded = new Set();
  function makeWorksheet(page, panels) {
    page.querySelectorAll('.buff-source-card:not(.is-empty)').forEach(card => {
      const body = card.querySelector('.card-body');
      const heads = [...card.querySelectorAll('.buff-grid__buff-head')];
      const cells = [...card.querySelectorAll('.buff-grid__cell')];
      const labels = [...card.querySelectorAll('.fixed-label-col>.label')];
      if (!body || !heads.length || cells.length !== heads.length * 3) return;
      const table = document.createElement('table'); table.className = 'local-buff-table';
      const head = table.createTHead().insertRow();
      const title = document.createElement('th'); title.scope = 'col'; title.textContent = '来源 / 效果'; head.append(title);
      labels.forEach((label, i) => {
        const th = document.createElement('th'); th.scope = 'col';
        const name = document.createElement('span'); name.textContent = label.querySelector('[title]')?.title || `队员 ${i + 1}`;
        th.setAttribute('aria-label',name.textContent); th.title=name.textContent; th.append(...label.childNodes); head.append(th);
      });
      const rows = table.createTBody();
      heads.forEach((buff, i) => {
        const row = rows.insertRow(); const name = document.createElement('th'); name.scope = 'row'; name.append(buff);
        const hint = [0, 1, 2].map(member => cells[member * heads.length + i].querySelector('[title]')?.title).find(text => text && !text.includes('固定不生效'));
        if (hint && !hint.includes('固定不生效')) { const desc = document.createElement('small'); desc.textContent = hint.split(' · 本角色层数')[0]; name.append(desc); }
        row.append(name);
        for (let member = 0; member < 3; member++) row.insertCell().append(cells[member * heads.length + i]);
      });
      body.replaceChildren(table);
    });
    panels.forEach(panel => {
      const stats = panel.querySelector('.setup-panel-buff-stats');
      if (!stats) return;
      stats.querySelectorAll('.stat-detail .stack-input').forEach(input => {
        input.hidden = true;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'local-stat-stack'; button.textContent = `${input.value}层`; button.title = '修改层数';
        input.after(button);
        button.addEventListener('click', () => {
          const buff = window.__WC?.findBuffByIdAnywhere?.(input.dataset.buffStackId);
          const sourceId = buff?.teamSourceId || input.dataset.buffStackId;
          const original = [...page.querySelectorAll('[data-tba-stack-open]')].find(node => node.dataset.tbaStackOpen === sourceId && node.dataset.memberIndex === panel.dataset.setupMember);
          if (original) {
            ['data-tba-stack-open','data-member-index','data-tba-max-stacks'].forEach(attr => { if(original.hasAttribute(attr)) button.setAttribute(attr,original.getAttribute(attr)); });
            return;
          }

          document.querySelectorAll('.local-stack-editor').forEach(n=>n.remove());
          const editor=document.createElement('div');editor.className='local-stack-editor';editor.popover='auto';editor.setAttribute('role','dialog');editor.setAttribute('aria-label','修改层数');
          const label=document.createElement('label');label.textContent='层数';
          const field=document.createElement('input');field.type='number';field.required=true;field.min=input.min||'0';field.step=input.step||'1';field.value=input.value;field.setAttribute('aria-label','层数');if(input.max)field.max=input.max;label.append(field);
          const apply=document.createElement('button');apply.type='button';apply.textContent='确定';
          apply.onclick=()=>{if(!field.reportValidity())return;const value=field.value;editor.hidePopover();if(input.isConnected){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));button.textContent=value+'层';}};
          editor.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply.click();}});
          editor.append(label,apply);document.body.append(editor);editor.showPopover();
          const r=button.getBoundingClientRect(),box=editor.getBoundingClientRect();editor.style.left=Math.max(8,Math.min(r.right-box.width,innerWidth-box.width-8))+'px';editor.style.top=Math.max(8,r.bottom+box.height+8<=innerHeight?r.bottom+7:r.top-box.height-7)+'px';
          editor.addEventListener('toggle',e=>{if(e.newState==='closed')editor.remove();});field.focus();field.select();
        });
      });

      const overview = stats.querySelector('.stats-overview-bar');
      if (overview) { overview.classList.add('local-buff-overview'); panel.prepend(overview); }
      const details = document.createElement('details'); details.className = 'local-buff-details'; details.open = expanded.has(panel.dataset.setupMember);
      const summary = document.createElement('summary'); summary.textContent = '实际生效明细';
      details.append(summary, ...stats.childNodes); stats.append(details);
      details.addEventListener('toggle', () => { if (details.open) expanded.add(panel.dataset.setupMember); else expanded.delete(panel.dataset.setupMember); });
    });
  }
  function activate(page, value, focus = false) {
    if (selected !== value) view = memberViews.get(value) || 'team';
    selected = value;
    page.querySelectorAll('.local-buff-member-tab').forEach(button => {
      const active = button.dataset.member === value;
      button.setAttribute('aria-selected', String(active));
      button.classList.toggle('active', active);
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    page.querySelector('.local-buff-environment').hidden = value !== 'environment';
    const workspace = page.querySelector('.local-buff-workspace');
    workspace.hidden = value === 'environment';
    workspace.setAttribute('aria-labelledby', `local-buff-tab-${value}`);
    page.querySelectorAll('.buff-check-member-col').forEach(panel => { panel.hidden = panel.dataset.setupMember !== value; });
    page.querySelectorAll('.buff-source-card[data-tba-card]').forEach(card => {
      const member = /^src(\d+)$/.exec(card.dataset.tbaCard);
      card.hidden = member ? member[1] !== value : false;
    });
    const original = page.querySelector(`.buff-check-member-col[data-setup-member="${value}"] .buff-check-member-head`);
    const hero = page.querySelector('.local-buff-identity');
    hero.replaceChildren();
    if (original) {
      const avatar = original.querySelector('img');
      if (avatar) { const image = document.createElement('img'); image.src = avatar.src; image.alt = ''; hero.append(image); }
      const text = document.createElement('div');
      const overline = document.createElement('small'); overline.textContent = `队员 ${Number(value) + 1} · BUFF 配置`;
      const name = document.createElement('h2'); name.textContent = original.querySelector('.buff-check-member-name')?.textContent || '未选择角色';
      const hint = document.createElement('p'); hint.textContent = '管理该角色提供的全队增益，检查实际生效的 Buff。';
      text.append(overline, name, hint); hero.append(text);
    }
    setView(page, view);
  }
  function sync() {
    const page = root.querySelector('.buff-check-page');
    if (!page) return;
    page.querySelectorAll('.stat-item').forEach(row=>{
      if(!row.querySelector('.local-stat-stack'))return;
      row.querySelectorAll('.stack-count').forEach(prefix=>{const next=prefix.nextSibling;if(next?.nodeType===Node.TEXT_NODE)next.textContent=next.textContent.replace(/^→/,'');prefix.remove();});
      row.querySelectorAll('.stat-item-value').forEach(value=>{const walker=document.createTreeWalker(value,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const text=node.textContent.replace(/^\d+(?:\.\d+)?层→/,'');if(text!==node.textContent)node.textContent=text;}});
    });
    if(page.querySelector('.local-buff-member-tabs'))return;
    const section = page.querySelector('.buff-check-personal-section');
    const team = page.querySelector('.buff-check-team-card');
    const panels = [...page.querySelectorAll('.buff-check-member-col')];
    if (!section || !team || !panels.length) return;
    const tabs = document.createElement('div'); tabs.className = 'local-buff-member-tabs';
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Buff 子页面');
    const entries = panels.map((panel, index) => ({ value: panel.dataset.setupMember, label: `队员 ${index + 1}`, name: panel.querySelector('.buff-check-member-name')?.textContent || `角色${index + 1}`, avatar: panel.querySelector('.buff-check-member-avatar img')?.src }));
    entries.forEach((entry, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'local-buff-member-tab'; button.dataset.member = entry.value;
      button.id = `local-buff-tab-${entry.value}`; button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', entry.value === 'environment' ? 'local-buff-environment' : 'local-buff-workspace');
      if (entry.avatar) { const image = document.createElement('img'); image.src = entry.avatar; image.alt = ''; button.append(image); }
      const caption = document.createElement('span');
      const label = document.createElement('small'); label.textContent = entry.label;
      const name = document.createElement('strong'); name.textContent = entry.name;
      caption.append(label, name); button.append(caption);
      button.classList.add('local-team-card');
      const portrait = window.__WC?.localCharacterBackground?.(entry.name);
      if (portrait) { const image = document.createElement('img'); image.className = 'local-team-portrait'; image.src = portrait; image.alt = ''; button.prepend(image); }
      const sharedMarkup = window.__WC?.localTeamCardMarkup?.[index];
      if (sharedMarkup) button.innerHTML = sharedMarkup;
      button.addEventListener('click', () => activate(page, entry.value));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + entries.length) % entries.length;
        activate(page, entries[target].value, true);
      });
      tabs.append(button);
    });
    const workspace = document.createElement('section'); workspace.id = 'local-buff-workspace'; workspace.className = 'local-buff-workspace'; workspace.setAttribute('role', 'tabpanel');
    const hero = document.createElement('header'); hero.className = 'local-buff-identity';
    workspace.append(hero, team, section); section.classList.add('local-buff-tabbed');
    const heading = team.querySelector('.buff-check-team-title'); if (heading) heading.textContent = '提供的全队 Buff';
    const sourceTitle = team.querySelector('.buff-check-source-head .setup-sec-title'); if (sourceTitle) sourceTitle.textContent = '公共来源管理';
    const env = document.createElement('section'); env.id = 'local-buff-environment'; env.className = 'local-buff-environment'; env.setAttribute('role', 'tabpanel'); env.setAttribute('aria-labelledby', 'local-buff-tab-environment');
    env.innerHTML = '<div class="local-env-label">战斗环境</div><h2>环境 Buff</h2><p class="local-env-intro">统一管理游戏内的环境增益与特殊战斗条件。</p><div class="local-env-empty"><span aria-hidden="true">◇</span><h3>暂未配置环境</h3><p>后续将加入真实环境效果、适用成员与启用设置。</p><small>当前没有环境 Buff 参与计算</small></div>';
    page.classList.add('local-buff-subpages'); page.prepend(tabs); page.append(workspace, env);
    const views = document.createElement('nav'); views.className = 'local-buff-view-nav'; views.setAttribute('aria-label', '角色 Buff 视图');
    [['team','提供的全队 Buff'],['stats','个人 Buff 统计'],['environment','环境 Buff']].forEach(([key,label]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.buffViewChoice = key;
      button.addEventListener('click', () => setView(page, key)); views.append(button);
    });
    tabs.after(views);
    makeWorksheet(page, panels);
    panels.forEach(panel => { const detail = panel.querySelector('.local-buff-details'); if (detail) detail.open = true; });
    activate(page, selected);
  }
  new MutationObserver(sync).observe(root, { childList: true, subtree: true }); sync();
})();
