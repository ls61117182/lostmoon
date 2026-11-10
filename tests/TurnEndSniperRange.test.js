const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { HexMap, neighbor, hexDistance, directionTo, axialToPixel } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { isFootUnit } = require('../assets/scripts/core/types.ts');
const { unitTurretHex, unitRearHex, sameHex } = require('../assets/scripts/core/UnitFootprint.ts');

function prepare(distances, { hatchOpen = true, shield = false, blocked = false, suppressed = [] } = {}) {
  const map = new HexMap(8, 8);
  for (let q = 0; q < 8; q++) for (let r = 0; r < 8; r++) {
    map.set({ pos: { q, r }, terrain: blocked && q === 1 ? 'forest' : 'field' });
  }
  const sherman = {
    id: 'player', kind: 'sherman', pos: { q: 0, r: 0 }, hatchOpen,
    crew: { commander: true, gunner: true, loader: true, driver: true, assistant: true },
    campaignCommanderShieldAvailable: shield,
  };
  const enemies = distances.map((distance, index) => ({
    id: `infantry-${index}`, kind: 'german_infantry', pos: { q: distance, r: 0 },
    suppressed: suppressed.includes(index),
  }));
  const event = prepareTurnEndEvent({ effectType: 'sniper' }, [2, 3], 5, {
    mission: { sherman, enemies, map }, rng: () => 0.5, nextEnemyId: () => 'unused',
  });
  return { event, sherman };
}

test('snipers at 1 and 2 hexes can kill; infantry at 3 hexes cannot', () => {
  for (const distance of [1, 2, 3]) {
    const { event, sherman } = prepare([distance]);
    assert.equal(event.sniperWillKill, distance <= 2);
    assert.equal(event.sniperAttackerId, distance <= 2 ? 'infantry-0' : undefined);
    event.apply();
    assert.equal(sherman.crew.commander, distance > 2);
  }
});

test('out-of-range infantry is skipped when selecting the actual shooter', () => {
  const { event } = prepare([3, 2]);
  assert.equal(event.sniperAttackerId, 'infantry-1');
});

test('suppressed infantry cannot perform the sniper event', () => {
  const onlySuppressed = prepare([2], { suppressed: [0] });
  assert.equal(onlySuppressed.event.sniperWillKill, false);
  assert.equal(onlySuppressed.event.sniperAttackerId, undefined);
  onlySuppressed.event.apply();
  assert.equal(onlySuppressed.sherman.crew.commander, true);

  const mixed = prepare([1, 2], { suppressed: [0] });
  assert.equal(mixed.event.sniperAttackerId, 'infantry-1');
});

test('closed hatch and blocked sight still prevent sniper casualties', () => {
  for (const options of [{ hatchOpen: false }, { blocked: true }]) {
    const { event, sherman } = prepare([2], options);
    assert.equal(event.sniperWillKill, false);
    event.apply();
    assert.equal(sherman.crew.commander, true);
  }
});

test('out-of-range snipers do not consume the commander shield', () => {
  for (const distance of [2, 3]) {
    const { event, sherman } = prepare([distance], { shield: true });
    event.apply();
    assert.equal(sherman.crew.commander, true);
    assert.equal(sherman.campaignCommanderShieldAvailable, distance > 2);
  }
});

function twoHexFixture(facing=0,turretCell='rear',shield=false) {
  const map=new HexMap(15,15);
  for (let q=-6;q<=6;q++) for (let r=-6;r<=6;r++) map.set({pos:{q,r},terrain:'field'});
  const sherman={id:'player-maus',kind:'maus',pos:{q:0,r:0},facing,hatchOpen:true,
    stats:{...getUnitStats('maus'),turretCell},crew:{commander:true,gunner:true,driver:true},
    campaignCommanderShieldAvailable:shield};
  const enemies=[];
  return {map,sherman,enemies,prepare:()=>prepareTurnEndEvent({effectType:'sniper'},[2,3],5,{
    mission:{sherman,playerTank:sherman,enemies,map},rng:()=>0.5,nextEnemyId:()=>'unused'})};
}
const twoSteps=(pos,dir)=>neighbor(neighbor(pos,dir),dir);
const infantry=(id,pos)=>({id,kind:'german_infantry',pos});

test('two-hex sniper range is measured from the turret cell, for every hull heading and turret layout', () => {
  for (let facing=0;facing<6;facing++) for (const cell of ['front','rear']) for (const shield of [false,true]) {
    const safe=twoHexFixture(facing,cell,shield);
    const other=cell==='rear'?safe.sherman.pos:unitRearHex(safe.sherman);
    const away=cell==='rear'?facing:(facing+3)%6;
    const frontOnly=twoSteps(other,away);
    assert.equal(hexDistance(frontOnly,other),2);
    assert.equal(hexDistance(frontOnly,unitTurretHex(safe.sherman)),3);
    safe.enemies.push(infantry('outside-turret-range',frontOnly));
    const skipped=safe.prepare();
    assert.equal(skipped.sniperWillKill,false);assert.equal(skipped.sniperAttackerId,undefined);
    skipped.apply();assert.equal(safe.sherman.crew.commander,true);
    assert.equal(safe.sherman.campaignCommanderShieldAvailable,shield);

    const exposed=twoHexFixture(facing,cell,shield);
    const inRange=twoSteps(unitTurretHex(exposed.sherman),(away+3)%6);
    exposed.enemies.push(infantry('within-turret-range',inRange));
    const shot=exposed.prepare();
    assert.equal(shot.sniperAttackerId,'within-turret-range');assert.equal(shot.sniperWillKill,true);
    shot.apply();assert.equal(exposed.sherman.crew.commander,shield);
    assert.equal(exposed.sherman.campaignCommanderShieldAvailable,false);
  }
});

test('snipers require a firing bearing to the turret rather than to the front anchor', () => {
  for (let facing=0;facing<6;facing++) {
    const miss=twoHexFixture(facing);
    const besideFront=neighbor(miss.sherman.pos,(facing+1)%6);
    assert.notEqual(directionTo(besideFront,miss.sherman.pos),null);
    assert.equal(directionTo(besideFront,unitTurretHex(miss.sherman)),null);
    miss.enemies.push(infantry('front-bearing-only',besideFront));
    assert.equal(miss.prepare().sniperWillKill,false);

    const hit=twoHexFixture(facing);
    const besideRear=twoSteps(unitTurretHex(hit.sherman),(facing+1)%6);
    assert.equal(directionTo(besideRear,hit.sherman.pos),null);
    assert.notEqual(directionTo(besideRear,unitTurretHex(hit.sherman)),null);
    hit.enemies.push(infantry('turret-bearing',besideRear));
    assert.equal(hit.prepare().sniperWillKill,true);
  }
});

test('front-cell visibility cannot replace turret-cell LoS, and a blocked front cannot hide an exposed turret', () => {
  const hidden=twoHexFixture(0,'rear',true),frontSniper={q:1,r:0};
  hidden.map.get(hidden.sherman.pos).height=1;
  assert.equal(hidden.map.hasLineOfSight(frontSniper,hidden.sherman.pos),true);
  assert.equal(hidden.map.hasLineOfSight(frontSniper,unitTurretHex(hidden.sherman)),false);
  hidden.enemies.push(infantry('front-visible',frontSniper));
  const safe=hidden.prepare();assert.equal(safe.sniperWillKill,false);safe.apply();
  assert.equal(hidden.sherman.crew.commander,true);assert.equal(hidden.sherman.campaignCommanderShieldAvailable,true);

  const exposed=twoHexFixture(),rearSniper={q:-3,r:0};
  exposed.map.get(unitTurretHex(exposed.sherman)).height=1;
  assert.equal(exposed.map.hasLineOfSight(rearSniper,exposed.sherman.pos),false);
  assert.equal(exposed.map.hasLineOfSight(rearSniper,unitTurretHex(exposed.sherman)),true);
  exposed.enemies.push(infantry('rear-visible',rearSniper));
  const shot=exposed.prepare();assert.equal(shot.sniperWillKill,true);shot.apply();
  assert.equal(exposed.sherman.crew.commander,false);
});

test('actual shooter selection skips front-only threats and preserves closed-hatch protection', () => {
  const fixture=twoHexFixture();
  fixture.enemies.push(infantry('front-only',{q:2,r:0}),infantry('rear-in-range',{q:-3,r:0}));
  assert.equal(fixture.prepare().sniperAttackerId,'rear-in-range');
  fixture.sherman.hatchOpen=false;
  const safe=fixture.prepare();assert.equal(safe.sniperAttackerId,undefined);safe.apply();
  assert.equal(fixture.sherman.crew.commander,true);
});

test('sniper facing, bullet endpoint and impact cell match the actual turret cell', () => {
  class Node { addComponent(Type){return new Type();} setPosition(){} }
  class Transform { setContentSize(){} setAnchorPoint(){} }
  const Scene=require('./helpers/BattleSceneMethods.cjs')(['playTurnEndSniperShot','spawnSniperBulletTrace'],{
    Node,UITransform:Transform,Graphics:class {},isFootUnit,playSniperFire(){},
  });
  for (const kind of ['maus','sherman']) for (let facing=0;facing<6;facing++) {
    const target={...twoHexFixture(facing).sherman,kind,stats:getUnitStats(kind)};
    const hex=unitTurretHex(target),shooter=infantry('sniper',twoSteps(hex,(facing+3)%6));
    let aimed;
    const scene=Object.assign(new Scene(),{mission:{data:{}},node:{layer:1},hexSize:60,mapNode:{addChild(){}},
      project(q,r){return axialToPixel({q,r},60);},infantryFormationOffsets:()=>[{ox:0,oy:0}],hashStringToSeed:()=>0,
      rememberAttackPosition(){},setInfantryVisualFacing:(_,pos)=>{aimed=pos;},redraw(){},canHearBattleAt:()=>false,
      placeProjectileTraceNode(){},drawSniperBulletTrace(){},sniperBulletTraces:[]});
    const callback=()=>{};scene.playTurnEndSniperShot(shooter,target,callback);
    assert(sameHex(aimed,hex));assert.equal(scene.sniperBulletTraces.length,1);
    const trace=scene.sniperBulletTraces[0],center=scene.project(hex.q,hex.r),inset=Math.max(5,scene.hexSize*0.08);
    assert(sameHex(trace.impactHex,hex));assert.equal(trace.onImpact,callback);
    assert(Math.abs(trace.targetX+trace.ux*inset-center.x)<1e-8);
    assert(Math.abs(trace.targetY+trace.uy*inset-center.y)<1e-8);
  }
});
