/* Mobile shell: presentation and navigation only; existing controls own application state. */
(function () {
  var html = document.documentElement;
  var compact = window.matchMedia('(max-width: 960px)');
  var titles = {home:'鸣算屋', public:'公开方案库', profile:'个人主页', setup:'配置选择', buff:'Buff 检查', axis:'编辑轴', calc:'详细计算', check:'计算检查', overview:'数据总览', export:'数据导出', guides:'角色榜单', teams:'队伍数据演变', card:'角色卡片'};
  var overlayRestoring=false, overlayClose='', overlayTimer=0;
  var overlayRules=[['data-pdb-detail','[data-pdb-detail-close]'],['data-pdb-filter-open','[data-pdb-filter-cancel]'],['data-pdb-review-open','[data-pdb-review-close]'],['data-pdb-report','[data-pdb-report-close]']];
  var current = '', applying = false, scheduled = false, ready = false, moves = [], startAttempts = 0;
  function one(s) { return document.querySelector(s); }
  function click(s) { var el=one(s); if (el) { el.click(); return true; } return false; }
  function isCompact() { return compact.matches; }
  function closeMenu() { if(document.body.classList.contains('sidenav-mobile-open')) click('#sidenavMobileToggle'); }
  function hideHome() { var h=one('#wc-mobile-home'); if(h)h.remove(); document.body.classList.remove('wc-mobile-home-on'); }
  function showHome() {
    if(one('#wc-mobile-home'))return;
    var host=document.createElement('main'); host.id='wc-mobile-home'; host.className='wc-mh-page';
    host.innerHTML='<section class="wc-mh-head"><p class="wc-mh-kicker">WAVECALC · 鸣潮配队计算</p><h1>方案与计算</h1><p class="wc-mh-sub">发现配队方案，查看伤害表现，制作你的数据卡片。</p></section>'+
      '<div class="wc-mh-links"><button type="button" class="wc-mh-card wc-mh-primary" data-mh-pubdb><span class="wc-mh-symbol" aria-hidden="true">▤</span><span><b>公开方案库</b><small>浏览配队 · 筛选方案 · 查看详情</small></span><span aria-hidden="true">→</span></button>'+
      '<a class="wc-mh-card" href="leaderboard.html"><span class="wc-mh-symbol" aria-hidden="true">01</span><span><b>角色榜单</b><small>基础轴 / 进阶轴 / 椰果轴</small></span><span aria-hidden="true">→</span></a>'+
      '<button type="button" class="wc-mh-card" data-mh-workspace><span class="wc-mh-symbol" aria-hidden="true">＋</span><span><b>计算工作台</b><small>配置角色、检查 Buff、编辑时间轴</small></span><span aria-hidden="true">→</span></button>'+
      '<a class="wc-mh-card" href="mobile-card-studio.html"><span class="wc-mh-symbol" aria-hidden="true">▧</span><span><b>出图</b><small>搜方案码 · 全队与单角色卡片</small></span><span aria-hidden="true">→</span></a></div>'+
      '<p class="wc-mh-tip">通过左上角菜单切换页面；点击顶部标题回到首页。</p>';
    var wrap=one('body > .wrap'); if(wrap)wrap.insertBefore(host,one('#teamBar')||wrap.firstChild);else document.body.appendChild(host);
    document.body.classList.add('wc-mobile-home-on');
  }
  function readRoute() {
    var b=document.body;
    if(b.classList.contains('public-db-open'))return 'public';
    if(b.classList.contains('user-profile-open'))return 'profile';
    if(b.classList.contains('public-section-open'))return one('[data-nav-public-placeholder].active')?.dataset.navPublicPlaceholder||'teams';
    if(one('#wc-mobile-home'))return 'home';
    var active=one('#workspacePhaseBar .workspace-phase-btn.active');
    if(active&&titles[active.dataset.workspacePhase])return active.dataset.workspacePhase;
    var layout=one('#workspaceLayout');
    if(layout)for(var k of ['setup','buff','axis','calc','check','overview','export'])if(layout.classList.contains('phase-'+k))return k;
    return 'setup';
  }
  function remember(route,replace) {
    if(!html.hasAttribute('data-wc-mobile')&&!isCompact())return;
    var url=new URL(location.href);url.searchParams.set('wc_view',route);
    var state=Object.assign({},history.state||{}, {wcMobileView:route});delete state.wcMobileOverlay;overlayClose='';
    history[replace?'replaceState':'pushState'](state,'',url.pathname+url.search+url.hash);
  }
  function apply(route) {
    if(!titles[route])route='home';
    applying=true;hideHome();closeMenu();
    if(route==='home') { click('#workspacePhaseBar [data-workspace-phase="setup"]'); showHome(); }
    else if(route==='public')click('[data-nav-public-db]');
    else if(route==='profile')click('#appUserBtn');
    else if(route==='guides'||route==='teams')click('[data-nav-public-placeholder="'+route+'"]');
    else if(route==='card')click('[data-open-character-card]');
    else click('#workspacePhaseBar [data-workspace-phase="'+route+'"]');
    current=route;paintTitle(route);applying=false;window.scrollTo(0,0);
  }
  function paintTitle(route) {
    var title=one('.wc-mobile-title');if(title&&title.dataset.view!==route){title.dataset.view=route;title.textContent=titles[route]||'鸣算屋';}
  }
  function move(el,host) {
    if(!el||!host||el.parentElement===host)return;
    if(!moves.some(function(x){return x.el===el;})){var mark=document.createComment('mobile control position');el.before(mark);moves.push({el:el,mark:mark});}
    host.appendChild(el);
  }
  function adapt() {
    html.toggleAttribute('data-wc-compact',isCompact());
    if(isCompact()&&html.dataset.configTheme&&html.dataset.theme!==html.dataset.configTheme)html.dataset.theme=html.dataset.configTheme;
    var nav=one('#workspacePhaseBar .app-sidenav'),header=one('header.app-topbar');
    if(!nav||!header)return;
    if(!one('.wc-mobile-title')){var title=document.createElement('button');title.type='button';title.className='wc-mobile-title';title.dataset.mhHome='';title.title='返回手机首页';header.appendChild(title);}
    if(!one('.wc-mobile-nav-home')){var home=document.createElement('button');home.type='button';home.className='wc-mobile-nav-home';home.dataset.mhHome='';home.textContent='← 手机首页';nav.prepend(home);}
    var tools=one('.wc-mobile-tools');if(!tools){tools=document.createElement('div');tools.className='wc-mobile-tools';tools.setAttribute('aria-label','语言与工具');nav.appendChild(tools);}
    if(isCompact()){
      move(one('.app-topbar-tools'),tools);move(one('#appNotifyBtn'),tools);move(one('#configThemeSwitcher'),tools);
      var notify=one('#appNotifyBtn');if(notify&&!notify.querySelector('.wc-mobile-notify-label')){var label=document.createElement('span');label.className='wc-mobile-notify-label';label.textContent='消息通知';notify.appendChild(label);}
    }else{
      moves.forEach(function(x){if(x.mark.parentNode&&x.el.parentNode!==x.mark.parentNode)x.mark.after(x.el);});
      closeMenu();
    }
    paintTitle(current||readRoute());
  }
  function sync() {
    scheduled=false;adapt();if(!ready||applying)return;
    var next=readRoute();
    if(one('#wc-mobile-home')&&(next==='public'||next==='profile'||next==='teams'||next==='guides'))hideHome();
    if(next!==current){current=next;paintTitle(next);remember(next,false);window.scrollTo(0,0);}
  }
  function queue() { if(!scheduled){scheduled=true;requestAnimationFrame(sync);} }
  function start() {
    if(ready)return;
    if(!one('#workspacePhaseBar [data-workspace-phase="setup"]')){
      if(++startAttempts<150)setTimeout(start,200);
      else {var message=one('#wc-mobile-boot p');if(message)message.textContent='页面尚未准备完成，请检查网络后重新加载。';}
      return;
    }
    adapt();
    var mobile=html.hasAttribute('data-wc-mobile');
    if(mobile){
      document.body.classList.remove('intro-open');html.classList.remove('intro-pending');one('#siteIntro')?.remove();
      var requested=new URL(location.href).searchParams.get('wc_view');
      var alreadyOpen=document.body.matches('.public-db-open,.user-profile-open,.public-section-open');
      if(requested&&titles[requested])apply(requested);else if(!alreadyOpen)showHome();
      current=readRoute();remember(current,true);
    }else current=readRoute();
    html.setAttribute('data-wc-mobile-ready','');one('#wc-mobile-boot')?.remove();ready=true;paintTitle(current);
    new MutationObserver(queue).observe(document.body,{attributes:true,attributeFilter:['class']});
    var layout=one('#workspaceLayout');if(layout)new MutationObserver(queue).observe(layout,{attributes:true,attributeFilter:['class']});
    var nav=one('#workspacePhaseBar');if(nav)new MutationObserver(queue).observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  document.addEventListener('click',function(e){
    var t=e.target;if(!t.closest)return;
    if(t.closest('[data-config-theme]'))queue();
    if((html.hasAttribute('data-wc-mobile')||isCompact())&&!overlayRestoring){
      for(var rule of overlayRules){
        var trigger=t.closest('['+rule[0]+']');
        if(trigger){
          var selector='['+rule[0]+'="'+CSS.escape(trigger.getAttribute(rule[0]))+'"]';
          (function(openSelector,closeSelector){
            clearTimeout(overlayTimer);
            overlayTimer=setTimeout(function(){
              var closer=one(closeSelector);
              if(!closer||!closer.getBoundingClientRect().width)return;
              overlayClose=closeSelector;
              history.pushState(Object.assign({},history.state||{},{wcMobileOverlay:{open:openSelector,close:closeSelector}}),'',location.href);
            },100);
          })(selector,rule[1]);
          break;
        }
      }
      if(overlayClose&&(t.matches('[data-pdb-detail-overlay],[data-pdb-report-overlay],[data-pdb-review-overlay]')||t.closest(overlayClose+',[data-pdb-search-go],[data-pdb-report-cancel],[data-pdb-review-cancel]'))){
        overlayClose='';
        if(history.state&&history.state.wcMobileOverlay)history.back();
      }
    }
    if(t.closest('[data-mh-home]')){e.preventDefault();apply('home');remember('home',false);window.scrollTo(0,0);return;}
    if(t.closest('[data-mh-pubdb]')){e.preventDefault();hideHome();click('[data-nav-public-db]');closeMenu();queue();return;}
    if(t.closest('[data-mh-workspace],[data-mh-export]')){e.preventDefault();hideHome();click('#workspacePhaseBar [data-workspace-phase="'+(t.closest('[data-mh-export]')?'export':'setup')+'"]');queue();return;}
    if(t.closest('[data-workspace-phase],[data-nav-public-db],[data-nav-public-placeholder],[data-open-character-card],#appUserBtn')){if(isCompact())window.scrollTo(0,0);hideHome();setTimeout(function(){closeMenu();queue();},0);}
  },true);
  window.addEventListener('popstate',function(){
    if(!html.hasAttribute('data-wc-mobile')&&!isCompact())return;
    overlayRestoring=true;clearTimeout(overlayTimer);
    var saved=history.state&&history.state.wcMobileOverlay;
    if(overlayClose){click(overlayClose);overlayClose='';}
    var route=new URL(location.href).searchParams.get('wc_view');
    if(route&&titles[route]&&route!==current)apply(route);
    if(saved){click(saved.open);overlayClose=saved.close;}
    setTimeout(function(){overlayRestoring=false;},0);
  });
  window.addEventListener('pageshow',queue);
  if(compact.addEventListener)compact.addEventListener('change',queue);else compact.addListener(queue);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
