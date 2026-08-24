const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { computeRadioSharedVisibleHexes, computeUnitVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
const { canAttack, canMGAttack, hitBreakdown, mgHitBreakdown } = require('../assets/scripts/core/Combat.ts');
const { beginAmbushTurn, endAmbushTurn, ambushHitThresholdModifier } = require('../assets/scripts/core/Ambush.ts');

const map = new HexMap(8, 8);
for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });

function tank(id, faction, q) {
  return {
    id,
    kind: faction === 'german' ? 'panzer4' : 'sherman',
    faction,
    pos: { q, r: 0 },
    facing: 0,
    turretFacing: 0,
    hatchOpen: true,
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
    stats: {
      faction, size: 4, armorFront: 4, armorFrontSide: 3, armorRearSide: 2,
      armorRear: 1, penetration: 4, effectiveRange: 5, visionRange: 5,
      gunnerVisionRange: 5, interiorVisionRange: 1, visionType: 'turreted', hasRadio: true,
    },
  };
}

function infantry(id, faction, q) {
  return {
    id,
    kind: faction === 'german' ? 'german_infantry' : 'american_infantry',
    faction,
    pos: { q, r: 0 },
    facing: null,
    stats: {
      faction, size: 0, armorFront: 0, armorFrontSide: 0, armorRearSide: 0,
      armorRear: 0, penetration: 2, effectiveRange: 1, visionRange: 2,
      visionType: 'infantry', hasRadio: true,
    },
  };
}

const smokeAtOrigin = new Set([HexMap.keyOf({ q: 0, r: 0 })]);
const receiver = tank('receiver', 'american', 0);
const direct = computeUnitVisibleHexes(map, receiver, undefined, smokeAtOrigin);
assert.strictEqual(direct.has(HexMap.keyOf({ q: 1, r: 0 })), true, 'a unit in smoke keeps direct vision at range 1');
assert.strictEqual(direct.has(HexMap.keyOf({ q: 2, r: 0 })), false, 'a unit in smoke has no direct vision beyond range 1');

const sender = infantry('sender', 'american', 3);
const shared = computeRadioSharedVisibleHexes(map, receiver, [sender], undefined, smokeAtOrigin);
assert.strictEqual(shared.has(HexMap.keyOf({ q: 5, r: 0 })), true, 'a unit in smoke still receives friendly radio vision');
assert.strictEqual(shared.has(HexMap.keyOf(receiver.pos)), true, 'the receiver still knows its own occupied hex');

const outsideReceiver = tank('outside-receiver', 'american', 4);
outsideReceiver.hatchOpen = false;
const smokedSender = tank('smoked-sender', 'american', 0);
const smokeIntel = computeRadioSharedVisibleHexes(map, outsideReceiver, [smokedSender], undefined, smokeAtOrigin);
assert.strictEqual(
  smokeIntel.has(HexMap.keyOf(smokedSender.pos)),
  true,
  'an intact-radio friendly in smoke shares vision of its own smoke hex',
);
smokedSender.radioDamaged = true;
assert.strictEqual(
  computeRadioSharedVisibleHexes(map, outsideReceiver, [smokedSender], undefined, smokeAtOrigin)
    .has(HexMap.keyOf(smokedSender.pos)),
  false,
  'a radio-damaged friendly cannot share its smoke hex',
);
smokedSender.radioDamaged = false;
outsideReceiver.radioDamaged = true;
assert.strictEqual(
  computeRadioSharedVisibleHexes(map, outsideReceiver, [smokedSender], undefined, smokeAtOrigin)
    .has(HexMap.keyOf(smokedSender.pos)),
  false,
  'a radio-damaged observer cannot receive a friendly smoke hex',
);

const smokeInLine = new Set([HexMap.keyOf({ q: 1, r: 0 })]);
const observer = infantry('observer', 'american', 0);
const obscured = computeUnitVisibleHexes(map, observer, undefined, smokeInLine);
assert.strictEqual(obscured.has(HexMap.keyOf({ q: 1, r: 0 })), true, 'the smoke hex itself remains visible from outside');
assert.strictEqual(obscured.has(HexMap.keyOf({ q: 2, r: 0 })), false, 'smoke blocks vision to hexes behind it');

const attacker = tank('attacker', 'american', 0);
const target = tank('target', 'german', 2);
const hardcore = { expandedTurretDirections: true };
assert.strictEqual(canAttack({ attacker, target, map, smokeHexes: smokeAtOrigin, ...hardcore }).ok, true, 'a tank in smoke may fire outside');
assert.strictEqual(hitBreakdown({ attacker, target, map, smokeHexes: smokeAtOrigin, ...hardcore }).smoke, 2, 'an attacker in smoke gets the hardcore +2 hit threshold');
assert.strictEqual(canAttack({ attacker, target, map, smokeHexes: smokeInLine, ...hardcore }).ok, false, 'smoke blocks main-gun fire through its hex');
const targetInSmoke = { ...target, pos: { q: 1, r: 0 } };
assert.strictEqual(canAttack({ attacker, target: targetInSmoke, map, smokeHexes: smokeInLine, ...hardcore }).ok, true, 'a target inside smoke may be attacked from outside');
assert.strictEqual(hitBreakdown({ attacker, target: targetInSmoke, map, smokeHexes: smokeInLine, ...hardcore }).smoke, 2, 'a target in smoke gets the hardcore +2 hit threshold');
const mgTarget = infantry('mg-target', 'german', 1);
assert.strictEqual(canMGAttack({ attacker, target: mgTarget, map, smokeHexes: smokeAtOrigin, ...hardcore }).ok, true, 'a tank in smoke may use its MG outside');
assert.strictEqual(mgHitBreakdown({ attacker, target: mgTarget, map, smokeHexes: smokeAtOrigin, ...hardcore }).smoke, 2, 'MG fire from smoke gets the hardcore +2 hit threshold');

assert.strictEqual(canAttack({ attacker, target, map, smokeHexes: smokeInLine }).ok, true, 'classic attacks ignore smoke along the firing ray');
assert.strictEqual(canAttack({ attacker, target: targetInSmoke, map, smokeHexes: smokeInLine }).ok, true, 'classic attacks may target a smoke hex');
assert.strictEqual(hitBreakdown({ attacker, target, map, smokeHexes: smokeAtOrigin }).smoke, 0, 'classic smoke does not penalize the attacker');
assert.strictEqual(hitBreakdown({ attacker, target: targetInSmoke, map, smokeHexes: smokeInLine }).smoke, 1, 'classic smoke keeps its target-only +1 hit threshold');

const closeInfantry = infantry('close-infantry', 'american', 1);
const closeTank = { ...target, pos: { q: 1, r: 0 } };
assert.strictEqual(canAttack({
  attacker: closeInfantry,
  target: closeTank,
  map,
  smokeHexes: smokeInLine,
  expandedTurretDirections: true,
  sameHexInfantryTankAttack: true,
}).ok, true, 'infantry may attack an enemy tank sharing the same smoke hex');
assert.strictEqual(hitBreakdown({
  attacker: closeInfantry,
  target: closeTank,
  map,
  smokeHexes: smokeInLine,
  expandedTurretDirections: true,
  sameHexInfantryTankAttack: true,
}).smoke, 2, 'same-hex infantry attacks from smoke get the hardcore +2 hit threshold');

const ambusher = tank('ambusher', 'american', 0);
ambusher.crewSkills = { loader: ['calm'] };
endAmbushTurn(ambusher, true);
beginAmbushTurn(ambusher, 'hardcore');
assert.strictEqual(ambushHitThresholdModifier(ambusher, 'hardcore'), 0, 'ending a turn in smoke prevents next-turn ambush even with Calm');

console.log('Smoke rules tests passed');
