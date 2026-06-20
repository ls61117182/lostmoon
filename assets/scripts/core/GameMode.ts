export type GameMode = 'classic' | 'hardcore';

export interface GameModeConfig {
  fogOfWar: boolean;
  /** A tank whose shoot action has no legal gun target may try an MG infantry target. */
  aiMainGunFallbackToMG: boolean;
  /** Reserved profile ids for mode-specific rule data added later. */
  crewBonusProfile: 'standard';
  enemyActionTableProfile: 'standard';
}

export const DEFAULT_GAME_MODE: GameMode = 'classic';

const GAME_MODE_CONFIGS: Record<GameMode, GameModeConfig> = {
  classic: {
    fogOfWar: false,
    aiMainGunFallbackToMG: false,
    crewBonusProfile: 'standard',
    enemyActionTableProfile: 'standard',
  },
  hardcore: {
    fogOfWar: true,
    aiMainGunFallbackToMG: true,
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
