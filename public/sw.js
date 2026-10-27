/* 本地引擎包缓存（Service Worker）
 * /paddle/* 优先从浏览器 Cache Storage 读取（用户导入的离线引擎包），
 * 没有本地缓存时回退到服务器下载，并把下载结果顺手缓存，下次直接本地读取。
 */
(function () {
  'use strict';
  var PADDLE_CACHE = 'paddle-local-v1';

  self.addEventListener('install', function () {
    self.skipWaiting();
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys
              .filter(function (k) {
                return k !== PADDLE_CACHE;
              })
              .map(function (k) {
                return caches.delete(k);
              })
          );
        })
        .then(function () {
          return self.clients.claim();
        })
    );
  });

  self.addEventListener('fetch', function (event) {
    var url;
    try {
      url = new URL(event.request.url);
    } catch (e) {
      return;
    }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.indexOf('/paddle/') !== 0) return;

    event.respondWith(
      // ignoreSearch：引擎会带版本查询串请求（demo.js?v=20260809p），导入包按无查询串缓存
      caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(event.request).then(function (res) {
          if (res && res.ok) {
            var clone = res.clone();
            caches
              .open(PADDLE_CACHE)
              .then(function (cache) {
                return cache.put(event.request, clone);
              })
              .catch(function () {});
          }
          return res;
        });
      })
    );
  });
})();
