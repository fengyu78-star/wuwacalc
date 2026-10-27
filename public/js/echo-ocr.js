/* 声骸截图识图导入（纯前端）
 * 主引擎：百度 PaddleOCR.js（@paddleocr/paddleocr-js，浏览器 ONNX）
 * 回退：Tesseract.js
 * API: EchoOCR.recognize(files) -> Promise<{ name, cards: [{ cost, main1, subs, raw, label }] }[]>
 *
 * 两类模板：①小程序五彩词条图 ②游戏内官方声骸详情（COST / +副词条）
 */
(function () {
  'use strict';

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  // 本地 PaddleOCR（PP-OCRv4，ONNX Runtime Web）：引擎/模型由本地静态服务 /paddle/* 托管（文件在 F 盘）
  var PADDLE_ENGINE_URL = '/paddle/demo.js?v=20260809p';
  var PADDLE_ENGINE_BASE = '/paddle/';
  var PADDLE_MODEL_BASE = '/paddle/assets/';
  var PADDLE_WASM_BASE = '/paddle/ort/';
  // 本地引擎包缓存名（index.html 里定义，双保险兜底）；未导入时引导网盘下载，不再从网站拉取
  var PADDLE_LOCAL_CACHE_NAME =
    typeof PADDLE_LOCAL_CACHE !== 'undefined' ? PADDLE_LOCAL_CACHE : 'paddle-local-v1';
  var ERR_NEED_PADDLE_IMPORT = 'PADDLE_NEED_IMPORT';
  var tesseractPromise = null;
  var workerPromise = null;
  var paddlePromise = null;

  function emitStatus(msg) {
    try {
      if (typeof window.EchoOCR !== 'undefined' && typeof window.EchoOCR.onStatus === 'function') {
        window.EchoOCR.onStatus(String(msg || ''));
      }
    } catch (e) {}
  }

  /** 给依赖 Node 探测的 WASM/OpenCV 垫一层，避免浏览器里 process.binding 直接炸 */
  function ensureBrowserProcessShim() {
    var g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (!g.process || typeof g.process !== 'object') g.process = {};
    var p = g.process;
    if (!p.env) p.env = {};
    p.browser = true;
    if (!p.versions) p.versions = { node: '18.0.0' };
    p.binding = function () {
      return {};
    };
    if (typeof p.cwd !== 'function') p.cwd = function () { return '/'; };
    if (typeof p.nextTick !== 'function') {
      p.nextTick = function (fn) {
        Promise.resolve().then(fn);
      };
    }
  }

  function loadTesseract() {
    if (typeof window.Tesseract !== 'undefined') return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TESSERACT_CDN;
      s.onload = function () {
        if (typeof window.Tesseract !== 'undefined') resolve(window.Tesseract);
        else reject(new Error('OCR 组件加载异常'));
      };
      s.onerror = function () {
        tesseractPromise = null;
        reject(new Error('OCR 组件加载失败，请检查网络后重试'));
      };
      document.head.appendChild(s);
    });
    return tesseractPromise;
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = loadTesseract().then(function (T) {
      return T.createWorker('chi_sim', 1, {
        logger: function () {},
      });
    });
    return workerPromise;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve(img);
        URL.revokeObjectURL(url);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  /**
   * 暗色 UI → 白底黑字。
   * mode:
   *  - ingame: 游戏内官方详情（白/金字为主）
   *  - miniprogram: 小程序五彩词条（青/紫/红/金）
   *  - color / default: 兼容别名
   */
  function preprocess(img, scale, mode) {
    scale = scale || 2.5;
    mode = mode || 'ingame';
    if (mode === 'color') mode = 'miniprogram';
    if (mode === 'default') mode = 'ingame';
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var w = Math.max(1, Math.round(iw * scale));
    var h = Math.max(1, Math.round(ih * scale));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var d = data.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i];
      var g = d[i + 1];
      var b = d[i + 2];
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      var peak = Math.max(r, g, b);
      var minc = Math.min(r, g, b);
      var chroma = peak - minc;
      var ink;
      if (mode === 'miniprogram') {
        var white = minc;
        var gold = Math.max(0, Math.min(r, g) - b * 0.65);
        var teal = Math.max(0, Math.min(g, b) - r * 0.55);
        var purple = Math.max(0, Math.min(r, b) - g * 0.4);
        var red = Math.max(0, r - Math.max(g, b) * 0.8);
        // 深色卡面（深蓝/紫底）：压黑背景只留亮字。
        // 否则彩色增强会把底色抬成灰白噪点，OCR 在噪声上误读（481/Yro!/t0:190 等）
        if (luma < 55 && peak < 115) {
          ink = 255;
        } else {
          ink = Math.max(luma * 1.05, peak * 0.95, white, gold * 2.1, teal * 2.7, purple * 2.6, red * 2.5);
          if (chroma > 20 && peak > 50) ink = Math.max(ink, 36 + chroma * 1.4 + peak * 0.38);
        }
      } else if (mode === 'gold') {
        // 专抬小程序金黄副词条（暴击/暴伤/攻击%）
        var goldY = Math.max(0, Math.min(r, g) - b * 0.45);
        var nearYellow = r > 90 && g > 70 && b < Math.min(r, g) * 0.85;
        ink = Math.max(luma * 0.9, goldY * 3.4, nearYellow ? peak * 1.15 : 0, minc * 0.85);
        if (nearYellow) ink = Math.max(ink, 90 + goldY);
      } else if (mode === 'goldStrict') {
        // 只保留金黄像素，专挖副暴伤/暴击金行
        var isGold =
          r > 95 &&
          g > 72 &&
          b < Math.min(r, g) * 0.9 &&
          Math.min(r, g) - b > 26 &&
          luma > 70;
        ink = isGold ? 255 : 0;
      } else if (mode === 'brightStrict') {
        // 高亮字（白/浅金），用于第二行「暴击伤害 16.2%」一类
        var isBright = luma > 155 && peak > 165;
        ink = isBright ? Math.min(255, luma + chroma * 0.5) : 0;
      } else {
        var goldIn = Math.max(0, Math.min(r, g) - b * 0.75);
        ink = Math.max(luma * 1.08, peak * 0.96, goldIn * 1.6);
        if (chroma > 40 && peak > 90) ink = Math.max(ink, peak * 0.9);
      }
      var v = 255 - ink;
      if (mode === 'miniprogram') v = v < 118 ? 0 : v > 168 ? 255 : (v - 118) * (255 / 50);
      else if (mode === 'gold') v = v < 112 ? 0 : v > 162 ? 255 : (v - 112) * (255 / 50);
      else if (mode === 'goldStrict' || mode === 'brightStrict') v = ink > 40 ? 0 : 255;
      else v = v < 98 ? 0 : v > 150 ? 255 : (v - 98) * (255 / 52);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  /** 像素启发式：彩字多 → 小程序；否则按游戏内官方详情 */
  function detectEchoTemplate(img) {
    var tw = 180;
    var th = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * tw));
    var c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, tw, th);
    var d = ctx.getImageData(0, 0, tw, th).data;
    var samples = 0;
    var colorful = 0;
    var tealish = 0;
    var purpleish = 0;
    for (var i = 0; i < d.length; i += 20) {
      var r = d[i];
      var g = d[i + 1];
      var b = d[i + 2];
      var peak = Math.max(r, g, b);
      var minc = Math.min(r, g, b);
      var chroma = peak - minc;
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < 38 || peak < 48) continue;
      samples++;
      if (chroma > 32 && peak > 68) {
        colorful++;
        if (g > r + 12 && b > r + 8) tealish++;
        if (r > 75 && b > 75 && g < Math.min(r, b) * 0.88) purpleish++;
      }
    }
    var ratio = samples ? colorful / samples : 0;
    if (ratio >= 0.07 || tealish + purpleish >= 10) return 'miniprogram';
    return 'ingame';
  }

  function refineTemplateByText(kind, text) {
    var t = String(text || '');
    // 游戏内：COST + 副词条行首 +
    if (/COST\s*[：:]?\s*[134]/i.test(t) && /(^|\n)\s*\+/.test(t)) return 'ingame';
    if (/COST\s*[：:]?\s*[134]/i.test(t) && /荣耀|狮像|\+25|\+20|\+15/.test(t)) return 'ingame';
    if (/小攻击|评分模板|调谐得分|GsScore/i.test(t)) return 'miniprogram';
    return kind || 'ingame';
  }

  // 先长后短
  var STAT_NAMES = [
    '共鸣解放伤害加成',
    '共鸣技能伤害加成',
    '普攻伤害加成',
    '重击伤害加成',
    '共鸣解放伤害',
    '共鸣技能伤害',
    '治疗效果加成',
    '湮灭伤害加成',
    '衍射伤害加成',
    '热熔伤害加成',
    '冷凝伤害加成',
    '导电伤害加成',
    '气动伤害加成',
    '光噪伤害加成',
    '暴击伤害',
    '暴击率',
    '共鸣效率',
    '湮灭增伤',
    '衍射增伤',
    '热熔增伤',
    '冷凝增伤',
    '导电增伤',
    '气动增伤',
    '光噪增伤',
    '暴击',
    '生命',
    '防御',
    '攻击',
  ];

  var ELEMENT_MAP = {
    湮灭: '湮灭',
    衍射: '衍射',
    热熔: '热熔',
    冷凝: '冷凝',
    导电: '导电',
    气动: '气动',
    光噪: '光噪',
  };

  var TYPE_DMG_MAP = {
    共鸣解放: '共鸣解放',
    共鸣技能: '共鸣技能',
    普攻: '普攻',
    重击: '重击',
  };

  function fixOcrStatText(s) {
    var t = String(s || '');
    t = t.replace(/共[鸣呜明]解[放改故]伤/g, '共鸣解放伤');
    t = t.replace(/共[鸣呜明]技[能熊]伤/g, '共鸣技能伤');
    t = t.replace(/暴[击擊]伤/g, '暴击伤');
    t = t.replace(/暴[击擊](?!伤)/g, '暴击');
    return t;
  }

  function matchStatName(joined) {
    var s = String(joined || '');
    for (var i = 0; i < STAT_NAMES.length; i++) {
      if (s.indexOf(STAT_NAMES[i]) >= 0) return STAT_NAMES[i];
    }
    var fixed = fixOcrStatText(s);
    if (fixed !== s) {
      for (var j = 0; j < STAT_NAMES.length; j++) {
        if (fixed.indexOf(STAT_NAMES[j]) >= 0) return STAT_NAMES[j];
      }
    }
    return '';
  }

  function editDistance(a, b) {
    a = String(a || '');
    b = String(b || '');
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    var cur = [];
    var j, i, k, tmp;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (k = 1; k <= b.length; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
      tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[b.length];
  }

  function commonCharCount(a, b) {
    var rest = String(b || '');
    var count = 0;
    for (var i = 0; i < String(a || '').length; i++) {
      var ch = String(a)[i];
      var idx = rest.indexOf(ch);
      if (idx >= 0) {
        count++;
        rest = rest.slice(0, idx) + '\u0000' + rest.slice(idx + 1);
      }
    }
    return count;
  }

  function fuzzyNameScore(text, name) {
    var t = String(text || '');
    var best = 0;
    var minLen = Math.max(1, name.length - 1);
    var maxLen = name.length + 2;
    for (var L = minLen; L <= Math.min(maxLen, t.length); L++) {
      for (var start = 0; start + L <= t.length; start++) {
        var win = t.slice(start, start + L);
        var denom = Math.max(win.length, name.length);
        var s = Math.max(commonCharCount(win, name) / denom, 1 - editDistance(win, name) / denom);
        if (s > best) best = s;
      }
    }
    return best;
  }

  function fuzzyStatName(cjkText) {
    if (!cjkText) return '';
    var pool = STAT_NAMES;
    // 含「解放/技能」时不要模糊成「暴击伤害」
    if (/解放/.test(cjkText)) {
      pool = STAT_NAMES.filter(function (n) {
        return n.indexOf('解放') >= 0;
      });
    } else if (/技能/.test(cjkText) && /伤/.test(cjkText)) {
      pool = STAT_NAMES.filter(function (n) {
        return n.indexOf('技能') >= 0;
      });
    } else if (/普攻/.test(cjkText)) {
      pool = STAT_NAMES.filter(function (n) {
        return n.indexOf('普攻') >= 0;
      });
    } else if (/重击/.test(cjkText)) {
      pool = STAT_NAMES.filter(function (n) {
        return n.indexOf('重击') >= 0;
      });
    }
    var best = '';
    var bestScore = 0;
    for (var i = 0; i < pool.length; i++) {
      var name = pool[i];
      var score = fuzzyNameScore(cjkText, name);
      if (score > bestScore || (score === bestScore && name.length > best.length)) {
        bestScore = score;
        best = name;
      }
    }
    var threshold = /解放|技能|普攻|重击|增伤|伤害/.test(cjkText) ? 0.45 : 0.55;
    return bestScore >= threshold ? best : '';
  }

  function normalizeStatName(name) {
    if (name === '暴击') return '暴击率';
    if (name === '共鸣解放伤害') return '共鸣解放伤害加成';
    if (name === '共鸣技能伤害') return '共鸣技能伤害加成';
    return name;
  }

  /** 评分卡噪声：MAX / 星标 / 尾部评分数字 */
  function scrubScoreNoise(text) {
    return String(text || '')
      .replace(/[★☆＊*]+\s*MAX/gi, ' ')
      .replace(/\bMAX\b/gi, ' ')
      .replace(/[★☆＊*]/g, ' ')
      .replace(/\bSSS?\b/gi, ' ')
      .replace(/小攻击/g, '攻击')
      .replace(/小生命/g, '生命');
  }

  function knownRollsForStat(name, unit) {
    if (typeof ECHO_SUB_AFFIXES === 'undefined' && typeof ECHO_MAIN1_OPTIONS === 'undefined') return [];
    var rolls = [];
    var n = name;
    var isPct = unit === '%';
    if (n === '暴击率') rolls = (ECHO_SUB_AFFIXES.sub_crit_rate && ECHO_SUB_AFFIXES.sub_crit_rate.rolls) || [];
    else if (n === '暴击伤害') rolls = (ECHO_SUB_AFFIXES.sub_crit_dmg && ECHO_SUB_AFFIXES.sub_crit_dmg.rolls) || [];
    else if (n === '攻击' && isPct) rolls = (ECHO_SUB_AFFIXES.sub_atk_percent && ECHO_SUB_AFFIXES.sub_atk_percent.rolls) || [];
    else if (n === '攻击' && !isPct) rolls = (ECHO_SUB_AFFIXES.sub_flat_atk && ECHO_SUB_AFFIXES.sub_flat_atk.rolls) || [150, 100];
    else if (n === '生命' && isPct) rolls = (ECHO_SUB_AFFIXES.sub_hp_percent && ECHO_SUB_AFFIXES.sub_hp_percent.rolls) || [];
    else if (n === '生命' && !isPct) rolls = (ECHO_SUB_AFFIXES.sub_flat_hp && ECHO_SUB_AFFIXES.sub_flat_hp.rolls) || [320, 360, 390, 430, 470, 510, 540, 580];
    else if (n === '防御' && isPct) rolls = (ECHO_SUB_AFFIXES.sub_def_percent && ECHO_SUB_AFFIXES.sub_def_percent.rolls) || [];
    else if (n === '防御' && !isPct) rolls = (ECHO_SUB_AFFIXES.sub_flat_def && ECHO_SUB_AFFIXES.sub_flat_def.rolls) || [40, 50, 60, 70];
    else if (n === '共鸣效率') rolls = (ECHO_SUB_AFFIXES.sub_energy_regen && ECHO_SUB_AFFIXES.sub_energy_regen.rolls) || [];
    else if (/伤害加成|增伤/.test(n)) rolls = (ECHO_SUB_AFFIXES.sub_type_dmg && ECHO_SUB_AFFIXES.sub_type_dmg.rolls) || [];
    // 主词条常见值
    if (n === '暴击率') rolls = rolls.concat([22, 44]);
    if (n === '暴击伤害') rolls = rolls.concat([44]);
    return rolls;
  }

  function nearestRollDiff(value, rolls) {
    if (!rolls || !rolls.length) return Infinity;
    var best = Math.abs(Number(value) - rolls[0]);
    for (var i = 1; i < rolls.length; i++) {
      var d = Math.abs(Number(value) - rolls[i]);
      if (d < best) best = d;
    }
    return best;
  }

  /** 类型增伤行误吃到下一行暴伤 16.2 时剔除 */
  function looksLikeForeignRoll(name, value) {
    if (!/伤害加成|增伤/.test(name || '')) return false;
    var typeRolls = knownRollsForStat(name, '%');
    var critRolls = (typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES.sub_crit_dmg
      ? ECHO_SUB_AFFIXES.sub_crit_dmg.rolls
      : [21, 19.8, 18.6, 17.4, 16.2, 15, 13.8, 12.6]) || [];
    var dt = nearestRollDiff(value, typeRolls);
    var dc = nearestRollDiff(value, critRolls);
    return dc <= 0.25 && dt > 1.0;
  }

  /** 只取词条名之后、下一个词条名之前的数字，避免两行粘连 */
  function textAfterStatName(compact, name) {
    var keys = [name];
    if (/加成$/.test(name)) keys.push(name.replace(/加成$/, ''));
    if (name === '暴击率') keys.push('暴击');
    var idx = -1;
    var used = name;
    for (var k = 0; k < keys.length; k++) {
      var p = compact.indexOf(keys[k]);
      if (p >= 0 && (idx < 0 || p < idx)) {
        idx = p;
        used = keys[k];
      }
    }
    if (idx < 0) return compact;
    var tail = compact.slice(idx + used.length);
    var cut = tail.length;
    for (var i = 0; i < STAT_NAMES.length; i++) {
      var n = STAT_NAMES[i];
      if (n === used || n === name) continue;
      if (used === '暴击' && (n === '暴击率' || n === '暴击伤害')) continue;
      var at = tail.indexOf(n);
      if (at >= 0 && at < cut) cut = at;
    }
    return tail.slice(0, cut);
  }

  function pickBestNumber(candidates, name, forceUnit) {
    var all = (candidates || []).filter(function (c) {
      return c && Number.isFinite(c.value) && c.value > 0 && !looksLikeForeignRoll(name, c.value);
    });
    // 不回退到「暴伤档数值」——宁可漏读，也不要把 16.2 吸成类型增伤 11.6
    if (!all.length) return null;
    if (all.length === 1) return all[0];

    // 固定值行（生命 2280 / 攻击 150·100·60·50·40·30 / 防御 …）：
    // 整行里出现固定值时优先选它，防「9 生命 生命 2280」把杂散 9 当数值
    if (!forceUnit) {
      var fixedMap = { '攻击': [150, 100, 60, 50, 40, 30], '生命': [2280], '防御': [135, 90, 45, 30] };
      var fixedHits = all.filter(function (c) {
        return (fixedMap[name] || []).indexOf(c.value) >= 0;
      });
      if (fixedHits.length) {
        return fixedHits
          .slice()
          .sort(function (a, b) {
            return (a.unit === '%' ? 1 : 0) - (b.unit === '%' ? 1 : 0);
            })[0];
      }
      // 固定副词条都是整数（攻击 30~150 / 生命 320~2280 / 防御 30~70）：
      // 同一行同时出现 ≥30 整数与 6~15 小数（如「生命 9 430」）时，整数才是真实值
      if (name === '攻击' || name === '生命' || name === '防御') {
        var maxFlat = name === '生命' ? 2280 : name === '攻击' ? 150 : 135;
        var minFlat = name === '生命' ? 320 : 30;
        var bigInts = all.filter(function (c) {
          return c.unit !== '%' && c.value >= minFlat && c.value <= maxFlat;
        });
        var smallNums = all.filter(function (c) {
          return c.unit !== '%' && c.value < 30;
        });
        if (bigInts.length && smallNums.length) all = bigInts;
      }
    }

    // 1) 贴官方档位：先在整个候选集上筛（防粘数字 8179% 吃掉 8.7%、
    //    也防带 % 的脏大数 112.496112.4% 吃掉干净的裸值 12.4）
    var list = all.slice();
    var unit = forceUnit || all[0].unit || '';
    var rolls = knownRollsForStat(name, unit || '%');
    if (rolls.length) {
      var nearAll = all.filter(function (c) {
        return nearestRollDiff(c.value, rolls) <= 0.55;
      });
      if (nearAll.length) list = nearAll;
      else {
        var looseAll = all.filter(function (c) {
          return nearestRollDiff(c.value, rolls) <= 2.0;
        });
        if (looseAll.length) list = looseAll;
      }
    }

    // 2) 档位相近者中优先带 % 的（评分几乎不带 %）
    var pcts = list.filter(function (c) {
      return c.unit === '%';
    });
    if (pcts.length && pcts.length < list.length) list = pcts;

    // 3) 丢弃典型「右侧评分」：两位小数且同行还有别的数
    if (list.length >= 2) {
      var nonScore = list.filter(function (c) {
        return !c.scoreLike;
      });
      if (nonScore.length) list = nonScore;
    }

    // 4) 档位相近者中再优先「词条名后第一个数」（afterName）
    var after = list.filter(function (c) {
      return c.afterName;
    });
    if (after.length) list = after;

    // 5) 最终：精确命中优先；否则 diff 小优先；同距取先出现
    var best = null;
    var bestKey = null;
    list.forEach(function (c) {
      var nearestDiff = rolls.length ? nearestRollDiff(c.value, rolls) : 0;
      var key = [nearestDiff < 0.05 ? 0 : 1, nearestDiff, c.afterName ? 0 : 1, c.value];
      if (
        !best ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] === bestKey[2] && key[3] < bestKey[3])
      ) {
        best = c;
        bestKey = key;
      }
    });
    if (best) return best;
    return list[0];
  }

  function collectNumberCandidates(spaced, compact) {
    var out = [];
    var seen = {};
    var m;
    var pctRe = /(\d+(?:\.\d+)?)%/g;
    while ((m = pctRe.exec(compact))) {
      var pv = Number(m[1]);
      var pk = '%' + pv;
      if (!seen[pk]) {
        seen[pk] = true;
        out.push({ value: pv, unit: '%', scoreLike: false });
      }
    }
    // 去掉已识别的 xx% 再扫裸数字，避免把 21.0% 拆成 21.0
    var bareSrc = compact.replace(/(\d+(?:\.\d+)?)%/g, ' ');
    var bareRe = /(\d+(?:\.\d+)?)/g;
    var tokens = [];
    while ((m = bareRe.exec(bareSrc))) tokens.push(m[1]);
    // 也按空格分词扫一遍（保留原始小数位形态判断评分）
    String(spaced || '')
      .split(/\s+/)
      .forEach(function (tok) {
        var tm = String(tok).match(/^(\d+(?:\.\d+)?)%?$/);
        if (tm) tokens.push(tm[1]);
      });
    tokens.forEach(function (tok) {
      var v = Number(tok);
      if (!Number.isFinite(v) || v <= 0) return;
      var scoreLike = /^\d+\.\d{2}$/.test(tok) && v < 30;
      var k = (scoreLike ? 's' : 'n') + v;
      if (seen[k] || seen['%' + v]) return;
      seen[k] = true;
      out.push({ value: v, unit: '', scoreLike: scoreLike });
    });
    return out;
  }

  function parseLine(joined) {
    var spaced = scrubScoreNoise(joined)
      .replace(/[＋]/g, '+')
      .replace(/\s+/g, ' ')
      .trim();
    spaced = spaced.replace(/(\d)[oO](%)/g, '$10$2');
    spaced = spaced.replace(/(\d)[oO](\d)/g, '$10$2');
    // OCR 把小数点读成冒号/中文冒号（9:4% → 9.4%）
    spaced = spaced.replace(/(\d)\s*[:：]\s*(\d)/g, '$1.$2');
    // 评分卡：属性值后紧跟右侧评分（如 21.0% 12.49 / 150 2.23）
    spaced = spaced.replace(/(\d+(?:\.\d+)?%?)\s+(\d+\.\d{2})\s*$/g, '$1');
    var compact = spaced.replace(/\s+/g, '');
    compact = compact.replace(/^\++/, '');
    spaced = spaced.replace(/^\++\s*/, '');
    // 紧贴：21.0%12.49 → 21.0%；勿把裸 12.49 拆成 1
    compact = compact.replace(/(\d+(?:\.\d+)?%)(\d+\.\d{2})$/g, '$1');
    // 固定值紧贴评分：1502.23 / 402.37
    compact = compact.replace(/(150|100|2280|60|50|40|30)(\d+\.\d{2})$/g, '$1');
    // 双通道合并时数值重复（100 100 → 100100 / 2280 2280 → 22802280 / 390 390 → 390390）
    compact = compact.replace(/(30|40|50|60|100|150|320|360|390|430|470|510|540|580|2280)\1(?!\d)/g, '$1');

    var name = matchStatName(compact);
    var fuzzy = false;
    // 有色字 OCR 常把「共鸣」读残，但「解放…%」仍在 —— 优先于模糊匹配
    if (!name && /解放/.test(compact) && /\d/.test(compact)) {
      name = '共鸣解放伤害加成';
      fuzzy = true;
    }
    if (!name && /技能/.test(compact) && /伤/.test(compact) && /\d/.test(compact)) {
      name = '共鸣技能伤害加成';
      fuzzy = true;
    }
    if (!name) {
      var cjk = compact.replace(/[^\u4e00-\u9fa5]/g, '');
      var fz = fuzzyStatName(cjk);
      if (fz) {
        name = fz;
        fuzzy = true;
      }
    }
    if (!name || !/\d/.test(compact)) return null;
    name = normalizeStatName(name);

    // 只在「本词条名 → 下一词条名」之间取数，防止与下一行 16.2% 粘连后吸附成 11.6
    var valueSpan = textAfterStatName(compact, name);
    var candidates = collectNumberCandidates(spaced, valueSpan);
    if (!candidates.length) candidates = collectNumberCandidates(spaced, compact);
    // 标记：词条名后的首个 % / 数字优先
    var firstPct = valueSpan.match(/(\d+(?:\.\d+)?)%/);
    var firstNum = valueSpan.match(/(\d+(?:\.\d+)?)/);
    candidates.forEach(function (c) {
      if (firstPct && c.unit === '%' && Number(firstPct[1]) === c.value) c.afterName = true;
      else if (!firstPct && firstNum && !c.unit && Number(firstNum[1]) === c.value) c.afterName = true;
    });
    var picked = pickBestNumber(candidates, name, '');
    if (!picked) return null;

    // 百分比词条：若没读到 % 但数值像百分档，补上 unit
    var unit = picked.unit;
    if (!unit && /暴击|伤害|增伤|效率|生命|防御|攻击/.test(name) && picked.value < 80 && /\./.test(String(picked.value))) {
      // 攻击/生命/防御 的固定值也是整数；带小数更可能是 %
      if (!(name === '攻击' || name === '生命' || name === '防御') || picked.value < 30) {
        unit = '%';
      }
    }
    // 攻击 150 保持 flat；攻击 7.9 为 %
    if ((name === '攻击' || name === '生命' || name === '防御') && !unit) {
      if (picked.value <= 60 && (name !== '攻击' || picked.value < 90)) {
        // 固定攻档 30/40/50/60；更大的 100/150 也是 flat
      }
      if (picked.value < 30 && String(picked.value).indexOf('.') >= 0) unit = '%';
    }

    var value = picked.value;
    if (!Number.isFinite(value) || value <= 0) return null;

    // 必须原文带小数点（8.6 / 6.0）；光秃 6% 多为 8.6 读残
    var hadDecimal = false;
    if (firstPct && String(firstPct[1]).indexOf('.') >= 0) hadDecimal = true;
    else if (firstNum && String(firstNum[1]).indexOf('.') >= 0) hadDecimal = true;
    else if (valueSpan && /\d+\.\d+/.test(valueSpan)) hadDecimal = true;
    // 只拦低位读残（如 8.6→6）；主词条 22%/44% 常被读成不带小数的整数，放行
    if (unit === '%' && /伤害加成|增伤|暴击|效率|攻击|生命|防御/.test(name) && !hadDecimal && value < 15) {
      return null;
    }

    var out = { name: name, value: value, unit: unit, fuzzy: fuzzy, hadDecimal: hadDecimal };
    if (/增伤|伤害加成/.test(name)) {
      var elFound = '';
      for (var el in ELEMENT_MAP) {
        if (compact.indexOf(el) >= 0) {
          elFound = ELEMENT_MAP[el];
          break;
        }
      }
      // OCR 常掉属性字（如「湮灭伤害加成」→「灭伤害加成」）：模糊匹配已锁定具体词条名，属性字从词条名补回
      if (!elFound) {
        for (var el2 in ELEMENT_MAP) {
          if (name.indexOf(el2) === 0) {
            elFound = ELEMENT_MAP[el2];
            break;
          }
        }
      }
      if (elFound) out.element = elFound;
      for (var t in TYPE_DMG_MAP) {
        if (compact.indexOf(t) >= 0) {
          out.damageType = TYPE_DMG_MAP[t];
          break;
        }
      }
    }
    return out;
  }

  /** 评分卡：丢掉行右侧评分列文字（右 28% 区域的纯数字） */
  function lineTextDropScoreColumn(line) {
    var words = (line.words || [])
      .slice()
      .sort(function (a, b) {
        return a.x - b.x;
      });
    if (words.length < 2) {
      return words
        .map(function (w) {
          return w.text;
        })
        .join(' ');
    }
    var x0 = words[0].x;
    var x1 = words[words.length - 1].x + words[words.length - 1].w;
    var span = Math.max(1, x1 - x0);
    var kept = words.filter(function (w, wi) {
      var rel = (w.x + w.w / 2 - x0) / span;
      if (rel < 0.72) return true;
      // 右侧只丢「纯数字评分」，保留带 % 的属性值（防裁太狠）
      var t = String(w.text || '').trim();
      if (/%/.test(t)) return true;
      if (/^[\d.]+$/.test(t) && /\.\d{2}$/.test(t)) return false;
      if (/^[\d.]+$/.test(t) && rel > 0.78) {
        // 词条名后的数字是词条数值（攻击 150 / 生命 2280 / 生命 430），不是右侧评分。
        // 用「本行前面出现过词条名」判断，避免双通道合并后「生命 9 430」里 430 被误当评分丢掉
        var hasStatBefore = false;
        for (var pi = 0; pi < wi; pi++) {
          if (matchStatName(String(words[pi].text || '').trim())) {
            hasStatBefore = true;
            break;
          }
        }
        if (hasStatBefore) return true;
        return false;
      }
      return true;
    });
    return kept
      .map(function (w) {
        return w.text;
      })
      .join(' ');
  }

  function ocrWords(worker, canvas) {
    return worker
      .recognize(canvas, {
        tessedit_pageseg_mode: '6',
      }, { text: true, tsv: true })
      .then(function (res) {
        var words = [];
        var tsv = String((res.data && res.data.tsv) || '').trim();
        if (tsv) {
          tsv.split('\n').slice(1).forEach(function (row) {
            var c = row.split('\t');
            if (Number(c[0]) !== 5) return;
            var text = String(c[11] || '').trim();
            if (!text) return;
            words.push({
              text: text,
              x: Number(c[6]),
              y: Number(c[7]),
              w: Number(c[8]),
              h: Number(c[9]),
              conf: Number(c[10]),
            });
          });
        }
        var fullText = String((res.data && res.data.text) || '');
        return { words: words, text: fullText };
      });
  }

  function clusterLines(words, yTol) {
    if (yTol == null) {
      var hs = (words || [])
        .map(function (w) {
          return w.h || 0;
        })
        .filter(function (h) {
          return h > 0;
        })
        .sort(function (a, b) {
          return a - b;
        });
      var med = hs.length ? hs[Math.floor(hs.length / 2)] : 22;
      // 偏紧，避免青绿「解放」行与下一行暴伤数值并到一行
      yTol = Math.max(10, Math.min(22, med * 0.55));
    }
    var lines = [];
    words
      .slice()
      .sort(function (a, b) {
        return a.y - b.y;
      })
      .forEach(function (w) {
        var fit = null;
        for (var i = 0; i < lines.length; i++) {
          if (Math.abs(lines[i].y - w.y) <= yTol) {
            fit = lines[i];
            break;
          }
        }
        if (fit) {
          fit.words.push(w);
          fit.y = Math.min(fit.y, w.y);
          fit.x0 = Math.min(fit.x0, w.x);
          fit.x1 = Math.max(fit.x1, w.x + w.w);
        } else {
          lines.push({ y: w.y, x0: w.x, x1: w.x + w.w, words: [w] });
        }
      });
    return lines.sort(function (a, b) {
      return a.y - b.y;
    });
  }

  function detectCardRegions(words, W, H, grid) {
    var lines = clusterLines(words);
    var statLines = lines.filter(function (l) {
      var joined = l.words
        .map(function (w) {
          return w.text;
        })
        .join('');
      return /\d/.test(joined) && (/[\u4e00-\u9fa5]/.test(joined) || /%/.test(joined) || /COST/i.test(joined));
    });
    if (!statLines.length) return [{ x0: 0, x1: W, y0: 0, y1: H }];

    // 用户手动配置的网格：按列×行把整图切成 N 格，每格当作一张卡（评分面板等无词条格会在后续过滤）
    if (grid && Number(grid.cols) > 0 && Number(grid.rows) > 0) {
      var gCols = Math.max(1, Math.min(6, Math.round(Number(grid.cols))));
      var gRows = Math.max(1, Math.min(10, Math.round(Number(grid.rows))));
      var cropX = Math.max(0, Math.round((W * (Number(grid.cropLeft) || 0)) / 100));
      var gW = Math.max(1, W - cropX);
      var regions = [];
      for (var r = 0; r < gRows; r++) {
        for (var c = 0; c < gCols; c++) {
          regions.push({
            x0: Math.max(0, Math.round(cropX + (gW * c) / gCols)),
            x1: Math.min(W, Math.round(cropX + (gW * (c + 1)) / gCols)),
            y0: Math.max(0, Math.round((H * r) / gRows)),
            y1: Math.min(H, Math.round((H * (r + 1)) / gRows)),
          });
        }
      }
      return regions;
    }

    // 单卡详情图：整图当一张（最常见）
    var xLo = Infinity;
    var xHi = 0;
    var yLo = Infinity;
    var yHi = 0;
    statLines.forEach(function (l) {
      xLo = Math.min(xLo, l.x0);
      xHi = Math.max(xHi, l.x1);
      yLo = Math.min(yLo, l.y);
      yHi = Math.max(yHi, l.y + 40);
    });
    // 向上扩，吃进 COST / 名称
    return [
      {
        x0: Math.max(0, Math.round(xLo - 40)),
        x1: Math.min(W, Math.round(xHi + 40)),
        y0: Math.max(0, Math.round(yLo - 160)),
        y1: Math.min(H, Math.round(yHi + 40)),
      },
    ];
  }

  function costFromText(blob) {
    var joined = Array.isArray(blob)
      ? blob
          .map(function (l) {
            return typeof l === 'string'
              ? l
              : (l.words || [])
                  .map(function (w) {
                    return w.text;
                  })
                  .join('');
          })
          .join(' ')
      : String(blob || '');
    var m = joined.match(/COST\s*[：:]?\s*([134])/i);
    if (m) return Number(m[1]);
    m = joined.match(/\bCost\s*[：:]?\s*([134])/i);
    if (m) return Number(m[1]);
    m = joined.match(/成本\s*[：:]?\s*([134])/);
    if (m) return Number(m[1]);
    return 0;
  }

  function inferCostFromMain1(main1) {
    if (!main1 || !main1.name) return 0;
    var n = main1.name;
    var v = Number(main1.value);
    if (n === '暴击率' || n === '暴击伤害' || n === '治疗效果加成') return 4;
    if (n === '暴击率' && v >= 18) return 4;
    if (n === '暴击伤害' && v >= 36) return 4;
    if (n === '共鸣效率') return 3;
    // 仅主词条量级的属性/类型增伤才推 3C；副词条 8.6 不能把成本打成 3
    if (/增伤|伤害加成/.test(n) && (main1.element || main1.damageType) && v >= 24) return 3;
    // 攻击/生命/防御% 按数值推 cost（与 ECHO_MAIN1_OPTIONS 一致）：
    // 1C：攻击18 / 生命22.8 / 防御18；3C：攻击30 / 生命30 / 防御38；4C：攻击33 / 生命33 / 防御41.8
    if ((n === '攻击' || n === '生命' || n === '防御') && main1.unit === '%') {
      if (v <= 18.9) return 1;
      if (v >= 22.3 && v <= 23.3) return 1;
      if (v >= 29 && v <= 31) return 3;
      if (v >= 37 && v <= 39) return 3;
      if (v >= 32 && v <= 34) return 4;
      if (v >= 41 && v <= 42.5) return 4;
      if (v >= 31) return 4;
      if (v >= 20) return 3;
      return 1;
    }
    return 0;
  }

  function recognizeRegionFromWords(words, region) {
    var inside = (words || []).filter(function (w) {
      var cx = w.x + w.w / 2;
      var cy = w.y + w.h / 2;
      return cx >= region.x0 && cx <= region.x1 && cy >= region.y0 && cy <= region.y1;
    });
    var lines = clusterLines(inside);
    var rawLines = lines.map(function (l) {
      return lineTextDropScoreColumn(l);
    });
    return parseCardFromLines(rawLines, costFromText(lines));
  }

  function recognizeRegion(worker, canvas, region, scale) {
    var s = Number(scale) > 0 ? Number(scale) : 1;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((region.x1 - region.x0) * s));
    c.height = Math.max(1, Math.round((region.y1 - region.y0) * s));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      canvas,
      region.x0,
      region.y0,
      region.x1 - region.x0,
      region.y1 - region.y0,
      0,
      0,
      c.width,
      c.height
    );
    return worker.recognize(c, { tessedit_pageseg_mode: '6' }, { text: true }).then(function (res) {
      var rawLines = String((res.data && res.data.text) || '')
        .split('\n')
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean);
      return parseCardFromLines(rawLines, costFromText(rawLines));
    });
  }

  /** 主词条候选分：避免把副词条「解放 8.6」误当主词条 */
  function main1Score(stat) {
    if (!stat || !stat.name) return -1;
    var n = stat.name;
    var v = Number(stat.value) || 0;
    var u = stat.unit || '';
    // 主词条量级上限：OCR 粘数字（75 / 8179）不可能当主词条
    if (n === '暴击伤害' && u === '%' && v >= 36 && v <= 55) return 100 + v;
    if (n === '暴击率' && u === '%' && v >= 18 && v <= 30) return 95 + v;
    if (n === '治疗效果加成' && u === '%' && v >= 20 && v <= 40) return 90 + v;
    if ((n === '攻击' || n === '生命' || n === '防御') && u === '%' && v >= 18 && v <= 45) return 80 + v;
    if (stat.element && /增伤|伤害加成/.test(n) && v >= 24 && v <= 45) return 85 + v;
    // 副词条量级：类型增伤 / 小百分比 / 固定攻 —— 绝不当主
    if (/解放|普攻|技能|重击/.test(n) && v < 20) return -1;
    if ((n === '攻击' || n === '生命' || n === '防御') && !u && v <= 60) return -1;
    if ((n === '攻击' || n === '生命' || n === '防御') && !u && v >= 90) return -1; // 主2
    if (u === '%' && v < 15) return -1;
    return 1;
  }

  /** 主词条行被切成两行（词名行 + 数值行）时，从原文案恢复主词条 */
  function findSplitLineMain(rawLines) {
    var i, j, t, m;
    for (i = 0; i < rawLines.length; i++) {
      t = String(rawLines[i] || '').trim();
      if (/评分|评级|调谐|概率|模板|SSS|\bLv\b/i.test(t)) continue;
      if (/\d/.test(t)) continue; // 该行已有数字，走正常解析
      var compact = t.replace(/\s+/g, '');
      m = matchStatName(compact);
      if (!m) continue;
      // 向后最多 2 行找主词条量级的数值
      for (j = i + 1; j < Math.min(rawLines.length, i + 3); j++) {
        var vLine = String(rawLines[j] || '').trim();
        var vm = vLine.match(/(\d+(?:\.\d+)?)\s*%/);
        if (!vm) continue;
        var cand = { name: m, value: Number(vm[1]), unit: '%' };
        if (main1Score(cand) >= 50) return cand;
        break;
      }
    }
    return null;
  }

  function isMain2Stat(stat) {
    if (!stat) return false;
    return (
      (stat.name === '攻击' && !stat.unit && stat.value >= 90 && stat.value <= 160) ||
      (stat.name === '生命' && !stat.unit && stat.value >= 2000)
    );
  }

  function parseCardFromLines(rawLines, costHint) {
    var stats = [];
    var label = '';
    rawLines.forEach(function (t) {
      if (/评分|评级|调谐|概率|模板|SSS|\bLv\b/i.test(t)) return;
      var st = parseLine(t);
      if (st) {
        stats.push(st);
        return;
      }
      var cjk = String(t).replace(/[^\u4e00-\u9fa5]/g, '');
      if (cjk.length >= 2 && cjk.length <= 8 && !matchStatName(cjk) && !label) {
        if (!/成本|声骸|技能|描述|长击|虹击/.test(cjk)) label = cjk;
      }
    });

    var mainIdx = -1;
    var bestMain = -1;
    for (var i = 0; i < stats.length; i++) {
      var sc = main1Score(stats[i]);
      if (sc > bestMain) {
        bestMain = sc;
        mainIdx = i;
      }
    }
    // 主词条行被切行未解析出时，从原文案恢复（避免副词条被误当主词条）
    if (bestMain < 50) {
      var recoveredMain = findSplitLineMain(rawLines);
      if (recoveredMain) {
        stats.push(recoveredMain);
        mainIdx = stats.length - 1;
        bestMain = main1Score(recoveredMain);
      }
    }
    var main1 = mainIdx >= 0 && bestMain > 0 ? stats[mainIdx] : null;

    var rest = [];
    stats.forEach(function (s, idx) {
      if (idx === mainIdx && main1) return;
      rest.push(s);
    });

    var main2Idx = -1;
    for (var j = 0; j < rest.length; j++) {
      if (isMain2Stat(rest[j])) {
        main2Idx = j;
        break;
      }
    }
    var subs = rest.filter(function (_s, idx) {
      return idx !== main2Idx;
    }).slice(0, 5);

    var cost = costHint || 0;
    if (!cost && main1) cost = inferCostFromMain1(main1);
    // 主词条暴伤/暴击可强推 4C
    if ((!cost || cost === 3) && main1) {
      if (main1.name === '暴击伤害' && main1.value >= 36) cost = 4;
      if (main1.name === '暴击率' && main1.value >= 18) cost = 4;
    }

    if (label && (label.length < 2 || /虹击|长击|击虹/.test(label))) label = '';

    return {
      cost: cost,
      main1: main1,
      subs: subs,
      raw: rawLines,
      label: label,
    };
  }

  function statKey(s) {
    return ((s && s.name) || '') + '|' + (s && s.value !== undefined ? s.value : '') + '|' + ((s && s.unit) || '');
  }

  function preferMain1(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return main1Score(a) >= main1Score(b) ? a : b;
  }

  function mergeCardResults(regionCard, wordCard) {
    // 把两边的主+副摊平再重新选主词条，避免「解放」占主位
    var pool = [];
    function pushStat(s) {
      if (!s || !s.name) return;
      pool.push(s);
    }
    pushStat(regionCard && regionCard.main1);
    pushStat(wordCard && wordCard.main1);
    (regionCard && regionCard.subs ? regionCard.subs : []).forEach(pushStat);
    (wordCard && wordCard.subs ? wordCard.subs : []).forEach(pushStat);

    var rebuilt = parseCardFromLines(
      pool.map(function (s) {
        return s.name + (s.unit === '%' ? s.value + '%' : String(s.value));
      }),
      (regionCard && regionCard.cost) || (wordCard && wordCard.cost) || 0
    );

    // 若重建失败，退回旧逻辑主词条优选
    var main1 = rebuilt.main1 || preferMain1(regionCard && regionCard.main1, wordCard && wordCard.main1);
    var cost = rebuilt.cost || (regionCard && regionCard.cost) || (wordCard && wordCard.cost) || 0;
    if (!cost && main1) cost = inferCostFromMain1(main1);

    var merged = rebuilt.subs && rebuilt.subs.length ? rebuilt.subs.slice() : [];
    if (!merged.length) {
      var regionSubs = (regionCard && regionCard.subs) || [];
      var wordSubs = (wordCard && wordCard.subs) || [];
      var used = [];
      wordSubs.forEach(function (ws) {
        var idx = -1;
        for (var i = 0; i < regionSubs.length; i++) {
          if (used.indexOf(i) >= 0) continue;
          var rs = regionSubs[i];
          if (rs.name === ws.name && (rs.unit || '') === (ws.unit || '')) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          used.push(idx);
          var rs2 = regionSubs[idx];
          var rolls = knownRollsForStat(ws.name, ws.unit || '%');
          if (rolls.length && nearestRollDiff(rs2.value, rolls) + 0.05 < nearestRollDiff(ws.value, rolls)) {
            merged.push(rs2);
          } else merged.push(ws);
        } else merged.push(ws);
      });
      regionSubs.forEach(function (rs, i) {
        if (used.indexOf(i) < 0) merged.push(rs);
      });
    }

    var seenName = {};
    merged = merged.filter(function (s) {
      if (!s || !s.name || !Number.isFinite(Number(s.value)) || Number(s.value) <= 0) return false;
      if (looksLikeForeignRoll(s.name, s.value)) return false;
      // 同名同单位：允许不同数值？声骸通常每种副词条最多 1 条
      var nk = subDedupeKey(s);
      if (seenName[nk]) return false;
      seenName[nk] = true;
      return true;
    });

    var rawA = (wordCard && wordCard.raw) || [];
    var rawB = (regionCard && regionCard.raw) || [];
    return {
      cost: cost,
      main1: main1,
      subs: merged.slice(0, 5),
      raw: (rawA.length >= rawB.length ? rawA : rawB).slice(0, 24),
      label: (regionCard && regionCard.label) || (wordCard && wordCard.label) || '',
    };
  }

  function snapToRolls(affixId, value) {
    if (typeof ECHO_SUB_AFFIXES === 'undefined') return value;
    var def = ECHO_SUB_AFFIXES[affixId];
    if (!def || !Array.isArray(def.rolls)) return value;
    var rolls = def.rolls.slice();
    var best = rolls[0];
    var bestDiff = Math.abs(Number(value) - best);
    rolls.forEach(function (r) {
      var d = Math.abs(Number(value) - r);
      if (d < bestDiff) {
        bestDiff = d;
        best = r;
      }
    });
    // 禁止 16.2 → 11.6 这类跨档硬吸
    if (bestDiff > 0.55) return Number(value);
    return best;
  }

  function snapMain1Value(id, cost, value) {
    if (typeof ECHO_MAIN1_OPTIONS === 'undefined') return value;
    var opts = ECHO_MAIN1_OPTIONS[cost] || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].id === id) return opts[i].value;
    }
    return value;
  }

  function mapMain1(stat, cost) {
    if (!stat) return null;
    var id = '';
    if (stat.name === '暴击率') id = 'main_crit_rate';
    else if (stat.name === '暴击伤害') id = 'main_crit_dmg';
    else if (stat.name === '治疗效果加成') id = 'main_healing_bonus';
    else if (stat.name === '共鸣效率') id = 'main_energy_regen';
    else if (stat.name === '攻击' && stat.unit === '%') id = 'main_atk_percent';
    else if (stat.name === '生命' && stat.unit === '%') id = 'main_hp_percent';
    else if (stat.name === '防御' && stat.unit === '%') id = 'main_def_percent';
    else if (stat.element && /增伤|伤害加成/.test(stat.name)) id = 'main_element_dmg';
    if (!id) return null;
    var c = cost || inferCostFromMain1(stat) || 4;
    return {
      id: id,
      value: snapMain1Value(id, c, stat.value),
      element: id === 'main_element_dmg' ? stat.element || '' : '',
      fuzzy: !!stat.fuzzy,
    };
  }

  function mapSub(stat) {
    if (!stat) return null;
    var id = '';
    var damageType = '';
    if (stat.name === '暴击率') id = 'sub_crit_rate';
    else if (stat.name === '暴击伤害') id = 'sub_crit_dmg';
    else if (stat.name === '攻击' && stat.unit === '%') id = 'sub_atk_percent';
    else if (stat.name === '攻击' && !stat.unit) {
      // AI 常把「攻击 9.4%」漏掉 %：数值 < 20 不可能是固定攻击，按百分比处理
      if (Number(stat.value) < 20) {
        id = 'sub_atk_percent';
        stat.unit = '%';
      } else {
        id = 'sub_flat_atk';
      }
    }
    else if (stat.name === '生命' && stat.unit === '%') id = 'sub_hp_percent';
    else if (stat.name === '生命' && !stat.unit) {
      if (Number(stat.value) < 200) {
        id = 'sub_hp_percent';
        stat.unit = '%';
      } else {
        id = 'sub_flat_hp';
      }
    }
    else if (stat.name === '防御' && stat.unit === '%') id = 'sub_def_percent';
    else if (stat.name === '防御' && !stat.unit) {
      if (Number(stat.value) < 20) {
        id = 'sub_def_percent';
        stat.unit = '%';
      } else {
        id = 'sub_flat_def';
      }
    }
    else if (stat.name === '共鸣效率') id = 'sub_energy_regen';
    else if (/伤害加成|增伤|伤害$/.test(stat.name)) {
      for (var t in TYPE_DMG_MAP) {
        if (stat.name.indexOf(t) >= 0 || (stat.damageType && stat.damageType === t)) {
          id = 'sub_type_dmg';
          damageType = TYPE_DMG_MAP[t];
          break;
        }
      }
      // 属性增伤一般不作副词条；忽略
      if (!id) return null;
      if (looksLikeForeignRoll(stat.name, stat.value)) return null;
      // 拒绝读残整数（如 8.6 → 6）
      if (
        (!stat.hadDecimal && Number.isInteger(Number(stat.value)) && Number(stat.value) < 30) ||
        (stat.hadDecimal === false && Number(stat.value) < 30 && Math.abs(Number(stat.value) - Math.round(stat.value)) < 1e-9)
      ) {
        return null;
      }
    }
    if (!id) return null;

    // 值域消歧 + 档位对齐：
    // OCR 常把「共鸣效率」读残成「攻击」等；百分比副词条档位几乎互不重叠，
    // 数值只可能是某词条档位时直接改判，读偏的数值也按最接近档位对齐。
    if (id.indexOf('sub_') === 0 && typeof ECHO_SUB_AFFIXES !== 'undefined') {
      var pv = Number(stat.value);
      if (Number.isFinite(pv) && pv >= 4 && pv <= 23) {
        var reclassed = false;
        var curId = id;
        var curDef = ECHO_SUB_AFFIXES[curId];
        var curDiff = curDef ? nearestRollDiff(pv, curDef.rolls) : Infinity;
        // 1) 共鸣效率档位与其他百分比词条几乎不重叠：数值只可能是效率档时改判
        var erDef = ECHO_SUB_AFFIXES.sub_energy_regen;
        if (erDef && curId !== 'sub_energy_regen') {
          var dEr = nearestRollDiff(pv, erDef.rolls);
          if (dEr <= 0.1 && curDiff > 0.1) {
            id = 'sub_energy_regen';
            reclassed = true;
          }
        }
        // 2) 当前词条档位差太远、另一词条档位几乎贴合时改判（如 攻击 13.5 → 暴击伤害 13.8）
        if (!reclassed && curDiff > 0.55) {
          var candIds = ['sub_crit_rate', 'sub_crit_dmg', 'sub_atk_percent', 'sub_hp_percent', 'sub_def_percent', 'sub_energy_regen'];
          var bestFit = null;
          for (var ci = 0; ci < candIds.length; ci++) {
            var cd = ECHO_SUB_AFFIXES[candIds[ci]];
            if (!cd || candIds[ci] === curId) continue;
            var dd = nearestRollDiff(pv, cd.rolls);
            if (dd <= 0.35 && (!bestFit || dd < bestFit.d)) bestFit = { id: candIds[ci], d: dd };
          }
          if (bestFit) {
            id = bestFit.id;
            reclassed = true;
          }
        }
      }
    }

    var snapped = snapToRolls(id, stat.value);
    var snappedMoved = Math.abs(Number(snapped) - Number(stat.value)) > 0.15;
    // 吸附失败且偏离档位过大时丢弃，避免脏值进复核
    var isFlat = id.indexOf('sub_flat_') === 0;
    if (
      id.indexOf('sub_') === 0 &&
      typeof ECHO_SUB_AFFIXES !== 'undefined' &&
      ECHO_SUB_AFFIXES[id] &&
      !isFlat &&
      nearestRollDiff(stat.value, ECHO_SUB_AFFIXES[id].rolls) > 0.55
    ) {
      return null;
    }
    // 固定值词条（攻击/生命/防御）：不在档位表但数值合理时保留为模糊项（如 攻击150/生命2280）
    var fuzzyFlat = false;
    if (
      isFlat &&
      typeof ECHO_SUB_AFFIXES !== 'undefined' &&
      ECHO_SUB_AFFIXES[id] &&
      nearestRollDiff(stat.value, ECHO_SUB_AFFIXES[id].rolls) > 0.55
    ) {
      var flatVal = Number(stat.value);
      var plausible =
        id === 'sub_flat_hp'
          ? flatVal >= 200 && flatVal <= 5000
          : flatVal >= 20 && flatVal <= 800;
      if (!plausible) return null;
      fuzzyFlat = true;
    }
    return {
      id: id,
      value: snapped,
      damageType: damageType,
      fuzzy: !!stat.fuzzy || fuzzyFlat || reclassed || snappedMoved,
    };
  }

  function recognizeOneCanvas(worker, canvas, grid) {
    return ocrWords(worker, canvas).then(function (pack) {
      var words = pack.words || [];
      var regions = detectCardRegions(words, canvas.width, canvas.height, grid);
      var fullLines = String(pack.text || '')
        .split('\n')
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean);
      var fullCard = parseCardFromLines(fullLines, costFromText(fullLines));
      var isGrid = !!(grid && Number(grid.cols) > 0 && Number(grid.rows) > 0);
      var cardTasks = regions.map(function (region) {
        if (isGrid) {
          // 网格模式：只按区域过滤整图识别的词（区域精确、不串格），不再对格子做二次裁剪 OCR
          return Promise.resolve(recognizeRegionFromWords(words, region));
        }
        return Promise.all([
          recognizeRegion(worker, canvas, region, 1),
          Promise.resolve(recognizeRegionFromWords(words, region)),
        ]).then(function (pair) {
          var merged = mergeCardResults(pair[0], pair[1]);
          if ((!merged.main1 || !(merged.subs || []).length) && fullCard.main1) {
            merged = mergeCardResults(fullCard, merged);
          }
          return merged;
        });
      });
      return Promise.all(cardTasks).then(function (cards) {
        if (!isGrid) {
          cards = cards.filter(function (c) {
            return c && (c.main1 || (c.subs && c.subs.length));
          });
          if (!cards.length && fullCard.main1) cards = [fullCard];
        }
        return { cards: cards, text: pack.text || '', rawLines: fullLines };
      });
    });
  }

  function typeDmgKey(stat) {
    if (!stat) return '';
    if (stat.damageType) return 'type:' + stat.damageType;
    if (/解放/.test(stat.name || '')) return 'type:共鸣解放';
    if (/技能/.test(stat.name || '')) return 'type:共鸣技能';
    if (/普攻/.test(stat.name || '')) return 'type:普攻';
    if (/重击/.test(stat.name || '')) return 'type:重击';
    return 'type:' + (stat.name || '');
  }

  function subDedupeKey(stat) {
    if (!stat) return '';
    if (/解放|普攻|技能|重击/.test(stat.name || '')) return typeDmgKey(stat);
    var unit = stat.unit || '';
    // 恒为百分比的词条：OCR 缺 % 时与带 % 视为同一条（避免暴伤 21 与 21% 重复）
    if (!unit && /暴击率|暴击伤害|共鸣效率|伤害加成|增伤/.test(String(stat.name || ''))) {
      unit = '%';
    }
    return String(stat.name || '') + '|' + unit + '|' + (stat.damageType || '');
  }

  /** 从原文案抢救全部缺失副词条（含金色暴击/暴伤） */
  function rescueAllSubsFromRaw(card, rawLines, fullText) {
    var lines = (rawLines || []).slice();
    if (fullText) {
      String(fullText)
        .split(/\n/)
        .forEach(function (l) {
          var t = String(l || '').trim();
          if (t && lines.indexOf(t) < 0) lines.push(t);
        });
    }
    var extras = [];
    lines.forEach(function (line) {
      var st = parseLine(line);
      if (!st) return;
      if (main1Score(st) >= 80) return; // 主词条量级
      if (isMain2Stat(st)) return;
      if (looksLikeForeignRoll(st.name, st.value)) return;
      // 必须能映射成副词条
      var mapped = mapSub(st);
      if (!mapped) return;
      // 只有文字近似（OCR 缺字/错字）或数值非官方档位才算近似；精确档位不标警告
      var exRolls = knownRollsForStat(st.name, st.unit || '%');
      if (st.fuzzy) {
        st.fuzzy = true;
      } else if (exRolls.length && nearestRollDiff(Number(st.value), exRolls) > 0.15) {
        st.fuzzy = true;
      } else {
        st.fuzzy = false;
      }
      extras.push(st);
    });

    // 关键词兜底：OCR 切行后「暴击伤害」「暴击」与数字分离
    [
      {
        re: /暴击伤害/,
        name: '暴击伤害',
        unit: '%',
        pick: function (v) {
          return v >= 12 && v <= 22;
        },
      },
      {
        re: /暴击(?!伤害)/,
        name: '暴击率',
        unit: '%',
        pick: function (v) {
          return v >= 6 && v <= 11;
        },
      },
      {
        re: /攻击/,
        name: '攻击',
        unit: '%',
        pick: function (v) {
          return v >= 6 && v <= 12;
        },
      },
      {
        re: /解放/,
        name: '共鸣解放伤害加成',
        unit: '%',
        damageType: '共鸣解放',
        pick: function (v) {
          return v >= 6 && v <= 12;
        },
      },
      {
        re: /普攻/,
        name: '普攻伤害加成',
        unit: '%',
        damageType: '普攻',
        pick: function (v) {
          return v >= 6 && v <= 12;
        },
      },
    ].forEach(function (rule) {
      lines.forEach(function (line) {
        if (!rule.re.test(line)) return;
        var reNum = /(\d+\.\d+)\s*%?/g;
        var m;
        while ((m = reNum.exec(line))) {
          var v = Number(m[1]);
          if (!rule.pick(v)) continue;
          extras.push({
            name: rule.name,
            value: v,
            unit: rule.unit,
            fuzzy: true,
            hadDecimal: true,
            damageType: rule.damageType || '',
          });
        }
      });
    });

    // 固定攻击整数行
    lines.forEach(function (line) {
      if (!/攻击/.test(line) || /%/.test(line)) return;
      var m = String(line).match(/(?:^|[^\d])(30|40|50|60)(?:[^\d]|$)/);
      if (!m) return;
      extras.push({ name: '攻击', value: Number(m[1]), unit: '', fuzzy: true, hadDecimal: false });
    });

    if (!extras.length) return card;
    var subs = (card.subs || []).slice();
    var have = {};
    subs.forEach(function (s) {
      have[subDedupeKey(s)] = true;
    });
    extras.forEach(function (ex) {
      var key = subDedupeKey(ex);
      if (!key) return;
      var idx = -1;
      for (var i = 0; i < subs.length; i++) {
        if (subDedupeKey(subs[i]) === key) {
          idx = i;
          break;
        }
      }
      var rolls = knownRollsForStat(ex.name, ex.unit || '%');
      if (idx >= 0) {
        if (rolls.length && nearestRollDiff(ex.value, rolls) + 0.05 < nearestRollDiff(subs[idx].value, rolls)) {
          subs[idx] = ex;
        }
        return;
      }
      if (subs.length < 5 && !have[key]) {
        subs.push(ex);
        have[key] = true;
      }
    });
    card.subs = subs.slice(0, 5);
    return card;
  }

  function rescueTypeSubsFromRaw(card, rawLines, fullText) {
    return rescueAllSubsFromRaw(card, rawLines, fullText);
  }

  /**
   * 金色词条常只认出数字、认不出「暴击伤害」四字；小程序 OCR 也常丢掉 %。
   * 主词条已是暴伤时，把文案里未占用的 12.6~21 暴伤档补成副词条。
   */
  function rescueOrphanPercentRolls(card, fullText) {
    if (!card) return card;
    var text = String(fullText || '')
      .replace(/(\d+)\s*[，,]\s*(\d)/g, '$1.$2')
      .replace(/(\d+)\s*\.\s*(\d)/g, '$1.$2');
    var used = {};
    if (card.main1 && Number.isFinite(Number(card.main1.value))) {
      used[String(Number(card.main1.value))] = true;
    }
    (card.subs || []).forEach(function (s) {
      if (s && Number.isFinite(Number(s.value))) used[String(Number(s.value))] = true;
    });
    var orphans = [];
    // 允许无 %：金色行常被读成裸「16.2」
    var re = /(\d+\.\d+)\s*%?/g;
    var m;
    while ((m = re.exec(text))) {
      var v = Number(m[1]);
      if (!Number.isFinite(v) || used[String(v)]) continue;
      // 排除明显评分两位小数噪声（如 12.49），除非刚好贴官方档
      var looksScore = !/%/.test(m[0]) && /\.\d{2}$/.test(String(m[1])) && v < 20 && v !== 16.2 && v !== 12.6 && v !== 13.8 && v !== 15;
      if (looksScore && nearestRollDiff(v, [21, 19.8, 18.6, 17.4, 16.2, 15, 13.8, 12.6, 11.6, 10.9, 10.1, 9.4, 9.3, 8.6, 8.1, 7.9]) > 0.06) {
        continue;
      }
      if (orphans.indexOf(v) < 0) orphans.push(v);
    }
    if (!orphans.length) return card;

    var subs = (card.subs || []).slice();
    function hasSub(name, unit) {
      return subs.some(function (s) {
        return s && s.name === name && (s.unit || '') === (unit || '');
      });
    }
    function takeRoll(name, unit, rolls, damageType) {
      if (subs.length >= 5 || hasSub(name, unit)) return;
      for (var i = 0; i < orphans.length; i++) {
        var v = orphans[i];
        if (nearestRollDiff(v, rolls) > 0.06) continue;
        // 主词条暴伤 44 不应被当成副词条
        if (name === '暴击伤害' && v >= 36) continue;
        if (name === '暴击率' && v >= 18) continue;
        // 副暴伤档位：必须落在 12.6~21，避免吃掉攻击%/解放的 8.6/9.4
        if (name === '暴击伤害' && (v < 12 || v > 22)) continue;
        subs.push({
          name: name,
          value: v,
          unit: unit,
          fuzzy: true,
          hadDecimal: true,
          damageType: damageType || '',
        });
        used[String(v)] = true;
        orphans.splice(i, 1);
        return;
      }
    }

    var critDmgRolls =
      typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES.sub_crit_dmg
        ? ECHO_SUB_AFFIXES.sub_crit_dmg.rolls
        : [21, 19.8, 18.6, 17.4, 16.2, 15, 13.8, 12.6];
    var critRateRolls =
      typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES.sub_crit_rate
        ? ECHO_SUB_AFFIXES.sub_crit_rate.rolls
        : [10.5, 9.9, 9.3, 8.7, 8.1, 7.5, 6.9, 6.3];
    var atkRolls =
      typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES.sub_atk_percent
        ? ECHO_SUB_AFFIXES.sub_atk_percent.rolls
        : [11.6, 10.9, 10.1, 9.4, 8.6, 7.9, 7.1, 6.4];
    var energyRolls =
      typeof ECHO_SUB_AFFIXES !== 'undefined' && ECHO_SUB_AFFIXES.sub_energy_regen
        ? ECHO_SUB_AFFIXES.sub_energy_regen.rolls
        : [12.4, 11.6, 10.8, 10, 9.2, 8.4, 7.6, 6.8];

    // 主词条=暴伤时优先补副暴伤（用户反复遇到的缺口）
    if (card.main1 && card.main1.name === '暴击伤害') {
      takeRoll('暴击伤害', '%', critDmgRolls);
    }
    if (!hasSub('暴击率', '%')) takeRoll('暴击率', '%', critRateRolls);
    // 孤儿数值优先匹配共鸣效率档（其档位与其他百分比几乎不重叠，防「效率 9.2%」被救成攻击 9.4%）
    if (!hasSub('共鸣效率', '%')) takeRoll('共鸣效率', '%', energyRolls);
    if (!hasSub('攻击', '%')) takeRoll('攻击', '%', atkRolls);
    if (card.main1 && card.main1.name === '暴击率' && !hasSub('暴击伤害', '%')) {
      takeRoll('暴击伤害', '%', critDmgRolls);
    }
    // 仍缺副暴伤：再扫一遍「16.2」类裸数字（即使前面被评分过滤漏掉，或词名/数值被切行）
    if (!hasSub('暴击伤害', '%')) {
      for (var ri = 0; ri < critDmgRolls.length; ri++) {
        var roll = critDmgRolls[ri];
        var rollRe = new RegExp('(?:^|[^\\d.])(' + String(roll).replace('.', '\\.') + ')(?:[^\\d%]|%|$)');
        if (!rollRe.test(text)) continue;
        if (used[String(roll)]) continue;
        if (subs.length >= 5) break;
        subs.push({
          name: '暴击伤害',
          value: roll,
          unit: '%',
          // 补回的值精确等于官方档位（原文案中独立出现的档位数字），不视为近似
          fuzzy: false,
          hadDecimal: true,
          damageType: '',
        });
        break;
      }
    }

    card.subs = subs.slice(0, 5);
    return card;
  }

  function finalizeCards(pack, template) {
    var cards = (pack.cards || []).map(function (card) {
      if (template === 'miniprogram') {
        // 抢救只使用本卡自己的原文案，避免多卡时把邻卡词条串进来
        var ownRaw = (card.raw && card.raw.length ? card.raw : (pack.rawLines || [])).slice();
        card = rescueTypeSubsFromRaw(card, ownRaw, ownRaw.join('\n'));
      }
      if (!card.raw || !card.raw.length) {
        card.raw = (pack.rawLines || []).slice(0, 24);
      }
      card.template = template;
      return card;
    });
    cards = cards.filter(function (c) {
      return c && (c.main1 || (c.subs && c.subs.length));
    });
    return {
      template: template,
      cards: cards.map(function (card) {
        var cost = Number(card.cost) || inferCostFromMain1(card.main1) || 0;
        return {
          cost: cost,
          main1: mapMain1(card.main1, cost),
          subs: (card.subs || []).map(mapSub).filter(Boolean),
          raw: card.raw,
          label: card.label || '',
          template: template,
        };
      }),
    };
  }

  function packToRawCard(pack) {
    var c = (pack.cards && pack.cards[0]) || { subs: [], raw: pack.rawLines || [] };
    return {
      cost: c.cost || 0,
      main1: c.main1 || null,
      subs: (c.subs || []).slice(),
      raw: (c.raw && c.raw.length ? c.raw : pack.rawLines || []).slice(0, 24),
      label: c.label || '',
    };
  }

  /**
   * 两类特化：
   *  1) miniprogram — 小程序：白金通道 + 彩字通道双跑合并（补齐漏行）
   *  2) ingame — 游戏内官方详情单通道
   */
  function recognizeFilesTesseract(files, opts) {
    var grid = opts && opts.grid;
    return getWorker().then(function (worker) {
      var list = Array.prototype.slice.call(files || []);
      var tasks = list.map(function (file) {
        return loadImage(file).then(function (img) {
          var guessed = detectEchoTemplate(img);

          if (guessed === 'ingame' && !grid) {
            var canvasIn = preprocess(img, 2.7, 'ingame');
            return recognizeOneCanvas(worker, canvasIn).then(function (pack) {
              var template = refineTemplateByText('ingame', pack.text || '');
              if (template === 'miniprogram') {
                // 误判：走小程序双通道
                guessed = 'miniprogram';
              } else {
                var out = finalizeCards(pack, 'ingame');
                out.name = file.name;
                return out;
              }
            }).then(function (maybe) {
              if (maybe) return maybe;
              // fallthrough：走下方小程序多通道（通过抛到统一路径不便，这里直接复用）
              guessed = 'miniprogram';
              return null;
            }).then(function (maybe) {
              if (maybe) return maybe;
              var cW = preprocess(img, 2.8, 'ingame');
              var cG = preprocess(img, 3.0, 'gold');
              var cGS = preprocess(img, 3.2, 'goldStrict');
              var cBr = preprocess(img, 3.0, 'brightStrict');
              var cC = preprocess(img, 3.0, 'miniprogram');
              return Promise.all([
                recognizeOneCanvas(worker, cW),
                recognizeOneCanvas(worker, cG),
                recognizeOneCanvas(worker, cGS),
                recognizeOneCanvas(worker, cBr),
                recognizeOneCanvas(worker, cC),
                recognizeColorBands(worker, img),
              ]).then(function (packs) {
                var mergedRaw = packToRawCard(packs[0]);
                for (var pi = 1; pi < packs.length; pi++) {
                  mergedRaw = mergeCardResults(mergedRaw, packToRawCard(packs[pi]));
                }
                var allLines = [];
                var allText = '';
                packs.forEach(function (p) {
                  (p.rawLines || []).forEach(function (l) {
                    if (l && allLines.indexOf(l) < 0) allLines.push(l);
                  });
                  if (p.text) allText += (allText ? '\n' : '') + p.text;
                });
                mergedRaw = mergeCardResults(mergedRaw, parseCardFromLines(allLines, mergedRaw.cost || 0));
                mergedRaw = rescueAllSubsFromRaw(mergedRaw, allLines, allText);
                mergedRaw = rescueOrphanPercentRolls(mergedRaw, allText);
                var out2 = finalizeCards(
                  { cards: [mergedRaw], rawLines: allLines, text: allText },
                  'miniprogram'
                );
                out2.name = file.name;
                out2.engine = 'tesseract';
                return out2;
              });
            });
          }

          // 小程序：多通道 + 色条裁切，专补副暴伤 16.2 一类漏行
          var cWhite2 = preprocess(img, 2.8, 'ingame');
          var cGold2 = preprocess(img, 3.0, 'gold');
          var cGoldStrict = preprocess(img, 3.2, 'goldStrict');
          var cBright = preprocess(img, 3.0, 'brightStrict');
          var cColor2 = preprocess(img, 3.0, 'miniprogram');
          var gridPromises = [
            recognizeOneCanvas(worker, cWhite2, grid),
            recognizeOneCanvas(worker, cGold2, grid),
            recognizeOneCanvas(worker, cGoldStrict, grid),
            recognizeOneCanvas(worker, cBright, grid),
            recognizeOneCanvas(worker, cColor2, grid),
          ];
          if (!grid) gridPromises.push(recognizeColorBands(worker, img));
          return Promise.all(gridPromises).then(function (packs) {
            if (grid && Number(grid.cols) > 0 && Number(grid.rows) > 0) {
              // 网格模式：按格子索引合并各通道结果，一格=一张卡
              var gCols = Math.max(1, Math.min(6, Math.round(Number(grid.cols))));
              var gRows = Math.max(1, Math.min(10, Math.round(Number(grid.rows))));
              var cellCount = gCols * gRows;
              var mergedCards = [];
              for (var ci = 0; ci < cellCount; ci++) {
                var acc = null;
                var cellRaws = [];
                packs.forEach(function (p) {
                  var pc = p && p.cards && p.cards[ci];
                  if (pc) {
                    (pc.raw || []).forEach(function (l) {
                      if (l && cellRaws.indexOf(l) < 0) cellRaws.push(l);
                    });
                  }
                  if (pc && (pc.main1 || (pc.subs || []).length)) {
                    acc = acc ? mergeCardResults(acc, pc) : pc;
                  }
                });
                if (!acc) continue;
                var accTxt = (acc.label || '') + ' ' + ((acc.raw || []).join(' ') || '');
                if (/评级|评分/.test(accTxt)) continue;
                // 评分面板/垃圾格：无主词条且干净副词条不足 2 条 → 丢弃（真实声骸必有主词条）
                if (!acc.main1) {
                  var cleanSubs = (acc.subs || []).filter(function (s) {
                    return s && !s.fuzzy && Number(s.value) > 0;
                  }).length;
                  if (cleanSubs < 2) continue;
                }
                // 用本格原文案补救漏掉的副词条 / 孤立百分比 / 数值修正
                var cellText2 = cellRaws.join('\n');
                acc = rescueAllSubsFromRaw(acc, cellRaws, cellText2);
                acc = rescueOrphanPercentRolls(acc, cellText2);
                mergedCards.push(acc);
              }
              var cellLines = [];
              var cellText = '';
              packs.forEach(function (p) {
                (p.rawLines || []).forEach(function (l) {
                  if (l && cellLines.indexOf(l) < 0) cellLines.push(l);
                });
                if (p.text) cellText += (cellText ? '\n' : '') + p.text;
              });
              var outGrid = finalizeCards(
                { cards: mergedCards, rawLines: cellLines, text: cellText },
                'miniprogram'
              );
              outGrid.name = file.name;
              outGrid.engine = 'tesseract';
              return outGrid;
            }
            var mergedRaw = packToRawCard(packs[0]);
            for (var pi = 1; pi < packs.length; pi++) {
              mergedRaw = mergeCardResults(mergedRaw, packToRawCard(packs[pi]));
            }
            var allLines = [];
            var allText = '';
            packs.forEach(function (p) {
              (p.rawLines || []).forEach(function (l) {
                if (l && allLines.indexOf(l) < 0) allLines.push(l);
              });
              if (p.text) allText += (allText ? '\n' : '') + p.text;
            });
            var fromText = parseCardFromLines(allLines, mergedRaw.cost || 0);
            mergedRaw = mergeCardResults(mergedRaw, fromText);
            mergedRaw = rescueAllSubsFromRaw(mergedRaw, allLines, allText);
            mergedRaw = rescueOrphanPercentRolls(mergedRaw, allText);
            var fakePack = {
              cards: [mergedRaw],
              rawLines: allLines,
              text: allText,
            };
            var out = finalizeCards(fakePack, 'miniprogram');
            out.name = file.name;
            out.engine = out.engine || 'tesseract';
            return out;
          });
        });
      });
      return Promise.all(tasks);
    });
  }

  function paddleItemsToLines(items) {
    var boxes = (items || [])
      .map(function (it) {
        var poly = it.poly || [];
        if (!poly.length) return null;
        var ys = poly.map(function (p) {
          return Number(p[1]) || 0;
        });
        var xs = poly.map(function (p) {
          return Number(p[0]) || 0;
        });
        var yMin = Math.min.apply(null, ys);
        var yMax = Math.max.apply(null, ys);
        var xMin = Math.min.apply(null, xs);
        var text = String(it.text || '').trim();
        if (!text) return null;
        return {
          text: text,
          score: Number(it.score) || 0,
          y: (yMin + yMax) / 2,
          x: xMin,
          h: Math.max(1, yMax - yMin),
        };
      })
      .filter(Boolean);

    boxes.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });

    var lines = [];
    var cur = null;
    boxes.forEach(function (b) {
      if (!cur) {
        cur = { y: b.y, h: b.h, parts: [b] };
        return;
      }
      var thresh = Math.max(10, Math.min(cur.h, b.h) * 0.55);
      if (Math.abs(b.y - cur.y) <= thresh) {
        cur.parts.push(b);
        cur.y = (cur.y * (cur.parts.length - 1) + b.y) / cur.parts.length;
        cur.h = Math.max(cur.h, b.h);
      } else {
        cur.parts.sort(function (a, b2) {
          return a.x - b2.x;
        });
        lines.push(
          cur.parts
            .map(function (p) {
              return p.text;
            })
            .join(' ')
        );
        cur = { y: b.y, h: b.h, parts: [b] };
      }
    });
    if (cur) {
      cur.parts.sort(function (a, b2) {
        return a.x - b2.x;
      });
      lines.push(
        cur.parts
          .map(function (p) {
            return p.text;
          })
          .join(' ')
      );
    }
    return lines;
  }

  function getPaddle() {
    if (paddlePromise) return paddlePromise;
    emitStatus('正在加载 PaddleOCR（本地引擎）…');
    try {
      // 必须在引擎脚本加载前设置，引擎会按这些地址拉模型/推理 WASM
      if (typeof window.__PADDLE_OCR_BASE === 'undefined') window.__PADDLE_OCR_BASE = PADDLE_ENGINE_BASE;
      if (typeof window.__PADDLE_MODEL_BASE === 'undefined') window.__PADDLE_MODEL_BASE = PADDLE_MODEL_BASE;
      if (typeof window.__PADDLE_WASM_BASE === 'undefined') window.__PADDLE_WASM_BASE = PADDLE_WASM_BASE;
    } catch (e) {}
    paddlePromise = loadPaddleEngineScript()
      .then(function (api) {
        emitStatus('正在初始化 PaddleOCR 推理引擎…');
        return api.init().then(function () {
          emitStatus('模型就绪，正在识别…');
          return api;
        });
      })
      .then(function (ocr) {
        return ocr;
      })
      .catch(function (err) {
        paddlePromise = null;
        throw err;
      });
    return paddlePromise;
  }

  function loadPaddleEngineScript() {
    if (typeof window.__paddleOCR !== 'undefined') {
      return Promise.resolve(window.__paddleOCR);
    }
    return ensurePaddleLocalEngine().then(function () {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = PADDLE_ENGINE_URL;
        s.onload = function () {
          if (typeof window.__paddleOCR !== 'undefined') resolve(window.__paddleOCR);
          else {
            paddlePromise = null;
            reject(new Error('PaddleOCR 引擎加载异常'));
          }
        };
        s.onerror = function () {
          paddlePromise = null;
          reject(new Error('PaddleOCR 引擎加载失败，请检查本地服务'));
        };
        document.head.appendChild(s);
      });
    });
  }

  /**
   * 识图引擎只在网盘下载并本地导入（省 CDN/服务器流量）：
   * 未导入时弹出网盘引导（openPaddleImport），绝不自动从 /paddle 下载。
   */
  function ensurePaddleLocalEngine() {
    if (typeof caches === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持本地引擎缓存，请使用新版 Chrome/Edge'));
    }
    return caches
      .open(PADDLE_LOCAL_CACHE_NAME)
      .then(function (cache) {
        return cache
          .match(location.origin + PADDLE_ENGINE_BASE + 'demo.js', { ignoreSearch: true })
          .then(function (hit) {
            if (!hit) {
              if (typeof window.openPaddleImport === 'function') {
                try {
                  window.openPaddleImport();
                } catch (e) {}
              }
              var err = new Error(
                '识图引擎未导入：请按弹窗提示从网盘下载引擎包（约 20MB，仅需导入一次）'
              );
              err.code = ERR_NEED_PADDLE_IMPORT;
              throw err;
            }
            // 已导入：等 Service Worker 接管，确保引擎/模型请求全部走本地缓存
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              return navigator.serviceWorker.ready.then(function () {
                return true;
              });
            }
            return true;
          });
      });
  }

  /**
   * 小程序词条多为横向色条：按行找金/青/亮字带，裁条 OCR，专补漏掉的副暴伤。
   */
  function findColoredRowBands(img, scale) {
    scale = scale || 2.4;
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    var scores = new Float32Array(h);
    var x0 = Math.floor(w * 0.08);
    var x1 = Math.floor(w * 0.98);
    for (var y = 0; y < h; y++) {
      var hit = 0;
      var total = 0;
      for (var x = x0; x < x1; x += 2) {
        var i = (y * w + x) * 4;
        var r = data[i];
        var g = data[i + 1];
        var b = data[i + 2];
        var peak = Math.max(r, g, b);
        var minc = Math.min(r, g, b);
        var luma = 0.299 * r + 0.587 * g + 0.114 * b;
        var gold = r > 95 && g > 70 && b < Math.min(r, g) * 0.9 && Math.min(r, g) - b > 24;
        var teal = g > 90 && b > 85 && r < Math.min(g, b) * 0.8;
        var bright = luma > 158 && peak > 165;
        if (gold || teal || bright) hit++;
        total++;
      }
      scores[y] = hit / Math.max(1, total);
    }
    var thr = 0.018;
    var bands = [];
    var inBand = false;
    var start = 0;
    for (var yy = 0; yy < h; yy++) {
      if (scores[yy] >= thr) {
        if (!inBand) {
          inBand = true;
          start = yy;
        }
      } else if (inBand) {
        inBand = false;
        if (yy - start >= 10) bands.push({ y0: start, y1: yy });
      }
    }
    if (inBand && h - start >= 10) bands.push({ y0: start, y1: h });
    // 合并过近色带
    var merged = [];
    bands.forEach(function (b) {
      var last = merged[merged.length - 1];
      if (last && b.y0 - last.y1 <= 8) {
        last.y1 = b.y1;
      } else {
        merged.push({ y0: b.y0, y1: b.y1 });
      }
    });
    return { canvas: c, bands: merged, w: w, h: h };
  }

  function cropBandCanvas(srcCanvas, band, padY) {
    padY = padY == null ? 6 : padY;
    var y0 = Math.max(0, band.y0 - padY);
    var y1 = Math.min(srcCanvas.height, band.y1 + padY);
    var out = document.createElement('canvas');
    out.width = srcCanvas.width;
    out.height = Math.max(1, y1 - y0);
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(srcCanvas, 0, y0, out.width, out.height, 0, 0, out.width, out.height);
    // 再做一遍暗色→墨迹，方便 Tesseract
    var imgData = ctx.getImageData(0, 0, out.width, out.height);
    var d = imgData.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i];
      var g = d[i + 1];
      var b = d[i + 2];
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      var peak = Math.max(r, g, b);
      var minc = Math.min(r, g, b);
      var gold = r > 95 && g > 70 && b < Math.min(r, g) * 0.9 && Math.min(r, g) - b > 24;
      var teal = g > 90 && b > 85 && r < Math.min(g, b) * 0.8;
      var bright = luma > 150;
      var ink = gold || teal || bright ? Math.max(peak, luma) : 0;
      var v = ink > 40 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return out;
  }

  function recognizeColorBands(worker, img) {
    var pack = findColoredRowBands(img, 2.5);
    var bands = (pack.bands || []).slice(0, 12);
    if (!bands.length) {
      return Promise.resolve({ cards: [], rawLines: [], text: '' });
    }
    emitStatus('色条裁切识别中（补金色副暴伤）…');
    var chain = Promise.resolve({ lines: [], text: '' });
    bands.forEach(function (band) {
      chain = chain.then(function (acc) {
        var crop = cropBandCanvas(pack.canvas, band, 8);
        return worker
          .recognize(crop, { tessedit_pageseg_mode: '7' }, { text: true })
          .then(function (res) {
            var t = String((res.data && res.data.text) || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (t) {
              acc.lines.push(t);
              acc.text += (acc.text ? '\n' : '') + t;
            }
            return acc;
          })
          .catch(function () {
            return acc;
          });
      });
    });
    return chain.then(function (acc) {
      var card = parseCardFromLines(acc.lines, costFromText(acc.text));
      card = rescueAllSubsFromRaw(card, acc.lines, acc.text);
      card = rescueOrphanPercentRolls(card, acc.text);
      return { cards: [card], rawLines: acc.lines, text: acc.text };
    });
  }

  function inputToDataUrl(input) {
    if (typeof File !== 'undefined' && input instanceof File) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () {
          resolve(String(r.result || ''));
        };
        r.onerror = function () {
          reject(new Error('图片读取失败'));
        };
        r.readAsDataURL(input);
      });
    }
    if (input && typeof input.toDataURL === 'function') {
      try {
        return Promise.resolve(input.toDataURL('image/png'));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.reject(new Error('不支持的 PaddleOCR 输入'));
  }

  function paddlePredictLines(ocr, input) {
    return inputToDataUrl(input).then(function (dataUrl) {
      return ocr.detect(dataUrl).then(function (lines) {
        return (lines || [])
          .map(function (l) {
            return String((l && l.text) || '').trim();
          })
          .filter(Boolean);
      });
    });
  }

  /** Paddle 检测框是“取整到 32 倍数”的缩放空间，按比例映射回原图坐标 */
  function paddleWordsFromLines(lines, natW, natH) {
    var BASE = 32;
    var rW = Math.max(Math.ceil(natW / BASE) * BASE, BASE);
    var rH = Math.max(Math.ceil(natH / BASE) * BASE, BASE);
    var sx = natW / rW;
    var sy = natH / rH;
    var words = [];
    (lines || []).forEach(function (l) {
      var f = l && l.frame;
      var t = String((l && l.text) || '').trim();
      if (!t || !f || !(f.width > 0) || !(f.height > 0)) return;
      words.push({
        text: t,
        x: (Number(f.left) || 0) * sx,
        y: (Number(f.top) || 0) * sy,
        w: (Number(f.width) || 0) * sx,
        h: (Number(f.height) || 0) * sy,
        conf: Number((l && l.score) || 0),
      });
    });
    return words;
  }

  function paddleDetectWords(ocr, input, natW, natH) {
    return inputToDataUrl(input).then(function (dataUrl) {
      return ocr.detect(dataUrl).then(function (lines) {
        return paddleWordsFromLines(lines, natW, natH);
      });
    });
  }

  function recognizeWordsPack(words, W, H, grid) {
    var fullLines = clusterLines(words).map(lineTextDropScoreColumn);
    var fullCard = parseCardFromLines(fullLines, costFromText(fullLines));
    var regions = detectCardRegions(words, W, H, grid);
    var isGrid = !!(grid && Number(grid.cols) > 0 && Number(grid.rows) > 0);
    var cards = regions.map(function (region) {
      return recognizeRegionFromWords(words, region);
    });
    if (!isGrid) {
      cards = cards.filter(function (c) {
        return c && (c.main1 || (c.subs && c.subs.length));
      });
      if (!cards.length && fullCard.main1) cards = [fullCard];
    }
    return { cards: cards, rawLines: fullLines, text: fullLines.join('\n') };
  }

  /** 网格模式：过滤评分面板等垃圾格，并做词条补救（与 Tesseract 网格路径一致） */
  function filterGridCards(cards) {
    var out = [];
    (cards || []).forEach(function (c) {
      if (!c || (!c.main1 && !(c.subs && c.subs.length))) return;
      var accTxt = (c.label || '') + ' ' + ((c.raw || []).join(' ') || '');
      if (/评级|评分/.test(accTxt)) return;
      // 评分面板/垃圾格：无主词条且干净副词条不足 2 条 → 丢弃（真实声骸必有主词条）
      if (!c.main1) {
        var cleanSubs = (c.subs || []).filter(function (s) {
          return s && !s.fuzzy && Number(s.value) > 0;
        }).length;
        if (cleanSubs < 2) return;
      }
      var cellRaws = (c.raw || []).slice();
      var cellText = cellRaws.join('\n');
      c = rescueAllSubsFromRaw(c, cellRaws, cellText);
      c = rescueOrphanPercentRolls(c, cellText);
      if (c && (c.main1 || (c.subs && c.subs.length))) out.push(c);
    });
    return out;
  }

  function mergeUniqueLines(target, extra) {
    (extra || []).forEach(function (l) {
      var t = String(l || '').trim();
      if (!t) return;
      if (target.indexOf(t) < 0) target.push(t);
    });
    return target;
  }

  function gridCellRegions(W, H, grid) {
    var gCols = Math.max(1, Math.min(6, Math.round(Number(grid.cols))));
    var gRows = Math.max(1, Math.min(10, Math.round(Number(grid.rows))));
    var cropX = Math.max(0, Math.round((W * (Number(grid.cropLeft) || 0)) / 100));
    var gW = Math.max(1, W - cropX);
    // 支持自定义网格线位置（0~1 占裁剪区宽/高的比例），未提供时均分
    function linePositions(count, lines) {
      var pos = [0];
      if (Array.isArray(lines) && lines.length === count - 1) {
        for (var i = 0; i < lines.length; i++) {
          var f = Number(lines[i]);
          pos.push(Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : (i + 1) / count);
        }
      } else {
        for (var k = 1; k < count; k++) pos.push(k / count);
      }
      pos.push(1);
      return pos;
    }
    var xs = linePositions(gCols, grid.colLines);
    var ys = linePositions(gRows, grid.rowLines);
    var regions = [];
    for (var r = 0; r < ys.length - 1; r++) {
      for (var c = 0; c < xs.length - 1; c++) {
        var x0 = Math.max(0, Math.round(cropX + gW * xs[c]));
        var x1 = Math.min(W, Math.round(cropX + gW * xs[c + 1]));
        var y0 = Math.max(0, Math.round(H * ys[r]));
        var y1 = Math.min(H, Math.round(H * ys[r + 1]));
        regions.push({ x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0 });
      }
    }
    return regions;
  }

  function cropImageRegion(img, region, pad) {
    pad = pad == null ? 6 : pad;
    var x0 = Math.max(0, region.x0 - pad);
    var y0 = Math.max(0, region.y0 - pad);
    var x1 = Math.min(img.naturalWidth, region.x1 + pad);
    var y1 = Math.min(img.naturalHeight, region.y1 + pad);
    var c = document.createElement('canvas');
    c.width = Math.max(1, x1 - x0);
    c.height = Math.max(1, y1 - y0);
    var ctx = c.getContext('2d');
    ctx.drawImage(img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }

  function upscaleCanvas(src, scale) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function mergePaddleWords(a, b) {
    var seen = {};
    var out = [];
    function push(list) {
      (list || []).forEach(function (w) {
        var key =
          String(w.text || '').trim() +
          '|' +
          Math.round((Number(w.y) || 0) / 6) +
          '|' +
          Math.round((Number(w.x) || 0) / 12);
        if (!seen[key]) {
          seen[key] = true;
          out.push(w);
        }
      });
    }
    // 已知官方数值（副词条档位 + 固定值 + 主词条），用于双通道冲突时择优
    var knownValues = null;
    function buildKnownValues() {
      knownValues = [2280, 150, 100, 135, 90, 70, 60, 50, 40, 30, 44, 22, 46.6, 33, 18, 10, 22.8];
      if (typeof ECHO_SUB_AFFIXES !== 'undefined') {
        for (var k in ECHO_SUB_AFFIXES) {
          var rolls = ECHO_SUB_AFFIXES[k] && ECHO_SUB_AFFIXES[k].rolls;
          if (Array.isArray(rolls)) knownValues = knownValues.concat(rolls);
        }
      }
    }
    function isNumText(t) {
      return /^\d+(?:\.\d+)?%?$/.test(String(t || '').trim());
    }
    function isKnownNum(t) {
      t = String(t || '').trim();
      if (!isNumText(t)) return false;
      var v = Number(parseFloat(t));
      if (!Number.isFinite(v) || v <= 0) return false;
      // 右侧评分列（两位小数 <30）不是词条数值
      if (/^\d+\.\d{2}$/.test(t) && v < 30) return false;
      if (!knownValues) buildKnownValues();
      for (var i = 0; i < knownValues.length; i++) {
        if (Math.abs(knownValues[i] - v) < 0.01) return true;
      }
      return false;
    }
    function nearSame(existing, w) {
      var dx = Math.abs((Number(existing.x) || 0) - (Number(w.x) || 0));
      var dy = Math.abs((Number(existing.y) || 0) - (Number(w.y) || 0));
      return dx <= 22 && dy <= 14;
    }
    push(a);
    (b || []).forEach(function (w) {
      var key =
        String(w.text || '').trim() +
        '|' +
        Math.round((Number(w.y) || 0) / 6) +
        '|' +
        Math.round((Number(w.x) || 0) / 12);
      if (seen[key]) return;
      // 同一位置双通道读出不同数值：保留命中官方档位的那条，丢弃乱码/脏值
      var conflict = null;
      for (var i = 0; i < out.length; i++) {
        if (nearSame(out[i], w)) {
          conflict = out[i];
          break;
        }
      }
      if (conflict) {
        var wNum = isNumText(w.text);
        var cNum = isNumText(conflict.text);
        var wKnown = isKnownNum(w.text);
        var cKnown = isKnownNum(conflict.text);
        if (wNum && cNum) {
          if (wKnown && !cKnown) {
            out.splice(i, 1);
            seen[key] = true;
            out.push(w);
            return;
          }
          if (!wKnown && cKnown) return; // 保留已有更可信的词
        } else if (wNum && !cNum && wKnown) {
          out.splice(i, 1);
          seen[key] = true;
          out.push(w);
          return;
        } else if (cNum && !wNum && cKnown) {
          return; // 已有数字可信，丢弃乱码
        }
      }
      seen[key] = true;
      out.push(w);
    });
    return out;
  }

  /**
   * 自动分卡（与 demo 的 card-builder 同思路）：
   * 1) 词条名 + 右侧数值配对成词条项（词条名在卡内左对齐，不会跨卡粘连）
   * 2) 按词条名 x 聚列（每列 = 一竖排卡片）
   * 3) 每列内按 y 大间隔分卡（每卡 = 主词条 + 5 副词条 + 固定副主词条）
   * 返回每张声骸的截图区域，交给逐格裁剪识别。
   */
  function autoDetectCardRegions(words, W, H) {
    if (!words || !words.length) return [{ x0: 0, x1: W, y0: 0, y1: H }];

    function isStatName(t) {
      t = String(t || '').trim();
      if (!/[\u4e00-\u9fa5]{2,}/.test(t)) return false;
      if (matchStatName(t)) return true;
      var cjk = t.replace(/[^\u4e00-\u9fa5]/g, '');
      return !!fuzzyStatName(cjk);
    }

    // 1) 先按行聚类，再把同一行内「词条名 → 右侧数值」配对成词条项
    var stats = [];
    clusterLines(words).forEach(function (line) {
      var ws = line.words.slice().sort(function (a, b) {
        return a.x - b.x;
      });
      var names = [];
      var values = [];
      ws.forEach(function (w) {
        var t = String(w.text || '').trim();
        if (isStatName(t)) names.push(w);
        else if (/^\d+(?:\.\d+)?%?$/.test(t)) values.push(w);
      });
      var used = {};
      names.forEach(function (nw) {
        var best = null;
        var bestD = Infinity;
        values.forEach(function (vw, vi) {
          if (used[vi]) return;
          var d = vw.x - nw.x;
          if (d < 0) return;
          if (d < bestD) {
            bestD = d;
            best = { vw: vw, vi: vi };
          }
        });
        if (best) {
          used[best.vi] = true;
          stats.push({
            x: nw.x,
            x1: best.vw.x + best.vw.w,
            y: line.y,
            h: Math.max(nw.h || 0, best.vw.h || 0),
          });
        }
      });
    });
    if (!stats.length) return [{ x0: 0, x1: W, y0: 0, y1: H }];

    // 2) 按词条名 x 聚列
    var colGap = Math.max(48, W * 0.12);
    var cols = [];
    stats
      .slice()
      .sort(function (a, b) {
        return a.x - b.x;
      })
      .forEach(function (s) {
        var last = cols.length ? cols[cols.length - 1] : null;
        if (last && s.x - last.maxX <= colGap) {
          last.maxX = Math.max(last.maxX, s.x);
          last.stats.push(s);
        } else {
          cols.push({ minX: s.x, maxX: s.x, stats: [s] });
        }
      });

    // 3) 每列内按 y 大间隔分卡
    var regions = [];
    cols.forEach(function (col) {
      col.stats.sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });
      var ys = col.stats.map(function (s) {
        return s.y;
      });
      var gaps = [];
      for (var i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
      gaps.sort(function (a, b) {
        return a - b;
      });
      var medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 36;
      var cardGap = Math.max(64, H * 0.08, medGap * 2.2);

      var groups = [];
      var cur = null;
      col.stats.forEach(function (s) {
        if (cur && s.y - cur.lastY <= cardGap) {
          cur.lastY = s.y;
          cur.stats.push(s);
        } else {
          if (cur && cur.stats.length >= 2) groups.push(cur);
          cur = { lastY: s.y, stats: [s] };
        }
      });
      if (cur && cur.stats.length >= 2) groups.push(cur);

      groups.forEach(function (g) {
        var x0 = Infinity;
        var x1 = 0;
        var y0 = Infinity;
        var y1 = 0;
        g.stats.forEach(function (s) {
          x0 = Math.min(x0, s.x);
          x1 = Math.max(x1, s.x1);
          y0 = Math.min(y0, s.y);
          y1 = Math.max(y1, s.y + s.h);
        });
        var padX = Math.max(20, W * 0.025);
        var padTop = Math.max(90, H * 0.12);
        var padBottom = Math.max(26, H * 0.035);
        regions.push({
          x0: Math.max(0, Math.round(x0 - padX)),
          x1: Math.min(W, Math.round(x1 + padX)),
          y0: Math.max(0, Math.round(y0 - padTop)),
          y1: Math.min(H, Math.round(y1 + padBottom)),
        });
      });
    });

    // 按「行带」排序（上下行各归一组），行内再按 x，保证阅读顺序
    var rowBucket = Math.max(1, Math.round(H * 0.35));
    regions.sort(function (a, b) {
      var ay = Math.round(a.y0 / rowBucket);
      var by = Math.round(b.y0 / rowBucket);
      return ay - by || a.x0 - b.x0;
    });
    if (!regions.length) return [{ x0: 0, x1: W, y0: 0, y1: H }];
    return regions;
  }

  /**
   * 逐卡裁剪独立识别。
   * opts.upScale=2 放大识别（小字更清晰）；opts.colorPass=true 追加彩色增强通道（专补青绿/金色彩字小数值）。
   * opts.strictBounds=true 时按原格子边界过滤词（词中心必须在格内），防邻卡串入。
   */
  function recognizeOneGridCellPaddle(ocr, img, region, opts) {
    var pad = 6;
    var crop = cropImageRegion(img, region, pad);
    opts = opts || {};
    var scale = opts.upScale === 2 ? 2 : 1;
    var base = upscaleCanvas(crop, scale);
    var tasks = [paddleDetectWords(ocr, base, base.width, base.height)];
    if (opts.colorPass) {
      var color = upscaleCanvas(preprocess(crop, 1, 'miniprogram'), scale);
      tasks.push(paddleDetectWords(ocr, color, color.width, color.height));
    }
    return Promise.all(tasks).then(function (packs) {
      var words = packs.length > 1 ? mergePaddleWords(packs[0], packs[1]) : packs[0];
      if (opts.strictBounds) {
        // 词坐标在放大后的检测空间 → 映射回原图空间，仅保留中心落在原格子内的词
        words = words.filter(function (w) {
          var ox = region.x0 - pad + (Number(w.x) || 0) / scale;
          var oy = region.y0 - pad + (Number(w.y) || 0) / scale;
          return (
            ox >= region.x0 &&
            ox <= region.x1 &&
            oy >= region.y0 &&
            oy <= region.y1
          );
        });
      }
      var pack = recognizeWordsPack(words, base.width, base.height, null);
      return (pack.cards && pack.cards[0]) || null;
    });
  }

  function recognizeOnePaddle(ocr, file, grid) {
    return loadImage(file).then(function (img) {
      var guessed = detectEchoTemplate(img);
      var isGrid = !!(grid && Number(grid.cols) > 0 && Number(grid.rows) > 0);
      var W = img.naturalWidth;
      var H = img.naturalHeight;
      emitStatus(isGrid ? 'PaddleOCR 网格识别中（逐格裁剪）…' : 'PaddleOCR 识别中（自动分卡）…');
      var regionTask = isGrid
        ? Promise.resolve(gridCellRegions(W, H, grid))
        : paddleDetectWords(ocr, file, W, H).then(function (words) {
            return autoDetectCardRegions(words, W, H);
          });
      return regionTask.then(function (regions) {
        var chain = Promise.resolve([]);
        regions.forEach(function (region) {
          chain = chain.then(function (acc) {
            // 网格模式：放大 2× + 彩色增强 + 严格格子边界过滤（防邻卡串入）；
            // 自动分卡：放大 2× + 彩色增强，专补彩字小数值（如 青绿 共鸣效率 9.2%）
            var cellOpts = isGrid
              ? { upScale: 2, colorPass: true, strictBounds: true }
              : { upScale: 2, colorPass: true };
            return recognizeOneGridCellPaddle(ocr, img, region, cellOpts).then(function (card) {
              if (card) acc.push(card);
              return acc;
            });
          });
        });
        return chain.then(function (cards) {
          cards = filterGridCards(cards);
          var pack = { cards: cards, rawLines: [], text: '' };
          cards.forEach(function (c) {
            (c.raw || []).forEach(function (l) {
              if (l && pack.rawLines.indexOf(l) < 0) pack.rawLines.push(l);
            });
          });
          pack.text = pack.rawLines.join('\n');
          if (!pack.cards.length && !pack.rawLines.length) {
            throw new Error('PaddleOCR 未识别到文字');
          }
          var out = finalizeCards(pack, refineTemplateByText(guessed, pack.text));
          out.name = file.name;
          out.engine = 'paddle';
          out.rawPreview = pack.text.slice(0, 400);
          return out;
        });
      });
    });
  }

  function recognizeFilesPaddle(files, opts) {
    var list = Array.prototype.slice.call(files || []);
    return getPaddle().then(function (ocr) {
      var chain = Promise.resolve([]);
      // 串行识别，避免 WASM 并发抢占导致卡死
      list.forEach(function (file) {
        chain = chain.then(function (acc) {
          return recognizeOnePaddle(ocr, file, opts && opts.grid).then(function (one) {
            acc.push(one);
            return acc;
          });
        });
      });
      return chain;
    });
  }

  function recognizeFiles(files, opts) {
    return recognizeFilesPaddle(files, opts).catch(function (err) {
      // 引擎包未导入：引导网盘下载，不自动回退 Tesseract（避免悄悄消耗流量/降低质量）
      if (err && err.code === ERR_NEED_PADDLE_IMPORT) throw err;
      console.warn('[EchoOCR] PaddleOCR 失败，回退 Tesseract', err);
      emitStatus('PaddleOCR 不可用，改用 Tesseract（较慢，彩字易漏）…');
      return recognizeFilesTesseract(files, opts).then(function (results) {
        (results || []).forEach(function (r) {
          r.engine = 'tesseract';
          r.engineNote =
            'PaddleOCR 未就绪，已回退 Tesseract：' + ((err && err.message) || '未知错误');
        });
        return results;
      });
    });
  }

  /* ---------------- AI vision recognition (BYOK: user DashScope key) ---------------- */
  var AI_OCR_ENDPOINT =
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  var AI_OCR_PROMPT =
    '你是《鸣潮》声骸属性识别助手。识别图中的声骸信息，只输出一个 JSON 对象，不要输出任何其它文字。\n' +
    'JSON 格式：{"cards":[{"cost":4,"main1":"暴击率 22.0%","subs":["暴击伤害 12.6%","攻击力 10.5%"]}]}\n' +
    '规则：\n' +
    '1. cost 只填 4 / 3 / 1。cost 根据主词条判断：暴击率22%/暴击伤害44%/生命值46.6%/攻击力33% 为 4C；元素伤害30%/攻击力18%/生命值22.8% 为 3C；攻击力10%/生命值10% 为 1C。\n' +
    '2. main1 是每张卡第一行的大字主词条，格式"词条名 数值"，数值带%或原样。不要把副词条当成主词条。\n' +
    '3. subs 是副词条，每行一个"词条名 数值"，最多 5 条；忽略小程序界面右侧的权重列数字，只取左侧真实数值。\n' +
    '4. 一张图可能包含多个声骸，全部列出到 cards。\n' +
    '5. 词条名用游戏内标准名：暴击率、暴击伤害、攻击力、防御力、生命值、共鸣效率、普攻伤害加成、重击伤害加成、共鸣技能伤害加成、共鸣解放伤害加成、冷凝伤害加成、热熔伤害加成、导电伤害加成、气动伤害加成、衍射伤害加成、湮灭伤害加成。\n' +
    '6. 数值保留截图原样（如 12.6%、19.2%、150）。\n' +
    '7. 若是小程序截图：忽略左侧的「声骸评级 / 声骸评分」悬浮面板，它不是声骸卡；声骸卡可能按 2~3 列网格排列，一张卡就是数组里一个对象，卡与卡不要合并。\n' +
    '8. 每张卡的副词条最多 5 条，逐行完整列出，不要漏掉靠后的词条；颜色（金/青/紫/绿）只用于区分词条，不用在输出里标注。';

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(new Error('读取图片失败'));
      };
      r.readAsDataURL(file);
    });
  }

  /** 服务器中转：浏览器直连百炼失败（CORS/网络）时自动降级，Key 仅透传、费用仍算用户 */
  function callAiVisionRelay(dataUrl, apiKey, model) {
    return fetch('/api/ai-ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: apiKey,
        model: model,
        prompt: AI_OCR_PROMPT,
        imageDataUrl: dataUrl,
      }),
    })
      .then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok) {
            var e = j && j.error;
            throw new Error((e && e.message) || '中转接口错误 ' + res.status);
          }
          var content = j && j.content;
          if (!content) throw new Error('中转未返回识别结果');
          return content;
        });
      });
  }

  function callAiVision(dataUrl, apiKey, model) {
    var payload = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: AI_OCR_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
    };
    var controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, 90000)
      : null;
    return fetch(AI_OCR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          return res.json().then(function (j) {
            var e = j && j.error;
            throw new Error(
              'AI 接口错误 ' +
                res.status +
                '：' +
                ((e && (e.message || e.code)) || String(j).slice(0, 140))
            );
          });
        }
        return res.json();
      })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        var content =
          j &&
          j.choices &&
          j.choices[0] &&
          j.choices[0].message &&
          j.choices[0].message.content;
        if (!content) throw new Error('AI 未返回识别结果');
        return content;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          throw new Error(
            'AI 响应超时（90 秒）。网络较慢或模型过慢，请重试，或换 qwen3-vl-plus 等更快模型'
          );
        }
        if (err && /^AI 接口错误/.test(String(err.message))) throw err;
        // 网络/CORS 失败：自动走服务器中转
        return callAiVisionRelay(dataUrl, apiKey, model);
      });
  }

  function parseAiJson(text) {
    var s = String(text || '').trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  /** AI line like "暴击率 22.0%" -> dedicated parser (parseLine is tuned for OCR glue text) */
  function statFromAiString(str, allowNoValue) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*(%?)\s*$/);
    var nameRaw = '';
    var value = null;
    var unit = '';
    if (m && m[1]) {
      nameRaw = m[1].trim();
      value = Number(m[2]);
      unit = m[3] ? '%' : '';
      if (!Number.isFinite(value) || value <= 0) value = null;
    } else {
      nameRaw = s;
    }
    if (!nameRaw) return null;
    var cjk = nameRaw.replace(/[^\u4e00-\u9fa5]/g, '');
    var name = normalizeStatName(cjk) || cjk;
    var fuzzy = false;
    var fz = fuzzyStatName(cjk);
    if (fz) {
      name = fz;
      fuzzy = true;
    }
    if (!name) return null;
    if (value === null && !allowNoValue) return null;
    var out = {
      name: name,
      value: value,
      unit: unit,
      fuzzy: fuzzy,
      hadDecimal: m ? /\./.test(String(m[2])) : false,
    };
    if (/增伤|伤害加成/.test(name)) {
      for (var el in ELEMENT_MAP) {
        if (cjk.indexOf(el) >= 0) {
          out.element = ELEMENT_MAP[el];
          break;
        }
      }
      for (var t in TYPE_DMG_MAP) {
        if (cjk.indexOf(t) >= 0) {
          out.damageType = TYPE_DMG_MAP[t];
          break;
        }
      }
    }
    return out;
  }

  function recognizeFilesWithAI(files, apiKey, opts) {
    var model = (opts && opts.model) || 'qwen3-vl-plus';
    var status = window.EchoOCR && window.EchoOCR.onStatus;
    function statusMsg(msg) {
      if (typeof status === 'function') status(msg);
    }
    var results = [];
    return (files || [])
      .reduce(function (chain, file) {
        return chain
          .then(function () {
            return readFileAsDataUrl(file).then(function (dataUrl) {
              statusMsg('正在调用 AI 识别（' + file.name + '）…');
              return callAiVision(dataUrl, apiKey, model);
            });
          })
          .then(function (content) {
            var parsed = parseAiJson(content);
            var cards = [];
            var cardsRaw = [];
            if (parsed) {
              if (Array.isArray(parsed.cards)) cardsRaw = parsed.cards;
              else if (Array.isArray(parsed.result)) cardsRaw = parsed.result;
              else if (parsed.data && Array.isArray(parsed.data.cards)) cardsRaw = parsed.data.cards;
              else if (parsed.main1 || parsed.main || parsed.subs || parsed.sub || parsed['主词条'] || parsed['副词条']) {
                cardsRaw = [parsed];
              }
            }
            if (cardsRaw.length) {
              cardsRaw.forEach(function (c) {
                if (!c || typeof c !== 'object') return;
                var main1Text =
                  c.main1 || c.main || c['主词条'] || c.mainStat || c.primary || '';
                var subList = c.subs || c.sub || c['副词条'] || c.subStats || [];
                if (typeof main1Text === 'object' && main1Text) {
                  var o = main1Text;
                  main1Text =
                    (o.name || o['名称'] || o.label || '') +
                    ' ' +
                    (o.value !== undefined ? o.value : o['值'] !== undefined ? o['值'] : '');
                }
                var cost = Number(c && c.cost);
                if (cost !== 1 && cost !== 3 && cost !== 4) cost = 0;
                var mainStat = statFromAiString(main1Text, true);
                var main1 = mainStat ? mapMain1(mainStat, cost || undefined) : null;
                var resolvedCost =
                  cost ||
                  (mainStat ? inferCostFromMain1(mainStat) : 0) ||
                  (main1 ? 4 : 0);
                var subs = [];
                (Array.isArray(subList) ? subList : []).forEach(function (s) {
                  if (subs.length >= 5) return;
                  var st = statFromAiString(
                    typeof s === 'string'
                      ? s
                      : (s.name || s['名称'] || '') +
                          ' ' +
                          (s.value !== undefined ? s.value : s['值'] !== undefined ? s['值'] : ''),
                    false
                  );
                  if (!st) return;
                  var mapped = mapSub(st);
                  if (!mapped) return;
                  subs.push(mapped);
                });
                cards.push({
                  cost: resolvedCost,
                  main1: main1,
                  subs: subs.slice(0, 5),
                  raw: [
                    String(main1Text || ''),
                    (Array.isArray(subList) ? subList : []).join(' | '),
                  ].filter(Boolean),
                  label: '',
                  template: 'ai',
                });
              });
            }
            results.push({
              name: file.name,
              cards: cards,
              engine: 'ai',
              engineNote: 'AI 识别（用户 Key，费用自理）',
            });
          });
      }, Promise.resolve())
      .then(function () {
        return results;
      });
  }

  window.EchoOCR = {
    recognize: recognizeFiles,
    recognizeWithAI: recognizeFilesWithAI,
    parseAiJson: parseAiJson,
    statFromAiString: statFromAiString,
    onStatus: null,
    engine: 'paddle',
    matchStatName: matchStatName,
    parseLine: parseLine,
    parseCardFromLines: parseCardFromLines,
    rescueOrphanPercentRolls: rescueOrphanPercentRolls,
    snapToRolls: snapToRolls,
    mapMain1: mapMain1,
    mapSub: mapSub,
    preprocess: preprocess,
    detectEchoTemplate: detectEchoTemplate,
    _debug: function (file) {
      return loadImage(file).then(function (img) {
        var kind = detectEchoTemplate(img);
        var canvas = preprocess(img, kind === 'miniprogram' ? 3 : 2.6, kind);
        return getWorker().then(function (worker) {
          return ocrWords(worker, canvas).then(function (pack) {
            return {
              template: refineTemplateByText(kind, pack.text || ''),
              guessed: kind,
              text: pack.text,
              words: pack.words,
              regions: detectCardRegions(pack.words, canvas.width, canvas.height),
            };
          });
        });
      });
    },
  };
})();
