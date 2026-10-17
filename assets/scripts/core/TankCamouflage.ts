import { getUnitStats } from './UnitDB';
import { isTankKind } from './types';
import type { GermanTankCamouflage, MissionData, Unit } from './types';
import { TANK_VISUAL_KINDS, tankVisualAssetConfigOf } from './TankVisualDB';
import type { TankVisualAssetConfig, TankVisualKind } from './TankVisualDB';

/** Derive coverage from the existing unit and visual registries, rather than a second tank whitelist. */
export const GERMAN_LATE_WAR_VISUAL_KINDS: readonly TankVisualKind[] = TANK_VISUAL_KINDS.filter(
  kind => isTankKind(kind) && getUnitStats(kind).faction === 'german',
);

export function normalizeGermanTankCamouflage(value: unknown): GermanTankCamouflage {
  if (value === undefined || value === 'grey') return 'grey';
  if (value === 'late_war') return 'late_war';
  throw new Error(`germanTankCamouflage must be "grey" or "late_war", got ${JSON.stringify(value)}`);
}

export function usesGermanLateWarCamouflage(
  mission: Pick<MissionData, 'germanTankCamouflage'> | undefined,
  unit: Pick<Unit, 'kind' | 'faction'>,
): boolean {
  return mission?.germanTankCamouflage === 'late_war'
    && unit.faction === 'german'
    && (GERMAN_LATE_WAR_VISUAL_KINDS as readonly string[]).includes(unit.kind);
}

/** Identical geometry and filenames, with a separate resource directory for the new paint. */
export function lateWarTankVisualAssetConfigOf(kind: TankVisualKind): TankVisualAssetConfig {
  const base = tankVisualAssetConfigOf(kind);
  if (!GERMAN_LATE_WAR_VISUAL_KINDS.includes(kind)) return base;
  const variant = (resource: string) => resource.replace('textures/units/', 'textures/units/late_war/');
  return {
    topSpritePath: variant(base.topSpritePath),
    hullSpritePath: variant(base.hullSpritePath),
    turretSpritePath: variant(base.turretSpritePath),
    destroyedSpritePath: variant(base.destroyedSpritePath),
  };
}
