import { HexMap, hexDistance, neighbors, directionTo } from './HexGrid';
import type { LoadedMission } from './MissionLoader';
import {
  Axial, battleSideIdOf, isAbandonedATGun, isAbandonedTank, isAttachedATGunCrew,
  MultiRegionDefinition, MultiRegionIntel, MultiRegionState, Unit,
} from './types';

export function regionAt(mission: LoadedMission, pos: Axial): string | null {
  return mission.map.regions.get(HexMap.keyOf(pos)) ?? null;
}

export function regionalCombatants(mission: LoadedMission, id: string): Unit[] {
  return [mission.sherman, ...mission.allies, ...mission.enemies].filter(unit =>
    !unit.destroyed && !isAbandonedTank(unit) && !isAbandonedATGun(unit)
    && !isAttachedATGunCrew(unit) && regionAt(mission, unit.pos) === id);
}

export function regionIntel(mission: LoadedMission, id: string): MultiRegionIntel {
  const units = regionalCombatants(mission, id);
  const friendly = units.filter(unit => battleSideIdOf(unit) === 'player');
  const enemy = units.filter(unit => battleSideIdOf(unit) === 'enemy');
  const power = (group: Unit[]) => group.reduce((sum, unit) =>
    sum + (mission.data.multiRegion?.powerCosts[unit.kind] ?? 1), 0);
  return {
    id, state: friendly.length ? (enemy.length ? 'contested' : 'friendly') : enemy.length ? 'enemy' : 'empty',
    friendlyPower: power(friendly), enemyPower: !friendly.length && enemy.length ? null : power(enemy),
  };
}

export function initializeMultiRegion(mission: LoadedMission): void {
  const config = mission.data.multiRegion;
  if (!config) return;
  const known = new Set<string>();
  for (const region of config.regions) {
    if (!region.id || known.has(region.id)) throw new Error('Duplicate/empty region ID');
    known.add(region.id);
    for (const key of region.tileKeys) {
      const [q, r] = key.split(',').map(Number);
      if (!mission.map.has({ q, r }) || mission.map.regions.has(key)) throw new Error(`Invalid region tile ${key}`);
      mission.map.regions.set(key, region.id);
    }
  }
  if (mission.map.all().some(tile => !tile.displayOnly && !mission.map.regions.has(HexMap.keyOf(tile.pos)))) {
    throw new Error('Multi-region map has unowned playable tiles');
  }
  mission.multiRegionState = {
    intelTurn: 0, intel: [], supportTargets: {}, seenDestroyedIds: [], localVictory: false,
  };
  refreshRegionIntel(mission, 1);
}

export function refreshRegionIntel(mission: LoadedMission, turn: number): void {
  const state = mission.multiRegionState;
  if (!state || state.intelTurn === turn) return;
  state.intel = mission.data.multiRegion!.regions.map(region => regionIntel(mission, region.id));
  state.intelTurn = turn;
}

/** Record the actual region in which the common objective first became complete. */
export function updateRegionalVictory(mission: LoadedMission): boolean {
  const state = mission.multiRegionState;
  if (!state) return true;
  const objective = mission.data.objective;
  const targets = mission.enemies.filter(unit => unit.kind === objective.kind && unit.destroyed);
  const required = objective.count ?? mission.enemies.filter(unit => unit.kind === objective.kind).length;
  const old = new Set(state.seenDestroyedIds);
  if (old.size < required && required > 0 && targets.length >= required) {
    const current = regionAt(mission, mission.sherman.pos);
    state.localVictory = targets.some(unit => !old.has(unit.id) && regionAt(mission, unit.pos) === current);
  }
  state.seenDestroyedIds = targets.map(unit => unit.id);
  return state.localVictory;
}

export function regionalReinforcementAllowed(mission: LoadedMission, id: string, side: 'player' | 'enemy', airborne = false): boolean {
  const config = mission.data.multiRegion;
  if (!config) return true;
  const units = regionalCombatants(mission, id);
  if (units.filter(unit => battleSideIdOf(unit) === side).length > config.reinforcementLimit) return false;
  const intel = regionIntel(mission, id);
  if (airborne) return true;
  return intel.state === 'contested' || intel.state === (side === 'player' ? 'friendly' : 'enemy');
}

/** Route to a region's first reachable tile, never to hidden enemies' exact positions. */
function routeToRegion(mission: LoadedMission, actor: Unit, destination: string): Axial[] | null {
  const occupied = new Set([mission.sherman, ...mission.allies, ...mission.enemies]
    .filter(unit => unit !== actor && !unit.destroyed && !unit.mountedOnUnitId)
    .map(unit => HexMap.keyOf(unit.pos)));
  const queue: Axial[] = [actor.pos];
  const parents = new Map<string, Axial | null>([[HexMap.keyOf(actor.pos), null]]);
  for (let i = 0; i < queue.length; i++) {
    const pos = queue[i];
    if (regionAt(mission, pos) === destination) {
      const route: Axial[] = [];
      let step: Axial | null = pos;
      while (step && parents.get(HexMap.keyOf(step)) !== null) {
        route.unshift(step);
        step = parents.get(HexMap.keyOf(step)) ?? null;
      }
      return route;
    }
    for (const next of neighbors(pos)) {
      const key = HexMap.keyOf(next);
      if (parents.has(key) || occupied.has(key)) continue;
      if (!mission.map.canUnitCrossEdge(pos, next, actor, { faction: actor.faction })) continue;
      parents.set(key, pos);
      queue.push(next);
    }
  }
  return null;
}

export function regionalSupportStep(mission: LoadedMission, actor: Unit): Axial | null {
  const config = mission.data.multiRegion;
  const state = mission.multiRegionState;
  if (!config || !state || actor.destroyed || actor.paralyzed) return null;
  const own = battleSideIdOf(actor) === 'player' ? 'friendly' : 'enemy';
  const here = regionAt(mission, actor.pos);
  if (!here || regionIntel(mission, here).state !== own) return null;
  const candidates = config.regions.map(region => ({ region, intel: regionIntel(mission, region.id) }))
    .filter(item => item.region.id !== here && item.intel.state !== 'empty' && item.intel.state !== own)
    .sort((a, b) => (a.intel.state === 'contested' ? 0 : 1) - (b.intel.state === 'contested' ? 0 : 1)
      || hexDistance(actor.pos, a.region.center) - hexDistance(actor.pos, b.region.center)
      || a.region.id.localeCompare(b.region.id));
  const current = candidates.find(item => item.region.id === state.supportTargets[actor.id]);
  const currentRoute = current ? routeToRegion(mission, actor, current.region.id) : null;
  if (current && currentRoute?.length && !(current.intel.state !== 'contested' && candidates.some(item => item.intel.state === 'contested'))) {
    return currentRoute[0];
  }
  for (const candidate of candidates) {
    const route = routeToRegion(mission, actor, candidate.region.id);
    if (!route?.length) continue;
    state.supportTargets[actor.id] = candidate.region.id;
    return route[0];
  }
  // An occupied bridge is allowed to stall the unit; no forced displacement.
  return null;
}

export function currentRegionDefinition(mission: LoadedMission): MultiRegionDefinition | undefined {
  return mission.data.multiRegion?.regions.find(region => region.id === regionAt(mission, mission.sherman.pos));
}

export function regionalSupportTurn(mission: LoadedMission, actor: Unit): 'stay' | 'cw' | 'ccw' | null {
  const next = regionalSupportStep(mission, actor);
  if (!next || actor.facing === null) return null;
  const desired = directionTo(actor.pos, next);
  if (desired === null) return null;
  const cw = (desired - actor.facing + 6) % 6;
  return cw === 0 ? 'stay' : cw <= 3 ? 'cw' : 'ccw';
}

export function cloneRegionalState(state: MultiRegionState | undefined): MultiRegionState | undefined {
  return state ? JSON.parse(JSON.stringify(state)) : undefined;
}
