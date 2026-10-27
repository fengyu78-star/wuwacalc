/**
 * WaveCalc 主题切换
 * 经典暖金（默认）/ 深空墨蓝 / 桃夭灼灼 / 水墨宣纸
 * localStorage key: wavecalc-theme
 */
(function () {
  const THEMES = {
    classic: '经典暖金',
    'deep-blue': '深空墨蓝',
    'peach-blaze': '桃夭灼灼',
    'ink-wash': '水墨宣纸',
  };
  const STORAGE_KEY = 'wavecalc-theme';
  const DEFAULT_THEME = 'classic';
  /** 已下线主题 → 新主题 */
  const THEME_ALIASES = {
    'dark-purple': 'ink-wash',
    'pure-white': 'peach-blaze',
    'mist-jade': 'ink-wash',
  };

  function normalizeTheme(theme) {
    const mapped = THEME_ALIASES[theme] || theme;
    return THEMES[mapped] ? mapped : DEFAULT_THEME;
  }

  function applyTheme(theme) {
    const next = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', next);
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === next);
    });
    return next;
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function readSavedTheme() {
    try {
      return normalizeTheme(localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME);
    } catch (_) {
      return DEFAULT_THEME;
    }
  }

  function bindSwitcher() {
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', () => {
        const theme = applyTheme(btn.dataset.theme);
        persistTheme(theme);
      });
    });
  }

  const rawSaved = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    } catch (_) {
      return DEFAULT_THEME;
    }
  })();
  const saved = normalizeTheme(rawSaved);
  applyTheme(saved);
  if (rawSaved !== saved) persistTheme(saved);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSwitcher);
  } else {
    bindSwitcher();
  }

  window.WaveCalcTheme = {
    THEMES,
    STORAGE_KEY,
    applyTheme: (theme) => {
      const next = applyTheme(theme);
      persistTheme(next);
      return next;
    },
    getTheme: () =>
      normalizeTheme(document.documentElement.getAttribute('data-theme') || readSavedTheme()),
  };
})();
