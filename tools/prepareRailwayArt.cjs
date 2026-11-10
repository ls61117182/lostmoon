// Bake generated material into fixed-gauge, six-direction railway geometry.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ts = require('typescript');
require.extensions['.ts'] ??= (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { RAILWAY_ART_MASKS, railwayArtTransform } = require('../assets/scripts/core/Railway.ts');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/resources/textures/terrain/railway');
const SOURCE = path.join(ROOT, 'source_art/terrain/railway-v1-20261105');
const W = 256, H = 256, R = 128, A = Math.sqrt(3) * R / 2;
const GAUGE = 22, BALLAST = 47, SPACING = 19;
const flags = mask => Array.from({ length: 6 }, (_, d) => (mask >> d) & 1).join('');
const rays = Array.from({ length: 6 }, (_, d) => [Math.cos(d * Math.PI / 3), Math.sin(d * Math.PI / 3)]);
const pt = (d, r = A + 3) => rays[d].map(v => v * r);
const sep = (a, b) => Math.min(Math.abs(a - b), 6 - Math.abs(a - b));
const lerp = (a, b, t) => a + (b - a) * t;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const n = v => Number(v.toFixed(3));

function routes(mask) {
  const ports = rays.map((_, d) => d).filter(d => mask & (1 << d));
  if (ports.length === 1) return [[ports[0], null]];
  let main = [ports[0], ports[1]];
  for (const a of ports) for (const b of ports) if (sep(a, b) > sep(...main)) main = [a, b];
  const pairs = [main], used = new Set(main);
  // Opposite lines are real diamond crossings, rather than a road-style star hub.
  for (const a of ports) if (!used.has(a) && ports.includes((a + 3) % 6) && !used.has((a + 3) % 6)) {
    pairs.push([a, (a + 3) % 6]); used.add(a); used.add((a + 3) % 6);
  }
  for (const a of ports) if (!used.has(a)) {
    const target = [...main].sort((b, c) => sep(a, c) - sep(a, b))[0];
    pairs.push([a, target]);
  }
  return pairs;
}

function centerline(a, b) {
  const start = pt(a), end = b === null ? [0, 0] : pt(b);
  const straight = b === null || sep(a, b) === 3;
  const handle = straight ? 0 : sep(a, b) === 1 ? 108 : 80;
  const p1 = straight ? start.map((v, i) => lerp(v, end[i], 1 / 3)) : pt(a, A + 3 - handle);
  const p2 = straight ? start.map((v, i) => lerp(v, end[i], 2 / 3)) : pt(b, A + 3 - handle);
  const sample = t => [0, 1].map(i => (1-t)**3*start[i] + 3*(1-t)**2*t*p1[i] + 3*(1-t)*t*t*p2[i] + t**3*end[i]);
  const points = Array.from({ length: 161 }, (_, i) => sample(i / 160));
  const stations = [0];
  for (let i = 1; i < points.length; i++) stations.push(stations[i-1] + Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]));
  return { points, stations, length: stations.at(-1), end, terminal: b === null,
    path: `M${start.map(n)} C${p1.map(n)} ${p2.map(n)} ${end.map(n)}` };
}

function at(route, station) {
  let j = route.stations.findIndex(s => s >= station); j = Math.max(1, j < 0 ? route.stations.length-1 : j);
  const t = (station-route.stations[j-1])/(route.stations[j]-route.stations[j-1]);
  const a = route.points[j-1], b = route.points[j];
  return { x: lerp(a[0],b[0],t), y: lerp(a[1],b[1],t), angle: Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI };
}

let ballastTexture, woodTexture;
async function loadTextures() {
  const strip = path.join(SOURCE, 'sources/railway-material-strip.png');
  const texture = async (region, width, height) => 'data:image/png;base64,' + (await sharp(strip)
    .extract(region).resize(width, height).removeAlpha().png().toBuffer()).toString('base64');
  ballastTexture = await texture({ left: 256, top: 414, width: 768, height: 22 }, 192, 8);
  woodTexture = await texture({ left: 32, top: 485, width: 23, height: 49 }, 8, 18);
}

function offsetPath(route, distance) {
  return route.points.map((p, i, all) => {
    const a = all[Math.max(0,i-1)], b = all[Math.min(all.length-1,i+1)];
    const len = Math.hypot(b[0]-a[0],b[1]-a[1]);
    return `${i ? 'L' : 'M'}${n(p[0]-(b[1]-a[1])/len*distance)},${n(p[1]+(b[0]-a[0])/len*distance)}`;
  }).join(' ');
}

function svgFor(mask, crossing = false) {
  const lines = routes(mask).map(pair => centerline(...pair));
  let ballast = '', ties = '', metal = '', terminals = '';
  const placed = [];
  for (const line of lines) {
    ballast += `<path d="${line.path}" fill="none" stroke="#514d41" stroke-opacity=".12" stroke-width="${BALLAST+5}"/>`;
    ballast += `<path d="${line.path}" fill="none" stroke="url(#ballast)" stroke-width="${BALLAST-4}"/>`;
    for (let s = 1; s < line.length; s += 3.5) {
      const p = at(line, s), angle = p.angle * Math.PI / 180;
      for (const side of [-1, 1]) {
        const jitter = Math.sin(s*2.93)*1.5, offset = side * (BALLAST/2-1+jitter);
        const x = p.x-Math.sin(angle)*offset, y = p.y+Math.cos(angle)*offset;
        const radius = 1.4 + (Math.sin(s*3.17)+1)*.65;
        ballast += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="url(#ballast)" opacity=".85"/>`;
      }
    }
    // Equally spaced sleepers meet every port with the same phase. Interior spacing
    // absorbs curve length so the last sleeper never collides with its neighbour.
    const count = Math.round((line.length - 6) / SPACING), step = (line.length - 6) / count;
    for (let i = 0; i <= count; i++) {
      const p = at(line, 3 + i * step);
      if (placed.some(q => Math.hypot(q.x-p.x,q.y-p.y)<8)) continue;
      placed.push(p);
      const transform = `translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.angle)})`;
      ties += `<g transform="${transform}"><rect x="-3.7" y="-18.5" width="8.4" height="38" rx=".8" fill="#211d18" opacity=".32"/><rect x="-3.6" y="-18.5" width="7.2" height="37" rx=".5" fill="url(#wood)" stroke="#51402e" stroke-width=".7"/>`;
      for (const y of [-GAUGE/2,GAUGE/2]) ties += `<rect x="-2.9" y="${y-2.4}" width="5.8" height="4.8" fill="#554d40"/><circle cx="0" cy="${y-1.8}" r=".8" fill="#aaa28b"/><circle cx="0" cy="${y+1.8}" r=".8" fill="#33342e"/>`;
      ties += '</g>';
    }
    for (const d of [-GAUGE/2, GAUGE/2]) {
      const p = offsetPath(line, d);
      metal += `<path d="${p}" fill="none" stroke="#322d27" stroke-width="4.8"/><path d="${p}" fill="none" stroke="#795b3c" stroke-width="3.4"/><path d="${p}" fill="none" stroke="#9c9e92" stroke-width="1.65"/><path d="${offsetPath(line,d-.42)}" fill="none" stroke="#d0cdb7" stroke-opacity=".85" stroke-width=".65"/>`;
    }
    if (line.terminal) {
      const p = at(line, line.length-3);
      terminals += `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.angle)})"><path d="M-8,-14 L-17,-10 M-8,14 L-17,10" stroke="#4a3827" stroke-width="4"/><rect x="-9" y="-20" width="7" height="40" rx="1" fill="url(#wood)" stroke="#382d21" stroke-width="1.2"/></g>`;
    }
  }
  // Central timber deck below continuous steel rails. At-grade, no gates or poles.
  let deck = '';
  if (crossing) for (const line of lines) {
    const j = line.points.reduce((best,p,i,all)=>Math.hypot(...p)<Math.hypot(...all[best])?i:best,0);
    const p = at(line,line.stations[j]);
    deck += `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.angle)})">`;
    for (let y=-23;y<24;y+=6) deck += `<rect x="-25" y="${y}" width="50" height="5.5" fill="url(#wood)" stroke="#46392c" stroke-width=".65"/>`;
    deck += '</g>';
  }
  const hex = Array.from({ length: 6 }, (_, i) => { const t=(-90+i*60)*Math.PI/180; return `${n(Math.cos(t)*(R+2.2))},${n(Math.sin(t)*(R+2.2))}`; }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="-128 -128 256 256"><defs><pattern id="ballast" width="192" height="8" patternUnits="userSpaceOnUse"><image href="${ballastTexture}" width="192" height="8"/></pattern><pattern id="wood" width="8" height="18" patternUnits="userSpaceOnUse"><image href="${woodTexture}" width="8" height="18"/></pattern><clipPath id="hex"><polygon points="${hex}"/></clipPath></defs><g clip-path="url(#hex)">${ballast}${ties}${deck}${metal}${terminals}</g></svg>`;
}

function uuid(key) { const s = crypto.createHash('sha256').update(`sherman:railway:${key}`).digest('hex').slice(0,32); return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20)}`; }
function writeMeta(filename, kind='image') {
  const output = filename+'.meta'; if (kind!=='image' && fs.existsSync(output)) return;
  if (kind !== 'image') { fs.writeFileSync(output, JSON.stringify({ ver: kind==='directory'?'1.2.0':'2.0.1', importer:kind, imported:true, uuid:uuid(path.basename(filename)), files:kind==='json'?['.json']:[], subMetas:{}, userData:{} },null,2)+'\n'); return; }
  const template=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/fortifications/trench_100100_v1.png.meta'),'utf8'));
  const name=path.basename(filename,'.png');
  const meta=JSON.parse(JSON.stringify(template).replaceAll(template.uuid,uuid(name)).replaceAll('trench_100100_v1',name));
  const f=meta.subMetas.f9941.userData;
  Object.assign(f,{width:W,height:H,rawWidth:W,rawHeight:H,trimX:0,trimY:0,offsetX:0,offsetY:0,trimType:'none',packable:false});
  f.vertices.rawPosition=[-128,-128,0,128,-128,0,-128,128,0,128,128,0];
  f.vertices.minPos=[-128,-128,0];f.vertices.maxPos=[128,128,0];
  f.vertices.uv=[0,256,256,256,0,0,256,0];
  fs.writeFileSync(output,JSON.stringify(meta,null,2)+'\n');
}

async function writeImage(filename, bytes) {
  try { if ((await fs.promises.readFile(filename)).equals(bytes)) return; } catch (error) { if(error.code!=='ENOENT') throw error; }
  for(let attempt=0;attempt<20;attempt++) {
    try { await fs.promises.writeFile(filename,bytes); return; }
    catch(error) {
      if(!['EBUSY','EPERM','UNKNOWN','EACCES'].includes(error.code)||attempt===19)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
}

async function main() {
  fs.mkdirSync(OUT,{recursive:true}); writeMeta(OUT,'directory'); await loadTextures();
  const sprites=[];
  for(const mask of RAILWAY_ART_MASKS) for(const crossing of [false,true]) {
    const name=`railway_${flags(mask)}${crossing?'_crossing':''}_v1.png`;
    await writeImage(path.join(OUT,name),await sharp(Buffer.from(svgFor(mask,crossing)),{density:192}).resize(W,H).png().toBuffer());
    writeMeta(path.join(OUT,name)); sprites.push(name);
  }
  const manifest={ version:1, size:{width:W,height:H}, gauge:GAUGE, ballastWidth:BALLAST, directionOrder:['E','SE','SW','W','NW','NE'],
    baseTerrainRules:'unchanged', allowedTerrain:['field','road','mud'], trainRules:'deferred', sourceArtFolder:path.relative(ROOT,SOURCE).replaceAll('\\','/'), sprites,
    variants:Array.from({length:63},(_,i)=>{ const connections=flags(i+1),art=railwayArtTransform(connections);return {connections,canonicalMask:art.canonicalMask,rotationDegrees:art.rotationDegrees,surface:path.basename(art.surface.replace('/spriteFrame',''))+'.png'}; }) };
  fs.writeFileSync(path.join(OUT,'railway_art_manifest.json'),JSON.stringify(manifest,null,2)+'\n');writeMeta(path.join(OUT,'railway_art_manifest.json'),'json');
  const scriptMeta=path.join(ROOT,'assets/scripts/core/Railway.ts.meta');
  if(!fs.existsSync(scriptMeta)) fs.writeFileSync(scriptMeta,JSON.stringify({ver:'4.0.24',importer:'typescript',imported:true,uuid:uuid('Railway.ts'),files:[],subMetas:{},userData:{}},null,2)+'\n');
  console.log(`Railway: ${sprites.length} transparent sprites, 63 connections, fixed ${GAUGE}px gauge.`);
}
module.exports={W,H,R,A,GAUGE,BALLAST,SPACING,rays,routes,centerline,at,flags,svgFor,loadTextures,OUT,SOURCE};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
