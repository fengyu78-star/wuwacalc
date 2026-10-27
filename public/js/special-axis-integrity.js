/* A round owns its axis links and special inputs; a missing input is never inferred from DPS. */
(() => {
  const W = window.__WC;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function collect(scope) {
    const catalogs = new Set(), specials = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.id === 'string') catalogs.add(value.id);
      if (typeof value.linkedSpecialSkillId === 'string') specials.add(value.linkedSpecialSkillId);
      for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
    }
    let complete = true;
    for (const member of scope) {
      if (!member || (!member.resonanceAxis && !Array.isArray(member.rotationCatalog))) { complete = false; continue; }
      // Dormant chain patches still own their explicit special inputs.
      visit(member.resonanceAxis || member.rotationCatalog);
    }
    return { catalogs, specials, complete };
  }

  function roundData(index) {
    const members = W.state.members || [], owner = W.getSpecialSkillsRoundOwner();
    const active = owner ? W.readActiveCycleRoundIndex(owner) : 0;
    const snapshots = members.map(m => m.cycleConfig?.enabled ? m.cycleConfig.rounds?.[index] : m);
    const scope = index === active ? members.map((m, mi) =>
      !m.cycleConfig?.enabled || W.readActiveCycleRoundIndex(m) === index ? m : snapshots[mi]) : snapshots;
    const special = index === active ? W.state.specialSkills : owner?.cycleConfig.rounds?.[index]?.specialSkills ||
      snapshots.find(m => m?.specialSkills)?.specialSkills;
    return { scope, snapshots, special };
  }

  function status(entry, memberIndex, index, special = roundData(index).special) {
    const matches = (special?.items || []).filter(item => item.id === entry.linkedSpecialSkillId);
    if (!entry.linkedSpecialSkillId) return 'independent';
    if (!matches.length) return 'missing';
    if (matches.length !== 1 || (matches[0].linkedCatalogId && matches[0].linkedCatalogId !== entry.id) ||
        (Number.isInteger(matches[0].sourceRosterSlot) && matches[0].sourceRosterSlot !== memberIndex)) return 'conflict';
    return 'complete';
  }

  function audit() {
    const members = W.state.members || [], owner = W.getSpecialSkillsRoundOwner();
    const count = owner ? Math.max(1, ...members.map(m => m.cycleConfig?.enabled ? m.cycleConfig.rounds?.length || 1 : 1)) : 1;
    const missing = [], orphaned = new Set();
    function inspect(ss, scope, index, primary = false) {
      if (!Array.isArray(ss?.items)) {
        if (!primary) return;
        ss = { items: [] };
      }
      const refs = collect(scope);
      const invalid = item => refs.complete && typeof item?.linkedCatalogId === 'string' && item.linkedCatalogId.length > 0 &&
        !refs.specials.has(item.id) && !refs.catalogs.has(item.linkedCatalogId);
      for (const item of ss.items) if (invalid(item)) {
        const key = `${index}:${item.id}`; orphaned.add(key);
        // A stale link is not evidence that this saved damage input was deleted.
      }
      if (!primary) return;
      scope.forEach((member, memberIndex) => {
        if (!member) return;
        const view = member.resonanceAxis ? W.buildResonanceAxisView(clone(member.resonanceAxis), 'damage') : member;
        for (const entry of view.rotationCatalog || []) {
          const reason = status(entry, memberIndex, index, ss);
          if (reason === 'missing' || reason === 'conflict') missing.push({ round: index + 1, memberIndex,
            member: members[memberIndex]?.name || `角色${memberIndex + 1}`, name: entry.name || '特殊技能',
            id: entry.linkedSpecialSkillId, catalogId: entry.id, baseMult: entry.baseMult, reason,
            canRebuild: reason === 'missing' && entry.damageType === '处决' && Number.isFinite(entry.baseMult) && Number(entry.multCount ?? 1) === 1 });
        }
      });
    }
    for (let index = 0; index < count; index++) {
      const { scope, snapshots, special } = roundData(index);
      inspect(special, scope, index, true);
      for (const member of snapshots) if (member?.specialSkills && member.specialSkills !== special)
        inspect(member.specialSkills, snapshots, index);
    }
    return { removed: 0, orphaned: orphaned.size, missing, cleaned: 0 };
  }

  function currentPending() {
    const owner = W.getSpecialSkillsRoundOwner(), index = owner ? W.readActiveCycleRoundIndex(owner) : 0;
    return audit().missing.filter(row => row.round === index + 1);
  }

  function syncRound(preserveInputs = false) {
    if (W.state._workspaceImporting || W.state._cfgV2Applying || W.configRecords.hold()) return;
    const owner = W.getSpecialSkillsRoundOwner();
    if (!owner?.cycleConfig?.enabled || !W.state.specialSkills) return;
    const copy = preserveInputs ? clone : W.cloneSpecialSkillsSnapshot;
    const index = W.readActiveCycleRoundIndex(owner), snapshot = copy(W.state.specialSkills);
    const targets = W.state.members.map(m => m.cycleConfig?.enabled ? m.cycleConfig.rounds?.[index] : null).filter(Boolean);
    // Prepare every clone before changing any same-round copy.
    const copies = targets.map(() => copy(snapshot));
    targets.forEach((round, i) => { round.specialSkills = copies[i]; });
  }

  function assertComplete() {
    const report = audit();
    if (report.missing.length) throw new Error('特殊技能与轨道尚未完整对应，请先处理特殊技能页的待恢复或冲突条目；未保存或覆盖配置。');
  }

  function chipState(entry, memberIndex) {
    const m = W.state.members[memberIndex], index = m?.cycleConfig?.enabled ? W.readActiveCycleRoundIndex(m) : 0;
    return status(entry, memberIndex, index);
  }

  function counts(memberIndex) {
    const m = W.state.members[memberIndex], index = m?.cycleConfig?.enabled ? W.readActiveCycleRoundIndex(m) : 0;
    const { scope, special } = roundData(index);
    const view = scope[memberIndex]?.resonanceAxis ? W.buildResonanceAxisView(clone(scope[memberIndex].resonanceAxis), 'damage') : scope[memberIndex];
    const entries = view?.rotationCatalog || [];
    const ownerOf = item => Number.isInteger(item.sourceRosterSlot) ? item.sourceRosterSlot :
      (special?.characters || []).findIndex(character => character.id === item.characterId);
    const valid = (special?.items || []).filter(item => ownerOf(item) === memberIndex);
    const results = special?.results?.cycles?.[index]?.items || special?.results?.items || [];
    return { calculated: valid.filter(item => results.some(result => result.id === item.id)).length,
      pending: entries.filter(entry => ['missing', 'conflict'].includes(status(entry, memberIndex, index, special))).length };
  }

  function renderPending(row) {
    const e = W.escapeHtml;
    const existing = independentInputs(row);
    if (existing.length) return `<div class="hint" data-special-pending="${e(row.id)}" role="status">
      <p>第 ${row.round} 轮轨道「${e(row.name)}」尚未关联；本轮已有处决及其原 Buff 均已保留。核对后关联已有输入，不新增伤害。</p>
      ${existing.map((item, i) => `<button type="button" data-rebuild-axis-special="${e(row.catalogId)}" data-special-member="${row.memberIndex}" data-special-round="${row.round}" data-existing-special="${e(item.id)}">关联已有${e(item.name)}${existing.length > 1 ? ' ' + (i + 1) : ''}</button>`).join('')}
    </div>`;
    return `<div class="special-skill-card sc-row" data-special-pending="${e(row.id)}" role="status">
      <div class="sc-row-line"><span class="sc-name">${e(row.name)}</span><span class="sc-cell">待恢复</span>
      <span class="sc-cell">${Number.isFinite(row.baseMult) ? e(row.baseMult) + '%' : '未保存'}</span><span class="sc-cell">—</span><span class="sc-cell">—</span>
      <span class="sc-na">${row.reason === 'missing' ? '未计伤' : '待核对'}</span><div class="sc-actions">${row.canRebuild ? `${existing.map((item, i) => `<button type="button" data-rebuild-axis-special="${e(row.catalogId)}" data-special-member="${row.memberIndex}" data-special-round="${row.round}" data-existing-special="${e(item.id)}">关联已有${e(item.name)}${existing.length > 1 ? ' ' + (i + 1) : ''}</button>`).join('')}<button type="button" data-rebuild-axis-special="${e(row.catalogId)}" data-special-member="${row.memberIndex}" data-special-round="${row.round}">核对并重建</button>` : '关联冲突，请核对'}</div></div>
      <p class="hint">第 ${row.round} 轮轨道已保留。${row.reason === 'missing' ? (existing.length ? '本轮有已保存的处决输入，原 Buff 已保留。可核对后关联已有处决，关联不会新增伤害。' : '未找到与这条轨道对应的完整输入。请核对原档，确认重建前不为此轨道新增伤害。') : '轨道与特殊技能的对应关系冲突，未自动替换。'}</p></div>`;
  }

  function archivedInput(row) {
    const { snapshots, special } = roundData(row.round - 1);
    const candidates = snapshots.map(member => member?.specialSkills).filter(snapshot => snapshot &&
      JSON.stringify(snapshot.characters) === JSON.stringify(special?.characters)).flatMap(snapshot =>
      (snapshot.items || []).filter(item => item.id === row.id && item.linkedCatalogId === row.catalogId &&
        item.sourceRosterSlot === row.memberIndex));
    const input = item => { const copy = clone(item); delete copy._damage; return copy; };
    return candidates.length && candidates.every(item => JSON.stringify(input(item)) === JSON.stringify(input(candidates[0])))
      ? input(candidates[0]) : null;
  }

  function independentInputs(row) {
    if (!row.canRebuild) return [];
    const { scope, special } = roundData(row.round - 1), refs = collect(scope);
    return (special?.items || []).filter(item => item.kind === 'execution' &&
      (!item.linkedCatalogId || !refs.catalogs.has(item.linkedCatalogId)) &&
      !refs.specials.has(item.id) && item.sourceRosterSlot === row.memberIndex && item.baseMult === row.baseMult);
  }

  function writeReferenceRound(member) {
    const index = member.cycleConfig?.enabled ? W.readActiveCycleRoundIndex(member) : 0;
    const round = member.cycleConfig?.rounds?.[index];
    if (round) {
      round.rotationCatalog = clone(member.rotationCatalog);
      round.resonanceAxis = clone(member.resonanceAxis);
    }
    syncRound(true);
  }

  function restoreReferenceSnapshot(member, snap) {
    const preserve = W.configRecords.hold() && !!snap.axisReferenceView;
    W.configRecords.view = null; delete W.state.configRecordView;
    if (member.cycleConfig?.enabled && snap.roundIndex !== W.readActiveCycleRoundIndex(member)) {
      const round = member.cycleConfig.rounds?.[snap.roundIndex];
      if (!round) return false;
      member.cycleConfig.activeRound = snap.roundIndex;
      for (const key of ['char','rotationCatalog','phases','resonanceAxis','buffs','globalBuffActive','globalBuffStacks','effectHintExtras'])
        if (round[key] !== undefined) member[key] = clone(round[key]);
      W.state.specialSkills = clone(round.specialSkills);
    }
    const ids = new Set([...(member.rotationCatalog || []), ...snap.rotationCatalog].map(entry => entry.linkedSpecialSkillId).filter(Boolean));
    member.rotationCatalog = clone(snap.rotationCatalog); member.phases = clone(snap.phases);
    member.resonanceAxis = clone(snap.resonanceAxis);
    W.state.specialSkills.items = W.state.specialSkills.items.filter(item => !ids.has(item.id));
    W.state.specialSkills.items.push(...clone(snap.axisSpecialItems));
    if (preserve) W.state.specialSkills.results = clone(snap.axisReferenceResults);
    W.state.team.activeIndex = W.state.members.indexOf(member);
    writeReferenceRound(member);
    if (preserve) W.configRecords.bind(snap.axisReferenceView);
    return true;
  }

  async function rebuild(memberIndex, catalogId, round, existingId) {
    const pending = currentPending().find(row => row.memberIndex === memberIndex && row.catalogId === catalogId && row.round === round);
    if (!pending?.canRebuild) throw new Error('该轮关联已变化，请重新核对后操作。');
    const generation = W.configWorkspaceOperation.generation, members = W.state.members, archived = archivedInput(pending);
    const existing = existingId ? independentInputs(pending).find(item => item.id === existingId) : null;
    if (existingId && !existing) throw new Error('本轮已有处决已变化，请重新核对。');
    const confirmed = await W.showConfirmModal({ title: existing ? `关联第 ${round} 轮已有处决` : `重建第 ${round} 轮「${pending.name}」`,
      description: existing ? `将原轨道关联到本轮已有的「${existing.name}」（${existing.baseMult}%，${existing.buffMode === 'custom' ? '自定义 Buff 覆盖' : '继承角色全局 Buff'}）。保留该条目的原参数、Buff 和锁定设置，轨道位置不变，不新增一次处决伤害。原保存行不会自动覆盖。` : archived ? `找到同轮次、同关联编号的完整输入，将恢复该条目的原 Buff 覆盖和锁定设置，保留原轨道位置。确认后按当前规则计算，原保存行不会自动覆盖。` :
        `原轨道、位置和 ${pending.baseMult}% 倍率保留。原 Buff 覆盖未保存，将重新创建这一项，并继承第 ${round} 轮${pending.member}的全局 Buff。\n确认后按当前规则计算；如原来使用自定义覆盖，请在展开的 Buff 设置中核对。原保存行不会自动覆盖。`,
      confirmText: existing ? '关联已有处决' : archived ? '恢复同轮完整输入' : '按本轮全局 Buff 重建', cancelText: '暂不重建' });
    if (!confirmed) return false;
    if (generation !== W.configWorkspaceOperation.generation || members !== W.state.members ||
        !currentPending().some(row => row.memberIndex === memberIndex && row.catalogId === catalogId && row.round === round))
      throw new Error('工作台或轮次已变化，未重建。');
    const original = W.configRecords.snapshotState(), memberId = members[memberIndex].id;
    const undoBefore = [...(W.editUndoStacks.get(memberId) || [])];
    try {
      for (const key of ['team', 'members', 'specialSkills', 'teamResults']) W.state[key] = clone(W.state[key]);
      if (existing) { W.configRecords.view = null; delete W.state.configRecordView; }
      else W.configRecords.leave();
      const member = W.state.members[memberIndex], entry = member.rotationCatalog.find(item => item.id === catalogId);
      if (!entry || (member.cycleConfig?.enabled && W.readActiveCycleRoundIndex(member) !== round - 1) ||
          entry.linkedSpecialSkillId !== pending.id || chipState(entry, memberIndex) !== 'missing') throw new Error('关联已变化，未重建。');
      W.state.team.activeIndex = memberIndex;
      W.pushEditUndo(member, `重建特殊技能「${pending.name}」`, { includeResonanceAxis: true });
      const selected = existingId ? independentInputs(pending).find(item => item.id === existingId) : null;
      if (existingId && !selected) throw new Error('已有处决已变化，未关联。');
      if (selected) {
        const snapshot = W.peekEditUndo(member).snapshot;
        snapshot.axisSpecialItems.push(clone(selected));
        snapshot.axisReferenceOnly = true;
        snapshot.axisReferenceView = original.values.configRecordView ? clone(original.values.configRecordView) : null;
        snapshot.axisReferenceResults = clone(W.state.specialSkills.results);
        W.persistEditUndoStacks();
      }
      W.state.specialSkills.activeCharacterIndex = memberIndex;
      if (!selected) W.ensureSpecialSkillsState();
      const character = W.state.specialSkills.characters[memberIndex];
      if (!character?.id) throw new Error('本轮角色 Buff 来源缺失，未重建。');
      const item = selected || archived || Object.assign(W.createSpecialSkillDefaults('execution'), { id: pending.id,
        name: entry.name, baseMult: entry.baseMult, characterId: character.id,
        sourceRosterSlot: memberIndex, linkedCatalogId: entry.id });
      item.expanded = true;
      if (selected) {
        item.linkedCatalogId = entry.id; entry.linkedSpecialSkillId = item.id;
        function update(value) {
          if (!value || typeof value !== 'object') return;
          if (value.id === entry.id && value.linkedSpecialSkillId === pending.id) value.linkedSpecialSkillId = item.id;
          Object.values(value).forEach(child => { if (child && typeof child === 'object') update(child); });
        }
        update(member.resonanceAxis);
      }
      else W.state.specialSkills.items.push(item);
      if (selected) {
        writeReferenceRound(member);
        if (original.values.configRecordView) W.configRecords.bind(original.values.configRecordView);
      } else { W.persistCycleEditingIfEnabled(member); W.computeAll(); }
      if (chipState(entry, memberIndex) !== 'complete') throw new Error('关联校验未通过，已保留原配置。');
      W.renderMain(undefined, selected ? { skipCompute: true, viewOnly: true } : undefined); W.refreshUndoUi(); W.scheduleSave();
      return true;
    } catch (error) {
      W.configRecords.restoreState(original);
      W.editUndoStacks.set(memberId, undoBefore); W.persistEditUndoStacks();
      throw error;
    }
  }

  function renderNotice() {
    const report = audit(), lines = [];
    if (report.orphaned) lines.push(`有 ${report.orphaned} 条已保存的特殊技能未找到对应轨道，已保留其原始输入与 Buff；关联情况需要核对，程序不会因此自动删除。`);
    for (const row of report.missing) lines.push(`第 ${row.round} 轮：${row.member}的「${row.name}」${row.reason === 'conflict' ? '关联冲突' : independentInputs(row).length ? '尚未关联到本轮已有处决输入' : '未找到对应的特殊技能输入'}，请在特殊技能页核对${row.canRebuild ? '并重建' : ''}。${W.configRecords.hold() ? '当前保留历史保存结果。' : row.reason === 'missing' ? '该次未计伤，当前结果尚不完整。' : '当前结果待核对。'}`);
    if (!lines.length) return '';
    return `<div class="hint special-axis-integrity-note" role="status" style="padding:10px 12px;margin:10px 0;border:1px solid currentColor;border-radius:6px;line-height:1.7">${lines.map(line => `<div>${W.escapeHtml(line)}</div>`).join('')}</div>`;
  }

  W.SpecialAxisIntegrity = { audit, reconcile: () => audit(), renderNotice,
    currentPending, renderPending, chipState, counts, syncRound, assertComplete, rebuild, restoreReferenceSnapshot };
})();
