import { RNG } from './Dice';
import { axialToOffset, HexMap } from './HexGrid';
import { makeUnit } from './MissionLoader';
import type { LoadedMission } from './MissionLoader';
import { regionalReinforcementAllowed } from './MultiRegion';
import type { MultiRegionDefinition, Unit } from './types';
import { initialMainGunLoadingState, isTankUnit } from './types';
import { planAirborneSupport, landAirborneUnit, airborneReactionContext } from './AirborneSupport';
import { rollMGAttack, applyMGAttack } from './Combat';

export type RegionalEvent = NonNullable<MultiRegionDefinition['events']>[number];

export function rollRegionalEvent(region: MultiRegionDefinition, rng: RNG): { sum: number; event?: RegionalEvent } {
  const sum = rng.d6() + rng.d6();
  return { sum, event: region.events?.find(event => sum >= event.min && sum <= event.max) };
}

export function applyRegionalReinforcement(
  mission: LoadedMission, region: MultiRegionDefinition, event: RegionalEvent,
  rng: RNG, nextId: () => string, hardcore: boolean,
): Unit[] {
  if (!regionalReinforcementAllowed(mission, region.id, event.side, !!event.airborne)) return [];
  if (event.airborne) {
    const plan = planAirborneSupport(mission, event.side === 'player' ? 'friendly' : 'enemy', rng, nextId, new Set(region.tileKeys));
    if (!plan) return [];
    const reacted = new Set<string>();
    for (const unit of plan.units) {
      landAirborneUnit(mission, plan, unit);
      for (const attacker of [mission.sherman, ...mission.allies, ...mission.enemies]) {
        const context = airborneReactionContext(mission, attacker, unit, reacted, hardcore);
        if (!context) continue;
        reacted.add(attacker.id);
        applyMGAttack(unit, rollMGAttack(context, rng));
        if (unit.destroyed) break;
      }
    }
    return plan.units;
  }
  const keys = event.side === 'player' ? region.friendlySpawnKeys : region.enemySpawnKeys;
  const all = [mission.sherman, ...mission.allies, ...mission.enemies];
  const candidate = makeUnit(nextId(), { kind: event.kind, faction: event.side === 'player' ? 'usa' : 'german',
    at: axialToOffset(region.center), facing: event.side === 'player' ? 0 : 3 }, 0, { sideId: event.side, controller: 'ai' });
  const legal = keys.map(key => { const [q, r] = key.split(',').map(Number); return { q, r }; })
    .filter(pos => mission.map.canUnitEnter(pos, candidate.faction)
      && (candidate.stats.visionType === 'infantry' || mission.map.canTankEnter(pos, candidate.faction))
      && !all.some(unit => !unit.destroyed && HexMap.keyOf(unit.pos) === HexMap.keyOf(pos)));
  if (!legal.length) return [];
  candidate.pos = { ...rng.pick(legal) };
  if (hardcore && isTankUnit(candidate)) Object.assign(candidate, initialMainGunLoadingState(candidate.stats));
  (event.side === 'player' ? mission.allies : mission.enemies).push(candidate);
  return [candidate];
}
