/* Standalone rendering prototype. Production data must enter through a reviewed adapter. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), W=1920,H=1080;
  const C={bg:'#11191f',ink:'#eeece5',muted:'#b8bdc2',gold:'#d2b887',pale:'#f7e8c3',line:'#b5aa95',red:'#f17a7c',purple:'#b7a1e3',blue:'#8fbce7',amber:'#ddbe80',green:'#a0c5ac'};
  let currentData=null;
  const energyRounds=new Map();
  const portraitDrafts=new Map();
  let energyUpdating=false,energyVersion=0;
  const state={plan:'live',user:'',code:'',axis:'',zoom:100,shade:88,fontSize:100,titleFont:'serif',texture:18,showMates:true,showTop:true,artData:null,artX:0,artY:0,resolution:2};
  let stage,layer,artNode,artGroup,artImage,images={},ready=false,exporting=false,loadToken=0;
  const serif=()=>'CardSerif, SimSun, serif';
  const sans='CardSerif, SimSun, serif';
  const num='CardSerif, SimSun, serif';
  const fmt=v=>(v/10000).toFixed(2)+'w';
  const grade=()=>currentData.grade;
  function summarize(data){
    const map=new Map();let teamTotal=0,characterTotal=0,directTotal=0,fixedTotal=0;
    for(const row of data.records){
      teamTotal+=row.expected;
      if(row.characterId!==data.character.id)continue;
      characterTotal+=row.expected;
      if(row.source==='特殊技能')fixedTotal+=row.expected;else directTotal+=row.expected;
      const key=row.skillId;
      if(!map.has(key))map.set(key,{id:key,name:row.name,source:row.source,expected:0,critical:0,count:0});
      const item=map.get(key);item.expected+=row.expected;item.critical=item.critical===null||row.critical===null?null:item.critical+row.critical;item.count++;
    }
    const skills=[...map.values()].sort((a,b)=>b.expected-a.expected||a.id.localeCompare(b.id));
    return {teamTotal,characterTotal,directTotal,fixedTotal,dps:teamTotal/data.axis.seconds,skills,top:skills.slice(0,3)};
  }
  function add(node,parent=layer){parent.add(node);return node;}
  function rect(x,y,width,height,props={},parent=layer){return add(new Konva.Rect({x,y,width,height,listening:false,...props}),parent);}
  function line(x1,y1,x2,y2,opacity=.35,color=C.line,parent=layer){return add(new Konva.Line({points:[x1,y1,x2,y2],stroke:color,strokeWidth:1,opacity,listening:false}),parent);}
  function text(value,x,y,width,size=24,props={},parent=layer){
    const {numeric=false,title=false,scale=false,...rest}=props;
    const fontSize=size*(scale?state.fontSize/100:1);
    const n=new Konva.Text({x,y,width,text:String(value),fontSize,fontFamily:numeric?num:title?serif():sans,fill:C.ink,wrap:'none',ellipsis:true,listening:false,...rest});
    const min=fontSize*.69;
    while((!props.wrap||props.wrap==='none') && n.getTextWidth()>width && n.fontSize()>min)n.fontSize(n.fontSize()-1);
    return add(n,parent);
  }
  function metalLine(x1,y1,x2,y2,opacity=.72,parent=layer){
    return add(new Konva.Line({points:[x1,y1,x2,y2],strokeWidth:1.25,opacity,listening:false,strokeLinearGradientStartPoint:{x:x1,y:y1},strokeLinearGradientEndPoint:{x:x2,y:y2},strokeLinearGradientColorStops:[0,'#70634d',.2,'#c2ab80',.47,'#e6d6b6',.7,'#b6ac99',1,'#736957']}),parent);
  }
  function metalFrame(x,y,width,height,radius=12,opacity=.65){
    rect(x,y,width,height,{cornerRadius:radius,strokeWidth:1.1,opacity,strokeLinearGradientStartPoint:{x:0,y:0},strokeLinearGradientEndPoint:{x:width,y:height},strokeLinearGradientColorStops:[0,'#a99a7c',.2,'#ded2b8',.5,'#817460',.8,'#d4c3a4',1,'#9e9075']});
    rect(x+2,y+2,width-4,height-4,{cornerRadius:radius-1,stroke:'#090d11',strokeWidth:1,opacity:.65});
  }
  function sectionTitle(label,x,y,width){
    const title=text(label,x,y,width,29,{title:true,fill:C.pale});
    addImage('nativeTitleEdge',x-18,y-2,14,31,{opacity:.62});
    const ends={'基础面板':1008,'个人声骸练度':1880,'声骸配置':1580,'技能伤害 TOP 3':1328,'下一步提升':1880};
    const start=x+title.getTextWidth()+28,end=ends[label];
    if(end>start){
      metalLine(start,y+16,end,y+16,.44);
      addImage('nativeTitleLine',start,y-7,end-start,48,{opacity:.72});
      addImage('nativeTitleMark',start-6,y+5,49,22,{opacity:.82});
    }
  }
  function drawTexture(){
    // Artwork is a transparent decoration layer, never a flattened card or data image.
    const g=add(new Konva.Group({clipX:576,clipY:0,clipWidth:1344,clipHeight:943,listening:false}));
    addImage('ornament',0,0,W,H,{parent:g,opacity:state.texture/100*.75});
  }
  function drawGeometry(){
    // Vector ornaments share the export canvas. Keep portrait centre and text bands clear.
    const g=add(new Konva.Group({name:'background-geometry',listening:false,clipFunc(ctx){
      ctx.rect(0,0,88,730);ctx.rect(492,0,84,730);
      ctx.rect(576,0,1344,30);ctx.rect(576,328,1344,48);
      ctx.rect(576,736,1344,17);ctx.rect(576,30,28,913);ctx.rect(1894,30,26,913);
    }}));
    const silver='#becbd2';
    const path=(points,opacity=.09,color=silver,closed=false)=>add(new Konva.Line({points,closed,stroke:color,strokeWidth:1.2,opacity,listening:false}),g);
    // Broken orbital arcs and radial ticks, asymmetrically centred behind the portrait.
    for(const [radius,start,end]of [[300,-155,25],[326,35,166],[348,-82,17]]){
      const points=[];for(let a=start;a<=end;a+=2){const t=a*Math.PI/180;points.push(300+Math.cos(t)*radius,330+Math.sin(t)*radius);}path(points,.095);
    }
    for(let a=-160;a<=165;a+=10){if(a>0&&a<45)continue;const t=a*Math.PI/180,outer=a%30===0?340:334;path([300+Math.cos(t)*326,330+Math.sin(t)*326,300+Math.cos(t)*outer,330+Math.sin(t)*outer],.1);}
    path([18,174,18,42,42,18,166,18],.1);path([510,24,552,24,560,32,560,156],.1,C.gold);
    path([588,84,588,20,730,20,744,6,878,6],.09);
    path([1650,16,1880,16,1908,44,1908,180],.1,C.gold);
    path([1760,748,1867,748,1907,708,1907,600],.09);
    for(const [x,y,size]of [[45,670,12],[534,182,9],[1825,353,10],[987,351,5]])path([x,y-size,x+size,y,x,y+size,x-size,y,x,y-size],.1,C.gold);
    for(const [x,y]of [[39,126],[539,609],[599,352],[1880,747]]){path([x-6,y,x+6,y],.1);path([x,y-6,x,y+6],.1);}
    for(let i=0;i<6;i++)path([28+i*9,703,36+i*9,691],.08);
    for(let i=0;i<7;i++)path([1690+i*12,362,1697+i*12,350],.08);
    path([1090,350,1150,350,1160,360,1314,360],.065);
    // Etched joins sit in the gutters, outside every panel's text and artwork.
    const joins=add(new Konva.Group({name:'panel-joins',listening:false}));
    const etch=(points,opacity=.23,color=C.gold)=>add(new Konva.Line({points,stroke:color,strokeWidth:1,opacity,listening:false}),joins);
    const diamond=(x,y)=>etch([x,y-3,x+3,y,x,y+3,x-3,y,x,y-3],.34);
    for(const y of [370,744,939]){
      for(const [a,b]of [[617,825],[1010,1286],[1577,1882]]){
        etch([a,y,b,y],.14,silver);
        etch([a,y,a+28,y],.32);etch([b-28,y,b,y],.32);
      }
      for(const x of [909,1430]){diamond(x,y);etch([x-25,y,x-9,y],.22);etch([x+9,y,x+25,y],.22);}
    }
    const ew=(1290-4*13)/5;
    for(let i=0;i<4;i++){
      const x=604+ew+i*(ew+13)+6.5;
      etch([x,394,x,453],.15,silver);etch([x,595,x,716],.15,silver);
      diamond(x,490);diamond(x,724);
      for(let j=0;j<6;j++)etch([x-3,516+j*7,x+3,510+j*7],.17,silver);
      etch([x-2,397,x-2,414],.31);
    }
    etch([587,48,587,307,592,312,592,702,587,707,587,916],.25);
    for(const y of [96,274,411,636,866]){etch([584,y,590,y],.28,silver);etch([584,y+5,588,y+5],.18,silver);}
    etch([1355,774,1355,819],.19,silver);diamond(1355,840);etch([1355,861,1355,918],.19,silver);
  }
  const attributeIcon={'攻击':'statAtk','固定攻击':'statAtk','生命':'statHp','固定生命':'statHp','防御':'statDef','固定防御':'statDef','暴击率':'statCritRate','暴击伤害':'statCritDmg','共鸣效率':'statEnergy','共鸣技能':'statSkill','共鸣解放':'statLiberation','重击':'statHeavy','普攻':'statBasic'};
  function statIcon(name,x,y,size){
    const key=attributeIcon[name];
    if(key)contain(key,x,y,size,size);
  }
  function fitText(value,x,y,width,size,props={}){
    const node=text(value,x,y,width,size,{...props,ellipsis:false});
    while(node.getTextWidth()>width&&node.fontSize()>16)node.fontSize(node.fontSize()-1);
    return node;
  }
  function renderAdvice(data){
    metalFrame(1362,753,532,181,10,.5);sectionTitle('下一步提升',1384,754,480);
    const e=data.energy||{},x=1384,width=488;
    const basis=Number.isFinite(e.value)&&e.cost>0?'按第'+e.selectedRound+'轮判定：回能 '+Number(e.value.toFixed(2))+' / 需求 '+e.cost:e.cost===0?'按第'+e.selectedRound+'轮判定：大招无需共鸣能量':'按第'+(e.selectedRound||1)+'轮判定：回能数据待确认';
    fitText(basis,x,794,width,19,{fill:C.pale});
    if(e.status==='deficit'){
      text(e.message,x,824,width,20,{fill:C.red});
      const extra=e.additionalEfficiency;
      text(Number.isFinite(extra)?'还需 +'+extra.toFixed(1)+'% 共鸣效率':energyUpdating?'正在更新本轮共鸣效率建议…':data.echoScoreReady?'当前回能不足，需检查技能轴产能':'计算后给出需补充的共鸣效率',x,854,width,22,{fill:C.pale});
      text(Number.isFinite(extra)?'面板 '+Number(e.efficiency.toFixed(1))+'% → 最低 '+Number(e.targetEfficiency.toFixed(1))+'%':'暂不建议牺牲充能换输出',x,885,width,18,{fill:C.muted});
    }else{
      text(e.message||'回能数据待确认',x,822,width,17,{fill:e.status==='minimum'?C.amber:C.muted,wrap:'char',height:39,lineHeight:1.1,ellipsis:false});
      const priorities=data.marginalPriority?.slice(0,3)||[];
      if(data.echoScoreReady&&priorities.length){
        priorities.forEach((item,i)=>{
          const y=860+i*19;
          text(String(i+1).padStart(2,'0'),x,y,26,15,{numeric:true,fill:i===0?C.gold:C.muted});
          text(item.label.replace('暴伤','暴击伤害').replace(/%$/,'')+' +'+item.step+item.unit,x+32,y,250,17,{fill:i===0?C.pale:C.ink});
          text('总伤 +'+(item.liftPct<.01?'<0.01':item.liftPct.toFixed(2))+'%',x+284,y,204,17,{align:'right',numeric:true,fill:i===0?C.green:C.muted});
        });
      }else text(data.echoScoreReady?'暂无正向边际收益':calculating?'正在读取词条边际收益…':'计算后查看边际收益优先级',x,873,width,19,{fill:C.muted});
    }
    text('当前配装：暴伤+2%，其他百分比+1%，固定攻击+1点',x,920,width,11,{fill:C.muted});
  }
  function addImage(key,x,y,w,h,{crop=null,parent=layer,opacity=1}={}){
    const img=images[key];if(!img)return;
    return add(new Konva.Image({image:img,x,y,width:w,height:h,crop:crop||undefined,listening:false,opacity}),parent);
  }
  function contain(key,x,y,w,h){const img=images[key];if(!img)return;const k=Math.min(w/img.width,h/img.height);return addImage(key,x+(w-img.width*k)/2,y+(h-img.height*k)/2,img.width*k,img.height*k);}
  function renderEchoBadge(x,y,rating,ready,calculated){
    const level=ready?(rating>=90?4:rating>=75?3:rating>=60?2:1):0;
    const tint=[C.muted,'#82ce9d','#83c6fa','#c39af5','#ff8589'][level];
    // A quiet header value, using the card's existing numeric face and no separate badge.
    text(ready?Number(rating.toFixed(1)):calculated?'暂无评分':'—',x,y,64,ready?22:calculated?12:20,{
      numeric:true,align:'right',fill:tint,fontStyle:ready?'bold':'normal',
      shadowColor:'#080d12',shadowBlur:2,shadowOffsetY:1,shadowOpacity:.65,name:'echo-score'
    });
  }
  function renderRankBadge(score){
    const rank=grade(score);
    const red=rank==='SS'||rank==='SSS';
    const letter=text(rank,1202,82,232,88,{fontFamily:'CardSerif',fontStyle:'bold italic',letterSpacing:-5,align:'center',fill:red?'#ef675f':C.pale,fillPriority:'linear-gradient',fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:88},fillLinearGradientColorStops:red?[0,'#ffc1ae',.28,'#ff8275',.6,'#e7464f',1,'#9b283b']:[0,'#fff0ca',.4,'#dfbe80',1,'#907042'],shadowColor:'#080a0e',shadowBlur:2,shadowOffsetY:1,shadowOpacity:.7});
    const tier={S:1,SS:2,SSS:3}[rank];
    if(!tier)return;
    const width=Math.min(212,letter.getTextWidth()+26),x=1318-width/2;
    const g=add(new Konva.Group({name:'rank-underline-'+rank,listening:false}));
    const tint=red?'#ed6163':'#dbbd7e',edge=red?'#ffc2ae':'#f6dfac';
    const y=tier===3?147:150;
    add(new Konva.Line({points:[x+9,y,x+width,y,x+width-10,y+15,x,y+15],closed:true,fillLinearGradientStartPoint:{x,y},fillLinearGradientEndPoint:{x:x+width,y:y+15},fillLinearGradientColorStops:[0,red?'#702f3420':'#88714620',.48,red?'#cf444b7a':'#c39b5870',1,red?'#ff847048':'#ead09a40'],listening:false}),g);
    line(x+6,y+15,x+width-10,y+15,.8,tint,g);
    line(x+width*.43,y+15,x+width-10,y+15,.75,edge,g);
    if(tier>=2){
      add(new Konva.Line({points:[x+15,y+20,x+width-3,y+20,x+width-6,y+23,x+12,y+23],closed:true,fill:tint,opacity:.48,listening:false}),g);
      line(x+width-9,y-3,x+width+2,y-3,.6,edge,g);
    }
    if(tier===3){
      line(x+28,y+29,x+width-13,y+29,.65,tint,g);
      for(let i=0;i<3;i++)line(x+5+i*7,y+9,x+12+i*7,y-2,.5,edge,g);
      line(x+width-24,y+24,x+width-17,y+13,.55,edge,g);
    }
    letter.moveToTop();
  }
  function renderFooter(data,summary){
    rect(0,943,W,137,{fill:'#0b1117'});
    rect(0,943,1140,137,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:1140,y:137},fillLinearGradientColorStops:[0,'#29313b',.43,'#151d25',1,'#0d141b']});
    // A dedicated results band gives the shared plan information a clear hierarchy.
    add(new Konva.Line({points:[1173,943,1920,943,1920,1080,1131,1080],closed:true,fillLinearGradientStartPoint:{x:1140,y:943},fillLinearGradientEndPoint:{x:1920,y:1080},fillLinearGradientColorStops:[0,'#34312a',.45,'#242725',1,'#131b20'],listening:false}));
    metalLine(0,943,W,943,.94);metalLine(1173,944,1132,1079,.8);
    rect(30,964,3,37,{fill:C.gold});
    text('用户名称',49,961,325,18,{fill:C.muted,letterSpacing:2});
    text(state.user||'未署名',47,989,355,38,{title:true,fill:C.pale,fontStyle:'bold'});
    text('方案编码',49,1043,91,18,{fill:C.muted});
    text(state.code||'—',149,1040,281,24,{numeric:true,fill:'#dfcba5'});
    line(450,967,450,1056,.23);
    text('轴名称',479,961,235,18,{fill:C.muted,letterSpacing:2});
    text(state.axis||'未命名轴',477,993,245,26,{title:true,fill:C.pale,fontStyle:'bold'});
    const axisType=data.axis.mode==='global'?data.axis.seconds+'秒全局轴':data.axis.seconds+'秒循环轴';
    rect(479,1036,188,29,{fill:'#d0ae6910',stroke:'#c5ad783d',strokeWidth:1,cornerRadius:2});
    text(axisType,490,1041,166,20,{fill:'#d8c59f'});
    if(state.showMates)data.teamMates.forEach((mate,i)=>{
      const x=757,y=955+i*59;
      rect(x,y,48,48,{fill:'#090e13',stroke:'#8b7e6655',strokeWidth:1});
      const img=images[mate.image];if(img)addImage(mate.image,x+2,y+2,44,44,{crop:{x:0,y:0,width:img.width,height:img.width}});
      text(mate.name,x+61,y+1,167,22,{fill:C.pale});
      text((mate.level?'Lv.'+mate.level:'Lv.?')+' · '+mate.chain+'链',x+229,y+3,134,19,{fill:'#d8c59f',align:'right'});
      if(images[mate.weaponImage])addImage(mate.weaponImage,x+59,y+25,24,24);
      text(mate.weaponName,x+88,y+29,218,18,{fill:'#c1c7cc'});
      text(mate.refinement?mate.refinement+'精':'—',x+319,y+29,44,18,{fill:'#d8c59f',align:'right'});
      if(i===0)line(x+61,y+54,x+363,y+54,.13);
    });
    text('全队总伤',1200,961,321,21,{fill:'#d6c8ae',letterSpacing:2});
    text(fmt(summary.teamTotal),1196,996,345,62,{numeric:true,fill:'#fff0cd',fontStyle:'bold',scale:true});
    metalLine(1550,967,1550,1057,.36);
    text('DPS',1590,961,270,21,{numeric:true,fill:'#d6c8ae',letterSpacing:3});
    text(fmt(summary.dps),1586,996,302,62,{numeric:true,fill:'#fff0cd',fontStyle:'bold',scale:true});
    metalLine(1200,1068,1516,1068,.38);metalLine(1590,1068,1884,1068,.38);
  }
  function artBounds(){
    const crop={x:0,y:0,width:artImage.width,height:artImage.height};
    const k=Math.max(576/crop.width,940/crop.height)*state.zoom/100;
    return {crop,width:crop.width*k,height:crop.height*k};
  }
  function setArtPosition(x,y){const r=artBounds();state.artX=Math.max(576-r.width,Math.min(0,x));state.artY=Math.max(940-r.height,Math.min(0,y));if(artNode)artNode.position({x:state.artX,y:state.artY});}
  function centerArt(){const r=artBounds(),position=!state.artData&&sourceApi()?.portraitPosition?.(Number($('member').value))||[.5,.5];state.artX=(576-r.width)*position[0];state.artY=(940-r.height)*position[1];}
  function renderArt(){
    artGroup=add(new Konva.Group({clipX:0,clipY:0,clipWidth:576,clipHeight:940}));
    const r=artBounds();
    artNode=add(new Konva.Image({image:artImage,crop:r.crop,x:state.artX,y:state.artY,width:r.width,height:r.height,draggable:true,name:'user-portrait'}),artGroup);
    setArtPosition(state.artX,state.artY);
    artNode.on('dragmove',()=>{setArtPosition(artNode.x(),artNode.y());layer.batchDraw();});
    artNode.on('dragend',()=>status('构图已更新'));
    artNode.on('mouseenter',()=>stage.container().style.cursor='grab');artNode.on('mouseleave',()=>stage.container().style.cursor='default');
    artNode.on('wheel',e=>{e.evt.preventDefault();changeZoom(state.zoom+(e.evt.deltaY<0?4:-4));});
    rect(0,410,576,530,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:530},fillLinearGradientColorStops:[0,'rgba(6,9,12,0)',.55,`rgba(6,9,12,${state.shade/100*.55})`,1,`rgba(6,9,12,${state.shade/100})`]},artGroup);
    line(576,0,576,940,.3,C.gold);
    const data=currentData;
    text(data.character.name,38,706,515,72,{title:true,fontStyle:'bold',fill:'#fff1d7'});
    for(let i=0;i<data.character.rarity;i++)add(new Konva.Star({x:56+i*36,y:801,numPoints:5,innerRadius:7,outerRadius:14,fill:C.gold,listening:false}));
    text((data.character.level?'Lv.'+data.character.level:'等级待确认')+'  ·  '+data.character.chain+'链',270,786,266,28,{numeric:true,fill:'#eee3cf',align:'right'});
    const labels=['普攻','技能','回路','解放','变奏'];
    (data.skillLevels||[]).forEach((skill,i)=>{
      const x=40+i*102;
      if(skill.image)addImage(skill.image,x+22,841,44,44);
      text(labels[i],x,890,88,18,{align:'center',fill:'#b8bdc2'});
      text(skill.level?'Lv.'+skill.level:'待确认',x,914,88,22,{numeric:true,align:'center',fill:'#f7e8c3'});
    });
  }
  function renderCard(){
    if(!ready||!currentData)return;layer.destroyChildren();
    const data=currentData,summary=summarize(data);
    rect(0,0,W,H,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:W,y:H},fillLinearGradientColorStops:[0,'#293039',.35,'#182127',1,'#10151a']});
    addImage('nativeBackground',0,0,W,H,{opacity:.42});drawTexture();renderArt();drawGeometry();
    rect(604,30,1290,298,{fill:'#10191e25',cornerRadius:12});
    addImage('nativePanel',605,32,572,294,{opacity:.24});
    addImage('nativePanel',1181,32,710,294,{opacity:.16});
    metalFrame(604,30,1290,298,12,.65);
    sectionTitle('基础面板',625,45,320);
    rect(1025,31,144,63,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:63},fillLinearGradientColorStops:[0,'#263038',1,'#11191e'],cornerRadius:10});metalFrame(1025,31,144,63,10,.64);
    addImage('nativeGoldCorners',1027,32,140,61,{opacity:.24});
    addImage('nativeWeaponEtching',1040,82,115,14,{opacity:.45});
    addImage('nativeDiamondLine',1028,94,138,12,{opacity:.8});
    if(images.weapon)contain('weapon',1031,20,84,73);else text(data.weapon.name||'未选择武器',1034,48,78,20,{align:'center',fill:C.pale});text('精'+data.weapon.refinement,1116,51,47,25,{title:true,fill:C.pale});
    data.stats.forEach(([name,value],i)=>{const y=113+i*50;statIcon(name,625,y-3,31);text(name,675,y,213,24,{scale:true});text(value,888,y-1,260,29,{numeric:true,align:'right',fill:C.pale,fontStyle:'bold',scale:true});line(625,y+37,1150,y+37,.18,'#b8b4a9');});
    metalLine(1179,43,1179,313,.53);sectionTitle('个人声骸练度',1210,45,580);
    if(data.scoreReady){renderRankBadge(data.score);text(data.score.toFixed(2),1460,100,405,75,{numeric:true,fill:C.pale,fontStyle:'bold'});
    rect(1210,196,435,12,{fill:'#ffffff13',cornerRadius:6});rect(1210,196,435*(1-data.gapPercent/100),12,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:12},fillLinearGradientColorStops:[0,'#eed8aa',.4,'#dabb80',1,'#a78855'],cornerRadius:6});text('距拉满 '+data.gapPercent.toFixed(2)+'%',1662,185,224,23,{align:'right'});}
    else text(calculating?'评分计算中…':'评分待计算',1220,120,630,45,{title:true,fill:C.pale});
    text('当前角色直伤',1210,236,208,21);text(fmt(summary.directTotal),1210,272,208,36,{numeric:true,fill:C.pale,fontStyle:'bold',scale:true});
    line(1432,236,1432,313,.3);
    text('满配常规伤害',1450,236,208,21);text(data.scoreReady?fmt(data.fullCharacterDamage):'待计算',1450,272,208,36,{numeric:true,fill:C.pale,fontStyle:'bold',scale:true});
    line(1672,236,1672,313,.3);
    text('固伤',1690,236,189,21);text(summary.fixedTotal>0?fmt(summary.fixedTotal):'—',1690,272,189,36,{numeric:true,fill:C.pale,fontStyle:'bold',scale:true});
    sectionTitle('声骸配置',625,337,430);text(data.setName,1589,338,296,23,{align:'right'});
    const ex=604,ey=376,ew=(1290-4*13)/5,eh=360;
    data.echoes.forEach((echo,i)=>{const x=ex+i*(ew+13);rect(x,ey,ew,eh,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:ew,y:eh},fillLinearGradientColorStops:[0,'#30343a',.35,'#1b232b',1,'#121a21'],cornerRadius:6});
      rect(x+1,ey+1,ew-2,114,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:ew,y:114},fillLinearGradientColorStops:[0,'#c3a67c15',.6,'#d6dde308',1,'#11192100'],cornerRadius:[5,5,0,0]});
      metalFrame(x,ey,ew,eh,6,.5);metalLine(x+16,ey+1,x+ew-16,ey+1,.7);text(echo.cost+'c',x+15,ey+15,70,25,{numeric:true,fill:'#d1c3a9'});
      contain(echo.image,x+64,ey+6,104,110);
      rect(x+12,ey+79,ew-24,35,{fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:35},fillLinearGradientColorStops:[0,'#11192100',.55,'#111921b8',1,'#111921e6']});
      fitText(echo.name||'未指定声骸',x+14,ey+94,ew-28,17,{align:'center',fill:C.ink,shadowColor:'#080c10',shadowBlur:3,shadowOffsetY:1,shadowOpacity:.9,name:'echo-name'});
      const rating=echo.rating,hasRating=data.echoScoreReady&&Number.isFinite(rating);
      renderEchoBadge(x+ew-79,ey+17,rating,hasRating,data.echoScoreReady);
      metalLine(x+12,ey+116,x+ew-12,ey+116,.4);fitText(echo.main,x+14,ey+131,ew-136,22,{fill:C.pale});fitText(echo.value,x+ew-118,ey+129,104,28,{numeric:true,fill:C.pale,fontStyle:'bold',align:'right'});
      line(x+15,ey+171,x+ew-15,ey+171,.14);
      echo.affixes.forEach((a,j)=>{const yy=ey+187+j*32;const typeColors={'共鸣技能':C.purple,'共鸣解放':C.blue,'重击':C.amber,'普攻':C.green};const base=typeColors[a.name]||C.ink;const max=a.max;const isMax=Number.isFinite(max)&&Math.abs(a.value-max)<1e-8;statIcon(a.name,x+15,yy-1,19);text(a.name,x+43,yy,ew-138,19,{fill:base,scale:true});text((a.unit?a.value.toFixed(1):String(a.value))+a.unit,x+ew-88,yy-1,74,22,{numeric:true,align:'right',fill:isMax?C.red:base,scale:true});});
    });
    if(state.showTop){
      metalFrame(604,753,744,181,10,.5);sectionTitle('技能伤害 TOP 3',625,754,510);
      rect(623,790,706,26,{fill:'#aab4bc14',cornerRadius:12});
      text('技能',666,795,306,17);text('期望值',979,795,169,17,{align:'center'});text('暴击值',1153,795,169,17,{align:'center'});
      summary.top.forEach((r,i)=>{const y=816+i*39;
        add(new Konva.Circle({x:642,y:y+17,radius:12,fill:'#ffffff0c',stroke:'#ffffff28',strokeWidth:1,listening:false}));
        text(i+1,630,y+7,24,18,{numeric:true,align:'center'});
        text(r.name,666,y+1,306,19,{wrap:'char',height:38,lineHeight:1.0,ellipsis:false});
        text(Math.round(r.expected).toLocaleString('en-US'),979,y+8,169,21,{numeric:true,align:'center',fill:C.pale,fontStyle:'bold'});
        text(r.critical===null?'—':Math.round(r.critical).toLocaleString('en-US'),1153,y+8,169,21,{numeric:true,align:'center',fill:C.pale,fontStyle:'bold'});
        if(i<2)line(666,y+38,1325,y+38,.12);
      });
      renderAdvice(data);
    }
    renderFooter(data,summary);
    text('鸣算屋 · wuwacalc.cn',1610,12,278,18,{fill:'#d0c3aa',align:'right'});
    layer.draw();renderSource(summary);syncControls();
  }
  function renderSource(summary){
    const parent=$('source-table');parent.replaceChildren();const table=document.createElement('table');table.className='source-table';const tr=document.createElement('tr');for(const heading of ['技能 ID / 名称','来源','条目数','期望总伤害','暴击总伤害']){const cell=document.createElement('th');cell.textContent=heading;tr.append(cell);}table.append(tr);
    summary.skills.forEach(r=>{const row=document.createElement('tr');[r.id+' / '+r.name,r.source,r.count,Math.round(r.expected).toLocaleString(),r.critical===null?'—':Math.round(r.critical).toLocaleString()].forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i>1)td.className='num';row.append(td)});table.append(row)});parent.append(table);
  }
  function status(s){$('status').textContent=s;}
  function fit(){if(!stage)return;const wrap=$('canvas-wrap');let width=wrap.clientWidth;if(document.fullscreenElement===wrap)width=Math.min(width,window.innerHeight*W/H);const k=width/W;stage.size({width:W*k,height:H*k});stage.scale({x:k,y:k});$('stage').style.height=H*k+'px';$('stage').style.width=width+'px';$('stage').style.margin='auto';layer.draw();}
  function syncControls(){$('zoom').value=state.zoom;$('zoom-value').textContent=state.zoom+'%';}
  function changeZoom(v){const old=artBounds();const cx=(288-state.artX)/old.width,cy=(470-state.artY)/old.height;state.zoom=Math.max(100,Math.min(240,Number(v)));const next=artBounds();state.artX=288-cx*next.width;state.artY=470-cy*next.height;renderCard();}
  async function imageFrom(src){const img=new Image();img.crossOrigin='anonymous';img.src=src;await bounded(img.decode(),15000,'图片加载超时，请重试');return img;}
  async function uploadArt(file){
    if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPG 或 WebP 图片');if(file.size>12*1024*1024)throw Error('请选择 12 MB 以内的图片');const token=++loadToken;
    const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file)});const img=await imageFrom(data);if(token!==loadToken)return;state.artData=data;artImage=img;state.zoom=100;centerArt();renderCard();status('立绘已替换，可以拖动调整位置');
  }
  function downloadBlob(blob,name){if(new URLSearchParams(location.search).get('studio')==='1'&&window.parent!==window&&window.parent.location.origin===location.origin&&window.parent.__WC?.MobileStudio?.saveImage){window.parent.__WC.MobileStudio.saveImage(blob,name);return;}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  async function exportPng(){
    if(!ready||exporting||!currentData||!currentData.scoreReady||!currentData.echoScoreReady||calculating||energyUpdating||currentData.energy?.status==='updating'||visualLoading||missingImages.length)return;if(sourceApi()&&!sourceApi().isCurrent(currentData.fingerprint)){status('方案已变化，请重新计算后下载');setDownloadDisabled(true);return;}exporting=true;setDownloadDisabled(true);status('正在生成高清图片…');
    try{const snapshot=currentData;await ensureCardFonts();if(currentData!==snapshot)throw Error('卡片已变化，请重新下载');if(sourceApi()&&!sourceApi().isCurrent(currentData.fingerprint))throw Error('方案已变化，请重新计算后下载');const ratio=Number(state.resolution);const canvas=stage.toCanvas({pixelRatio:ratio/stage.scaleX()});const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('生成图片失败');const safe=(state.code||'角色卡片').replace(/[\\/:*?"<>|]/g,'-');downloadBlob(blob,`${safe}-${W*ratio}x${H*ratio}.png`);status(`已导出 ${W*ratio} × ${H*ratio} PNG`);}catch(e){status('导出失败：'+e.message);}finally{exporting=false;updateDownload();}
  }
  const FONT_INDEX={"base": [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 183, 215, 8212, 8220, 8221, 8230, 12289, 12300, 12301, 12304, 12305, 19968, 19969, 19975, 19977, 19978, 19979, 19981, 19982, 19987, 19988, 19990, 19994, 19996, 19997, 20013, 20020, 20025, 20026, 20027, 20029, 20037, 20041, 20043, 20047, 20048, 20056, 20081, 20102, 20107, 20108, 20110, 20111, 20113, 20116, 20129, 20132, 20154, 20161, 20167, 20170, 20174, 20185, 20195, 20196, 20197, 20202, 20215, 20234, 20240, 20248, 20254, 20260, 20301, 20307, 20313, 20316, 20320, 20329, 20351, 20363, 20405, 20445, 20449, 20462, 20465, 20505, 20538, 20540, 20542, 20551, 20572, 20607, 20608, 20687, 20763, 20799, 20803, 20806, 20808, 20809, 20811, 20828, 20837, 20840, 20843, 20848, 20849, 20852, 20853, 20854, 20855, 20856, 20857, 20859, 20869, 20877, 20885, 20889, 20891, 20896, 20898, 20901, 20908, 20912, 20914, 20915, 20919, 20923, 20925, 20928, 20932, 20934, 20939, 20940, 20955, 20957, 20973, 20982, 20986, 20987, 20992, 20995, 20998, 20999, 21015, 21017, 21019, 21021, 21028, 21035, 21040, 21046, 21047, 21049, 21050, 21051, 21069, 21073, 21078, 21095, 21098, 21106, 21147, 21151, 21152, 21160, 21163, 21169, 21182, 21183, 21191, 21208, 21270, 21283, 21311, 21315, 21319, 21322, 21326, 21327, 21333, 21340, 21345, 21350, 21355, 21363, 21382, 21385, 21387, 21407, 21435, 21442, 21452, 21453, 21457, 21462, 21464, 21465, 21475, 21476, 21481, 21484, 21487, 21488, 21490, 21494, 21495, 21497, 21507, 21512, 21516, 21517, 21518, 21521, 21535, 21543, 21548, 21551, 21578, 21587, 21596, 21602, 21608, 21628, 21629, 21638, 21644, 21647, 21673, 21676, 21682, 21691, 21709, 21714, 21738, 21742, 21796, 21809, 21834, 21880, 21883, 21886, 21891, 21892, 21916, 21927, 21943, 22025, 22061, 22120, 22124, 22234, 22235, 22238, 22260, 22266, 22270, 22278, 22280, 22303, 22307, 22312, 22320, 22330, 22349, 22350, 22368, 22402, 22411, 22432, 22495, 22522, 22530, 22612, 22659, 22686, 22687, 22696, 22737, 22763, 22768, 22791, 22797, 22799, 22805, 22806, 22810, 22812, 22823, 22825, 22826, 22833, 22836, 22855, 22856, 22857, 22859, 22863, 22868, 22869, 22885, 22909, 22914, 22916, 22937, 22958, 22987, 23041, 23045, 23068, 23376, 23383, 23384, 23396, 23398, 23425, 23431, 23432, 23433, 23436, 23449, 23450, 23454, 23457, 23459, 23467, 23475, 23476, 23477, 23481, 23490, 23506, 23507, 23519, 23536, 23545, 23547, 23548, 23556, 23558, 23567, 23572, 23576, 23588, 23613, 23614, 23616, 23621, 23624, 23627, 23631, 23637, 23646, 23665, 23681, 23706, 23736, 23849, 23938, 24029, 24030, 24033, 24049, 24050, 24067, 24072, 24076, 24085, 24103, 24110, 24119, 24120, 24149, 24178, 24182, 24187, 24189, 24191, 24207, 24212, 24230, 24310, 24320, 24322, 24331, 24335, 24337, 24339, 24341, 24343, 24357, 24358, 24377, 24378, 24402, 24403, 24405, 24418, 24425, 24433, 24441, 24443, 24444, 24448, 24449, 24453, 24458, 24459, 24472, 24481, 24490, 24494, 24515, 24517, 24518, 24524, 24530, 24535, 24536, 24537, 24544, 24551, 24565, 24576, 24577, 24594, 24605, 24613, 24615, 24635, 24658, 24674, 24681, 24687, 24694, 24713, 24726, 24735, 24736, 24748, 24754, 24773, 24778, 24807, 24819, 24847, 24863, 24895, 24904, 25096, 25103, 25104, 25105, 25110, 25112, 25134, 25140, 25143, 25152, 25161, 25163, 25169, 25171, 25191, 25193, 25195, 25196, 25199, 25200, 25203, 25215, 25216, 25219, 25235, 25240, 25252, 25289, 25293, 25302, 25311, 25314, 25321, 25325, 25331, 25345, 25351, 25353, 25361, 25375, 25381, 25391, 25405, 25442, 25454, 25472, 25484, 25504, 25506, 25507, 25509, 25511, 25512, 25513, 25552, 25645, 25658, 25668, 25671, 25749, 25758, 25764, 25806, 25903, 25910, 25913, 25915, 25918, 25925, 25928, 25932, 25937, 25947, 25955, 25964, 25968, 25972, 26000, 26001, 26007, 26020, 26025, 26029, 26031, 26032, 26041, 26053, 26059, 26080, 26085, 26102, 26114, 26126, 26127, 26131, 26137, 26143, 26149, 26157, 26172, 26174, 26179, 26195, 26214, 26216, 26222, 26223, 26263, 26269, 26292, 26332, 26354, 26356, 26364, 26367, 26368, 26376, 26377, 26388, 26395, 26399, 26408, 26410, 26411, 26412, 26415, 26417, 26426, 26429, 26432, 26435, 26463, 26465, 26469, 26495, 26497, 26500, 26517, 26519, 26524, 26525, 26530, 26538, 26543, 26579, 26580, 26597, 26631, 26646, 26657, 26680, 26684, 26691, 26696, 26723, 26790, 26840, 26865, 26893, 26928, 26943, 26964, 27004, 27169, 27185, 27425, 27426, 27450, 27468, 27490, 27491, 27492, 27493, 27494, 27515, 27530, 27531, 27538, 27547, 27573, 27575, 27583, 27585, 27599, 27604, 27668, 27700, 27704, 27714, 27728, 27748, 27762, 27785, 27788, 27809, 27815, 27819, 27835, 27849, 27850, 27861, 27867, 27872, 27873, 27880, 27901, 27921, 27931, 27934, 27963, 27966, 27969, 27979, 27982, 27983, 28003, 28009, 28010, 28014, 28023, 28034, 28040, 28041, 28044, 28059, 28063, 28065, 28068, 28070, 28071, 28072, 28129, 28145, 28151, 28165, 28170, 28172, 28193, 28216, 28251, 28270, 28293, 28304, 28322, 28335, 28346, 28385, 28418, 28436, 28457, 28458, 28459, 28465, 28508, 28526, 28572, 28608, 28626, 28655, 28698, 28779, 28781, 28783, 28789, 28796, 28801, 28814, 28851, 28856, 28857, 28860, 28861, 28865, 28872, 28895, 28908, 28909, 28937, 28954, 28966, 28976, 29004, 29022, 29031, 29076, 29088, 29123, 29134, 29141, 29159, 29190, 29226, 29233, 29255, 29273, 29289, 29301, 29305, 29356, 29369, 29378, 29417, 29420, 29422, 29425, 29436, 29454, 29536, 29572, 29575, 29577, 29615, 29627, 29634, 29645, 29701, 29702, 29747, 29756, 29786, 29791, 29822, 29824, 29864, 29983, 29992, 30001, 30005, 30011, 30028, 30041, 30053, 30095, 30103, 30142, 30165, 30260, 30331, 30333, 30334, 30340, 30408, 30424, 30427, 30431, 30446, 30452, 30456, 30475, 30495, 30496, 30524, 30528, 30561, 30596, 30609, 30631, 30636, 30693, 30697, 30701, 30702, 30721, 30768, 30772, 30784, 30828, 30830, 30862, 30887, 30896, 30913, 31034, 31036, 31048, 31067, 31069, 31070, 31085, 31087, 31095, 31163, 31179, 31181, 31186, 31207, 31216, 31227, 31243, 31245, 31252, 31319, 31353, 31354, 31359, 31361, 31383, 31435, 31455, 31456, 31481, 31508, 31526, 31532, 31561, 31572, 31574, 31639, 31649, 31713, 31751, 31867, 31881, 31932, 31934, 32092, 32321, 32418, 32422, 32423, 32437, 32439, 32441, 32447, 32451, 32452, 32455, 32456, 32462, 32467, 32469, 32472, 32476, 32477, 32478, 32481, 32493, 32494, 32495, 32500, 32509, 32516, 32520, 32521, 32534, 32536, 32541, 32544, 32549, 32553, 32557, 32593, 32599, 32602, 32609, 32618, 32622, 32626, 32650, 32654, 32676, 32701, 32718, 32736, 32745, 32752, 32763, 32764, 32768, 32773, 32780, 32852, 32858, 32899, 32929, 32937, 32946, 32966, 32993, 33021, 33033, 33034, 33151, 33179, 33218, 33258, 33267, 33268, 33275, 33293, 33310, 33322, 33324, 33337, 33394, 33402, 33410, 33426, 33457, 33459, 33463, 33485, 33495, 33509, 33521, 33564, 33609, 33618, 33633, 33635, 33639, 33655, 33673, 33707, 33713, 33736, 33778, 33853, 33900, 33945, 33988, 34013, 34067, 34122, 34174, 34255, 34394, 34425, 34432, 34544, 34563, 34588, 34678, 34701, 34784, 34850, 34880, 34892, 34893, 34900, 34913, 34915, 34917, 34957, 34989, 35009, 35010, 35013, 35199, 35201, 35206, 35265, 35266, 35268, 35270, 35272, 35273, 35282, 35299, 35302, 35328, 35475, 35745, 35748, 35753, 35758, 35760, 35768, 35770, 35774, 35775, 35776, 35777, 35780, 35793, 35797, 35799, 35803, 35806, 35813, 35821, 35831, 35832, 35834, 35835, 35843, 35851, 35854, 35856, 35874, 35880, 35889, 35895, 35937, 36125, 36127, 36133, 36135, 36136, 36143, 36171, 36174, 36187, 36189, 36190, 36192, 36196, 36198, 36203, 36208, 36212, 36215, 36229, 36234, 36235, 36259, 36275, 36291, 36317, 36335, 36345, 36367, 36433, 36515, 36523, 36712, 36716, 36718, 36719, 36720, 36724, 36731, 36733, 36745, 36749, 36753, 36755, 36766, 36793, 36798, 36805, 36807, 36814, 36816, 36817, 36820, 36824, 36825, 36827, 36828, 36830, 36842, 36843, 36861, 36865, 36867, 36870, 36873, 36880, 36882, 36884, 36890, 36893, 36895, 36898, 36929, 36930, 36947, 36951, 36991, 37027, 37034, 37057, 37194, 37197, 37219, 37225, 37266, 37321, 37322, 37324, 37325, 37329, 37492, 38047, 38050, 38055, 38081, 38103, 38136, 38142, 38145, 38155, 38160, 38169, 38170, 38191, 38215, 38236, 38253, 38256, 38271, 38376, 38378, 38382, 38386, 38388, 38393, 38408, 38425, 38431, 38450, 38451, 38452, 38453, 38470, 38472, 38477, 38480, 38504, 38519, 38543, 38544, 38553, 38590, 38596, 38598, 38624, 38632, 38634, 38646, 38647, 38654, 38657, 38660, 38662, 38663, 38675, 38678, 38684, 38686, 38706, 38738, 38745, 38754, 38774, 38899, 38901, 38902, 39029, 39030, 39033, 39038, 39042, 39044, 39046, 39056, 39057, 39068, 39069, 39118, 39123, 39134, 39144, 39278, 39280, 39285, 39304, 39533, 39537, 39539, 39547, 39559, 39564, 39569, 39575, 39592, 39608, 39635, 39640, 39740, 39746, 39748, 39749, 39751, 39753, 39757, 39761, 39764, 40158, 40483, 40548, 40644, 40654, 40657, 40664, 40687, 40718, 40723, 40784, 40831, 40857, 65281, 65292, 65306, 65311], "chunks": {"base": {"file": "font-common.woff2", "bytes": 603560, "hash": "2a05da6e5d", "range": "U+20-7E,U+B7,U+D7,U+2014,U+201C-201D,U+2026,U+3001,U+300C-300D,U+3010-3011,U+4E00-4E01,U+4E07,U+4E09-4E0B,U+4E0D-4E0E,U+4E13-4E14,U+4E16,U+4E1A,U+4E1C-4E1D,U+4E2D,U+4E34,U+4E39-4E3B,U+4E3D,U+4E45,U+4E49,U+4E4B,U+4E4F-4E50,U+4E58,U+4E71,U+4E86,U+4E8B-4E8C,U+4E8E-4E8F,U+4E91,U+4E94,U+4EA1,U+4EA4,U+4EBA,U+4EC1,U+4EC7,U+4ECA,U+4ECE,U+4ED9,U+4EE3-4EE5,U+4EEA,U+4EF7,U+4F0A,U+4F10,U+4F18,U+4F1E,U+4F24,U+4F4D,U+4F53,U+4F59,U+4F5C,U+4F60,U+4F69,U+4F7F,U+4F8B,U+4FB5,U+4FDD,U+4FE1,U+4FEE,U+4FF1,U+5019,U+503A,U+503C,U+503E,U+5047,U+505C,U+507F-5080,U+50CF,U+511B,U+513F,U+5143,U+5146,U+5148-5149,U+514B,U+515C,U+5165,U+5168,U+516B,U+5170-5171,U+5174-5179,U+517B,U+5185,U+518D,U+5195,U+5199,U+519B,U+51A0,U+51A2,U+51A5,U+51AC,U+51B0,U+51B2-51B3,U+51B7,U+51BB,U+51BD,U+51C0,U+51C4,U+51C6,U+51CB-51CC,U+51DB,U+51DD,U+51ED,U+51F6,U+51FA-51FB,U+5200,U+5203,U+5206-5207,U+5217,U+5219,U+521B,U+521D,U+5224,U+522B,U+5230,U+5236-5237,U+5239-523B,U+524D,U+5251,U+5256,U+5267,U+526A,U+5272,U+529B,U+529F-52A0,U+52A8,U+52AB,U+52B1,U+52BE-52BF,U+52C7,U+52D8,U+5316,U+5323,U+533F,U+5343,U+5347,U+534A,U+534E-534F,U+5355,U+535C,U+5361,U+5366,U+536B,U+5373,U+5386,U+5389,U+538B,U+539F,U+53BB,U+53C2,U+53CC-53CD,U+53D1,U+53D6,U+53D8-53D9,U+53E3-53E4,U+53E9,U+53EC,U+53EF-53F0,U+53F2,U+53F6-53F7,U+53F9,U+5403,U+5408,U+540C-540E,U+5411,U+541F,U+5427,U+542C,U+542F,U+544A,U+5453,U+545C,U+5462,U+5468,U+547C-547D,U+5486,U+548C,U+548F,U+54A9,U+54AC,U+54B2,U+54BB,U+54CD,U+54D2,U+54EA,U+54EE,U+5524,U+5531,U+554A,U+5578,U+557B,U+557E,U+5583-5584,U+559C,U+55A7,U+55B7,U+5609,U+562D,U+5668,U+566C,U+56DA-56DB,U+56DE,U+56F4,U+56FA,U+56FE,U+5706,U+5708,U+571F,U+5723,U+5728,U+5730,U+573A,U+574D-574E,U+5760,U+5782,U+578B,U+57A0,U+57DF,U+57FA,U+5802,U+5854,U+5883,U+589E-589F,U+58A8,U+58D1,U+58EB,U+58F0,U+5907,U+590D,U+590F,U+5915-5916,U+591A,U+591C,U+5927,U+5929-592A,U+5931,U+5934,U+5947-5949,U+594B,U+594F,U+5954-5955,U+5965,U+597D,U+5982,U+5984,U+5999,U+59AE,U+59CB,U+5A01,U+5A05,U+5A1C,U+5B50,U+5B57-5B58,U+5B64,U+5B66,U+5B81,U+5B87-5B89,U+5B8C,U+5B99-5B9A,U+5B9E,U+5BA1,U+5BA3,U+5BAB,U+5BB3-5BB5,U+5BB9,U+5BC2,U+5BD2-5BD3,U+5BDF,U+5BF0,U+5BF9,U+5BFB-5BFC,U+5C04,U+5C06,U+5C0F,U+5C14,U+5C18,U+5C24,U+5C3D-5C3E,U+5C40,U+5C45,U+5C48,U+5C4B,U+5C4F,U+5C55,U+5C5E,U+5C71,U+5C81,U+5C9A,U+5CB8,U+5D29,U+5D82,U+5DDD-5DDE,U+5DE1,U+5DF1-5DF2,U+5E03,U+5E08,U+5E0C,U+5E15,U+5E27,U+5E2E,U+5E37-5E38,U+5E55,U+5E72,U+5E76,U+5E7B,U+5E7D,U+5E7F,U+5E8F,U+5E94,U+5EA6,U+5EF6,U+5F00,U+5F02,U+5F0B,U+5F0F,U+5F11,U+5F13,U+5F15,U+5F17,U+5F25-5F26,U+5F39-5F3A,U+5F52-5F53,U+5F55,U+5F62,U+5F69,U+5F71,U+5F79,U+5F7B-5F7C,U+5F80-5F81,U+5F85,U+5F8A-5F8B,U+5F98,U+5FA1,U+5FAA,U+5FAE,U+5FC3,U+5FC5-5FC6,U+5FCC,U+5FD2,U+5FD7-5FD9,U+5FE0,U+5FE7,U+5FF5,U+6000-6001,U+6012,U+601D,U+6025,U+6027,U+603B,U+6052,U+6062,U+6069,U+606F,U+6076,U+6089,U+6096,U+609F-60A0,U+60AC,U+60B2,U+60C5,U+60CA,U+60E7,U+60F3,U+610F,U+611F,U+613F,U+6148,U+6208,U+620F-6211,U+6216,U+6218,U+622E,U+6234,U+6237,U+6240,U+6249,U+624B,U+6251,U+6253,U+6267,U+6269,U+626B-626C,U+626F-6270,U+6273,U+627F-6280,U+6283,U+6293,U+6298,U+62A4,U+62C9,U+62CD,U+62D6,U+62DF,U+62E2,U+62E9,U+62ED,U+62F3,U+6301,U+6307,U+6309,U+6311,U+631F,U+6325,U+632F,U+633D,U+6362,U+636E,U+6380,U+638C,U+63A0,U+63A2-63A3,U+63A5,U+63A7-63A9,U+63D0,U+642D,U+643A,U+6444,U+6447,U+6495,U+649E,U+64A4,U+64CE,U+652F,U+6536,U+6539,U+653B,U+653E,U+6545,U+6548,U+654C,U+6551,U+655B,U+6563,U+656C,U+6570,U+6574,U+6590-6591,U+6597,U+65A4,U+65A9,U+65AD,U+65AF-65B0,U+65B9,U+65C5,U+65CB,U+65E0,U+65E5,U+65F6,U+6602,U+660E-660F,U+6613,U+6619,U+661F,U+6625,U+662D,U+663C,U+663E,U+6643,U+6653,U+6666,U+6668,U+666E-666F,U+6697,U+669D,U+66B4,U+66DC,U+66F2,U+66F4,U+66FC,U+66FF-6700,U+6708-6709,U+6714,U+671B,U+671F,U+6728,U+672A-672C,U+672F,U+6731,U+673A,U+673D,U+6740,U+6743,U+675F,U+6761,U+6765,U+677F,U+6781,U+6784,U+6795,U+6797,U+679C-679D,U+67A2,U+67AA,U+67AF,U+67D3-67D4,U+67E5,U+6807,U+6816,U+6821,U+6838,U+683C,U+6843,U+6848,U+6863,U+68A6,U+68D8,U+68F1,U+690D,U+6930,U+693F,U+6954,U+697C,U+6A21,U+6A31,U+6B21-6B22,U+6B3A,U+6B4C,U+6B62-6B66,U+6B7B,U+6B8A-6B8B,U+6B92,U+6B9B,U+6BB5,U+6BB7,U+6BBF,U+6BC1,U+6BCF,U+6BD4,U+6C14,U+6C34,U+6C38,U+6C42,U+6C50,U+6C64,U+6C72,U+6C89,U+6C8C,U+6CA1,U+6CA7,U+6CAB,U+6CBB,U+6CC9-6CCA,U+6CD5,U+6CDB,U+6CE0-6CE1,U+6CE8,U+6CFD,U+6D11,U+6D1B,U+6D1E,U+6D3B,U+6D3E,U+6D41,U+6D4B,U+6D4E-6D4F,U+6D63,U+6D69-6D6A,U+6D6E,U+6D77,U+6D82,U+6D88-6D89,U+6D8C,U+6D9B,U+6D9F,U+6DA1,U+6DA4,U+6DA6-6DA8,U+6DE1,U+6DF1,U+6DF7,U+6E05,U+6E0A,U+6E0C,U+6E21,U+6E38,U+6E5B,U+6E6E,U+6E85,U+6E90,U+6EA2,U+6EAF,U+6EBA,U+6EE1,U+6F02,U+6F14,U+6F29-6F2B,U+6F31,U+6F5C,U+6F6E,U+6F9C,U+6FC0,U+6FD2,U+6FEF,U+701A,U+706B,U+706D,U+706F,U+7075,U+707C,U+7081,U+708E,U+70B3,U+70B8-70B9,U+70BC-70BD,U+70C1,U+70C8,U+70DF,U+70EC-70ED,U+7109,U+711A,U+7126,U+7130,U+714C,U+715E,U+7167,U+7194,U+71A0,U+71C3,U+71CE,U+71D5,U+71E7,U+7206,U+722A,U+7231,U+7247,U+7259,U+7269,U+7275,U+7279,U+72AC,U+72B9,U+72C2,U+72E9,U+72EC,U+72EE,U+72F1,U+72FC,U+730E,U+7360,U+7384,U+7387,U+7389,U+73AF,U+73BB,U+73C2,U+73CD,U+7405-7406,U+7433,U+743C,U+745A,U+745F,U+747E,U+7480,U+74A8,U+751F,U+7528,U+7531,U+7535,U+753B,U+754C,U+7559,U+7565,U+758F,U+7597,U+75BE,U+75D5,U+7634,U+767B,U+767D-767E,U+7684,U+76C8,U+76D8,U+76DB,U+76DF,U+76EE,U+76F4,U+76F8,U+770B,U+771F-7720,U+773C,U+7740,U+7761,U+7784,U+7791,U+77A7,U+77AC,U+77E5,U+77E9,U+77ED-77EE,U+7801,U+7830,U+7834,U+7840,U+786C,U+786E,U+788E,U+78A7,U+78B0,U+78C1,U+793A,U+793C,U+7948,U+795B,U+795D-795E,U+796D,U+796F,U+7977,U+79BB,U+79CB,U+79CD,U+79D2,U+79E7,U+79F0,U+79FB,U+7A0B,U+7A0D,U+7A14,U+7A57,U+7A79-7A7A,U+7A7F,U+7A81,U+7A97,U+7ACB,U+7ADF-7AE0,U+7AF9,U+7B14,U+7B26,U+7B2C,U+7B49,U+7B54,U+7B56,U+7B97,U+7BA1,U+7BE1,U+7C07,U+7C7B,U+7C89,U+7CBC,U+7CBE,U+7D5C,U+7E41,U+7EA2,U+7EA6-7EA7,U+7EB5,U+7EB7,U+7EB9,U+7EBF,U+7EC3-7EC4,U+7EC7-7EC8,U+7ECE,U+7ED3,U+7ED5,U+7ED8,U+7EDC-7EDE,U+7EE1,U+7EED-7EEF,U+7EF4,U+7EFD,U+7F04,U+7F08-7F09,U+7F16,U+7F18,U+7F1D,U+7F20,U+7F25,U+7F29,U+7F2D,U+7F51,U+7F57,U+7F5A,U+7F61,U+7F6A,U+7F6E,U+7F72,U+7F8A,U+7F8E,U+7FA4,U+7FBD,U+7FCE,U+7FE0,U+7FE9,U+7FF0,U+7FFB-7FFC,U+8000,U+8005,U+800C,U+8054,U+805A,U+8083,U+80A1,U+80A9,U+80B2,U+80C6,U+80E1,U+80FD,U+8109-810A,U+817F,U+819B,U+81C2,U+81EA,U+81F3-81F4,U+81FB,U+820D,U+821E,U+822A,U+822C,U+8239,U+8272,U+827A,U+8282,U+8292,U+82B1,U+82B3,U+82B7,U+82CD,U+82D7,U+82E5,U+82F1,U+831C,U+8349,U+8352,U+8361,U+8363,U+8367,U+8377,U+8389,U+83AB,U+83B1,U+83C8,U+83F2,U+843D,U+846C,U+8499,U+84C4,U+84DD,U+8513,U+854A,U+857E,U+85CF,U+865A,U+8679,U+8680,U+86F0,U+8703,U+871C,U+8776,U+878D,U+87E0,U+8822,U+8840,U+884C-884D,U+8854,U+8861,U+8863,U+8865,U+888D,U+88AD,U+88C1-88C2,U+88C5,U+897F,U+8981,U+8986,U+89C1-89C2,U+89C4,U+89C6,U+89C8-89C9,U+89D2,U+89E3,U+89E6,U+8A00,U+8A93,U+8BA1,U+8BA4,U+8BA9,U+8BAE,U+8BB0,U+8BB8,U+8BBA,U+8BBE-8BC1,U+8BC4,U+8BD1,U+8BD5,U+8BD7,U+8BDB,U+8BDE,U+8BE5,U+8BED,U+8BF7-8BF8,U+8BFA-8BFB,U+8C03,U+8C0B,U+8C0E,U+8C10,U+8C22,U+8C28,U+8C31,U+8C37,U+8C61,U+8D1D,U+8D1F,U+8D25,U+8D27-8D28,U+8D2F,U+8D4B,U+8D4E,U+8D5B,U+8D5D-8D5E,U+8D60,U+8D64,U+8D66,U+8D6B,U+8D70,U+8D74,U+8D77,U+8D85,U+8D8A-8D8B,U+8DA3,U+8DB3,U+8DC3,U+8DDD,U+8DEF,U+8DF9,U+8E0F,U+8E51,U+8EA3,U+8EAB,U+8F68,U+8F6C,U+8F6E-8F70,U+8F74,U+8F7B,U+8F7D,U+8F89,U+8F8D,U+8F91,U+8F93,U+8F9E,U+8FB9,U+8FBE,U+8FC5,U+8FC7,U+8FCE,U+8FD0-8FD1,U+8FD4,U+8FD8-8FD9,U+8FDB-8FDC,U+8FDE,U+8FEA-8FEB,U+8FFD,U+9001,U+9003,U+9006,U+9009,U+9010,U+9012,U+9014,U+901A,U+901D,U+901F,U+9022,U+9041-9042,U+9053,U+9057,U+907F,U+90A3,U+90AA,U+90C1,U+914A,U+914D,U+9163,U+9169,U+9192,U+91C9-91CA,U+91CC-91CD,U+91D1,U+9274,U+949F,U+94A2,U+94A7,U+94C1,U+94D7,U+94F8,U+94FE,U+9501,U+950B,U+9510,U+9519-951A,U+952F,U+9547,U+955C,U+956D,U+9570,U+957F,U+95E8,U+95EA,U+95EE,U+95F2,U+95F4,U+95F9,U+9608,U+9619,U+961F,U+9632-9635,U+9646,U+9648,U+964D,U+9650,U+9668,U+9677,U+968F-9690,U+9699,U+96BE,U+96C4,U+96C6,U+96E0,U+96E8,U+96EA,U+96F6-96F7,U+96FE,U+9701,U+9704,U+9706-9707,U+9713,U+9716,U+971C,U+971E,U+9732,U+9752,U+9759,U+9762,U+9776,U+97F3,U+97F5-97F6,U+9875-9876,U+9879,U+987E,U+9882,U+9884,U+9886,U+9890-9891,U+989C-989D,U+98CE,U+98D3,U+98DE,U+98E8,U+996E,U+9970,U+9975,U+9988,U+9A6D,U+9A71,U+9A73,U+9A7B,U+9A87,U+9A8C,U+9A91,U+9A97,U+9AA8,U+9AB8,U+9AD3,U+9AD8,U+9B3C,U+9B42,U+9B44-9B45,U+9B47,U+9B49,U+9B4D,U+9B51,U+9B54,U+9CDE,U+9E23,U+9E64,U+9EC4,U+9ECE,U+9ED1,U+9ED8,U+9EEF,U+9F0E,U+9F13,U+9F50,U+9F7F,U+9F99,U+FF01,U+FF0C,U+FF1A,U+FF1F"}, "0000": {"file": "font-0000.woff2", "bytes": 10408, "hash": "40f5263f14", "range": "U+A0-B6,U+B8-D6,U+D8-FF"}, "0020": {"file": "font-0020.woff2", "bytes": 6076, "hash": "513ac45502", "range": "U+2002-2003,U+2010-2013,U+2015-2016,U+2018-201A,U+201E,U+2020-2022,U+2025,U+2027,U+2030,U+2032-2033,U+2035,U+2039-203C,U+2042,U+2047-2049,U+2051,U+2074,U+20A9,U+20AB-20AC,U+20DD-20DE"}, "0021": {"file": "font-0021.woff2", "bytes": 8124, "hash": "0336c31115", "range": "U+2100,U+2103,U+2105,U+2109-210A,U+210F,U+2113,U+2116,U+2121-2122,U+2126-2127,U+212B,U+212E,U+2135,U+213B,U+2160-216B,U+2170-217B,U+2190-2199,U+21B8-21B9,U+21C4-21C6,U+21CB-21CC,U+21D0,U+21D2,U+21D4,U+21E6-21E9,U+21F5"}, "0022": {"file": "font-0022.woff2", "bytes": 6064, "hash": "6239af9769", "range": "U+2200,U+2202-2203,U+2205-220B,U+220F,U+2211-2213,U+2215,U+221A,U+221D-2220,U+2223,U+2225-222E,U+2234-2237,U+223D,U+2243,U+2245,U+2248,U+224C,U+2260-2262,U+2264-2267,U+226A-226B,U+226E-226F,U+2272-2273,U+2276-2277,U+2282-2287,U+228A-228B,U+2295-2299,U+22A0,U+22A5,U+22BF,U+22DA-22DB,U+22EF"}, "0023": {"file": "font-0023.woff2", "bytes": 2780, "hash": "f3cc1d2b85", "range": "U+2305-2307,U+2312,U+2318,U+2329-232A,U+23B0-23B1,U+23BE-23CC,U+23CE,U+23DA-23DB"}, "0024": {"file": "font-0024.woff2", "bytes": 17020, "hash": "5b22e9d9f2", "range": "U+2423,U+2460-24FF"}, "0025": {"file": "font-0025.woff2", "bytes": 5616, "hash": "d1d5c8c337", "range": "U+2500-25AB,U+25B1-25B3,U+25B6-25B7,U+25BC-25BD,U+25C0-25C1,U+25C6-25C7,U+25C9-25CC,U+25CE-25D3,U+25E2-25E6,U+25EF"}, "0026": {"file": "font-0026.woff2", "bytes": 10820, "hash": "a9dc19f5a4", "range": "U+2600-2603,U+2605-2606,U+2609,U+260E-260F,U+2616-2617,U+261C-261F,U+262F,U+2640-2642,U+2660-266F,U+2672-267D,U+26A0,U+26BD-26BE"}, "0027": {"file": "font-0027.woff2", "bytes": 4372, "hash": "cdf5b48fe3", "range": "U+2702,U+2713,U+271A,U+273D,U+273F-2740,U+2756,U+2776-2793,U+27A1"}, "0030": {"file": "font-0030.woff2", "bytes": 77924, "hash": "993e7e8303", "range": "U+3000,U+3002-300B,U+300E-300F,U+3012-303F,U+3041-3096,U+3099-30FF"}, "0034": {"file": "font-0034.woff2", "bytes": 84020, "hash": "0635a8a754", "range": "U+3400-34FF"}, "0035": {"file": "font-0035.woff2", "bytes": 90012, "hash": "eedc0b59d9", "range": "U+3500-35FF"}, "0036": {"file": "font-0036.woff2", "bytes": 99556, "hash": "884328eb04", "range": "U+3600-36FF"}, "0037": {"file": "font-0037.woff2", "bytes": 102296, "hash": "66230dc92e", "range": "U+3700-37FF"}, "0038": {"file": "font-0038.woff2", "bytes": 94072, "hash": "8a09742ee9", "range": "U+3800-38FF"}, "0039": {"file": "font-0039.woff2", "bytes": 91328, "hash": "9a54e001fd", "range": "U+3900-39FF"}, "003a": {"file": "font-003a.woff2", "bytes": 102192, "hash": "c3a88c97d7", "range": "U+3A00-3AFF"}, "003b": {"file": "font-003b.woff2", "bytes": 101976, "hash": "a2eac40b19", "range": "U+3B00-3BFF"}, "003c": {"file": "font-003c.woff2", "bytes": 96284, "hash": "d12597c20c", "range": "U+3C00-3CFF"}, "003d": {"file": "font-003d.woff2", "bytes": 118924, "hash": "1ae8b2d35d", "range": "U+3D00-3DFF"}, "003e": {"file": "font-003e.woff2", "bytes": 98936, "hash": "b944041176", "range": "U+3E00-3EFF"}, "003f": {"file": "font-003f.woff2", "bytes": 98720, "hash": "2b6639e853", "range": "U+3F00-3FFF"}, "0040": {"file": "font-0040.woff2", "bytes": 92628, "hash": "cc9ad87ebc", "range": "U+4000-40FF"}, "0041": {"file": "font-0041.woff2", "bytes": 93632, "hash": "cb50b05c09", "range": "U+4100-41FF"}, "0042": {"file": "font-0042.woff2", "bytes": 109716, "hash": "c3d0de2366", "range": "U+4200-42FF"}, "0043": {"file": "font-0043.woff2", "bytes": 105380, "hash": "6beb02b263", "range": "U+4300-43FF"}, "0044": {"file": "font-0044.woff2", "bytes": 101996, "hash": "3801e1c395", "range": "U+4400-44FF"}, "0045": {"file": "font-0045.woff2", "bytes": 127324, "hash": "eb77bd30e7", "range": "U+4500-45FF"}, "0046": {"file": "font-0046.woff2", "bytes": 99928, "hash": "f17c8ecd59", "range": "U+4600-46FF"}, "0047": {"file": "font-0047.woff2", "bytes": 103544, "hash": "5cd48f8998", "range": "U+4700-47FF"}, "0048": {"file": "font-0048.woff2", "bytes": 100216, "hash": "fe069b0ee3", "range": "U+4800-48FF"}, "0049": {"file": "font-0049.woff2", "bytes": 108076, "hash": "a0fe43fbb2", "range": "U+4900-49FF"}, "004a": {"file": "font-004a.woff2", "bytes": 112628, "hash": "650a2aee69", "range": "U+4A00-4AFF"}, "004b": {"file": "font-004b.woff2", "bytes": 119680, "hash": "5f4d36179a", "range": "U+4B00-4BFF"}, "004c": {"file": "font-004c.woff2", "bytes": 124956, "hash": "494816a1b3", "range": "U+4C00-4CFF"}, "004d": {"file": "font-004d.woff2", "bytes": 100152, "hash": "f75d88b843", "range": "U+4D00-4DBF"}, "004e": {"file": "font-004e.woff2", "bytes": 67520, "hash": "643f8bb571", "range": "U+4E02-4E06,U+4E08,U+4E0C,U+4E0F-4E12,U+4E15,U+4E17-4E19,U+4E1B,U+4E1E-4E2C,U+4E2E-4E33,U+4E35-4E38,U+4E3C,U+4E3E-4E44,U+4E46-4E48,U+4E4A,U+4E4C-4E4E,U+4E51-4E57,U+4E59-4E70,U+4E72-4E85,U+4E87-4E8A,U+4E8D,U+4E90,U+4E92-4E93,U+4E95-4EA0,U+4EA2-4EA3,U+4EA5-4EB9,U+4EBB-4EC0,U+4EC2-4EC6,U+4EC8-4EC9,U+4ECB-4ECD,U+4ECF-4ED8,U+4EDA-4EE2,U+4EE6-4EE9,U+4EEB-4EF6,U+4EF8-4EFF"}, "004f": {"file": "font-004f.woff2", "bytes": 83000, "hash": "9d982f43f9", "range": "U+4F00-4F09,U+4F0B-4F0F,U+4F11-4F17,U+4F19-4F1D,U+4F1F-4F23,U+4F25-4F4C,U+4F4E-4F52,U+4F54-4F58,U+4F5A-4F5B,U+4F5D-4F5F,U+4F61-4F68,U+4F6A-4F7E,U+4F80-4F8A,U+4F8C-4FB4,U+4FB6-4FDC,U+4FDE-4FE0,U+4FE2-4FED,U+4FEF-4FF0,U+4FF2-4FFF"}, "0050": {"file": "font-0050.woff2", "bytes": 146424, "hash": "aaf3ba7096", "range": "U+5000-5018,U+501A-5039,U+503B,U+503D,U+503F-5046,U+5048-505B,U+505D-507E,U+5081-50CE,U+50D0-50FF"}, "0051": {"file": "font-0051.woff2", "bytes": 129432, "hash": "fc3ad00e8d", "range": "U+5100-511A,U+511C-513E,U+5140-5142,U+5144-5145,U+5147,U+514A,U+514C-515B,U+515D-5164,U+5166-5167,U+5169-516A,U+516C-516F,U+5172-5173,U+517A,U+517C-5184,U+5186-518C,U+518E-5194,U+5196-5198,U+519A,U+519C-519F,U+51A1,U+51A3-51A4,U+51A6-51AB,U+51AD-51AF,U+51B1,U+51B4-51B6,U+51B8-51BA,U+51BC,U+51BE-51BF,U+51C1-51C3,U+51C5,U+51C7-51CA,U+51CD-51DA,U+51DC,U+51DE-51EC,U+51EE-51F5,U+51F7-51F9,U+51FC-51FF"}, "0052": {"file": "font-0052.woff2", "bytes": 125972, "hash": "2a1d78820c", "range": "U+5201-5202,U+5204-5205,U+5208-5216,U+5218,U+521A,U+521C,U+521E-5223,U+5225-522A,U+522C-522F,U+5231-5235,U+5238,U+523C-524C,U+524E-5250,U+5252-5255,U+5257-5266,U+5268-5269,U+526B-5271,U+5273-529A,U+529C-529E,U+52A1-52A7,U+52A9-52AA,U+52AC-52B0,U+52B2-52BD,U+52C0-52C6,U+52C8-52D7,U+52D9-52FF"}, "0053": {"file": "font-0053.woff2", "bytes": 99376, "hash": "78048848f6", "range": "U+5300-5315,U+5317-5322,U+5324-533E,U+5340-5342,U+5344-5346,U+5348-5349,U+534B-534D,U+5350-5354,U+5356-535B,U+535D-5360,U+5362-5365,U+5367-536A,U+536C-5372,U+5374-5385,U+5387-5388,U+538A,U+538C-539E,U+53A0-53BA,U+53BC-53C1,U+53C3-53CB,U+53CE-53D0,U+53D2-53D5,U+53D7,U+53DA-53E2,U+53E5-53E8,U+53EA-53EB,U+53ED-53EE,U+53F1,U+53F3-53F5,U+53F8,U+53FA-53FF"}, "0054": {"file": "font-0054.woff2", "bytes": 79736, "hash": "d43ab4704c", "range": "U+5400-5402,U+5404-5407,U+5409-540B,U+540F-5410,U+5412-541E,U+5420-5426,U+5428-542B,U+542D-542E,U+5430-5449,U+544B-5452,U+5454-545B,U+545D-5461,U+5463-5467,U+5469-547B,U+547E-5485,U+5487-548B,U+548D-548E,U+5490-54A8,U+54AA-54AB,U+54AD-54B1,U+54B3-54BA,U+54BC-54CC,U+54CE-54D1,U+54D3-54E9,U+54EB-54ED,U+54EF-54FF"}, "0055": {"file": "font-0055.woff2", "bytes": 135052, "hash": "c1924a1ef6", "range": "U+5500-5523,U+5525-5530,U+5532-5549,U+554B-5577,U+5579-557A,U+557C-557D,U+557F-5582,U+5585-559B,U+559D-55A6,U+55A8-55B6,U+55B8-55FF"}, "0056": {"file": "font-0056.woff2", "bytes": 175348, "hash": "4f2a7b9d5d", "range": "U+5600-5608,U+560A-562C,U+562E-5667,U+5669-566B,U+566D-56D9,U+56DC-56DD,U+56DF-56F3,U+56F5-56F9,U+56FB-56FD,U+56FF"}, "0057": {"file": "font-0057.woff2", "bytes": 99152, "hash": "a2346507bc", "range": "U+5700-5705,U+5707,U+5709-571E,U+5720-5722,U+5724-5727,U+5729-572F,U+5731-5739,U+573B-574C,U+574F-575F,U+5761-5781,U+5783-578A,U+578C-579F,U+57A1-57DE,U+57E0-57F9,U+57FB-57FF"}, "0058": {"file": "font-0058.woff2", "bytes": 159112, "hash": "392bf9e4d0", "range": "U+5800-5801,U+5803-5853,U+5855-5882,U+5884-589D,U+58A0-58A7,U+58A9-58D0,U+58D2-58EA,U+58EC-58EF,U+58F1-58FF"}, "0059": {"file": "font-0059.woff2", "bytes": 147452, "hash": "5dde43c0bb", "range": "U+5900-5906,U+5908-590C,U+590E,U+5910-5914,U+5917-5919,U+591B,U+591D-5926,U+5928,U+592B-5930,U+5932-5933,U+5935-5946,U+594A,U+594C-594E,U+5950-5953,U+5956-5964,U+5966-597C,U+597E-5981,U+5983,U+5985-5998,U+599A-59AD,U+59AF-59CA,U+59CC-59FF"}, "005a": {"file": "font-005a.woff2", "bytes": 218616, "hash": "02a04e139d", "range": "U+5A00,U+5A02-5A04,U+5A06-5A1B,U+5A1D-5AFF"}, "005b": {"file": "font-005b.woff2", "bytes": 197472, "hash": "cb30e97984", "range": "U+5B00-5B4F,U+5B51-5B56,U+5B59-5B63,U+5B65,U+5B67-5B80,U+5B82-5B86,U+5B8A-5B8B,U+5B8D-5B98,U+5B9B-5B9D,U+5B9F-5BA0,U+5BA2,U+5BA4-5BAA,U+5BAC-5BB2,U+5BB6-5BB8,U+5BBA-5BC1,U+5BC3-5BD1,U+5BD4-5BDE,U+5BE0-5BEF,U+5BF1-5BF8,U+5BFA,U+5BFD-5BFF"}, "005c": {"file": "font-005c.woff2", "bytes": 128684, "hash": "635968b7d2", "range": "U+5C00-5C03,U+5C05,U+5C07-5C0E,U+5C10-5C13,U+5C15-5C17,U+5C19-5C23,U+5C25-5C3C,U+5C3F,U+5C41-5C44,U+5C46-5C47,U+5C49-5C4A,U+5C4C-5C4E,U+5C50-5C54,U+5C56-5C5D,U+5C5F-5C70,U+5C72-5C80,U+5C82-5C99,U+5C9B-5CB7,U+5CB9-5CFF"}, "005d": {"file": "font-005d.woff2", "bytes": 197368, "hash": "50ff5ef493", "range": "U+5D00-5D28,U+5D2A-5D81,U+5D83-5DDC,U+5DDF-5DE0,U+5DE2-5DF0,U+5DF3-5DFF"}, "005e": {"file": "font-005e.woff2", "bytes": 146500, "hash": "919c81afad", "range": "U+5E00-5E02,U+5E04-5E07,U+5E09-5E0B,U+5E0D-5E14,U+5E16-5E26,U+5E28-5E2D,U+5E2F-5E36,U+5E39-5E54,U+5E56-5E71,U+5E73-5E75,U+5E77-5E7A,U+5E7C,U+5E7E,U+5E80-5E8E,U+5E90-5E93,U+5E95-5EA5,U+5EA7-5EF5,U+5EF7-5EFF"}, "005f": {"file": "font-005f.woff2", "bytes": 135224, "hash": "8df69e1f9a", "range": "U+5F01,U+5F03-5F0A,U+5F0C-5F0E,U+5F10,U+5F12,U+5F14,U+5F16,U+5F18-5F24,U+5F27-5F38,U+5F3B-5F51,U+5F54,U+5F56-5F61,U+5F63-5F68,U+5F6A-5F70,U+5F72-5F78,U+5F7A,U+5F7D-5F7F,U+5F82-5F84,U+5F86-5F89,U+5F8C-5F97,U+5F99-5FA0,U+5FA2-5FA9,U+5FAB-5FAD,U+5FAF-5FC2,U+5FC4,U+5FC7-5FCB,U+5FCD-5FD1,U+5FD3-5FD6,U+5FDA-5FDF,U+5FE1-5FE6,U+5FE8-5FF4,U+5FF6-5FFF"}, "0060": {"file": "font-0060.woff2", "bytes": 111672, "hash": "922009b0fc", "range": "U+6002-6011,U+6013-601C,U+601E-6024,U+6026,U+6028-603A,U+603C-6051,U+6053-6061,U+6063-6068,U+606A-606E,U+6070-6075,U+6077-6088,U+608A-6095,U+6097-609E,U+60A1-60AB,U+60AD-60B1,U+60B3-60C4,U+60C6-60C9,U+60CB-60E6,U+60E8-60F2,U+60F4-60FF"}, "0061": {"file": "font-0061.woff2", "bytes": 197540, "hash": "1e019794f5", "range": "U+6100-610E,U+6110-611E,U+6120-613E,U+6140-6147,U+6149-61FF"}, "0062": {"file": "font-0062.woff2", "bytes": 105184, "hash": "3c446b30d0", "range": "U+6200-6207,U+6209-620E,U+6212-6215,U+6217,U+6219-622D,U+622F-6233,U+6235-6236,U+6238-623F,U+6241-6248,U+624A,U+624C-6250,U+6252,U+6254-6266,U+6268,U+626A,U+626D-626E,U+6271-6272,U+6274-627E,U+6281-6282,U+6284-6292,U+6294-6297,U+6299-62A3,U+62A5-62C8,U+62CA-62CC,U+62CE-62D5,U+62D7-62DE,U+62E0-62E1,U+62E3-62E8,U+62EA-62EC,U+62EE-62F2,U+62F4-62FF"}, "0063": {"file": "font-0063.woff2", "bytes": 131524, "hash": "93645a300a", "range": "U+6300,U+6302-6306,U+6308,U+630A-6310,U+6312-631E,U+6320-6324,U+6326-632E,U+6330-633C,U+633E-6361,U+6363-636D,U+636F-637F,U+6381-638B,U+638D-639F,U+63A1,U+63A4,U+63A6,U+63AA-63CF,U+63D1-63FF"}, "0064": {"file": "font-0064.woff2", "bytes": 200984, "hash": "7e3a96eed0", "range": "U+6400-642C,U+642E-6439,U+643B-6443,U+6445-6446,U+6448-6494,U+6496-649D,U+649F-64A3,U+64A5-64CD,U+64CF-64FF"}, "0065": {"file": "font-0065.woff2", "bytes": 167316, "hash": "dcb442d5c8", "range": "U+6500-652E,U+6530-6535,U+6537-6538,U+653A,U+653C-653D,U+653F-6544,U+6546-6547,U+6549-654B,U+654D-6550,U+6552-655A,U+655C-6562,U+6564-656B,U+656D-656F,U+6571-6573,U+6575-658F,U+6592-6596,U+6598-65A3,U+65A5-65A8,U+65AA-65AC,U+65AE,U+65B1-65B8,U+65BA-65C4,U+65C6-65CA,U+65CC-65DF,U+65E1-65E4,U+65E6-65F5,U+65F7-65FF"}, "0066": {"file": "font-0066.woff2", "bytes": 131264, "hash": "cf32055d7e", "range": "U+6600-6601,U+6603-660D,U+6610-6612,U+6614-6618,U+661A-661E,U+6620-6624,U+6626-662C,U+662E-663B,U+663D,U+663F-6642,U+6644-6652,U+6654-6665,U+6667,U+6669-666D,U+6670-6696,U+6698-669C,U+669E-66B3,U+66B5-66DB,U+66DD-66F1,U+66F3,U+66F5-66FB,U+66FD-66FE"}, "0067": {"file": "font-0067.woff2", "bytes": 92192, "hash": "fbe7bbab26", "range": "U+6701-6707,U+670A-6713,U+6715-671A,U+671C-671E,U+6720-6727,U+6729,U+672D-672E,U+6730,U+6732-6739,U+673B-673C,U+673E-673F,U+6741-6742,U+6744-675E,U+6760,U+6762-6764,U+6766-677E,U+6780,U+6782-6783,U+6785-6794,U+6796,U+6798-679B,U+679E-67A1,U+67A3-67A9,U+67AB-67AE,U+67B0-67D2,U+67D5-67E4,U+67E6-67FF"}, "0068": {"file": "font-0068.woff2", "bytes": 122324, "hash": "1cfceb169c", "range": "U+6800-6806,U+6808-6815,U+6817-6820,U+6822-6837,U+6839-683B,U+683D-6842,U+6844-6847,U+6849-6862,U+6864-68A5,U+68A7-68D7,U+68D9-68F0,U+68F2-68FF"}, "0069": {"file": "font-0069.woff2", "bytes": 160940, "hash": "b9a862694e", "range": "U+6900-690C,U+690E-692F,U+6931-693E,U+6940-6953,U+6955-697B,U+697D-69FF"}, "006a": {"file": "font-006a.woff2", "bytes": 199376, "hash": "f507116576", "range": "U+6A00-6A20,U+6A22-6A30,U+6A32-6AFF"}, "006b": {"file": "font-006b.woff2", "bytes": 171556, "hash": "f511958618", "range": "U+6B00-6B20,U+6B23-6B39,U+6B3B-6B4B,U+6B4D-6B61,U+6B67-6B7A,U+6B7C-6B89,U+6B8C-6B91,U+6B93-6B9A,U+6B9C-6BB4,U+6BB6,U+6BB8-6BBE,U+6BC0,U+6BC2-6BCE,U+6BD0-6BD3,U+6BD5-6BFF"}, "006c": {"file": "font-006c.woff2", "bytes": 98436, "hash": "85e14ea8c2", "range": "U+6C00-6C13,U+6C15-6C33,U+6C35-6C37,U+6C39-6C41,U+6C43-6C4F,U+6C51-6C63,U+6C65-6C71,U+6C73-6C88,U+6C8A-6C8B,U+6C8D-6CA0,U+6CA2-6CA6,U+6CA8-6CAA,U+6CAC-6CBA,U+6CBC-6CC8,U+6CCB-6CD4,U+6CD6-6CDA,U+6CDC-6CDF,U+6CE2-6CE7,U+6CE9-6CFC,U+6CFE-6CFF"}, "006d": {"file": "font-006d.woff2", "bytes": 115592, "hash": "84b6f17dc6", "range": "U+6D00-6D10,U+6D12-6D1A,U+6D1C-6D1D,U+6D1F-6D3A,U+6D3C-6D3D,U+6D3F-6D40,U+6D42-6D4A,U+6D4C-6D4D,U+6D50-6D62,U+6D64-6D68,U+6D6B-6D6D,U+6D6F-6D76,U+6D78-6D81,U+6D83-6D87,U+6D8A-6D8B,U+6D8D-6D9A,U+6D9C-6D9E,U+6DA0,U+6DA2-6DA3,U+6DA5,U+6DA9-6DE0,U+6DE2-6DF0,U+6DF2-6DF6,U+6DF8-6DFF"}, "006e": {"file": "font-006e.woff2", "bytes": 151240, "hash": "d8be12f46d", "range": "U+6E00-6E04,U+6E06-6E09,U+6E0B,U+6E0D-6E20,U+6E22-6E37,U+6E39-6E5A,U+6E5C-6E6D,U+6E6F-6E84,U+6E86-6E8F,U+6E91-6EA1,U+6EA3-6EAE,U+6EB0-6EB9,U+6EBB-6EE0,U+6EE2-6EFF"}, "006f": {"file": "font-006f.woff2", "bytes": 187488, "hash": "a9a60ee627", "range": "U+6F00-6F01,U+6F03-6F13,U+6F15-6F28,U+6F2C-6F30,U+6F32-6F5B,U+6F5D-6F6D,U+6F6F-6F9B,U+6F9D-6FBF,U+6FC1-6FD1,U+6FD3-6FEE,U+6FF0-6FFF"}, "0070": {"file": "font-0070.woff2", "bytes": 188688, "hash": "5aa8b58fea", "range": "U+7000-7019,U+701B-706A,U+706C,U+706E,U+7070-7074,U+7076-707B,U+707D-7080,U+7082-708D,U+708F-70B2,U+70B4-70B7,U+70BA-70BB,U+70BE-70C0,U+70C2-70C7,U+70C9-70DE,U+70E0-70EB,U+70EE-70FF"}, "0071": {"file": "font-0071.woff2", "bytes": 195776, "hash": "2f156dacb1", "range": "U+7100-7108,U+710A-7119,U+711B-7125,U+7127-712F,U+7131-714B,U+714D-715D,U+715F-7166,U+7168-7193,U+7195-719F,U+71A1-71C2,U+71C4-71CD,U+71CF-71D4,U+71D6-71E6,U+71E8-71FF"}, "0072": {"file": "font-0072.woff2", "bytes": 160852, "hash": "0da6df6194", "range": "U+7200-7205,U+7207-7229,U+722B-7230,U+7232-7246,U+7248-7258,U+725A-7268,U+726A-7274,U+7276-7278,U+727A-72AB,U+72AD-72B8,U+72BA-72C1,U+72C3-72E8,U+72EA-72EB,U+72ED,U+72EF-72F0,U+72F2-72FB,U+72FD-72FF"}, "0073": {"file": "font-0073.woff2", "bytes": 136436, "hash": "a316ad1e04", "range": "U+7300-730D,U+730F-735F,U+7361-7383,U+7385-7386,U+7388,U+738A-73AE,U+73B0-73BA,U+73BC-73C1,U+73C3-73CC,U+73CE-73FF"}, "0074": {"file": "font-0074.woff2", "bytes": 175428, "hash": "4d8017730f", "range": "U+7400-7404,U+7407-7432,U+7434-743B,U+743D-7459,U+745B-745E,U+7460-747D,U+747F,U+7481-74A7,U+74A9-74FF"}, "0075": {"file": "font-0075.woff2", "bytes": 133920, "hash": "2816d9743b", "range": "U+7500-751E,U+7520-7527,U+7529-7530,U+7532-7534,U+7536-753A,U+753C-754B,U+754D-7558,U+755A-7564,U+7566-758E,U+7590-7596,U+7598-75BD,U+75BF-75D4,U+75D6-75FF"}, "0076": {"file": "font-0076.woff2", "bytes": 171476, "hash": "a8d8e587af", "range": "U+7600-7633,U+7635-767A,U+767C,U+767F-7683,U+7685-76C7,U+76C9-76D7,U+76D9-76DA,U+76DC-76DE,U+76E0-76ED,U+76EF-76F3,U+76F5-76F7,U+76F9-76FF"}, "0077": {"file": "font-0077.woff2", "bytes": 133328, "hash": "23824865bf", "range": "U+7700-770A,U+770C-771E,U+7721-773B,U+773D-773F,U+7741-7760,U+7762-7783,U+7785-7790,U+7792-77A6,U+77A8-77AB,U+77AD-77E4,U+77E6-77E8,U+77EA-77EC,U+77EF-77FF"}, "0078": {"file": "font-0078.woff2", "bytes": 129664, "hash": "72661b70c0", "range": "U+7800,U+7802-782F,U+7831-7833,U+7835-783F,U+7841-786B,U+786D,U+786F-788D,U+788F-78A6,U+78A8-78AF,U+78B1-78C0,U+78C2-78FF"}, "0079": {"file": "font-0079.woff2", "bytes": 153416, "hash": "ad090ebeed", "range": "U+7900-7939,U+793B,U+793D-7947,U+7949-795A,U+795C,U+795F-796C,U+796E,U+7970-7976,U+7978-79BA,U+79BC-79CA,U+79CC,U+79CE-79D1,U+79D3-79E6,U+79E8-79EF,U+79F1-79FA,U+79FC-79FF"}, "007a": {"file": "font-007a.woff2", "bytes": 193860, "hash": "df77ec7eaf", "range": "U+7A00-7A0A,U+7A0C,U+7A0E-7A13,U+7A15-7A56,U+7A58-7A78,U+7A7B-7A7E,U+7A80,U+7A82-7A96,U+7A98-7ACA,U+7ACC-7ADE,U+7AE1-7AF8,U+7AFA-7AFF"}, "007b": {"file": "font-007b.woff2", "bytes": 172736, "hash": "58a8abd96d", "range": "U+7B00-7B13,U+7B15-7B25,U+7B27-7B2B,U+7B2D-7B48,U+7B4A-7B53,U+7B55,U+7B57-7B96,U+7B98-7BA0,U+7BA2-7BE0,U+7BE2-7BFF"}, "007c": {"file": "font-007c.woff2", "bytes": 228764, "hash": "0ca73e0286", "range": "U+7C00-7C06,U+7C08-7C7A,U+7C7C-7C88,U+7C8A-7CBB,U+7CBD,U+7CBF-7CFF"}, "007d": {"file": "font-007d.woff2", "bytes": 193844, "hash": "3e03011041", "range": "U+7D00-7D5B,U+7D5D-7DFF"}, "007e": {"file": "font-007e.woff2", "bytes": 211564, "hash": "8528de98bc", "range": "U+7E00-7E40,U+7E42-7EA1,U+7EA3-7EA5,U+7EA8-7EB4,U+7EB6,U+7EB8,U+7EBA-7EBE,U+7EC0-7EC2,U+7EC5-7EC6,U+7EC9-7ECD,U+7ECF-7ED2,U+7ED4,U+7ED6-7ED7,U+7ED9-7EDB,U+7EDF-7EE0,U+7EE2-7EEC,U+7EF0-7EF3,U+7EF5-7EFC,U+7EFE-7EFF"}, "007f": {"file": "font-007f.woff2", "bytes": 177244, "hash": "a68ddf02c0", "range": "U+7F00-7F03,U+7F05-7F07,U+7F0A-7F15,U+7F17,U+7F19-7F1C,U+7F1E-7F1F,U+7F21-7F24,U+7F26-7F28,U+7F2A-7F2C,U+7F2E-7F50,U+7F52-7F56,U+7F58-7F59,U+7F5B-7F60,U+7F62-7F69,U+7F6B-7F6D,U+7F6F-7F71,U+7F73-7F89,U+7F8B-7F8D,U+7F8F-7FA3,U+7FA5-7FBC,U+7FBE-7FCD,U+7FCF-7FDF,U+7FE1-7FE8,U+7FEA-7FEF,U+7FF1-7FFA,U+7FFD-7FFF"}, "0080": {"file": "font-0080.woff2", "bytes": 158352, "hash": "4be33da913", "range": "U+8001-8004,U+8006-800B,U+800D-8053,U+8055-8059,U+805B-8082,U+8084-80A0,U+80A2-80A8,U+80AA-80B1,U+80B3-80C5,U+80C7-80E0,U+80E2-80FC,U+80FE-80FF"}, "0081": {"file": "font-0081.woff2", "bytes": 206452, "hash": "cadf89f338", "range": "U+8100-8108,U+810B-817E,U+8180-819A,U+819C-81C1,U+81C3-81E9,U+81EB-81F2,U+81F5-81FA,U+81FC-81FF"}, "0082": {"file": "font-0082.woff2", "bytes": 167568, "hash": "85a05bee11", "range": "U+8200-820C,U+820E-821D,U+821F-8229,U+822B,U+822D-8238,U+823A-8271,U+8273-8279,U+827B-8281,U+8283-8291,U+8293-82B0,U+82B2,U+82B4-82B6,U+82B8-82CC,U+82CE-82D6,U+82D8-82E4,U+82E6-82F0,U+82F2-82FF"}, "0083": {"file": "font-0083.woff2", "bytes": 152644, "hash": "c6211cbf56", "range": "U+8300-831B,U+831D-8348,U+834A-8351,U+8353-8360,U+8362,U+8364-8366,U+8368-8376,U+8378-8388,U+838A-83AA,U+83AC-83B0,U+83B2-83C7,U+83C9-83F1,U+83F3-83FF"}, "0084": {"file": "font-0084.woff2", "bytes": 201712, "hash": "dcc4da3f25", "range": "U+8400-843C,U+843E-846B,U+846D-8498,U+849A-84C3,U+84C5-84DC,U+84DE-84FF"}, "0085": {"file": "font-0085.woff2", "bytes": 268704, "hash": "58f92d1801", "range": "U+8500-8512,U+8514-8549,U+854B-857D,U+857F-85CE,U+85D0-85FF"}, "0086": {"file": "font-0086.woff2", "bytes": 191016, "hash": "0b42d54296", "range": "U+8600-8659,U+865B-8678,U+867A-867F,U+8681-86EF,U+86F1-86FF"}, "0087": {"file": "font-0087.woff2", "bytes": 181916, "hash": "84dc571efb", "range": "U+8700-8702,U+8704-871B,U+871D-8775,U+8777-878C,U+878E-87DF,U+87E1-87FF"}, "0088": {"file": "font-0088.woff2", "bytes": 186424, "hash": "17460d0d52", "range": "U+8800-8821,U+8823-883F,U+8841-884B,U+884E-8853,U+8855-8860,U+8862,U+8864,U+8866-888C,U+888E-88AC,U+88AE-88C0,U+88C3-88C4,U+88C6-88FF"}, "0089": {"file": "font-0089.woff2", "bytes": 215224, "hash": "93e132f302", "range": "U+8900-897E,U+8980,U+8982-8985,U+8987-89C0,U+89C3,U+89C5,U+89C7,U+89CA-89D1,U+89D3-89E2,U+89E4-89E5,U+89E7-89FF"}, "008a": {"file": "font-008a.woff2", "bytes": 161020, "hash": "b48c72735a", "range": "U+8A01-8A92,U+8A94-8AFF"}, "008b": {"file": "font-008b.woff2", "bytes": 194872, "hash": "67f835d8a9", "range": "U+8B00-8BA0,U+8BA2-8BA3,U+8BA5-8BA8,U+8BAA-8BAD,U+8BAF,U+8BB1-8BB7,U+8BB9,U+8BBB-8BBD,U+8BC2-8BC3,U+8BC5-8BD0,U+8BD2-8BD4,U+8BD6,U+8BD8-8BDA,U+8BDC-8BDD,U+8BDF-8BE4,U+8BE6-8BEC,U+8BEE-8BF6,U+8BF9,U+8BFC-8BFF"}, "008c": {"file": "font-008c.woff2", "bytes": 137060, "hash": "7d2f18eb74", "range": "U+8C00-8C02,U+8C04-8C0A,U+8C0C-8C0D,U+8C0F,U+8C11-8C21,U+8C23-8C27,U+8C29-8C30,U+8C32-8C36,U+8C38-8C60,U+8C62-8CFF"}, "008d": {"file": "font-008d.woff2", "bytes": 132916, "hash": "027d0cad46", "range": "U+8D00-8D1C,U+8D1E,U+8D20-8D24,U+8D26,U+8D29-8D2E,U+8D30-8D4A,U+8D4C-8D4D,U+8D4F-8D5A,U+8D5C,U+8D5F,U+8D61-8D63,U+8D65,U+8D67-8D6A,U+8D6C-8D6F,U+8D71-8D73,U+8D75-8D76,U+8D78-8D84,U+8D86-8D89,U+8D8C-8DA2,U+8DA4-8DB2,U+8DB4-8DC2,U+8DC4-8DDC,U+8DDE-8DEE,U+8DF0-8DF8,U+8DFA-8DFF"}, "008e": {"file": "font-008e.woff2", "bytes": 180568, "hash": "7b21008604", "range": "U+8E00-8E0E,U+8E10-8E50,U+8E52-8EA2,U+8EA4-8EAA,U+8EAC-8EFF"}, "008f": {"file": "font-008f.woff2", "bytes": 155892, "hash": "8922a91375", "range": "U+8F00-8F67,U+8F69-8F6B,U+8F6D,U+8F71-8F73,U+8F75-8F7A,U+8F7C,U+8F7E-8F88,U+8F8A-8F8C,U+8F8E-8F90,U+8F92,U+8F94-8F9D,U+8F9F-8FB8,U+8FBA-8FBD,U+8FBF-8FC4,U+8FC6,U+8FC8-8FCD,U+8FCF,U+8FD2-8FD3,U+8FD5-8FD7,U+8FDA,U+8FDD,U+8FDF-8FE9,U+8FEC-8FFC,U+8FFE-8FFF"}, "0090": {"file": "font-0090.woff2", "bytes": 189748, "hash": "5b7d94795d", "range": "U+9000,U+9002,U+9004-9005,U+9007-9008,U+900A-900F,U+9011,U+9013,U+9015-9019,U+901B-901C,U+901E,U+9020-9021,U+9023-9040,U+9043-9052,U+9054-9056,U+9058-907E,U+9080-90A2,U+90A4-90A9,U+90AB-90C0,U+90C2-90FF"}, "0091": {"file": "font-0091.woff2", "bytes": 195252, "hash": "b4b2884366", "range": "U+9100-9149,U+914B-914C,U+914E-9162,U+9164-9168,U+916A-9191,U+9193-91C8,U+91CB,U+91CE-91D0,U+91D2-91FF"}, "0092": {"file": "font-0092.woff2", "bytes": 125268, "hash": "235b2884f4", "range": "U+9200-9273,U+9275-92FF"}, "0093": {"file": "font-0093.woff2", "bytes": 194964, "hash": "8ab01e2f65", "range": "U+9300-93FF"}, "0094": {"file": "font-0094.woff2", "bytes": 166696, "hash": "515b2316eb", "range": "U+9400-949E,U+94A0-94A1,U+94A3-94A6,U+94A8-94C0,U+94C2-94D6,U+94D8-94F7,U+94F9-94FD,U+94FF"}, "0095": {"file": "font-0095.woff2", "bytes": 114400, "hash": "f2144b9b12", "range": "U+9500,U+9502-950A,U+950C-950F,U+9511-9518,U+951B-952E,U+9530-9546,U+9548-955B,U+955D-956C,U+956E-956F,U+9571-957E,U+9580-95E7,U+95E9,U+95EB-95ED,U+95EF-95F1,U+95F3,U+95F5-95F8,U+95FA-95FF"}, "0096": {"file": "font-0096.woff2", "bytes": 146436, "hash": "3d2f19a39e", "range": "U+9600-9607,U+9609-9618,U+961A-961E,U+9620-9631,U+9636-9645,U+9647,U+9649-964C,U+964E-964F,U+9651-9667,U+9669-9676,U+9678-968E,U+9691-9698,U+969A-96BD,U+96BF-96C3,U+96C5,U+96C7-96DF,U+96E1-96E7,U+96E9,U+96EB-96F5,U+96F8-96FD,U+96FF"}, "0097": {"file": "font-0097.woff2", "bytes": 227412, "hash": "a31fdadac4", "range": "U+9700,U+9702-9703,U+9705,U+9708-9712,U+9714-9715,U+9717-971B,U+971D,U+971F-9731,U+9733-9751,U+9753-9758,U+975A-9761,U+9763-9775,U+9777-97F2,U+97F4,U+97F7-97FF"}, "0098": {"file": "font-0098.woff2", "bytes": 160464, "hash": "d6c5f9d85b", "range": "U+9800-9874,U+9877-9878,U+987A-987D,U+987F-9881,U+9883,U+9885,U+9887-988F,U+9892-989B,U+989E-98CD,U+98CF-98D2,U+98D4-98DD,U+98DF-98E7,U+98E9-98FF"}, "0099": {"file": "font-0099.woff2", "bytes": 197200, "hash": "e236842103", "range": "U+9900-996D,U+996F,U+9971-9974,U+9976-9987,U+9989-99FF"}, "009a": {"file": "font-009a.woff2", "bytes": 219564, "hash": "dae648f65a", "range": "U+9A00-9A6C,U+9A6E-9A70,U+9A72,U+9A74-9A7A,U+9A7C-9A86,U+9A88-9A8B,U+9A8D-9A90,U+9A92-9A96,U+9A98-9AA7,U+9AA9-9AB7,U+9AB9-9AD2,U+9AD4-9AD7,U+9AD9-9AFF"}, "009b": {"file": "font-009b.woff2", "bytes": 202604, "hash": "76444bf2bc", "range": "U+9B00-9B3B,U+9B3D-9B41,U+9B43,U+9B46,U+9B48,U+9B4A-9B4C,U+9B4E-9B50,U+9B52-9B53,U+9B55-9BFF"}, "009c": {"file": "font-009c.woff2", "bytes": 169980, "hash": "43e996df72", "range": "U+9C00-9CDD,U+9CDF-9CFF"}, "009d": {"file": "font-009d.woff2", "bytes": 189624, "hash": "4d19fcdc48", "range": "U+9D00-9DFF"}, "009e": {"file": "font-009e.woff2", "bytes": 236648, "hash": "11416988f8", "range": "U+9E00-9E22,U+9E24-9E63,U+9E65-9EC3,U+9EC5-9ECD,U+9ECF-9ED0,U+9ED2-9ED7,U+9ED9-9EEE,U+9EF0-9EFF"}, "009f": {"file": "font-009f.woff2", "bytes": 219760, "hash": "52a7dcc49d", "range": "U+9F00-9F0D,U+9F0F-9F12,U+9F14-9F4F,U+9F51-9F7E,U+9F80-9F98,U+9F9A-9FFF"}, "00ff": {"file": "font-00ff.woff2", "bytes": 31060, "hash": "5a60828b91", "range": "U+FF02-FF0B,U+FF0D-FF19,U+FF1B-FF1E,U+FF20-FFBE,U+FFC2-FFC7,U+FFCA-FFCF,U+FFD2-FFD7,U+FFDA-FFDC,U+FFE0-FFE6,U+FFE8-FFEE"}}};
  // Only the glyph partitions used by visible card text are fetched.
  const baseGlyphs=new Set(FONT_INDEX.base),fontLoads=new Map(),loadedFonts=new Set();
  let wantedFonts=[],fontFailed=false;
  function bounded(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(message)),ms))]).finally(()=>clearTimeout(timer));}
  function fontProgress(){
    if(fontFailed)return;
    const done=wantedFonts.filter(k=>loadedFonts.has(k)).length;
    $('font-status').textContent=done===wantedFonts.length?'卡片字体已就绪':`正在加载卡片字体 ${done}/${wantedFonts.length}，可继续操作…`;
  }
  function loadFont(key){
    if(loadedFonts.has(key))return Promise.resolve();
    if(fontLoads.has(key))return fontLoads.get(key);
    const item=FONT_INDEX.chunks[key],controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    const promise=(async()=>{
      try{
        const response=await fetch(`assets/character-card/${item.file}?v=${item.hash}`,{signal:controller.signal});
        if(!response.ok)throw Error('字体请求失败');
        const bytes=await response.arrayBuffer();
        const face=new FontFace('CardSerif',bytes,{unicodeRange:item.range,weight:'100 900'});
        await bounded(face.load(),4000,'字体解析超时');document.fonts.add(face);loadedFonts.add(key);fontProgress();
      }catch(e){throw Error(e.name==='AbortError'?'字体加载超时':e.message);}
      finally{clearTimeout(timeout);fontLoads.delete(key);}
    })();
    fontLoads.set(key,promise);return promise;
  }
  async function ensureCardFonts(){
    if(!currentData)return;
    const value=layer.find('Text').map(n=>n.text()).join('');
    wantedFonts=[...new Set([...value].map(c=>{const cp=c.codePointAt(0);return baseGlyphs.has(cp)?'base':Math.floor(cp/256).toString(16).padStart(4,'0');}).filter(k=>FONT_INDEX.chunks[k]))];
    fontFailed=false;$('font-retry').hidden=true;fontProgress();
    try{await Promise.all(wantedFonts.map(loadFont));if(currentData){renderCard();fit();}fontProgress();}
    catch(e){fontFailed=true;$('font-status').textContent=e.message+'，预览暂用系统字体；请重试后导出';$('font-retry').hidden=false;throw e;}
  }
  let decorationPromise;
  function ensureDecorations(){
    if(!decorationPromise)decorationPromise=Promise.all(Object.entries({...window.CARD_ASSETS,statHp:'assets/icons/panel/hp.png',statDef:'assets/icons/panel/def.png'}).map(async([k,v])=>images[k]=await imageFrom(v))).catch(e=>{decorationPromise=null;throw e;});
    return decorationPromise;
  }

  function sourceApi(){try{
    if(new URLSearchParams(location.search).get('studio')==='1'&&window.parent!==window&&window.parent.location.origin===location.origin)return window.parent.__WC?.MobileStudio?.characterCard()||null;
    return !window.opener?.closed&&window.opener?.location.origin===location.origin?window.opener.__WC?.CharacterCard:null;
  }catch{return null;}}
  let calculating=false,visualLoading=false,viewVersion=0,missingImages=[];
  const imageCache=new Map();
  function setDownloadDisabled(disabled){
    for(const button of document.querySelectorAll('[data-card-download]'))button.disabled=disabled;
  }
  function updateDownload(){
    const reason=exporting?'正在生成图片…':energyUpdating||currentData?.energy?.status==='updating'?'正在更新回能判定…':calculating?'全队计算中，完成后可下载':visualLoading?'图片正在载入…':missingImages.length?'图片未载入完整，请先重试':!currentData?.scoreReady||!currentData?.echoScoreReady?'请先完成计算，再下载图片':'';
    setDownloadDisabled(Boolean(reason));
    $('download-status').textContent=reason||'已就绪，选择尺寸后即可下载 PNG';
  }
  function refreshMembers(){
    const api=sourceApi();if(!api||calculating)return;
    const select=$('member'),list=api.members(),old=select.selectedOptions[0]?.dataset.id;
    if(JSON.stringify(list)===select.dataset.roster)return;
    select.replaceChildren();for(const m of list){const o=document.createElement('option');o.value=m.index;o.dataset.id=m.id;o.textContent=m.name;select.append(o);if(m.id===old)o.selected=true;}
    select.dataset.roster=JSON.stringify(list);setDownloadDisabled(true);
  }
  function energyKey(){return $('member').value+':'+($('member').selectedOptions[0]?.dataset.id||'');}
  function syncEnergyControl(data){
    const energy=data.energy||{},select=$('energy-round'),count=energy.roundCount||1;
    select.replaceChildren();
    for(let round=1;round<=count;round++){const option=document.createElement('option');option.value=round;option.textContent='第 '+round+' 轮';select.append(option);}
    select.value=energy.selectedRound||1;select.disabled=calculating;
    $('energy-round-control').hidden=count<=1;
    $('energy-round-note').hidden=count<=1&&!energy.roundAdjusted;
    energyRounds.set(energyKey(),Number(select.value));
    $('energy-round-note').textContent=energy.roundAdjusted?'原轮次已不可用，已改为第 '+select.value+' 轮。':'回能、达标提示和补充效率建议均按所选轮次计算。';
  }
  async function changeEnergyRound(){
    energyRounds.set(energyKey(),Number($('energy-round').value));++energyVersion;
    if(energyUpdating)return;
    const previousEnergy=currentData.energy;
    energyUpdating=true;$('member').disabled=true;$('calculate').disabled=true;
    try{
      let completed;
      do{
        completed=energyVersion;
        const api=sourceApi(),round=energyRounds.get(energyKey()),index=Number($('member').value);
        currentData={...currentData,energy:{status:'updating',selectedRound:round,message:'正在更新第 '+round+' 轮回能建议…'}};
        renderCard();updateDownload();status('正在更新第 '+round+' 轮回能判定…');
        if(!api?.calculateEnergy)throw Error('请刷新来源计算器后，重新打开卡片');
        const energy=await api.calculateEnergy(index,round);
        if(completed!==energyVersion)continue;
        if(!api.isCurrent(currentData.fingerprint))throw Error('方案已变化，请重新预览并计算');
        currentData={...currentData,energy};syncEnergyControl(currentData);renderCard();fit();
        status('已按第 '+energy.selectedRound+' 轮更新回能判定');ensureCardFonts().catch(()=>{});
      }while(completed!==energyVersion);
    }catch(error){
      currentData={...currentData,energy:previousEnergy};syncEnergyControl(currentData);renderCard();fit();
      status('更新失败：'+error.message+'；已恢复第 '+previousEnergy.selectedRound+' 轮，可重新选择重试');
    }
    finally{energyUpdating=false;$('member').disabled=false;$('calculate').disabled=false;updateDownload();}
  }
  // Only this ID/name/image was checked against both catalog and image content.
  function verifiedEchoFallback(data,key){
    const echo=data.echoes?.find(e=>e.image===key);
    return String(echo?.id)==='6000052'&&echo.name==='无常凶鹭'?'assets/echoes-thumb/6000052.png?v=a100160625':'';
  }
  async function loadCardImage(data,key,url){
    const fallback=verifiedEchoFallback(data,key),sources=[url];
    if(fallback&&new URL(fallback,location.href).href!==new URL(url,location.href).href)sources.push(fallback);
    const errors=[];
    for(const src of sources){
      try{
        let image=imageCache.get(src);if(!image){image=await imageFrom(src);imageCache.set(src,image);}
        return {image,fallback:src!==url};
      }catch(error){
        const failure={url:src,reason:error?.message||String(error)};errors.push(failure);
        if(src===url&&sources.length>1)console.warn('角色卡片主图失败，尝试已核验备用图',{key,...failure});
      }
    }
    console.warn('角色卡片图片加载失败',{key,errors});
    throw Error(errors.map(e=>e.reason).join('；'));
  }
  function placeholderArt(){const c=document.createElement('canvas');c.width=576;c.height=940;const x=c.getContext('2d');x.fillStyle='#172129';x.fillRect(0,0,576,940);return c;}
  async function showData(data){
    const version=++viewVersion,same=currentData?.character.id===data.character.id;
    if(!same&&currentData)portraitDrafts.set(currentData.character.id,{artData:state.artData,zoom:state.zoom,artX:state.artX,artY:state.artY,image:artImage});
    const draft=!same?portraitDrafts.get(data.character.id):null;
    for(const k of Object.keys(currentData?.images||{}))delete images[k];
    currentData=data;syncEnergyControl(data);state.user=data.user;state.code=data.code;state.axis=data.axis.name;
    if(!same){state.artData=null;state.zoom=100;if(draft){Object.assign(state,{artData:draft.artData,zoom:draft.zoom,artX:draft.artX,artY:draft.artY});artImage=draft.image;}}
    artImage=state.artData?artImage:(imageCache.get(data.images.portrait)||placeholderArt());if(!same&&!draft)centerArt();
    missingImages=[];const fallbackImages=[],textFallbackImages=[];visualLoading=true;updateDownload();$('image-retry').hidden=true;$('image-status').textContent='正在载入卡片图片…';
    renderCard();fit();$('loading').hidden=true;
    if(!calculating)status(data.scoreReady&&data.echoScoreReady?'已有评分，正在准备图片…':'真实方案预览已显示；点击开始计算评分');
    const tasks=Object.entries(data.images).filter(([,url])=>url).map(async([key,url])=>{
      try{
        const loaded=await loadCardImage(data,key,url),img=loaded.image;
        if(loaded.fallback&&version===viewVersion)fallbackImages.push(data.echoes.find(e=>e.image===key).name);
        if(version!==viewVersion)return;images[key]=img;
        if(key==='portrait'&&!state.artData){artImage=img;if(!same&&!draft)centerArt();else setArtPosition(state.artX,state.artY);}
        renderCard();fit();
      }catch(error){if(version===viewVersion){const weaponName=key==='weapon'?data.weapon.name:data.teamMates.find(mate=>mate.weaponImage===key)?.weaponName;if(weaponName)textFallbackImages.push(weaponName);else missingImages.push((data.echoes.find(e=>e.image===key)?.name||key)+'（'+error.message+'）');}}
    });
    tasks.push(ensureDecorations().then(()=>{if(version===viewVersion){renderCard();fit();}}).catch(()=>{if(version===viewVersion)missingImages.push('卡片装饰');}));
    await Promise.all(tasks);if(version!==viewVersion)return;
    visualLoading=false;updateDownload();
    $('image-retry').hidden=!missingImages.length&&!textFallbackImages.length;
    $('image-status').textContent=missingImages.length?'部分图片加载失败，已有画面已保留：'+missingImages.join('、'):'卡片图片已就绪'+(fallbackImages.length?'（'+fallbackImages.join('、')+'使用备用图）':'')+(textFallbackImages.length?'；武器图暂缺，已显示名称：'+textFallbackImages.join('、'):'');
    if(!calculating)status(data.scoreReady?'评分完成，可以调整立绘并下载':'真实方案预览已显示；评分尚未计算');
    ensureCardFonts().catch(()=>{});
  }
  async function loadPreview(){
    const api=sourceApi();if(!api)throw Error('请从计算器重新打开卡片，并保持来源页面打开');
    if(!api.preview||!api.calculateEnergy)throw Error('来源计算器版本较旧，请刷新计算器后重新打开卡片');
    const index=Number($('member').value);
    await showData(api.preview(index,energyRounds.get(energyKey())));
    const version=viewVersion;
    try{
      const changed=await api.prepareAssets?.();
      if(changed&&version===viewVersion&&!calculating&&Number($('member').value)===index)await showData(api.preview(index,energyRounds.get(energyKey())));
    }catch{status('声骸图鉴暂未载入，已有预览保留；重新计算时重试');}
  }
  async function calculate(){
    if(calculating||energyUpdating)return;
    const api=sourceApi();
    if(!api){status('请从计算器的「角色卡片」入口打开本页，并保持计算器页面打开');return;}
    refreshMembers();calculating=true;
    $('calculate').disabled=true;$('calculate').textContent='计算中…';$('member').disabled=true;$('cancel').hidden=false;$('energy-round').disabled=true;
    $('calc-progress').hidden=false;$('calc-progress').setAttribute('aria-busy','true');
    let message='正在准备全队角色评分',started=Date.now();
    const paintProgress=()=>{$('calc-stage').textContent=message;$('calc-time').textContent='已用 '+Math.floor((Date.now()-started)/1000)+' 秒';};
    paintProgress();const ticker=setInterval(paintProgress,250);updateDownload();
    try{
      // Paint the loading UI before any synchronous engine work starts.
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      await api.prepareAssets?.().catch(()=>{});
      const preview=api.preview(Number($('member').value),energyRounds.get(energyKey()));preview.echoScoreReady=false;preview.scoreReady=false;preview.score=null;preview.grade=null;preview.fullCharacterDamage=null;
      showData(preview).catch(e=>status(e.message));status('正在计算当前角色个人练度…');
      const selected=Number($('member').value);
      const packet=await api.calculate(selected,text=>{message=text;paintProgress();},async(packet,index,done,total)=>{
        if(index===selected){await showData(packet);status('当前角色已完成，正在补齐队友评分（'+done+'/'+total+'）…');}
      },Object.fromEntries(api.members().map(m=>[m.index,energyRounds.get(m.index+':'+m.id)])));
      message='全队角色评分已完成，正在更新卡片';paintProgress();
      await showData(packet);
      status(packet.teamScoreFailures?.length?'已完成 '+packet.teamScoreCompleted+' 位角色；未完成：'+packet.teamScoreFailures.map(m=>m.name+'（'+m.message+'）').join('；'):missingImages.length?'全队角色评分完成；部分图片未就绪，请先重试图片':'全队角色评分已完成，切换角色即可查看和下载');
    }catch(e){status(''+e.message);if(!currentData){$('loading').hidden=false;$('loading').textContent=e.message;}}
    finally{
      clearInterval(ticker);calculating=false;$('calc-progress').hidden=true;$('calc-progress').setAttribute('aria-busy','false');
      $('calculate').disabled=false;$('calculate').textContent='开始计算';$('member').disabled=false;$('cancel').hidden=true;$('energy-round').disabled=false;
      if(currentData&&!currentData.scoreReady){renderCard();fit();}updateDownload();
    }
  }
  function bind(){
    $('calculate').onclick=calculate;
    $('cancel').onclick=()=>{sourceApi()?.cancel();status('正在取消评分，预览会保留…');};
    $('energy-round').onchange=changeEnergyRound;
    $('member').onchange=()=>loadPreview().catch(e=>status(e.message));
    $('image-retry').onclick=()=>{if(currentData)showData(currentData).catch(e=>status(e.message));};
    $('zoom').addEventListener('input',e=>{if(currentData)changeZoom(e.target.value)});
    $('resolution').onchange=e=>state.resolution=Number(e.target.value);
    $('art-file').onchange=e=>{if(currentData)uploadArt(e.target.files[0]).catch(err=>status(err.message));};
    $('reset-art').onclick=()=>{if(!currentData)return;++loadToken;state.artData=null;artImage=images.portrait||placeholderArt();state.zoom=100;centerArt();renderCard();status('已还原默认立绘与构图');};
    document.querySelectorAll('[data-card-download]').forEach(button=>button.onclick=exportPng);$('font-retry').onclick=()=>ensureCardFonts().catch(()=>{});
    $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('canvas-wrap').requestFullscreen();}catch{status('当前浏览器不支持全屏，请放大窗口查看');}};
    document.addEventListener('fullscreenchange',fit);new ResizeObserver(fit).observe($('canvas-wrap'));
    window.addEventListener('pagehide',()=>{if(calculating)sourceApi()?.cancel();});window.addEventListener('focus',()=>{if(new URLSearchParams(location.search).get('studio')==='1')return;refreshMembers();if(!calculating&&!energyUpdating)loadPreview().catch(e=>status(e.message));});
  }
  async function init(){
    try{
      stage=new Konva.Stage({container:'stage',width:W,height:H});layer=new Konva.Layer();stage.add(layer);ready=true;bind();fit();
      ensureDecorations().catch(()=>{});
      const api=sourceApi();if(!api){$('calculate').disabled=true;status('请从计算器「角色卡片」入口打开本页');$('loading').textContent='先在计算器载入方案，再打开角色卡片';return;}
      refreshMembers();if(!api.members().length){$('calculate').disabled=true;throw Error('请先在计算器选择角色并完成配装');}
      window.__WC=window.__WC||{};window.__WC.CharacterCardView={getData:()=>currentData,getState:()=>({...state}),getSummary:()=>currentData?summarize(currentData):null,getVisibleText:()=>layer.find('Text').map(n=>n.text()),selectMember:async index=>{if(calculating||energyUpdating)throw Error('请先结束计算');refreshMembers();if(![...$('member').options].some(o=>Number(o.value)===index))throw Error('角色不存在');$('member').value=String(index);await loadPreview();}};
      const studioParams=new URLSearchParams(location.search);
      if(studioParams.get('studio')==='1'){
        document.documentElement.classList.add('studio-embedded');
        const index=studioParams.get('member');if([...$('member').options].some(o=>o.value===index))$('member').value=index;
        document.querySelector('.connection-note').textContent='使用本次出图的临时方案。切换角色保留立绘构图；修改声骸后需要重新计算。';
        document.querySelector('.preview-foot span').textContent='用手指拖动左侧立绘，通过下方缩放滑条调整大小。';
        const style=document.createElement('style');style.textContent='.studio-embedded .app-head,.studio-embedded .app-footer{display:none}.studio-embedded .workspace{padding:12px;gap:16px}.studio-embedded #stage{touch-action:none}.studio-embedded input,.studio-embedded select{font-size:16px}.studio-embedded .preview-head h1{font-size:21px}.studio-embedded button{min-height:44px}';document.head.appendChild(style);
      }
      await loadPreview();
    }catch(e){$('loading').hidden=!!currentData;$('loading').textContent='加载失败：'+e.message;status(e.message);}
  }
  init();
})();
