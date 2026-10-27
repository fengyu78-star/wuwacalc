/* 玩家选行和指定轮次的 Buff 编辑；写入复用既有覆盖和叠层入口。 */
(() => {
  const W = window.__WC;
  let scope = null;
  let rows = new Map();
  let busy = false;
  let drag = null;
  let consumeClick = false;
  let clickTimer = null;
  let stackEdit = null;
  let message = '';
  let targetRounds = new Set();
  const key = (phaseId, skillId, hitId = '') => JSON.stringify([phaseId, skillId, hitId || '']);
  const round = member => member.cycleConfig?.enabled ? W.readActiveCycleRoundIndex(member) : null;
  const structure = member => JSON.stringify((member.cycleConfig?.rounds || []).map(r => [
    (r.rotationCatalog || []).map(c => c.id), (r.phases || []).map(p => [p.id,
      (p.skills || []).map(s => [s.id, (s.hits || []).map(h => h.id)])]) ]));
  function reset() { endDrag(); scope = null; rows.clear(); targetRounds.clear(); stackEdit = null; message = ''; }
  function valid(member) {
    if (!scope) return false;
    if (scope.member !== member || scope.character !== member.characterId ||
        scope.chain !== member.resonanceUnlocked || scope.round !== round(member) ||
        scope.structure !== structure(member) || W.state._cfgV2Applying) {
      reset(); return false;
    }
    rows.forEach((row, id) => { if (!find(member, row)) rows.delete(id); });
    return true;
  }
  function ensureScope(member) {
    valid(member);
    if (!scope) {
      scope = { member, character: member.characterId, chain: member.resonanceUnlocked, round: round(member), structure: structure(member) };
      if (scope.round !== null) targetRounds.add(scope.round);
    }
  }
  function find(member, row) {
    const phase = (member.phases || []).find(p => p.id === row.phaseId);
    const skill = (phase?.skills || []).find(s => s.id === row.skillId);
    const hit = row.hitId ? (skill?.hits || []).find(h => h.id === row.hitId) : null;
    if (!phase || !skill || (row.hitId && !hit) || phase.locked || skill.locked || hit?.locked) return null;
    return { phase, skill, hit };
  }
  function selected(phase, skill, hit) {
    return valid(W.getActiveMember()) && rows.has(key(phase.id, skill.id, hit?.id));
  }
  function tools(phase, member) {
    valid(member);
    const current = round(member);
    const choices = current !== null && member.cycleConfig.rounds.length > 1
      ? `<fieldset class="matrix-row-rounds"><legend>同步到哪些轮次</legend>${member.cycleConfig.rounds.map((r, i) => `<label><input type="checkbox" data-matrix-rows-round="${i}"${i === current || targetRounds.has(i) ? ' checked' : ''}${i === current ? ' disabled' : ''}>第 ${i + 1} 轮${i === current ? '（当前）' : ''}</label>`).join('')}<span class="hint">整轮同步：无需选技能，勾选目标轮次后点击“本轮全部 Buff → 指定轮次”。选行编辑按对应技能同步；立即同步时，可为未对应的技能选择目标。</span></fieldset>` : '';
    return `<div class="matrix-row-batch-toolbar" data-matrix-rows-tools="${W.escapeHtml(phase.id)}"><strong data-matrix-rows-count role="status">${W.escapeHtml(countText(member))}</strong><button type="button" class="btn sm primary" data-matrix-rows-copy-all${rows.size && [...targetRounds].some(i => i !== current) ? '' : ' disabled'}>同步所选技能 Buff</button><button type="button" class="btn sm" data-matrix-rows-copy-round${current !== null && [...targetRounds].some(i => i !== current) ? '' : ' disabled'} title="当前角色本轮所有阶段的技能 / Hit，按对应项同步覆盖和叠层；跳过锁定或缺失项，可撤回">本轮全部 Buff → 指定轮次</button><button type="button" class="btn sm" data-matrix-rows-clear${rows.size || targetRounds.size ? '' : ' disabled'}>清空选择</button><button type="button" class="btn sm" data-edit-undo${W.peekEditUndo(member) ? '' : ' disabled'}>撤回</button><span class="hint" data-matrix-rows-hint>${W.escapeHtml(message || 'Ctrl＋左键点选或拖动批选技能 / Hit；从已选行拖动可取消，各行仍独立同步。')}</span>${choices}</div>`;
  }
  function countText(member) {
    const selectedRounds = [...targetRounds].sort((a, b) => a - b);
    return `已选 ${rows.size} 行 · ${selectedRounds.length > 1 ? '第 ' + selectedRounds.map(i => i + 1).join('、') + ' 轮' : '当前轮'}`;
  }
  function refresh(member) {
    valid(member);
    document.querySelectorAll('[data-matrix-row-skill]').forEach(el => {
      const phaseId = el.closest('[data-phase-buff-matrix]')?.dataset.phaseBuffMatrix;
      const on = !!phaseId && rows.has(key(phaseId, el.dataset.matrixRowSkill, el.dataset.hitId));
      el.classList.toggle('matrix-row-selected', on);
      el.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-matrix-rows-count]').forEach(el => el.textContent = countText(member));
    document.querySelectorAll('[data-matrix-rows-copy-all]').forEach(el => el.disabled = !rows.size || ![...targetRounds].some(i => i !== round(member)));
    document.querySelectorAll('[data-matrix-rows-copy-round]').forEach(el => el.disabled = ![...targetRounds].some(i => i !== round(member)));
    document.querySelectorAll('[data-matrix-rows-clear]').forEach(el => el.disabled = !rows.size && !targetRounds.size);
    document.querySelectorAll('[data-matrix-rows-hint]').forEach(el => el.textContent = message ||
      'Ctrl＋左键点选或拖动批选技能 / Hit；从已选行拖动可取消，各行仍独立同步。');
    document.querySelectorAll('[data-matrix-rows-round]').forEach(el => {
      const i = Number(el.dataset.matrixRowsRound);
      el.checked = i === round(member) || targetRounds.has(i);
      el.disabled = i === round(member);
    });
  }
  function toggle(member, row, checked) {
    valid(member);
    if (!find(member, row)) { message = '锁定的技能或 Hit 无法选中'; refresh(member); return; }
    ensureScope(member);
    const id = key(row.phaseId, row.skillId, row.hitId);
    if (checked ?? !rows.has(id)) rows.set(id, row); else rows.delete(id);
    // 同一编辑手势只启用一种同步入口，避免既有跨轮入口再次广播。
    W.roundSync?.reset(); stackEdit = null; message = '';
    refresh(member);
    document.querySelectorAll('[data-round-sync-buff]').forEach(button => {
      button.textContent = '同步修改 Buff'; button.setAttribute('aria-pressed', 'false'); button.classList.remove('primary');
      const bar = button.closest('.round-sync-bar');
      const hint = bar?.querySelector('.hint'); if (hint) hint.textContent = '自行选择轮次和对应技能';
      bar?.querySelector('[data-round-sync-off]')?.remove();
    });
  }
  function units(member, phaseId, skillId, hitId) {
    // 多选表示可跨轮同步的行；一次编辑只取实际被操作的技能或 Hit。
    const item = find(member, { phaseId, skillId, hitId: hitId || '' });
    if (!item) return [];
    const hits = item.hit ? [item.hit] : item.skill.split && item.skill.hits?.length ? item.skill.hits : [null];
    return hits.filter(hit => !hit?.locked).map(hit => ({ ...item, hit }));
  }
  // 技能简称只影响展示；跨轮身份优先使用技能库原名，未关联技能库的自定义技能仍按名称匹配。
  const signature = s => JSON.stringify([s.librarySkillName || s.name, s.damageType || '',
    s.damageElement || '', s.scaleStat || '', !!s.fixedDamage, !!s.split]);
  function descriptor(item, phases) {
    const peers = item.phase.skills.filter(s => signature(s) === signature(item.skill));
    return { phaseId: item.phase.id, phaseName: item.phase.name,
      phaseCount: phases.filter(p => p.name === item.phase.name).length,
      skill: { id: item.skill.id, sync: item.skill.roundSyncKey, sig: signature(item.skill),
        count: peers.length, index: peers.indexOf(item.skill), peers: peers.map(s => s.id),
        links: phases.flatMap(p => (p.skills || []).map(s => s.roundSyncKey).filter(Boolean)),
        totalCount: phases.reduce((count, phase) => count + (phase.skills || []).filter(s => signature(s) === signature(item.skill)).length, 0) },
      hit: item.hit ? { id: item.hit.id, sync: item.hit.roundSyncKey,
        index: item.skill.hits.indexOf(item.hit), ids: item.skill.hits.map(h => h.id), sigs: item.skill.hits.map(signature) } : null };
  }
  function alignSkillSequences(sourcePhases, targetPhases) {
    const matches = new Map(), absent = new Set();
    const entries = phases => phases.flatMap(phase => (phase.skills || []).map(skill => ({ phase, skill })));
    const sources = entries(sourcePhases), targets = entries(targetPhases);
    const group = (items, field) => {
      const map = new Map();
      items.forEach(item => {
        const value = item.skill[field];
        if (value) { if (!map.has(value)) map.set(value, []); map.get(value).push(item); }
      });
      return map;
    };
    const sourceIds = group(sources, 'id'), targetIds = group(targets, 'id');
    const sourceLinks = group(sources, 'roundSyncKey'), targetLinks = group(targets, 'roundSyncKey');
    const compatible = (a, b) => {
      if (signature(a.skill) !== signature(b.skill)) return false;
      const id = a.skill.id, targetId = b.skill.id;
      if (sourceIds.get(id)?.length !== 1 || targetIds.get(targetId)?.length !== 1) return false;
      if ((targetIds.has(id) && targetId !== id) || (sourceIds.has(targetId) && id !== targetId)) return false;
      const link = a.skill.roundSyncKey, targetLink = b.skill.roundSyncKey;
      if (link && sourceLinks.get(link)?.length !== 1) return false;
      if (targetLink && targetLinks.get(targetLink)?.length !== 1) return false;
      if (link && targetLinks.has(link) && link !== targetLink) return false;
      if (targetLink && sourceLinks.has(targetLink) && link !== targetLink) return false;
      return !(link && targetLink && link !== targetLink);
    };
    const strong = new Map();
    sources.forEach(a => {
      const linked = a.skill.roundSyncKey ? targetLinks.get(a.skill.roundSyncKey) || [] : [];
      const candidates = linked.length ? linked : targetIds.get(a.skill.id) || [];
      if (candidates.length === 1 && compatible(a, candidates[0])) strong.set(a, candidates[0]);
    });
    sourcePhases.forEach(phase => {
      const byId = targetPhases.filter(p => p.id === phase.id);
      const byName = targetPhases.filter(p => p.name === phase.name);
      const targetPhase = byId.length === 1 ? byId[0] :
        sourcePhases.filter(p => p.name === phase.name).length === 1 && byName.length === 1 ? byName[0] : null;
      if (!targetPhase) return;
      const left = sources.filter(item => item.phase === phase), right = targets.filter(item => item.phase === targetPhase);
      if (left.some(item => strong.has(item) && strong.get(item).phase !== targetPhase)) return;
      const anchors = left.flatMap((item, i) => strong.has(item) ? [[i, right.indexOf(strong.get(item))]] : []);
      if (anchors.some((pair, i) => i && pair[1] <= anchors[i - 1][1])) return;
      const boundaries = [[-1, -1], ...anchors, [left.length, right.length]];
      const remember = (a, b) => matches.set(key(a.phase.id, a.skill.id), b);
      anchors.forEach(([i, j]) => remember(left[i], right[j]));
      for (let boundary = 1; boundary < boundaries.length; boundary++) {
        const previous = boundaries[boundary - 1], next = boundaries[boundary];
        const a = left.slice(previous[0] + 1, next[0]), b = right.slice(previous[1] + 1, next[1]);
        if (!a.length) continue;
        // 等长完整同序才逐位置对应；少项必须通过下方唯一保序嵌入判断。
        if (a.length === b.length && b.every((item, i) => compatible(a[i], item))) {
          b.forEach((item, i) => remember(a[i], item));
          a.slice(b.length).forEach(item => absent.add(key(item.phase.id, item.skill.id)));
          continue;
        }
        // 缺项不能让后续重复动作移位。只接受所有保序嵌入都指向同一项的对应。
        const sourceLonger = a.length >= b.length, longer = sourceLonger ? a : b, shorter = sourceLonger ? b : a;
        const canPair = (longItem, shortItem) => sourceLonger ? compatible(longItem, shortItem) : compatible(shortItem, longItem);
        const earliest = [], latest = [];
        let cursor = 0;
        for (const item of shorter) {
          while (cursor < longer.length && !canPair(longer[cursor], item)) cursor++;
          if (cursor === longer.length) break;
          earliest.push(cursor++);
        }
        if (earliest.length !== shorter.length) continue;
        cursor = longer.length - 1;
        for (let i = shorter.length - 1; i >= 0; i--) {
          while (cursor >= 0 && !canPair(longer[cursor], shorter[i])) cursor--;
          latest[i] = cursor--;
        }
        shorter.forEach((item, i) => {
          if (earliest[i] === latest[i]) {
            if (sourceLonger) remember(longer[earliest[i]], item); else remember(item, longer[earliest[i]]);
          }
        });
        if (sourceLonger) a.forEach((item, i) => {
          if (!b.some((target, j) => earliest[j] <= i && i <= latest[j] && compatible(item, target))) absent.add(key(item.phase.id, item.skill.id));
        });
      }
    });
    return { matches, absent };
  }

  function corresponding(member, source, onSkip, alignment) {
    const skip = reason => { onSkip?.(reason); return null; };
    const phases = member.phases || [];
    const entries = phases.flatMap(phase => (phase.skills || []).map(skill => ({ phase, skill })));
    const sourceKey = key(source.phaseId, source.skill.id);
    if (alignment?.absent.has(sourceKey)) return skip('目标轮未包含此动作');
    let found = alignment?.matches.get(sourceKey);
    if (source.skill.sync) {
      const linked = entries.filter(x => x.skill.roundSyncKey === source.skill.sync);
      if (linked.length > 1) return skip('跨轮关联不唯一');
      if (linked.length === 1) found = linked[0];
    }
    if (!found) {
      const exact = entries.filter(x => x.skill.id === source.skill.id && signature(x.skill) === source.skill.sig);
      if (exact.length > 1) return skip('对应技能不唯一');
      if (exact.length === 1) {
        if (conflictingLink(source, exact[0]) || (exact[0].skill.roundSyncKey !== source.skill.sync &&
            (source.skill.totalCount !== 1 || entries.filter(x => signature(x.skill) === source.skill.sig).length !== 1))) return skip('跨轮关联冲突');
        found = exact[0];
      } else {
        const sameId = phases.filter(p => p.id === source.phaseId);
        const sameName = phases.filter(p => p.name === source.phaseName);
        const phase = sameId.length === 1 ? sameId[0] : source.phaseCount === 1 && sameName.length === 1 ? sameName[0] : null;
        const peers = (phase?.skills || []).filter(s => signature(s) === source.skill.sig);
        // 混合保留/重建 ID 时，旧同组技能不能冒充缺失的对应项。
        if (phase && peers.length === source.skill.count &&
            (!source.skill.sync || (source.skill.totalCount === 1 && entries.filter(x => signature(x.skill) === source.skill.sig).length === 1)) &&
            !peers.some(s => source.skill.peers.includes(s.id) || s.roundSyncKey)) {
          found = { phase, skill: peers[source.skill.index] };
        }
        // 两轮独立新增的唯一技能允许跨阶段对应，不建立或改写跨轮关联。
        if (!found && source.skill.totalCount === 1) {
          const unique = entries.filter(x => signature(x.skill) === source.skill.sig);
          if (unique.length === 1) {
            if (conflictingLink(source, unique[0])) return skip('跨轮关联冲突');
            found = unique[0];
          }
        }
      }
    }
    if (!found?.skill) return skip(entries.some(x => signature(x.skill) === source.skill.sig) ? '对应技能不唯一' : '缺少对应技能');
    if (found.phase.locked || found.skill.locked) return skip('阶段或技能已锁定');
    if (signature(found.skill) !== source.skill.sig) return skip('技能信息不一致');
    let hit = null;
    if (source.hit) {
      const hits = found.skill.hits || [];
      if (source.hit.sync) {
        const linked = hits.filter(h => h.roundSyncKey === source.hit.sync);
        if (linked.length > 1) return skip('Hit 关联不唯一');
        if (linked.length === 1) hit = linked[0];
      }
      if (!hit) {
        hit = hits.find(h => h.id === source.hit.id);
        if (hit?.roundSyncKey && hit.roundSyncKey !== source.hit.sync) return skip('Hit 关联冲突');
        if (!hit && !hits.some(h => source.hit.ids.includes(h.id) || h.roundSyncKey) &&
            JSON.stringify(hits.map(signature)) === JSON.stringify(source.hit.sigs)) hit = hits[source.hit.index];
      }
      if (!hit || signature(hit) !== source.hit.sigs[source.hit.index]) return skip('Hit 缺失或结构不一致');
      if (hit.locked) return skip('Hit 已锁定');
    }
    return { ...found, hit };
  }

  // 系统 Buff 的启用位固定，不妨碍同步其正常可编辑的层数。
  const canEditStack = (member, buff) => W.isStackBuff(buff) &&
    (W.isStackSyncUiAuthority(buff, member.buffs || []) || W.isStackSyncMemberBuff(buff, member.buffs || []));
  function changes(member, items, buff, buffId, next, isStack, opts = {}) {
    const allowed = items.filter(item => (!W.isForcedActiveSystemBuff(buff) || (isStack && canEditStack(member, buff))) &&
      (item.hit ? W.hitBuffCanApply(item.skill, item.hit, buff, member) : W.skillBuffCanApply(item.skill, buff, member)));
    return { skipped: items.length - allowed.length, changed: allowed.filter(item => {
      const phaseActive = W.resolveBuffActive(item.phase.buffMode, item.phase.buffActive, { ...member.globalBuffActive });
      const unit = item.hit || item.skill;
      const active = !!W.getBatchUnitResolvedActive(unit, phaseActive)[buffId];
      return isStack ? W.getBatchUnitResolvedStack(unit, item.skill, item.phase, member, buffId) !== next || active !== (typeof opts.enabled === 'boolean' ? opts.enabled : next > 0) : active !== next;
    }) };
  }
  function write(member, changed, buffId, next, isStack, opts = {}) {
    const groups = new Map();
    changed.filter(item => !item.hit).forEach(item => {
      if (!groups.has(item.phase.id)) groups.set(item.phase.id, { phase: item.phase, ids: [] });
      groups.get(item.phase.id).ids.push(item.skill.id);
    });
    groups.forEach(group => {
      if (isStack) W.applyBatchStackToSkills(member, group.phase, group.ids, buffId, next, { ...opts, skipPersist: true });
      else W.applyBatchBuffToggle(member, group.phase, group.ids, buffId, next, { skipPersist: true });
    });
    changed.filter(item => item.hit).forEach(item => {
      if (isStack) W.applyMatrixHitStack(member, item.phase, item.skill.id, item.hit.id, buffId, next, { ...opts, skipPersist: true });
      else W.applyMatrixHitBuffToggle(member, item.phase, item.skill.id, item.hit.id, buffId, next, { skipPersist: true });
    });
  }
  function apply(member, phase, skillId, hitId, buffId, value, isStack, opts = {}) {
    if (busy || !valid(member) || !rows.size) return false;
    const anchorSelected = rows.has(key(phase.id, skillId, hitId)) || (hitId && rows.has(key(phase.id, skillId)));
    if (!anchorSelected) return false;
    const buff = (member.buffs || []).find(b => b.id === buffId);
    if (!buff) return false;
    W.roundSync?.reset();
    const all = units(member, phase.id, skillId, hitId);
    const sourcePhases = JSON.parse(JSON.stringify(member.phases));
    const sources = all.map(item => descriptor(item, member.phases));
    const next = isStack ? W.normalizeStackInput(value, buffId) : !!value;
    const current = round(member);
    const targets = current === null ? [] : [...targetRounds].filter(i => i !== current && member.cycleConfig.rounds[i]);
    const first = changes(member, all, buff, buffId, next, isStack, opts);
    if (!first.changed.length && !targets.length) {
      message = `无需修改；跳过 ${first.skipped} 个不适用条目`; refresh(member); return true;
    }
    const editKey = key(phase.id, skillId, hitId) + buffId + JSON.stringify([...targetRounds]);
    let newUndo = false;
    if (!isStack || !stackEdit || stackEdit.key !== editKey || W.peekEditUndo(member) !== stackEdit.undo) {
      W.pushEditUndo(member, isStack ? '同步技能 Buff 叠层' : '同步技能 Buff 覆盖', { includeResonanceAxis: true, includeCycleRounds: targets.length > 0 });
      newUndo = true;
      stackEdit = isStack ? { key: editKey, undo: W.peekEditUndo(member) } : null;
    }
    busy = true;
    let modified = first.changed.length;
    let skipped = first.skipped;
    const details = [];
    try {
      write(member, first.changed, buffId, next, isStack, opts);
      if (first.changed.length) W.persistCycleEditingIfEnabled(member);
      if (targets.length) W.saveActiveRoundSnapshot(member);
      targets.forEach(index => {
        member.cycleConfig.activeRound = index;
        W.loadRoundSnapshot(member, index);
        const targetBuff = (member.buffs || []).find(b => b.id === buffId);
        const dedup = new Map();
        const alignment = alignSkillSequences(sourcePhases, member.phases);
        sources.forEach(source => {
          const item = corresponding(member, source, null, alignment);
          if (item) dedup.set(key(item.phase.id, item.skill.id, item.hit?.id), item);
        });
        const matches = [...dedup.values()];
        const result = targetBuff ? changes(member, matches, targetBuff, buffId, next, isStack, opts) : { skipped: matches.length, changed: [] };
        const missed = sources.length - matches.length + result.skipped;
        write(member, result.changed, buffId, next, isStack, opts);
        if (result.changed.length) W.persistCycleEditingIfEnabled(member);
        modified += result.changed.length; skipped += missed;
        details.push(`第 ${index + 1} 轮修改 ${result.changed.length}${missed ? `，跳过 ${missed}` : ''}`);
      });
    } finally {
      if (targets.length) {
        member.cycleConfig.activeRound = current;
        W.loadRoundSnapshot(member, current);
      }
      busy = false;
    }
    if (!modified && newUndo) { W.editUndoStacks.get(member.id)?.pop(); stackEdit = null; }
    const painted = new Set();
    first.changed.forEach(item => {
      const id = key(item.phase.id, item.skill.id); if (painted.has(id)) return; painted.add(id);
      const restoredPhase = member.phases.find(p => p.id === item.phase.id);
      if (restoredPhase) {
        W.refreshMatrixBuffColumnForSkill(member, restoredPhase, item.skill.id, buffId);
        W.refreshPhaseMatrixRowCustomClasses(member, restoredPhase.id);
      }
    });
    message = `已修改 ${modified} 个条目；跳过 ${skipped} 个不适用或缺失条目${details.length ? ' · ' + details.join('；') : ''}${modified ? ' · 可撤回' : ''}`;
    refresh(member); W.refreshUndoUi();
    return true;
  }
  const canApply = (member, item, buff) => !W.isForcedActiveSystemBuff(buff) &&
    (item.hit ? W.hitBuffCanApply(item.skill, item.hit, buff, member) : W.skillBuffCanApply(item.skill, buff, member));
  // 可编辑的系统叠层参与快照；强制启用位仍不随快照切换。
  const canCopy = (member, item, buff) => canApply(member, item, buff) ||
    (W.isForcedActiveSystemBuff(buff) && canEditStack(member, buff) &&
      (item.hit ? W.hitBuffCanApply(item.skill, item.hit, buff, member) : W.skillBuffCanApply(item.skill, buff, member)));
  function unitState(member, item) {
    const phaseActive = W.resolveBuffActive(item.phase.buffMode, item.phase.buffActive, { ...member.globalBuffActive });
    const active = { ...W.getBatchUnitResolvedActive(item.hit || item.skill, phaseActive) };
    const stacks = {};
    (member.buffs || []).filter(W.isStackBuff).forEach(buff => {
      stacks[buff.id] = W.getBatchUnitResolvedStack(item.hit || item.skill, item.skill, item.phase, member, buff.id);
    });
    return { active, stacks };
  }
  function snapshotSource(member, item) {
    const state = unitState(member, item);
    return { label: copyLabel(item), identity: descriptor(item, member.phases), buffs: (member.buffs || [])
      .filter(buff => canCopy(member, item, buff)).map(buff => ({
        id: buff.id, signature: W.buffSignature(buff), content: W.buffContentSignature(buff),
        checked: !!state.active[buff.id], stack: W.isStackBuff(buff) ? state.stacks[buff.id] : null,
        parts: Object.entries(state.active).filter(([id]) => id.startsWith(buff.id + '::'))
          .map(([id, value]) => [id.slice(buff.id.length), !!value])
      })) };
  }
  function snapshotBuff(member, source) {
    const buffs = member.buffs || [];
    const exact = buffs.filter(buff => buff.id === source.id && W.buffContentSignature(buff) === source.content);
    if (exact.length === 1) return exact[0];
    const signed = buffs.filter(buff => W.buffSignature(buff) === source.signature && W.buffContentSignature(buff) === source.content);
    if (signed.length === 1) return signed[0];
    const content = buffs.filter(buff => W.buffContentSignature(buff) === source.content);
    return content.length === 1 ? content[0] : null;
  }
  function applySnapshot(member, item, source) {
    const next = unitState(member, item);
    let copied = 0;
    source.buffs.forEach(from => {
      const buff = snapshotBuff(member, from);
      if (!buff || !canCopy(member, item, buff) || (from.stack !== null && !W.isStackBuff(buff))) return;
      copied++;
      if (canApply(member, item, buff)) {
        next.active[buff.id] = from.checked;
        // 复合 Buff 的独立乘区勾选也属于本次完整快照。
        Object.keys(next.active).filter(id => id.startsWith(buff.id + '::')).forEach(id => delete next.active[id]);
        from.parts.forEach(([suffix, value]) => { next.active[buff.id + suffix] = value; });
      }
      if (from.stack !== null) next.stacks[buff.id] = W.normalizeStackInput(from.stack, buff);
    });
    if (!copied) return { changed: false, copied, skipped: source.buffs.length };
    const previous = unitState(member, item);
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    if (changed) {
      // 只写对应单位的覆盖快照，保留兄弟 Hit 及共用目录的其他技能。
      const unit = item.hit || item.skill;
      unit.buffMode = 'custom'; unit.buffActive = next.active; unit.buffStacks = next.stacks;
      delete unit.buffActiveSig; delete unit.buffStacksSig;
      if (unit._autoMatchedFalse) source.buffs.forEach(from => {
        const buff = snapshotBuff(member, from); if (buff && canApply(member, item, buff)) delete unit._autoMatchedFalse[buff.id];
      });
      W.syncUnitBuffCoverageSigs(unit, member);
    }
    return { changed, copied, skipped: source.buffs.length - copied };
  }
  const unitKey = item => key(item.phase.id, item.skill.id, item.hit?.id);
  const copyContext = (member, sources, plans) => JSON.stringify([member.characterId,
    member.resonanceUnlocked, round(member), sources, plans.map(plan => [plan.index, plan.context,
      plan.entries.map(entry => [entry.target, !!entry.absent, entry.choices.map(choice => [choice.key, choice.sig, choice.hitSig])])])]);
  function copySources(member, sourceRows) {
    const preview = JSON.parse(JSON.stringify(member));
    const items = new Map();
    sourceRows.forEach(row => units(preview, row.phaseId, row.skillId, row.hitId).forEach(item =>
      items.set(unitKey(item), item)));
    return [...items.values()].map(item => snapshotSource(preview, item));
  }
  const conflictingLink = (source, item) => {
    const target = item.skill.roundSyncKey;
    return !!target && (source.skill.sync ? target !== source.skill.sync :
      (source.skill.links || []).includes(target));
  };
  function copyLabel(item) {
    const position = item.phase.skills.indexOf(item.skill) + 1;
    const skill = item.skill;
    return `${item.phase.name} · 第 ${position} 项 ${skill.name}${item.hit ? ` / Hit ${skill.hits.indexOf(item.hit) + 1}` : ''} · ${skill.damageType || '未分类'} · ${skill.baseMult ?? '—'}%`;
  }
  function planCopy(member, sources, targets) {
    // 预览使用独立副本，取消弹窗不切换真实轮次、不保存或建立撤回记录。
    const preview = JSON.parse(JSON.stringify(member));
    return targets.map(index => {
      preview.cycleConfig.activeRound = index;
      W.loadRoundSnapshot(preview, index);
      const items = (preview.phases || []).flatMap(phase => (phase.skills || []).flatMap(skill =>
        units(preview, phase.id, skill.id)));
      const alignment = alignSkillSequences(member.phases, preview.phases);
      const entries = sources.map(source => {
        let reason = '';
        const item = corresponding(preview, source.identity, value => { reason = value; }, alignment);
        return { source, target: item ? unitKey(item) : '', reason,
          absent: alignment.absent.has(key(source.identity.phaseId, source.identity.skill.id)), choices: [] };
      });
      const counts = new Map();
      entries.forEach(entry => { if (entry.target) counts.set(entry.target, (counts.get(entry.target) || 0) + 1); });
      entries.forEach(entry => {
        if (counts.get(entry.target) > 1) { entry.target = ''; entry.reason = '多个源技能指向同一目标'; }
      });
      const reserved = new Set(entries.filter(entry => entry.target).map(entry => entry.target));
      entries.filter(entry => !entry.target && !entry.absent).forEach(entry => {
        entry.choices = items.filter(item => !reserved.has(unitKey(item)) &&
          !!item.hit === !!entry.source.identity.hit && !conflictingLink(entry.source.identity, item))
          .map(item => ({ key: unitKey(item), label: copyLabel(item), sig: signature(item.skill),
            hitSig: item.hit ? signature(item.hit) : null,
            same: signature(item.skill) === entry.source.identity.skill.sig }))
          .sort((a, b) => Number(b.same) - Number(a.same));
      });
      const context = items.map(item => {
        const state = unitState(preview, item);
        return [unitKey(item), signature(item.skill), item.hit ? signature(item.hit) : null,
          item.skill.roundSyncKey || '', item.hit?.roundSyncKey || '',
          Object.entries(state.active).sort(), Object.entries(state.stacks).sort()];
      });
      return { index, entries, context };
    });
  }
  function chooseCopyTargets(plans) {
    const unresolved = plans.flatMap((plan, pi) => plan.entries.map((entry, ei) => ({ entry, pi, ei })))
      .filter(({ entry }) => !entry.target && !entry.absent);
    if (!unresolved.length) return Promise.resolve(true);
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'matrix-copy-dialog';
      dialog.setAttribute('aria-labelledby', 'matrix-copy-title');
      const esc = W.escapeHtml;
      dialog.innerHTML = `<form method="dialog"><h3 id="matrix-copy-title">确认未对应的技能</h3>
        <p>已找到 ${plans.reduce((n, plan) => n + plan.entries.filter(entry => entry.target).length, 0)} 行对应技能；以下 ${unresolved.length} 行需要选择目标，或保留跳过。</p>
        <p class="hint">选择不同技能时，仅复制目标适用的 Buff，不改变技能和倍率。跳过项保持原状。</p>
        <div class="matrix-copy-list">${unresolved.map(({ entry, pi, ei }) => `<label class="matrix-copy-item">
          <strong>第 ${plans[pi].index + 1} 轮 ← ${esc(entry.source.label)}</strong>
          <span class="hint">${esc(entry.reason)}</span>
          <select data-matrix-copy-choice="${pi}:${ei}"${entry.choices.length ? '' : ' disabled'}>
            <option value="">${entry.choices.length ? '跳过此项（保持原状）' : '无可用目标，跳过此项'}</option>
            ${entry.choices.map(choice => `<option value="${esc(choice.key)}">${choice.same ? '同技能' : '不同技能'} · ${esc(choice.label)}</option>`).join('')}
          </select></label>`).join('')}</div>
        <p class="matrix-copy-error" data-matrix-copy-error role="alert"></p>
        <div class="matrix-copy-actions"><button type="button" class="btn" data-matrix-copy-cancel>取消</button><button type="submit" class="btn primary">确认并同步</button></div></form>`;
      const inputs = [...dialog.querySelectorAll('[data-matrix-copy-choice]')];
      const selection = input => {
        const [pi, ei] = input.dataset.matrixCopyChoice.split(':').map(Number);
        return { pi, entry: plans[pi].entries[ei] };
      };
      dialog.addEventListener('change', () => {
        inputs.forEach(input => {
          const { pi } = selection(input);
          [...input.options].forEach(option => {
            option.disabled = !!option.value && inputs.some(other => other !== input &&
              selection(other).pi === pi && other.value === option.value);
          });
        });
        dialog.querySelector('[data-matrix-copy-error]').textContent = '';
      });
      let accepted = false;
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const picked = new Set();
        for (const input of inputs) {
          const { pi, entry } = selection(input);
          if (input.value && (!entry.choices.some(choice => choice.key === input.value) || picked.has(pi + input.value))) {
            dialog.querySelector('[data-matrix-copy-error]').textContent = '同一轮的目标不能重复，请重新选择。';
            input.focus(); return;
          }
          if (input.value) picked.add(pi + input.value);
        }
        inputs.forEach(input => {
          const { entry } = selection(input);
          entry.target = input.value;
          entry.manual = !!input.value;
        });
        accepted = true; dialog.close();
      });
      dialog.querySelector('[data-matrix-copy-cancel]').onclick = () => dialog.close();
      const opener = document.activeElement;
      dialog.addEventListener('close', () => {
        dialog.remove(); opener?.focus?.({ preventScroll: true }); resolve(accepted);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  async function copyAll(member, allSkills = false) {
    if (busy || !member) return;
    if (!allSkills && (!valid(member) || !rows.size)) return;
    if (allSkills) valid(member);
    const current = round(member);
    const targets = current === null ? [] : [...targetRounds].filter(i => i !== current && member.cycleConfig.rounds[i]);
    if (!targets.length) { message = '请勾选至少一个目标轮次'; refresh(member); return; }
    const sourceRows = allSkills
      ? (member.phases || []).flatMap(phase => (phase.skills || []).map(skill => ({ phaseId: phase.id, skillId: skill.id })))
      : [...rows.values()];
    const sources = copySources(member, sourceRows);
    if (!sources.length) { message = '没有可同步的技能或 Hit'; refresh(member); return; }
    busy = true;
    let plans;
    try {
      plans = planCopy(member, sources, targets);
      const context = copyContext(member, sources, plans);
      if (!await chooseCopyTargets(plans)) return;
      const latestSources = copySources(member, sourceRows);
      if (W.getActiveMember() !== member || W.state._cfgV2Applying ||
          copyContext(member, latestSources, planCopy(member, latestSources, targets)) !== context) {
        message = '技能或 Buff 已变化，请重新发起同步'; refresh(member); return;
      }
    } catch (error) {
      message = '无法准备同步，请重试'; refresh(member); return;
    } finally { busy = false; }
    const skippedLabel = entry => `${entry.source.label}（${entry.reason}${entry.absent ? '' : '；未选择目标'}）`;
    if (!plans.some(plan => plan.entries.some(entry => entry.target))) {
      message = '未同步 · ' + plans.map(plan => `第 ${plan.index + 1} 轮：${plan.entries.map(skippedLabel).join('、')}`).join('；');
      refresh(member); return;
    }
    W.roundSync?.reset(); stackEdit = null;
    const originalContext = JSON.parse(JSON.stringify({ char: member.char, buffs: member.buffs,
      globalBuffActive: member.globalBuffActive, globalBuffStacks: member.globalBuffStacks }));
    const originalSpecial = JSON.parse(JSON.stringify(W.state.specialSkills));
    W.pushEditUndo(member, allSkills ? '本轮全部 Buff → 指定轮次' : '立即同步全部 Buff', { includeResonanceAxis: true, includeCycleRounds: true });
    const undo = W.peekEditUndo(member);
    busy = true;
    let modified = 0, matched = 0, failed = false; const details = [];
    try {
      W.saveActiveRoundSnapshot(member);
      plans.forEach(plan => {
        member.cycleConfig.activeRound = plan.index; W.loadRoundSnapshot(member, plan.index);
        let count = 0, skippedBuffs = 0;
        const missed = [];
        plan.entries.forEach(entry => {
          if (!entry.target) { missed.push(skippedLabel(entry)); return; }
          const [phaseId, skillId, hitId] = JSON.parse(entry.target);
          const item = find(member, { phaseId, skillId, hitId });
          const expected = entry.manual ? entry.choices.find(choice => choice.key === entry.target)?.sig : entry.source.identity.skill.sig;
          const expectedHit = entry.manual ? entry.choices.find(choice => choice.key === entry.target)?.hitSig :
            entry.source.identity.hit?.sigs[entry.source.identity.hit.index] || null;
          if (!item || signature(item.skill) !== expected ||
              (item.hit ? signature(item.hit) : null) !== expectedHit) throw new Error('目标技能已变化');
          const result = applySnapshot(member, item, entry.source);
          if (result.copied) matched++;
          if (result.changed) count++;
          skippedBuffs += result.skipped;
        });
        if (count) W.persistCycleEditingIfEnabled(member);
        modified += count;
        details.push(`第 ${plan.index + 1} 轮更新 ${count} 行${missed.length ? `，跳过 ${missed.length} 行：${missed.join('、')}` : ''}${skippedBuffs ? `，跳过 ${skippedBuffs} 项缺失或不适用 Buff` : ''}`);
      });
    } catch (error) {
      failed = true;
      Object.assign(member, originalContext);
      W.state.specialSkills = originalSpecial;
      W.applyMemberEditSnapshot(member, undo.snapshot);
      message = '同步失败，已撤回本次修改，请重试';
    } finally {
      if (!failed) { member.cycleConfig.activeRound = current; W.loadRoundSnapshot(member, current); }
      busy = false;
    }
    if (!modified || failed) {
      if (W.peekEditUndo(member) === undo) W.editUndoStacks.get(member.id)?.pop();
      W.persistEditUndoStacks();
    }
    if (!failed) message = `${modified ? '已同步当前全部 Buff' : matched ? '对应行状态一致，无需修改' : '没有可更新的对应项'} · ${details.join('；')}${modified ? ' · 可撤回' : ''}`;
    W.render(); refresh(member); W.refreshUndoUi();
  }

  const selectionRow = label => ({ phaseId: label.dataset.matrixFocusSkill,
    skillId: label.dataset.skillId, hitId: label.dataset.hitId || '' });
  function endDrag() {
    drag = null;
    document.documentElement.classList.remove('matrix-row-dragging');
  }
  function paintLabel(label) {
    if (!drag || !label) return;
    const row = selectionRow(label), id = key(row.phaseId, row.skillId, row.hitId);
    if (drag.visited.has(id)) return;
    drag.visited.add(id);
    if (find(drag.member, row)) toggle(drag.member, row, drag.checked);
  }
  document.addEventListener('pointerdown', event => {
    clearTimeout(clickTimer); consumeClick = false; endDrag();
    const label = event.target.closest('[data-matrix-focus-skill]');
    if (!label || event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.pointerType === 'touch') return;
    event.preventDefault(); event.stopPropagation(); finishPopover();
    const member = W.getActiveMember(), row = selectionRow(label);
    valid(member);
    consumeClick = true;
    if (!find(member, row)) { message = '锁定的技能或 Hit 无法选中'; refresh(member); return; }
    const checked = !rows.has(key(row.phaseId, row.skillId, row.hitId));
    toggle(member, row, checked);
    drag = { member, scope, checked, pointerId: event.pointerId, last: label,
      visited: new Set([key(row.phaseId, row.skillId, row.hitId)]) };
    label.focus({ preventScroll: true });
    document.documentElement.classList.add('matrix-row-dragging');
  }, true);
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!(event.buttons & 1) || !(event.ctrlKey || event.metaKey) ||
        W.getActiveMember() !== drag.member || !valid(drag.member) || !drag || scope !== drag.scope) { endDrag(); return; }
    const label = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-matrix-focus-skill]');
    if (!label) { drag.last = null; return; }
    event.preventDefault(); event.stopPropagation();
    // 快速移过多行也补齐中间行；只在同一左侧技能列内连续选择。
    const host = label.closest('[data-phase-buff-matrix]');
    if (host && drag.last?.closest('[data-phase-buff-matrix]') === host) {
      const labels = [...host.querySelectorAll('[data-matrix-focus-skill]')].filter(el => el.getClientRects().length);
      const a = labels.indexOf(drag.last), b = labels.indexOf(label);
      if (a >= 0 && b >= 0) labels.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(paintLabel);
    }
    paintLabel(label);
    if (drag) drag.last = label;
  }, true);
  document.addEventListener('pointerup', () => {
    endDrag(); clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { consumeClick = false; }, 500);
  }, true);
  document.addEventListener('pointercancel', () => { endDrag(); consumeClick = false; }, true);
  document.addEventListener('keyup', event => { if (!(event.ctrlKey || event.metaKey)) endDrag(); }, true);
  window.addEventListener('blur', () => { endDrag(); consumeClick = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { endDrag(); consumeClick = false; } });

  function endEdit() { stackEdit = null; }
  function finishPopover() { if (document.getElementById('phaseStackPopover')?.hidden === false) W.closePhaseStackPopover(); }
  document.addEventListener('change', event => {
    const input = event.target.closest('[data-matrix-rows-round]');
    if (!input) return;
    finishPopover(); const member = W.getActiveMember();
    if (!member) return;
    ensureScope(member);
    const index = Number(input.dataset.matrixRowsRound);
    if (!Number.isInteger(index) || !member.cycleConfig?.rounds[index] || index === round(member)) return;
    if (input.checked) targetRounds.add(index); else targetRounds.delete(index);
    stackEdit = null; message = ''; refresh(member);
  }, true);
  document.addEventListener('click', event => {
    if (consumeClick) { consumeClick = false; event.preventDefault(); event.stopPropagation(); return; }
    const label = event.target.closest('[data-matrix-focus-skill]');
    const wholeRound = event.target.closest('[data-matrix-rows-copy-round]');
    if (wholeRound) { event.preventDefault(); event.stopPropagation(); finishPopover(); copyAll(W.getActiveMember(), true); return; }
    const copy = event.target.closest('[data-matrix-rows-copy-all]');
    if (copy) { event.preventDefault(); event.stopPropagation(); finishPopover(); copyAll(W.getActiveMember()); return; }
    const clear = event.target.closest('[data-matrix-rows-clear]');
    if (clear || (label && (event.ctrlKey || event.metaKey))) {
      event.preventDefault(); event.stopPropagation(); finishPopover();
      const member = W.getActiveMember();
      if (clear) { reset(); refresh(member); }
      else toggle(member, { phaseId: label.dataset.matrixFocusSkill, skillId: label.dataset.skillId, hitId: label.dataset.hitId || '' });
      return;
    }
    if (event.target.closest('[data-export-cfg-apply], [data-export-cfg-delete], [data-cycle-round-tab], [data-cycle-count]')) {
      finishPopover(); reset();
    }
    if (event.target.closest('[data-edit-undo]')) stackEdit = null;
  }, true);
  document.addEventListener('keydown', event => {
    if (!drag) consumeClick = false;
    const label = event.target.closest('[data-matrix-focus-skill]');
    if (label && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      label.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey }));
    } else if (event.key === 'Escape' && !event.target.closest('input, textarea, select, dialog')) {
      finishPopover(); reset(); refresh(W.getActiveMember());
    }
  }, true);
  W.matrixRows = { tools, selected, apply, endEdit, reset };
  // 永久兼容别名；跨文件调用继续使用 __WC。
  Object.defineProperty(window, 'matrixRows', {
    configurable: true, enumerable: true,
    get: () => W.matrixRows, set: value => { W.matrixRows = value; }
  });
})();
