const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const visuals=require('../assets/scripts/core/TankVisualDB.ts');
const ROOT=path.resolve(__dirname,'..'),ART=path.join(ROOT,'source_art/tanks/sherman-game-size-20261114-v17');
const layout=JSON.parse(fs.readFileSync(path.join(ART,'layout.json')));
const units=path.join(ROOT,'assets/resources/textures/units');
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
async function raw(f){return sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
for(const v of layout.variants){
 const selectedArt=path.join(ROOT,'source_art/tanks/sherman-jumbo-rear-colors-20261116-v21');
 test(`${v.kind}: all installed PNGs are the approved pixels, rotated to runtime facing`,async()=>{
  for(const [role,src]of Object.entries({...v.files,destroyed:'destroyed/'+v.kind+'_top_destroyed.png'})){
   const asset=path.join(units,path.basename(src)),actual=await raw(asset),rotated=await sharp(path.join(selectedArt,src)).rotate(270).ensureAlpha().raw().toBuffer();
   assert(actual.info.width<=200&&actual.info.height<=200);assert(actual.data.equals(rotated),role+' changed beyond lossless rotation');
   const m=JSON.parse(fs.readFileSync(asset+'.meta')),d=Object.values(m.subMetas).find(s=>s.importer==='sprite-frame').userData;
   assert.equal(d.rawWidth,actual.info.width);assert.equal(d.rawHeight,actual.info.height);assert.equal(d.trimType,'none');
   assert.deepEqual(d.vertices.uv,[0,actual.info.height,actual.info.width,actual.info.height,0,0,actual.info.width,0]);
  }
 });
 test(`${v.kind}: exposed ring, wreck footprint and mounted turret agree`,async()=>{
  const g=visuals.splitTankGeometryConfigOf(v.kind),c=visuals.splitTankVisualConfigOf(v.kind),h=await raw(path.join(units,v.kind+'_top_hull.png')),d=await raw(path.join(units,v.kind+'_top_destroyed.png')),t=await raw(path.join(units,v.kind+'_top_turret.png'));
  assert.equal(c.turretScale,1);assert.equal(c.hullFitScale,.7);assert.equal(c.turretOffsetForward,0);assert.equal(c.turretOffsetRight,0);
  assert.deepEqual([g.pivot.bodyX,g.pivot.bodyY],[74.8,42]);assert.deepEqual([g.pivot.spriteX,g.pivot.spriteY],[116.8,33]);
  assert.equal(h.info.width,g.topTrim.w);assert.equal(h.info.height,g.topTrim.h);
  for(let p=3;p<h.data.length;p+=4)assert.equal(d.data[p],h.data[p],'wreck alpha/outline differs');
  for(let y=0;y<h.info.height;y++)for(let x=0;x<h.info.width;x++)if(Math.hypot(x-g.pivot.bodyX,y-g.pivot.bodyY)<17){
   const p=(y*h.info.width+x)*4;
   // Lanczos resampling can leave 1-2 levels of ringing beside a black edge.
   assert.equal(h.data[p+3],255);assert(Math.max(...h.data.subarray(p,p+3))<=3);
   assert.deepEqual([...d.data.subarray(p,p+4)],[...h.data.subarray(p,p+4)]);
  }
  // Mounted support covers the ring even as the player or AI turns its turret.
  for(let heading=0;heading<360;heading+=60)for(let theta=0;theta<360;theta+=10){
   const angle=(theta-heading)*Math.PI/180,x=Math.floor(g.pivot.spriteX+20*Math.cos(angle)),y=Math.floor(g.pivot.spriteY+20*Math.sin(angle));
   assert(t.data[(y*t.info.width+x)*4+3]>180,'seat exposed under rotated turret');
  }
  const muzzle=g.muzzle;
  assert(muzzle.spriteX<g.pivot.spriteX,'gun must point left');
  const cfg=visuals.tankVisualConfigOf(v.kind);
  for(const [name,img,x,y]of [['muzzle',t,muzzle.spriteX,muzzle.spriteY],['hatch',t,c.commanderHatchSpriteX,c.commanderHatchSpriteY],['coax',t,cfg.coaxialMuzzleSpriteX,cfg.coaxialMuzzleSpriteY],['hull MG',h,cfg.hullMuzzleSpriteX,cfg.hullMuzzleSpriteY]]){
   assert(x>=0&&y>=0&&x<img.info.width&&y<img.info.height,name+' outside source');
   assert(img.data[(Math.floor(y)*img.info.width+Math.floor(x))*4+3]>100,name+' on transparent background');
  }
 });
}
class Transform{setContentSize(w,h){this.width=w;this.height=h;}setAnchorPoint(){}}
class Sprite{static SizeMode={CUSTOM:1};}
const Scene=require('./helpers/BattleSceneMethods.cjs')(['applySplitTankHullSprite','destroyedTankDisplaySize'],{...visuals,UITransform:Transform,Sprite});
test('Sherman family living hull and wreck use identical runtime size in every facing',()=>{
 for(const v of layout.variants)for(let heading=0;heading<360;heading+=60){
  const scene=new Scene(),tr=new Transform(),g=visuals.splitTankGeometryConfigOf(v.kind),cfg=visuals.splitTankVisualConfigOf(v.kind),u={kind:v.kind};
  Object.assign(scene,{hexSize:80,splitTankSpritesFor:()=>({hull:{}}),topDownForwardVec:()=>({ux:Math.cos(heading*Math.PI/180),uy:Math.sin(heading*Math.PI/180)}),applyTankConcealmentOpacity(){},registerEngineVibrationVisual(){},syncTankDamageOverlay(){},tankRiderRenderer:{draw(){}},allUnits:()=>[],splitHullDisplayBasis:()=>({trimW:g.topTrim.w,trimH:g.topTrim.h,fitScale:cfg.hullFitScale})});
  scene.applySplitTankHullSprite({sprite:{},node:{getComponent:()=>tr,setScale(){},setPosition(){}}},u,v.kind,{x:0,y:0});
  const wreck=scene.destroyedTankDisplaySize(v.kind,158,84,80);near(wreck.w,tr.width);near(wreck.h,tr.height);
 }
});
