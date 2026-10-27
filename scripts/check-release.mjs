import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const sources=JSON.parse(fs.readFileSync(path.join(root,'SOURCE_FILES.json'),'utf8')).files;
const resources=JSON.parse(fs.readFileSync(path.join(root,'resources-manifest.json'),'utf8')).files;
const available=new Set([...sources,...resources.map(f=>'public/'+f.path)]);
const errors=[];let scripts=0,jsons=0,inlineScripts=0;
for(const name of sources){
 const file=path.join(root,name);
 if(!fs.existsSync(file)){errors.push(name+': 缺少文件');continue;}
 const text=fs.readFileSync(file,'utf8');
 if(/\.(?:m?js|html|json|md|txt)$/.test(name)&&name!=='scripts/check-release.mjs'){
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{25,}|sb_secret_[A-Za-z0-9_-]{15,}|sb_publishable_[A-Za-z0-9_-]+)\b/.test(text))errors.push(name+': 检出需人工复核的密钥特征，值已隐藏');
  if(/[A-Z]:[\\/]+Users[\\/]+|F:[\\/]+codex|https:\/\/[a-z0-9-]+\.supabase\.co/.test(text))errors.push(name+': 残留个人路径或正式云端地址');
 }
 try{
  if(/\.m?js$/.test(name)){execFileSync(process.execPath,['--check',file],{stdio:'pipe'});scripts++;}
  if(name.endsWith('.json')){JSON.parse(text);jsons++;}
  if(name.endsWith('.html')){
   for(const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    const attrs=match[1];const body=match[2];
    if(/\bsrc\s*=/.test(attrs)||!body.trim())continue;
    const type=attrs.match(/\btype\s*=\s*['"]([^'"]+)['"]/i)?.[1]||'';
    if(/json/.test(type)){JSON.parse(body);continue;}
    if(type&&!/(?:javascript|module)/i.test(type))continue;
    execFileSync(process.execPath,['--check','--input-type='+ (type==='module'?'module':'commonjs')],{input:body,stdio:'pipe'});inlineScripts++;
   }
   for(const match of text.matchAll(/<(script|link)\b[^>]*\b(?:src|href)\s*=\s*['"]([^'"]+)['"][^>]*>/gi)){
    if(match[1].toLowerCase()==='link'&&!/\brel\s*=\s*['"]stylesheet['"]/i.test(match[0]))continue;
    const ref=match[2].split(/[?#]/)[0];
    if(!ref||/^(?:[a-z]+:|\/\/)/i.test(ref)||ref.includes("' +"))continue;
    const target=ref.startsWith('/')?'public/'+ref.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(name),ref));
    if(!available.has(target))errors.push(name+': 引用缺失 '+target);
   }
  }
 }catch(error){errors.push(name+': 语法或JSON检查失败（'+String(error.stderr||error.message).slice(0,160)+')');}
}
for(const file of sources){if(/(?:^|\/)(?:\.env|memory|backups|csf|server)(?:\/|$)/.test(file)||/9\d{3}\.json$/.test(file))errors.push(file+': 发布范围禁止');}
if(!fs.readFileSync(path.join(root,'LICENSE'),'utf8').includes('PolyForm Noncommercial License 1.0.0'))errors.push('许可证缺失或不符');
console.log(JSON.stringify({sourceFiles:sources.length,scripts,jsons,inlineScripts,errors},null,2));
if(errors.length)process.exitCode=1;
