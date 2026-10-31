const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, f);
const root = path.resolve(__dirname, '..');
const visual = require('../assets/scripts/view/TankRiderVisual.ts');
const db = require('../assets/scripts/core/TankVisualDB.ts');
const groups = [
  { label: '美军', kind: 'american_infantry', tank: 'sherman' },
  { label: '通用 / 德军 / 苏军（沿用原版共用关系）', kind: 'german_infantry', tank: 'panzer4' },
  { label: '日军', kind: 'japanese_infantry', tank: 'type97' },
].map(group => ({ ...group, ...visual.seatedInfantryVisualOf(group.kind),
  cfg: db.splitTankVisualConfigOf(group.tank), geo: db.splitTankGeometryConfigOf(group.tank),
}));
const html = `<!doctype html><meta charset="utf-8"><title>全阵营步兵坐姿检查</title><style>body{background:#20271f;color:#e6e4d0;font:15px sans-serif;padding:18px;margin:0}h2{font-size:21px;margin:0 0 10px}p{font-size:13px;color:#bac4af}canvas{display:block}</style><h2>全阵营坐姿 · 军官除外</h2><canvas width="1080" height="580"></canvas><p>上排放大观察轮廓；中排对照原站姿与坐姿的小尺寸配色；下排车身长 100 像素，最后一排放大同一低分辨率画面。布局、85% 尺寸、内收 5% 和校色参数均读取生产配置。此为贴图渲染预览。</p><script>
const groups=${JSON.stringify(groups)},v=${JSON.stringify(visual)},seats=${JSON.stringify(visual.tankRiderSeats('left'))};
const load=p=>new Promise((resolve,reject)=>{const f=new Image();f.onload=()=>resolve(f);f.onerror=reject;f.src='/assets/resources/'+p.replace('/spriteFrame','.png');});
function tinted(f,color){const c=document.createElement('canvas');c.width=f.width;c.height=f.height;const g=c.getContext('2d');g.drawImage(f,0,0);const pixels=g.getImageData(0,0,c.width,c.height),gain=[color.r,color.g,color.b];for(let p=0;p<pixels.data.length;p+=4)for(let i=0;i<3;i++)pixels.data[p+i]*=gain[i]/255;g.putImageData(pixels,0,0);return c;}
Promise.all(groups.map(async a=>{a.images=await Promise.all(a.paths.map(load));a.originals=await Promise.all(a.paths.map(p=>load(p.replace(/_seated(?:_olive)?/,''))));a.tinted=a.images.map((f,i)=>tinted(f,a.colors[i]));a.hull=await load('textures/units/'+a.tank+'_top_hull/spriteFrame');a.turret=await load('textures/units/'+a.tank+'_top_turret/spriteFrame');return a;})).then(groups=>{
const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='#8f9565';ctx.fillRect(0,0,1080,580);ctx.textAlign='center';ctx.fillStyle='#152015';
function tank(g,a,x,y){g.save();g.translate(x,y);g.rotate(Math.PI);const w=100,h=w*a.geo.topTrim.h/a.geo.topTrim.w;g.imageSmoothingEnabled=true;g.drawImage(a.hull,-w/2,-h/2,w,h);seats.forEach((s,i)=>{const f=a.tinted[i],rw=w*v.TANK_RIDER_WIDTH_TO_HULL,rh=rw*f.height/f.width;g.save();g.translate(s.x*w,-(s.y*h-Math.sign(s.y)*rh*v.TANK_RIDER_INWARD_OFFSET_TO_HEIGHT));g.rotate(-s.angle*Math.PI/180);g.drawImage(f,-rw*v.TANK_RIDER_HIP_ANCHOR.x,-rh*(1-v.TANK_RIDER_HIP_ANCHOR.y),rw,rh);g.restore();});const scale=w/a.geo.topTrim.w,t=scale*a.cfg.turretScale;g.translate((a.geo.pivot.bodyX-a.geo.topTrim.w/2)*scale,(a.geo.pivot.bodyY-a.geo.topTrim.h/2)*scale);g.drawImage(a.turret,-a.geo.pivot.spriteX*t,-a.geo.pivot.spriteY*t,a.turret.width*t,a.turret.height*t);g.restore();}
groups.forEach((a,col)=>{const x=col*360;ctx.font='15px sans-serif';ctx.fillText(a.label,x+180,25);a.tinted.forEach((f,i)=>{const w=90,h=w*f.height/f.width;ctx.imageSmoothingEnabled=false;ctx.drawImage(f,x+25+i*110,45,w,h);});ctx.font='13px sans-serif';ctx.fillText('原站姿（上） / 坐姿（下）',x+180,185);for(let i=0;i<3;i++){const ox=x+65+i*110,f=a.originals[i];ctx.imageSmoothingEnabled=true;ctx.drawImage(f,ox-12*f.width/f.height,205,24*f.width/f.height,24);const s=a.tinted[i],w=29;ctx.drawImage(s,ox-w/2,252,w,w*s.height/s.width);}tank(ctx,a,x+180,325);const small=document.createElement('canvas');small.width=120;small.height=80;const g=small.getContext('2d');g.fillStyle='#8f9565';g.fillRect(0,0,120,80);tank(g,a,60,40);ctx.imageSmoothingEnabled=false;ctx.drawImage(small,x,365,360,240);});
}).catch(e=>document.body.append('预览失败：'+e));</script>`;
http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}const u=decodeURIComponent(req.url.split('?')[0]);if(!/^\/assets\/resources\/textures\/units\/[A-Za-z0-9_]+\.png$/.test(u))return res.writeHead(404).end();res.setHeader('Content-Type','image/png');fs.createReadStream(path.join(root,u)).on('error',()=>res.end()).pipe(res);}).listen(8766,'127.0.0.1',()=>console.log('Rider preview http://127.0.0.1:8766'));
