/* Read-only public scheme eligibility. No calculator or account state is touched. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.__WC=root.__WC||{};root.__WC.LeaderboardRules=api}})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const ROVERS=new Set(['1310','1309','1406','1408','1605','1604','1502','1501']);
 const BLOOD_PACT='21020046';
 const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?NaN:Number(v);
 const workspace=p=>p?.data&&typeof p.data==='object'?p.data:p;
 // Same v1/v2 references as the site's __usCfgRowsFromPack. Read only eligibility
 // fields: expanding every skill/Buff tree would waste memory in the API process.
 function unpackConfigurations(data){
  const pack=data?.cfgRowPack;if(!pack)return data;
  if(!['cfg-row-pack-v1','cfg-row-pack-v2'].includes(pack.format)||!Array.isArray(pack.条目))throw Error('未知配置包');
  const memberFields={characterId:true,weaponId:true,chain:true,refinement:true,resonanceUnlocked:true,weaponSelection:{id:true,refinement:true}};
  const workspaceFields={members:memberFields,schemeDraft:{entryType:true}};
  const payloadFields={...workspaceFields,data:workspaceFields};
  const parsed=new Map();
  function ref(value){if(typeof value!=='string'||!/^#\d+$/.test(value))throw Error('配置引用无效');return Number(value.slice(1))}
  function read(index,fields,depth=0){
   if(!Number.isSafeInteger(index)||index<0||index>=pack.条目.length||depth>20)throw Error('配置节点无效');
   let node=parsed.get(index);if(!node){const text=pack.条目[index];if(typeof text!=='string'||!['v','a','o'].includes(text[0]))throw Error('配置节点格式无效');node={type:text[0],value:JSON.parse(text.slice(1))};parsed.set(index,node)}
   if(node.type==='v')return node.value;
   if(fields===true||!Array.isArray(node.value))throw Error('配置字段格式无效');
   if(node.type==='a')return node.value.map(x=>read(ref(x),fields,depth+1));
   const out={};for(const pair of node.value){if(!Array.isArray(pair)||pair.length!==2)throw Error('配置字段无效');if(Object.hasOwn(fields,pair[0]))out[pair[0]]=read(ref(pair[1]),fields[pair[0]],depth+1)}return out;
  }
  const rows=Array.isArray(data.exportConfigSnapshots)?data.exportConfigSnapshots:[];
  const result={...data,exportConfigSnapshots:rows.map((row,i)=>{if(!row)return row;const root=row.payload?.__packRoot??pack.根?.[i];return root==null?row:{...row,payload:read(root,payloadFields)}})};
  const anchorRoot=pack.锚根??data.exportConfigAnchor?.__packRoot;
  if(anchorRoot!=null)result.exportConfigAnchor=read(anchorRoot,{baseId:true,workspace:payloadFields});
  if(pack.成员根!=null)result.members=read(pack.成员根,memberFields);
  return result;
 }
 function video(item){const p=item?.payload||{},d=workspace(p)||{},s=item?.summary||{};for(const text of [d.refVideoUrl,d.videoUrl,d.video_url,p.meta?.refVideoUrl,item?.refVideoUrl,item?.refVideoMetaUrl,item?.videoUrl,item?.video_url,s.refVideoUrl,s.videoUrl,s.video_url]){const match=String(text||'').match(/https?:\/\/[^\s<>"'【】]+/i);if(!match)continue;try{const u=new URL(match[0].replace(/[。），、]+$/,''));if(['http:','https:'].includes(u.protocol)&&u.hostname&&!u.username&&!u.password)return u.href}catch{}}return ''}
 function definitions(chars,weapons){return {characters:new Map(chars.map(x=>[String(x.id),x])),weapons:new Map(weapons.map(x=>[String(x.id),x]))}}
 function member(m){return {characterId:String(m?.characterId||''),weaponId:String(m?.weaponSelection?.id??m?.weaponId??''),chain:num(m?.resonanceUnlocked??m?.chain),refinement:num(m?.weaponSelection?.refinement??m?.refinement)}}
 function validTeam(members,defs){return Array.isArray(members)&&members.length===3&&new Set(members.map(m=>m.characterId)).size===3&&members.every(m=>{const c=defs.characters.get(m.characterId),w=defs.weapons.get(m.weaponId);return c&&w&&!/^9\d{3}$/.test(m.characterId)&&Number.isInteger(m.chain)&&m.chain>=0&&m.chain<=6&&Number.isInteger(m.refinement)&&m.refinement>=1&&m.refinement<=5&&(m.chain===0||Number(c.rank)===4||ROVERS.has(m.characterId))&&(m.refinement===1||Number(w.rarity)===4||m.weaponId===BLOOD_PACT)})}
 function chainKey(ms){return ms.map(m=>m.chain+'+'+m.refinement).join('|')}
 function teamKey(ms){return ms.map(m=>m.characterId).sort().join('|')}
 function exactMembers(summary,ms){return Array.isArray(summary.characterIds)&&summary.characterIds.length===3&&summary.characterIds.every((id,i)=>String(id)===ms[i]?.characterId)&&Array.isArray(summary.memberConfigs)&&summary.memberConfigs.join('|')===chainKey(ms)&&Array.isArray(summary.memberWeaponIds)&&summary.memberWeaponIds.length===3&&summary.memberWeaponIds.every((id,i)=>String(id)===ms[i]?.weaponId)}
 // Rows carry their own recorded results. Never pair another row's DPS with eligible members.
 function rowMembers(row,index,rows,data){
  const full=workspace(row.payload);if(Array.isArray(full?.members)){const ms=full.members.map(member);if(Array.isArray(row.members)&&row.members.some((m,i)=>{const x=ms[m.index??i];return !x||String(m.characterId||'')!==x.characterId||num(m.chain??m.resonanceUnlocked)!==x.chain||num(m.refinement)!==x.refinement||(m.weaponId&&String(m.weaponId)!==x.weaponId)}))return null;return ms;}
  const anchor=workspace(data.exportConfigAnchor?.workspace);if(!Array.isArray(anchor?.members)||anchor.members.length!==3)return null;
  if(row.baseId&&data.exportConfigAnchor?.baseId&&row.baseId!==data.exportConfigAnchor.baseId)return null;
  const ms=anchor.members.map(member);
  if(!['excel','cumulative'].includes(row.type))return null;
  let edits=[];
  if(row.type==='excel'){
   const chain=rows.slice(0,index+1).filter(x=>x.type==='excel');
   if(chain.every(x=>x.localOverrides&&typeof x.localOverrides==='object'))edits=chain.map(x=>x.localOverrides);
   else if(row.finalEditable&&Array.isArray(row.finalEditable.members))edits=[row.finalEditable];else return null;
  }else edits=rows.slice(0,index+1).filter(x=>x.type==='cumulative').map(x=>x.diff);
  for(const edit of edits){if(!edit||typeof edit!=='object')return null;for(const [di,m] of (edit.members||[]).entries()){const i=m.index??di;if(!Number.isInteger(i)||!ms[i])return null;if(m.characterId&&String(m.characterId)!==ms[i].characterId)return null;if(Object.hasOwn(m,'weapon'))ms[i].weaponId=String(m.weapon||'');if(m.weaponSelection)ms[i].weaponId=String(m.weaponSelection.id||'')}}
  if(!Array.isArray(row.members)||row.members.length!==3)return null;
  const seen=new Set();for(const [i,m] of row.members.entries()){const at=m.index??i;if(!Number.isInteger(at)||!ms[at]||seen.has(at))return null;seen.add(at);if(String(m.characterId||'')!==ms[at].characterId)return null;ms[at].chain=num(m.chain??m.resonanceUnlocked);ms[at].refinement=num(m.refinement);if(m.weaponId&&String(m.weaponId)!==ms[at].weaponId)return null;}
  return ms;
 }
 function evaluate(item,defs){
  const summary=item?.summary||{},url=video(item);let data=workspace(item?.payload);
  const rejected=reason=>({entries:[],reason});
  if(item?.status!=='approved')return rejected('未公开');
  if(summary.entryType!=='表级14词条')return rejected('非表级14词条');
  if(!url)return rejected('缺少有效视频');
  try{data=unpackConfigurations(data)}catch{return rejected('配置快照解包失败')}
  if(!data||!Array.isArray(data.members))return rejected('缺少完整方案');
  if(!['global','loop'].includes(summary.axisKind))return rejected('轴类型未标注');
  const entries=[];const code=String(item.share_code||'');if(!/^MC-[A-Z0-9]+$/i.test(code))return rejected('方案码无效');
  function add(ms,numbers,rowId,label){if(!validTeam(ms,defs))return;const dps=num(numbers.teamDps),duration=num(numbers.axisDuration);if(!Number.isFinite(dps)||dps<=0||!Number.isFinite(duration)||duration<=0)return;entries.push({key:code+'|'+rowId,code,id:ms[0].characterId,team:ms.slice(1).map(m=>m.characterId),members:ms,teamKey:teamKey(ms),axis:summary.axisKind==='loop'?'循环':'全局',dps,time:duration,flowName:String(summary.axisName||item.title||'未命名方案'),difficulty:String(summary.difficulty||''),performance:String(summary.performance||summary.stability||''),configLabel:label,video:url,description:String(item.description||''),calcNotes:String(data.calcNotes||''),author:String(item.profiles?.display_name||'匿名'),updatedAt:item.updated_at,scheme:{share_code:code,title:item.title,description:item.description,summary,profiles:{display_name:item.profiles?.display_name}},rowId})}
  const base=data.members.map(member);
  if((!data.schemeDraft?.entryType||data.schemeDraft.entryType==='表级14词条')&&exactMembers(summary,base))add(base,summary,'base','当前配置');
  const rows=Array.isArray(data.exportConfigSnapshots)?data.exportConfigSnapshots:[];
  rows.forEach((row,i)=>{if(!row||row.included===false)return;const full=workspace(row.payload);const type=full?.schemeDraft?.entryType||row.entryType||data.schemeDraft?.entryType||summary.entryType;if(type!=='表级14词条')return;const ms=rowMembers(row,i,rows,data);if(ms)add(ms,row,String(row.id||i),String(row.label||'配置 '+(i+1)))});
  // Each public scheme occupies at most one place; select its best eligible row.
  entries.sort((a,b)=>b.dps-a.dps||a.key.localeCompare(b.key));
  return entries.length?{entries:[entries[0]],reason:''}:rejected('无可核验的合规配置');
 }
 const DIFFICULTY_LEVELS={'最简单':1,'基础':2,'进阶适中':3,'吃手法':4,'椰果轴':5};
 function difficultyLevel(value){if(typeof value==='number')return Number.isInteger(value)&&value>=1&&value<=5?value:null;if(typeof value!=='string')return null;const text=value.trim();return /^[1-5]$/.test(text)?Number(text):(Object.hasOwn(DIFFICULTY_LEVELS,text)?DIFFICULTY_LEVELS[text]:null)}
 function difficultyGroup(value){const level=difficultyLevel(value);return level===null?'unknown':level<=2?'basic':level<=4?'advanced':'coconut'}
 function rank(entries,{axis='全部',group='all',difficulty='all',query=''}={}){const sorted=entries.filter(x=>(axis==='全部'||x.axis===axis)&&(difficulty==='all'||difficultyGroup(x.difficulty)===difficulty)).slice().sort((a,b)=>b.dps-a.dps||a.code.localeCompare(b.code)||a.key.localeCompare(b.key));const seen=new Set();return sorted.filter(x=>{const key=group==='team'?x.teamKey:x.code;if(seen.has(key))return false;seen.add(key);return true}).slice(0,49).map((x,i)=>({...x,rank:i+1})).filter(x=>!query||[x.flowName,...(x.searchNames||[])].some(s=>s.includes(query)))}
 return {video,definitions,member,validTeam,teamKey,rowMembers,evaluate,rank,difficultyLevel,difficultyGroup};
});
