import { visualDamageSmokeLevel } from '../assets/scripts/core/UnitVisualState';
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
assertEqual(visualDamageSmokeLevel(tank('ally', 'allied', true), 'sherman'), 2, 'allied non-player damaged tank');
assertEqual(visualDamageSmokeLevel(tank('sherman', 'allied', true), 'sherman'), 0, 'player tank damaged state');
assertEqual(visualDamageSmokeLevel(tank('burning', 'german', false, 3), 'sherman'), 3, 'real fire level');

console.log('Unit visual smoke tests passed');
