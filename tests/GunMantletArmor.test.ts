declare function require(name: string): any;

const assert = require('assert');

import { mgHitThreshold, previewAttack, rollAttack } from '../assets/scripts/core/Combat';
import { fireDirectionVector, HexMap, neighbor } from '../assets/scripts/core/HexGrid';
import type { Tile, Unit } from '../assets/scripts/core/types';

function tank(id: string, q: number, r: number): Unit {
  return {
    id,
    kind: 'panzer4',
    faction: id === 'attacker' ? 'usa' : 'german',
    pos: { q, r },
    facing: 0,
    turretFacing: 0,
    stats: {
      faction: id === 'attacker' ? 'usa' : 'german',
      size: 4,
      armorFront: 10,
      armorFrontSide: 9,
      armorRearSide: 8,
      armorRear: 7,
      gunMantletArmor: 0,
      penetration: 2,
      highExplosivePower: 2,
      effectiveRange: 4,
      turretTraverseSpeed: 6,
      mobility: 3,
      usCasualtyDice: 0,
      moveSound: '',
      attackSound: '',
      infantryTankCoordination: 0,
      visionType: 'turreted',
      visionRange: 6,
      gunnerVisionRange: 6,
      interiorVisionRange: 1,
      hasRadio: true,
      crewMembers: [],
    },
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  };
}

function fieldMap(min: number, max: number): HexMap {
  const map = new HexMap(max - min + 1, max - min + 1);
  for (let q = min; q <= max; q++) {
    for (let r = min; r <= max; r++) map.set({ pos: { q, r }, terrain: 'field' } as Tile);
  }
  return map;
}

{
  const target = tank('target', 0, 0);
  target.stats.gunMantletArmor = 2;
  const map = fieldMap(0, 1);
  const hardcore = { target, map, expandedTurretDirections: true, gunMantletArmor: true };

  assert.strictEqual(previewAttack({ ...hardcore, attacker: tank('front', 1, 0) }).pen.armor, 12);
  const report = rollAttack(
    { ...hardcore, attacker: tank('front-report', 1, 0) },
    { d6: () => 6 } as any,
  );
  assert.strictEqual(report.armor, 12);
  assert.strictEqual(report.gunMantletArmor, 2);
  assert.strictEqual(previewAttack({ ...hardcore, attacker: tank('plus-thirty', 1, 1) }).pen.armor, 12);
  assert.strictEqual(previewAttack({ ...hardcore, attacker: tank('plus-sixty', 0, 1) }).pen.armor, 9);
  assert.strictEqual(previewAttack({
    ...hardcore,
    attacker: tank('classic-front', 1, 0),
    gunMantletArmor: false,
  }).pen.armor, 10);

  target.stats.visionType = 'fixed';
  assert.strictEqual(previewAttack({ ...hardcore, attacker: tank('fixed-front', 1, 0) }).pen.armor, 10);
}

{
  const target = tank('at-gun-target', 0, 0);
  target.kind = 'at_gun';
  target.atGunCrewAlive = true;
  target.atGunCrewTargetSize = 3;
  target.stats.visionType = 'fixed';
  const map = fieldMap(0, 1);

  for (const [id, q, r, shieldBonus] of [
    ['front', 1, 0, 1],
    ['plus-thirty', 1, 1, 1],
    ['plus-sixty', 0, 1, 0],
  ] as const) {
    const attacker = tank(`at-gun-${id}`, q, r);
    const context = { attacker, target, map, hardcoreTankMachineGuns: true, tankMachineGun: 'coaxial' as const };
    target.turretFacing = 3;
    const withoutShield = mgHitThreshold({ ...context, atGunCrewTargets: true });
    target.turretFacing = 0;
    assert.strictEqual(
      mgHitThreshold({ ...context, atGunCrewTargets: true }),
      withoutShield + shieldBonus,
      `AT-gun shield arc mismatch for ${id}`,
    );
  }
}

{
  // The two red/blue flank positions around a 90-degree halfway ray must both
  // retain the central 90-degree incidence used by the attacking turret.
  const map = fieldMap(-3, 3);
  const attacker = tank('attacker', 0, 0);
  attacker.turretFacing = 7; // FireDirection 7 is the 90-degree halfway ray.
  attacker.hatchOpen = true;
  const center = fireDirectionVector(7);
  const targets = [neighbor(center, 1), neighbor(center, 2)].map((pos, index) => {
    const target = tank(index === 0 ? 'red-flank' : 'blue-flank', pos.q, pos.r);
    target.turretFacing = 10; // Faces the incoming shot opposite that 90-degree ray.
    target.stats.gunMantletArmor = 1;
    return target;
  });

  for (const target of targets) {
    assert.strictEqual(previewAttack({
      attacker,
      target,
      map,
      expandedTurretDirections: true,
      gunMantletArmor: true,
    }).pen.armor, 10);
  }
}

console.log('Gun mantlet armor tests passed');
