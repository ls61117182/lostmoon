import {
  ambushHitThresholdModifier,
  ambushHitThresholdModifierDetails,
  beginAmbushTurn,
  endAmbushTurn,
  markAmbushAction,
  markAmbushTargeted,
} from '../assets/scripts/core/Ambush';
import type { Unit } from '../assets/scripts/core/types';

function unit(kind: Unit['kind'] = 'panzer4'): Unit {
  return {
    id: 'ambush-test',
    kind,
    faction: 'german',
    pos: { q: 0, r: 0 },
    facing: 0,
    stats: {} as Unit['stats'],
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  };
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const untouched = unit();
beginAmbushTurn(untouched, 'hardcore');
equal(ambushHitThresholdModifier(untouched, 'hardcore'), -1, 'untouched first shot ambushes');
equal(ambushHitThresholdModifier(untouched, 'hardcore', 'machine_gun'), 0, 'machine gun never receives ambush modifier');
markAmbushAction(untouched);
equal(ambushHitThresholdModifier(untouched, 'hardcore'), 0, 'action cancels ambush');

const attacked = unit();
endAmbushTurn(attacked);
markAmbushTargeted(attacked);
beginAmbushTurn(attacked, 'hardcore');
equal(ambushHitThresholdModifier(attacked, 'hardcore'), 0, 'being targeted cancels next ambush');

const calm = unit();
calm.crewSkills = { loader: ['calm'] };
endAmbushTurn(calm);
markAmbushTargeted(calm);
beginAmbushTurn(calm, 'hardcore');
equal(ambushHitThresholdModifier(calm, 'hardcore'), -1, 'calm ignores incoming attacks');
calm.crew!.loader = false;
beginAmbushTurn(calm, 'hardcore');
equal(ambushHitThresholdModifier(calm, 'hardcore'), 0, 'dead skilled crew does not contribute');

const master = unit();
master.crewSkills = { gunner: ['ambush_master'] };
beginAmbushTurn(master, 'hardcore');
equal(ambushHitThresholdModifier(master, 'hardcore'), -2, 'ambush master grants total minus two');
equal(ambushHitThresholdModifierDetails(master, 'hardcore').length, 2, 'ambush and ambush master display separately');
equal(ambushHitThresholdModifierDetails(master, 'hardcore')[0]?.value, -1, 'base ambush display value');
equal(ambushHitThresholdModifierDetails(master, 'hardcore')[1]?.value, -1, 'ambush master display value');

const infantry = unit('german_infantry');
beginAmbushTurn(infantry, 'hardcore');
equal(ambushHitThresholdModifier(infantry, 'hardcore'), 0, 'infantry never ambushes');

const classic = unit();
beginAmbushTurn(classic, 'classic');
equal(ambushHitThresholdModifier(classic, 'classic'), 0, 'classic mode has no ambush');

const smoked = unit();
smoked.crewSkills = { commander: ['calm'] };
endAmbushTurn(smoked, true);
beginAmbushTurn(smoked, 'hardcore');
equal(ambushHitThresholdModifier(smoked, 'hardcore'), 0, 'smoke at turn end prevents ambush even with calm');

console.log('Ambush tests passed');
