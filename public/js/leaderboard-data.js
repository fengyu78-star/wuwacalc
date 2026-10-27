(function(){'use strict';
 const ttl=5*60*1000;let cached=null;
 async function request(url,signal){const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),credentials:'omit',cache:'no-store'});if(!response.ok)throw Error('公开数据库读取失败（'+response.status+'）');return {status:response.status,data:await response.json()}}
 function pause(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);const abort=()=>{clearTimeout(timer);reject(signal.reason)},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true})})}
 async function load({signal=new AbortController().signal,onProgress=()=>{},force=false}={}){
  if(!force&&cached&&Date.now()-cached.at<ttl)return cached.value;
  onProgress('正在读取公开榜单…');
  const [chars,weapons]=await Promise.all([request('character-skills.json',signal),request('weapons.json',signal)]);
  if(!Array.isArray(chars.data.characters)||!Array.isArray(weapons.data.weapons))throw Error('角色或武器字典不完整');
  for(let poll=0;poll<90;poll++){const result=await request('api/leaderboard',signal);if(result.status===202){onProgress('正在更新公开榜单，请稍候…');await pause(2000,signal);continue}const d=result.data;if(d.version!==1||!Array.isArray(d.entries)||!Number.isSafeInteger(d.total)||!Number.isFinite(Date.parse(d.loadedAt)))throw Error('榜单结果不完整');const value={...d,characters:chars.data.characters,weapons:weapons.data.weapons};cached={at:Date.now(),value};return value}
  throw Error('榜单更新耗时较长，请稍后刷新');
 }
 window.__WC.LeaderboardData={load};
})();
