import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'resources-manifest.json'),'utf8'));
if(manifest.schemaVersion!==1||manifest.baseUrl!=='https://wuwacalc.cn/')throw Error('资源清单来源无效');
const publicRoot=path.resolve(root,'public');
const cacheArg=process.argv.find(arg=>arg.startsWith('--cache='));
const cache=cacheArg?path.resolve(cacheArg.slice(8)):null;
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function valid(file,data){return data.length===file.bytes&&hash(data)===file.sha256;}
const queue=[...manifest.files];let restored=0,reused=0;const failures=[];
console.log(`恢复${queue.length}个运行资源；总计约${Math.round(queue.reduce((n,f)=>n+f.bytes,0)/1e6)}MB。仅从清单固定来源下载，不发送账号或方案。`);
async function worker(){
 for(let file;file=queue.shift();){
  try{
   if(!file.path||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(p=>p==='..'||p.startsWith('.'))||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw Error('清单格式无效');
   const target=path.resolve(publicRoot,file.path);
   if(!target.startsWith(publicRoot+path.sep))throw Error('路径不允许');
   if(fs.existsSync(target)&&valid(file,fs.readFileSync(target))){reused++;continue;}
   let data;
   const cached=cache&&path.join(cache,file.path);
   if(cached&&fs.existsSync(cached)){const value=fs.readFileSync(cached);if(valid(file,value))data=value;}
   if(!data){
    const url=new URL(file.path.split('/').map(encodeURIComponent).join('/'),manifest.baseUrl);
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw Error('HTTP '+response.status);
    data=Buffer.from(await response.arrayBuffer());
   }
   if(!valid(file,data))throw Error('长度或SHA256不匹配，未写入；源站资源可能已更新');
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,data);restored++;
   if(restored%100===0)console.log(`已恢复${restored}，复用${reused}`);
  }catch(error){failures.push({path:file.path,error:error.message});}
 }
}
await Promise.all(Array.from({length:4},worker));
console.log(`完成：恢复${restored}，复用${reused}，失败${failures.length}`);
for(const file of failures)console.error(file.path+': '+file.error);
if(failures.length){console.error('可重新运行setup，已校验文件不会重复下载。');process.exitCode=1;}
