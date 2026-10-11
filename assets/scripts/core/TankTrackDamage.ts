import type { Unit } from './types';

/** Cosmetic randomness is separate from the dice RNG and sampled once per damage. */
function newTrackDamage(incomingAngle?: number, random = Math.random): NonNullable<Unit['trackDamage']> {
  const position = 1 / 3 + random() / 3;
  const hasSide = Number.isFinite(incomingAngle) && Math.abs(incomingAngle) > 0.01
    && Math.abs(incomingAngle) < 179.99;
  return {
    position,
    side: hasSide ? (incomingAngle! > 0 ? 'right' : 'left') : (random() < 0.5 ? 'left' : 'right'),
  };
}

/** Lateral hits damage the facing side. Frontal/rear hits may damage either track. */
export function immobilizeTank(unit: Unit, incomingAngle?: number, random = Math.random): void {
  if (!unit.paralyzed) unit.trackDamage = newTrackDamage(incomingAngle, random);
  unit.paralyzed = true;
}

/** Older saves, mission-start damage and mechanical failure have no hit direction. */
export function ensureTankTrackDamage(unit: Unit): NonNullable<Unit['trackDamage']> {
  const visual = unit.trackDamage;
  if (!visual || (visual.side !== 'left' && visual.side !== 'right')
      || !Number.isFinite(visual.position) || visual.position < 1 / 3 || visual.position > 2 / 3) {
    unit.trackDamage = newTrackDamage();
  }
  return unit.trackDamage!;
}
