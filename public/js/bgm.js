/**
 * 背景音乐：播放/暂停、下一首、音量、收起/展开
 * 歌单：assets/audio/playlist.json
 * 浏览器禁无手势自动外放：开场尝试 +「点击开启」提示
 */
(function () {
  'use strict';

  var MUTE_KEY = 'wavecalc-bgm-muted-v1';
  var VOL_KEY = 'wavecalc-bgm-volume-v1';
  var TRACK_KEY = 'wavecalc-bgm-track-v1';
  var COLLAPSE_KEY = 'wavecalc-bgm-collapsed-v1';
  var POS_KEY = 'wavecalc-bgm-pos-v1';
  var PLAYLIST_URL = 'assets/audio/playlist.json';
  var FALLBACK_TRACKS = [{ src: 'assets/audio/bgm.mp3', title: 'BGM 1' }];
  var ARC_LEN = 2 * Math.PI * 18; // r=18
  var IDLE_COLLAPSE_MS = 3000;
  var TRACK_PEEK_MS = 2000;

  var audio = null;
  var dock = null;
  var hintEl = null;
  var tracks = FALLBACK_TRACKS.slice();
  var trackIndex = 0;
  var ready = false;
  var wantPlay = true;
  var gestureBound = false;
  var volume = 0.35;
  var softMuted = false;
  var volumeBeforeMute = 0.35;
  var progressBound = false;
  var draggingDock = false;
  var dragMoved = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var preferredCollapsed = false;
  var collapsePrefStored = false;
  var idleCollapseTimer = null;
  var trackPeekTimer = null;
  var peekingTrack = false;

  function loadMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveMuted(muted) {
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (e) {}
  }

  function loadVolume() {
    try {
      var v = parseFloat(localStorage.getItem(VOL_KEY));
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    } catch (e) {}
    return 0.35;
  }

  function saveVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    softMuted = false;
    try {
      localStorage.setItem(VOL_KEY, String(volume));
    } catch (e) {}
    applySoftMute();
    syncDock();
  }

  function toggleMute() {
    if (softMuted || volume <= 0.001) {
      softMuted = false;
      if (volume <= 0.001) volume = volumeBeforeMute || 0.35;
      applySoftMute();
    } else {
      volumeBeforeMute = volume || 0.35;
      softMuted = true;
      applySoftMute();
    }
    syncDock();
  }

  function seekFromEvent(e) {
    if (!audio) return;
    var bar = dock && dock.querySelector('[data-bgm-seek]');
    if (!bar) return;
    var dur = audio.duration;
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;
    var rect = bar.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    try {
      audio.currentTime = ratio * dur;
    } catch (err) {}
    syncProgress();
  }

  function hasCollapsePref() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  function loadCollapsed() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveCollapsed(v) {
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
      collapsePrefStored = true;
    } catch (e) {}
  }

  function clearCollapseTimers() {
    if (idleCollapseTimer) {
      window.clearTimeout(idleCollapseTimer);
      idleCollapseTimer = null;
    }
    if (trackPeekTimer) {
      window.clearTimeout(trackPeekTimer);
      trackPeekTimer = null;
    }
  }

  function setCollapsed(v, opts) {
    opts = opts || {};
    var collapsed = !!v;
    if (opts.persist) {
      preferredCollapsed = collapsed;
      saveCollapsed(collapsed);
    }
    if (dock) {
      dock.classList.toggle('is-collapsed', collapsed);
      dock.setAttribute('data-collapsed', collapsed ? '1' : '0');
      var fab = dock.querySelector('[data-bgm-expand]');
      if (fab) {
        fab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        fab.setAttribute('aria-label', collapsed ? '展开音乐播放器' : '音乐播放器已展开');
      }
      var collapseBtn = dock.querySelector('[data-bgm-collapse]');
      if (collapseBtn) collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    if (collapsed) setVolPopOpen(false);
    syncDock();
    if (!collapsed) {
      window.setTimeout(function () {
        syncMarquee();
      }, 360);
    }
  }

  function scheduleIdleAutoCollapse() {
    if (collapsePrefStored || peekingTrack) return;
    if (idleCollapseTimer) window.clearTimeout(idleCollapseTimer);
    idleCollapseTimer = window.setTimeout(function () {
      idleCollapseTimer = null;
      if (peekingTrack) return;
      setCollapsed(true, { persist: true });
    }, IDLE_COLLAPSE_MS);
  }

  function noteDockActivity() {
    if (!collapsePrefStored && dock && !dock.classList.contains('is-collapsed')) {
      scheduleIdleAutoCollapse();
    }
  }

  function peekExpandOnTrackChange() {
    if (!dock) return;
    clearCollapseTimers();
    peekingTrack = true;
    setCollapsed(false, { persist: false });
    trackPeekTimer = window.setTimeout(function () {
      trackPeekTimer = null;
      peekingTrack = false;
      setCollapsed(preferredCollapsed, { persist: false });
    }, TRACK_PEEK_MS);
  }

  function loadTrackIndex() {
    try {
      var n = parseInt(localStorage.getItem(TRACK_KEY), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    } catch (e) {}
    return 0;
  }

  function saveTrackIndex(i) {
    try {
      localStorage.setItem(TRACK_KEY, String(i));
    } catch (e) {}
  }

  function isPlaying() {
    return !!(audio && !audio.paused && !audio.ended);
  }

  function currentTrack() {
    return tracks[trackIndex] || tracks[0] || null;
  }

  function ensureHint() {
    hintEl = document.getElementById('bgmUnlockHint');
    if (hintEl) return hintEl;
    hintEl = document.createElement('button');
    hintEl.id = 'bgmUnlockHint';
    hintEl.type = 'button';
    hintEl.className = 'bgm-unlock-hint';
    hintEl.hidden = true;
    hintEl.innerHTML =
      '<span class="bgm-unlock-hint-icon" aria-hidden="true">♪</span>' +
      '<span class="bgm-unlock-hint-text">点击任意位置开启背景音乐</span>';
    document.body.appendChild(hintEl);
    hintEl.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      wantPlay = true;
      saveMuted(false);
      void playFromGesture();
    });
    return hintEl;
  }

  function syncHint() {
    var el = ensureHint();
    var show = wantPlay && !loadMuted() && !isPlaying();
    el.hidden = !show;
  }

  function applySoftMute() {
    if (!audio) return;
    audio.volume = softMuted ? 0 : volume;
  }

  function syncProgress() {
    if (!dock || !audio) return;
    var dur = audio.duration;
    var cur = audio.currentTime || 0;
    var ratio = dur && Number.isFinite(dur) && dur > 0 ? Math.min(1, cur / dur) : 0;
    var pct = ratio * 100;
    var fill = dock.querySelector('[data-bgm-fill]');
    if (fill) fill.style.width = pct.toFixed(2) + '%';
    var arc = dock.querySelector('[data-bgm-arc]');
    if (arc) {
      arc.style.strokeDasharray = String(ARC_LEN);
      arc.style.strokeDashoffset = String(ARC_LEN * (1 - ratio));
    }
  }

  function syncVolumeUI() {
    if (!dock) return;
    var v = softMuted ? 0 : volume;
    var pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    var fill = dock.querySelector('[data-bgm-vol-fill]');
    var thumb = dock.querySelector('[data-bgm-vol-thumb]');
    if (fill) fill.style.height = pct + '%';
    if (thumb) thumb.style.bottom = pct + '%';
    var volBtn = dock.querySelector('[data-bgm-vol]');
    if (volBtn) {
      var muted = v <= 0.001;
      volBtn.classList.toggle('is-muted', muted);
      volBtn.title = muted ? '音量（已静音）' : '音量';
      var on = volBtn.querySelector('[data-bgm-vol-on]');
      var off = volBtn.querySelector('[data-bgm-vol-off]');
      if (on) on.hidden = muted;
      if (off) off.hidden = !muted;
    }
  }

  function setVolPopOpen(open) {
    if (!dock) return;
    var pop = dock.querySelector('[data-bgm-vol-pop]');
    var btn = dock.querySelector('[data-bgm-vol]');
    if (pop) pop.classList.toggle('is-open', !!open);
    if (btn) btn.classList.toggle('is-open', !!open);
  }

  function isVolPopOpen() {
    var pop = dock && dock.querySelector('[data-bgm-vol-pop]');
    return !!(pop && pop.classList.contains('is-open'));
  }

  function volumeFromEvent(e) {
    var track = dock && dock.querySelector('[data-bgm-vol-track]');
    if (!track) return;
    var rect = track.getBoundingClientRect();
    var ratio = 1 - (e.clientY - rect.top) / rect.height;
    ratio = Math.max(0, Math.min(1, ratio));
    softMuted = false;
    saveVolume(ratio);
    if (ratio > 0.001 && wantPlay && !isPlaying()) void playFromGesture();
  }

  function syncMarquee() {
    if (!dock) return;
    var titleEl = dock.querySelector('[data-bgm-title]');
    var wrap = dock.querySelector('[data-bgm-title-wrap]');
    if (!titleEl || !wrap) return;
    titleEl.classList.remove('is-marquee');
    titleEl.style.removeProperty('--marquee-dist');
    void titleEl.offsetWidth;
    var overflow = titleEl.scrollWidth - wrap.clientWidth;
    if (overflow > 2) {
      titleEl.style.setProperty('--marquee-dist', overflow + 'px');
      titleEl.classList.add('is-marquee');
    }
  }

  function syncDock() {
    if (!dock) return;
    var playing = isPlaying();
    var t = currentTrack();
    dock.classList.toggle('is-playing', playing);
    dock.classList.toggle('is-paused', !playing);
    dock.classList.toggle('is-unavailable', !ready);

    var playIcon = dock.querySelector('[data-bgm-icon="play"]');
    var pauseIcon = dock.querySelector('[data-bgm-icon="pause"]');
    if (playIcon) playIcon.hidden = playing;
    if (pauseIcon) pauseIcon.hidden = !playing;

    var playBtn = dock.querySelector('[data-bgm-play]');
    if (playBtn) {
      playBtn.title = playing ? '暂停' : '播放';
      playBtn.setAttribute('aria-label', playBtn.title);
    }

    var nextBtn = dock.querySelector('[data-bgm-next]');
    if (nextBtn) {
      nextBtn.disabled = tracks.length < 2;
      nextBtn.title = tracks.length < 2 ? '歌单仅一首' : '下一首';
    }

    var titleText = (t && t.title) || 'BGM';
    var titleEl = dock.querySelector('[data-bgm-title]');
    if (titleEl) titleEl.textContent = titleText;

    var fab = dock.querySelector('[data-bgm-expand]');
    if (fab) fab.setAttribute('data-tip', titleText);

    var cover = dock.querySelector('[data-bgm-cover]');
    var coverImg = dock.querySelector('[data-bgm-cover-img]');
    if (cover && coverImg) {
      if (t && t.cover) {
        coverImg.src = t.cover;
        cover.classList.add('has-art');
      } else {
        coverImg.removeAttribute('src');
        cover.classList.remove('has-art');
      }
    }

    syncProgress();
    syncVolumeUI();
    window.requestAnimationFrame(syncMarquee);
    syncHint();
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = document.getElementById('siteBgm');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'siteBgm';
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      document.body.appendChild(audio);
    }
    applySoftMute();
    audio.loop = tracks.length < 2;
    audio.addEventListener('play', syncDock);
    audio.addEventListener('pause', syncDock);
    audio.addEventListener('playing', syncDock);
    audio.addEventListener('timeupdate', syncProgress);
    audio.addEventListener('loadedmetadata', syncProgress);
    audio.addEventListener('durationchange', syncProgress);
    audio.addEventListener('ended', function () {
      if (tracks.length >= 2) {
        void next(true);
      } else {
        syncDock();
      }
    });
    audio.addEventListener('error', function () {
      if (tracks.length >= 2) {
        trackIndex = (trackIndex + 1) % tracks.length;
        saveTrackIndex(trackIndex);
        loadCurrentTrack(wantPlay && !loadMuted());
      } else {
        ready = false;
        syncDock();
      }
    });
    return audio;
  }

  function encodeAudioSrc(src) {
    return String(src || '')
      .split('/')
      .map(function (seg) {
        return encodeURIComponent(seg);
      })
      .join('/');
  }

  function loadCurrentTrack(autoPlay) {
    var t = currentTrack();
    var a = ensureAudio();
    if (!t) {
      ready = false;
      syncDock();
      return;
    }
    a.loop = tracks.length < 2;
    a.src = encodeAudioSrc(t.src);
    a.load();
    a.addEventListener(
      'canplay',
      function () {
        ready = true;
        syncDock();
        if (autoPlay && wantPlay && !loadMuted()) void tryAutoplay();
      },
      { once: true }
    );
    syncDock();
  }

  function ensureAudioLoaded(a) {
    return new Promise(function (resolve) {
      if (a.src && a.readyState >= 2) {
        resolve();
        return;
      }
      var t = currentTrack();
      if (t) {
        a.src = encodeAudioSrc(t.src);
        a.load();
      }
      if (a.readyState >= 2) {
        resolve();
        return;
      }
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        a.removeEventListener('canplay', finish);
        resolve();
      };
      a.addEventListener('canplay', finish, { once: true });
      window.setTimeout(finish, 3000);
    });
  }

  function playFromGesture() {
    wantPlay = true;
    saveMuted(false);
    var a = ensureAudio();
    return ensureAudioLoaded(a)
      .then(function () {
        return a.play();
      })
      .then(function () {
        ready = true;
        syncDock();
      })
      .catch(function () {
        bindGestureUnlock();
        syncDock();
      });
  }

  function tryAutoplay() {
    if (loadMuted()) {
      wantPlay = false;
      syncDock();
      return Promise.resolve(false);
    }
    wantPlay = true;
    var a = ensureAudio();
    if (!a.src) {
      loadCurrentTrack(true);
      return Promise.resolve(false);
    }
    return a
      .play()
      .then(function () {
        ready = true;
        syncDock();
        return true;
      })
      .catch(function () {
        bindGestureUnlock();
        syncDock();
        return false;
      });
  }

  function bindGestureUnlock() {
    if (gestureBound) return;
    gestureBound = true;
    var onGesture = function () {
      if (!wantPlay || loadMuted() || isPlaying()) return;
      void playFromGesture();
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }

  function pause() {
    wantPlay = false;
    saveMuted(true);
    if (audio) audio.pause();
    syncDock();
  }

  function toggle() {
    if (isPlaying()) pause();
    else void playFromGesture();
  }

  function next(fromEnded) {
    if (!tracks.length) return Promise.resolve();
    if (tracks.length < 2) {
      var a0 = ensureAudio();
      a0.currentTime = 0;
      if (fromEnded || wantPlay) return playFromGesture();
      syncDock();
      return Promise.resolve();
    }
    trackIndex = (trackIndex + 1) % tracks.length;
    saveTrackIndex(trackIndex);
    var shouldPlay = fromEnded ? wantPlay && !loadMuted() : true;
    if (!fromEnded) {
      wantPlay = true;
      saveMuted(false);
    }
    loadCurrentTrack(false);
    peekExpandOnTrackChange();
    var a = ensureAudio();
    return new Promise(function (resolve) {
      var start = function () {
        if (shouldPlay) {
          a.play()
            .then(function () {
              ready = true;
              syncDock();
              resolve();
            })
            .catch(function () {
              bindGestureUnlock();
              syncDock();
              resolve();
            });
        } else {
          syncDock();
          resolve();
        }
      };
      if (a.readyState >= 2) start();
      else a.addEventListener('canplay', start, { once: true });
    });
  }

  function playOnIntro() {
    if (loadMuted()) {
      wantPlay = false;
      syncDock();
      return Promise.resolve();
    }
    wantPlay = true;
    bindGestureUnlock();
    ensureHint();
    return tryAutoplay();
  }

  function loadDockPos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) return p;
    } catch (e) {}
    return null;
  }

  function saveDockPos(left, top) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: left, top: top }));
    } catch (e) {}
  }

  function clampDockPos(left, top) {
    if (!dock) return { left: left, top: top };
    var pad = 8;
    var w = dock.offsetWidth || (dock.classList.contains('is-collapsed') ? 40 : 260);
    var h = dock.offsetHeight || (dock.classList.contains('is-collapsed') ? 40 : 64);
    var maxL = Math.max(pad, window.innerWidth - w - pad);
    var maxT = Math.max(pad, window.innerHeight - h - pad);
    return {
      left: Math.max(pad, Math.min(maxL, left)),
      top: Math.max(pad, Math.min(maxT, top)),
    };
  }

  function applyDockPos(left, top) {
    if (!dock) return;
    var p = clampDockPos(left, top);
    dock.style.left = p.left + 'px';
    dock.style.top = p.top + 'px';
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
    dock.classList.add('is-floating');
  }

  function restoreDockPos() {
    var saved = loadDockPos();
    if (!saved) return;
    applyDockPos(saved.left, saved.top);
  }

  function isDragHandleTarget(el) {
    if (!el || !dock) return false;
    // 收起态 FAB 优先响应点击展开，不在 pointerdown 立刻开拖（否则 preventDefault 会吞掉 click）
    if (el.closest('[data-bgm-expand]')) return false;
    if (
      el.closest(
        'button, input, a, [data-bgm-seek], [data-bgm-vol-wrap], [data-bgm-vol-pop], [data-bgm-vol-track], [data-bgm-collapse]'
      )
    ) {
      return false;
    }
    return !!el.closest('.bgm-dock-panel');
  }

  function expandDockFromFab() {
    clearCollapseTimers();
    peekingTrack = false;
    setCollapsed(false, { persist: true });
  }

  function buildDock() {
    dock = document.getElementById('bgmDock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'bgmDock';
      dock.className = 'bgm-dock is-paused';
      document.body.appendChild(dock);
    }

    dock.innerHTML =
      '<button type="button" class="bgm-dock-fab" data-bgm-expand aria-label="展开音乐播放器" data-tip="BGM">' +
      '<svg class="bgm-dock-fab-ring" viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle class="bgm-dock-fab-ring-track" cx="20" cy="20" r="18"></circle>' +
      '<circle class="bgm-dock-fab-ring-prog" data-bgm-arc cx="20" cy="20" r="18"></circle>' +
      '</svg>' +
      '<svg class="bgm-dock-fab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>' +
      '</svg>' +
      '</button>' +
      '<div class="bgm-dock-panel" data-bgm-drag>' +
      '<button type="button" class="bgm-dock-collapse" data-bgm-collapse title="收起" aria-label="收起播放器">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M6 12h12"/>' +
      '</svg>' +
      '</button>' +
      '<div class="bgm-dock-row">' +
      '<div class="bgm-dock-cover" data-bgm-cover>' +
      '<img class="bgm-dock-cover-img" data-bgm-cover-img alt="" />' +
      '<svg class="bgm-dock-cover-note" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>' +
      '</div>' +
      '<div class="bgm-dock-meta">' +
      '<div class="bgm-dock-title-wrap" data-bgm-title-wrap>' +
      '<span class="bgm-dock-title" data-bgm-title>BGM</span>' +
      '</div>' +
      '<div class="bgm-dock-bar" data-bgm-seek role="slider" aria-label="播放进度" tabindex="0">' +
      '<div class="bgm-dock-bar-fill" data-bgm-fill></div>' +
      '</div>' +
      '</div>' +
      '<div class="bgm-dock-controls">' +
      '<div class="bgm-vol-wrap" data-bgm-vol-wrap>' +
      '<button type="button" class="bgm-dock-btn vol" data-bgm-vol title="音量" aria-label="音量" aria-expanded="false">' +
      '<span data-bgm-vol-on aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.25-3.89v7.78A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></span>' +
      '<span data-bgm-vol-off hidden aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M16.5 12a4.5 4.5 0 01-1.69 3.48l1.43 1.43A6.48 6.48 0 0019 12a6.48 6.48 0 00-2.04-4.76l-1.4 1.4c.58.74.94 1.68.94 2.76zM4.27 3L3 4.27 7.73 9H3v4h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg></span>' +
      '</button>' +
      '<div class="bgm-vol-pop" data-bgm-vol-pop>' +
      '<div class="bgm-vol-track" data-bgm-vol-track role="slider" aria-label="音量" aria-valuemin="0" aria-valuemax="100" tabindex="0">' +
      '<div class="bgm-vol-fill" data-bgm-vol-fill></div>' +
      '<div class="bgm-vol-thumb" data-bgm-vol-thumb></div>' +
      '</div></div></div>' +
      '<button type="button" class="bgm-dock-btn" data-bgm-play title="播放" aria-label="播放">' +
      '<span data-bgm-icon="play" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' +
      '<span data-bgm-icon="pause" hidden aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg></span>' +
      '</button>' +
      '<button type="button" class="bgm-dock-btn next" data-bgm-next title="下一首" aria-label="下一首">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zm9-12v12h2V6h-2z"/></svg>' +
      '</button>' +
      '</div></div></div>';

    var old = document.getElementById('bgmToggle');
    if (old) old.remove();

    collapsePrefStored = hasCollapsePref();
    preferredCollapsed = collapsePrefStored ? loadCollapsed() : false;
    setCollapsed(preferredCollapsed, { persist: false });
    if (!collapsePrefStored) scheduleIdleAutoCollapse();

    restoreDockPos();

    if (!progressBound) {
      progressBound = true;
      var draggingVol = false;
      var fabPress = null;

      dock.addEventListener('click', function (e) {
        if (dragMoved) {
          dragMoved = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.target.closest('[data-bgm-collapse]')) {
          e.preventDefault();
          e.stopPropagation();
          setVolPopOpen(false);
          clearCollapseTimers();
          peekingTrack = false;
          setCollapsed(true, { persist: true });
          return;
        }
        if (e.target.closest('[data-bgm-expand]')) {
          e.preventDefault();
          e.stopPropagation();
          if (dock.classList.contains('is-collapsed')) expandDockFromFab();
          return;
        }
        noteDockActivity();
        if (e.target.closest('[data-bgm-vol]')) {
          e.preventDefault();
          e.stopPropagation();
          var open = !isVolPopOpen();
          setVolPopOpen(open);
          var btn = dock.querySelector('[data-bgm-vol]');
          if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          return;
        }
        if (e.target.closest('[data-bgm-vol-track]')) {
          e.preventDefault();
          e.stopPropagation();
          volumeFromEvent(e);
          return;
        }
        if (e.target.closest('[data-bgm-vol-pop]')) {
          e.stopPropagation();
          return;
        }
        if (e.target.closest('[data-bgm-play]')) {
          e.preventDefault();
          setVolPopOpen(false);
          toggle();
          return;
        }
        if (e.target.closest('[data-bgm-next]')) {
          e.preventDefault();
          setVolPopOpen(false);
          void next(false);
          return;
        }
        if (e.target.closest('[data-bgm-seek]')) {
          e.preventDefault();
          setVolPopOpen(false);
          seekFromEvent(e);
        }
      });

      dock.addEventListener('pointerdown', function (e) {
        noteDockActivity();
        // 音量气泡整块优先调音量，避免误拖整条播放器
        if (e.target.closest('[data-bgm-vol-pop], [data-bgm-vol-track]')) {
          draggingVol = true;
          draggingDock = false;
          dragMoved = false;
          fabPress = null;
          dock.classList.remove('is-dragging');
          e.preventDefault();
          e.stopPropagation();
          volumeFromEvent(e);
          var trackEl = dock.querySelector('[data-bgm-vol-track]');
          try {
            (trackEl || e.currentTarget).setPointerCapture(e.pointerId);
          } catch (err) {}
          return;
        }
        if (e.button !== 0) return;

        // 收起态：按下 FAB 先记点，移动超阈值再拖；松开未移动则展开
        var fabEl = e.target.closest('[data-bgm-expand]');
        if (fabEl && dock.classList.contains('is-collapsed')) {
          fabPress = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            moved: false,
          };
          dragMoved = false;
          try {
            fabEl.setPointerCapture(e.pointerId);
          } catch (errFab) {}
          return;
        }

        if (!isDragHandleTarget(e.target)) return;
        draggingDock = true;
        dragMoved = false;
        setVolPopOpen(false);
        var rect = dock.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        dock.classList.add('is-dragging');
        try {
          dock.setPointerCapture(e.pointerId);
        } catch (err2) {}
        e.preventDefault();
      });

      dock.addEventListener('pointermove', function (e) {
        if (draggingVol) {
          e.preventDefault();
          e.stopPropagation();
          volumeFromEvent(e);
          return;
        }
        if (fabPress && e.pointerId === fabPress.pointerId) {
          var dx = e.clientX - fabPress.x;
          var dy = e.clientY - fabPress.y;
          if (!fabPress.moved && dx * dx + dy * dy > 36) {
            fabPress.moved = true;
            draggingDock = true;
            dragMoved = true;
            setVolPopOpen(false);
            var rect = dock.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            dock.classList.add('is-dragging');
          }
          if (draggingDock) {
            applyDockPos(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
          }
          return;
        }
        if (!draggingDock) return;
        dragMoved = true;
        applyDockPos(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
      });

      function endDockDrag(e) {
        if (draggingVol) draggingVol = false;

        if (fabPress && (!e || e.pointerId === fabPress.pointerId)) {
          var wasDrag = fabPress.moved;
          fabPress = null;
          if (draggingDock) {
            draggingDock = false;
            dock.classList.remove('is-dragging');
            var rectDrag = dock.getBoundingClientRect();
            var pDrag = clampDockPos(rectDrag.left, rectDrag.top);
            applyDockPos(pDrag.left, pDrag.top);
            saveDockPos(pDrag.left, pDrag.top);
          }
          if (!wasDrag && dock.classList.contains('is-collapsed')) {
            expandDockFromFab();
          }
          return;
        }

        if (!draggingDock) return;
        draggingDock = false;
        dock.classList.remove('is-dragging');
        var rect = dock.getBoundingClientRect();
        var p = clampDockPos(rect.left, rect.top);
        applyDockPos(p.left, p.top);
        saveDockPos(p.left, p.top);
      }

      dock.addEventListener('pointerup', endDockDrag);
      dock.addEventListener('pointercancel', endDockDrag);

      document.addEventListener(
        'click',
        function (e) {
          if (!isVolPopOpen()) return;
          if (dock && dock.contains(e.target)) return;
          setVolPopOpen(false);
        },
        true
      );

      window.addEventListener('resize', function () {
        if (!dock) return;
        syncMarquee();
        if (dock.classList.contains('is-floating')) {
          var rect = dock.getBoundingClientRect();
          applyDockPos(rect.left, rect.top);
          saveDockPos(parseFloat(dock.style.left) || rect.left, parseFloat(dock.style.top) || rect.top);
        }
      });
    }

    syncDock();
  }

  function normalizeTracks(raw) {
    if (!raw || !Array.isArray(raw.tracks)) return FALLBACK_TRACKS.slice();
    var list = raw.tracks
      .filter(function (t) {
        return t && typeof t.src === 'string' && t.src.trim();
      })
      .map(function (t, i) {
        var item = {
          src: String(t.src).trim(),
          title: String(t.title || 'BGM ' + (i + 1)).trim() || 'BGM ' + (i + 1),
        };
        if (t.cover) item.cover = String(t.cover).trim();
        return item;
      });
    return list.length ? list : FALLBACK_TRACKS.slice();
  }

  async function loadPlaylist() {
    try {
      var res = await fetch(PLAYLIST_URL + '?t=' + Date.now());
      if (!res.ok) throw new Error('playlist ' + res.status);
      tracks = normalizeTracks(await res.json());
    } catch (e) {
      tracks = FALLBACK_TRACKS.slice();
    }
    trackIndex = loadTrackIndex() % tracks.length;
    if (audio) audio.loop = tracks.length < 2;
  }

  async function boot() {
    volume = loadVolume();
    buildDock();
    ensureHint();
    ensureAudio();
    bindGestureUnlock();
    await loadPlaylist();
    loadCurrentTrack(false);
    wantPlay = !loadMuted();
    if (wantPlay) {
      void tryAutoplay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WaveCalcBgm = {
    play: playFromGesture,
    pause: pause,
    toggle: toggle,
    next: function () {
      return next(false);
    },
    setVolume: saveVolume,
    getVolume: function () {
      return volume;
    },
    unlockAndPlay: playFromGesture,
    playOnIntro: playOnIntro,
    isPlaying: isPlaying,
    syncHint: syncHint,
    collapse: function () {
      setCollapsed(true, { persist: true });
    },
    expand: function () {
      setCollapsed(false, { persist: true });
    },
    isCollapsed: function () {
      return !!(dock && dock.classList.contains('is-collapsed'));
    },
  };
})();
