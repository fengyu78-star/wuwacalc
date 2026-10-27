/* 声骸配置编辑弹窗（cost 模板 / 套装 / 副词条自定义）
 * 复用 core.js 全局函数与数据（ECHO_LAYOUTS / ECHO_SUB_AFFIXES / 套装库）
 * API: EchoConfigModal.open({ initial, title, onSave }) */
(function () {
  'use strict';

  var state = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function normalizeConfig(raw) {
    if (typeof window.normalizeEchoConfig === 'function') {
      return normalizeEchoConfig(raw || {});
    }
    return raw || { layout: '43311', mainSlotIndex: 0, setLoadout: [], slots: [] };
  }

  function layoutKeyOf(cfg) {
    var label = cfg && cfg.layout;
    if (typeof window.getBuildLayoutKey === 'function') {
      var k = getBuildLayoutKey(cfg);
      if (k) return k;
    }
    if (typeof ECHO_LAYOUTS !== 'undefined') {
      var found = Object.keys(ECHO_LAYOUTS).find(function (kk) {
        return ECHO_LAYOUTS[kk].label === label;
      });
      if (found) return found;
    }
    return '43311';
  }

  function layoutOptions() {
    if (typeof ECHO_LAYOUTS === 'undefined') return [];
    return Object.keys(ECHO_LAYOUTS).map(function (k) {
      return { key: k, label: ECHO_LAYOUTS[k].label, costs: ECHO_LAYOUTS[k].costs };
    });
  }

  function costTotal(cfg) {
    if (typeof window.getEchoCostTotal === 'function') return getEchoCostTotal(cfg);
    return (cfg.slots || []).reduce(function (s, x) {
      return s + (Number(x.cost) || 0);
    }, 0);
  }

  function setDef(setId) {
    return typeof window.findEchoSetDef === 'function' ? findEchoSetDef(setId) : null;
  }

  function allSets() {
    return typeof window.getEchoSetsSorted === 'function' ? getEchoSetsSorted() : [];
  }

  function subAffixOptions(selectedId) {
    var affixes = typeof ECHO_SUB_AFFIXES !== 'undefined' ? ECHO_SUB_AFFIXES : {};
    var out = '<option value="">— 副词条 —</option>';
    Object.keys(affixes).forEach(function (id) {
      var sel = String(id) === String(selectedId) ? ' selected' : '';
      out += '<option value="' + esc(id) + '"' + sel + '>' + esc(affixes[id].label) + '</option>';
    });
    return out;
  }

  function subValueOptions(affixId, currentValue) {
    var affix = (typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES[affixId]) || null;
    if (!affix || !Array.isArray(affix.rolls)) {
      return '<option value="">—</option>';
    }
    var unit = affix.unit === 'flat' ? '' : '%';
    return (
      '<option value="">— 档位 —</option>' +
      affix.rolls
        .map(function (r) {
          var sel = Math.abs(Number(r) - Number(currentValue)) < 1e-9 ? ' selected' : '';
          return '<option value="' + r + '"' + sel + '>' + r + unit + '</option>';
        })
        .join('')
    );
  }

  function dmgTypeOptions(current) {
    var types =
      typeof ECHO_SUB_TYPE_DAMAGE_TYPES !== 'undefined' ? ECHO_SUB_TYPE_DAMAGE_TYPES : [];
    return (
      '<option value="">类型</option>' +
      types
        .map(function (t) {
          var sel = String(t) === String(current) ? ' selected' : '';
          return '<option value="' + esc(t) + '"' + sel + '>' + esc(t) + '</option>';
        })
        .join('')
    );
  }

  function renderSetRows() {
    var cfg = state.config;
    var loadout = Array.isArray(cfg.setLoadout) ? cfg.setLoadout : [];
    var rows = [0, 1, 2]
      .map(function (entry, i) {
        entry = loadout[i] || {};
        if (!entry.setId) {
          return (
            '<div class="ecm-set-card-row is-empty" data-ecm-set-row="' + i + '">' +
            '<button type="button" class="ecm-set-main" data-ecm-set-pick="' + i + '" title="选择套装">' +
            '<span class="ecm-set-thumb is-empty">+</span>' +
            '<span class="ecm-set-name is-empty">未选择套装</span>' +
            '</button>' +
            '</div>'
          );
        }
        var def = setDef(entry.setId);
        var others = loadout.reduce(function (sum, row, idx) {
          return idx === i ? sum : sum + (Number(row.count) || 0);
        }, 0);
        var max = Math.max(0, 5 - others);
        return (
          '<div class="ecm-set-card-row" data-ecm-set-row="' + i + '">' +
          '<button type="button" class="ecm-set-main" data-ecm-set-pick="' + i + '" title="更换套装">' +
          '<span class="ecm-set-thumb">' +
          (typeof window.renderEchoSetIconHtml === 'function' && def
            ? renderEchoSetIconHtml(def, 'ecm-set-icon')
            : esc((def && def.name ? def.name.slice(0, 1) : '套'))) +
          '</span>' +
          '<span class="ecm-set-name">' + esc(def && def.name ? def.name : entry.setId) + '</span>' +
          '</button>' +
          '<div class="ecm-stepper">' +
          '<button type="button" class="ecm-step-btn" data-ecm-set-minus="' + i + '" ' + ((Number(entry.count) || 0) <= 0 ? 'disabled' : '') + '>−</button>' +
          '<span class="ecm-step-val">' + (Number(entry.count) || 0) + '</span>' +
          '<button type="button" class="ecm-step-btn" data-ecm-set-plus="' + i + '" ' + ((Number(entry.count) || 0) >= max ? 'disabled' : '') + '>+</button>' +
          '</div>' +
          '<button type="button" class="ecm-mini-btn is-danger" data-ecm-set-remove="' + i + '" title="移除套装">×</button>' +
          '</div>'
        );
      })
      .join('');
    var canAdd = loadout.some(function (e) {
      return !e.setId;
    });
    var setCount = loadout.filter(function (e) {
      return e.setId && Number(e.count) > 0;
    }).length;
    return (
      '<div class="ecm-sets">' +
      rows +
      (canAdd
        ? '<button type="button" class="ecm-add-set-wide" data-ecm-add-set><span class="ecm-plus">+</span> 选择套装</button>'
        : '<span class="ecm-muted">已达 3 套上限</span>') +
      (setCount ? '<span class="ecm-muted">已配置 ' + setCount + ' 套</span>' : '') +
      '</div>'
    );
  }

  function renderMainSlotSection() {
    var cfg = state.config;
    var main = typeof window.getMainEchoFromLoadout === 'function' ? getMainEchoFromLoadout(cfg) : null;
    var sp = main && main.echoId && typeof window.findEchoSpecimen === 'function' ? findEchoSpecimen(main.echoId) : null;
    var mainIcon = '';
    var mainName = '未选择主位';
    var mainState = '';
    if (sp) {
      mainName = sp.name;
      mainState = '<span class="ecm-main-badge">已选主位</span>';
      if (sp.icon) {
        var iconUrl = typeof window.nanokaAssetUrl === 'function' ? nanokaAssetUrl(sp.icon) : sp.icon;
        mainIcon = '<img src="' + esc(iconUrl) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />';
      }
    }
    return (
      '<div class="ecm-main-slot-section">' +
      '<div class="ecm-block-title">选择主位</div>' +
      '<div class="ecm-main-current' + (sp ? ' has-main' : '') + '">' +
      '<span class="ecm-main-current-icon">' + mainIcon + '<span class="ecm-main-current-fb"' + (mainIcon ? ' style="display:none"' : ' style="display:flex"') + '>主</span></span>' +
      '<span class="ecm-main-current-name">' + esc(mainName) + '</span>' +
      mainState +
      '</div>' +
      '<button type="button" class="ecm-main-specimen-btn" data-ecm-main-specimen>选声骸</button>' +
      '</div>'
    );
  }

  function renderSubRow(slot, slotIndex, sub, subIndex) {
    return '';
  }

  function mainOptionsFor(cost, selectedId) {
    if (typeof ECHO_MAIN1_OPTIONS === 'undefined' || !ECHO_MAIN1_OPTIONS[cost]) return '<option value="">—</option>';
    return (
      '<option value="">— 主词条 —</option>' +
      ECHO_MAIN1_OPTIONS[cost]
        .map(function (o) {
          var sel = String(o.id) === String(selectedId) ? ' selected' : '';
          return '<option value="' + esc(o.id) + '"' + sel + '>' + esc(o.label) + '</option>';
        })
        .join('')
    );
  }

  function elementOptionsFor(slotIndex, cost, main1Id, currentElement) {
    var cur = null;
    if (typeof ECHO_MAIN1_OPTIONS !== 'undefined' && ECHO_MAIN1_OPTIONS[cost]) {
      cur = ECHO_MAIN1_OPTIONS[cost].find(function (o) {
        return o.id === main1Id;
      });
    }
    if (!cur || !cur.needsElement) return '';
    var types = typeof ELEMENT_TYPES !== 'undefined' ? ELEMENT_TYPES : {};
    return (
      '<select class="ecm-select ecm-main-el" data-ecm-main-el="' + slotIndex + '">' +
      Object.keys(types)
        .map(function (k) {
          // 选项键为数字（1=冷凝…6=湮灭），配置里存的是中文名；按 label 匹配选中项
          var sel =
            types[k] && String(types[k].label) === String(currentElement) ? ' selected' : '';
          return '<option value="' + esc(k) + '"' + sel + '>' + esc(types[k].label) + '</option>';
        })
        .join('') +
      '</select>'
    );
  }

  function slotAffixLabel(affixId, damageType) {
    var affixes = typeof ECHO_SUB_AFFIXES !== 'undefined' ? ECHO_SUB_AFFIXES : {};
    var def = affixes[affixId];
    if (!def) return affixId;
    if (affixId === 'sub_type_dmg') {
      return damageType ? damageType + '增伤' : '类型增伤·未选';
    }
    return def.label;
  }

  function renderSubMatrix() {
    var cfg = state.config;
    var slots = Array.isArray(cfg.slots) ? cfg.slots : [];
    var slotCount = slots.length;
    var catOrder = [
      'sub_crit_rate',
      'sub_crit_dmg',
      'sub_atk_percent',
      'sub_flat_atk',
      'sub_type_dmg',
      'sub_energy_regen',
      'sub_hp_percent',
      'sub_flat_hp',
      'sub_def_percent',
      'sub_flat_def',
    ];
    var typeDmgTypes = typeof ECHO_SUB_TYPE_DAMAGE_TYPES !== 'undefined' ? ECHO_SUB_TYPE_DAMAGE_TYPES : [];

    var rows = [];
    var seen = {};
    slots.forEach(function (slot) {
      (slot.subs || []).forEach(function (sub) {
        var key = sub.id === 'sub_type_dmg' ? 'type:' + (sub.damageType || '') : String(sub.id);
        if (!seen[key]) {
          seen[key] = true;
          rows.push({ key: key, affixId: sub.id, damageType: sub.damageType || '', isTypeRow: sub.id === 'sub_type_dmg' });
        }
      });
    });
    var ordered = [];
    catOrder.forEach(function (id) {
      if (id === 'sub_type_dmg') return;
      if (seen[id]) ordered.push(id);
    });
    typeDmgTypes.forEach(function (t) {
      var key = 'type:' + t;
      if (seen[key]) ordered.push(key);
    });
    if (seen['type:']) ordered.push('type:');
    Object.keys(seen).forEach(function (key) {
      if (ordered.indexOf(key) < 0) ordered.push(key);
    });

    var gridStyle = 'grid-template-columns: 7rem repeat(' + slotCount + ', minmax(4.4rem, 1fr)) 2.1rem;';

    var colHeads = slots
      .map(function (slot) {
        var si = slots.indexOf(slot);
        var isMain = Number(cfg.mainSlotIndex) === si;
        return (
          '<div class="ecm-colhead' + (isMain ? ' is-main' : '') + '" title="声骸 ' + (si + 1) + (isMain ? ' · 主位' : '') + '">' +
          slot.cost + 'cost' +
          '</div>'
        );
      })
      .join('');

    var mainRow =
      '<div class="ecm-matrix-row ecm-main-row">' +
      '<div class="ecm-row-label"><strong>主词条1</strong><span class="ecm-muted">不含固定主词条2</span></div>' +
      slots
        .map(function (slot, si) {
          return (
            '<div class="ecm-cell ecm-cell-main' + (Number(cfg.mainSlotIndex) === si ? ' is-main' : '') + '">' +
            '<select class="ecm-select" data-ecm-main1="' + si + '">' + mainOptionsFor(slot.cost, slot.main1) + '</select>' +
            elementOptionsFor(si, slot.cost, slot.main1, slot.main1Element) +
            '</div>'
          );
        })
        .join('') +
      '<div class="ecm-colhead-add"></div>' +
      '</div>';

    var catsHtml = ordered
      .map(function (key) {
        var row = rows.find(function (r) {
          return r.key === key;
        });
        if (!row) return '';
        var bySlot = {};
        slots.forEach(function (slot, si) {
          (slot.subs || []).forEach(function (sub, subIdx) {
            var k = sub.id === 'sub_type_dmg' ? 'type:' + (sub.damageType || '') : String(sub.id);
            if (k === key && !bySlot[si]) bySlot[si] = { sub: sub, subIdx: subIdx };
          });
        });
        var cells = slots
          .map(function (slot, si) {
            var hit = bySlot[si];
            if (!hit) return '<div class="ecm-cell empty">—</div>';
            var valueOptions = subValueOptions(hit.sub.id, hit.sub.value);
            var typeSel =
              hit.sub.id === 'sub_type_dmg'
                ? '<select class="ecm-select ecm-sub-type" data-ecm-sub-type="' + si + '" data-ecm-sub-idx="' + hit.subIdx + '">' +
                  dmgTypeOptions(hit.sub.damageType) +
                  '</select>'
                : '';
            return (
              '<div class="ecm-cell ecm-sub-cell">' +
              '<select class="ecm-select ecm-sub-value" data-ecm-sub-value="' + si + '" data-ecm-sub-idx="' + hit.subIdx + '">' + valueOptions + '</select>' +
              typeSel +
              '<button type="button" class="ecm-mini-btn is-danger" data-ecm-sub-del="' + si + '" data-ecm-sub-idx="' + hit.subIdx + '" title="删除该词条">×</button>' +
              '</div>'
            );
          })
          .join('');
        var addDisabled = '';
        var addAttrs = row.isTypeRow
          ? 'data-ecm-sub-add-row="' + esc(row.affixId) + '" data-ecm-sub-add-type="' + esc(row.damageType) + '"'
          : 'data-ecm-sub-add-row="' + esc(row.affixId) + '"';
        return (
          '<div class="ecm-matrix-row">' +
          '<div class="ecm-row-label"><strong>' + esc(slotAffixLabel(row.affixId, row.damageType)) + '</strong></div>' +
          cells +
          '<button type="button" class="ecm-add-cell" ' + addAttrs + ' title="添加该词条到某声骸">＋</button>' +
          '</div>'
        );
      })
      .join('');

    var missing = [];
    catOrder.forEach(function (id) {
      if (id === 'sub_type_dmg') return;
      if (!seen[id] && (typeof ECHO_SUB_AFFIXES === 'undefined' || ECHO_SUB_AFFIXES[id])) {
        missing.push({ value: id, label: slotAffixLabel(id, '') });
      }
    });
    typeDmgTypes.forEach(function (t) {
      if (!seen['type:' + t]) missing.push({ value: 'sub_type_dmg:' + t, label: t + '增伤' });
    });
    var addCatHtml = missing.length
      ? '<div class="ecm-add-cat">' +
        '<span class="ecm-muted">添加词条类别</span>' +
        '<select class="ecm-select" data-ecm-new-cat>' +
        missing
          .map(function (o) {
            return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
          })
          .join('') +
        '</select>' +
        '<button type="button" class="ecm-mini-btn" data-ecm-new-cat-go>添加</button>' +
        '</div>'
      : '';

    return (
      '<div class="ecm-sub-matrix-wrap">' +
      '<div class="ecm-sub-matrix" style="' + gridStyle + '">' +
      '<div class="ecm-corner ecm-muted">类别 \\ 声骸</div>' +
      colHeads +
      '<div class="ecm-colhead ecm-colhead-add"></div>' +
      mainRow +
      catsHtml +
      '</div>' +
      addCatHtml +
      '</div>'
    );
  }

  function render() {
    var cfg = state.config;
    var layoutKey = layoutKeyOf(cfg);
    var total = costTotal(cfg);
    var cap = typeof ECHO_COST_CAP !== 'undefined' ? ECHO_COST_CAP : 12;
    var layoutBtns = layoutOptions()
      .map(function (l) {
        return (
          '<button type="button" class="ecm-chip' + (l.key === layoutKey ? ' is-on' : '') + '" data-ecm-layout="' + esc(l.key) + '">' +
          esc(l.label) +
          '</button>'
        );
      })
      .join('');
    var scroll = $('[data-ecm-scroll]');
    if (!scroll) return;
    scroll.innerHTML =
      '<div class="ecm-body">' +
      '<div class="ecm-block">' +
      '<div class="ecm-block-title">COST 模板</div>' +
      '<div class="ecm-chip-row">' +
      layoutBtns +
      '<span class="ecm-cost-badge' + (total > cap ? ' is-over' : '') + '">Cost ' + total + '/' + cap + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="ecm-block">' +
      renderMainSlotSection() +
      '<div class="ecm-main-divider"></div>' +
      renderSetRows() +
      '</div>' +
      '<div class="ecm-block">' +
      '<div class="ecm-block-title">声骸词条</div>' +
      renderSubMatrix() +
      '</div>' +
      '</div>';
  }

  function applyLayout(key) {
    var layout = (typeof ECHO_LAYOUTS !== 'undefined' && ECHO_LAYOUTS[key]) || null;
    if (!layout) return;
    var prev = state.config;
    var prevSlots = Array.isArray(prev.slots) ? prev.slots : [];
    state.config = {
      layout: layout.label,
      mainSlotIndex: Number.isInteger(prev.mainSlotIndex) ? prev.mainSlotIndex : 0,
      setLoadout: Array.isArray(prev.setLoadout)
        ? prev.setLoadout
        : typeof window.defaultEchoSetLoadout === 'function'
          ? defaultEchoSetLoadout()
          : [],
      slots: layout.costs.map(function (cost, i) {
        var old = prevSlots[i];
        if (!old) {
          return typeof window.createEchoSlot === 'function'
            ? createEchoSlot(cost)
            : { cost: cost, subs: [] };
        }
        return typeof window.normalizeEchoSlot === 'function'
          ? normalizeEchoSlot({
              cost: cost,
              name: old.name || '',
              activeSetId: old.activeSetId || null,
              echoId: old.echoId || null,
              main1:
                typeof window.defaultEchoMain1ForCost === 'function'
                  ? defaultEchoMain1ForCost(cost)
                  : '',
              main1Element: old.main1Element,
              subs: Array.isArray(old.subs) ? old.subs : [],
            })
          : { cost: cost, subs: Array.isArray(old.subs) ? old.subs : [] };
      }),
    };
    if (state.config.mainSlotIndex >= state.config.slots.length) state.config.mainSlotIndex = 0;
    state.config = normalizeConfig(state.config);
    render();
  }

  function addSetRow() {
    var loadout = state.config.setLoadout;
    var emptyIdx = loadout.findIndex(function (e) {
      return !e.setId;
    });
    if (emptyIdx < 0) return;
    var sets = allSets();
    if (!sets.length) {
      alert('套装库未加载，无法选择');
      return;
    }
    openSetPicker(emptyIdx);
  }

  function openSetPicker(entryIndex) {
    var sets = allSets();
    var overlay = document.createElement('div');
    overlay.className = 'ecm-overlay ecm-set-picker-overlay';
    overlay.innerHTML =
      '<div class="ecm-set-picker">' +
      '<header class="ecm-head">' +
      '<strong>选择声骸套装</strong>' +
      '<button type="button" class="ecm-close" data-ecm-set-picker-close aria-label="关闭">✕</button>' +
      '</header>' +
      '<div class="ecm-set-picker-body">' +
      '<div class="ecm-set-grid">' +
      sets
        .map(function (s) {
          return (
            '<button type="button" class="ecm-set-card" data-ecm-set-card="' + esc(s.id) + '">' +
            '<span class="ecm-set-card-icon">' +
            (typeof window.renderEchoSetIconHtml === 'function' ? renderEchoSetIconHtml(s, 'ecm-set-icon') : esc((s.name || '?').slice(0, 1))) +
            '</span>' +
            '<span class="ecm-set-card-name">' + esc(s.name) + '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<footer class="ecm-foot"><span class="ecm-muted">点击套装卡片选择</span>' +
      '<button type="button" class="ecm-cancel" data-ecm-set-picker-close>取消</button></footer>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-ecm-set-picker-close]') || e.target.hasAttribute('data-ecm-set-picker-overlay')) {
        overlay.remove();
        return;
      }
      var card = e.target.closest('[data-ecm-set-card]');
      if (card) {
        var setId = card.dataset.ecmSetCard;
        if (state.config.setLoadout[entryIndex]) {
          state.config.setLoadout[entryIndex].setId = setId;
          state.config.setLoadout[entryIndex].count = Math.min(5, Number(state.config.setLoadout[entryIndex].count) || 1);
          state.config.setLoadout[entryIndex].echoId = null;
        }
        overlay.remove();
        render();
      }
    });
  }

  function openMainSpecimenPicker() {
    if (typeof window.getSpecimensForEchoSlot !== 'function') {
      alert('主位声骸库未就绪，请稍后重试');
      return;
    }
    var loadout = state.config.setLoadout || [];
    var setIds = loadout.filter(function (e) { return e.setId && Number(e.count) > 0; }).map(function (e) { return e.setId; });
    if (!setIds.length) {
      alert('请先选择套装');
      return;
    }
    var seen = {};
    var list = [];
    setIds.forEach(function (setId) {
      var sps = getSpecimensForEchoSlot({}, { cost: 4, activeSetId: setId }, setId);
      sps.forEach(function (sp) {
        if (!seen[String(sp.id)]) {
          seen[String(sp.id)] = true;
          list.push(sp);
        }
      });
    });
    var main = typeof window.getMainEchoFromLoadout === 'function' ? getMainEchoFromLoadout(state.config) : null;
    var currentEchoId = main && main.echoId ? String(main.echoId) : '';
    var overlay = document.createElement('div');
    overlay.className = 'ecm-overlay ecm-set-picker-overlay';
    var cards = list.length
      ? list
          .map(function (sp) {
            var active = currentEchoId === String(sp.id) ? ' is-on' : '';
            var icon = '';
            if (sp.icon) {
              var iconUrl = typeof window.nanokaAssetUrl === 'function' ? nanokaAssetUrl(sp.icon) : sp.icon;
              icon = '<img src="' + esc(iconUrl) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />';
            }
            return (
              '<button type="button" class="ecm-specimen-card' + active + '" data-ecm-specimen-pick="' + esc(sp.id) + '">' +
              '<span class="ecm-specimen-icon">' + icon + '<span class="ecm-specimen-fb"' + (icon ? ' style="display:none"' : ' style="display:flex"') + '>声</span></span>' +
              '<span class="ecm-specimen-name">' + esc(sp.name) + '</span>' +
              '</button>'
            );
          })
          .join('')
      : '<p class="mx-muted">该套装暂无匹配主位声骸</p>';
    overlay.innerHTML =
      '<div class="ecm-set-picker">' +
      '<header class="ecm-head">' +
      '<strong>选择主位声骸</strong>' +
      '<button type="button" class="ecm-close" data-ecm-specimen-close aria-label="关闭">✕</button>' +
      '</header>' +
      '<div class="ecm-set-picker-body">' +
      '<div class="ecm-specimen-grid">' + cards + '</div>' +
      '</div>' +
      '<footer class="ecm-foot">' +
      '<button type="button" class="ecm-cancel" data-ecm-specimen-clear>清除主位</button>' +
      '<button type="button" class="ecm-cancel" data-ecm-specimen-close>取消</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-ecm-specimen-close]') || e.target.hasAttribute('data-ecm-set-picker-overlay')) {
        overlay.remove();
        return;
      }
      var clear = e.target.closest('[data-ecm-specimen-clear]');
      if (clear) {
        (state.config.setLoadout || []).forEach(function (en) {
          if (en) en.echoId = null;
        });
        overlay.remove();
        render();
        return;
      }
      var card = e.target.closest('[data-ecm-specimen-pick]');
      if (card) {
        var spId = card.dataset.ecmSpecimenPick;
        var target = null;
        setIds.forEach(function (setId) {
          if (target) return;
          var sps = getSpecimensForEchoSlot({}, { cost: 4, activeSetId: setId }, setId);
          if (sps.some(function (s) { return String(s.id) === String(spId); })) {
            target = loadout.find(function (en) { return en.setId === setId; });
          }
        });
        (state.config.setLoadout || []).forEach(function (en) {
          if (en) en.echoId = null;
        });
        if (target) target.echoId = spId;
        overlay.remove();
        render();
      }
    });
  }

  function buildResult() {
    var cfg = normalizeConfig(state.config);
    if (typeof window.syncSetLoadoutToSlots === 'function') {
      syncSetLoadoutToSlots(cfg);
    }
    return cfg;
  }

  function addAffixToFirstSlot(affixId, damageType) {
    var slots = state.config.slots || [];
    var idx = slots.findIndex(function (slot) {
      if (!slot || (slot.subs || []).length >= 5) return false;
      return !(slot.subs || []).some(function (s) {
        if (String(s.id) !== String(affixId)) return false;
        if (affixId === 'sub_type_dmg') return String(s.damageType || '') === String(damageType || '');
        return true;
      });
    });
    if (idx < 0) {
      alert('所有声骸已满 5 条或该词条已存在');
      return;
    }
    if (!slots[idx].subs) slots[idx].subs = [];
    slots[idx].subs.push({ id: affixId, value: 0, damageType: damageType || '' });
    render();
  }

  function open(opts) {
    opts = opts || {};
    var initial = opts.initial || {};
    var cfg = normalizeConfig(initial);
    state = {
      config: cfg,
      title: opts.title || '声骸配置',
      onSave: typeof opts.onSave === 'function' ? opts.onSave : null,
      ocr: null,
    };
    var div = document.createElement('div');
    div.className = 'ecm-overlay';
    div.setAttribute('data-ecm-root', '');
    div.innerHTML =
      '<div class="ecm-modal">' +
      '<header class="ecm-head">' +
      '<strong>' + esc(state.title) + '</strong>' +
      '<button type="button" class="ecm-ocr-btn" data-ecm-ocr title="支持：①小程序五彩词条图 ②游戏内官方声骸详情">识图导入</button>' +
      '<button type="button" class="ecm-ocr-btn" data-ecm-ocr-ai title="AI 视觉识别（填写你自己的 API Key，识别费用由你的 Key 承担）">AI 识别</button>' +
      '<button type="button" class="ecm-ocr-btn" data-ecm-ocr-grid title="大图含多个声骸时，先按网格切成单卡再识别">网格拆分</button>' +
      '<button type="button" class="ecm-close" data-ecm-close aria-label="关闭">✕</button>' +
      '</header>' +
      '<div class="ecm-scroll" data-ecm-scroll></div>' +
      '<input type="file" accept="image/*" multiple hidden data-ecm-ocr-input />' +
      '<footer class="ecm-foot">' +
      '<span class="ecm-muted ecm-save-hint">保存后可在其他页面直接导入</span>' +
      '<div class="ecm-actions">' +
      '<button type="button" class="ecm-cancel" data-ecm-close>取消</button>' +
      '<button type="button" class="ecm-save" data-ecm-save>保存配置</button>' +
      '</div>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(div);
    document.body.classList.add('ecm-open');
    render();
    if (opts.startOcr) {
      // 等一帧再弹文件选择，避免被刚打开的遮罩抢走焦点
      setTimeout(function () {
        openOcrImport();
      }, 0);
    }
  }

  function close() {
    var root = $('[data-ecm-root]');
    if (root) root.remove();
    document.body.classList.remove('ecm-open');
    state = null;
  }

  /* ---------- 识图导入 ---------- */
  var OCR_TEMPLATE_TIP =
    '识图支持以下两种截图（文字清晰；多卡大图会自动拆分）：\n' +
    '① 小程序五彩词条图（金/青/紫/红等）\n' +
    '② 游戏内官方声骸详情（含 COST、+副词条）\n\n' +
    '引擎：百度 PaddleOCR（本地浏览器运行）。\n' +
    '首次使用需下载中文模型（约数十 MB），之后可缓存复用。\n' +
    '其它拼图/模糊图不保证准确。继续选择图片？';

  async function openOcrImport() {
    if (!state) return;
    if (!(await DialogKit.confirm({ message: OCR_TEMPLATE_TIP }))) return;
    state._ocrUseAI = false;
    if (typeof window.EchoOCR === 'undefined') {
      loadOcrEngine(inputOcrFile);
      return;
    }
    inputOcrFile();
  }

  function getAiOcrKey() {
    try {
      return String(localStorage.getItem('wc_ai_ocr_key') || '');
    } catch (e) {
      return '';
    }
  }

  function setAiOcrKey(k) {
    try {
      localStorage.setItem('wc_ai_ocr_key', k);
    } catch (e) {
      /* ignore */
    }
  }

  function getAiOcrModel() {
    try {
      var m = localStorage.getItem('wc_ai_ocr_model');
      // 已失效模型（付费旧版 / 欠费）自动迁移到免费视觉模型 qwen3-vl-plus
      if (m === 'qwen-vl-plus' || m === 'qwen3.7-plus') {
        localStorage.setItem('wc_ai_ocr_model', 'qwen3-vl-plus');
        return 'qwen3-vl-plus';
      }
      return String(m || 'qwen3-vl-plus');
    } catch (e) {
      return 'qwen3-vl-plus';
    }
  }

  function setAiOcrModel(m) {
    try {
      localStorage.setItem('wc_ai_ocr_model', m);
    } catch (e) {
      /* ignore */
    }
  }

  function loadOcrEngine(cb) {
    var s = document.createElement('script');
    s.src = 'js/echo-ocr.js?v=20260809ae';
    s.onload = function () {
      if (typeof cb === 'function') cb();
    };
    s.onerror = function () {
      alert('OCR 引擎加载失败');
    };
    document.head.appendChild(s);
  }

  function openAiOcrImport() {
    if (!state) return;
    var key = getAiOcrKey();
    var model = getAiOcrModel();
    var overlay = document.createElement('div');
    overlay.className = 'ecm-ai-key-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:320000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:#1d2430;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:20px;width:400px;max-width:92vw;color:#e8e8e8;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.4);">' +
      '<h3 style="margin:0 0 4px;font-size:16px;color:#fff;">AI 识别设置</h3>' +
      '<p style="margin:0 0 14px;color:rgba(255,255,255,.5);line-height:1.5;">使用你自己的阿里云百炼 API Key，识别费用由你的 Key 承担；Key 只保存在本浏览器。</p>' +
      '<p style="margin:0 0 6px;color:rgba(255,255,255,.65);">API Key（sk- 开头）</p>' +
      '<input type="password" data-ecm-ai-key style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#141a24;color:#fff;margin-bottom:14px;font-size:13px;" value="' +
      esc(key) +
      '" placeholder="sk-..." />' +
      '<p style="margin:0 0 6px;color:rgba(255,255,255,.65);">模型 ID（免费视觉模型，如 qwen3-vl-plus）</p>' +
      '<input type="text" data-ecm-ai-model style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#141a24;color:#fff;margin-bottom:16px;font-size:13px;" value="' +
      esc(model) +
      '" placeholder="qwen3-vl-plus" />' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" data-ecm-ai-cancel style="padding:7px 16px;border-radius:7px;background:transparent;border:1px solid rgba(255,255,255,.22);color:#ccc;cursor:pointer;font-size:13px;">取消</button>' +
      '<button type="button" data-ecm-ai-ok style="padding:7px 16px;border-radius:7px;background:#3b6ea8;border:none;color:#fff;cursor:pointer;font-size:13px;">开始识别</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-ecm-ai-key]').focus();
    var done = false;
    function confirmAi() {
      if (done) return;
      var k = overlay.querySelector('[data-ecm-ai-key]').value.trim();
      var m = overlay.querySelector('[data-ecm-ai-model]').value.trim();
      if (!k) {
        alert('请填写 API Key');
        return;
      }
      done = true;
      setAiOcrKey(k);
      if (m) setAiOcrModel(m);
      overlay.remove();
      state._ocrUseAI = true;
      state._ocrAiModel = getAiOcrModel();
      if (typeof window.EchoOCR === 'undefined') {
        loadOcrEngine(inputOcrFile);
        return;
      }
      inputOcrFile();
    }
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-ecm-ai-ok]')) confirmAi();
      else if (e.target.closest('[data-ecm-ai-cancel]') || e.target === overlay) overlay.remove();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') confirmAi();
    });
  }

  function inputOcrFile() {
    var input = $('[data-ecm-ocr-input]');
    if (!input) return;
    input.value = '';
    input.click();
  }

  /* ---------- 网格拆分：大图含多个声骸时先切成单卡再识别 ---------- */
  async function openGridImport() {
    if (!state) return;
    var tip =
      '网格拆分用于「一张大图包含多个声骸」的小程序截图：\n' +
      '先设置 列数/行数/左侧裁剪（去掉评分面板），把图片切成一个个单卡，再逐张识别，准确率最高。\n\n' +
      '继续选择图片？';
    if (!(await DialogKit.confirm({ message: tip }))) return;
    state._ocrGridMode = true;
    if (typeof window.EchoOCR === 'undefined') {
      loadOcrEngine(inputOcrFile);
      return;
    }
    inputOcrFile();
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  function drawGridPreview(canvas, img, cols, rows, cropLeftPct, colLines, rowLines, zoom, pan) {
    var maxW = 640;
    var maxH = 460;
    var W = img.naturalWidth;
    var H = img.naturalHeight;
    var cropX = Math.round((W * Number(cropLeftPct)) / 100);
    var cw = Math.max(1, W - cropX);
    var fitScale = Math.min(1, maxW / cw, maxH / H);
    var fitW = Math.max(1, Math.round(cw * fitScale));
    var fitH = Math.max(1, Math.round(H * fitScale));
    var z = Math.max(1, Number(zoom) || 1);
    var drawScale = fitScale * z;
    var p = pan || { x: 0, y: 0 };
    // 钳制平移，避免图片完全移出视野
    var maxPanX = Math.max(0, cw * drawScale - fitW);
    var maxPanY = Math.max(0, H * drawScale - fitH);
    p.x = Math.max(-maxPanX, Math.min(0, Number(p.x) || 0));
    p.y = Math.max(-maxPanY, Math.min(0, Number(p.y) || 0));
    canvas.width = fitW;
    canvas.height = fitH;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, fitW, fitH);
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, fitW, fitH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, fitW, fitH);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cropX, 0, cw, H, p.x, p.y, cw * drawScale, H * drawScale);
    // 竖网格线（0~1 占裁剪区宽度比例）
    var xs = [0];
    if (Array.isArray(colLines) && colLines.length === cols - 1) {
      for (var c = 0; c < colLines.length; c++) xs.push(Number(colLines[c]));
      xs.push(1);
    } else {
      for (var c2 = 1; c2 < cols; c2++) xs.push(c2 / cols);
      xs.push(1);
    }
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.9)';
    ctx.lineWidth = 1.5;
    for (var xi = 1; xi < xs.length - 1; xi++) {
      var gx = p.x + cw * Number(xs[xi]) * drawScale;
      ctx.beginPath();
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, fitH);
      ctx.stroke();
    }
    // 横网格线（0~1 占整图高度比例）
    var ys = [0];
    if (Array.isArray(rowLines) && rowLines.length === rows - 1) {
      for (var r = 0; r < rowLines.length; r++) ys.push(Number(rowLines[r]));
      ys.push(1);
    } else {
      for (var r2 = 1; r2 < rows; r2++) ys.push(r2 / rows);
      ys.push(1);
    }
    for (var yi = 1; yi < ys.length - 1; yi++) {
      var gy = p.y + H * Number(ys[yi]) * drawScale;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(fitW, Math.round(gy) + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(0.5, 0.5, fitW - 1, fitH - 1);
    ctx.restore();
  }

  function ensureGridLines() {
    var cols = Math.max(1, Math.min(4, Number(state._gridCols) || 3));
    var rows = Math.max(1, Math.min(8, Number(state._gridRows) || 2));
    var cl = state._gridColLines;
    if (!Array.isArray(cl) || cl.length !== cols - 1) {
      cl = [];
      for (var c = 1; c < cols; c++) cl.push(c / cols);
      state._gridColLines = cl;
    }
    var rl = state._gridRowLines;
    if (!Array.isArray(rl) || rl.length !== rows - 1) {
      rl = [];
      for (var r = 1; r < rows; r++) rl.push(r / rows);
      state._gridRowLines = rl;
    }
  }

  function gridViewMetrics() {
    var W = state._gridImg.naturalWidth;
    var H = state._gridImg.naturalHeight;
    var cropX = Math.round((W * Number(state._gridCrop)) / 100);
    var cw = Math.max(1, W - cropX);
    var fitScale = Math.min(1, 640 / cw, 460 / H);
    return { W: W, H: H, cropX: cropX, cw: cw, fitScale: fitScale, drawScale: fitScale * (state._gridZoom || 1) };
  }

  function redrawGridCanvas() {
    var scroll = $('[data-ecm-scroll]');
    var cv = scroll && scroll.querySelector('[data-ecm-grid-canvas]');
    if (!cv || !state._gridImg) return;
    drawGridPreview(
      cv,
      state._gridImg,
      state._gridCols,
      state._gridRows,
      state._gridCrop,
      state._gridColLines,
      state._gridRowLines,
      state._gridZoom,
      state._gridPan
    );
    var lbl = scroll.querySelector('[data-ecm-grid-zoom-label]');
    if (lbl) lbl.textContent = Math.round((state._gridZoom || 1) * 100) + '%';
  }

  function applyGridZoom(zNew, px, py) {
    if (!state._gridImg) return;
    zNew = Math.max(1, Math.min(8, zNew));
    var m = gridViewMetrics();
    var pan = state._gridPan || { x: 0, y: 0 };
    var oldScale = m.drawScale;
    var newScale = m.fitScale * zNew;
    var ix = (px - pan.x) / oldScale;
    var iy = (py - pan.y) / oldScale;
    pan.x = px - ix * newScale;
    pan.y = py - iy * newScale;
    state._gridZoom = zNew;
    redrawGridCanvas();
  }

  function bindGridCanvas(cv) {
    if (!cv) return;
    var dragging = null;
    var last = null;
    function pos(e) {
      var rect = cv.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * cv.width,
        y: ((e.clientY - rect.top) / rect.height) * cv.height,
      };
    }
    cv.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        if (!state._gridImg) return;
        var p = pos(e);
        applyGridZoom((state._gridZoom || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
      },
      { passive: false }
    );
    cv.addEventListener('pointerdown', function (e) {
      if (!state._gridImg) return;
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {}
      var p = pos(e);
      last = p;
      var m = gridViewMetrics();
      var pan = state._gridPan || { x: 0, y: 0 };
      var best = null;
      var bestD = 9;
      if (Array.isArray(state._gridColLines)) {
        state._gridColLines.forEach(function (f, i) {
          var gx = pan.x + m.cw * Number(f) * m.drawScale;
          if (Math.abs(p.x - gx) < bestD) {
            bestD = Math.abs(p.x - gx);
            best = { type: 'vline', i: i };
          }
        });
      }
      if (Array.isArray(state._gridRowLines)) {
        state._gridRowLines.forEach(function (f, i) {
          var gy = pan.y + m.H * Number(f) * m.drawScale;
          if (Math.abs(p.y - gy) < bestD) {
            bestD = Math.abs(p.y - gy);
            best = { type: 'hline', i: i };
          }
        });
      }
      dragging = best || { type: 'pan' };
      cv.classList.add('is-dragging');
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!dragging || !state._gridImg) return;
      var p = pos(e);
      var m = gridViewMetrics();
      var pan = state._gridPan || { x: 0, y: 0 };
      if (dragging.type === 'vline') {
        var f = Math.max(0, Math.min(1, (p.x - pan.x) / (m.cw * m.drawScale)));
        state._gridColLines[dragging.i] = f;
      } else if (dragging.type === 'hline') {
        var fy = Math.max(0, Math.min(1, (p.y - pan.y) / (m.H * m.drawScale)));
        state._gridRowLines[dragging.i] = fy;
      } else if (dragging.type === 'pan' && last) {
        pan.x += p.x - last.x;
        pan.y += p.y - last.y;
        last = p;
      }
      redrawGridCanvas();
    });
    function endDrag() {
      dragging = null;
      last = null;
      cv.classList.remove('is-dragging');
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
  }

  function openGridSplit(files) {
    if (!files || !files.length) return;
    state._gridFiles = Array.prototype.slice.call(files);
    state._gridIndex = 0;
    state._gridCols = 3;
    state._gridRows = 2;
    state._gridCrop = 0;
    state._gridZoom = 1;
    state._gridPan = { x: 0, y: 0 };
    state._gridColLines = null;
    state._gridRowLines = null;
    state._gridImg = null;
    renderGridSplit();
  }

  function renderGridSplit() {
    var scroll = $('[data-ecm-scroll]');
    if (!scroll || !state || !state._gridFiles || !state._gridFiles.length) return;
    var total = state._gridFiles.length;
    var idx = Math.min(total - 1, Math.max(0, state._gridIndex || 0));
    var cols = Math.max(1, Math.min(4, Number(state._gridCols) || 2));
    var rows = Math.max(1, Math.min(8, Number(state._gridRows) || 3));
    var crop = Math.max(0, Math.min(60, Number(state._gridCrop) || 0));
    scroll.innerHTML =
      '<div class="ecm-grid">' +
      '<div class="ecm-grid-head">' +
      '<strong>网格拆分</strong>' +
      '<span class="ecm-muted">' +
      (total > 1 ? '第 ' + (idx + 1) + ' / ' + total + ' 张 · ' : '') +
      '共 ' + (cols * rows) + ' 格（每格=1个声骸）' +
      '</span>' +
      '</div>' +
      '<div class="ecm-grid-body">' +
      '<div class="ecm-grid-zoom">' +
      '<span>缩放</span>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-zoom-out title="缩小">−</button>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-zoom-in title="放大">＋</button>' +
      '<span class="ecm-grid-zoom-label" data-ecm-grid-zoom-label>100%</span>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-zoom-fit title="适应窗口">适应</button>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-lines-reset title="网格线恢复均分">重置网格</button>' +
      '</div>' +
      '<div class="ecm-grid-preview"><canvas data-ecm-grid-canvas></canvas></div>' +
      '<div class="ecm-grid-hint">滚轮缩放 · 拖动空白处平移 · 拖动金色网格线微调对齐</div>' +
      '<div class="ecm-grid-controls">' +
      '<div class="ecm-grid-row"><span>列数</span>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-minus="cols">−</button>' +
      '<input type="number" min="1" max="4" data-ecm-grid-val="cols" value="' + cols + '" />' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-plus="cols">+</button></div>' +
      '<div class="ecm-grid-row"><span>行数</span>' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-minus="rows">−</button>' +
      '<input type="number" min="1" max="8" data-ecm-grid-val="rows" value="' + rows + '" />' +
      '<button type="button" class="ecm-grid-step" data-ecm-grid-plus="rows">+</button></div>' +
      '<div class="ecm-grid-row"><span>左侧裁剪 ' + crop + '%</span>' +
      '<input type="range" min="0" max="60" step="1" data-ecm-grid-val="crop" value="' + crop + '" />' +
      '<span class="ecm-muted">去掉悬浮评分面板</span></div>' +
      (total > 1
        ? '<div class="ecm-grid-row"><span>图片</span>' +
          '<button type="button" class="ecm-grid-step" data-ecm-grid-prev>‹ 上一张</button>' +
          '<button type="button" class="ecm-grid-step" data-ecm-grid-next>下一张 ›</button></div>'
        : '') +
      '</div>' +
      '</div>' +
      '<div class="ecm-grid-actions">' +
      '<button type="button" class="ecm-ocr-back" data-ecm-grid-back>返回</button>' +
      '<button type="button" class="ecm-ocr-apply" data-ecm-grid-run-ai>切分后 AI 识别</button>' +
      '<button type="button" class="ecm-ocr-apply" data-ecm-grid-run>切分后本地识别</button>' +
      '</div>' +
      '</div>';
    var file = state._gridFiles[idx];
    loadImageElement(file).then(function (img) {
      var cv = scroll.querySelector('[data-ecm-grid-canvas]');
      if (cv) {
        state._gridImg = img;
        ensureGridLines();
        drawGridPreview(
          cv,
          img,
          cols,
          rows,
          crop,
          state._gridColLines,
          state._gridRowLines,
          state._gridZoom,
          state._gridPan
        );
        var lbl = scroll.querySelector('[data-ecm-grid-zoom-label]');
        if (lbl) lbl.textContent = Math.round((state._gridZoom || 1) * 100) + '%';
        bindGridCanvas(cv);
      }
    });
  }

  function gridFilesToCells(files, cols, rows, cropLeftPct) {
    var cells = [];
    var chain = Promise.resolve();
    files.forEach(function (file, fi) {
      chain = chain.then(function () {
        return loadImageElement(file).then(function (img) {
          var W = img.naturalWidth;
          var H = img.naturalHeight;
          var cropX = Math.round((W * Number(cropLeftPct)) / 100);
          var cw = Math.max(1, W - cropX);
          var cellW = Math.floor(cw / cols);
          var cellH = Math.floor(H / rows);
          return new Promise(function (resolveCells) {
            var pending = 0;
            var cv = document.createElement('canvas');
            cv.width = cellW;
            cv.height = cellH;
            var ctx = cv.getContext('2d');
            function emit(r, c) {
              var sx = cropX + c * cellW;
              var sy = r * cellH;
              ctx.clearRect(0, 0, cellW, cellH);
              ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
              cv.toBlob(function (blob) {
                if (blob) {
                  cells.push(
                    new File([blob], (file.name || 'echo') + '-r' + (r + 1) + 'c' + (c + 1) + '.png', {
                      type: 'image/png',
                    })
                  );
                }
                pending--;
                if (pending === 0) resolveCells();
              }, 'image/png');
            }
            for (var r = 0; r < rows; r++) {
              for (var c = 0; c < cols; c++) {
                pending++;
                emit(r, c);
              }
            }
            if (pending === 0) resolveCells();
          });
        });
      });
    });
    return chain.then(function () {
      return cells;
    });
  }

  function runGridSplit(useAI) {
    if (!state || !state._gridFiles || !state._gridFiles.length) return;
    var cols = Math.max(1, Math.min(4, Number(state._gridCols) || 3));
    var rows = Math.max(1, Math.min(8, Number(state._gridRows) || 2));
    var crop = Math.max(0, Math.min(60, Number(state._gridCrop) || 0));
    var scroll = $('[data-ecm-scroll]');
    if (scroll) {
      scroll.innerHTML =
        '<div class="ecm-ocr-loading">正在按 ' + cols + '×' + rows + ' 网格拆分识别…</div>';
    }
    state._ocrUseAI = !!useAI;
    if (useAI) state._ocrAiModel = getAiOcrModel();
    runOcr(state._gridFiles, {
      grid: {
        cols: cols,
        rows: rows,
        cropLeft: crop,
        colLines: state._gridColLines,
        rowLines: state._gridRowLines,
      },
    });
  }

  function runOcr(files, opts) {
    if (!files || !files.length) return;
    var useAI = !!state._ocrUseAI;
    state._ocrUseAI = false;
    var scroll = $('[data-ecm-scroll]');
    function setOcrLoading(msg) {
      if (!scroll) return;
      scroll.innerHTML =
        '<div class="ecm-ocr-loading">' +
        esc(msg || '正在识别…') +
        (useAI
          ? '<div class="ecm-ocr-tip">AI 识别：使用你自己的 API Key，费用由 Key 承担；图片会发送给 AI 服务商。结果请核对后再应用。</div>'
          : '<div class="ecm-ocr-tip">本地 PaddleOCR，不上传服务器。结果请核对后再应用。</div>') +
        '</div>';
    }
    function handleResults(results) {
      var engines = [];
      var notes = [];
      (results || []).forEach(function (img) {
        if (img.engine && engines.indexOf(img.engine) < 0) engines.push(img.engine);
        if (img.engineNote) notes.push(img.engineNote);
      });
      state.ocr = {
        images: results,
        engine: engines.join('+') || '',
        engineNote: notes[0] || '',
        cards: results.reduce(function (acc, img) {
          (img.cards || []).forEach(function (c) {
            acc.push({
              cost: Number(c.cost) || 0,
              main1Id: c.main1 ? c.main1.id : '',
              main1Element: c.main1 ? c.main1.element || '' : '',
              main1Fuzzy: c.main1 ? !!c.main1.fuzzy : false,
              subs: (c.subs || []).slice(0, 5).map(function (s) {
                return { id: s.id, value: s.value, damageType: s.damageType || '', fuzzy: !!s.fuzzy };
              }),
              raw: (c.raw || []).slice(0, 12).join(' / '),
              label: c.label || '',
              template: c.template || img.template || '',
              engine: img.engine || '',
            });
          });
          return acc;
        }, []),
      };
      if (!state.ocr.cards.length) {
        var emptyScroll = $('[data-ecm-scroll]');
        if (emptyScroll) {
          emptyScroll.innerHTML =
            '<div class="ecm-ocr-loading is-err">未识别到声骸卡片</div>' +
            '<div class="ecm-ocr-tip">请确认：①截图是清晰的声骸属性图（小程序彩字图 / 游戏内详情）②模型填的是视觉模型 ID（qwen3-vl-plus 等）③API Key 有效。也可以换回默认模型 qwen3-vl-plus 再试。</div>';
        }
        return;
      }
      renderOcrReview();
    }
    function handleError(err) {
      var scroll2 = $('[data-ecm-scroll]');
      if (scroll2) {
        scroll2.innerHTML =
          '<div class="ecm-ocr-loading is-err">识别失败：' +
          esc(err && err.message ? err.message : '未知错误') +
          '<br/><span class="ecm-muted">' +
          (useAI
            ? '请检查 API Key 是否正确、网络是否可达（DashScope）。'
            : '请使用：①小程序五彩词条图，或②游戏内官方声骸详情（COST/+副词条），单张清晰截图。') +
          '</span></div>';
      }
    }
    setOcrLoading(
      useAI
        ? '正在调用 AI 识别…（普通模型几秒~十几秒；思考型模型可能需要 1~2 分钟，请耐心等待）'
        : '正在准备 PaddleOCR…'
    );
    window.EchoOCR.onStatus = setOcrLoading;
    var p = useAI
      ? window.EchoOCR.recognizeWithAI(files, getAiOcrKey(), { model: state._ocrAiModel || getAiOcrModel() })
      : window.EchoOCR.recognize(files, opts || undefined);
    p.then(handleResults).catch(handleError);
  }

  function ocrMainOptions(cost, selectedId) {
    var opts = typeof ECHO_MAIN1_OPTIONS !== 'undefined' ? ECHO_MAIN1_OPTIONS[cost] : null;
    var html = '<option value="">—</option>';
    if (!opts) return html;
    opts.forEach(function (o) {
      var sel = String(o.id) === String(selectedId) ? ' selected' : '';
      html += '<option value="' + esc(o.id) + '"' + sel + '>' + esc(o.label) + '</option>';
    });
    return html;
  }

  function ocrSubOptions(selectedId) {
    var defs = typeof ECHO_SUB_AFFIXES !== 'undefined' ? ECHO_SUB_AFFIXES : {};
    var html = '<option value="">—</option>';
    Object.keys(defs).forEach(function (id) {
      var sel = id === selectedId ? ' selected' : '';
      html += '<option value="' + esc(id) + '"' + sel + '>' + esc(defs[id].label) + '</option>';
    });
    return html;
  }

  /** 识别校对页的副词条数值：档位下拉（含不在档位表但合法的固定值如 攻击150/生命2280） */
  function ocrSubValueOptions(affixId, currentValue) {
    var affix = (typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES[affixId]) || null;
    var unit = affix && affix.unit === 'flat' ? '' : '%';
    var rolls = affix && Array.isArray(affix.rolls) ? affix.rolls.slice() : [];
    var cur = Number(currentValue);
    if (Number.isFinite(cur) && cur > 0 && rolls.indexOf(cur) < 0) {
      rolls.push(cur);
    }
    if (!rolls.length) return '<option value="">—</option>';
    return (
      '<option value="">— 档位 —</option>' +
      rolls
        .sort(function (a, b) {
          return Number(b) - Number(a);
        })
        .map(function (r) {
          var sel = Math.abs(Number(r) - cur) < 1e-9 ? ' selected' : '';
          return '<option value="' + r + '"' + sel + '>' + r + unit + '</option>';
        })
        .join('')
    );
  }

  function renderOcrReview() {
    var scroll = $('[data-ecm-scroll]');
    if (!scroll || !state.ocr) return;
    var ocr = state.ocr;
    var warnCount = 0;
    ocr.cards.forEach(function (card) {
      if (card && card.main1Fuzzy) warnCount++;
      (card && card.subs ? card.subs : []).forEach(function (sub) {
        if (sub && sub.fuzzy) warnCount++;
      });
    });
    var cardsHtml = ocr.cards
      .map(function (card, i) {
        var subRows = card.subs
          .map(function (sub, si) {
            var typeHint =
              sub.id === 'sub_type_dmg' && sub.damageType
                ? '<span class="ecm-ocr-el-hint">' + esc(sub.damageType) + '</span>'
                : '';
            return (
              '<div class="ecm-ocr-sub' + (sub.fuzzy ? ' is-fuzzy' : '') + '">' +
              (sub.fuzzy
                ? '<span class="ecm-ocr-warn-icon" title="近似匹配（OCR 可能有缺字/错字），请核对">⚠</span>'
                : '') +
              '<select data-ocr-sub-id="' + i + '" data-ocr-sub-idx="' + si + '">' + ocrSubOptions(sub.id) + '</select>' +
              typeHint +
              '<select data-ocr-sub-val="' + i + '" data-ocr-sub-idx="' + si + '">' + ocrSubValueOptions(sub.id, sub.value) + '</select>' +
              '<button type="button" class="ecm-ocr-sub-del" data-ocr-sub-del="' + i + '" data-ocr-sub-idx="' + si + '" title="删除该副词条">×</button>' +
              '</div>'
            );
          })
          .join('');
        var costSel =
          '<select data-ocr-cost="' + i + '">' +
          [0, 1, 3, 4]
            .map(function (c) {
              var sel = Number(card.cost) === c ? ' selected' : '';
              return '<option value="' + c + '"' + sel + '>' + (c ? c + 'C' : '自动(未识别)') + '</option>';
            })
            .join('') +
          '</select>';
        var mainSel =
          '<select data-ocr-main="' + i + '">' + ocrMainOptions(card.cost, card.main1Id) + '</select>' +
          (card.main1Element
            ? '<span class="ecm-ocr-el-hint">' + esc(card.main1Element) + '增伤</span>'
            : '') +
          (card.main1Fuzzy
            ? '<span class="ecm-ocr-warn-icon" title="主词条为近似匹配，请核对">⚠</span>'
            : '');
        return (
          '<div class="ecm-ocr-card">' +
          '<div class="ecm-ocr-card-head">声骸 ' + (i + 1) +
          (card.label ? ' · ' + esc(card.label) : '') +
          (card.template
            ? '<span class="ecm-ocr-tpl">' +
              (card.template === 'miniprogram' ? '小程序' : card.template === 'ingame' ? '游戏内' : esc(card.template)) +
              '</span>'
            : '') +
          (card.engine
            ? '<span class="ecm-ocr-tpl" title="识别引擎">' +
              (card.engine === 'paddle' ? 'Paddle' : card.engine === 'tesseract' ? 'Tesseract' : esc(card.engine)) +
              '</span>'
            : '') +
          (card.raw ? '<span class="ecm-ocr-raw" title="' + esc(card.raw) + '">原文案</span>' : '') +
          '<button type="button" class="ecm-ocr-card-del" data-ocr-card-del="' + i + '" title="删除这张识别结果">删除</button>' +
          '</div>' +
          '<div class="ecm-ocr-row"><span>成本</span>' + costSel + '</div>' +
          '<div class="ecm-ocr-row"><span>主词条</span>' + mainSel + '</div>' +
          '<div class="ecm-ocr-subs">' + (subRows || '<span class="ecm-muted">未识别到副词条</span>') + '</div>' +
          '</div>'
        );
      })
      .join('');
    scroll.innerHTML =
      '<div class="ecm-ocr-review">' +
      '<div class="ecm-ocr-head">' +
      '<strong>识别结果校对</strong>' +
      '<button type="button" class="ecm-ocr-back" data-ecm-ocr-back>返回编辑</button>' +
      '</div>' +
      (warnCount > 0
        ? '<div class="ecm-ocr-warn">⚠ 有 <b>' + warnCount + '</b> 条词条为近似匹配（识别可能不准确），请逐条核对后再应用。</div>'
        : '') +
      '<p class="ecm-muted">已识别 ' +
      ocr.cards.length +
      ' 张声骸，请确认成本/主词条/副词条后点「应用到配置」。' +
      '<br/><span class="ecm-ocr-tip-inline">也可以直接点底部「保存配置」，会自动应用识别结果再保存。</span>' +
      '<br/><span class="ecm-ocr-tip-inline">本地识图仅供辅助，请务必人工核对后再应用。' +
      (ocr.engine ? ' 引擎：' + esc(ocr.engine === 'paddle' ? 'PaddleOCR' : ocr.engine) + '。' : '') +
      (ocr.engineNote ? '<br/>' + esc(ocr.engineNote) : '') +
      '</span></p>' +
      (cardsHtml || '<p class="ecm-muted">没有识别到卡片，请换更清晰的截图。</p>') +
      '<div class="ecm-ocr-actions">' +
      '<button type="button" class="ecm-ocr-apply" data-ecm-ocr-apply>应用到配置</button>' +
      '</div>' +
      '</div>';
  }

  function applyOcrCards() {
    if (!state || !state.ocr) return;
    var cfg = state.config;
    var slots = cfg.slots;
    var assigned = {};
    state.ocr.cards.forEach(function (card) {
      var cost = Number(card.cost);
      if (!cost) return;
      var idx = -1;
      for (var i = 0; i < slots.length; i++) {
        if (Number(slots[i].cost) === cost && !assigned[i]) { idx = i; break; }
      }
      if (idx < 0) return;
      assigned[idx] = true;
      var slot = slots[idx];
      if (card.main1Id) {
        slot.main1 = card.main1Id;
        if (card.main1Id === 'main_element_dmg') slot.main1Element = card.main1Element;
      }
      slot.subs = card.subs.map(function (s) {
        return { id: s.id, value: Number(s.value) || 0, damageType: s.damageType || '' };
      });
    });
    state.config = normalizeConfig(cfg);
    state.ocr = null;
    render();
  }

  function exitOcrReview() {
    if (state) state.ocr = null;
    render();
  }

  function bind() {
    document.body.addEventListener('click', function (e) {
      if (!state) return;
      if (e.target.closest('[data-ecm-close]')) {
        close();
        return;
      }
      if (e.target.hasAttribute('data-ecm-root') && e.target.closest('[data-ecm-root]') === $('[data-ecm-root]')) {
        if (e.target.classList.contains('ecm-overlay')) close();
        return;
      }
      if (e.target.closest('[data-ecm-ocr]')) {
        openOcrImport();
        return;
      }
      if (e.target.closest('[data-ecm-ocr-ai]')) {
        openAiOcrImport();
        return;
      }
      if (e.target.closest('[data-ecm-ocr-grid]')) {
        openGridImport();
        return;
      }
      if (e.target.closest('[data-ecm-grid-back]')) {
        state._gridFiles = null;
        state._gridIndex = 0;
        render();
        return;
      }
      if (e.target.closest('[data-ecm-grid-zoom-in]')) {
        var cvIn = $('[data-ecm-scroll]') ? $('[data-ecm-scroll]').querySelector('[data-ecm-grid-canvas]') : null;
        applyGridZoom((state._gridZoom || 1) * 1.3, cvIn ? cvIn.width / 2 : 0, cvIn ? cvIn.height / 2 : 0);
        return;
      }
      if (e.target.closest('[data-ecm-grid-zoom-out]')) {
        var cvOut = $('[data-ecm-scroll]') ? $('[data-ecm-scroll]').querySelector('[data-ecm-grid-canvas]') : null;
        applyGridZoom((state._gridZoom || 1) / 1.3, cvOut ? cvOut.width / 2 : 0, cvOut ? cvOut.height / 2 : 0);
        return;
      }
      if (e.target.closest('[data-ecm-grid-zoom-fit]')) {
        state._gridZoom = 1;
        state._gridPan = { x: 0, y: 0 };
        redrawGridCanvas();
        return;
      }
      if (e.target.closest('[data-ecm-grid-lines-reset]')) {
        state._gridColLines = null;
        state._gridRowLines = null;
        state._gridPan = { x: 0, y: 0 };
        ensureGridLines();
        redrawGridCanvas();
        return;
      }
      var gridStep = e.target.closest('[data-ecm-grid-plus], [data-ecm-grid-minus]');
      if (gridStep) {
        var gk = gridStep.dataset.ecmGridPlus || gridStep.dataset.ecmGridMinus;
        var dir = gridStep.hasAttribute('data-ecm-grid-plus') ? 1 : -1;
        if (gk === 'cols') state._gridCols = Math.max(1, Math.min(4, (Number(state._gridCols) || 2) + dir));
        if (gk === 'rows') state._gridRows = Math.max(1, Math.min(8, (Number(state._gridRows) || 3) + dir));
        if (gk === 'crop') state._gridCrop = Math.max(0, Math.min(60, (Number(state._gridCrop) || 0) + dir * 5));
        renderGridSplit();
        return;
      }
      if (e.target.closest('[data-ecm-grid-prev]')) {
        state._gridIndex = Math.max(0, (Number(state._gridIndex) || 0) - 1);
        renderGridSplit();
        return;
      }
      if (e.target.closest('[data-ecm-grid-next]')) {
        state._gridIndex = Math.min(
          (state._gridFiles ? state._gridFiles.length : 1) - 1,
          (Number(state._gridIndex) || 0) + 1
        );
        renderGridSplit();
        return;
      }
      if (e.target.closest('[data-ecm-grid-run]')) {
        runGridSplit(false);
        return;
      }
      if (e.target.closest('[data-ecm-grid-run-ai]')) {
        runGridSplit(true);
        return;
      }
      if (e.target.closest('[data-ecm-ocr-back]')) {
        exitOcrReview();
        return;
      }
      if (e.target.closest('[data-ecm-ocr-apply]')) {
        applyOcrCards();
        return;
      }
      var ocrCardDel = e.target.closest('[data-ocr-card-del]');
      if (ocrCardDel && state.ocr) {
        var cdi = Number(ocrCardDel.dataset.ocrCardDel);
        if (state.ocr.cards[cdi]) state.ocr.cards.splice(cdi, 1);
        renderOcrReview();
        return;
      }
      var ocrSubDel = e.target.closest('[data-ocr-sub-del]');
      if (ocrSubDel && state.ocr) {
        var oi = Number(ocrSubDel.dataset.ocrSubDel);
        var oj = Number(ocrSubDel.dataset.ocrSubIdx);
        if (state.ocr.cards[oi]) state.ocr.cards[oi].subs.splice(oj, 1);
        renderOcrReview();
        return;
      }
      var layoutBtn = e.target.closest('[data-ecm-layout]');
      if (layoutBtn) {
        applyLayout(layoutBtn.dataset.ecmLayout);
        return;
      }
      var addSet = e.target.closest('[data-ecm-add-set]');
      if (addSet) {
        addSetRow();
        return;
      }
      var setRemove = e.target.closest('[data-ecm-set-remove]');
      if (setRemove) {
        var ri = Number(setRemove.dataset.ecmSetRemove);
        if (state.config.setLoadout[ri]) {
          state.config.setLoadout[ri].setId = null;
          state.config.setLoadout[ri].count = 0;
        }
        render();
        return;
      }
      var setPick = e.target.closest('[data-ecm-set-pick]');
      if (setPick) {
        openSetPicker(Number(setPick.dataset.ecmSetPick));
        return;
      }
      var mainSpecimen = e.target.closest('[data-ecm-main-specimen]');
      if (mainSpecimen) {
        openMainSpecimenPicker();
        return;
      }
      var setMinus = e.target.closest('[data-ecm-set-minus]');
      if (setMinus) {
        var mi = Number(setMinus.dataset.ecmSetMinus);
        if (state.config.setLoadout[mi]) {
          state.config.setLoadout[mi].count = Math.max(0, (Number(state.config.setLoadout[mi].count) || 0) - 1);
        }
        render();
        return;
      }
      var setPlus = e.target.closest('[data-ecm-set-plus]');
      if (setPlus) {
        var pi = Number(setPlus.dataset.ecmSetPlus);
        var others = (state.config.setLoadout || []).reduce(function (sum, row, idx) {
          return idx === pi ? sum : sum + (Number(row.count) || 0);
        }, 0);
        if (state.config.setLoadout[pi]) {
          state.config.setLoadout[pi].count = Math.min(5, (Number(state.config.setLoadout[pi].count) || 0) + 1);
        }
        render();
        return;
      }
      var subDel = e.target.closest('[data-ecm-sub-del]');
      if (subDel) {
        var sIdx = Number(subDel.dataset.ecmSubDel);
        var subIdx = Number(subDel.dataset.ecmSubIdx);
        var s2 = state.config.slots[sIdx];
        if (s2 && s2.subs[subIdx]) s2.subs.splice(subIdx, 1);
        render();
        return;
      }
      var subAddRow = e.target.closest('[data-ecm-sub-add-row]');
      if (subAddRow) {
        var affixId = subAddRow.dataset.ecmSubAddRow;
        var dmgType = subAddRow.dataset.ecmSubAddType || '';
        addAffixToFirstSlot(affixId, dmgType);
        return;
      }
      var newCatGo = e.target.closest('[data-ecm-new-cat-go]');
      if (newCatGo) {
        var sel = $('[data-ecm-new-cat]');
        if (sel && sel.value) {
          var parts = sel.value.split(':');
          addAffixToFirstSlot(parts[0], parts.length > 1 ? parts.slice(1).join(':') : '');
        }
        return;
      }
      var saveBtn = e.target.closest('[data-ecm-save]');
      if (saveBtn) {
        // 识别校对页直接点保存时，先把识别结果应用进配置，避免存成空配置
        if (state.ocr && state.ocr.cards && state.ocr.cards.length) {
          applyOcrCards();
        }
        var result = buildResult();
        var cb = state.onSave;
        close();
        if (cb) cb(result);
      }
    });

    document.body.addEventListener('change', function (e) {
      if (!state) return;
      if (e.target.matches('[data-ecm-ocr-input]')) {
        if (state._ocrGridMode) {
          state._ocrGridMode = false;
          openGridSplit(e.target.files);
          return;
        }
        runOcr(e.target.files);
        return;
      }
      var gridVal = e.target.closest('[data-ecm-grid-val]');
      if (gridVal) {
        var gvk = gridVal.dataset.ecmGridVal;
        var gvv = Number(gridVal.value);
        if (gvk === 'cols') state._gridCols = Math.max(1, Math.min(4, Number.isFinite(gvv) ? gvv : 2));
        if (gvk === 'rows') state._gridRows = Math.max(1, Math.min(8, Number.isFinite(gvv) ? gvv : 3));
        if (gvk === 'crop') state._gridCrop = Math.max(0, Math.min(60, Number.isFinite(gvv) ? gvv : 0));
        renderGridSplit();
        return;
      }
      if (state.ocr) {
        var ocrCost = e.target.closest('[data-ocr-cost]');
        if (ocrCost) {
          var ci = Number(ocrCost.dataset.ocrCost);
          if (state.ocr.cards[ci]) {
            state.ocr.cards[ci].cost = Number(ocrCost.value) || 0;
            state.ocr.cards[ci].main1Id = '';
          }
          renderOcrReview();
          return;
        }
        var ocrMain = e.target.closest('[data-ocr-main]');
        if (ocrMain) {
          var mi3 = Number(ocrMain.dataset.ocrMain);
          if (state.ocr.cards[mi3]) state.ocr.cards[mi3].main1Id = ocrMain.value || '';
          return;
        }
        var ocrSubId = e.target.closest('[data-ocr-sub-id]');
        if (ocrSubId) {
          var si3 = Number(ocrSubId.dataset.ocrSubId);
          var sj = Number(ocrSubId.dataset.ocrSubIdx);
          if (state.ocr.cards[si3] && state.ocr.cards[si3].subs[sj]) {
            state.ocr.cards[si3].subs[sj].id = ocrSubId.value || '';
          }
          return;
        }
        var ocrSubVal = e.target.closest('[data-ocr-sub-val]');
        if (ocrSubVal) {
          var vi2 = Number(ocrSubVal.dataset.ocrSubVal);
          var vj2 = Number(ocrSubVal.dataset.ocrSubIdx);
          if (state.ocr.cards[vi2] && state.ocr.cards[vi2].subs[vj2]) {
            state.ocr.cards[vi2].subs[vj2].value = Number(ocrSubVal.value) || 0;
          }
          return;
        }
      }
      var main1 = e.target.closest('[data-ecm-main1]');
      if (main1) {
        var mi = Number(main1.dataset.ecmMain1);
        if (state.config.slots[mi]) {
          state.config.slots[mi].main1 = main1.value || '';
        }
        render();
        return;
      }
      var mainEl = e.target.closest('[data-ecm-main-el]');
      if (mainEl) {
        var si2 = Number(mainEl.dataset.ecmMainEl);
        if (state.config.slots[si2]) {
          // 下拉框 value 是数字键，配置里统一存中文名（供归一化/面板识别）
          var elTypes = typeof ELEMENT_TYPES !== 'undefined' ? ELEMENT_TYPES : {};
          var elDef = elTypes[mainEl.value];
          state.config.slots[si2].main1Element = (elDef && elDef.label) || '';
        }
        return;
      }
      var subType = e.target.closest('[data-ecm-sub-type]');
      if (subType) {
        var c = Number(subType.dataset.ecmSubType);
        var d = Number(subType.dataset.ecmSubIdx);
        if (state.config.slots[c] && state.config.slots[c].subs[d]) {
          state.config.slots[c].subs[d].damageType = subType.value || '';
        }
        return;
      }
      var subValue = e.target.closest('[data-ecm-sub-value]');
      if (subValue) {
        var m = Number(subValue.dataset.ecmSubValue);
        var n = Number(subValue.dataset.ecmSubIdx);
        if (state.config.slots[m] && state.config.slots[m].subs[n]) {
          state.config.slots[m].subs[n].value = Number(subValue.value) || 0;
        }
        return;
      }
    });

    document.body.addEventListener('input', function (e) {
      if (!state || !state.ocr) return;
      var ocrVal = e.target.closest('[data-ocr-sub-val]');
      if (!ocrVal) return;
      var vi = Number(ocrVal.dataset.ocrSubVal);
      var vj = Number(ocrVal.dataset.ocrSubIdx);
      if (state.ocr.cards[vi] && state.ocr.cards[vi].subs[vj]) {
        state.ocr.cards[vi].subs[vj].value = Number(ocrVal.value) || 0;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state && $('[data-ecm-root]')) {
        close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.EchoConfigModal = {
    open: open,
    close: close,
    startOcr: openOcrImport,
    isOpen: function () {
      return !!state;
    },
  };
})();
