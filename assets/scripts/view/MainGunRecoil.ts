import type { UnitKind } from '../core/types';

export type MainGunRecoilMode = 'turret' | 'whole';

export const MAIN_GUN_RECOIL_BACK_TIME = 0.07;
export const MAIN_GUN_RECOIL_RETURN_TIME = 0.16;
export const MAIN_GUN_RECOIL_DISTANCE_RATIO = 0.06;

const MAIN_GUN_RECOIL_TOTAL_TIME = MAIN_GUN_RECOIL_BACK_TIME + MAIN_GUN_RECOIL_RETURN_TIME;

export function mainGunRecoilMode(
  kind: UnitKind,
  isFoot: boolean,
  hasSplitTurret: boolean,
  hasTopSprite: boolean,
): MainGunRecoilMode | null {
  if (isFoot || kind === 'heavy_artillery') return null;
  if (hasSplitTurret) return 'turret';
  return hasTopSprite ? 'whole' : null;
}

export function mainGunRecoilProgress(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= MAIN_GUN_RECOIL_TOTAL_TIME) return 0;
  if (elapsed <= MAIN_GUN_RECOIL_BACK_TIME) {
    const t = elapsed / MAIN_GUN_RECOIL_BACK_TIME;
    return 1 - Math.pow(1 - t, 3);
  }
  const t = (elapsed - MAIN_GUN_RECOIL_BACK_TIME) / MAIN_GUN_RECOIL_RETURN_TIME;
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

export function mainGunRecoilOffset(
  elapsed: number,
  hexSize: number,
  ux: number,
  uy: number,
): { x: number; y: number } {
  const distance = Math.max(0, hexSize) * MAIN_GUN_RECOIL_DISTANCE_RATIO * mainGunRecoilProgress(elapsed);
  if (distance === 0) return { x: 0, y: 0 };
  return {
    x: Math.round(-ux * distance * 1e9) / 1e9,
    y: Math.round(-uy * distance * 1e9) / 1e9,
  };
}
