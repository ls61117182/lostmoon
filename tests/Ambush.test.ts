import {
  ambushHitThresholdModifier, ambushHitThresholdModifierDetails,
  beginAmbushTurn, canEnterAmbush, endAmbushTurn, isInAmbushSight, enterAmbush,
  markAmbushAction, markAmbushTargeted, orderedAmbushers,
} from '../assets/scripts/core/Ambush';
import type { Unit } from '../assets/scripts/core/types';

function tank(): Unit {
  return {
    id: 'ambush-test', kind: 'sherman', faction: 'usa',
    pos: { q: 0, r: 0 }, facing: 0, stats: {} as Unit['stats'],
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
    loaded: true, loadedShell: 'ap',
  };
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const ready = tank();
equal(canEnterAmbush(ready, 'hardcore'), true, 'loaded AP is eligible');
equal(enterAmbush(ready, 'hardcore'), true, 'explicit action enters stance');
endAmbushTurn(ready);
markAmbushTargeted(ready);
equal(ready.ambushReadyThisTurn, true, 'stance persists through turn end and incoming fire');
equal(ambushHitThresholdModifier(ready, 'hardcore'), 0, 'reaction has no first-shot bonus');
equal(ambushHitThresholdModifierDetails(ready, 'hardcore').length, 0, 'no old modifier breakdown');
markAmbushAction(ready);
equal(ready.ambushReadyThisTurn, false, 'movement or attack cancels stance');
enterAmbush(ready, 'hardcore');
beginAmbushTurn(ready, 'hardcore');
equal(ready.ambushReadyThisTurn, false, 'next own action expires stance');

for (const shell of [null, 'smoke', 'hvap'] as const) {
  const u = tank();
  u.loadedShell = shell;
  equal(canEnterAmbush(u, 'hardcore'), false, `${shell} cannot enter`);
  if (shell !== null) equal(canEnterAmbush(u, 'hardcore', true), false, `${shell} cannot auto-enter`);
}
const he = tank();
he.loadedShell = 'he';
equal(canEnterAmbush(he, 'hardcore'), true, 'loaded HE is eligible');
he.turretDamaged = true;
equal(canEnterAmbush(he, 'hardcore'), false, 'damaged turret cannot enter');
he.turretDamaged = false;
he.crew!.gunner = false;
equal(canEnterAmbush(he, 'hardcore'), false, 'dead gunner cannot enter');
equal(canEnterAmbush(tank(), 'classic'), false, 'classic mode has no stance');

const sight = new Set(['1,0', '2,0']);
const keyOf = (hex: { q: number; r: number }) => `${hex.q},${hex.r}`;
equal(isInAmbushSight({ q: 1, r: 0 }, sight, keyOf), true, 'moving into sight triggers');
equal(isInAmbushSight({ q: 2, r: 0 }, sight, keyOf), true, 'moving within sight also triggers');
equal(isInAmbushSight({ q: 0, r: 1 }, sight, keyOf), false, 'outside sight does not trigger');

const first = tank();
const second = tank();
second.id = 'second';
equal(enterAmbush(first, 'hardcore', false, [first, second]), true, 'first stance activates');
equal(enterAmbush(second, 'hardcore', false, [first, second]), true, 'second stance activates');
equal(first.ambushEnteredOrder, 1, 'first activation gets first priority');
equal(second.ambushEnteredOrder, 2, 'second activation follows first');
const mover = tank();
mover.kind = 'panzer4';
mover.faction = 'german';
const inOrder = orderedAmbushers([second, mover, first], mover);
equal(inOrder[0], first, 'earliest stance fires first regardless of unit array order');
equal(inOrder[1], second, 'later stance fires second');
markAmbushAction(first);
equal(orderedAmbushers([second, first], mover)[0], second, 'spent stance is skipped');
mover.destroyed = true;
equal(orderedAmbushers([second, first], mover).length, 0, 'no later ambush fires after the mover is destroyed');

console.log('Ambush tests passed');
