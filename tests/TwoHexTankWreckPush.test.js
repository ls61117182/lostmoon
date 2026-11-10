const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const rules = Object.assign({}, ...['HexGrid', 'UnitFootprint', 'UnitDB', 'types', 'TankVisualDB', 'UrbanTerrain']
  .map(name => require(`../assets/scripts/core/${name}.ts`)),
  require('../assets/scripts/view/TankTrackVisual.ts'), require('../assets/scripts/view/TankWreckPush.ts'));
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'advanceTankMoveTime', 'advanceTwoHexTankWreckMoveTime', 'twoHexTankWreckMotion', 'advanceTankWreckPush',
  'updateTankWreckPose', 'interpolatedPos', 'tankWreckCollisionBody', 'tankBodyDisplaySizePx',
  'topDownForwardVec', 'directionScreenAngle', 'splitHullDisplayBasis', 'destroyedTankOffset',
], { ...rules, easeOutCubic: t => 1 - (1 - t) ** 3 });
const near = (a, b, message='') => assert(Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);

function fixture({facing=0,sign=1,action='turn',camera90=false,hexSize=60,wreckKind='sherman'}={}) {
  const scene = new Scene();
  const unit = {id:'mover',kind:'maus',stats:rules.getUnitStats('maus'),pos:{q:0,r:0},facing};
  const wreck = {id:'wreck',kind:wreckKind,stats:rules.getUnitStats(wreckKind),pos:{q:0,r:0},facing,destroyed:true};
  const map = new rules.HexMap(20,20);
  for(let q=-8;q<=8;q++)for(let r=-8;r<=8;r++)map.set({pos:{q,r},terrain:'field'});
  const plan = rules.planUnitMove(unit,action==='turn'?(sign===1?'cw':'ccw'):action);
  Object.assign(scene,{hexSize,mission:{sherman:unit,allies:[],enemies:[wreck],map},
    syncTankWreckWater:()=>false,
    project(q,r) {
      const x=Math.sqrt(3)*this.hexSize*(q+r/2),y=-1.5*this.hexSize*r;
      return camera90?{x:-y+17,y:x-31}:{x:x+17,y:y-31};
    },
    anim:{unit,kind:action==='turn'?'turn':'move',fromQ:0,fromR:0,toQ:plan.pos.q,toR:plan.pos.r,
      turnFrom:facing,turnTo:plan.facing,t:0,dur:1},
  });
  return {scene,unit,wreck,map};
}

function putWreck(f, rear=false) {
  const {scene,wreck}=f;
  scene.anim.t=0.55;
  const hull=scene.tankWreckCollisionBody(f.unit,scene.anim.kind==='turn'
    ?{from:scene.anim.turnFrom,to:scene.anim.turnTo,t:scene.anim.t}:null);
  scene.anim.t=0;
  const ux=Math.cos(hull.angle),uy=Math.sin(hull.angle),origin=scene.interpolatedPos(wreck);
  const forward=(rear?-1:1)*hull.halfLength*0.8;
  const fromAngle=scene.directionScreenAngle(f.unit.pos,origin,scene.anim.turnFrom);
  const toAngle=scene.directionScreenAngle(f.unit.pos,origin,scene.anim.turnTo);
  const turnSign=Math.sign(Math.atan2(Math.sin(toAngle-fromAngle),Math.cos(toAngle-fromAngle)))||1;
  const side=turnSign*(rear?-1:1)*hull.halfWidth;
  wreck.wreckPose={x:hull.x+forward*ux-side*uy-origin.x/scene.hexSize,
    y:hull.y+forward*uy+side*ux-origin.y/scene.hexSize,angle:0};
  return {...wreck.wreckPose};
}

test('turn collision samples match the rendered midpoint, orientation and configured offsets', () => {
  for(let facing=0;facing<6;facing++)for(const sign of [-1,1])for(const camera90 of [false,true]) {
    const f=fixture({facing,sign,camera90}),{scene,unit}=f;
    const motion=scene.twoHexTankWreckMotion(scene.anim);
    for(const t of [0,0.13,0.5,0.82,1]) {
      scene.anim.t=t;
      const rendered=scene.tankWreckCollisionBody(unit,{from:facing,to:scene.anim.turnTo,t});
      const sampled=motion.bodyAt(motion.progress(t));
      near(sampled.x,rendered.x);near(sampled.y,rendered.y);
      near(Math.cos(sampled.angle),Math.cos(rendered.angle));near(Math.sin(sampled.angle),Math.sin(rendered.angle));
    }
  }
});

test('both translating turns push front and rear contacts in every hull heading and camera orientation', () => {
  for(let facing=0;facing<6;facing++)for(const sign of [-1,1])for(const camera90 of [false,true])for(const rear of [false,true]) {
    const f=fixture({facing,sign,camera90}),initial=putWreck(f,rear),logical={...f.wreck.pos};
    f.scene.anim.t=1;f.scene.advanceTankWreckPush(f.scene.anim);
    assert(Math.hypot(f.wreck.wreckPose.x-initial.x,f.wreck.wreckPose.y-initial.y)>0.01,
      `wreck stayed still: heading ${facing}, sign ${sign}, camera90 ${camera90}, rear ${rear}`);
    assert.deepEqual(f.wreck.pos,logical,'visual pushing cannot change gameplay occupancy');
    const end={...f.wreck.wreckPose};
    f.scene.advanceTankWreckPush(f.scene.anim);assert.deepEqual({...f.wreck.wreckPose},end,'redraw cannot push a second time');
  }
});

test('turn pushing follows fixed spatial samples across dropped frames and board sizes', () => {
  const run=(frames,hexSize=60)=>{
    const f=fixture({hexSize});putWreck(f);
    for(let i=1;i<=frames;i++) {f.scene.anim.t=i/frames;f.scene.advanceTankWreckPush(f.scene.anim);}
    return f.wreck.wreckPose;
  };
  const expected=run(1);
  for(const [frames,size] of [[12,60],[144,60],[60,120]]) {
    const pose=run(frames,size);
    for(const key of ['x','y','angle'])near(pose[key],expected[key],key);
  }
});

test('turn pushing slows only contact and combines mud by the stricter rate', () => {
  const run=(frames,mud=false)=>{
    const f=fixture();putWreck(f);
    if(mud)for(const tile of f.map.all())tile.terrain='mud';
    for(let i=0;i<frames;i++)f.scene.advanceTankMoveTime(f.scene.anim,2/frames);
    return f;
  };
  const expected=run(1),mud=run(1,true);
  assert(expected.scene.anim.t<0.8,'wreck contact must slow the configured 40% turn clock');
  assert(expected.wreck.wreckPose);
  for(const frames of [12,60,144]) {
    const actual=run(frames);
    near(actual.scene.anim.t,expected.scene.anim.t);
    for(const key of ['x','y','angle'])near(actual.wreck.wreckPose[key],expected.wreck.wreckPose[key],key);
  }
  // Both clocks start already in contact, so mud must not multiply the 30% pushing rate.
  const dry=fixture(),wet=fixture();
  putWreck(dry);putWreck(wet);for(const tile of wet.map.all())tile.terrain='mud';
  dry.scene.anim.t=wet.scene.anim.t=0.5;
  dry.scene.advanceTankMoveTime(dry.scene.anim,0.01);wet.scene.advanceTankMoveTime(wet.scene.anim,0.01);
  near(dry.scene.anim.t,wet.scene.anim.t);
  assert(mud.scene.anim.t<=expected.scene.anim.t);
  const before=expected.scene.anim.t;
  expected.scene.mission.enemies=[];
  expected.scene.advanceTankMoveTime(expected.scene.anim,0.01);
  near(expected.scene.anim.t-before,0.004,'normal Maus turning speed returns after release');
});

test('forward and reverse Maus movement push ordinary and two-cell wrecks', () => {
  for(const action of ['advance','reverse'])for(const wreckKind of ['sherman','maus']) {
    const f=fixture({action,wreckKind}),initial=putWreck(f,action==='reverse');
    f.scene.advanceTankMoveTime(f.scene.anim,10);
    assert.equal(f.scene.anim.t,1);
    assert(Math.hypot(f.wreck.wreckPose.x-initial.x,f.wreck.wreckPose.y-initial.y)>0.01);
  }
});

test('sinking wrecks neither move nor slow two-hex turns', () => {
  const f=fixture(),initial=putWreck(f);
  f.wreck.wreckWater={sink:{elapsed:0}};
  f.scene.advanceTankMoveTime(f.scene.anim,0.5);
  near(f.scene.anim.t,0.2);assert.deepEqual(f.wreck.wreckPose,initial);
});

test('rotating rear contact uses local surface motion instead of the centre travel direction', () => {
  const previous={id:'mover',x:0,y:0,angle:0,halfLength:2,halfWidth:0.3};
  const mover={...previous,x:0.01,y:0.002,angle:0.05};
  const wreck={id:'wreck',x:-1.6,y:-0.37,angle:0,halfLength:0.15,halfWidth:0.12};
  const travel={x:0.01,y:0.002};
  assert.equal(rules.tankWreckPushContact(wreck,mover,travel),null,'centre moves away from the rear contact');
  assert(rules.tankWreckPushContact(wreck,mover,travel,previous));
  const old={...wreck};rules.pushTankWrecks([wreck],mover,travel,[],[],previous);
  assert(wreck.y<old.y,'rotating tail must push the wreck outwards');
});
