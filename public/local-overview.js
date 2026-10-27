/* UI-only overview navigation. Existing calculator sections stay mounted. */
(()=>{
const main=document.getElementById('main');if(!main)return;
let current='damage',pending=false;
const labels={damage:'伤害总览',compare:'配置对比',simulate:'词条模拟'};
function select(page,key){
 current=key;page.dataset.overviewView=key;
 page.querySelectorAll('[data-overview-tab]').forEach(b=>{const active=b.dataset.overviewTab===key;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
 page.querySelectorAll('[data-overview-panel]').forEach(p=>{p.hidden=p.dataset.overviewPanel!==key;});
}
function mark(el,key){if(!el)return;el.dataset.overviewPanel=key;el.setAttribute('role','tabpanel');el.setAttribute('aria-labelledby','overview-tab-'+key);}
function help(section){
 if(!section||section.querySelector(':scope > .local-overview-help'))return;
 const notes=[...section.children].filter(e=>e.matches('p.hint'));
 if(!notes.length)return;
 const details=document.createElement('details');details.className='local-overview-help';
 const summary=document.createElement('summary');summary.textContent='使用说明';details.append(summary);notes[0].before(details);notes.forEach(n=>details.append(n));
}
function sync(){
 main.querySelectorAll('.local-calc-tabs [data-calc-view]').forEach((b,i)=>{
  if(b.querySelector('.local-step-number'))return;
  const label=b.textContent.replace(/^[①②]\s*/,''),num=document.createElement('span'),text=document.createElement('span');
  num.className='local-step-number';num.textContent=String(i+1);text.className='local-step-label';text.textContent=label;b.replaceChildren(num,text);
 });
 const page=main.querySelector('.overview-page');if(!page)return;
 if(!page.querySelector('.local-overview-tabs')){
  const nav=document.createElement('div');nav.className='local-overview-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','数据总览视图');
  Object.entries(labels).forEach(([key,label])=>{const b=document.createElement('button');b.type='button';b.id='overview-tab-'+key;b.dataset.overviewTab=key;b.setAttribute('role','tab');b.textContent=label;nav.append(b);});
  page.querySelector('.export-page-header').after(nav);
 }
 const grid=page.querySelector('.overview-grid,.overview-stack');if(grid){grid.classList.add('local-overview-content');[...grid.children].forEach(col=>mark(col,col.querySelector('.export-cfg-compare')?'compare':'damage'));}
 mark(page.querySelector('.overview-cycle-section'),'damage');mark(page.querySelector('.echo-sub-sim'),'simulate');
 const cycle=page.querySelector('.overview-cycle-section');if(cycle){
  const single=cycle.querySelectorAll('tbody tr').length===1;cycle.classList.toggle('local-round-details',single);
  const roundData=window.__WC?.getTeamCycleTableRows?.()||[];
  cycle.querySelectorAll('tbody tr').forEach((row,i)=>{
   const round=row.querySelector('.ov-round');if(round)round.dataset.roundNumber=String(i+1).padStart(2,'0');
   row.querySelectorAll('.ov-member:not(.ov-member-unowned)').forEach((m,index)=>{
    const api=window.__WC,member=api?.state?.members?.[index];const def=member?.characterId?api?.findCharSkillDef?.(member.characterId):null;
    if(!m.querySelector('.local-round-avatar')&&def&&api?.renderCharAvatarCard){const avatar=document.createElement('span');avatar.className='local-round-avatar';avatar.innerHTML=api.renderCharAvatarCard(def,{plain:true});m.prepend(avatar);}
    const damage=m.querySelector('.ov-member-dmg');if(!damage)return;
    m.classList.add('local-round-member-rich');
    let metrics=m.querySelector('.local-round-metrics');
    if(!metrics){
     metrics=document.createElement('div');metrics.className='local-round-metrics';
     for(const [key,label] of [['damage','总伤'],['dps','单人 DPS'],['energy','总能量']]){
      const cell=document.createElement('div');cell.className='local-round-metric';cell.dataset.metric=key;
      const caption=document.createElement('span');caption.className='local-round-metric-label';caption.textContent=label;
      const value=key==='damage'?damage:document.createElement('strong');value.classList.add('local-round-metric-value');
      cell.append(caption,value);metrics.append(cell);
     }
     m.append(metrics);
    }
    const data=roundData[i],total=data?.members?.[index]?.total;
    const dps=Number.isFinite(total)&&data.axis>0?total/data.axis:null;
    const energy=member?(member.cycleConfig?.enabled?api.computeRoundTotalEnergy?.(member,i):api.computeMemberTotalEnergy?.(member)):null;
    for(const [key,value] of [['dps',Number.isFinite(dps)?Math.round(dps).toLocaleString():'—'],['energy',Number.isFinite(energy)?energy.toFixed(2):'—']]){
     const el=metrics.querySelector('[data-metric="'+key+'"] .local-round-metric-value');if(el.textContent!==value)el.textContent=value;
    }
    metrics.querySelector('[data-metric="dps"]').title='该角色本轮总伤 ÷ 本轮轴长（含归属该角色的特殊技能）';
    metrics.querySelector('[data-metric="energy"]').title='本轮个人总回能，包含自身回能与队友提供的能量；沿用详细计算口径';
   });
  });
  const title=cycle.querySelector('.export-region-title');if(title&&single&&title.textContent!=='队伍输出')title.textContent='队伍输出';
  cycle.querySelectorAll('tbody tr').forEach(row=>{const members=[...row.querySelectorAll('.ov-member')];const amounts=members.map(m=>Number(m.querySelector('.ov-member-dmg')?.dataset.rawDamage ?? (m.querySelector('.ov-member-dmg')?.textContent||'0').replaceAll(',',''))||0);const total=amounts.reduce((a,b)=>a+b,0);members.forEach((m,i)=>{m.style.setProperty('--contribution',total?((amounts[i]/total)*100).toFixed(2)+'%':'0%');});});
  if(!single&&!cycle.querySelector('details')){const wrap=cycle.querySelector('.overview-cycle-table-wrap');if(wrap){const d=document.createElement('details');d.className='local-round-details';d.open=true;const s=document.createElement('summary');s.textContent='各轮输出 · '+cycle.querySelectorAll('tbody tr').length+' 轮';d.append(s);wrap.before(d);d.append(wrap);}}
 }
 for(const s of page.querySelectorAll('.export-data-summary,.export-cfg-compare,.echo-sub-sim'))help(s);
 const rank=page.querySelector('.export-summary-priority h4');if(rank&&rank.textContent!=='技能伤害排行')rank.textContent='技能伤害排行';
 select(page,current);
}
main.addEventListener('click',e=>{const b=e.target.closest('[data-overview-tab]');if(b)select(b.closest('.overview-page'),b.dataset.overviewTab);});
main.addEventListener('keydown',e=>{const b=e.target.closest('[data-overview-tab]');if(!b||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const list=[...b.parentElement.children],i=list.indexOf(b),next=e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;list[next].click();list[next].focus();});
const observer=new MutationObserver(()=>{observer.disconnect();try{sync();}finally{observer.observe(main,{childList:true,subtree:true});}});
sync();observer.observe(main,{childList:true,subtree:true});
})();
