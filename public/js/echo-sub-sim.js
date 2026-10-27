/**
 * 声骸副词条收益模拟（独立预览，不写回 echoConfig / 不重跑轴）
 * 依赖：ECHO_SUB_AFFIXES、ECHO_SUB_TYPE_DAMAGE_TYPES 等已由 core.js 加载
 *
 * 注意：core 里这些表是顶层 const，不会挂到 window 上；
 * 必须用词法作用域里的 ECHO_SUB_AFFIXES，不能写 global.ECHO_SUB_AFFIXES。
 */
(function (global) {
  'use strict';

  const MARGIN_STEP = 1; // 百分点（与项目单位一致）

  function getEchoSubAffixes() {
    // 优先词法全局（classic script 的 const），其次 window（若有人挂过）
    if (typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES) return ECHO_SUB_AFFIXES;
    return global.ECHO_SUB_AFFIXES || {};
  }

  function getEchoSubTypeDamageTypes() {
    if (typeof ECHO_SUB_TYPE_DAMAGE_TYPES !== 'undefined' && ECHO_SUB_TYPE_DAMAGE_TYPES) {
      return ECHO_SUB_TYPE_DAMAGE_TYPES;
    }
    return global.ECHO_SUB_TYPE_DAMAGE_TYPES || ['普攻', '重击', '共鸣技能', '共鸣解放'];
  }

  function clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function critExpectFromPct(critRatePct, critDmgPct) {
    const cr = clamp(critRatePct, 0, 100) / 100;
    const cd = Math.max(0, Number(critDmgPct) || 0) / 100;
    return (1 - cr) + cr * cd;
  }

  function deepCloneJson(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /** 克隆面板时保留 erConverts（含函数，不能 JSON 序列化） */
  function clonePanel(panel) {
    const erConverts = panel?.erConverts;
    const p = deepCloneJson({ ...panel, erConverts: undefined });
    p.erConverts = erConverts || [];
    return p;
  }

  function accumulateSubNonType(panel, sub, sign) {
    const def = getEchoSubAffixes()[sub.id];
    if (!def || def.panelTarget === 'type_dmg') return;
    accumulateSubIntoPanel(panel, sub, sign);
  }

  function accumulateSubTypeOnly(panel, sub, sign) {
    const def = getEchoSubAffixes()[sub.id];
    if (!def || def.panelTarget !== 'type_dmg') return;
    accumulateSubIntoPanel(panel, sub, sign);
  }

  function listEchoSubsFromConfig(echoConfig) {
    const out = [];
    const slots = Array.isArray(echoConfig?.slots) ? echoConfig.slots : [];
    slots.forEach((slot, slotIndex) => {
      (slot?.subs || []).forEach((sub, subIndex) => {
        out.push({
          key: `${slotIndex}:${subIndex}`,
          slotIndex,
          subIndex,
          cost: Number(slot?.cost) || 0,
          id: String(sub?.id || ''),
          value: Number(sub?.value) || 0,
          damageType: String(sub?.damageType || ''),
        });
      });
    });
    return out;
  }

  /** 仅主词条1（不含固定不变的主词条2） */
  function listEchoMains1FromConfig(echoConfig) {
    const out = [];
    const slots = Array.isArray(echoConfig?.slots) ? echoConfig.slots : [];
    const getOpt =
      typeof global.getEchoMain1Option === 'function'
        ? global.getEchoMain1Option
        : (cost, id) => {
            const table =
              typeof ECHO_MAIN1_OPTIONS !== 'undefined' ? ECHO_MAIN1_OPTIONS : global.ECHO_MAIN1_OPTIONS;
            const options = (table && table[cost]) || [];
            return options.find((o) => o.id === id) || options[0] || null;
          };
    const elements =
      typeof ECHO_ELEMENTS !== 'undefined' ? ECHO_ELEMENTS : global.ECHO_ELEMENTS || [];
    slots.forEach((slot, slotIndex) => {
      const cost = Number(slot?.cost) || 0;
      const opt = getOpt(cost, slot?.main1);
      if (!opt) return;
      const element = opt.needsElement
        ? String(slot?.main1Element || elements[0] || '')
        : '';
      out.push({
        key: `main1:${slotIndex}`,
        slotIndex,
        cost,
        id: String(opt.id || slot?.main1 || ''),
        value: Number(opt.value) || 0,
        panelTarget: String(opt.panelTarget || ''),
        element,
        label: opt.needsElement && element ? `${element}伤害加成` : String(opt.label || opt.id),
        needsElement: !!opt.needsElement,
      });
    });
    return out;
  }

  function emptyTypeMap() {
    const m = Object.create(null);
    getEchoSubTypeDamageTypes().forEach((t) => {
      m[t] = 0;
    });
    return m;
  }

  function accumulateMain1IntoPanel(panel, main, sign) {
    const s = sign < 0 ? -1 : 1;
    const v = (Number(main?.value) || 0) * s;
    if (!v) return;
    const target = String(main?.panelTarget || '');
    switch (target) {
      case 'atk_percent':
        panel.atkPercent = (Number(panel.atkPercent) || 0) + v;
        break;
      case 'hp_percent':
        panel.hpPercent = (Number(panel.hpPercent) || 0) + v;
        break;
      case 'def_percent':
        panel.defPercent = (Number(panel.defPercent) || 0) + v;
        break;
      case 'crit_rate':
        panel.critRatePct = (Number(panel.critRatePct) || 0) + v;
        break;
      case 'crit_dmg':
        panel.critDmgPct = (Number(panel.critDmgPct) || 0) + v;
        break;
      case 'energy_regen_pct':
        panel.energyRegenPct = (Number(panel.energyRegenPct) || 0) + v;
        break;
      case 'element_dmg': {
        // 仅当属性与角色一致时计入；差分用 elementBonusPct（基准已含当前主1）
        const el = String(main?.element || '');
        const memberEl = String(panel.memberElement || '');
        if (el && memberEl && el !== memberEl) break;
        panel.elementBonusPct = (Number(panel.elementBonusPct) || 0) + v;
        break;
      }
      case 'display_only':
      default:
        break;
    }
  }

  function accumulateSubIntoPanel(panel, sub, sign) {
    const s = sign < 0 ? -1 : 1;
    const def = getEchoSubAffixes()[sub.id];
    if (!def) return;
    const v = (Number(sub.value) || 0) * s;
    switch (def.panelTarget) {
      case 'atk_percent':
        panel.atkPercent += v;
        break;
      case 'flat_atk':
        panel.flatAtk += v;
        break;
      case 'hp_percent':
        panel.hpPercent += v;
        break;
      case 'flat_hp':
        panel.flatHp += v;
        break;
      case 'def_percent':
        panel.defPercent += v;
        break;
      case 'flat_def':
        panel.flatDef += v;
        break;
      case 'crit_rate':
        panel.critRatePct += v;
        break;
      case 'crit_dmg':
        panel.critDmgPct += v;
        break;
      case 'energy_regen_pct':
        panel.energyRegenPct += v;
        break;
      case 'type_dmg': {
        const dt = def.needsDamageType ? String(sub.damageType || '') : String(def.damageType || '');
        if (!dt) break;
        if (!panel.typeSubPct[dt]) panel.typeSubPct[dt] = 0;
        panel.typeSubPct[dt] += v;
        break;
      }
      default:
        break;
    }
  }

  function applyErConvertsFromBase(panel, baseEr) {
    const p = clonePanel(panel);
    const er = Number(p.energyRegenPct) || 0;
    const base = Number(baseEr);
    const baseErSafe = Number.isFinite(base) ? base : er;
    (panel.erConverts || []).forEach((conv) => {
      if (typeof conv?.compute !== 'function') return;
      const oldOut = conv.compute(baseErSafe) || {};
      const newOut = conv.compute(er) || {};
      const keys = new Set([...Object.keys(oldOut), ...Object.keys(newOut)]);
      keys.forEach((k) => {
        const delta = (Number(newOut[k]) || 0) - (Number(oldOut[k]) || 0);
        if (!delta) return;
        if (k === 'critRatePct' || k === 'critRate') p.critRatePct = (Number(p.critRatePct) || 0) + delta;
        else if (k === 'critDmgPct' || k === 'critDmg') p.critDmgPct = (Number(p.critDmgPct) || 0) + delta;
        else if (k === 'atkPercent') p.atkPercent = (Number(p.atkPercent) || 0) + delta;
        else if (k === 'flatAtk') p.flatAtk = (Number(p.flatAtk) || 0) + delta;
        else if (k === 'generalBonusPct') p.generalBonusPct = (Number(p.generalBonusPct) || 0) + delta;
      });
    });
    return p;
  }

  function scaleStatValue(panel, kind) {
    if (kind === 'hp') {
      return (Number(panel.whiteHp) || 0) * (1 + (Number(panel.hpPercent) || 0) / 100) + (Number(panel.flatHp) || 0);
    }
    if (kind === 'def') {
      return (Number(panel.whiteDef) || 0) * (1 + (Number(panel.defPercent) || 0) / 100) + (Number(panel.flatDef) || 0);
    }
    return (
      ((Number(panel.whiteAtk) || 0) + (Number(panel.weaponAtk) || 0)) *
        (1 + (Number(panel.atkPercent) || 0) / 100) +
      (Number(panel.flatAtk) || 0)
    );
  }

  function weightedScale(panel) {
    const w = panel.scaleWeights || { atk: 1, hp: 0, def: 0 };
    const atkW = Number(w.atk) || 0;
    const hpW = Number(w.hp) || 0;
    const defW = Number(w.def) || 0;
    const sumW = atkW + hpW + defW;
    if (!(sumW > 0)) return scaleStatValue(panel, 'atk') || 1;
    return (
      (atkW * scaleStatValue(panel, 'atk') +
        hpW * scaleStatValue(panel, 'hp') +
        defW * scaleStatValue(panel, 'def')) /
      sumW
    );
  }

  function weightedBonusFactor(basePanel, newPanel) {
    const types = Object.keys(basePanel.typeWeights || {});
    let oldSum = 0;
    let newSum = 0;
    let wSum = 0;
    types.forEach((t) => {
      const w = Number(basePanel.typeWeights[t]) || 0;
      if (!(w > 0)) return;
      wSum += w;
      const avg = Number(basePanel.typeAvgDmgBonus[t]) || 1;
      const oldSub = Number(basePanel.typeSubPct[t]) || 0;
      const newSub = Number(newPanel.typeSubPct[t]) || 0;
      const delta = (newSub - oldSub) / 100;
      const generalDelta = ((Number(newPanel.generalBonusPct) || 0) - (Number(basePanel.generalBonusPct) || 0)) / 100;
      const elementDelta = ((Number(newPanel.elementBonusPct) || 0) - (Number(basePanel.elementBonusPct) || 0)) / 100;
      const oldB = avg;
      const newB = Math.max(0.01, avg + delta + generalDelta + elementDelta);
      oldSum += w * oldB;
      newSum += w * newB;
    });
    if (!(wSum > 0) || !(oldSum > 0)) {
      const g =
        (1 + (Number(newPanel.generalBonusPct) || 0) / 100) /
        (1 + (Number(basePanel.generalBonusPct) || 0) / 100);
      return Number.isFinite(g) && g > 0 ? g : 1;
    }
    return newSum / oldSum;
  }

  function estimateDamage(basePanel, candidatePanel) {
    const baseEr = Number(basePanel.energyRegenPct) || 0;
    const effectiveBase = applyErConvertsFromBase(basePanel, baseEr);
    const effectiveNew = applyErConvertsFromBase(candidatePanel, baseEr);

    const panelScaleOld = weightedScale(effectiveBase) || 1;
    const panelScaleNew = weightedScale(effectiveNew) || 1;

    // 攻击/生命/防御基准优先取伤害 breakdown 里的有效数值（含队伍/武器/声骸/全队 Buff），
    // 避免把词条收益按“无 Buff 面板”高估；混合倍率角色按伤害占比加权各倍率基准的比值。
    const es = basePanel.effectiveScale;
    const sw = basePanel.scaleWeights || { atk: 1, hp: 0, def: 0 };
    const swSum = (Number(sw.atk) || 0) + (Number(sw.hp) || 0) + (Number(sw.def) || 0);
    let scaleFactor = 0;
    let scaleOk = false;
    if (es && swSum > 0) {
      const kinds = ['atk', 'hp', 'def'];
      let acc = 0;
      let valid = true;
      kinds.forEach((k) => {
        const w = Number(sw[k]) || 0;
        if (!(w > 0)) return;
        const effOld = Number(es[k]) || 0;
        if (!(effOld > 0)) {
          valid = false;
          return;
        }
        const delta = scaleStatValue(effectiveNew, k) - scaleStatValue(effectiveBase, k);
        acc += (w / swSum) * ((effOld + delta) / effOld);
      });
      if (valid && acc > 0) {
        scaleFactor = acc;
        scaleOk = true;
      }
    }
    if (!scaleOk) scaleFactor = panelScaleNew / panelScaleOld;

    const critOld = critExpectFromPct(effectiveBase.critRatePct, effectiveBase.critDmgPct) || 1;
    const critNew = critExpectFromPct(effectiveNew.critRatePct, effectiveNew.critDmgPct) || 1;
    const critFactor = critNew / critOld;

    const bonusFactor = weightedBonusFactor(effectiveBase, effectiveNew);

    const baseDmg = Number(basePanel.baseDamage) || 0;
    const est = baseDmg * scaleFactor * critFactor * bonusFactor;
    return {
      damage: est,
      scaleFactor,
      critFactor,
      bonusFactor,
      panel: effectiveNew,
      critExpect: critNew,
      critRatePct: clamp(effectiveNew.critRatePct, 0, 100),
      critDmgPct: Math.max(0, effectiveNew.critDmgPct),
    };
  }

  function buildPanelFromSubs(basePanel, subs, mains) {
    const p = clonePanel(basePanel);
    if (p.elementBonusPct == null) p.elementBonusPct = 0;
    // 非类型：从「已含当前词条」的面板减旧加新
    (basePanel._baselineSubs || []).forEach((sub) => accumulateSubNonType(p, sub, -1));
    (subs || []).forEach((sub) => accumulateSubNonType(p, sub, 1));
    // 主词条1差分（不含主词条2固定攻/生命）
    (basePanel._baselineMains || []).forEach((m) => accumulateMain1IntoPanel(p, m, -1));
    (mains || basePanel._baselineMains || []).forEach((m) => accumulateMain1IntoPanel(p, m, 1));
    // 类型增伤：按新词条重算贡献（快照里 typeSubPct 仅来自副词条）
    p.typeSubPct = emptyTypeMap();
    Object.keys(basePanel.typeSubPct || {}).forEach((k) => {
      if (p.typeSubPct[k] == null) p.typeSubPct[k] = 0;
    });
    (subs || []).forEach((sub) => accumulateSubTypeOnly(p, sub, 1));
    return p;
  }

  function calc(input) {
    const basePanel = input.basePanel;
    const subs = input.subs || basePanel._baselineSubs || [];
    const mains = input.mains || basePanel._baselineMains || [];
    const panel = buildPanelFromSubs(basePanel, subs, mains);
    const est = estimateDamage(basePanel, panel);
    const damage = est.damage;
    const baseDmg = Number(basePanel.baseDamage) || 0;
    // 特殊技能伤害不吃声骸词条：作为恒定项计入收益基数，避免词条收益被高估
    const specialDmg = Math.max(0, Number(basePanel.specialDamage) || 0);
    const totalDamage = damage + specialDmg;
    const score = baseDmg > 0 ? (damage / baseDmg) * 100 : 100;

    // 声骸总词条收益：基准 = 去掉所有声骸主词条+副词条后的估算伤害
    const noEchoPanel = buildPanelFromSubs(basePanel, [], []);
    const noEchoDmg = estimateDamage(basePanel, noEchoPanel).damage;
    // 声骸副词条收益：基准 = 保留主词条、去掉所有副词条后的估算伤害
    const noSubsPanel = buildPanelFromSubs(basePanel, [], basePanel._baselineMains || []);
    const noSubsDmg = estimateDamage(basePanel, noSubsPanel).damage;

    const margins = {};
    const marginKeys = [
      ['atkPercent', '攻击%'],
      ['critRatePct', '暴击率'],
      ['critDmgPct', '暴伤'],
      ['hpPercent', '生命%'],
      ['defPercent', '防御%'],
      ['energyRegenPct', '共鸣效率'],
      ['flatAtk', '固定攻击'],
    ];
    marginKeys.forEach(([key, label]) => {
      const bumped = clonePanel(panel);
      bumped[key] = (Number(bumped[key]) || 0) + MARGIN_STEP;
      const mEst = estimateDamage(basePanel, bumped);
      const lift = totalDamage > 0 ? ((mEst.damage - damage) / totalDamage) * 100 : 0;
      margins[key] = { label, step: MARGIN_STEP, liftPct: lift };
    });

    // 类型增伤边际：对有权重的类型各 +1%
    const typeMargins = {};
    Object.keys(basePanel.typeWeights || {}).forEach((t) => {
      if (!(Number(basePanel.typeWeights[t]) > 0)) return;
      const bumped = clonePanel(panel);
      bumped.typeSubPct = { ...bumped.typeSubPct, [t]: (Number(bumped.typeSubPct[t]) || 0) + MARGIN_STEP };
      const mEst = estimateDamage(basePanel, bumped);
      const lift = totalDamage > 0 ? ((mEst.damage - damage) / totalDamage) * 100 : 0;
      typeMargins[t] = { label: `${t}增伤`, step: MARGIN_STEP, liftPct: lift };
    });

    return {
      damage,
      baseDamage: baseDmg,
      score,
      changePct: baseDmg + specialDmg > 0 ? ((damage - baseDmg) / (baseDmg + specialDmg)) * 100 : 0,
      noEchoDamage: noEchoDmg,
      noSubsDamage: noSubsDmg,
      specialDamage: specialDmg,
      totalDamage,
      totalBaseDamage: baseDmg + specialDmg,
      noEchoTotal: noEchoDmg + specialDmg,
      noSubsTotal: noSubsDmg + specialDmg,
      echoTotalGainPct: noEchoDmg + specialDmg > 0 ? (totalDamage / (noEchoDmg + specialDmg) - 1) * 100 : 0,
      subOnlyGainPct: noSubsDmg + specialDmg > 0 ? (totalDamage / (noSubsDmg + specialDmg) - 1) * 100 : 0,
      panel: {
        atkPercent: panel.atkPercent,
        flatAtk: panel.flatAtk,
        hpPercent: panel.hpPercent,
        flatHp: panel.flatHp,
        defPercent: panel.defPercent,
        flatDef: panel.flatDef,
        critRatePct: clamp(est.critRatePct, 0, 100),
        critDmgPct: est.critDmgPct,
        energyRegenPct: panel.energyRegenPct,
        elementBonusPct: Number(panel.elementBonusPct) || 0,
        typeSubPct: panel.typeSubPct,
        critExpect: est.critExpect,
      },
      margins,
      typeMargins,
      message: Math.abs(damage - baseDmg) < 1e-6 ? '相对当前配置无变化' : '',
    };
  }

  function replace(input, ops) {
    const subs = deepCloneJson(input.subs || input.basePanel._baselineSubs || []);
    const mains = deepCloneJson(input.mains || input.basePanel._baselineMains || []);
    const before = calc({ ...input, subs, mains });
    (ops || []).forEach((op) => {
      if (op?.kind === 'main1') {
        const si = Number(op.slotIndex);
        const m = mains.find((x) => x.slotIndex === si);
        if (!m) return;
        if (op.id != null) m.id = String(op.id);
        if (op.value != null) m.value = Number(op.value) || 0;
        if (op.panelTarget != null) m.panelTarget = String(op.panelTarget);
        if (op.element != null) m.element = String(op.element || '');
        if (op.label != null) m.label = String(op.label);
        if (op.needsElement != null) m.needsElement = !!op.needsElement;
        return;
      }
      const idx = Number(op.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= subs.length) return;
      if (op.id != null) subs[idx].id = String(op.id);
      if (op.value != null) subs[idx].value = Number(op.value) || 0;
      if (op.damageType != null) subs[idx].damageType = String(op.damageType || '');
    });
    const after = calc({ ...input, subs, mains });
    const changePct =
      before.totalDamage > 0 ? ((after.totalDamage - before.totalDamage) / before.totalDamage) * 100 : 0;
    return {
      before,
      after,
      changePct,
      subs,
      mains,
      message: Math.abs(changePct) < 1e-9 ? '替换后伤害无变化' : '',
    };
  }

  function affixLabel(id) {
    return getEchoSubAffixes()[id]?.label || id;
  }

  function formatSubShort(sub) {
    const def = getEchoSubAffixes()[sub.id];
    const label = def?.label || sub.id;
    const unit = def?.unit === 'flat' ? '' : '%';
    const dt = def?.needsDamageType && sub.damageType ? `·${sub.damageType}` : '';
    return `${label}${dt} ${Number(sub.value) || 0}${unit}`;
  }

  function resolveMain1Option(cost, main1Id, element) {
    const table =
      typeof ECHO_MAIN1_OPTIONS !== 'undefined' ? ECHO_MAIN1_OPTIONS : global.ECHO_MAIN1_OPTIONS;
    const options = (table && table[cost]) || [];
    const opt = options.find((o) => o.id === main1Id) || options[0] || null;
    if (!opt) return null;
    const elements =
      typeof ECHO_ELEMENTS !== 'undefined' ? ECHO_ELEMENTS : global.ECHO_ELEMENTS || [];
    const el = opt.needsElement ? String(element || elements[0] || '') : '';
    return {
      id: String(opt.id),
      value: Number(opt.value) || 0,
      panelTarget: String(opt.panelTarget || ''),
      element: el,
      label: opt.needsElement && el ? `${el}伤害加成` : String(opt.label || opt.id),
      needsElement: !!opt.needsElement,
    };
  }


  /**
   * 从角色成员只读构建模拟输入（不修改 member）
   */
  /** 特殊技能伤害按属主归并（与数据总览口径一致）；特殊技能不吃声骸词条，作为恒定项 */
  function getMemberOwnedSpecialDamage(member) {
    try {
      const st = global.state;
      const members = Array.isArray(st?.members) ? st.members : [];
      const idx = members.indexOf(member);
      if (idx < 0) return 0;
      const cycles = st?.specialSkills?.results?.cycles;
      if (!Array.isArray(cycles)) return 0;
      let total = 0;
      cycles.forEach((cyc) => {
        (Array.isArray(cyc?.items) ? cyc.items : []).forEach((it) => {
          if (it?.ownerIndex === idx) total += Number(it?.total) || 0;
        });
      });
      return total;
    } catch (e) {
      return 0;
    }
  }

  function buildInputFromMember(member, helpers) {
    const h = helpers || {};
    const echoConfig = member?.echoConfig;
    const subs = listEchoSubsFromConfig(echoConfig);
    const mains = listEchoMains1FromConfig(echoConfig);
    const c = member?.char || {};
    const memberElement =
      typeof global.getMemberElementLabel === 'function'
        ? global.getMemberElementLabel(member)
        : '';

    const typeWeights = emptyTypeMap();
    const typeAvgDmgBonus = emptyTypeMap();
    const typeDmgSum = emptyTypeMap();
    const typeBonusAcc = emptyTypeMap();
    const scaleWeights = { atk: 0, hp: 0, def: 0 };
    let dmgSum = 0;
    let critRateAcc = 0;
    let critDmgAcc = 0;
    let critWeight = 0;
    let atkEffAcc = 0;
    let hpEffAcc = 0;
    let defEffAcc = 0;
    let atkEffW = 0;
    let hpEffW = 0;
    let defEffW = 0;

    const visit = (unit, parent) => {
      const bd = unit?._breakdown;
      const dmg = Number(unit?._damage ?? bd?.total) || 0;
      if (!(dmg > 0) || bd?.fixedDamage) return;
      const dt =
        (typeof global.getUnitDamageType === 'function'
          ? global.getUnitDamageType(unit, parent)
          : unit?.damageType || parent?.damageType) || '未分类';
      if (typeWeights[dt] == null) typeWeights[dt] = 0;
      typeWeights[dt] += dmg;
      const bonus = Number(bd?.dmgBonus);
      if (Number.isFinite(bonus) && bonus > 0) {
        if (typeDmgSum[dt] == null) typeDmgSum[dt] = 0;
        if (typeBonusAcc[dt] == null) typeBonusAcc[dt] = 0;
        typeDmgSum[dt] += dmg;
        typeBonusAcc[dt] += dmg * bonus;
      }
      if (Number.isFinite(Number(bd?.critRatePct)) && Number.isFinite(Number(bd?.critDmgPct))) {
        critRateAcc += dmg * Number(bd.critRatePct);
        critDmgAcc += dmg * Number(bd.critDmgPct);
        critWeight += dmg;
      }
      const scale =
        bd?.scaleStat ||
        (typeof global.getUnitScaleStat === 'function' ? global.getUnitScaleStat(unit, parent) : 'atk');
      if (scale === 'hp') scaleWeights.hp += dmg;
      else if (scale === 'def') scaleWeights.def += dmg;
      else scaleWeights.atk += dmg;
      const effVal = Number(bd?.attack);
      if (Number.isFinite(effVal) && effVal > 0) {
        if (scale === 'hp') {
          hpEffAcc += dmg * effVal;
          hpEffW += dmg;
        } else if (scale === 'def') {
          defEffAcc += dmg * effVal;
          defEffW += dmg;
        } else {
          atkEffAcc += dmg * effVal;
          atkEffW += dmg;
        }
      }
      dmgSum += dmg;
    };

    (member?.phases || []).forEach((phase) => {
      (phase.skills || []).forEach((skill) => {
        if (skill?.split && Array.isArray(skill.hits) && skill.hits.length) {
          skill.hits.forEach((hit) => visit(hit, skill));
        } else {
          visit(skill, null);
        }
      });
    });

    if (dmgSum > 0) {
      Object.keys(typeWeights).forEach((t) => {
        typeWeights[t] = typeWeights[t] / dmgSum;
      });
      Object.keys(scaleWeights).forEach((k) => {
        scaleWeights[k] = scaleWeights[k] / dmgSum;
      });
    } else {
      scaleWeights.atk = 1;
    }
    const effectiveScale = {};
    if (atkEffW > 0) effectiveScale.atk = atkEffAcc / atkEffW;
    if (hpEffW > 0) effectiveScale.hp = hpEffAcc / hpEffW;
    if (defEffW > 0) effectiveScale.def = defEffAcc / defEffW;
    Object.keys(typeDmgSum).forEach((t) => {
      typeAvgDmgBonus[t] = typeDmgSum[t] > 0 ? typeBonusAcc[t] / typeDmgSum[t] : 1;
    });
    Object.keys(typeWeights).forEach((t) => {
      if (!typeAvgDmgBonus[t]) typeAvgDmgBonus[t] = 1;
    });

    // 当前词条对类型增伤的贡献
    const typeSubPct = emptyTypeMap();
    subs.forEach((sub) => {
      const def = getEchoSubAffixes()[sub.id];
      if (def?.panelTarget !== 'type_dmg') return;
      const dt = def.needsDamageType ? sub.damageType : def.damageType;
      if (!dt) return;
      typeSubPct[dt] = (typeSubPct[dt] || 0) + (Number(sub.value) || 0);
    });

    const getStat = (key) =>
      typeof global.getCharStatTotal === 'function' ? global.getCharStatTotal(c, key) : Number(c[key]) || 0;

    // 固定攻：面板快照已含布兰特转模数值；erConverts 只做「效率变化时的差分」
    let flatAtk = getStat('flatAtk');
    const erConverts = [];
    if (String(member?.characterId) === String(global.BRANT_CHAR_ID || '1206')) {
      const mech =
        typeof global.getBrantSpecialMechanicsForMember === 'function'
          ? global.getBrantSpecialMechanicsForMember(member)
          : null;
      if (mech) {
        const mode =
          typeof global.normalizeBrantLifeMode === 'function'
            ? global.normalizeBrantLifeMode(member.brantLifeMode)
            : member.brantLifeMode;
        const variant =
          typeof global.getBrantLifeVariant === 'function'
            ? global.getBrantLifeVariant(mech, mode)
            : { atkPerPct: 12, cap: 1560 };
        const threshold = Number(mech.thresholdPct) || 150;
        const per = Number(variant.atkPerPct) || 12;
        const cap = Number(variant.cap) || 1560;
        erConverts.push({
          id: 'brant_flat_atk',
          compute: (er) => ({
            flatAtk: Math.min(cap, Math.max(0, (Number(er) || 0) - threshold) * per),
          }),
        });
      }
    }

    // 莫宁临界协议（按技能占比加权）
    if (typeof global.isMoningCriticalProtocolErBuff === 'function') {
      const has = (member.buffs || []).some((b) => global.isMoningCriticalProtocolErBuff(b) && member.globalBuffActive?.[b.id] !== false);
      if (has && typeof global.computeMoningCriticalProtocolErBonus === 'function') {
        let share = 0;
        const names = global.MONING_CRITICAL_PROTOCOL_SKILLS || [];
        (member.phases || []).forEach((phase) => {
          (phase.skills || []).forEach((skill) => {
            const nm = String(skill?.name || '');
            if (!names.some((n) => nm.includes(n))) return;
            share += Number(skill._damage) || 0;
          });
        });
        const w = dmgSum > 0 ? share / dmgSum : 0;
        if (w > 0.001) {
          erConverts.push({
            id: 'moning_cp',
            compute: (er) => {
              const b = global.computeMoningCriticalProtocolErBonus(er);
              return { critRate: b.critRate * w, critDmg: b.critDmg * w };
            },
          });
        }
      }
    }

    // 莫宁 2 链全队暴伤：本人 ≥2 链时，改自身效率会影响该转模
    if (
      String(member?.characterId) === String(global.MONING_CHAR_ID || '1209') &&
      typeof global.computeMoningC2ErCritDmgPct === 'function' &&
      (typeof global.normalizeResonanceUnlocked === 'function'
        ? global.normalizeResonanceUnlocked(member.resonanceUnlocked)
        : Number(member.resonanceUnlocked) || 0) >= 2
    ) {
      erConverts.push({
        id: 'moning_c2',
        compute: (er) => {
          const b = global.computeMoningC2ErCritDmgPct(er);
          return { critDmg: b.critDmg };
        },
      });
    }

    // 守岸人星域（本人是守岸人时，对自己也生效）
    if (String(member?.characterId) === String(global.SHOREKEEPER_CHAR_ID || '1505')) {
      if (typeof global.computeShorekeeperStarPurpleCritPct === 'function') {
        erConverts.push({
          id: 'sk_purple',
          compute: (er) => ({ critRate: global.computeShorekeeperStarPurpleCritPct(er).crit }),
        });
      }
      if (typeof global.computeShorekeeperStarGoldCritDmgPct === 'function') {
        erConverts.push({
          id: 'sk_gold',
          compute: (er) => ({ critDmg: global.computeShorekeeperStarGoldCritDmgPct(er).critDmg }),
        });
      }
    }

    // 穗穗延奏2 增伤（含本人）
    if (typeof global.computeSuisuiOutro2ErBonusPct === 'function') {
      const has = (member.buffs || []).some(
        (b) =>
          String(b?.templateKey || '') === String(global.SUISUI_OUTRO2_ER_BONUS_KEY || '') &&
          member.globalBuffActive?.[b.id] !== false
      );
      if (has) {
        erConverts.push({
          id: 'suisui_outro2',
          compute: (er) => {
            const b = global.computeSuisuiOutro2ErBonusPct(er);
            return { generalBonusPct: Number(b?.bonus) || 0 };
          },
        });
      }
    }

    const energyRegenPct =
      typeof global.getMemberEnergyRegenPct === 'function'
        ? global.getMemberEnergyRegenPct(member)
        : getStat('energyRegenPct');

    const baseDamage = Number(member?.results?.total) || dmgSum || 0;
    const specialDamage = getMemberOwnedSpecialDamage(member);

    const basePanel = {
      whiteAtk: Number(c.charAtk) || 0,
      weaponAtk: Number(c.weaponAtk) || 0,
      whiteHp: Number(c.charHp) || 0,
      whiteDef: Number(c.charDef) || 0,
      atkPercent: getStat('atkPercent'),
      flatAtk,
      hpPercent: getStat('hpPercent'),
      flatHp: typeof global.getCharFlatHpTotal === 'function' ? global.getCharFlatHpTotal(c) : getStat('flatHp'),
      defPercent: getStat('defPercent'),
      flatDef: typeof global.getCharFlatDefTotal === 'function' ? global.getCharFlatDefTotal(c) : getStat('flatDef'),
      // 优先用轴上有效暴击（含 Buff/转模），否则退回面板
      critRatePct: critWeight > 0 ? critRateAcc / critWeight : getStat('critRate'),
      critDmgPct: critWeight > 0 ? critDmgAcc / critWeight : getStat('critDmg'),
      energyRegenPct,
      generalBonusPct: 0,
      elementBonusPct: 0,
      memberElement: String(memberElement || ''),
      typeSubPct,
      typeWeights,
      typeAvgDmgBonus,
      scaleWeights,
      effectiveScale,
      baseDamage,
      specialDamage,
      erConverts,
      _baselineSubs: deepCloneJson(subs),
      _baselineMains: deepCloneJson(mains),
      memberName: member?.name || '',
    };

    // 面板含「当前转模结果」；erConverts 在 estimate 时以 baseEr 为基准做差分
    return {
      basePanel,
      subs: deepCloneJson(subs),
      mains: deepCloneJson(mains),
    };
  }

  global.EchoSubSim = {
    calc,
    replace,
    buildInputFromMember,
    listEchoSubsFromConfig,
    listEchoMains1FromConfig,
    critExpectFromPct,
    formatSubShort,
    affixLabel,
    resolveMain1Option,
  };
})(typeof window !== 'undefined' ? window : globalThis);
