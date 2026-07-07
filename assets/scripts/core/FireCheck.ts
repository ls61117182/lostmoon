import { FIRE_CHECK_TABLE } from './FireCheckDB';
import type { FireCheckEffect, FireCheckProfile } from './FireCheckDB';
import type { GameMode } from './GameMode';
import type { Theater } from './types';

export type { FireCheckEffect, FireCheckProfile } from './FireCheckDB';

export function fireCheckProfileFor(mode: GameMode, theater: Theater): FireCheckProfile {
  if (mode === 'hardcore') return 'hardcore';
  return theater === 'pacific' ? 'classic_pacific' : 'classic_europe';
}

export function resolveFireCheckEffect(profile: FireCheckProfile, die: number): FireCheckEffect {
  const entry = FIRE_CHECK_TABLE[profile]?.[die];
  if (!entry) throw new Error(`missing fire check entry: ${profile} d${die}`);
  return entry.effect;
}

export function resolveFireCheckLowest(profile: FireCheckProfile, dice: readonly number[]): { die: number; effect: FireCheckEffect } {
  if (dice.length <= 0) throw new Error('fire check requires at least one die');
  const die = Math.min(...dice);
  return { die, effect: resolveFireCheckEffect(profile, die) };
}
