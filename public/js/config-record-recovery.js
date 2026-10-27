(function () {
  const W = window.__WC, records = W.configRecords;
  // Pure reconstruction from the row's own saved axis/stack evidence.
// `W` is the existing calculator namespace; this helper does not access live state.
function recoverSavedRowInputs(W, data, row, payload) {
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const out = clone(payload);
  if (row?.type !== 'cumulative' || row.diff?.roundAxisVersion !== 1)
    return { payload: out, evidence: null };
  const anchor = data?.exportConfigAnchor, rows = data?.exportConfigSnapshots;
  const index = Array.isArray(rows) ? rows.findIndex(item => item.id === row.id) : -1;
  if (!row.baseId || row.baseId !== anchor?.baseId || !anchor.workspace || index < 0 ||
      !Array.isArray(out.members) || !Array.isArray(anchor.workspace.members) ||
      out.members.length !== anchor.workspace.members.length)
    throw new Error('原记录缺少可确认的同一基底，未推测轴输入');
  if (out.members.some((member, i) => String(member.characterId) !== String(anchor.workspace.members[i].characterId)))
    throw new Error('保存轴的角色来源不一致，未生成替代数据');
  // A fields patch is relative to the saved anchor, not necessarily a preceding value patch.
  const axis = holder => holder && Array.isArray(holder.rotationCatalog) && Array.isArray(holder.phases)
    ? { rotationCatalog: clone(holder.rotationCatalog), phases: clone(holder.phases),
      resonanceAxis: clone(holder.resonanceAxis || null) } : null;
  let editable = { members: anchor.workspace.members.map(member => ({ roundAxis: {
    axis: axis(member), rounds: member.cycleConfig?.enabled && Array.isArray(member.cycleConfig.rounds)
      ? Object.fromEntries(member.cycleConfig.rounds.map((round, ri) => [String(ri), axis(round)])) : null } })) };
  const prefix = rows.slice(0, index + 1).filter(item => item.type === 'cumulative' && item.baseId === row.baseId);
  const evidenceRows = [];
  for (const source of prefix) {
    const changes = source.diff?.members || [];
    if (source.diff?.roundAxisVersion !== 1 && changes.some(member => member.roundAxis || member.axis || member.skillBuffs || member.phaseStacks))
      throw new Error('保存轴包含不能确认的旧轮次差异，未混用恢复');
    const members = changes.filter(member => member.roundAxis).map(member => {
      if (!Number.isInteger(member.index) || member.index < 0 || member.index >= out.members.length ||
          !['value', 'fields'].includes(member.roundAxis.kind)) throw new Error('保存轴差异结构不完整');
      return { index: member.index, roundAxis: clone(member.roundAxis) };
    });
    editable = W.applyExportCfgV2DiffToEditable(editable, { roundAxisVersion: 1, members });
    if (members.length) evidenceRows.push(String(source.id));
  }
  const viewKeys = ['char', 'buffs', 'globalBuffActive', 'globalBuffStacks',
    'rotationCatalog', 'phases', 'resonanceAxis', 'effectHintExtras'];
  const restoreAxis = (holder, saved) => {
    if (!Array.isArray(saved?.rotationCatalog) || !Array.isArray(saved?.phases)) throw new Error('本行逐轮轴输入不完整');
    for (const key of ['rotationCatalog', 'phases', 'resonanceAxis']) holder[key] = clone(saved[key]);
  };
  out.members.forEach((member, mi) => {
    const cfg = member.cycleConfig, savedAxis = editable.members[mi].roundAxis;
    if (!cfg?.enabled) { restoreAxis(member, savedAxis?.axis); return; }
    if (!Array.isArray(cfg.rounds) || cfg.rounds.length !== Number(cfg.count) ||
        Object.keys(savedAxis?.rounds || {}).length !== cfg.rounds.length)
      throw new Error('保存轴缺少逐轮原始输入');
    const stacks = row.cycleCatalogStacks?.[mi];
    if (!Array.isArray(stacks) || stacks.length !== cfg.rounds.length)
      throw new Error('本行缺少独立保存的逐轮叠层，未从其他行补入');
    cfg.rounds.forEach((round, ri) => {
      if (!stacks[ri] || typeof stacks[ri] !== 'object' || Array.isArray(stacks[ri])) throw new Error('本行逐轮叠层快照不完整');
      restoreAxis(round, savedAxis.rounds[String(ri)]); round.catalogStacks = clone(stacks[ri]);
    });
    const activeRound = cfg.activeRound == null ? 0 : Number(cfg.activeRound);
    if (!Number.isInteger(activeRound) || activeRound < 0 || activeRound >= cfg.rounds.length)
      throw new Error('原记录当前轮次超出保存范围');
    const active = cfg.rounds[activeRound];
    for (const key of viewKeys) { if (active[key] === undefined) delete member[key]; else member[key] = clone(active[key]); }
  });
  const activeIndex = Number(out.team?.activeIndex), ownerIndex = out.members[activeIndex]?.cycleConfig?.enabled ? activeIndex : out.members.findIndex(member => member.cycleConfig?.enabled);
  const owner = out.members[ownerIndex], activeRound = owner?.cycleConfig.activeRound ?? 0;
  const singleRound = out.members.every(member => !member.cycleConfig?.enabled || member.cycleConfig.rounds.length === 1);
  const roundSpecial = owner?.cycleConfig.rounds[activeRound]?.specialSkills;
  const special = owner ? roundSpecial || (singleRound ? out.specialSkills : null) : out.specialSkills;
  if (!Array.isArray(special?.characters) || !Array.isArray(special?.items)) throw new Error('本行当前轮缺少特殊技能输入，未按名称猜测关联');
  out.specialSkills = clone(special);
  return { payload: out, evidence: { kind: 'saved-round-axis-v1', baseId: row.baseId,
    rowId: String(row.id), axisRowIds: evidenceRows, anchorAxis: true, stackRowId: String(row.id),
    sameBaseAnchorAxes: { baseId: String(anchor.baseId), recordedAt: anchor.savedAt || null,
      memberIndexes: anchor.workspace.members.map((member, mi) => mi) },
    viewRoundByMember: out.members.map(member => member.cycleConfig?.enabled ? Number(member.cycleConfig.activeRound ?? 0) : null),
    specialViewOwnerIndex: ownerIndex, specialViewRound: activeRound,
    specialInputSource: owner && roundSpecial ? 'saved-active-round' : 'saved-top-level-single-round' } };
}


  // Representation-only migration. The caller must compare old-profile and current-profile
// detailed results before adopting this clone. No library sync or invented values.
function migrateLegacyHarmonyMirrors(W, payload) {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const output = copy(payload), evidence = [];
  if (payload.configRecord?.recovery?.profile !== 'pre-special-mirror') return { payload: output, evidence };
  function migrateSpecial(special, path) {
    if (!special || !Array.isArray(special.characters) || !Array.isArray(special.items))
      throw new Error('旧版特殊技能迁移缺少完整输入');
    if (special.items.some(item => W.isSpecialBuffSourceTeam(item)))
      throw new Error('旧版全队特殊技能来源尚无经过核验的迁移');
    for (let index = 0; index < special.characters.length; index++) {
      const target = special.characters[index], roster = output.members[index];
      if (!roster) continue;
      for (const source of roster.buffs || []) {
        if (W.isInnateHarmonyBuff(source)) continue;
        const harmonic = W.isHarmonyBreakAmpBuff(source);
        const composite = W.isCompositeBuff(source) && (source.effects || []).some(fx => fx?.zone === 'harmonyBreakAmp');
        const eligible = source.teamSourceId ? W.isSpecialEffectBuffSource(source) : W.shouldSyncPersonalBuffToSpecial(source);
        if (!(harmonic || composite) || !eligible) continue;
        const mirrors = (target.buffs || []).filter(buff => buff.teamSourceId ? buff.teamSourceId === source.teamSourceId : buff.personalSourceId ? buff.personalSourceId === source.id : buff.id === source.id);
        if (mirrors.length) continue; // Existing values and explicit custom coverage remain untouched.
        if (!harmonic || !source.teamSourceId)
          throw new Error('旧版复合谐幅来源尚无经过核验的迁移');
        const id = source.id;
        if ((target.buffs || []).some(buff => buff.id === id)) throw new Error('特殊技能谐幅来源标识冲突');
        if ([...(target.excludedTeamBuffIds || []), ...(target.manuallyExcludedTeamBuffIds || [])].includes(source.teamSourceId))
          throw new Error('旧版特殊技能存在明确排除的谐幅来源，未自动迁移');
        const active = roster.globalBuffActive?.[id];
        if (typeof active !== 'boolean') throw new Error('旧版谐幅来源未保存明确覆盖状态');
        const next = copy(source);
        target.buffs = [...(target.buffs || []), next];
        target.globalBuffActive = { ...(target.globalBuffActive || {}) };
        target.globalBuffStacks = { ...(target.globalBuffStacks || {}) };
        if (target.globalBuffActive[id] === undefined) target.globalBuffActive[id] = active;
        if (target.globalBuffStacks[id] === undefined && roster.globalBuffStacks?.[id] !== undefined)
          target.globalBuffStacks[id] = copy(roster.globalBuffStacks[id]);
        evidence.push({ path, characterIndex: index, sourceBuffId: source.id, teamSourceId: source.teamSourceId,
          active, stacks: copy(roster.globalBuffStacks?.[id]) });
      }
    }
  }
  migrateSpecial(output.specialSkills, 'specialSkills');
  const effectiveSingle = output.members.every(member => !member.cycleConfig?.enabled || member.cycleConfig.rounds.length === 1);
  output.members.forEach((member, mi) => {
    if (!member.cycleConfig?.enabled) return;
    member.cycleConfig.rounds.forEach((round, ri) => {
      // The single active view already uses the original top-level input; leave absent round fields absent.
      if (effectiveSingle && !round.specialSkills) return;
      migrateSpecial(round.specialSkills, `members/${mi}/cycleConfig/rounds/${ri}/specialSkills`);
    });
  });
  return { payload: output, evidence };
}

  function completeCalculatedRecord(W, payload, fresh, migration) {
  const records = W.configRecords, copy = records.clone, meta = payload.configRecord;
  const totals = { ...copy(meta.totals), teamTotal: fresh.teamResults.total, teamDps: fresh.teamResults.dps,
    axisDuration: fresh.teamResults.axisDuration, specialTotal: fresh.specialSkills.results.total, cycleAveraged: false,
    specialItems: fresh.specialSkills.items.map(item => ({ id: item.id, name: item.name,
      kind: item.kind, total: Number(item._damage) || 0 })).filter(item => item.total > 0),
    members: meta.totals.members.map((member, index) => ({ ...member,
      cycleCount: fresh.members[index].cycleConfig?.enabled ? fresh.members[index].cycleConfig.count : 1,
      total: fresh.members[index].results.total })) };
  fresh.configRecord = { ...copy(meta), kind: 'complete', detailVersion: 1, totalKind: 'total',
    dpsDamage: fresh.teamResults.total, totals, versions: records.versions(), recordedAt: new Date().toISOString(),
    recovery: meta.recovery ? { ...copy(meta.recovery), profile: 'current',
      ...(migration ? { migrations: [...(meta.recovery.migrations || []), {
        kind: 'legacy-harmony-mirrors-v1', sources: migration.evidence }] } : {}) } : undefined };
  records.validate(fresh);
  return fresh;
}

  function refreshSavedRecord(W, payload) {
  const records = W.configRecords, copy = records.clone, meta = payload.configRecord, current = records.versions();
  records.validate(payload);
  if (meta.versions?.data && JSON.stringify(meta.versions.data) !== JSON.stringify(current.data))
    throw new Error('计算数据版本已更新，但该版本迁移尚未核验；原输入和结果未更新');
  if (!meta.versions && !['pre-special-mirror', 'current'].includes(meta.recovery?.profile))
    throw new Error('该记录缺少可核验的计算版本，原输入和结果未更新');
  let input = payload, migration;
  if (meta.recovery?.profile === 'pre-special-mirror') {
    migration = migrateLegacyHarmonyMirrors(W, payload);
    input = migration.payload;
  }
  const fresh = records.recovery.calculate(input, 'current');
  if (migration) {
    const oldRepresentation = records.recovery.calculate(payload, 'pre-special-mirror', { ownerScopedBurstCrit: false });
    const details = value => JSON.stringify({ members: value.members.map(member => member.results),
      special: value.specialSkills.results, team: value.teamResults });
    if (details(fresh) !== details(oldRepresentation))
      throw new Error('特殊技能表示迁移未能保持完整明细一致，原输入和结果未更新');
  }
  return completeCalculatedRecord(W, payload, fresh, migration);
}

  const clone = records.clone;
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.0005;
  const sum = items => items.reduce((n, item) => n + item.total, 0);
  const resultKeys = new Set(['results', 'teamResults', '_damage', '_breakdown', '_cycleDamages', '_hitBreakdowns', '_cycleRounds', '_cycleTotal']);
  function rawInputs(value) {
    if (Array.isArray(value)) return value.map(rawInputs);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !resultKeys.has(key)).map(([key, item]) => [key, rawInputs(item)]));
  }
  function inputSnapshot(state) {
    return JSON.stringify(rawInputs({ team: state.team, members: state.members, specialSkills: state.specialSkills }));
  }
  function checkRound(round) {
    if (!round?.char || !Array.isArray(round.buffs) || !Array.isArray(round.rotationCatalog) ||
        !Array.isArray(round.phases) || !round.globalBuffActive || !round.globalBuffStacks)
      throw new Error('原记录缺少完整轮次输入，未生成替代数据');
  }
  function assertDetails(payload) {
    const fail = () => { throw new Error('保存明细不完整或与合计不符，原记录未改动'); };
    const number = value => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(); return value; };
    const array = value => { if (!Array.isArray(value)) fail(); return value; };
    const equal = (a, b) => { if (!close(number(a), number(b))) fail(); };
    const energy = result => ['energyRegenBase', 'energyRegenPct', 'energyRegen'].forEach(key => number(result?.[key]));
    const totals = array(payload.members).map(member => {
      const result = member.results;
      energy(result);
      if (member.cycleConfig?.enabled) {
        const cycles = array(result.cycles);
        if (cycles.length !== member.cycleConfig.count || cycles.length !== member.cycleConfig.rounds.length) fail();
        for (const [index, cycle] of cycles.entries()) {
          energy(cycle);
          if (cycle.index !== index + 1) fail();
          equal(array(cycle.steps).reduce((n, step) => {
            if (!step.catalogId && !step.skillId) fail();
            equal(step.damage, step.breakdown?.total);
            return n + step.damage;
          }, 0), cycle.total);
        }
        equal(sum(cycles), result.total);
      } else {
        const phases = array(result.damagePhases);
        equal(phases.reduce((n, phase) => {
          const phaseTotal = array(phase.skills).reduce((s, skill) => {
            equal(skill._damage, skill._breakdown?.total);
            return s + skill._damage;
          }, 0);
          equal(phaseTotal, result.damagePhaseTotals?.[phase.id]);
          return n + phaseTotal;
        }, 0), result.total);
      }
      return number(result.total);
    });
    const special = payload.specialSkills.results, cycles = array(special.cycles);
    const count = Math.max(1, ...payload.members.map(member => member.cycleConfig?.enabled ? member.cycleConfig.count : 1));
    if (cycles.length !== count) fail();
    cycles.forEach(cycle => {
      const ids = new Set();
      equal(array(cycle.items).reduce((n, item) => {
        if (!item.id || ids.has(item.id)) fail();
        ids.add(item.id);
        equal(item.total, item.breakdown?.total);
        return n + item.total;
      }, 0), cycle.total);
    });
    equal(sum(cycles), special.total);
    equal(totals.reduce((a, b) => a + b, 0) + special.total, payload.teamResults.total);
    if (!(number(payload.teamResults.axisDuration) > 0)) fail();
    equal(payload.teamResults.dps * payload.teamResults.axisDuration, payload.teamResults.total);
    return true;
  }
  function usesOwnerScopedBurstCrit(meta, profile) {
    // 2026-08-28 deployment expanded owner-only burst crit to the full team.
    // Exclude the entire deployment date: exact within-day cutover is not known here.
    const date = Date.parse(meta?.recordedAt || '');
    return profile === 'pre-special-mirror' && Number.isFinite(date) && date < Date.parse('2026-08-27T16:00:00Z');
  }
  // Explicit save may encounter pre-existing matrix pollution in a linked row.
  // Its own complete library proves a missing parent; passive refresh stays strict.
  function prepareEditedSources(payload) {
    if (!Array.isArray(payload?.team?.sharedBuffs?.buffs))
      throw new Error('本配置缺少完整来源库，未猜测或清理历史 Buff');
    const output = clone(payload), parents = new Map(output.team.sharedBuffs.buffs.map(buff => [buff.id, buff]));
    const missing = new Set();
    // The catalogue proves identity only; no values or coverage are imported from it.
    const known = new Map([...(W.MatrixBuff?.getPresets() || []), ...(W.MatrixBuff?.getCharacterPresets() || [])]
      .flatMap(preset => (preset.effects || []).map(effect => ['matrix_' +
        preset.period.toLowerCase().replace('-', '_') + '_' + preset.id + '_' + effect.key,
        { presetId: preset.id, period: preset.period.toLowerCase().replace('-', '_') }])));
    const sourceId = key => {
      const id = String(key || '').split('::')[0];
      return id.startsWith('tm_matrix_') ? id.slice(3) : id.startsWith('matrix_') ? id : null;
    };
    const remember = key => {
      const id = sourceId(key);
      if (!id || parents.has(id)) return;
      if (!known.has(id)) throw new Error('无法确认矩阵来源身份：' + id + '，原配置未更新');
      missing.add(id);
    };
    const skip = key => key.startsWith('_') && key !== '_autoMatchedFalse' ||
      ['configRecord', 'configRecordView', 'results', 'teamResults', 'exportConfigSnapshots', 'exportConfigAnchor'].includes(key);
    function visit(node, context) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) {
          if (typeof item === 'string' && /^(excludedTeamBuffIds|manuallyExcludedTeamBuffIds)$/.test(context)) remember(item);
          else visit(item, context);
        }
        return;
      }
      const identity = known.get(sourceId(node.teamSourceId || node.id));
      if (node.matrixSource && identity &&
          (node.matrixSource.presetId && node.matrixSource.presetId !== identity.presetId ||
           node.matrixSource.period && String(node.matrixSource.period).toLowerCase().replace('-', '_') !== identity.period))
        throw new Error('矩阵来源身份冲突：' + (node.teamSourceId || node.id) + '，原配置未更新');
      if (node.teamSourceId && sourceId(node.teamSourceId)) {
        const parent = parents.get(node.teamSourceId);
        if (parent && node.matrixSource?.presetId && parent.matrixSource?.presetId !== node.matrixSource.presetId)
          throw new Error('矩阵来源身份冲突：' + node.teamSourceId + '，原配置未更新');
        remember(node.teamSourceId);
      }
      if (context === 'buffs' && node.matrixSource || /^(buffActiveSig|buffStacksSig|frozenBuffActiveSig|frozenBuffStacksSig)$/.test(context)) remember(node.id);
      for (const [key, value] of Object.entries(node)) {
        if (skip(key)) continue;
        remember(key);
        visit(value, key);
      }
    }
    visit(output);
    const sourceIds = [...missing].sort();
    pruneMatrixSources(output, sourceIds);
    if (sourceIds.length && output.configRecord) {
      output.configRecord.inputRecovery = { ...output.configRecord.inputRecovery,
        matrixSourceCleanup: { policy: 'own-library-explicit-save', sourceIds } };
    }
    return { payload: output, sourceIds };
  }

  // Source removal is an explicit input edit, not a side effect of rendering/recalculation.
  function pruneMatrixSources(payload, ids) {
    const removed = new Set(ids), keys = new Set(ids.flatMap(id => [id, W.makeTeamMirrorBuffId(id)]));
    const maps = new Set(['globalBuffActive', 'globalBuffStacks', 'buffActive', 'buffStacks',
      'frozenBuffActive', 'frozenBuffStacks', 'specialSourceControls', 'stackLayers', '_autoMatchedFalse']);
    const skip = key => key.startsWith('_') && key !== '_autoMatchedFalse' || ['configRecord', 'configRecordView',
      'results', 'teamResults', 'exportConfigSnapshots', 'exportConfigAnchor'].includes(key);
    function collect(node) {
      if (!node || typeof node !== 'object') return;
      for (const buff of node.buffs || []) if (removed.has(buff.teamSourceId)) keys.add(buff.id);
      for (const [key, value] of Object.entries(node)) if (!skip(key)) collect(value);
    }
    collect(payload);
    const gone = key => keys.has(String(key).split('::')[0]);
    const walk = (node, context) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const item = node[i];
          if (context === 'buffs' && (removed.has(item?.teamSourceId) || gone(item?.id)) ||
              /^(excludedTeamBuffIds|manuallyExcludedTeamBuffIds)$/.test(context) && removed.has(item) ||
              /^(buffActiveSig|buffStacksSig|frozenBuffActiveSig|frozenBuffStacksSig)$/.test(context) && gone(item?.id)) node.splice(i, 1);
          else walk(item, context);
        }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (skip(key)) continue;
        if (maps.has(context) && gone(key)) delete node[key];
        else if (context === 'catalogStacks' && value && typeof value === 'object') {
          for (const id of Object.keys(value)) if (gone(id)) delete value[id];
        } else walk(value, key);
      }
    };
    if (removed.size) walk(payload);
    return payload;
  }
  // Stable template/source identities in this very record can prove a legacy ID
  // remap. Never use today's template library or a display name as evidence.
  function specialSourceAliases(payload) {
    const shared = payload.team?.sharedBuffs?.buffs || [], sourceIds = new Set(shared.map(buff => buff.id));
    const aliases = new Map(), definitions = new Map();
    const identity = buff => JSON.stringify(['templateKey', 'sourceCharacterId', 'category',
      'damageType', 'effectType', 'combatModeKey', 'defenseKind'].map(key => buff[key] || ''));
    function collect(node) {
      if (!node || typeof node !== 'object') return;
      for (const buff of node.buffs || []) {
        definitions.set(buff.id, buff);
        if (!buff.teamSourceId || sourceIds.has(buff.teamSourceId) || buff.matrixSource || !buff.templateKey) continue;
        const candidates = shared.filter(source => !source.matrixSource && identity(source) === identity(buff));
        if (candidates.length === 1) aliases.set(buff.id, { source: candidates[0], id: W.makeTeamMirrorBuffId(candidates[0].id) });
      }
      for (const key of ['members', 'cycleConfig', 'rounds', 'specialSkills', 'characters']) {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(collect); else collect(value);
      }
    }
    collect(payload);
    return { aliases, definitions };
  }
  function specialItemSlot(value, item) {
    if (W.isSpecialBuffSourceTeam(item)) return -1;
    const characters = value?.characters || [];
    const linked = item.characterId ? characters.findIndex(character => character.id === item.characterId) : -1;
    if (linked >= 0) return linked;
    const legacy = Number.isFinite(item.memberIndex) ? item.memberIndex : 0;
    return Math.min(characters.length - 1, Math.max(0, legacy));
  }
  function checkSources(payload, options = {}) {
    const sources = new Set((payload.team?.sharedBuffs?.buffs || []).map(buff => buff.id));
    const issues = [];
    const evidence = specialSourceAliases(payload);
    const derivedSpecial = id => options.allowDerivedSpecial && (evidence.aliases.has(id) || id.startsWith('tm_') &&
      (payload.team?.sharedBuffs?.buffs || []).some(buff => buff.id === id.slice(3) && W.isSpecialEffectBuffSource(buff)));
    function holder(target, path, isSpecial = false, explicit = new Set()) {
      if (!target) return;
      const definitions = new Set((target.buffs || []).map(buff => buff.id));
      const inspect = (map, location) => {
        for (const [key, active] of Object.entries(map || {})) {
          if (!active) continue;
          const id = key.split('::')[0];
          const sourceId = id.startsWith('tm_') ? id.slice(3) : null;
          if (sourceId && [...(target.excludedTeamBuffIds || []), ...(target.manuallyExcludedTeamBuffIds || [])].includes(sourceId)) continue;
          const dormantSpecialGlobal = isSpecial && location.endsWith('/globalBuffActive') &&
            !id.startsWith('tm_matrix_') && !explicit.has(id);
          if (!definitions.has(id) && dormantSpecialGlobal) options.diagnostics?.push({
            path: location, id, kind: 'dormant-special-global-key', action: '保留未被定义或条目消费的历史全局键，不生成增益' });
          if (!definitions.has(id) && !(isSpecial && derivedSpecial(id)) && !dormantSpecialGlobal)
            issues.push({ path: location, id, reason: '缺少启用 Buff 定义' });
        }
      };
      for (const buff of target.buffs || []) {
        const sourceId = buff.teamSourceId || (String(buff.id).startsWith('tm_matrix_') ? buff.id.slice(3) : null);
        if (sourceId?.startsWith('matrix_') && !sources.has(sourceId))
          issues.push({ path, id: buff.id, sourceId, reason: '矩阵父来源不存在' });
      }
      inspect(target.globalBuffActive, path + '/globalBuffActive');
      function units(node, location) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach((child, i) => units(child, location + '/' + i));
        if (node.locked) inspect(node.frozenBuffActive, location + '/frozenBuffActive');
        else if (node.buffMode === 'custom') inspect(node.buffActive, location + '/buffActive');
        for (const key of ['skills', 'hits', 'phases', 'rotationCatalog']) if (node[key]) units(node[key], location + '/' + key);
      }
      units({ phases: target.phases, rotationCatalog: target.rotationCatalog }, path);
      if (target.resonanceAxis) {
        const effective = W.buildResonanceAxisView(target.resonanceAxis, 'damage');
        units(effective, path + '/effectiveAxis');
        records.references.visit(effective, (map, boolean) => {
          if (boolean) return;
          for (const [key, value] of Object.entries(map)) if (Number(value) > 0 && !definitions.has(key.split('::')[0]))
            issues.push({ path: path + '/effectiveAxis/stacks', id: key, reason: '叠层引用缺少Buff定义' });
        }, () => {});
      }
    }
    function special(value, path) {
      (value?.characters || []).forEach((character, i) => {
        const explicit = new Set((value.items || []).filter(item => specialItemSlot(value, item) === i).flatMap(item =>
          Object.entries(item.locked ? item.frozenBuffActive || {} : item.buffMode === 'custom' ? item.buffActive || {} : {})
            .filter(([, on]) => on === true).map(([key]) => key))
          .map(key => key.split('::')[0]));
        holder(character, path + '/characters/' + i, true, explicit);
      });
      for (const item of value?.items || []) {
        const character = W.isSpecialBuffSourceTeam(item) ? { buffs: payload.team?.sharedBuffs?.buffs || [] } :
          value.characters?.[specialItemSlot(value, item)];
        if (!character) continue;
        const definitions = new Set((character.buffs || []).map(buff => buff.id));
        const active = item.locked ? item.frozenBuffActive : item.buffMode === 'custom' ? item.buffActive : {};
        for (const [key, on] of Object.entries(active || {})) if (on && !definitions.has(key.split('::')[0]) && !derivedSpecial(key.split('::')[0]))
          issues.push({ path: path + '/items/' + item.id, id: key, reason: '缺少特殊技能启用 Buff 定义' });
      }
    }
    (payload.members || []).forEach((member, mi) => {
      holder(member, 'members/' + mi);
      (member.cycleConfig?.rounds || []).forEach((round, ri) => {
        holder(round, 'members/' + mi + '/rounds/' + ri);
        special(round.specialSkills, 'members/' + mi + '/rounds/' + ri + '/specialSkills');
      });
    });
    special(payload.specialSkills, 'specialSkills');
    if (issues.length) {
      const first = issues[0], error = new Error(first.reason + '：' + first.path + ' / ' + first.id + '；原记录和结果未更新');
      error.code = 'CONFIG_SOURCE_MISSING'; error.issues = issues; throw error;
    }
    return true;
  }
  // Special libraries are derived from each round's evidenced sources. Missing
  // mirrors can be rebuilt; a missing matrix parent was rejected before this step.
  function withRoundMembers(index, work) {
    const members = W.state.members, team = W.state.team;
    try {
      W.state.members = clone(members).map(member => member.cycleConfig?.enabled && member.cycleConfig.rounds?.[index]
        ? { ...member, ...clone(member.cycleConfig.rounds[index]), cycleConfig: { ...member.cycleConfig, activeRound: index } }
        : member);
      W.state.team = clone(team);
      return work();
    } finally { W.state.members = members; W.state.team = team; }
  }
  function prepareSpecialSources(payload, diagnostics) {
    const live = W.state.specialSkills;
    const evidence = specialSourceAliases(payload);
    const owner = W.getSpecialSkillsRoundOwner();
    const active = owner?.cycleConfig?.enabled ? Number(owner.cycleConfig.activeRound) || 0 : 0;
    const count = owner?.cycleConfig?.enabled ? owner.cycleConfig.rounds.length : 1;
    try {
      for (let ri = 0; ri < count; ri++) {
        const special = ri === active ? live : owner.cycleConfig.rounds[ri]?.specialSkills;
        if (!special) throw new Error('本轮缺少特殊技能输入，未猜测其他轮配置');
        W.state.specialSkills = special;
        withRoundMembers(ri, () => {
          (special.characters || []).forEach((target, slot) => {
            target.buffs ||= []; target.globalBuffActive ||= {}; target.globalBuffStacks ||= {};
            for (const [oldId, alias] of evidence.aliases) {
              const used = target.buffs.some(buff => buff.id === oldId) ||
                Object.keys(target.globalBuffActive).some(key => key.split('::')[0] === oldId) ||
                (special.items || []).some(item => specialItemSlot(special, item) === slot &&
                  [item.buffActive, item.buffStacks, item.frozenBuffActive, item.frozenBuffStacks].some(map =>
                    Object.keys(map || {}).some(key => key.split('::')[0] === oldId)));
              if (!used) continue;
              const oldSource = evidence.definitions.get(oldId)?.teamSourceId;
              for (const field of ['excludedTeamBuffIds', 'manuallyExcludedTeamBuffIds']) if (Array.isArray(target[field]))
                target[field] = [...new Set(target[field].map(id => id === oldSource ? alias.source.id : id))];
              const transfer = (node, field) => {
                const map = node[field];
                for (const key of Object.keys(map || {})) {
                  if (key.split('::')[0] !== oldId) continue;
                  const next = alias.id + key.slice(oldId.length);
                  if (map[next] === undefined || /Active$/.test(field) && map[key] === false) map[next] = map[key];
                  delete map[key];
                }
              };
              for (const field of ['globalBuffActive', 'globalBuffStacks', 'specialSourceControls']) transfer(target, field);
              target.buffs = target.buffs.filter(buff => buff.id !== oldId);
              for (const item of special.items || []) if (specialItemSlot(special, item) === slot) {
                for (const field of ['buffActive', 'buffStacks', 'frozenBuffActive', 'frozenBuffStacks', '_autoMatchedFalse']) transfer(item, field);
                for (const field of ['buffActiveSig', 'buffStacksSig', 'frozenBuffActiveSig', 'frozenBuffStacksSig'])
                  for (const row of item[field] || []) if (row.id === oldId) row.id = alias.id;
              }
              diagnostics?.push({ kind: 'record-source-id-remap', round: ri + 1, slot,
                from: oldId, to: alias.id, templateKey: alias.source.templateKey,
                sourceCharacterId: alias.source.sourceCharacterId });
            }
            const roster = W.state.members[slot];
            const excluded = new Set([...(target.excludedTeamBuffIds || []), ...(target.manuallyExcludedTeamBuffIds || [])]);
            for (const source of payload.team?.sharedBuffs?.buffs || []) {
              if (!W.isSpecialTeamBuffMirror(source, slot) || excluded.has(source.id)) continue;
              if (target.buffs.some(buff => buff.teamSourceId === source.id)) continue;
              const id = W.makeTeamMirrorBuffId(source.id);
              const recipient = (roster?.buffs || []).find(buff => buff.teamSourceId === source.id);
              const hasEvidence = Object.keys(target.globalBuffActive).some(key => key.split('::')[0] === id) ||
                (special.items || []).some(item => [item.buffActive, item.frozenBuffActive].some(map =>
                  Object.keys(map || {}).some(key => key.split('::')[0] === id))) ||
                recipient && typeof roster.globalBuffActive?.[recipient.id] === 'boolean';
              if (!hasEvidence) continue;
              if (target.buffs.some(buff => buff.id === id)) throw new Error('特殊技能来源标识冲突：' + id);
              target.buffs.push({ id, ...W.mirrorTeamBuffPayload(source) });
              if (target.globalBuffActive[id] === undefined) target.globalBuffActive[id] = recipient
                ? roster.globalBuffActive?.[recipient.id] === true : false;
              if (target.globalBuffStacks[id] === undefined && recipient && roster.globalBuffStacks?.[recipient.id] !== undefined)
                target.globalBuffStacks[id] = clone(roster.globalBuffStacks[recipient.id]);
            }
          });
        });
        for (const member of payload.members || []) if (member.cycleConfig?.rounds?.[ri])
          member.cycleConfig.rounds[ri].specialSkills = clone(W.state.specialSkills);
      }
    } finally { W.state.specialSkills = live; }
  }
  // Equipment is member-scoped; round panels contain derived Echo rows, not a
  // second loadout. Rebuild only owned rows before current-version calculation.
  function prepareEchoPanels(payload) {
    const numeric = ['atkPercent', 'critRate', 'critDmg', 'energyRegenPct', 'flatAtk',
      'hpPercent', 'flatHp', 'defPercent', 'flatDef'];
    const managed = row => {
      const id = String(row?.id || '');
      return id === W.ECHO_SOURCE_ID || id.startsWith(W.ECHO_ATTR_SOURCE_PREFIX) ||
        id.startsWith(W.ECHO_TYPE_DMG_SOURCE_PREFIX) || id.startsWith('echo_panel_dmg_elem_') ||
        id.startsWith('echo_panel_dmg_type_');
    };
    const changes = [];
    for (const [index, member] of (payload.members || []).entries()) {
      const holders = [{ node: member, char: member.char, path: 'members/' + index + '/char' },
        ...(member.cycleConfig?.enabled ? (member.cycleConfig.rounds || []).map((round, ri) =>
          ({ node: round, char: round.char, path: 'members/' + index + '/rounds/' + ri + '/char' })) : [])];
      const hasManaged = holders.some(holder => Object.values(holder.char || {}).some(rows =>
        Array.isArray(rows) && rows.some(managed)));
      if (!Array.isArray(member.echoConfig?.slots) || !member.echoConfig.slots.length) {
        if (hasManaged) throw new Error('角色' + (index + 1) + '缺少可核验的声骸配装，未猜测面板');
        continue;
      }
      const layout = W.ECHO_LAYOUTS[member.echoConfig.layout];
      if (!layout || member.echoConfig.slots.length !== layout.costs.length ||
          member.echoConfig.slots.some((slot, si) => Number(slot?.cost) !== layout.costs[si]))
        throw new Error('角色' + (index + 1) + '声骸配装槽位不完整，未按默认配装猜补');
      for (const slot of member.echoConfig.slots) {
        const options = W.ECHO_MAIN1_OPTIONS[Number(slot?.cost)];
        const option = options?.find(value => value.id === slot.main1);
        if (!options || typeof slot.main1 !== 'string' || (slot.main1 && !option) || !Array.isArray(slot.subs) ||
            slot.subs.some(sub => !W.ECHO_SUB_AFFIXES[sub?.id] || !Number.isFinite(Number(sub.value))) ||
            option?.needsElement && !W.ECHO_ELEMENTS.includes(slot.main1Element))
          throw new Error('角色' + (index + 1) + '声骸配装字段不完整，未按默认主词条猜补');
      }
      // aggregateEchoStats may normalize the config; keep that normalization private.
      const carrier = { ...member, echoConfig: clone(member.echoConfig) };
      const aggregate = W.aggregateEchoStats(carrier), generated = {};
      numeric.forEach(stat => W.upsertEchoCharSource(generated, stat, aggregate[stat]));
      W.syncEchoAttrBonusSources(generated, aggregate);
      W.syncEchoTypeDmgBonusSources(generated, aggregate);
      for (const holder of holders) {
        if (!holder.char) throw new Error('本轮缺少角色面板，未生成替代输入');
        for (const [key, rows] of Object.entries(generated)) {
          const before = holder.char[key] || [];
          const after = [...before.filter(row => !managed(row)), ...clone(rows)];
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            holder.char[key] = after;
            changes.push({ path: holder.path + '/' + key });
          }
        }
      }
      // This personal conversion consumes the newly prepared, round-owned ER panel.
      // Reuse its formula while retaining explicit round coverage and stack maps.
      for (const holder of holders) if ((holder.node.buffs || []).some(W.isMoningCriticalProtocolErBuff)) {
        W.syncMoningCriticalProtocolErConvert({ ...member, char: holder.char, buffs: holder.node.buffs,
          globalBuffActive: { ...holder.node.globalBuffActive } });
      }
      member._echoFlatAtk = aggregate.flatAtk;
      member._echoSummary = clone(aggregate);
    }
    return changes;
  }

  // Historical ID aliases require definitions from the same imported base and
  // roster. They carry identity only; values always remain in the saved input.
  function referenceIdentity(buff, payload, recipient) {
    if (!buff?.templateKey || buff.matrixSource) return null;
    let source = buff, owner = recipient, scope = 'personal';
    if (buff.teamSourceId) {
      source = payload.team?.sharedBuffs?.buffs?.find(b => b.id === buff.teamSourceId);
      if (!source || source.matrixSource) return null;
      owner = W.getTeamBuffSourceMemberIndex(source); scope = 'team';
    }
    if (!Number.isInteger(owner) || owner < 0 || !payload.members?.[owner]) return null;
    const character = String(source.sourceCharacterId || payload.members[owner].characterId || '');
    if (character !== String(payload.members[owner].characterId || '')) return null;
    return JSON.stringify([scope, owner, character, source.templateKey, buff.category || '',
      buff.damageType || '', buff.effectType || '', buff.combatModeKey || '', buff.defenseKind || '']);
  }
  function referenceEvidence(data, row) {
    const roster = (data.members || []).map(m => String(m.id || ''));
    if (roster.length !== 3 || roster.some(id => !id)) return null;
    const sameRoster = p => p?.members?.length === roster.length &&
      p.members.every((m, i) => String(m.id) === roster[i] && String(m.characterId) === String(data.members[i].characterId));
    const entries = new Map();
    const add = item => {
      const key = item.recipient + '\0' + item.id + '\0' + item.identity;
      entries.set(key, item);
    };
    const candidates = [data];
    const rows = data.exportConfigSnapshots || [];
    const selected = row || rows.find(r => r.id === data.configRecordView?.rowId);
    const bases = [...new Set(rows.filter(r => sameRoster(r.payload)).map(r => r.baseId).filter(Boolean))];
    const baseId = selected?.baseId || (bases.length === 1 ? bases[0] : null);
    const previous = data.buffReferenceEvidence;
    if (previous?.version === 1 && previous.baseId === baseId && JSON.stringify(previous.roster) === JSON.stringify(roster))
      (previous.definitions || []).forEach(add);
    if (baseId) for (const saved of rows)
      if (saved.baseId === baseId && sameRoster(saved.payload)) candidates.push(saved.payload);
    for (const payload of candidates) for (const [recipient, member] of (payload.members || []).entries()) {
      for (const holder of [member, ...(member.cycleConfig?.rounds || [])]) for (const buff of holder.buffs || []) {
        const identity = referenceIdentity(buff, payload, recipient);
        if (identity) add({ recipient, id: buff.id, identity });
      }
    }
    return { version: 1, baseId, roster, definitions: [...entries.values()] };
  }
  function prepareReferences(payload) {
    const evidence = payload.buffReferenceEvidence;
    if (!evidence) return [];
    if (evidence.version !== 1 || JSON.stringify(evidence.roster) !== JSON.stringify((payload.members || []).map(m => String(m.id))))
      throw new Error('Buff引用证据与当前队伍不一致，未迁移历史层数');
    const changed = [];
    for (const [recipient, member] of payload.members.entries()) {
      const bank = new Map();
      for (const item of evidence.definitions || []) if (item.recipient === recipient) {
        if (!bank.has(item.id)) bank.set(item.id, new Set());
        bank.get(item.id).add(item.identity);
      }
      for (const holder of [member, ...(member.cycleConfig?.rounds || [])]) {
        const definitions = holder.buffs || [], ids = new Set(definitions.map(b => b.id)), aliases = new Map();
        for (const [oldId, identities] of bank) {
          if (ids.has(oldId) || identities.size !== 1) continue;
          const identity = [...identities][0];
          const matches = definitions.filter(b => referenceIdentity(b, payload, recipient) === identity);
          if (matches.length === 1) aliases.set(oldId, matches[0].id);
        }
        for (const [from, to] of aliases) {
          let used = false;
          records.references.visit(holder, (map, boolean) => {
            for (const [key, value] of Object.entries(map)) if (key.split('::')[0] === from) {
              used = true; const next = to + key.slice(from.length);
              if (map[next] !== undefined && JSON.stringify(map[next]) !== JSON.stringify(value) &&
                  (boolean || Number(value) > 0)) throw new Error('历史Buff新旧引用值冲突，未猜测层数：' + from);
            }
          }, rows => { if (rows.some(r => String(r.id).split('::')[0] === from)) used = true; });
          if (used) { records.references.remap(holder, from, to); changed.push({ recipient, from, to }); }
        }
      }
    }
    return changed;
  }

  function calculateCurrent(payload) {
    if (records.recoveryContext || records.currentCalculating) throw new Error('已有配置计算正在进行');
    // Validate before sync helpers can erase evidence of missing effective definitions.
    const repairedView = clone(payload), diagnostics = [];
    prepareReferences(repairedView);
    records.restoreSavedRoundTeamBuffs(repairedView);
    checkSources(repairedView, { allowDerivedSpecial: true, diagnostics });
    const saved = records.snapshotState(), state = W.state;
    const input = records.writeInputs(repairedView, records.inputs(repairedView));
    try {
      Object.assign(state, clone(input));
      state.buffReferenceEvidence = clone(input.buffReferenceEvidence || null);
      delete state.configRecordView;
      state._workspaceImporting = false;
      records.view = null; records.computed = null; records.currentCalculating = true;
      prepareEchoPanels(state);
      prepareSpecialSources(state, diagnostics);
      checkSources(state, { diagnostics });
      records.runCurrent();
      checkSources(state);
      const output = clone(payload);
      for (const key of ['team', 'members', 'specialSkills', 'teamResults']) output[key] = clone(state[key]);
      if (diagnostics.length) output._sourceDiagnostics = [...new Map(diagnostics.map(row => [JSON.stringify(row), row])).values()];
      assertDetails(output);
      return output;
    } finally {
      records.currentCalculating = false;
      records.restoreState(saved);
    }
  }

  function calculate(payload, profile, options = {}) {
    if (profile === 'current') return calculateCurrent(payload);
    if (records.recoveryContext) throw new Error('已有历史恢复计算正在进行');
    const saved = records.snapshotState(), state = W.state;
    Object.assign(state, clone(payload));
    const before = inputSnapshot(state);
    records.recoveryContext = { profile, ownerScopedBurstCrit: options.ownerScopedBurstCrit === false ? false : usesOwnerScopedBurstCrit(payload.configRecord, profile) };
    try {
      for (const member of state.members) {
        if (member.cycleConfig?.enabled) {
          if (member.cycleConfig.rounds.length !== member.cycleConfig.count) throw new Error('原记录轮数不完整');
          member.cycleConfig.rounds.forEach(checkRound);
          W.computeMemberWithCycles(member);
        } else {
          checkRound(member);
          const originalPhases = member.phases, originalCatalog = member.rotationCatalog;
          const view = member.resonanceAxis ? W.buildResonanceAxisView(member.resonanceAxis, 'damage') : null;
          let damageResults, damagePhases;
          try {
            member.phases = clone(view ? view.phases : originalPhases);
            member.rotationCatalog = clone(view ? view.rotationCatalog : originalCatalog);
            damageResults = W.computeMemberPhaseDamages(member);
            damagePhases = clone(member.phases);
          } finally { member.phases = originalPhases; member.rotationCatalog = originalCatalog; }
          const editResults = W.computeMemberPhaseDamages(member);
          member.results = { ...damageResults, damagePhases, damagePhaseTotals: clone(damageResults.phases),
            phases: editResults.phases, energyRegenBase: editResults.energyRegenBase,
            energyRegenPct: editResults.energyRegenPct, energyRegen: editResults.energyRegen };
        }
      }
      const owner = W.getSpecialSkillsRoundOwner(), live = state.specialSkills;
      const count = owner?.cycleConfig?.enabled ? owner.cycleConfig.rounds.length : 1;
      const effectiveSingle = state.members.every(member => !member.cycleConfig?.enabled || member.cycleConfig.rounds.length === 1);
      const topLevelSingleSource = owner?.cycleConfig?.enabled && effectiveSingle && !owner.cycleConfig.rounds[0].specialSkills;
      const cycles = [];
      for (let index = 0; index < count; index++) {
        const original = owner?.cycleConfig?.enabled
          ? owner.cycleConfig.rounds[index].specialSkills || (effectiveSingle ? live : null) : live;
        if (!original || !Array.isArray(original.items) || !Array.isArray(original.characters))
          throw new Error('原记录缺少本轮特殊技能输入');
        state.specialSkills = clone(original);
        Object.defineProperty(state.specialSkills, '_calcRoundIndex', { value: index });
        const items = state.specialSkills.items.map(item => {
          const breakdown = item.kind === 'execution' ? W.calcExecutionBreakdown(item) :
            item.kind === 'effect' ? W.calcEffectBreakdown(item) : null;
          if (!breakdown || !Number.isFinite(breakdown.total)) throw new Error('特殊技能结果无效');
          return { id: item.id, kind: item.kind, name: item.name, ownerIndex: W.getSpecialSkillRosterIndex(item),
            total: breakdown.total, critTotal: breakdown.critTotal, breakdown };
        });
        cycles.push({ total: sum(items), items });
      }
      state.specialSkills = live;
      const duration = Number(options.useInputDuration ? W.getTeamResultsDuration() : payload.configRecord?.totals?.axisDuration ?? state.team.axisDuration);
      if (!(duration > 0)) throw new Error('原记录缺少有效轴长');
      state.specialSkills.results = { total: sum(cycles), axisDuration: duration, dps: sum(cycles) / duration, cycles };
      const active = owner?.cycleConfig?.activeRound || 0;
      for (const item of live.items) {
        const savedItem = cycles[active].items.find(entry => entry.id === item.id);
        if (!savedItem) throw new Error('当前轮特殊技能与保存轮次不一致');
        item._damage = savedItem.total; item._breakdown = clone(savedItem.breakdown);
        item._cycleRounds = count;
        item._cycleTotal = cycles.reduce((n, cycle) => n + (cycle.items.find(entry => entry.id === item.id)?.total || 0), 0);
      }
      const members = state.members.map(member => member.results.total);
      const total = members.reduce((n, value) => n + value, 0) + state.specialSkills.results.total;
      state.teamResults = { total, dps: total / duration, axisDuration: duration,
        breakdown: [...state.members.map((member, i) => ({ id: member.id, name: member.name, total: members[i], sharePct: total ? members[i] / total * 100 : 0 })),
          { id: 'special', name: '特殊技能', total: state.specialSkills.results.total, sharePct: total ? state.specialSkills.results.total / total * 100 : 0 }] };
      if (inputSnapshot(state) !== before) throw new Error('计算改变了保存输入，结果未采用');
      const output = clone(payload);
      for (const key of ['members', 'specialSkills', 'teamResults']) output[key] = clone(state[key]);
      if (topLevelSingleSource && output.configRecord) output.configRecord.inputRecovery = {
        ...clone(output.configRecord.inputRecovery || {}), specialInputSource: 'saved-top-level-single-round',
        specialSourcePath: 'specialSkills', specialViewRound: 0 };
      assertDetails(output);
      return output;
    } finally {
      records.recoveryContext = null;
      records.restoreState(saved);
    }
  }
  function restore(payload, profile) {
    const meta = payload.configRecord;
    if (meta?.kind !== 'legacy-summary') return payload;
    const output = calculate(payload, profile), old = meta.totals;
    const errors = [];
    output.members.forEach((member, i) => {
      const expected = old.members[i].total * (meta.totalKind === 'cycle-average' ? old.members[i].cycleCount : 1);
      if (!close(member.results.total, expected)) errors.push({ member: member.name, old: expected, calculated: member.results.total });
    });
    if (!close(output.specialSkills.results.total, old.specialTotal)) errors.push({ member: '特殊技能', old: old.specialTotal, calculated: output.specialSkills.results.total });
    if (!close(output.teamResults.dps, old.teamDps)) errors.push({ member: 'DPS', old: old.teamDps, calculated: output.teamResults.dps });
    if (errors.length) {
      const error = new Error('历史明细与保存记录尚未对齐，原记录保持不变');
      error.differences = errors; throw error;
    }
    output.configRecord = { ...clone(meta), kind: 'complete', detailVersion: 1, totalKind: 'total', dpsDamage: output.teamResults.total, totals: { ...clone(old),
      teamTotal: output.teamResults.total, teamDps: output.teamResults.dps, specialTotal: output.specialSkills.results.total,
      members: old.members.map((member, i) => ({ ...member, total: output.members[i].results.total })) },
      recovery: { profile, historicalRules: usesOwnerScopedBurstCrit(meta, profile) ? ['owner-burst-crit-before-20260828'] : [], originalTotals: clone(old), originalTotalKind: meta.totalKind, inputSources: clone(output.configRecord?.inputRecovery || meta.inputRecovery) } };
    delete output.configRecordView;
    return output;
  }
  function profileFor(meta) {
    const date = Date.parse(meta.recordedAt);
    // Last evidenced release with the previous rule. The deployment interval stays unknown.
    return Number.isFinite(date) && date < Date.parse('2026-10-16T00:00:00Z') ? 'pre-special-mirror' : 'current';
  }
  function attachImportedMain() {
    const state = W.state, payload = records.payload(), totals = payload.configRecord.totals;
    if (!state._workspaceImporting || !state.configRecordView?.recovery) return;
    for (const row of state.exportConfigSnapshots || []) {
      if (row.payload || row.payloadId || row.members?.length !== state.members.length) continue;
      if (!close(row.teamDps, totals.teamDps) || !close(row.teamTotal, totals.teamTotal) || !close(row.specialTotal || 0, totals.specialTotal || 0)) continue;
      if (!row.members.every((member, i) => String(member.characterId) === String(state.members[i].characterId) &&
          Number(member.chain) === Number(state.members[i].resonanceUnlocked) &&
          Number(member.refinement) === Number(state.members[i].weaponSelection?.refinement) &&
          close(member.total, totals.members[i].total))) continue;
      row.payload = clone(payload);
    }
  }
  records.recovery = { calculate, calculateCurrent, referenceEvidence, prepareReferences, prepareEchoPanels, checkSources, pruneMatrixSources, withRoundMembers, restore, profileFor, attachImportedMain, assertDetails,
    prepareEditedSources,
    refreshSavedForEdit: payload => refreshSavedRecord(W, prepareEditedSources(payload).payload),
    refreshSaved: payload => refreshSavedRecord(W, payload),
    completeEdited: payload => completeCalculatedRecord(W, payload, calculate(payload, 'current', { useInputDuration: true })),
    resolveInputs: (data, row, payload) => recoverSavedRowInputs(W, data, row, payload) };
})();
