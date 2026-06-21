export type GameMode = 'classic' | 'hardcore';

export interface GameModeConfig {
  fogOfWar: boolean;
  /** A tank whose shoot action has no legal gun target may try an MG infantry target. */
  aiMainGunFallbackToMG: boolean;
  /** Enables the two-matching-dice precision main-gun action for players and AI tanks. */
  precisionFire: boolean;
  /** Movement/attack commander die bonus only requires a living commander, not an open hatch. */
  commanderBonusWithoutOpenHatch: boolean;
  /** Enables closing an open hatch with two matching misc dice. */
  miscCloseHatchWithDoubles: boolean;
  /** Applies distance-based penetration decay beyond each unit's effective range. */
  effectiveRangePenetration: boolean;
  /** Reserved profile ids for mode-specific rule data added later. */
  crewBonusProfile: 'standard';
  enemyActionTableProfile: 'standard';
}

export const DEFAULT_GAME_MODE: GameMode = 'classic';

const GAME_MODE_CONFIGS: Record<GameMode, GameModeConfig> = {
  classic: {
    fogOfWar: false,
    aiMainGunFallbackToMG: false,
    precisionFire: false,
    commanderBonusWithoutOpenHatch: false,
    miscCloseHatchWithDoubles: false,
    effectiveRangePenetration: false,
    crewBonusProfile: 'standard',
    enemyActionTableProfile: 'standard',
  },
  hardcore: {
    fogOfWar: true,
    aiMainGunFallbackToMG: true,
    precisionFire: true,
    commanderBonusWithoutOpenHatch: true,
    miscCloseHatchWithDoubles: true,
    effectiveRangePenetration: true,
    crewBonusProfile: 'standard',
    enemyActionTableProfile: 'standard',
  },
};

export function isGameMode(value: unknown): value is GameMode {
  return value === 'classic' || value === 'hardcore';
}

export function getGameModeConfig(mode: GameMode): GameModeConfig {
  return GAME_MODE_CONFIGS[mode];
}
