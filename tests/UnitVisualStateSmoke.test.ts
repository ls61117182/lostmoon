import { visualDamageSmokeLevel, visualFireEffectLevel } from '../assets/scripts/core/UnitVisualState';
import { Unit } from '../assets/scripts/core/types';

const tank = (id: string, faction: Unit['faction'], damaged: boolean, fireLevel = 0): Unit => ({
  id,
  kind: 'panzer4',
  faction,
  pos: { q: 0, r: 0 },
  facing: 0,
  stats: {} as Unit['stats'],
  damaged,
  fireLevel,
});

const assertEqual = (actual: number, expected: number, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

assertEqual(visualDamageSmokeLevel(tank('enemy', 'german', true), 'sherman'), 2, 'german damaged tank');
assertEqual(visualDamageSmokeLevel(tank('japanese', 'japanese', true), 'sherman'), 2, 'japanese damaged tank');
assertEqual(visualDamageSmokeLevel(tank('ally', 'usa', true), 'sherman'), 2, 'US non-player damaged tank');
assertEqual(visualDamageSmokeLevel(tank('sherman', 'usa', true), 'sherman'), 0, 'player tank damaged state');
assertEqual(visualDamageSmokeLevel(tank('burning', 'german', false, 3), 'sherman'), 3, 'real fire level');

const destroyedTank = tank('destroyed', 'german', false, 4);
destroyedTank.destroyed = true;
assertEqual(visualFireEffectLevel(destroyedTank, 'sherman', true), 1, 'newly destroyed tank uses level-1 fire');
assertEqual(visualFireEffectLevel(destroyedTank, 'sherman', false), 0, 'destroyed tank fire clears next turn');

const destroyedInfantry = tank('infantry', 'german', false);
destroyedInfantry.kind = 'infantry';
destroyedInfantry.destroyed = true;
assertEqual(visualFireEffectLevel(destroyedInfantry, 'sherman', true), 0, 'destroyed non-tank does not burn');

console.log('Unit visual smoke tests passed');
