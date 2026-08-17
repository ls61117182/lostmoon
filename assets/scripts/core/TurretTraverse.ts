import type { Direction, FireDirection } from './types';

export interface TurretTraverseResult {
  direction: FireDirection;
  /** Number of 30-degree steps remaining before this action. */
  distance: number;
  reached: boolean;
}

/** Convert the compatibility encoding (0..5 axes, 6..11 diagonals) to clockwise 30-degree steps. */
export function fireDirectionStep(direction: FireDirection): number {
  return direction < 6 ? direction * 2 : (direction - 6) * 2 + 1;
}

/** Convert a clockwise 30-degree step to the compatibility FireDirection encoding. */
export function fireDirectionFromStep(step: number): FireDirection {
  const normalized = ((Math.trunc(step) % 12) + 12) % 12;
  return (normalized % 2 === 0 ? normalized / 2 : 6 + (normalized - 1) / 2) as FireDirection;
}

export function rotateFireDirection(direction: FireDirection, steps: number): FireDirection {
  return fireDirectionFromStep(fireDirectionStep(direction) + Math.trunc(steps));
}

/** Shortest signed turn in 30-degree steps; positive is clockwise. The 180-degree tie turns clockwise. */
export function signedTurretTurnSteps(from: FireDirection, to: FireDirection): number {
  const clockwise = (fireDirectionStep(to) - fireDirectionStep(from) + 12) % 12;
  return clockwise <= 6 ? clockwise : clockwise - 12;
}

export function turretTurnDistance(from: FireDirection, to: FireDirection): number {
  return Math.abs(signedTurretTurnSteps(from, to));
}

/** 30 degrees takes 1 second at traverse speed 1. */
export function turretTraverseAnimationDuration(
  from: FireDirection,
  to: FireDirection,
  configuredSpeed: number,
): number {
  const distance = turretTurnDistance(from, to);
  const speed = Math.min(6, Math.max(0, Math.trunc(configuredSpeed)));
  if (distance === 0 || speed === 0) return 0;
  return distance / speed;
}

/** Limit one turret action to the configured 0..6 range of 30-degree steps. */
export function limitTurretTraverse(
  from: FireDirection,
  target: FireDirection,
  configuredSpeed: number,
): TurretTraverseResult {
  const speed = Math.min(6, Math.max(0, Math.trunc(configuredSpeed)));
  const signedSteps = signedTurretTurnSteps(from, target);
  const distance = Math.abs(signedSteps);
  if (distance <= speed) return { direction: target, distance, reached: true };
  const limitedSteps = Math.sign(signedSteps) * speed;
  return {
    direction: rotateFireDirection(from, limitedSteps),
    distance,
    reached: false,
  };
}

/** A hull turn carries the turret with it, preserving the turret-to-hull relative angle. */
export function turretFacingAfterHullTurn(
  turret: FireDirection,
  hullFrom: Direction,
  hullTo: Direction,
): FireDirection {
  const clockwise = (hullTo - hullFrom + 6) % 6;
  const signedHullSteps = clockwise <= 3 ? clockwise : clockwise - 6;
  return rotateFireDirection(turret, signedHullSteps * 2);
}
