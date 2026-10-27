import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fs.realpathSync(fileURLToPath(new URL('../public/',import.meta.url)));
const port=Number(process.env.PORT||8765);
if(!Number.isInteger(port)||port<1024||port>65535) throw Error('PORT必须是1024到65535之间的整数');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm','.onnx':'application/octet-stream','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  // 既有页面大量使用内联脚本/事件；固定兼容检测和OCR依赖需要eval。
  // 此策略主要隔离外部服务，不把unsafe-inline/eval声称为XSS防护。
  res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  const respond=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:{message}}));};
  try{
    const host=new URL('http://'+(req.headers.host||'')).hostname;
    if(!['127.0.0.1','localhost'].includes(host))return respond(403,'仅允许本机访问');
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(pathname.includes('\0')||pathname.includes('\\'))return respond(400,'请求路径无效');
    if(/^\/(?:api|auth|rest)(?:\/|$)/.test(pathname))return respond(503,'本地源码版未启用云端或AI接口，请使用游客与本地功能。');
    if(!['GET','HEAD'].includes(req.method))return respond(405,'本地静态服务不接受写入请求');
    const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
    if(relative.split('/').some(part=>part.startsWith('.')))return respond(404,'文件不存在');
    const requested=path.resolve(root,relative);
    if(!requested.startsWith(root+path.sep))return respond(403,'路径不允许');
    if(!fs.existsSync(requested))return respond(404,'文件不存在；运行npm run setup恢复运行资源。');
    const actual=fs.realpathSync(requested);
    if(!actual.startsWith(root+path.sep)||!fs.statSync(actual).isFile())return respond(404,'文件不存在');
    const stat=fs.statSync(actual);
    res.writeHead(200,{'Content-Type':types[path.extname(actual).toLowerCase()]||'application/octet-stream','Content-Length':stat.size});
    if(req.method==='HEAD')return res.end();
    const stream=fs.createReadStream(actual);
    stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch{return respond(400,'请求无效');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用；可设置PORT后重试。':'本地服务启动失败：'+error.code);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`本地源码版：http://127.0.0.1:${port}/\n请使用游客访问。账号、云端、AI接口未启用。按Ctrl+C停止。`));
