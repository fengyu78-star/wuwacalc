/* 非商业源码本地版：与正式账号服务分离。 */
(function () {
  function showNotice() {
    var el = document.createElement('div');
    el.id = 'source-edition-notice';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483646;max-width:calc(100vw - 24px);padding:8px 12px;background:#17202d;color:#fff;border:1px solid #778899;border-radius:6px;font:12px/1.6 system-ui;pointer-events:none';
    el.textContent = '本地源码版 · 游客使用 · 云端及AI接口未启用';
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showNotice);
  else showNotice();
})();
