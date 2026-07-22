declare function require(name: string): any;

const assert = require('assert');
import { decideEnemyTurn } from '../assets/scripts/core/EnemyAI';
import { HexMap } from '../assets/scripts/core/HexGrid';
import { Unit } from '../assets/scripts/core/types';

function tank(id: string, q: number, r: number, facing: 0 | 1 | 2 | 3 | 4 | 5, faction: 'usa' | 'german'): Unit {
  return {
    id,
    kind: faction === 'german' ? 'panzer4' : 'sherman',
    faction,
    pos: { q, r },
    facing,
    stats: {
      faction,
      size: 4,
      armorFront: 7,
      armorFrontSide: 5,
      armorRearSide: 5,
      armorRear: 4,
      penetration: 4,
    },
  } as Unit;
}

function fieldMap(min: number, max: number): HexMap {
  const map = new HexMap(max - min + 1, max - min + 1);
  for (let q = min; q <= max; q++) {
    for (let r = min; r <= max; r++) {
      map.set({ pos: { q, r }, terrain: 'field' });
    }
  }
  return map;
}

{
  const enemy = tank('enemy', 0, 0, 0, 'german');
  const target = tank('sherman', 1, 0, 3, 'usa');
  const occupied = new Set<string>(['1,0']);

  assert.strictEqual(
    decideEnemyTurn(enemy, target, fieldMap(-2, 2), occupied, { d6: () => 1 } as any),
    'stay',
    'enemy should not turn when the current target blocks the adjacent front hex',
  );
}
