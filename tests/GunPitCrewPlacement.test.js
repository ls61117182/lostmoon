const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m,file) => m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const types = require('../assets/scripts/core/types.ts');
const {HexMap} = require('../assets/scripts/core/HexGrid.ts');
const {INFANTRY_VISUAL_KINDS,infantryVisualConfigOf} = require('../assets/scripts/core/InfantryVisualDB.ts');
const {PIT_RADIUS} = require('../tools/prepareFortificationArt.cjs');
const Scene = require('./helpers/BattleSceneMethods.cjs')(['atGunCrewFormationOffsets','drawATGunCrewMaybeAnim'],types);
function fixture() {
  const scene = new Scene(),map = new HexMap(3,3);
  const gun = {id:'gun',kind:'pak38',faction:'german',pos:{q:1,r:1},atGunCrewAlive:true};
  map.set({pos:gun.pos,terrain:'field',fortification:{kind:'gun_pit',connections:'100100'}});
  Object.assign(scene,{mission:{map},hexSize:128,project:()=>({x:0,y:0})});
  return {scene,map,gun};
}

test('the entire crew sprite stays within the pit floor for every faction and interpolated gun heading',()=>{
  const {scene,gun} = fixture();
  for(let degrees=0;degrees<360;degrees+=15) {
    const angle=degrees*Math.PI/180,ux=Math.cos(angle),uy=Math.sin(angle),rx=-uy,ry=ux;
    scene.topDownForwardVec=()=>({ux,uy});
    const offsets=scene.atGunCrewFormationOffsets(gun);
    for(const kind of INFANTRY_VISUAL_KINDS)for(let i=0;i<3;i++) {
      const soldier=infantryVisualConfigOf(kind).soldiers[i];
      const meta=JSON.parse(fs.readFileSync(`assets/resources/${soldier.spritePath.replace('/spriteFrame','.png.meta')}`,'utf8'));
      const {width,height}=meta.subMetas.f9941.userData,max=Math.max(width,height);
      const fit=scene.hexSize*.58*soldier.scale,w=width/max*fit,h=height/max*fit;
      for(const x of [-w/2,w/2])for(const y of [-h/2,h/2]) {
        // The source faces down: rendered sprite +X follows the gun's right
        // vector and +Y its backward vector (angle = gun heading + 90deg).
        const px=offsets[i].ox+rx*x-ux*y,py=offsets[i].oy+ry*x-uy*y;
        assert.ok(Math.hypot(px,py)<PIT_RADIUS,
          `${kind}, soldier ${i+1}, heading ${degrees}: sprite corner leaves the pit`);
      }
    }
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++) {
      assert.ok(Math.hypot(offsets[a].ox-offsets[b].ox,offsets[a].oy-offsets[b].oy)>.24*scene.hexSize,
        'crew should retain three separate operator positions');
    }
  }
});

test('non-pit artillery retains the tuned outdoor formation',()=>{
  const {scene,map,gun}=fixture();scene.topDownForwardVec=()=>({ux:1,uy:0});
  const compact=scene.atGunCrewFormationOffsets(gun);
  delete map.get(gun.pos).fortification;
  const outdoor=scene.atGunCrewFormationOffsets(gun);
  assert.ok(Math.hypot(compact[1].ox,compact[1].oy)<Math.hypot(outdoor[1].ox,outdoor[1].oy));
  const expected=[[-.22,-.43],[-.57,0],[-.22,.43]];
  outdoor.forEach((p,i)=>{assert.ok(Math.abs(p.ox/128-expected[i][0])<1e-9);assert.ok(Math.abs(p.oy/128-expected[i][1])<1e-9)});
});

test('the live crew and suppression marks share the compact positions throughout gun rotation',()=>{
  const {scene,gun}=fixture(),lerp={from:0,to:1,t:.45};
  let infantry,marks;
  Object.assign(scene,{
    currentEnemyTurretLerp:()=>lerp,
    topDownForwardVec:(_gun,_origin,interpolation)=>{
      assert.equal(interpolation,lerp);return {ux:Math.cos(.47),uy:Math.sin(.47)};
    },
    atGunCrewActor:()=>({id:'crew',kind:'german_infantry'}),
    drawInfantry:(_crew,_x,_y,offsets)=>{infantry=offsets},
    drawSuppressionMarks:(_crew,_x,_y,offsets)=>{marks=offsets},
  });
  scene.drawATGunCrewMaybeAnim(gun);
  assert.equal(infantry,marks);
  assert.ok(infantry.every(p=>Math.hypot(p.ox,p.oy)<.23*128));
});
