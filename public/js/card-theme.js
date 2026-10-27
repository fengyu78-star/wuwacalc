/**
 * 卡面 / 详情弹窗 4 主题切换（暗金 gold / 冰蓝 ice / 赤焰 flame / 翡翠 jade）
 * 独立于页面主题（theme.js），作用于 documentElement 的 data-card-theme 属性。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'wavecalc-card-theme';
  var THEMES = ['gold', 'ice', 'flame', 'jade'];

  function readSaved() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      return THEMES.indexOf(t) >= 0 ? t : 'gold';
    } catch (e) {
      return 'gold';
    }
  }

  function apply(theme) {
    var next = THEMES.indexOf(theme) >= 0 ? theme : 'gold';
    document.documentElement.setAttribute('data-card-theme', next);
    syncButtons();
    return next;
  }

  function syncButtons() {
    var cur = document.documentElement.getAttribute('data-card-theme') || 'gold';
    document.querySelectorAll('[data-card-theme-btn]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-card-theme-btn') === cur);
      b.setAttribute('aria-pressed', b.getAttribute('data-card-theme-btn') === cur ? 'true' : 'false');
    });
    document.querySelectorAll('[data-card-theme-select]').forEach(function (sel) {
      sel.value = cur;
    });
  }

  apply(readSaved());

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-card-theme-btn]');
    if (!btn) return;
    var t = btn.getAttribute('data-card-theme-btn');
    apply(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch (err) {
      /* ignore */
    }
  });

  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-card-theme-select]');
    if (!sel) return;
    var t = sel.value;
    apply(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch (err) {
      /* ignore */
    }
  });

  window.WaveCalcCardTheme = {
    apply: function (t) {
      apply(t);
      try {
        localStorage.setItem(STORAGE_KEY, t);
      } catch (err) {
        /* ignore */
      }
    },
    get: function () {
      return document.documentElement.getAttribute('data-card-theme') || 'gold';
    },
  };
})();
