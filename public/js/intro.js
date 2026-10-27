/**
 * 网站开场门：完整播放视频 → 末帧前 pause 定格
 * Logo 从正中随视频进度缓慢丝滑移到顶栏品牌位
 */
(function () {
  'use strict';

  var SESSION_KEY = 'wavecalc-intro-passed';
  var VIDEO_SRC = 'assets/brand/' + encodeURIComponent('爱弥斯联合动态图标.mp4');
  var FREEZE_BEFORE_END = 0.12;
  var HERO_SCALE = 1.9;
  /** logo 从正中移到左上角的时长（毫秒） */
  var BRAND_MOVE_MS = 3000;

  var root = null;
  var videoEl = null;
  var canvasEl = null;
  var canvasCtx = null;
  var starfield = null;
  var gateEl = null;
  var brandEl = null;
  var loadingEl = null;
  var loadFillEl = null;
  var loadPctEl = null;
  var gateShown = false;
  var frozen = false;
  var flight = null;
  var brandProgress = 0;
  var brandMoveStartedAt = 0;
  var rafId = 0;
  var paintRafId = 0;
  /** 进度条速度波动采样（单调 0→1），每场开场随机生成 */
  var loadWarpSamples = null;
  var loadDisplayPct = 0;

  function passed() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function markPassed() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch (e) {}
  }

  function enterApp() {
    markPassed();
    stopBrandLoop();
    stopPaintLoop();
    stopStarfield(true);
    document.documentElement.classList.remove('intro-pending');
    document.body.classList.remove('intro-open');
    if (window.WaveCalcBgm && typeof WaveCalcBgm.syncHint === 'function') {
      WaveCalcBgm.syncHint();
    }
    if (window.WaveCalcBgm && typeof WaveCalcBgm.unlockAndPlay === 'function') {
      void WaveCalcBgm.unlockAndPlay();
    }
    if (window.Cloud && typeof Cloud.close === 'function') {
      try {
        Cloud.close();
      } catch (e) {}
    }
    if (root) {
      root.classList.add('is-leaving');
      window.setTimeout(function () {
        if (root) {
          root.hidden = true;
          root.setAttribute('aria-hidden', 'true');
          root.classList.remove('is-leaving', 'is-gate');
        }
        stopPaintLoop();
        stopStarfield(false);
        if (videoEl) {
          try {
            videoEl.pause();
          } catch (e) {}
        }
      }, 420);
    }
  }

  function stopStarfield(fade) {
    if (!starfield) return;
    if (fade && starfield.isRunning()) {
      starfield.fadeOut(1000, function () {
        if (starfield) starfield.stop();
      });
    } else {
      starfield.stop();
    }
  }

  function startStarfield() {
    if (!root) return;
    var stage = root.querySelector('.site-intro-stage');
    if (!stage) return;
    if (!starfield && window.WaveCalcStarfield) {
      starfield = WaveCalcStarfield.create(stage, { className: 'site-intro-stars' });
    }
    if (starfield) starfield.start();
  }

  /** 生成一段快慢交替的加载曲线，仍保证 t=0→0、t=1→1 且单调不回退 */
  function buildLoadWarp() {
    var N = 48;
    var seed = Math.random() * Math.PI * 2;
    var seed2 = Math.random() * 12;
    var rates = [];
    var i;
    for (i = 0; i < N; i++) {
      var u = i / N;
      // 多频起伏：偶发冲刺、偶发发呆，速率始终 > 0
      var wave =
        0.45 +
        0.55 * Math.pow(0.5 + 0.5 * Math.sin(u * 14.7 + seed), 2.2) +
        0.35 * Math.pow(0.5 + 0.5 * Math.sin(u * 6.3 + seed2), 1.6) +
        0.25 * (0.5 + 0.5 * Math.sin(u * 23.1 + seed * 0.7));
      // 末段略加速，避免卡在 90%+ 太久
      var endBoost = 1 + 0.55 * Math.pow(u, 2.4);
      rates.push(Math.max(0.12, wave) * endBoost);
    }
    var sum = 0;
    for (i = 0; i < N; i++) sum += rates[i];
    var samples = new Array(N + 1);
    samples[0] = 0;
    var acc = 0;
    for (i = 0; i < N; i++) {
      acc += rates[i] / sum;
      samples[i + 1] = acc;
    }
    samples[N] = 1;
    return samples;
  }

  function warpLoadProgress(t) {
    t = Math.max(0, Math.min(1, t));
    if (!loadWarpSamples || !loadWarpSamples.length) return t;
    var N = loadWarpSamples.length - 1;
    var x = t * N;
    var i = x | 0;
    if (i >= N) return 1;
    var f = x - i;
    return loadWarpSamples[i] * (1 - f) + loadWarpSamples[i + 1] * f;
  }

  /** 进度条跟动画时间走，并叠加速度波动（不用缓冲进度） */
  function setLoadingPct(pct) {
    if (!loadingEl || loadingEl.hidden) return;
    pct = Math.max(0, Math.min(100, pct));
    loadDisplayPct = pct;
    var shown = Math.round(pct);
    if (loadFillEl) loadFillEl.style.width = pct.toFixed(2) + '%';
    var glow = loadingEl.querySelector('[data-intro-load-glow]');
    if (glow) glow.style.left = pct.toFixed(2) + '%';
    if (loadPctEl) loadPctEl.textContent = shown + '%';
  }

  function updateLoadingPct() {
    if (!loadingEl || loadingEl.hidden || !videoEl) return;
    if (frozen || gateShown) {
      setLoadingPct(100);
      return;
    }
    if (!loadWarpSamples) loadWarpSamples = buildLoadWarp();
    var dur = videoEl.duration;
    var holdAt = dur && Number.isFinite(dur) ? Math.max(0.001, dur - FREEZE_BEFORE_END) : 0;
    var linear = 0;
    if (holdAt > 0) {
      linear = Math.max(0, Math.min(1, videoEl.currentTime / holdAt));
    }
    var warped = warpLoadProgress(linear) * 100;
    // 轻量平滑，不允许回退；临近结束贴齐，保证播完到 100%
    var next = loadDisplayPct + (warped - loadDisplayPct) * 0.55;
    if (next < loadDisplayPct) next = loadDisplayPct;
    if (linear > 0.96) next = Math.max(next, warped);
    if (linear >= 1) next = 100;
    setLoadingPct(next);
  }

  function sizeCanvas() {
    if (!canvasEl || !canvasCtx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    var bw = Math.round(w * dpr);
    var bh = Math.round(h * dpr);
    if (canvasEl.width !== bw || canvasEl.height !== bh) {
      canvasEl.width = bw;
      canvasEl.height = bh;
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
      canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** 按 object-fit: contain 把视频帧画到 canvas；留白透明，露出底层粒子 */
  function paintVideoFrame() {
    if (!canvasEl || !canvasCtx || !videoEl) return;
    sizeCanvas();
    var vw = videoEl.videoWidth;
    var vh = videoEl.videoHeight;
    var cw = window.innerWidth;
    var ch = window.innerHeight;
    canvasCtx.clearRect(0, 0, cw, ch);
    if (!vw || !vh) return;
    var scale = Math.min(cw / vw, ch / vh);
    var dw = vw * scale;
    var dh = vh * scale;
    var dx = (cw - dw) / 2;
    var dy = (ch - dh) / 2;
    try {
      canvasCtx.drawImage(videoEl, dx, dy, dw, dh);
    } catch (e) {}
  }

  function tickPaint() {
    paintRafId = 0;
    if (!root || root.hidden || !videoEl) return;
    paintVideoFrame();
    updateLoadingPct();
    if (!frozen) {
      paintRafId = requestAnimationFrame(tickPaint);
    }
  }

  function startPaintLoop() {
    stopPaintLoop();
    paintRafId = requestAnimationFrame(tickPaint);
  }

  function stopPaintLoop() {
    if (paintRafId) {
      cancelAnimationFrame(paintRafId);
      paintRafId = 0;
    }
  }

  function freezeHere() {
    if (!videoEl) return;
    frozen = true;
    try {
      videoEl.pause();
      videoEl.removeAttribute('autoplay');
    } catch (e) {}
    paintVideoFrame();
    stopPaintLoop();
    applyBrandProgress(1);
  }

  function easeInOutCubic(t) {
    t = Math.max(0, Math.min(1, t));
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function measureFlight() {
    var target = document.querySelector('.app-topbar > .app-brand');
    if (!target) return null;
    var tr = target.getBoundingClientRect();
    if (!tr.width || !tr.height) return null;
    return {
      dockX: tr.left + tr.width / 2,
      dockY: tr.top + tr.height / 2,
      startX: window.innerWidth / 2,
      startY: window.innerHeight / 2,
    };
  }

  function refreshFlight() {
    flight = measureFlight();
    if (flight && brandEl) {
      brandEl.style.left = flight.dockX + 'px';
      brandEl.style.top = flight.dockY + 'px';
    }
    applyBrandProgress(brandProgress);
  }

  /** progress 0=正中放大，1=顶栏原尺寸 */
  function applyBrandProgress(raw) {
    if (!brandEl) return;
    brandProgress = Math.max(0, Math.min(1, Number(raw) || 0));
    var t = easeInOutCubic(brandProgress);
    if (!flight) flight = measureFlight();
    var dx = 0;
    var dy = 0;
    if (flight) {
      brandEl.style.left = flight.dockX + 'px';
      brandEl.style.top = flight.dockY + 'px';
      dx = (flight.startX - flight.dockX) * (1 - t);
      dy = (flight.startY - flight.dockY) * (1 - t);
    } else {
      brandEl.style.left = '50%';
      brandEl.style.top = '50%';
    }
    var scale = HERO_SCALE + (1 - HERO_SCALE) * t;
    brandEl.style.setProperty('--intro-dx', dx + 'px');
    brandEl.style.setProperty('--intro-dy', dy + 'px');
    brandEl.style.setProperty('--intro-scale', String(scale));
    brandEl.classList.toggle('is-docked', brandProgress >= 0.995);
  }

  function brandMoveProgress() {
    if (!brandMoveStartedAt) return 0;
    return Math.max(0, Math.min(1, (performance.now() - brandMoveStartedAt) / BRAND_MOVE_MS));
  }

  function tickBrand() {
    rafId = 0;
    if (!root || root.hidden) return;
    var p = brandMoveProgress();
    applyBrandProgress(p);
    if (p < 1 && !gateShown) {
      rafId = requestAnimationFrame(tickBrand);
    }
  }

  function startBrandLoop() {
    stopBrandLoop();
    if (!brandMoveStartedAt) brandMoveStartedAt = performance.now();
    rafId = requestAnimationFrame(tickBrand);
  }

  function stopBrandLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function seekNearEndThenFreeze(done) {
    if (!videoEl) {
      if (done) done();
      return;
    }
    if (frozen) {
      if (done) done();
      return;
    }
    var dur = videoEl.duration;
    if (!dur || !Number.isFinite(dur) || dur <= FREEZE_BEFORE_END) {
      freezeHere();
      if (done) done();
      return;
    }
    var target = Math.max(0, dur - FREEZE_BEFORE_END);
    var finish = function () {
      freezeHere();
      if (done) done();
    };
    if (videoEl.currentTime >= target - 0.02) {
      finish();
      return;
    }
    videoEl.addEventListener('seeked', finish, { once: true });
    try {
      videoEl.pause();
      videoEl.currentTime = target;
    } catch (e) {
      finish();
    }
  }

  function showGate() {
    if (gateShown) return;
    gateShown = true;
    stopBrandLoop();
    applyBrandProgress(1);
    if (!frozen) freezeHere();
    setLoadingPct(100);
    if (root) root.classList.add('is-gate');
    if (gateEl) gateEl.hidden = false;
    var skipBtn = root && root.querySelector('[data-intro-skip-anim]');
    if (skipBtn) skipBtn.hidden = true;
    var loading = root && root.querySelector('[data-intro-loading]');
    if (loading) loading.hidden = true;
    // 星空持续到进入计算器，不随开场动画结束而消失
  }

  function onReachedEndHold() {
    if (frozen && gateShown) return;
    freezeHere();
    showGate();
  }

  function build() {
    root = document.getElementById('siteIntro');
    if (!root) {
      root = document.createElement('div');
      root.id = 'siteIntro';
      root.className = 'site-intro';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', '鳴算屋开场');
      document.body.insertBefore(root, document.body.firstChild);
    }

    root.innerHTML =
      '<div class="site-intro-stage">' +
      '<video class="site-intro-video" playsinline muted preload="auto" disablePictureInPicture disableRemotePlayback aria-hidden="true" tabindex="-1"></video>' +
      '<canvas class="site-intro-canvas" aria-hidden="true"></canvas>' +
      '<div class="site-intro-veil" aria-hidden="true"></div>' +
      '<div class="site-intro-brand-fly app-brand" data-intro-brand aria-hidden="true">' +
      '<img class="app-brand-logo" src="assets/brand/logo.png" alt="" width="40" height="40" decoding="async" />' +
      '<div class="app-brand-text">' +
      '<span class="app-brand-cn">鳴算屋</span>' +
      '<span class="app-brand-en">WAVECALC</span>' +
      '</div></div>' +
      '<div class="site-intro-load-hud" data-intro-loading>' +
      '<div class="site-intro-load-bar" aria-hidden="true">' +
      '<div class="site-intro-load-fill" data-intro-load-fill></div>' +
      '<span class="site-intro-load-glow" data-intro-load-glow></span>' +
      '</div>' +
      '<p class="site-intro-load-text">加载中 <span class="site-intro-load-pct" data-intro-pct>0%</span></p>' +
      '</div>' +
      '</div>' +
      '<div class="site-intro-gate" data-intro-gate hidden>' +
      '<h1 class="site-intro-gate-title">欢迎来到鳴算屋</h1>' +
      '<p class="site-intro-gate-lead">登录后可上传公开方案；游客可直接使用计算器。</p>' +
      '<div class="site-intro-actions">' +
      '<button type="button" class="btn site-intro-btn primary" data-intro-login>登录 / 注册</button>' +
      '<button type="button" class="btn site-intro-btn" data-intro-guest>游客访问</button>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="site-intro-skip" data-intro-skip-anim hidden>跳过动画</button>';

    videoEl = root.querySelector('.site-intro-video');
    canvasEl = root.querySelector('.site-intro-canvas');
    canvasCtx = canvasEl && canvasEl.getContext ? canvasEl.getContext('2d') : null;
    gateEl = root.querySelector('[data-intro-gate]');
    brandEl = root.querySelector('[data-intro-brand]');
    loadingEl = root.querySelector('[data-intro-loading]');
    loadFillEl = root.querySelector('[data-intro-load-fill]');
    loadPctEl = root.querySelector('[data-intro-pct]');
    if (brandEl) brandEl.classList.add('is-tracking');

    loadWarpSamples = buildLoadWarp();
    loadDisplayPct = 0;
    setLoadingPct(0);

    startStarfield();

    requestAnimationFrame(function () {
      refreshFlight();
      applyBrandProgress(0);
      requestAnimationFrame(function () {
        refreshFlight();
        applyBrandProgress(0);
        startBrandLoop();
      });
    });

    window.addEventListener('resize', function onResize() {
      if (!root || root.hidden) {
        window.removeEventListener('resize', onResize);
        return;
      }
      refreshFlight();
      paintVideoFrame();
      if (starfield) starfield.resize();
    });

    // 进度刷新（星空 rAF 独立，这里轻量轮询即可）
    var loadTimer = window.setInterval(function () {
      if (!root || root.hidden || gateShown) {
        window.clearInterval(loadTimer);
        return;
      }
      updateLoadingPct();
    }, 200);

    if (!videoEl) {
      applyBrandProgress(1);
      showGate();
      return;
    }

    videoEl.loop = false;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    videoEl.controls = false;
    try {
      videoEl.disablePictureInPicture = true;
    } catch (e) {}
    try {
      videoEl.disableRemotePlayback = true;
    } catch (e) {}
    videoEl.setAttribute('disablePictureInPicture', '');
    videoEl.setAttribute('disableRemotePlayback', '');

    videoEl.addEventListener('loadedmetadata', function () {
      refreshFlight();
      paintVideoFrame();
      updateLoadingPct();
    });
    videoEl.addEventListener('playing', function () {
      startPaintLoop();
      updateLoadingPct();
    });

    videoEl.addEventListener('timeupdate', function onTime() {
      updateLoadingPct();
      if (frozen) return;
      var dur = videoEl.duration;
      if (!dur || !Number.isFinite(dur)) return;
      if (videoEl.currentTime >= dur - FREEZE_BEFORE_END) {
        videoEl.removeEventListener('timeupdate', onTime);
        setLoadingPct(100);
        onReachedEndHold();
      }
    });

    videoEl.addEventListener(
      'ended',
      function () {
        if (frozen) {
          showGate();
          return;
        }
        var dur = videoEl.duration;
        var target =
          dur && Number.isFinite(dur) ? Math.max(0, dur - FREEZE_BEFORE_END) : 0;
        var after = function () {
          freezeHere();
          showGate();
        };
        try {
          videoEl.addEventListener('seeked', after, { once: true });
          videoEl.currentTime = target;
        } catch (e) {
          after();
        }
      },
      { once: true }
    );

    videoEl.addEventListener(
      'error',
      function () {
        stopPaintLoop();
        applyBrandProgress(1);
        showGate();
      },
      { once: true }
    );

    videoEl.src = VIDEO_SRC;
    startPaintLoop();
    var playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {
        stopPaintLoop();
        applyBrandProgress(1);
        showGate();
      });
    }
  }

  function bind() {
    if (!root) return;
    root.addEventListener('click', function (e) {
      var guest = e.target.closest('[data-intro-guest]');
      if (guest) {
        if (window.WaveCalcBgm && typeof WaveCalcBgm.unlockAndPlay === 'function') {
          void WaveCalcBgm.unlockAndPlay();
        }
        enterApp();
        return;
      }
      var login = e.target.closest('[data-intro-login]');
      if (login) {
        // intro-seen-on-login-click：打开登录/注册面板即视为已看过开场，
        // 避免在协议页等新标签页返回时开场动画重播
        markPassed();
        if (window.WaveCalcBgm && typeof WaveCalcBgm.unlockAndPlay === 'function') {
          void WaveCalcBgm.unlockAndPlay();
        }
        if (window.Cloud && typeof Cloud.getUser === 'function' && Cloud.getUser()) {
          enterApp();
          return;
        }
        if (window.Cloud && typeof Cloud.open === 'function') {
          Cloud.open('auth');
        } else {
          enterApp();
        }
        return;
      }
      var skip = e.target.closest('[data-intro-skip-anim]');
      if (skip) {
        e.preventDefault();
        e.stopPropagation();
        skip.hidden = true;
        // 跳过：收束品牌到顶栏位，定格视频末帧，直接进门禁
        var from = brandProgress;
        var start = performance.now();
        var durMs = 500;
        stopBrandLoop();
        if (loadingEl) loadingEl.hidden = true;
        (function easeDock(now) {
          var u = Math.min(1, (now - start) / durMs);
          applyBrandProgress(from + (1 - from) * easeInOutCubic(u));
          if (u < 1) {
            requestAnimationFrame(easeDock);
          } else {
            seekNearEndThenFreeze(function () {
              showGate();
            });
          }
        })(start);
      }
    });
  }

  function start() {
    if (passed()) {
      document.documentElement.classList.remove('intro-pending');
      return;
    }
    document.documentElement.classList.add('intro-pending');
    document.body.classList.add('intro-open');
    build();
    bind();
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');

    // 开场立刻尝试播 BGM；若被浏览器拦截，会显示「点击开启背景音乐」
    if (window.WaveCalcBgm && typeof WaveCalcBgm.playOnIntro === 'function') {
      void WaveCalcBgm.playOnIntro();
    }

    var skipBtn = root.querySelector('[data-intro-skip-anim]');
    if (skipBtn) {
      // 稍等片刻再显示，避免一进来就抢注意力
      window.setTimeout(function () {
        if (!gateShown) skipBtn.hidden = false;
      }, 600);
    }
  }

  function onAuthMaybeEnter() {
    if (!document.body.classList.contains('intro-open')) return;
    if (!gateShown) return;
    if (window.Cloud && typeof Cloud.getUser === 'function' && Cloud.getUser()) {
      enterApp();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.SiteIntro = {
    enter: enterApp,
    showGate: showGate,
    onAuthMaybeEnter: onAuthMaybeEnter,
    isOpen: function () {
      return document.body.classList.contains('intro-open');
    },
  };
})();
