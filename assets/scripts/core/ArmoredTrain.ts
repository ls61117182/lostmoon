import type { LoadedMission } from './MissionLoader';
import { directionTo, HexMap, hexDistance, neighbor, offsetToAxial } from './HexGrid';
import { getUnitStats } from './UnitDB';
import { unitOccupiedHexes } from './UnitFootprint';
import { ArmoredTrainDefinition, Axial, BattleSideId, Direction, isFootUnit, isTrainUnit, trainBodyBlocks, TrainModuleKind, Unit } from './types';

export interface TrainRuntime {
  id: string;
  routeId: string;
  headIndex: number;
  active: boolean;
  separated: boolean;
  destroyed: boolean;
  carriages: Unit[];
  lastActionTurn?: number;
}
export interface TrainActionState {
  side: BattleSideId;
  turn: number;
  stage: 'move' | 'ambush' | 'attack' | 'done';
  movementOnly: boolean;
  budgets: Array<{ id: string; allowance: number; moved: number; blocked: boolean }>;
  movedIds: string[];
  attackIds: string[];
  attackIndex: number;
}
export interface TrainMovement {
  unit: Unit;
  from: Axial;
  to: Axial;
  fromFacing: Direction | null;
  toFacing: Direction;
}
const modules: Record<string, TrainModuleKind> = {
  train_locomotive: 'locomotive', train_tender: 'tender', train_command: 'command',
  train_howitzer: 'howitzer', train_artillery_flak: 'artillery_flak', train_panzerjaeger: 'panzerjaeger',
};
const key = HexMap.keyOf;
export const trainHasGroundGun = (u: Unit): boolean => isTrainUnit(u)
  && ['howitzer', 'artillery_flak', 'panzerjaeger'].includes(u.trainCar?.module ?? '');
export const trainCarOnMap = (u: Unit): boolean => !isTrainUnit(u) || u.trainCar?.presence === 'present';
export function trainSpeed(train: TrainRuntime): number {
  if (!train.active || train.separated || train.carriages.every(c => c.trainCar.presence === 'exited')
    || !train.carriages.some(c => c.trainCar.module === 'locomotive' && !c.destroyed)) return 0;
  return train.carriages.some(c => c.trainCar.module === 'tender' && !c.destroyed) ? 2 : 1;
}
function definition(m: LoadedMission, t: TrainRuntime): ArmoredTrainDefinition {
  return m.data.trains.find(d => d.id === t.id)!;
}
function route(m: LoadedMission, t: TrainRuntime) {
  return m.data.trainRoutes.find(r => r.id === t.routeId)!;
}
export function trainRoutePosition(m: LoadedMission, t: TrainRuntime, index: number): Axial {
  const r = route(m, t), parity = m.data.rowParityOffset ?? 0;
  if (r.loop) return offsetToAxial(r.cells[((index % r.cells.length) + r.cells.length) % r.cells.length], parity);
  if (index < 0) {
    let p = offsetToAxial(r.cells[0], parity);
    for (let i = 0; i < -index; i++) p = neighbor(p, r.entryDir!);
    return p;
  }
  let p = offsetToAxial(r.cells[Math.min(index, r.cells.length - 1)], parity);
  for (let i = r.cells.length - 1; i < index; i++) p = neighbor(p, r.exitDir!);
  return p;
}
function placeCar(m: LoadedMission, t: TrainRuntime, car: Unit, index: number): void {
  const r = route(m, t), p = trainRoutePosition(m, t, index);
  car.pos = p;
  car.facing = directionTo(p, trainRoutePosition(m, t, index + 1)) ?? car.facing ?? 0;
  car.trainCar.presence = !t.active ? 'pending' : r.loop || index >= 0 && index < r.cells.length ? 'present' : index < 0 ? 'outside' : 'exited';
}

/** Fail at the authoring boundary, before spawning any formation. */
export function validateArmoredTrains(m: LoadedMission): void {
  const routes = m.data.trainRoutes ?? [], trains = m.data.trains ?? [];
  if (!Array.isArray(routes) || !Array.isArray(trains)) throw new Error('trainRoutes/trains must be arrays');
  const ids = new Set<string>(), routesById = new Map<string, typeof routes[number]>();
  const parity = m.data.rowParityOffset ?? 0;
  for (const r of routes) {
    if (!r.id || routesById.has(r.id) || !Array.isArray(r.cells) || r.cells.length < 2) throw new Error('Invalid/duplicate train route');
    routesById.set(r.id, r);
    const positions = r.cells.map(c => {
      if (!Number.isInteger(c?.col) || !Number.isInteger(c?.row)) throw new Error(`Invalid train route coordinate: ${r.id}`);
      return offsetToAxial(c, parity);
    });
    if (new Set(positions.map(key)).size !== positions.length) throw new Error(`Repeated train route cell: ${r.id}`);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i], tile = m.map.get(p);
      if (!tile?.railway) throw new Error(`Train route ${r.id} requires railway at ${key(p)}`);
      if (i + 1 < positions.length || r.loop) {
        const next = positions[(i + 1) % positions.length], d = directionTo(p, next);
        if (d === null || hexDistance(p, next) !== 1 || tile.railway[d] !== '1'
          || m.map.get(next)?.railway[(d + 3) % 6] !== '1') throw new Error(`Disconnected train route: ${r.id}`);
      }
    }
    if (!r.loop) for (const [index, d] of [[0, r.entryDir], [positions.length - 1, r.exitDir]] as const) {
      if (!Number.isInteger(d) || d < 0 || d > 5 || m.map.has(neighbor(positions[index], d))
        || m.map.get(positions[index]).railway[d] !== '1') throw new Error(`Train route ${r.id} requires an outside entry/exit port`);
    }
  }
  for (const t of trains) {
    if (!t.id || ids.has(t.id) || !routesById.has(t.routeId) || !['player', 'enemy'].includes(t.sideId)
      || !Array.isArray(t.carriages) || !t.carriages.length) throw new Error('Invalid train definition');
    ids.add(t.id);
    if (t.entryTurn !== undefined && (!Number.isInteger(t.entryTurn) || t.entryTurn < 1 || routesById.get(t.routeId).loop)) throw new Error(`Invalid train entryTurn: ${t.id}`);
    if (t.headIndex !== undefined && !Number.isInteger(t.headIndex)) throw new Error(`Invalid train headIndex: ${t.id}`);
    if (!t.carriages.some(c => c.kind === 'train_locomotive')) throw new Error(`Train ${t.id} needs at least one locomotive`);
    for (const c of t.carriages) {
      if (!c.id || ids.has(c.id) || !modules[c.kind] || c.turretFacing !== undefined
        && (!Number.isInteger(c.turretFacing) || c.turretFacing < 0 || c.turretFacing > 11)) throw new Error(`Invalid/duplicate train carriage: ${c.id}`);
      ids.add(c.id);
    }
  }
  const usedRoutes = routes.filter(r => trains.some(t => t.routeId === r.id)), usedEdges = new Set<string>();
  for (const r of usedRoutes) {
    const cells = r.cells.map(p => offsetToAxial(p, parity));
    for (let i = 0; i < cells.length - (r.loop ? 0 : 1); i++) {
      const a = key(cells[i]), b = key(cells[(i + 1) % cells.length]);
      if (usedEdges.has(`${b}>${a}`)) throw new Error('Opposing train routes are not supported');
      usedEdges.add(`${a}>${b}`);
    }
  }
  const loopKey = (r: typeof routes[number]) => r.cells.map(p => key(offsetToAxial(p, parity))).sort().join('|');
  for (const r of routes.filter(r => r.loop)) {
    const shared = new Set(routes.filter(other => other.loop && loopKey(other) === loopKey(r)).map(other => other.id));
    const users = trains.filter(t => shared.has(t.routeId));
    if (r.cells.length < users.reduce((n, t) => n + t.carriages.length + 2, 0)) throw new Error(`Closed train route ${r.id} requires total length + 2 * train count`);
  }
  const objective = m.data.objective;
  if (objective.type === 'destroy_train' || objective.type === 'destroy_train_carriage') {
    const t = trains.find(t => t.id === objective.trainId);
    if (!t || objective.type === 'destroy_train_carriage' && !t.carriages.some(c => c.id === objective.carriageId)) throw new Error('Unknown train objective ID');
  }
}

export function initializeArmoredTrains(m: LoadedMission): void {
  validateArmoredTrains(m);
  const reserved = new Set([m.sherman, ...m.allies, ...m.enemies].map(u => u.id));
  m.trains = (m.data.trains ?? []).map(d => {
    const t: TrainRuntime = { id: d.id, routeId: d.routeId, headIndex: d.entryTurn ? -1 : d.headIndex ?? d.carriages.length - 1,
      active: d.entryTurn === undefined, separated: false, destroyed: false, carriages: [] };
    t.carriages = d.carriages.map((c, order) => {
      if (reserved.has(c.id)) throw new Error(`Duplicate unit ID: ${c.id}`);
      reserved.add(c.id);
      const stats = getUnitStats(c.kind, m.data.theater ?? 'europe');
      const unit: Unit = { id: c.id, kind: c.kind, faction: d.faction ?? stats.faction, sideId: d.sideId, controller: 'ai',
        stats, pos: { q: 0, r: 0 }, facing: 0, turretFacing: c.turretFacing ?? 0,
        unitLevel: c.unitLevel ?? 'recruit', visionRange: stats.visionRange, gunnerVisionRange: stats.gunnerVisionRange,
        trainCar: { trainId: t.id, module: modules[c.kind], order, presence: 'pending', separated: false, radio: false, antiAircraftFacing: 3 } };
      placeCar(m, t, unit, t.headIndex - order);
      if (c.turretFacing === undefined) unit.turretFacing = unit.facing;
      unit.trainCar.antiAircraftFacing = ((unit.facing + 3) % 6) as Direction;
      return unit;
    });
    return t;
  });
  const occupied = new Set<string>();
  for (const t of m.trains) for (const c of t.carriages.filter(c => c.trainCar.presence === 'present')) {
    if (occupied.has(key(c.pos)) || [m.sherman, ...m.allies, ...m.enemies].some(u => !isFootUnit(u) && unitOccupiedHexes(u).some(p => key(p) === key(c.pos)))) throw new Error(`Overlapping initial train: ${c.id}`);
    occupied.add(key(c.pos));
  }
  syncArmoredTrains(m);
}

/** Called after all damage entrances, before sight, movement or mission evaluation. */
export function syncArmoredTrains(m: LoadedMission): void {
  if (!m.trains?.length) return;
  const objective = m.data.objective;
  const friendly: Unit[] = [], enemy: Unit[] = [];
  for (const t of m.trains) {
    if (t.active && t.carriages.filter(c => c.trainCar.module === 'locomotive').every(c => c.destroyed)) {
      t.destroyed = true; t.separated = true;
    }
    const radio = t.active && !t.separated && t.carriages.some(c => c.trainCar.module === 'command' && !c.destroyed);
    for (const c of t.carriages) {
      c.trainCar.separated = t.separated; c.trainCar.radio = radio;
      if (c.trainCar.presence !== 'present') continue;
      (c.sideId === 'player' ? friendly : enemy).push(c);
    }
    if (!t.destroyed && objective.trainId === t.id && t.carriages.some(c => !c.destroyed && c.trainCar.presence === 'exited'
      && (objective.type === 'destroy_train' || objective.type === 'destroy_train_carriage' && objective.carriageId === c.id))) m.trainEscapeDefeat = true;
  }
  m.allies = [...m.allies.filter(u => !isTrainUnit(u)), ...friendly];
  m.enemies = [...m.enemies.filter(u => !isTrainUnit(u)), ...enemy];
}
export function activateTrainEntries(m: LoadedMission, turn: number): string[] {
  const ids: string[] = [];
  for (const t of m.trains ?? []) if (!t.active && definition(m, t).entryTurn === turn) {
    t.active = true;
    t.carriages.forEach(c => placeCar(m, t, c, t.headIndex - c.trainCar.order));
    ids.push(t.id);
  }
  syncArmoredTrains(m);
  return ids;
}
export function beginTrainAction(m: LoadedMission, side: BattleSideId, turn: number, entryIds?: string[]): TrainActionState {
  if (m.trainAction && m.trainAction.stage !== 'done' && m.trainAction.side === side && m.trainAction.turn === turn) return m.trainAction;
  syncArmoredTrains(m);
  const selected = (m.trains ?? []).filter(t => t.active && t.carriages[0].sideId === side
    && (entryIds ? entryIds.includes(t.id) : t.lastActionTurn !== turn));
  const state: TrainActionState = { side, turn, movementOnly: !!entryIds, stage: 'move',
    budgets: selected.map(t => ({ id: t.id, allowance: trainSpeed(t), moved: 0, blocked: false })),
    movedIds: [], attackIds: entryIds ? [] : selected.flatMap(t => t.carriages.map(c => c.id)), attackIndex: 0 };
  m.trainAction = state;
  return state;
}

/** One grid step for every eligible train. Animation consumes this common batch. */
export function advanceTrainStep(m: LoadedMission, state: TrainActionState,
  onCollision?: (victim: Unit, carriage: Unit, from: Axial, to: Axial) => void): TrainMovement[] {
  syncArmoredTrains(m);
  const moves: TrainMovement[] = [];
  const pending = state.budgets.filter(b => !b.blocked && b.moved < b.allowance
    && trainSpeed(m.trains.find(t => t.id === b.id)) > 0);
  const allUnits = () => [m.sherman, ...m.allies, ...m.enemies];
  const nextPositions = (t: TrainRuntime) => t.carriages.map(c => trainRoutePosition(m, t, t.headIndex + 1 - c.trainCar.order));
  while (pending.length) {
    // Dependencies rather than absolute route indices also work across a loop's index seam.
    let index = pending.findIndex(b => {
      const t = m.trains.find(t => t.id === b.id), positions = nextPositions(t);
      return !pending.some(other => other !== b && m.trains.find(t => t.id === other.id).carriages
        .some(c => trainBodyBlocks(c) && positions.some(p => key(p) === key(c.pos))));
    });
    if (index < 0) { pending.forEach(b => b.blocked = true); break; }
    const budget = pending.splice(index, 1)[0], t = m.trains.find(t => t.id === budget.id);
    const destinations = nextPositions(t);
    if ((m.trains ?? []).some(other => other !== t && other.carriages.some(c => trainBodyBlocks(c)
      && destinations.some(p => m.map.has(p) && key(p) === key(c.pos))))) { budget.blocked = true; continue; }
    const before = t.carriages.map(c => ({ unit: c, from: { ...c.pos }, fromFacing: c.facing }));
    t.headIndex++; budget.moved++;
    t.carriages.forEach(c => placeCar(m, t, c, t.headIndex - c.trainCar.order));
    for (const item of before) {
      const car = item.unit;
      const victims = allUnits().filter(u => !isTrainUnit(u) && !isFootUnit(u) && !u.attachedToATGunId
        && car.trainCar.presence === 'present' && unitOccupiedHexes(u).some(p => key(p) === key(car.pos)));
      for (const victim of victims) { victim.destroyed = true; onCollision?.(victim, car, item.from, car.pos); }
      moves.push({ ...item, to: { ...car.pos }, toFacing: car.facing });
    }
    // A subsequent train must use the front train's new occupancy for this step.
    syncArmoredTrains(m);
  }
  state.movedIds = moves.filter(v => v.unit.trainCar.presence === 'present' && !v.unit.destroyed).map(v => v.unit.id);
  state.stage = moves.length ? 'ambush' : 'attack';
  return moves;
}
export function finishTrainStep(m: LoadedMission, state: TrainActionState): void {
  syncArmoredTrains(m);
  state.movedIds = [];
  state.stage = state.budgets.some(b => !b.blocked && b.moved < b.allowance && trainSpeed(m.trains.find(t => t.id === b.id)) > 0) ? 'move' : 'attack';
  if (state.movementOnly && state.stage === 'attack') state.stage = 'done';
}
export function nextTrainAttacker(m: LoadedMission, state: TrainActionState): Unit | undefined {
  syncArmoredTrains(m);
  while (state.attackIndex < state.attackIds.length) {
    const id = state.attackIds[state.attackIndex++];
    const car = (m.trains ?? []).flatMap(t => t.carriages).find(c => c.id === id);
    if (car && !car.destroyed && car.trainCar.presence === 'present' && trainHasGroundGun(car)) return car;
  }
  for (const b of state.budgets) m.trains.find(t => t.id === b.id).lastActionTurn = state.turn;
  state.stage = 'done';
  return undefined;
}
export function infantryLockedByTrain(m: LoadedMission, infantry: Unit): boolean {
  return isFootUnit(infantry) && (m.trains ?? []).some(t => t.carriages.some(c => trainBodyBlocks(c) && key(c.pos) === key(infantry.pos)));
}
export function nearestTrainAmbushTarget(cars: readonly Unit[], watcher: Unit, legal: (car: Unit) => boolean,
  pick: (length: number) => number = () => 0): Unit | undefined {
  let distance = Infinity; const tied: Unit[] = [];
  for (const car of cars) if (!car.destroyed && car.trainCar?.presence === 'present' && legal(car)) {
    const d = hexDistance(watcher.pos, car.pos);
    if (d < distance) { distance = d; tied.length = 0; }
    if (d === distance) tied.push(car);
  }
  return tied.length ? tied[pick(tied.length)] : undefined;
}
