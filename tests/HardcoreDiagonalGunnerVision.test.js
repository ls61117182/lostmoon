const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap, axialAdd, diagonalFlankFireDirectionTo, directionTo, fireDirectionVector, hexLine, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const {
  computeUnitVisibleHexes,
  diagonalGunnerClickPreference,
} = require('../assets/scripts/core/FogOfWar.ts');
const {
  attackDirectionRuleFromFireDirection,
  attackFireDirection,
  canAttack,
  canMGAttack,
  hitBreakdown,
  rollAttack,
} = require('../assets/scripts/core/Combat.ts');

const fieldMap = () => {
  const map = new HexMap(6, 6);
  for (let q = -1; q <= 4; q++) {
    for (let r = -1; r <= 4; r++) map.set({ pos: { q, r }, terrain: 'field' });
  }
  return map;
};

const tank = (previousTurretFacing = 0) => ({
  id: 'tank',
  kind: 'panzer4',
  faction: 'usa',
  pos: { q: 0, r: 0 },
  facing: 0,
  turretFacing: 6,
  previousTurretFacing,
  hatchOpen: false,
  gunnerVisionRange: 5,
  interiorVisionRange: 1,
  stats: { visionType: 'turreted' },
});

const sees = (visible, q, r) => visible.has(HexMap.keyOf({ q, r }));

{
  const visible = computeUnitVisibleHexes(fieldMap(), tank(0));
  for (const [q, r] of [[1, 0], [1, 1], [2, 1], [2, 2], [3, 2]]) {
    assert(sees(visible, q, r), `clear selected path should include ${q},${r}`);
  }
  assert(!sees(visible, 1, 2), 'clear symmetric sight should include only the side nearer the old facing');
}

{
  const map = fieldMap();
  map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
  const visible = computeUnitVisibleHexes(map, tank());
  assert(sees(visible, 1, 2), 'an adjacent blocker should select the other side');
  assert(!sees(visible, 2, 1), 'the blocked side must not be added');
  assert(sees(visible, 2, 2), 'one complete clear path should preserve the distance-four center');
}

{
  const map = fieldMap();
  map.set({ pos: { q: 2, r: 1 }, terrain: 'rocky' });
  const visible = computeUnitVisibleHexes(map, tank());
  assert(sees(visible, 1, 2), 'the distance-three pair should decide when both adjacent cells are clear');
  assert(!sees(visible, 2, 1), 'only the clear distance-three side should be shown');
}

{
  const map = fieldMap();
  map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
  map.set({ pos: { q: 1, r: 2 }, terrain: 'field', hasBuilding: true });
  const visible = computeUnitVisibleHexes(map, tank());
  assert(sees(visible, 1, 2), 'the selected blocking endpoint itself remains visible');
  assert(!sees(visible, 2, 2), 'opposite-side blockers at distances one and three must hide distance four');
}

{
  const fromZero = computeUnitVisibleHexes(fieldMap(), tank(0));
  const fromSixty = computeUnitVisibleHexes(fieldMap(), tank(1));
  assert(sees(fromZero, 2, 1) && !sees(fromZero, 1, 2));
  assert(!sees(fromSixty, 2, 1) && sees(fromSixty, 1, 2));
}

console.log('Hardcore diagonal gunner vision tests passed');

{
  const map = fieldMap();
  const attacker = tank(0);
  const redTarget = {
    id: 'red', kind: 'panzer4', faction: 'german', pos: { q: 2, r: 1 }, facing: 0,
    stats: { size: 4, armorFront: 10, armorFrontSide: 9, armorRearSide: 8, armorRear: 7, penetration: 2, effectiveRange: 2 },
  };
  const blueTarget = { ...redTarget, id: 'blue', pos: { q: 1, r: 2 } };
  const redContext = { attacker, target: redTarget, map, expandedTurretDirections: true, directionalDamageCheck: true };
  assert.strictEqual(canAttack(redContext).ok, true, 'the selected visible flank must be a legal main-gun target');
  assert.strictEqual(canAttack({ ...redContext, target: blueTarget }).ok, false, 'the unselected flank must remain illegal');
  assert.strictEqual(attackFireDirection(redContext), 6, 'the rules-facing attack direction must remain the halfway turret direction');

  const path = hexLine(attacker.pos, redTarget.pos);
  for (let i = 1; i < path.length - 1; i++) {
    const direction = directionTo(path[i], path[i + 1]);
    const tile = map.get(path[i]);
    tile.hedges = [false, false, false, false, false, false];
    tile.hedges[direction] = true;
  }
  const breakdown = hitBreakdown(redContext);
  assert.strictEqual(breakdown.hedges, path.length - 2, 'hedges must follow the actual center-to-target flank path');

  const rng = { d6: () => 6 };
  const report = rollAttack(redContext, rng);
  assert.strictEqual(
    report.armorFace,
    attackDirectionRuleFromFireDirection(redTarget, 6).armorFace,
    'armor incidence must use the unchanged rules-facing turret direction',
  );

  const infantry = { ...redTarget, id: 'inf', kind: 'german_infantry', stats: { ...redTarget.stats, size: 2 } };
  assert.strictEqual(
    canMGAttack({ attacker, target: infantry, map: fieldMap(), expandedTurretDirections: true }).ok,
    false,
    'a visible flank two hexes away must remain outside the one-hex MG range',
  );
}

console.log('Hardcore diagonal flank attack tests passed');

for (let i = 0; i < 6; i++) {
  const direction = 6 + i;
  const center = axialAdd({ q: 0, r: 0 }, fireDirectionVector(direction));
  assert.strictEqual(diagonalFlankFireDirectionTo({ q: 0, r: 0 }, neighbor(center, i)), direction);
  assert.strictEqual(diagonalFlankFireDirectionTo({ q: 0, r: 0 }, neighbor(center, (i + 1) % 6)), direction);
}

console.log('All six diagonal flank rotation targets passed');

{
  const map = fieldMap();
  map.set({ pos: { q: 2, r: 1 }, terrain: 'field', hasBuilding: true });
  map.set({ pos: { q: 1, r: 2 }, terrain: 'field', hasBuilding: true });
  assert.strictEqual(
    diagonalGunnerClickPreference(map, tank(0), 6, { q: 1, r: 2 }),
    1,
    'a clear clicked path should prefer the clicked flank when both endpoints block',
  );

  map.set({ pos: { q: 0, r: 1 }, terrain: 'field', hasBuilding: true });
  assert.strictEqual(
    diagonalGunnerClickPreference(map, tank(0), 6, { q: 1, r: 2 }),
    null,
    'a blocker earlier on the clicked path must disable the clicked-flank override',
  );
}

{
  const map = fieldMap();
  map.set({ pos: { q: 2, r: 1 }, terrain: 'field', hasBuilding: true });
  assert.strictEqual(
    diagonalGunnerClickPreference(map, tank(0), 6, { q: 2, r: 1 }),
    0,
    'a blocking clicked endpoint should win over a clear opposite endpoint',
  );
  const clickedBlockingSideTank = tank(0);
  clickedBlockingSideTank.diagonalGunnerSidePreference = 0;
  const clickedBlockingSideVision = computeUnitVisibleHexes(map, clickedBlockingSideTank);
  assert(sees(clickedBlockingSideVision, 2, 1), 'the clicked blocking endpoint itself should be visible');
  assert(!sees(clickedBlockingSideVision, 1, 2), 'the clear opposite flank must not replace an explicit clicked side');

  map.set({ pos: { q: 2, r: 1 }, terrain: 'field' });
  assert.strictEqual(
    diagonalGunnerClickPreference(map, tank(0), 6, { q: 1, r: 2 }),
    1,
    'the clicked flank should also win when both endpoints are clear',
  );
}

console.log('Diagonal clicked-flank preference tests passed');

{
  const map = fieldMap();
  const openHatchTank = tank(0);
  openHatchTank.hatchOpen = true;
  openHatchTank.turretFacing = 0;
  openHatchTank.diagonalGunnerSidePreference = 1;
  const flankTarget = {
    id: 'open-hatch-flank', kind: 'panzer4', faction: 'german', pos: { q: 2, r: 1 }, facing: 0,
    stats: { size: 4, armorFront: 10, armorFrontSide: 9, armorRearSide: 8, armorRear: 7, penetration: 2, effectiveRange: 2 },
  };
  const ctx = {
    attacker: openHatchTank,
    target: flankTarget,
    map,
    expandedTurretDirections: true,
    directionalDamageCheck: true,
  };
  assert.strictEqual(canAttack(ctx).ok, true, 'an open-hatch tank must be able to attack a visible flank even when the other flank was selected');
  assert.strictEqual(attackFireDirection(ctx), 6, 'an open-hatch flank attack must derive and use its halfway turret direction');

  const infantry = {
    ...flankTarget,
    id: 'open-hatch-infantry',
    kind: 'german_infantry',
    stats: { ...flankTarget.stats, size: 2 },
  };
  assert.strictEqual(
    canMGAttack({ attacker: openHatchTank, target: infantry, map, expandedTurretDirections: true }).ok,
    false,
    'an open hatch must not extend the one-hex machine-gun range',
  );

  const closedHatchTank = { ...openHatchTank, hatchOpen: false };
  assert.strictEqual(
    canAttack({ ...ctx, attacker: closedHatchTank }).ok,
    false,
    'closing the hatch must restore the selected single-flank gunner-vision restriction',
  );
}

console.log('Open-hatch diagonal flank attack tests passed');
