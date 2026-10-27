(()=>{
const main=document.querySelector('#main');if(!main)return;
function sync(){const board=main.querySelector('.team-axis-board');if(!board)return;
board.querySelectorAll('.skill-type-tabs button').forEach(button=>{
 const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode()))if(node.textContent.includes('未分类'))node.textContent=node.textContent.replace('未分类','声骸技能');
});
const bar=board.querySelector('.axis-board-toolbar');if(!bar)return;
const right=bar.querySelector('.toolbar-right');
const left=bar.querySelector('.toolbar-left');
if(left){
 let advanced=left.querySelector('.local-axis-advanced');
 if(!advanced){advanced=document.createElement('div');advanced.className='local-axis-advanced';const caption=document.createElement('span');caption.textContent='高级工具';advanced.append(caption);left.append(advanced);}
 for(const selector of ['[data-rt-deep]','[data-axm-open]']){const button=left.querySelector(selector);if(button&&button.parentElement!==advanced)advanced.append(button);}
}
if(board.dataset.localAxis)return;board.dataset.localAxis='1';
const clear=bar.querySelector('[data-axis-clear-active]');if(clear&&right){const menu=document.createElement('details');menu.className='local-axis-more';const label=document.createElement('summary');label.textContent='更多';const body=document.createElement('div');clear.textContent='清空当前角色';body.append(clear);menu.append(label,body);right.prepend(menu);clear.addEventListener('click',()=>menu.open=false);}
const cycle=board.querySelector('.axis-cycle-bar');if(cycle){const help=document.createElement('span');help.className='local-axis-help';help.textContent='点击技能添加 · Shift 指定插入 · 拖动调整 · 右键更多';cycle.append(help);}
}
new MutationObserver(sync).observe(main,{childList:true,subtree:true});sync();})();