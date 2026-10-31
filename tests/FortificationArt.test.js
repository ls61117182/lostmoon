const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const ts = require('typescript');
require.extensions['.ts'] = (m,file) => m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const {fortificationArtTransform,FORTIFICATION_ART_MASKS}=require('../assets/scripts/core/FortificationArt.ts');
const {roadSpriteTransform}=require('../assets/scripts/core/UrbanTerrain.ts');
const {W,H,EDGES,RAYS,flags}=require('../tools/prepareFortificationArt.cjs');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'assets/resources/textures/terrain/fortifications');
const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'fortification_art_manifest.json'),'utf8'));

test('fortifications preserve the road direction and Cocos rotation convention for all 128 configurations',()=>{
  for(const kind of ['trench','gun_pit']) for(let m=0;m<64;m++) {
    const actual=fortificationArtTransform({kind,connections:flags(m)});
    const road=roadSpriteTransform([...flags(m)].map(c=>c==='1'));
    assert.equal(actual.canonicalMask,road?.canonicalMask??0);
    assert.equal(actual.rotationDegrees,road?.rotationDegrees??0);
    assert.ok(actual.surface.endsWith(`${kind}_${road?.canonicalFlags??'000000'}_v1/spriteFrame`));
    assert.ok(actual.foreground.endsWith('_rim/spriteFrame'));
  }
  assert.equal(FORTIFICATION_ART_MASKS.length,14);
});

test('isolated earthworks remain visible and malformed art configurations fail clearly',()=>{
  assert.match(fortificationArtTransform({kind:'trench',connections:'000000'}).surface,/trench_000000/);
  for(const connections of ['',null,undefined,'10010','1001000','10010x','100102',9]) {
    assert.throws(()=>fortificationArtTransform({kind:'trench',connections}),/six 0\/1/);
  }
  assert.throws(()=>fortificationArtTransform({kind:'bunker',connections:'000000'}),/kind/);
  assert.throws(()=>fortificationArtTransform(null),/kind/);
});

test('manifest resolves every configuration to actual Cocos assets with a fixed pivot',async()=>{
  assert.equal(manifest.variants.length,64);
  assert.equal(manifest.unitFacingRestriction,false);
  const seen=new Set(),uuids=new Set();
  for(const v of manifest.variants) for(const kind of ['trench','gun_pit']) {
    const t=fortificationArtTransform({kind,connections:v.connections});
    assert.equal(v.rotationDegrees,t.rotationDegrees);
    for(const name of Object.values(v[kind])) {
      if(seen.has(name)) continue;seen.add(name);
      const meta=JSON.parse(fs.readFileSync(path.join(OUT,name+'.meta'),'utf8'));
      assert.ok(!uuids.has(meta.uuid));uuids.add(meta.uuid);
      const image=await sharp(path.join(OUT,name)).metadata();
      assert.equal(image.width,W);assert.equal(image.height,H);assert.equal(image.hasAlpha,true);
      const frame=meta.subMetas.f9941.userData;
      assert.equal(frame.trimType,'none');assert.equal(frame.packable,false);
      assert.deepEqual([frame.pivotX,frame.pivotY],[.5,.5]);
      assert.deepEqual([frame.rawWidth,frame.rawHeight],[W,H]);
    }
  }
  assert.equal(seen.size,56);
});

function nearest(data,x,y) {
  const px=Math.max(0,Math.min(W-1,Math.round(x))),py=Math.max(0,Math.min(H-1,Math.round(y)));
  return Array.from(data.subarray((py*W+px)*4,(py*W+px)*4+4));
}
function unrotate(x,y,steps) {
  const a=-steps*Math.PI/3,dx=x-W/2,dy=y-H/2;
  return [W/2+dx*Math.cos(a)-dy*Math.sin(a),H/2+dx*Math.sin(a)+dy*Math.cos(a)];
}

test('actual PNG mouths match all six configured exits after runtime rotation',async()=>{
  const cache=new Map();let mouths=0;
  for(const kind of ['trench','gun_pit']) for(const v of manifest.variants) {
    const file=v[kind].surface;
    if(!cache.has(file)) cache.set(file,await sharp(path.join(OUT,file)).ensureAlpha().raw().toBuffer());
    for(let d=0;d<6;d++) {
      const [ex,ey]=EDGES[d],[ux,uy]=RAYS[d];
      const [x,y]=unrotate(ex-ux*7,ey-uy*7,v.rotationSteps);
      const alpha=nearest(cache.get(file),x,y)[3];
      assert.equal(alpha>240,v.connections[d]==='1',`${kind} ${v.connections}, direction ${d}, alpha ${alpha}`);
      mouths++;
    }
  }
  assert.equal(mouths,768);
});

test('every exported layer has real transparency and foreground rims leave the unit center open',async()=>{
  for(const kind of ['trench','gun_pit']) for(const mask of FORTIFICATION_ART_MASKS) {
    const stem=`${kind}_${flags(mask)}_v1`;
    const image=await sharp(path.join(OUT,stem+'.png')).ensureAlpha().raw().toBuffer();
    const rim=await sharp(path.join(OUT,stem+'_rim.png')).ensureAlpha().raw().toBuffer();
    assert.equal(nearest(image,0,0)[3],0);
    assert.equal(nearest(image,111,128)[3],255);
    assert.equal(nearest(rim,111,128)[3],0);
    assert.ok(image.some((v,i)=>i%4===3&&v===0),'background must have transparent pixels');
    assert.ok(rim.some((v,i)=>i%4===3&&v>240),'foreground must contain real rim detail');
  }
});

test('shared mouth profiles have identical pixels across trench and gun-pit topology variants',async()=>{
  const references=new Map();let profiles=0;
  for(const kind of ['trench','gun_pit']) for(const mask of FORTIFICATION_ART_MASKS) {
    const png=await sharp(path.join(OUT,`${kind}_${flags(mask)}_v1.png`)).ensureAlpha().raw().toBuffer();
    for(let d=0;d<6;d++) {
      if(!(mask&(1<<d))) continue;
      const [ux,uy]=RAYS[d],ex=111+111*ux,ey=128+111*uy,profile=[];
      for(let offset=-28;offset<=28;offset++) {
        profile.push(...nearest(png,ex-ux*2.5-uy*offset,ey-uy*2.5+ux*offset));
      }
      // Both fortification types use the same interface, including material colors.
      if(!references.has(d)) references.set(d,profile);
      assert.deepEqual(profile,references.get(d),`${kind} ${flags(mask)}, direction ${d}`);
      profiles++;
    }
  }
  assert.equal(profiles,84);
});

test('self-contained art configurator contains valid JavaScript and all production surfaces',()=>{
  const html=fs.readFileSync(path.join(ROOT,'source_art/terrain/fortifications-v1-20261028/configurator.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new (require('node:vm').Script)(script));
  assert.equal((html.match(/data:image\/png;base64,/g)||[]).length,29);
});
