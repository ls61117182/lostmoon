import type { HexMap } from './HexGrid';
import type { Axial, Unit } from './types';
import { planUnitMove, type UnitMovePlan } from './UnitFootprint';

export interface TwoHexRouteStep {
  action: 'advance' | 'reverse' | 'cw' | 'ccw';
  from: Unit;
  plan: UnitMovePlan;
}

/** Search position AND facing: a turn displaces the hull and cannot be planned as an in-place rotation. */
export function findTwoHexRoute(
  map: HexMap, unit: Unit, goal: (state: Unit) => boolean,
  blocked: (hex: Axial) => boolean = () => false,
): TwoHexRouteStep[] | null {
  const key = (u: Unit) => `${u.pos.q},${u.pos.r},${u.facing}`;
  const queue: Unit[] = [unit];
  const previous = new Map<string, { parent: string; step: TwoHexRouteStep } | null>([[key(unit), null]]);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    if (goal(from)) {
      const route: TwoHexRouteStep[] = [];
      let cursor = previous.get(key(from));
      while (cursor) { route.unshift(cursor.step); cursor = previous.get(cursor.parent); }
      return route;
    }
    for (const action of ['advance', 'reverse', 'cw', 'ccw'] as const) {
      const plan = planUnitMove(from, action);
      const next = { ...from, pos: plan.pos, facing: plan.facing };
      if (previous.has(key(next)) || blocked(plan.entryTo)
        || !map.canUnitCrossEdge(plan.entryFrom, plan.entryTo, from)) continue;
      previous.set(key(next), { parent: key(from), step: { action, from, plan } });
      queue.push(next);
    }
  }
  return null;
}
