(function () {
  'use strict';
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
  const engine = $('engine'), single = $('single');
  const directEntry = params.get('direct') === '1' && !!params.get('code');
  let ready, detail, code = '', variants = [], selected = '', kind = params.get('type') === 'single' ? 'single' : 'team';
  let busy = false, loaded = false, singleLoaded = false, revision = 0, personal = new Set();
  let pendingBack = false, preparedKey = '';
  function preparation(message, error = false) {
    $('engine-status').textContent = message;
    $('engine-status').style.color = error ? '#ffb6af' : '';
  }
  async function deadline(promise, ms, message) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]); }
    finally { clearTimeout(timer); }
  }
  function resetEngine() {
    stopFit(); stopFit = () => {}; ready = null; preparedKey = ''; singleLoaded = false;
    engine.removeAttribute('src'); single.removeAttribute('src');
  }
  async function prepareSelection() {
    if (preparedKey === code + ':' + selected) return;
    try {
      await engineReady();
      preparation('正在载入所选配置并计算预览…');
      if (directEntry) $('direct-message').textContent = '正在载入所选配置并计算卡片预览…';
      await deadline(loadVariant(selected), 45000, '配置准备超时，请重试；也可以先前往方案库。');
      preparedKey = code + ':' + selected;
      preparation('计算模块已就绪。');
    } catch (error) { resetEngine(); loaded = !!detail; throw error; }
  }
  const portraitElements = new Map();
  let stopFit = () => {};
  const W = () => engine.contentWindow.__WC;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const clone = value => JSON.parse(JSON.stringify(value));
  function lock(value) {
    busy = value;
    for (const node of document.querySelectorAll('#search,#variant,#make,#import-team,[data-kind],[data-import],#back')) node.disabled = value;
    if (!value && pendingBack) { pendingBack = false; queueMicrotask(() => { void back(); }); }
  }
  async function engineReady() {
    if (ready) return ready;
    ready = (async () => {
      engine.src = '/?cardStudio=1&m=1';
      const start = Date.now();
      let observedBoot, bootDone = false, bootError;
      preparation('正在后台加载计算模块，可以先选择档位和卡型。');
      while (Date.now() - start < 90000) {
        await wait(100);
        const api = W();
        if (Date.now() - start > 15000 && !api?.MobileStudioBoot)
          preparation('计算资源仍在下载，首次打开可能较慢；方案和卡型可以先选。');
        if (api?.MobileStudioIsolation?.error) throw Error(api.MobileStudioIsolation.error);
        if (!api?.MobileStudioBoot || !api?.CharacterCard || !api?.EchoImport) continue;
        if (observedBoot !== api.MobileStudioBoot) {
          observedBoot = api.MobileStudioBoot;
          Promise.resolve(observedBoot).then(() => { bootDone = true; }, error => { bootError = error; });
        }
        if (bootError) throw bootError;
        if (!bootDone || api.state._bootReconciling) {
          preparation('正在准备角色与声骸资料，可以先选择档位和卡型。');
          continue;
        }
        const doc = engine.contentDocument;
        for (const child of doc.body.children) if (!['SCRIPT','STYLE','LINK'].includes(child.tagName)) child.setAttribute('data-studio-shell-hidden', '');
        const style = doc.createElement('style');
        style.textContent = `[data-studio-shell-hidden]{display:none!important}html,body{margin:0!important;background:#11191f!important;min-width:0!important}body{padding:0!important}body:before,body:after{display:none!important}.export-card-maker-overlay{position:fixed!important;inset:0!important;padding:0!important}.export-card-maker-dialog{width:100%!important;max-width:none!important;height:100dvh!important;max-height:100dvh!important;border:0!important;border-radius:0!important}.export-card-maker-head,.export-card-maker-echobar{display:none!important}.export-card-maker-body{padding:12px!important}.export-card-maker-hint{font-size:12px!important}.export-card-maker-foot [data-close-export-card-maker]{display:none!important}.export-card-maker-foot{padding-bottom:max(12px,env(safe-area-inset-bottom))!important}.export-card-maker-preview{overflow:auto!important}.eki-modal{max-height:100dvh!important}.eki-body{overscroll-behavior:contain}button,input,select{min-height:44px}input,select{font-size:16px!important}`;
        doc.head.appendChild(style);
        api.MobileStudioDownload = saveImage;
        const defaultArt = api.getExportCardDefaultArt;
        // Public Lily wallpaper verified in the approved 2026-10-23 release.
        api.getExportCardDefaultArt = index => defaultArt(index) || (String(api.state.members[index]?.characterId) === '1512' ? 'assets/config-ui/%E8%8E%89%E8%8E%89.webp?v=54fe4866f4' : '');
        api.MobileStudioArtPosition = index => String(api.state.members[index]?.characterId) === '1512' ? [.7,.6] : null;
        style.textContent += '[data-ecard-crop-viewport]{touch-action:none!important}';
        // Close inside existing dialogs returns to the studio; the outer page owns navigation.
        doc.addEventListener('click', event => {
          if (event.target.closest('[data-close-export-card-maker]')) { event.preventDefault(); event.stopImmediatePropagation(); void back(); }
          if (event.target.closest('[data-export-card-png]')) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (busy) return;
            lock(true); $('editor-status').textContent = '正在生成图片，请稍候…';
            void api.MobileCardMaker.export().catch(error => { $('editor-status').textContent = error.message; })
              .finally(() => { lock(false); if ($('image-result').open) $('editor-status').textContent = ''; });
          }
        }, true);
        preparation('计算模块已就绪，点击制作即可载入所选配置。');
        if (loaded && !busy) roster(preparedKey !== code + ':' + selected);
        return api;
      }
      throw Error('计算模块加载超时，请检查网络后重试');
    })().catch(error => { resetEngine(); preparation(error.message + '，点击制作可重试。', true); throw error; });
    return ready;
  }
  function readCode(value) {
    const match = String(value || '').trim().match(/(?:^|[^A-Z0-9])(MC-[A-Z0-9]{6})(?![A-Z0-9])/i);
    return match ? match[1].toUpperCase() : '';
  }
  function shareLink() {
    const url = new URL('https://wuwacalc.cn/mobile-card-studio.html');
    url.searchParams.set('code', code);
    if (selected) url.searchParams.set('config', selected);
    url.searchParams.set('type', kind);
    if (kind === 'single') url.searchParams.set('member', $('member-select').value || '0');
    if (directEntry) url.searchParams.set('direct', '1');
    return url.href;
  }
  function updateLink() { if (code && loaded) history.replaceState(null, '', shareLink().replace('https://wuwacalc.cn', location.origin)); }
  function setKind(next) {
    kind = next;
    for (const button of document.querySelectorAll('[data-kind]')) button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
    $('member-label').hidden = $('member-select').hidden = kind !== 'single';
    $('make').textContent = kind === 'single' ? '预览并制作单角色卡片' : '预览并制作全队卡片';
    updateLink();
  }
  function roster(preview = false) {
    const api = W(); let resolved;
    try { resolved = preview ? previewMembers() : null; } catch (error) { preparation(error.message, true); }
    const sourceMembers = resolved || detail?.payload?.data?.members || [];
    const summary = detail?.summary || detail?.payload?.meta?.summary || {};
    const list = preview ? sourceMembers.map((member,index) => ({index, id:member.characterId, name:member.name || summary.memberNames?.[index] || '角色 ' + (index+1)})) : api.CharacterCard.members();
    const requested = $('member-select').value || params.get('member');
    $('members').replaceChildren(); $('member-select').replaceChildren(); $('import-members').replaceChildren();
    list.forEach(member => {
      const source = preview ? sourceMembers[member.index] : api.state.members[member.index];
      const tile = document.createElement('div'); tile.className = 'member';
      let avatar = portraitElements.get(String(member.id));
      if (!avatar) { avatar = document.createElement('img'); avatar.alt = member.name;
      avatar.src = api?.getCharPortraitUrl?.(api.findCharSkillDef?.(member.id)) || (String(member.id) === '1512' ? '/assets/config-ui/%E8%8E%89%E8%8E%89.webp?v=54fe4866f4' : '/assets/characters/' + encodeURIComponent(member.id) + '.webp?v=20260928');
      avatar.onerror = () => { avatar.onerror = null; const fallback = document.createElement('span'); fallback.className = 'avatar-fallback'; fallback.textContent = member.name.slice(0,1); avatar.replaceWith(fallback); portraitElements.set(String(member.id),fallback); }; portraitElements.set(String(member.id),avatar); }
      const resolvedAvatar = api?.getCharPortraitUrl?.(api.findCharSkillDef?.(member.id));
      if (avatar.tagName === 'IMG' && resolvedAvatar && avatar.getAttribute('src') !== resolvedAvatar && avatar.dataset.pendingSource !== resolvedAvatar) {
        avatar.dataset.pendingSource = resolvedAvatar; const decoded = new Image(); decoded.onload = () => { avatar.src = resolvedAvatar; }; decoded.src = resolvedAvatar;
      }
      tile.append(avatar);
      const name = document.createElement('b'); name.textContent = member.name;
      const chosen = preview && variants.find(item => item.key === selected)?.memberConfigs?.[member.index]?.match(/^(\d+)\+(\d+)$/);
      const config = document.createElement('small'); config.textContent = `${chosen ? chosen[1] : source.resonanceUnlocked ?? 0} 链 · 精 ${chosen ? chosen[2] : source.weaponSelection?.refinement ?? 1}`;
      const equipment = document.createElement('small'); equipment.className = 'member-equipment';
      equipment.textContent = preview && !resolved ? '武器与套装资料加载中…' : equipmentText(source);
      tile.append(name, config, equipment); $('members').append(tile);
      const option = new Option(member.name, member.index); $('member-select').add(option);
      const row = document.createElement('div'); row.className = 'import-row';
      const label = document.createElement('span'); label.textContent = member.name;
      const button = document.createElement('button'); button.dataset.import = member.index; button.textContent = personal.has(member.index) ? '重新导入声骸' : '从库街区导入';
      const info = document.createElement('small'); info.className = 'equipment-note';
      info.textContent = preview && !resolved ? '武器与套装要求：计算资料就绪后显示' : equipmentText(source);
      label.append(info); row.append(label, button); $('import-members').append(row);
    });
    if (list.some(member => String(member.index) === requested)) $('member-select').value = requested;
    $('build-note').textContent = personal.size ? '已替换 ' + personal.size + ' 名角色的声骸和武器精炼；等级、技能和共鸣链仍使用方案。' : '当前使用原方案配装。';
  }
  async function closeMaker() {
    const api = W(); if (!api) return;
    stopFit(); stopFit = () => {};
    engine.contentDocument.querySelector('[data-ecard-crop-cancel]')?.click();
    engine.contentDocument.querySelector('[data-art-action="close"]')?.click();
    if (api.MobileCardMaker) { await api.MobileCardMaker.close(); api.MobileCardMaker = null; }
    api.CharacterCard.cancel();
    while (api.CharacterCard.isBusy()) await wait(50);
    api.EchoImport.close();
  }
  function preparePrivatePreview() {
    const api = W();
    // Restored legacy inputs may normalize panel/buff defaults during computeAll.
    // Finish that existing normalization before exposing a preview or score.
    for (let pass = 0; pass < 4; pass++) {
      const before = api.echoFingerprintState();
      api.computeAll();
      if (before === api.echoFingerprintState()) return;
    }
    throw Error('该配置尚未完成计算准备，请重新载入后再制作');
  }
  async function loadVariant(value) {
    const api = W();
    await closeMaker();
    loaded = false;
    const parsed = api.parseSchemeImport(clone(detail.payload));
    const variant = variants.find(item => item.key === value);
    if (value && !variant) throw Error('链接中的配置档不存在，请重新选择');
    await api.importWorkspaceFromData(parsed.data, { name: detail.title || code, shareCode: code, description: detail.description || '' }, { axis:true, build:true, buff:true }, variant?.memberConfigs);
    // A saved summary is not a per-skill trace. Recalculate only this isolated
    // copy with the production engine; never alter or re-save the public record.
    api.configRecords.leave();
    preparePrivatePreview();
    if (W() !== api) throw Error('制作空间已重置，请重试');
    const summary = detail.summary || detail.payload.meta?.summary || {}, author = detail.profiles || {};
    api.state.exportCardDraft.shareCode = code;
    api.state.exportCardDraft.axisName = summary.axisName || parsed.data.exportCardDraft?.axisName || detail.title || code;
    api.state.exportCardMakerArt = ['', '', ''];
    api.cardExportAttribution = { personal:false, author:{ name:author.display_name || author.nickname || author.name || '原作者未署名', avatar:author.avatar_data_url || author.avatar_url || '', uid:author.game_uid || author.kuro_uid || '' } };
    selected = value; personal.clear(); revision++; singleLoaded = false; single.removeAttribute('src');
    loaded = true; roster(); updateLink();
  }
  async function search(event) {
    event?.preventDefault(); if (busy) return;
    const next = readCode($('scheme-code').value);
    if (!next) { status('请输入 MC- 开头的完整方案码，也可以粘贴含方案码的链接。', true); return; }
    lock(true); status('正在查询方案…'); loaded = false; preparedKey = '';
    preparation('');
    $('scheme-panel').hidden = $('make-panel').hidden = true;
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      let found;
      try {
        const response = await fetch('/api/schemes/' + encodeURIComponent(next), { signal:controller.signal, credentials:'omit' });
        if (!response.ok) throw Error(response.status === 404 || response.status === 403 ? '未找到可用方案，可能已下架或无公开权限' : '方案查询失败，请稍后重试');
        found = await response.json();
      } catch (error) { if (error.name === 'AbortError') throw Error('方案查询超时，请重新搜索或前往方案库'); throw error; }
      finally { clearTimeout(timer); }
      if (!found?.payload) throw Error('未找到可用方案，可能已下架或无公开权限');
      if (!Array.isArray(found.payload.data?.members) || !found.payload.data.members.length) throw Error('这份方案缺少完整队伍配置，暂时无法出图');
      detail = found; code = next;
      variants = (found.summary?.configVariants || found.payload.meta?.summary?.configVariants || []).filter(item => Array.isArray(item.memberConfigs)).map((item,index) => ({ ...item, key:item.memberConfigs.join(','), label:item.label || item.name || ('配置 ' + (index+1) + ' · ' + item.memberConfigs.join(' / ')) }));
      // Keep the canonical record keys. Duplicate matches are rejected by the shared importer.
      variants = variants.filter((item,index) => variants.findIndex(other => other.key === item.key) === index);
      $('variant').replaceChildren(new Option('方案当前配置', ''));
      for (const variant of variants) $('variant').add(new Option(variant.label, variant.key));
      const desired = params.get('code')?.toUpperCase() === code ? params.get('config') || '' : '';
      if (directEntry && desired && !variants.some(item => item.key === desired)) throw Error('链接中的配置档已不可用，请返回方案重新选择配置。');
      $('variant').value = variants.some(item => item.key === desired) ? desired : '';
      selected = $('variant').value; personal.clear(); loaded = true;
      roster(true); updateLink();
      $('source-title').textContent = found.title || code; $('source-code').textContent = code;
      const author = found.profiles || {};
      $('source-author').textContent = '原方案作者 · ' + (author.display_name || author.nickname || author.name || '原作者未署名');
      $('scheme-panel').hidden = $('make-panel').hidden = false;
      status(desired && desired !== selected ? '链接中的档位已不可用，当前显示方案配置，请重新选择。' : '方案已就绪，选择卡型开始制作。');
      $('scheme-code').value = code; $('scheme-code').blur();
      void engineReady().catch(() => {});
    } catch (error) { loaded = false; detail = null; status(error.message || '加载失败，请稍后重试', true); }
    finally { lock(false); }
  }
  function showEditor(title) {
    if (!embedded && $('editor').hidden && !history.state?.cardStudioEditor) history.pushState({cardStudioEditor:true}, '', location.href.split('#')[0] + '#edit');
    $('editor-title').textContent = title; $('editor-status').textContent = '';
    $('editor').hidden = false; $('studio-main').inert = true; document.body.classList.add('editing');
  }
  function fitTeam() {
    const doc = engine.contentDocument, host = doc.querySelector('.export-card-maker-overlay [data-export-card-preview]');
    if (!host) return;
    const toolbar = doc.createElement('div'), button = doc.createElement('button');
    toolbar.style.cssText = 'display:flex;justify-content:flex-end;margin:8px 0';
    button.className = 'btn sm'; button.textContent = '放大查看'; toolbar.append(button); host.before(toolbar);
    let enlarged = false;
    const fit = () => {
      const card = host.querySelector('#exportDataCard'); if (!card || !host.clientWidth) return;
      const width = W().EXPORT_CARD_PIXEL_SIZE.w;
      card.style.setProperty('width',width+'px','important');
      card.style.setProperty('height','auto','important');
      card.style.setProperty('min-height','1120px','important');
      const height = card.offsetHeight;
      const scale = enlarged ? 1 : Math.min(1, host.clientWidth / width);
      host.style.setProperty('display','block','important'); host.style.setProperty('position','relative','important');
      host.style.setProperty('padding','0','important'); host.style.setProperty('min-height','0','important');
      host.style.setProperty('height',(enlarged ? Math.min(height, engine.contentWindow.innerHeight * .7) : height * scale) + 'px','important');
      host.style.setProperty('overflow',enlarged ? 'auto' : 'hidden','important');
      for (const [key,value] of Object.entries({'max-width':'none',position:'absolute',left:'0',top:'0',margin:'0',transform:'scale('+scale+')','transform-origin':'top left'})) card.style.setProperty(key,value,'important');
      void W().MobileCardMaker?.syncIdentity();
    };
    button.onclick = () => { enlarged = !enlarged; button.textContent = enlarged ? '适合屏幕' : '放大查看'; host.scrollLeft = host.scrollTop = 0; fit(); };
    const observer = new MutationObserver(fit); observer.observe(host,{childList:true});
    const resize = new ResizeObserver(fit); resize.observe(host); fit();
    stopFit = () => { observer.disconnect(); resize.disconnect(); };
  }
  async function make() {
    if (busy || !loaded) return;
    lock(true);
    try {
      await prepareSelection();
      showEditor(kind === 'team' ? '全队卡片 · 调整与保存' : '单角色卡片 · 调整与保存');
      await closeMaker();
      engine.hidden = kind !== 'team'; single.hidden = kind !== 'single';
      if (kind === 'team') {
        W().openExportCardMakerModal();
        fitTeam();
        const hint = engine.contentDocument.querySelector('.export-card-maker-hint');
        if (hint) hint.textContent = '点击角色立绘，调整大小与位置或换成自己的图片。需要换声骸时返回设置。';
      } else if (!singleLoaded) {
        single.src = '/character-card.html?studio=1&member=' + encodeURIComponent($('member-select').value) + '&revision=' + revision;
        singleLoaded = true;
      } else {
        await single.contentWindow.__WC?.CharacterCardView?.selectMember(Number($('member-select').value));
      }
    } catch (error) { $('editor-status').textContent = error.message; preparation(error.message, true); }
    finally { lock(false); }
  }
  async function back() {
    if (busy) return; lock(true); $('editor-status').textContent = '正在结束计算并保留构图…';
    try { await closeMaker(); }
    finally { $('import-confirm').close(); $('image-result').close(); engine.hidden = single.hidden = $('editor').hidden = true; $('studio-main').inert = false; document.body.classList.remove('editing'); lock(false); $('make').focus(); if (!embedded && history.state?.cardStudioEditor) history.back(); }
  }
  function setSignature(config) {
    const api = W(), counts = new Map();
    for (const row of config?.setLoadout || []) if (row.setId && Number(row.count) > 0)
      counts.set(String(row.setId), (counts.get(String(row.setId)) || 0) + Number(row.count));
    return [...counts].flatMap(([id,count]) => {
      const def = api.findEchoSetDef(id);
      if (!def) throw Error('套装资料未就绪，暂不允许导入');
      return Object.keys(def.bonuses || {}).filter(tier => Number(tier) > 0 && Number(tier) <= count).map(tier => id + ':' + tier);
    }).sort().join('|');
  }
  function equipmentText(member) {
    const api = W(), weapon = api?.findWeaponDef?.(member.weaponSelection?.id);
    const sets = (member.echoConfig?.setLoadout || []).filter(row => row.setId && Number(row.count)>0)
      .map(row => (api?.findEchoSetDef?.(row.setId)?.name || '套装 ' + row.setId) + ' ×' + row.count).join(' + ');
    return '武器：' + (weapon?.name || '武器 ' + (member.weaponSelection?.id || '未指定')) + ' · 精 ' + (member.weaponSelection?.refinement || 1) + '\n套装：' + (sets || '未指定');
  }
  function previewMembers() {
    const api = W();
    if (!api?.schemePreviewMembers || api.state?._bootReconciling) return null;
    const variant = variants.find(item => item.key === selected);
    return api.schemePreviewMembers(clone(detail.payload), variant?.memberConfigs);
  }
  async function importEcho(index) {
    if (busy || !loaded) return;
    lock(true);
    try { await prepareSelection(); } catch (error) { preparation(error.message, true); return; } finally { lock(false); }
    showEditor(index == null ? '库街区 · 全队配装导入' : '库街区 · 角色配装导入'); single.hidden = true; engine.hidden = false;
    $('editor-status').textContent = '一次登录读取配装；仅同武器、同套装效果可应用，精炼与词条可不同。';
    const api = W(), currentRevision = revision;
    const indices = index == null ? api.state.members.map((_,i) => i) : [index];
    const expected = indices.map(i => ({index:i, member:api.state.members[i]}));
    api.EchoImport.open({ title:index == null ? '读取全队配装' : '读取「' + expected[0].member.name + '」配装',
      autoMatchCharacterIds:expected.map(row => row.member.characterId), onBatch:results => {
      if (currentRevision !== revision || api !== W()) return;
      const rows = expected.map(({index,member}) => {
        const matches = results.filter(result => String(result.characterId) === String(member.characterId));
        const result = matches.length === 1 ? matches[0] : {error:'角色读取结果缺失或重复'};
        let reason = result.error || '';
        if (!reason && String(result.weapon?.id) !== String(member.weaponSelection?.id)) reason = '武器不匹配';
        if (!reason) { try { if (setSignature(result.config) !== setSignature(member.echoConfig)) reason = '生效套装不匹配'; } catch (error) { reason = error.message; } }
        return {index, member, result, reason};
      });
      const accepted = rows.filter(row => !row.reason);
      $('import-title').textContent = '确认导入配装 · ' + accepted.length + ' / ' + rows.length + ' 可应用';
      $('import-summary').replaceChildren();
      for (const row of rows) {
        const item = document.createElement('div'); item.className = 'import-review';
        const title = document.createElement('strong'); title.textContent = row.member.name + ' · ' + (row.reason || '匹配，可导入');
        const required = document.createElement('p'); required.textContent = '方案要求\n' + equipmentText(row.member);
        const actual = document.createElement('p'); actual.textContent = row.result.weapon ? '当前配装\n' + equipmentText({weaponSelection:row.result.weapon,echoConfig:row.result.config}) : '当前配装：' + (row.result.error || '未完整读取');
        item.append(title,required,actual);
        if (row.reason) { const note = document.createElement('p'); note.textContent = '本角色不会导入。武器或套装不同，请先取得方案并自行修改 Buff 覆盖率，再制作数据卡。'; item.append(note); }
        $('import-summary').append(item);
      }
      $('import-apply').disabled = !accepted.length;
      $('import-apply').textContent = accepted.length ? '确认应用 ' + accepted.length + ' 名角色' : '无可匹配角色';
      $('import-confirm').showModal();
      $('import-apply').onclick = async () => {
        if (!accepted.length || busy) return;
        lock(true); $('import-apply').disabled = true;
        const snapshot = {members:clone(api.state.members),team:clone(api.state.team),specialSkills:clone(api.state.specialSkills),attribution:clone(api.cardExportAttribution),personal:new Set(personal)};
        try {
          if (currentRevision !== revision || api !== W()) throw Error('方案已改变，请重新读取');
          await closeMaker();
          for (const row of accepted) {
            const member = api.state.members[row.index];
            await api.applyWeaponSelectionToMember(member, member.weaponSelection.id, row.result.weapon.refinement, {silent:true});
            if (!api.applyPersonalEchoProfile(member, {id:'studio-kuro',chars:[{echoConfig:row.result.config}]})) throw Error('声骸应用失败');
            api.syncMemberEchoAcrossRounds?.(member);
            // This temporary space has no editable workbench panels to flush or save.
            api.syncEchoLoadout(member);
          }
          api.CardIdentity.usePersonal(); preparePrivatePreview();
          accepted.forEach(row => personal.add(row.index)); revision++;
          roster(); status('已应用 ' + accepted.length + ' 名角色的声骸和武器精炼；未匹配角色保留方案配置。');
        } catch (error) {
          api.state.members = snapshot.members; api.state.team = snapshot.team; api.state.specialSkills = snapshot.specialSkills;
          api.cardExportAttribution = snapshot.attribution; personal = snapshot.personal;
          preparePrivatePreview(); roster(); status('本次未应用，已保留原配装：' + error.message, true);
        } finally { $('import-confirm').close(); lock(false); await back(); }
      };
    } });
  }


  window.__WC = window.__WC || {};
  let imageUrl = '';
  function saveImage(image, name) {
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    if (typeof image === 'string' && !image.startsWith('data:image/png')) throw Error('图片格式不正确');
    imageUrl = typeof image === 'string' ? image : URL.createObjectURL(image);
    $('saved-image').src = imageUrl;
    $('save-file').href = imageUrl; $('save-file').download = String(name || '鸣算屋卡片.png').replace(/[\\/:*?"<>|]/g, '-');
    $('image-result').showModal();
  }
  window.__WC.MobileStudio = { characterCard:() => loaded ? {...W().CharacterCard,portraitPosition:index=>W().MobileStudioArtPosition(index)||[.5,.5]} : null, saveImage };
  $('close-image').onclick = () => $('image-result').close();
  $('search-form').addEventListener('submit', search);
  $('variant').onchange = () => {
    if (busy) return; selected = $('variant').value; preparedKey = ''; personal.clear();
    roster(true); updateLink(); status('已选择配置档，制作时载入该档完整数据。');
  };
  document.querySelectorAll('[data-kind]').forEach(button => button.onclick = () => { if (!busy) setKind(button.dataset.kind); });
  $('member-select').onchange = updateLink;
  $('make').onclick = make; $('back').onclick = back;
  $('import-team').onclick = () => { void importEcho(null); };
  $('import-members').onclick = event => { const button = event.target.closest('[data-import]'); if (button) void importEcho(Number(button.dataset.import)); };
  $('import-cancel').onclick = () => { $('import-confirm').close(); void back(); };
  $('import-confirm').addEventListener('cancel', () => { void back(); });
  $('copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(shareLink()); status('出图链接已复制，可以分享给朋友。'); }
    catch { status('请复制地址栏中的出图链接。'); }
  };
  window.addEventListener('pagehide', () => { W()?.MobileStudioIsolation?.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('popstate', () => { if (!$('editor').hidden) { if (busy) pendingBack = true; else void back(); } });
  // Same-origin phone details reuse the existing isolated studio, never the user's workspace.
  const embedded = params.get('embed') === '1';
  let entryReady = Promise.resolve(), renderedRevision = -1;
  function collectSchemeView() {
    const a = W(), s = a.state, num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
    const teamDuration = num(s.teamResults.axisDuration), special = s.specialSkills.results;
    function categories(member, cycle, index) {
      const totals = {}, add = (type, value) => { if (num(value)) totals[type || '未分类'] = (totals[type || '未分类'] || 0) + num(value); };
      if (cycle) {
        const snapshot = member.cycleConfig.rounds[index] || {}, skills = (snapshot.phases || []).flatMap(p => p.skills || []);
        for (const step of cycle.steps || []) {
          const skill = skills.find(x => step.skillId && x.id === step.skillId) || skills.find(x => step.catalogId && x.catalogId === step.catalogId) || (snapshot.rotationCatalog || []).find(x => x.id === step.catalogId);
          if (skill?.split && skill.hits?.length && step.hitBreakdowns?.length === skill.hits.length) step.hitBreakdowns.forEach((hit,j) => add(a.getUnitDamageType(skill.hits[j],skill),hit.total));
          else add(a.getUnitDamageType(skill || {},null),step.damage);
        }
      } else for (const phase of member.results.damagePhases || member.phases || []) for (const skill of phase.skills || []) {
        if (skill.split && skill.hits?.length) for (const hit of skill.hits) add(a.getUnitDamageType(hit,skill),hit._damage);
        else add(a.getUnitDamageType(skill,null),skill._damage);
      }
      return totals;
    }
    function echoDetails(m) { return (m.echoConfig?.slots || []).map((slot,index) => {
      const main = (a.ECHO_MAIN1_OPTIONS[slot.cost] || []).find(x => x.id === slot.main1), fixed = a.ECHO_MAIN2_FIXED[slot.cost];
      return {cost:slot.cost,name:slot.name || a.findEchoSpecimen(slot.echoId)?.name || '未指定声骸',id:slot.echoId || null,setId:slot.activeSetId || '',set:a.findEchoSetDef(slot.activeSetId)?.name || '未指定套装',main:index === m.echoConfig.mainSlotIndex,
        stats:[main ? {label:main.needsElement ? slot.main1Element+'伤害加成' : main.label,value:main.value,unit:main.unit === 'flat' ? '' : '%'} : null,!slot.noMain2 && fixed ? {label:fixed.label,value:fixed.value,unit:''} : null].filter(Boolean),
        subs:(slot.subs || []).map(sub => {const def=a.ECHO_SUB_AFFIXES[sub.id];return {label:sub.damageType ? sub.damageType+'伤害加成' : def?.label || sub.id,value:sub.value,unit:def?.unit === 'flat' ? '' : '%'};})};
    }); }
    const members=s.members.filter(m=>m.characterId).map(m=>({name:m.name,characterId:String(m.characterId),portrait:a.getCharPortraitUrl(a.findCharSkillDef(m.characterId)) || (String(m.characterId)==='1512'?'assets/config-ui/%E8%8E%89%E8%8E%89.webp?v=54fe4866f4':''),chain:m.resonanceUnlocked,refinement:m.weaponSelection.refinement,weaponName:a.findWeaponDef(m.weaponSelection.id)?.name || '未选择武器',sets:(m.echoConfig?.setLoadout || []).filter(x=>x.setId&&x.count).map(x=>(a.findEchoSetDef(x.setId)?.name || '未知套装')+' ×'+x.count).join(' + ') || '未指定套装',total:num(m.results.total),echoes:echoDetails(m)}));
    if (members.length !== s.members.length) throw Error('此方案含空角色位，完整数据暂不可用');
    const cycleMembers=s.members.filter(m=>m.results.cycleMode), count=cycleMembers[0]?.results.cycles.length || 1;
    const durations=cycleMembers.length ? (cycleMembers[0].cycleConfig.rounds || []).slice(0,count).map(r=>num(r.duration)) : [teamDuration];
    const sameRounds=(!cycleMembers.length || cycleMembers.length===s.members.length && cycleMembers.every(m=>m.results.cycles.length===count && durations.every((n,i)=>Math.abs(n-num(m.cycleConfig.rounds[i]?.duration))<.001))) && durations.length===count && Math.abs(durations.reduce((n,v)=>n+v,0)-teamDuration)<.01;
    const personalSpecial=members.map(()=>0), fullCategories=members.map(()=>({}));
    const roundCategories=s.members.map((m,j)=>{const cycles=m.results.cycleMode ? m.results.cycles : [null];return cycles.map((c,i)=>{const values=categories(m,c,i);for(const [key,value]of Object.entries(values))fullCategories[j][key]=(fullCategories[j][key]||0)+value;return values;});});
    const specialRounds=(special.cycles || []).map((c,i)=>{const own=members.map(()=>0);for(const item of c.items || []){const j=item.ownerIndex;if(!Number.isInteger(j)||j<0||j>=members.length)continue;const source=(s.members[j]?.cycleConfig?.rounds?.[i]?.specialSkills?.items || []).find(x=>x.id===item.id)||(s.specialSkills.items || []).find(x=>x.id===item.id);const type=source ? a.getSpecialSkillExportDamageTypeLabel(source) : '未分类',value=num(item.total);own[j]+=value;personalSpecial[j]+=value;fullCategories[j][type]=(fullCategories[j][type]||0)+value;if(roundCategories[j][i])roundCategories[j][i][type]=(roundCategories[j][i][type]||0)+value;}return {total:num(c.total),own};});
    const list=(map,total)=>{const values=Object.entries(map).filter(([,v])=>v>0).map(([type,total])=>({type,total}));return Math.abs(values.reduce((n,x)=>n+x.total,0)-total)<.1 ? values.sort((x,y)=>y.total-x.total) : [];};
    members.forEach((m,j)=>{m.specialTotal=personalSpecial[j];m.categories=list(fullCategories[j],m.total+m.specialTotal);});
    let rounds=[];
    if(sameRounds)rounds=durations.map((duration,i)=>{const normal=s.members.map(m=>num(m.results.cycleMode ? m.results.cycles[i]?.total : m.results.total)),sp=specialRounds[i]||{total:0,own:members.map(()=>0)},total=normal.reduce((n,v)=>n+v,0)+sp.total;return {axisDuration:duration,teamTotal:total,teamDps:duration?total/duration:0,members:normal,specialTotal:sp.total,specialByMember:sp.own,categoriesByMember:members.map((_,j)=>list(roundCategories[j][i]||{},normal[j]+sp.own[j]))};});
    if(Math.abs(rounds.reduce((n,x)=>n+x.teamTotal,0)-num(s.teamResults.total))>.1)rounds=[];
    return {key:selected,label:members.map(m=>m.chain+'+'+m.refinement).join(' · '),members,teamTotal:num(s.teamResults.total),teamDps:num(s.teamResults.dps),axisDuration:teamDuration,specialTotal:num(special.total),rounds,roundsUnavailable:rounds.length ? '' : '成员轮次或时长不一致，仅展示完整轴结果。',basis:'当前规则重算'};
  }
  window.__WC.MobileSchemeBridge = {
    ready: () => entryReady.then(() => {if(!loaded)throw Error($('status').textContent || '方案载入失败');return true;}),
    busy: () => busy,
    snapshot: async key => {
      await entryReady;if(!loaded)throw Error($('status').textContent || '方案载入失败');if(busy)throw Error('制作器正在处理，请稍后重试');
      if(key && !variants.some(v=>v.key===key))throw Error('所选配置已不可用，请重新打开方案');
      lock(true);try{if(selected!==key){selected=key;$('variant').value=key;preparedKey='';}await prepareSelection();return collectSchemeView();}finally{lock(false);}
    },
    make: async (type,index) => {
      await entryReady;if(busy)throw Error('制作器正在处理，请稍后重试');
      const next=type==='single'?'single':'team',member=String(index);
      if(renderedRevision===revision && !$('editor').hidden && kind===next && (next==='team'||$('member-select').value===member))return;
      setKind(next);if(next==='single'){if(!Array.from($('member-select').options).some(x=>x.value===member))throw Error('制作角色已不可用');$('member-select').value=member;}
      await make();if($('editor').hidden || $('editor-status').textContent)throw Error($('editor-status').textContent || $('engine-status').textContent || '制作预览未就绪');
      if(next==='single'){const expected=String(W().state.members[index].characterId),started=Date.now();let complete=false;while(Date.now()-started<45000){const view=single.contentWindow.__WC?.CharacterCardView,data=view?.getData();if(String(data?.character?.id)===expected&&view.getVisibleText().some(text=>text===data.character.name)){complete=true;break;}await wait(100);}if(!complete)throw Error('角色卡片加载超时，请重试');}
      renderedRevision = revision;
    }
  };

  setKind(kind);
  async function startDirect() {
    document.documentElement.setAttribute('data-direct-pending', '');
    $('direct-entry').hidden = false;
    $('direct-retry').hidden = true;
    $('direct-message').textContent = '正在载入分享方案，完成后直接进入卡片制作…';
    $('direct-title').textContent = kind === 'single' ? '正在打开单角色制作' : '正在打开全队制作';
    await search();
    if (loaded) {
      await make();
      if (!$('editor').hidden && !$('editor-status').textContent) { $('direct-entry').hidden = true; document.documentElement.removeAttribute('data-direct-pending'); return; }
    }
    const message = loaded ? ($('editor-status').textContent || $('engine-status').textContent || '请重试') : $('status').textContent;
    if (!$('editor').hidden) await back();
    $('direct-title').textContent = '暂时无法打开制作';
    $('direct-message').textContent = message;
    $('direct-retry').hidden = false;
  }
  $('direct-retry').onclick = () => { if (!busy) void startDirect(); };
  if (params.get('code')) { $('scheme-code').value = params.get('code'); if (directEntry) entryReady = startDirect(); else entryReady = search(); }
})();

