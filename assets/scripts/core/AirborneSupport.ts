import { canMGAttack, selectTankMachineGun } from './Combat';
import type { AttackContext } from './Combat';
import { RNG } from './Dice';
import { fireDirectionTo, HexMap, hexDistance, neighbor } from './HexGrid';
import type { LoadedMission } from './MissionLoader';
import { getUnitStats } from './UnitDB';
import { isAirborneWeather } from './RoundEvents';
import type { ReinforcementSide } from './TurnEndEventDB';
import { Axial, isFootUnit, isHostile, isSameSide, isTankUnit, Unit } from './types';

export interface AirbornePlan {
  target: Axial;
  units: Unit[];
  side: ReinforcementSide;
}

export function planAirborneSupport(
  mission: LoadedMission, side: ReinforcementSide, rng: RNG, nextId: () => string,
  allowedKeys?: ReadonlySet<string>,
): AirbornePlan | null {
  if (!isAirborneWeather(mission.data.weather)) {
    return { target: { ...mission.sherman.pos }, side, units: [] };
  }
  const tiles = mission.map.all().filter(tile => !tile.displayOnly && (!allowedKeys || allowedKeys.has(HexMap.keyOf(tile.pos))));
  const keys = new Set(tiles.map(tile => HexMap.keyOf(tile.pos)));
  const interior = tiles.filter(tile => [0, 1, 2, 3, 4, 5].every(dir => keys.has(HexMap.keyOf(neighbor(tile.pos, dir as 0 | 1 | 2 | 3 | 4 | 5)))));
  if (!interior.length) return null;
  const horizontal = (pos: Axial) => pos.q + pos.r / 2;
  const min = Math.min(...tiles.map(tile => horizontal(tile.pos)));
  const max = Math.max(...tiles.map(tile => horizontal(tile.pos)));
  const midpoint = (min + max) / 2;
  const favored = interior.filter(tile => side === 'friendly' ? horizontal(tile.pos) >= midpoint : horizontal(tile.pos) <= midpoint);
  const target = { ...rng.pick(favored.length ? favored : interior).pos };
  const probe: Unit = { id: '', kind: 'american_infantry', faction: 'usa', sideId: side === 'friendly' ? 'player' : 'enemy', controller: 'ai', pos: target, facing: side === 'friendly' ? 0 : 3, stats: getUnitStats('american_infantry', mission.data.theater ?? 'europe') };
  const occupants = [mission.sherman, ...mission.allies, ...mission.enemies].filter(unit => !unit.destroyed);
  const legal = tiles.filter(tile => tile.terrain !== 'water' && tile.terrain !== 'deep_water'
    && mission.map.canUnitEnter(tile.pos, 'usa')
    && occupants.filter(unit => hexDistance(unit.pos, tile.pos) === 0).every(unit => isTankUnit(unit) && unit.faction !== 'neutral' && isSameSide(unit, probe)));
  if (!legal.length) return null;
  const landing: Axial[] = [];
  const maxDistance = Math.max(...legal.map(tile => hexDistance(target, tile.pos)));
  for (let radius = 1; radius <= Math.max(1, maxDistance) && landing.length < 3; radius++) {
    const ring = legal.filter(tile => radius === 1 ? hexDistance(target, tile.pos) <= 1 : hexDistance(target, tile.pos) === radius);
    while (ring.length && landing.length < 3) {
      const index = rng.intRange(0, ring.length - 1);
      landing.push({ ...ring.splice(index, 1)[0].pos });
    }
  }
  return { target, side, units: landing.map(pos => ({ ...probe, id: nextId(), pos, stats: { ...probe.stats } })) };
}

export function landAirborneUnit(mission: LoadedMission, plan: AirbornePlan, unit: Unit): void {
  const list = plan.side === 'friendly' ? mission.allies : mission.enemies;
  if (!list.some(candidate => candidate.id === unit.id)) list.push(unit);
}

/** Current orientation only, one weapon and no action/ammunition consumption. */
export function airborneReactionContext(
  mission: LoadedMission, attacker: Unit, target: Unit, reacted: ReadonlySet<string>, expandedDirections = false,
): AttackContext | null {
  if (attacker.destroyed || target.destroyed || reacted.has(attacker.id) || !isHostile(attacker, target)) return null;
  if (!isTankUnit(attacker) && !isFootUnit(attacker)) return null;
  if (isFootUnit(attacker) && (attacker.suppressed || attacker.kind === 'officer')) return null;
  const ctx: AttackContext = { attacker, target, map: mission.map, units: [mission.sherman, ...mission.allies, ...mission.enemies], theater: mission.data.theater, weather: mission.data.weather, smokeHexes: mission.smokeHexes, expandedTurretDirections: expandedDirections };
  if (isTankUnit(attacker)) {
    const direction = fireDirectionTo(attacker.pos, target.pos);
    if (direction == null) return null;
    const selection = selectTankMachineGun(attacker, direction, false);
    if (!selection) return null;
    // Hull MG remains available even when the generic selector suggests a
    // partial turret traverse; the reaction itself never traverses.
    ctx.hardcoreTankMachineGuns = true;
    ctx.tankMachineGun = selection.weapon === 'both' ? 'hull' : selection.weapon;
    ctx.tankMachineGunWillTraverse = false;
  }
  return canMGAttack(ctx).ok ? ctx : null;
}
