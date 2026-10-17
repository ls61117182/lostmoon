const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const terrain = path.join(root, 'assets/resources/textures/terrain');
const helper = path.join(root, 'assets/scripts/view/RockyHighlandVariants.ts');
const exported = {};
new Function('exports', ts.transpileModule(fs.readFileSync(helper, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(exported);
const { assignRockyHighlandVariants: assign, rockyCellKey: key } = exported;
const shadowExports = {};
new Function('require', 'exports', ts.transpileModule(fs.readFileSync(path.join(root,'assets/scripts/view/ObjectShadowRenderer.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(() => ({}), shadowExports);
const shadowProfile = shadowExports.OBJECT_SHADOW_PROFILES.rocky;
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function uuid(key) {
  const s = digest(Buffer.from(`sherman:${key}`)).slice(0, 32).split('');
  s[12] = '4'; s[16] = ((parseInt(s[16], 16) & 3) | 8).toString(16);
  return `${s.slice(0,8).join('')}-${s.slice(8,12).join('')}-${s.slice(12,16).join('')}-${s.slice(16,20).join('')}-${s.slice(20).join('')}`;
}
const label = (x,y,text,size=18) => `<text x="${x}" y="${y}" fill="#e9e4d8" font-family="Arial,sans-serif" font-size="${size}">${text}</text>`;
function hex(x,y,w,h) {
  return `<polygon points="${x+w/2},${y} ${x+w},${y+h/4} ${x+w},${y+3*h/4} ${x+w/2},${y+h} ${x},${y+3*h/4} ${x},${y+h/4}" fill="#aaa58b" stroke="#5b594d"/>`;
}
const backdrop = (w,h,body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#302f2b"/>${body}</svg>`);
// Preview the same alpha silhouette, opacity and offset used by the game.
async function groundShadow(sprite, width=222, height=256) {
  const {data,info}=await sharp(sprite).resize(width,height).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let p=0;p<data.length;p+=4){data[p]=data[p+1]=data[p+2]=0;data[p+3]=Math.round(data[p+3]*shadowProfile.alpha/255);}
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}
async function main() {
  const template = JSON.parse(fs.readFileSync(path.join(terrain, 'pacific_rocks.png.meta'), 'utf8'));
  const sprites = [], manifest = [], masks = [];
  for (let index = 1; index <= 6; index++) {
    const id = String(index).padStart(2, '0'), name = `rocky_highland_${id}`;
    const source = path.join(__dirname, `master-reef-${id}.png`);
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left=info.width, top=info.height, right=-1, bottom=-1;
    for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
      if (data[(y*info.width+x)*4+3] <= 1) continue;
      left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y);
    }
    assert(right>left && bottom>top, 'Nonempty transparent source');
    left=Math.max(0,left-2); top=Math.max(0,top-2); right=Math.min(info.width-1,right+2); bottom=Math.min(info.height-1,bottom+2);
    const sprite = await sharp(source).extract({left,top,width:right-left+1,height:bottom-top+1})
      .resize(218,252,{fit:'fill',kernel:'lanczos3'})
      .extend({left:2,right:2,top:2,bottom:2,background:'#00000000'}).png().toBuffer();
    const file = path.join(terrain,`${name}.png`);
    fs.writeFileSync(file,sprite); sprites.push(sprite);
    if (!fs.existsSync(`${file}.meta`)) {
      const meta = JSON.parse(JSON.stringify(template).replaceAll(template.uuid,uuid(name)).replaceAll('pacific_rocks',name));
      fs.writeFileSync(`${file}.meta`,JSON.stringify(meta,null,2)+'\n');
    }
    const m=await sharp(sprite).metadata();
    assert.equal(m.width,222); assert.equal(m.height,256); assert(m.hasAlpha);
    const raw=await sharp(sprite).ensureAlpha().raw().toBuffer();
    masks.push(Uint8Array.from({length:222*256},(_,p)=>raw[p*4+3]>64?1:0));
    for(const p of [0,221,222*255,222*256-1]) assert.equal(raw[p*4+3],0);
    let coverage=0;for(let p=3;p<raw.length;p+=4)if(raw[p]>200)coverage++;
    assert(coverage>30000 && coverage<53000, 'Hex fills the cell with transparent outside');
    const meta=JSON.parse(fs.readFileSync(`${file}.meta`,'utf8'));
    assert.equal(meta.subMetas.f9941.userData.rawWidth,222); assert.equal(meta.subMetas.f9941.userData.rawHeight,256);
    manifest.push({id:index,file:`assets/resources/textures/terrain/${name}.png`,source:`master-reef-${id}.png`,sha256:digest(sprite),coverage});
  }
  assert.equal(new Set(manifest.map(m=>m.sha256)).size,6,'Six different images');
  for(let i=1;i<masks.length;i++){
    let intersection=0,union=0;
    for(let p=0;p<masks[0].length;p++){if(masks[0][p]&&masks[i][p])intersection++;if(masks[0][p]||masks[i][p])union++;}
    assert(intersection/union>.90,'All variants retain the approved hex silhouette');
    manifest[i].silhouetteOverlap=Number((intersection/union).toFixed(4));
  }
  // Keep missing-variant fallback on the corrected overhead art too.
  fs.writeFileSync(path.join(terrain,'pacific_rocks.png'),sprites[0]);
  if(!fs.existsSync(`${helper}.meta`))fs.writeFileSync(`${helper}.meta`,JSON.stringify({ver:'4.0.24',importer:'typescript',imported:true,uuid:uuid('RockyHighlandVariants.ts'),files:[],subMetas:{},userData:{}},null,2)+'\n');
  const layers=[]; let body=label(26,34,'PACIFIC REEF HIGHLAND / SIX VARIANTS',23)+label(26,62,'Matte weathered reef limestone / broad escarpment / runtime ground cast',15);
  const fullReach=Math.round(128*shadowProfile.reach);
  for(let i=0;i<6;i++) {
    const x=30+(i%3)*270,y=100+Math.floor(i/3)*310;
    body+=label(x,y-12,`0${i+1}`)+hex(x,y,222,256);
    layers.push({input:await groundShadow(sprites[i]),left:x+fullReach,top:y+fullReach});
    layers.push({input:sprites[i],left:x,top:y});
  }
  await sharp(backdrop(820,710,body)).composite(layers).png().toFile(path.join(__dirname,'six-variants.png'));
  const cells=[];
  for(let r=0;r<5;r++)for(let col=0;col<7;col++)cells.push({pos:{q:col-Math.floor(r/2),r},terrain:(col*3+r)%9===0?'field':'rocky'});
  const assigned=assign(cells,'preview_random_pacific_20261016');
  const grass=await sharp(path.join(terrain,'terrain_field.png')).resize(104,120).png().toBuffer();
  const mapGround=[],mapShadows=[],mapRocks=[],counts=Array(6).fill(0);
  let mapBody=label(30,36,'SEEDED MAP DISTRIBUTION',24)+label(30,64,'Neighboring rocky hexes use different variants',18);
  for(const cell of cells) {
    const x=30+Math.round((cell.pos.q+cell.pos.r*.5)*104),y=92+cell.pos.r*90;
    mapBody+=hex(x,y,104,120);
    mapGround.push({input:grass,left:x,top:y});
    if(cell.terrain==='rocky') {
      const variant=assigned.get(key(cell.pos)); counts[variant]++;
      const reach=Math.round(60*shadowProfile.reach);
      mapShadows.push({input:await groundShadow(sprites[variant],104,120),left:x+reach,top:y+reach});
      mapRocks.push({input:await sharp(sprites[variant]).resize(104,120).png().toBuffer(),left:x,top:y});
    }
  }
  mapBody+=label(30,618,counts.map((n,i)=>`0${i+1}: ${n}`).join('     '),18);
  await sharp(backdrop(880,650,mapBody)).composite([...mapGround,...mapShadows,...mapRocks]).png().toFile(path.join(__dirname,'map-distribution.png'));
  // Compare the previously thin image and the new relief, then inspect small sizes.
  const prior=fs.readFileSync(path.join(__dirname,'before-reef-assets/rocky_highland_01.png'));
  let compareBody=label(26,34,'REEF SURFACE AND SMALL-SCALE CHECK',23)+label(30,80,'Previous smooth rock')+label(310,80,'Weathered reef rock')+label(592,80,'64 px')+label(725,80,'128 px');
  compareBody+=hex(30,104,222,256)+hex(310,104,222,256)+hex(592,122,56,64)+hex(725,104,111,128);
  const compareLayers=[{input:prior,left:30,top:104},
    {input:await groundShadow(sprites[0]),left:310+fullReach,top:104+fullReach},{input:sprites[0],left:310,top:104}];
  for(const [x,y,w,h]of [[592,122,56,64],[725,104,111,128]]){
    const reach=Math.round(h*.5*shadowProfile.reach);
    compareLayers.push({input:await groundShadow(sprites[0],w,h),left:x+reach,top:y+reach},
      {input:await sharp(sprites[0]).resize(w,h).png().toBuffer(),left:x,top:y});
  }
  compareBody+=label(26,419,'Matte rough summit / sparse broad erosion / stable height and camera',18);
  await sharp(backdrop(880,450,compareBody)).composite(compareLayers).png().toFile(path.join(__dirname,'reef-and-scale-check.png'));
  fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify({generator:'built-in imagegen',material:'weathered-Pacific-reef-limestone',projection:'vertical-overhead-orthographic',shadowProfile,width:222,height:256,variants:manifest},null,2)+'\n');
  console.log('Exported and verified 6 unique 222x256 RGBA sprites, Cocos metadata, gallery and map distribution preview.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
