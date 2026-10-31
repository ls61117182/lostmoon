// AI-authored material sources; individually render each direction with fixed SCREEN-space sunlight.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'source_art/terrain/elevation-v1');
const OUT = path.join(ROOT, 'assets/resources/textures/terrain/elevation');
const W = 256, H = 128, CREST = 32;
const DIRECTIONS = ['E','SE','SW','W','NW','NE'];
const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
const smooth = x => { const t = clamp(x); return t*t*(3-2*t); };
const hash = (x,y,seed=0) => { const z = Math.sin(x*127.1+y*311.7+seed*74.3)*43758.5453; return z-Math.floor(z); };
function uuid(name) {
  const h = crypto.createHash('sha256').update('sherman:elevation-v1:'+name).digest('hex').slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`;
}
function json(file, value) { fs.writeFileSync(file, JSON.stringify(value,null,2)+'\n'); }
function imageMeta(name) {
  const template = JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/terrain_road.png.meta'),'utf8'));
  const meta = JSON.parse(JSON.stringify(template).replaceAll(template.uuid,uuid(name)).replaceAll('terrain_road',name.replace('.png','')));
  const f = meta.subMetas.f9941.userData;
  Object.assign(f,{width:W,height:H,rawWidth:W,rawHeight:H,trimX:0,trimY:0,offsetX:0,offsetY:0,trimType:'none',packable:false});
  f.vertices = { rawPosition:[-W/2,-H/2,0,W/2,-H/2,0,-W/2,H/2,0,W/2,H/2,0],
    indexes:[0,1,2,2,1,3],uv:[0,H,W,H,0,0,W,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-W/2,-H/2,0],maxPos:[W/2,H/2,0] };
  meta.userData.fixAlphaTransparencyArtifacts = true; json(path.join(OUT,name+'.meta'),meta);
}

async function build() {
  fs.mkdirSync(OUT,{recursive:true});
  if(!fs.existsSync(OUT+'.meta')) json(OUT+'.meta',{ver:'1.2.0',importer:'directory',imported:true,uuid:uuid('directory'),files:[],subMetas:{},userData:{}});
  const material = {};
  for(const kind of ['grass','cliff']) material[kind] = await sharp(path.join(SOURCE,kind+'-generated.png')).resize(512,512,{fit:'fill'}).removeAlpha().raw().toBuffer();
  // Match the authored grass detail to the game's actual ground palette, avoiding a green decal on yellow fields.
  const bundle=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json'),'utf8'));
  const ground=Buffer.from((bundle.europeanSummer??bundle).materials.grass.rgb,'base64');
  const average=buffer=>{const sum=[0,0,0];for(let i=0;i<buffer.length;i++)sum[i%3]+=buffer[i];return sum.map(n=>n/(buffer.length/3));};
  const sourceMean=average(material.grass),groundMean=average(ground);
  for(let i=0;i<material.grass.length;i++)material.grass[i]=clamp(Math.round(material.grass[i]*groundMean[i%3]/sourceMean[i%3]),0,255);
  const manifest = { version:1, width:W,height:H,crest:CREST,anchor:[.5,.75],lightScreen:[-1,1],directions:DIRECTIONS,assets:[] };
  for(const camera of [0,90]) for(const cliff of [false,true]) for(let d=0;d<6;d++) {
    const theta = d*Math.PI/3, rotation = camera*Math.PI/180;
    // Inverse camera rotation maps the fixed upper-left light into map-local coordinates.
    const lx=(-Math.cos(rotation)+Math.sin(rotation))/Math.sqrt(2), ly=(Math.sin(rotation)+Math.cos(rotation))/Math.sqrt(2);
    const nt = lx*Math.sin(theta)+ly*Math.cos(theta), nn=lx*Math.cos(theta)-ly*Math.sin(theta);
    const seed=d+(cliff?31:0), pixels=Buffer.alloc(W*H*4);
    const mat=material[cliff?'cliff':'grass'];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const rough = cliff ? 2.5*Math.sin(x*.16+seed)+1.5*Math.sin(x*.47+seed*2) : 1.4*Math.sin(x*.075+seed);
      const s = y-CREST-rough, depth=cliff?56:76, u=clamp(s/depth);
      // Mitered footprint: the two neighboring 60-degree strips meet at the corner bisector.
      const halfLength=W/3+Math.max(-8,s)/Math.sqrt(3);
      const feather = smooth((halfLength-Math.abs(x-W/2))/2);
      let alpha=feather*smooth((s+9)/9)*smooth((depth+9-s)/(cliff?13:24));
      if(alpha<=0)continue;
      const slope=cliff ? 1.8 : .55*Math.sin(Math.PI*u);
      const sideFacet=cliff ? (hash(Math.floor(x/17),Math.floor(s/15),seed)-.5)*.7 : .08*Math.sin(x*.09+seed);
      const z=Math.sqrt(1+slope*slope+sideFacet*sideFacet);
      const diffuse=Math.max(0,(.82+nn*slope*.52+nt*sideFacet*.52)/z);
      let lighting=cliff ? (.65+.58*diffuse)/1.126 : (.48+.65*diffuse)/1.013;
      const crestHighlight=Math.exp(-Math.pow((s-1)/3,2))*(.06+.08*Math.max(0,nn));
      const footShade=Math.exp(-Math.pow((s-depth+5)/7,2))*(.09+.13*Math.max(0,-nn));
      const groove=Math.pow(Math.max(0,Math.sin(x*.33+Math.sin(s*.1+seed)*.6)),12);
      lighting+=crestHighlight-footShade-(cliff?.13:.035)*groove*Math.sin(u*Math.PI);
      // Sample each direction's material independently; these are not rotated copies of a lit sprite.
      const tx=((x*2+seed*23)%512+512)%512, ty=((Math.floor(s*(cliff?3:2))+seed*47)%512+512)%512;
      const at=(ty*512+tx)*3, gAt=(((y*2+seed*17)%512)*512+(x*2+seed*23)%512)*3;
      const index=(y*W+x)*4;
      const grassBlend=cliff ? 1-smooth((s+3)/12) : 1;
      for(let c=0;c<3;c++) {
        const value=cliff ? mat[at+c]*(1-grassBlend)+material.grass[gAt+c]*grassBlend : mat[at+c];
        pixels[index+c]=clamp(Math.round(value*lighting),0,255);
      }
      // Outer grass blends with the actual underlying terrain; cliff retains its material contrast.
      pixels[index+3]=Math.round(alpha*(cliff?255:205));
    }
    const name=`${cliff?'cliff':'slope'}_${DIRECTIONS[d].toLowerCase()}_c${camera}_v1.png`;
    await sharp(pixels,{raw:{width:W,height:H,channels:4}}).png().toFile(path.join(OUT,name));
    imageMeta(name);
    manifest.assets.push({file:name,direction:d,camera,blocked:cliff,lightLocal:[nt,nn],sha256:crypto.createHash('sha256').update(pixels).digest('hex')});
  }
  json(path.join(SOURCE,'manifest.json'),manifest);
  for(const relative of ['assets/scripts/core/Elevation.ts','assets/scripts/view/ElevationRenderer.ts']) {
    const file=path.join(ROOT,relative+'.meta');
    if(!fs.existsSync(file))json(file,{ver:'4.0.24',importer:'typescript',imported:true,uuid:uuid(relative),files:[],subMetas:{},userData:{}});
  }
  console.log(`Prepared ${manifest.assets.length} independently lit directional slope/cliff sprites.`);
}
if(require.main===module)build().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={build,W,H,CREST};
