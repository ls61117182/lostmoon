declare function require(name: string): any;

const assert = require('assert');

import {
  applyCampaignUpgradesToSherman,
  campaignUpgradeDiceBonus,
  reviveFirstCampaignCrewMember,
} from '../assets/scripts/core/CampaignUpgrade';
import { applyAttack, canAttack } from '../assets/scripts/core/Combat';
import { HexMap } from '../assets/scripts/core/HexGrid';
import type { AttackReport } from '../assets/scripts/core/Combat';
import type { Tile, Unit } from '../assets/scripts/core/types';

function tank(id: string, faction: Unit['faction'], q = 0): Unit {
  return {
    id,
    kind: faction === 'usa' ? 'sherman' : 'type97',
    faction,
    pos: { q, r: 0 },
    facing: q === 0 ? 0 : 3,
    stats: {
      faction,
      size: 4,
      armorFront: 11,
      armorFrontSide: 10,
      armorRearSide: 9,
      armorRear: 8,
      penetration: 2,
      effectiveRange: 2,
      usCasualtyDice: 0,
      visionRange: 4,
      gunnerVisionRange: 4,
      interiorVisionRange: 1,
      hasRadio: true,
      visionType: 'turreted',
      moveSound: '',
      attackSound: '',
      infantryTankCoordination: 1,
      crewMembers: [1, 2, 3, 4, 5],
    },
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  };
}

function damageReport(effect: 'paralyzed'): AttackReport {
  return {
    dice: [6, 6],
    roll: 12,
    threshold: 2,
    hit: true,
    penetrated: true,
    damageEffect: effect,
    statusChange: 'damaged',
  };
}

{
  assert.strictEqual(campaignUpgradeDiceBonus(['wide_tracks'], 'mud', 'attack'), 1);
  assert.strictEqual(campaignUpgradeDiceBonus(['wide_tracks'], 'beach', 'movement'), 1);
  assert.strictEqual(campaignUpgradeDiceBonus(['wide_tracks'], 'beach', 'misc'), 1);
}

{
  const sherman = tank('sherman', 'usa');
  applyCampaignUpgradesToSherman(sherman, [
    'mine_roller',
    'camouflage_net',
    'reinforced_transmission',
    'commander_ballistic_shield',
  ]);
  assert.strictEqual(sherman.campaignMineDamageImmune, true);
  assert.strictEqual(sherman.campaignHiddenCloseRangeUntargetable, true);
  assert.strictEqual(sherman.campaignMechanicalFailureImmune, true);

  applyAttack(sherman, damageReport('paralyzed'));
  assert.strictEqual(sherman.paralyzed, undefined, 'first attack-caused paralysis is cancelled');
  assert.strictEqual(sherman.campaignParalyzedProtectionAvailable, false);
  applyAttack(sherman, damageReport('paralyzed'));
  assert.strictEqual(sherman.paralyzed, true, 'later paralysis applies normally');

  applyAttack(sherman, {
    dice: [4, 4], roll: 8, threshold: 4, hit: true, penetrated: false,
    commanderShieldBlocked: true, statusChange: 'none',
  });
  assert.strictEqual(sherman.crew?.commander, true);
  assert.strictEqual(sherman.campaignCommanderShieldAvailable, false);
  applyAttack(sherman, {
    dice: [5, 5], roll: 10, threshold: 4, hit: true, penetrated: false,
    commanderKilledByHitDoubles: true, statusChange: 'none',
  });
  assert.strictEqual(sherman.crew?.commander, false);
}

{
  const map = new HexMap(4, 1);
  for (let q = 0; q < 4; q++) {
    map.set({ pos: { q, r: 0 }, terrain: 'clear' } as Tile);
  }
  const target = tank('hidden-sherman', 'usa', 0);
  target.hidden = true;
  target.campaignHiddenCloseRangeUntargetable = true;
  assert.strictEqual(canAttack({ attacker: tank('near', 'japanese', 2), target, map }).ok, false);
  assert.strictEqual(canAttack({ attacker: tank('far', 'japanese', 3), target, map }).ok, true);
}

{
  const sherman = tank('medic', 'usa');
  sherman.crew = { commander: false, loader: false, gunner: true, driver: true, coDriver: true };
  assert.strictEqual(reviveFirstCampaignCrewMember(sherman), 'commander');
  assert.strictEqual(sherman.crew.commander, true);
  assert.strictEqual(sherman.crew.loader, false);
}

console.log('Campaign upgrade effect tests passed');
