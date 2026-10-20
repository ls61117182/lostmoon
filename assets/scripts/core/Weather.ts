import { isTankUnit, type Unit } from './types';

export type WeatherType = 'clear' | 'rain' | 'light_snow' | 'heavy_snow' | 'fog';

export interface WeatherRule {
  hitThresholdModifier: number;
  visionRangeModifier: number;
  tankVisionRangeOverride?: number;
}

const WEATHER_RULES: Record<WeatherType, WeatherRule> = {
  clear: { hitThresholdModifier: 0, visionRangeModifier: 0 },
  rain: { hitThresholdModifier: 1, visionRangeModifier: -1 },
  // Snow is currently presentation-only. Its rule values intentionally remain
  // neutral until weather gameplay is designed separately.
  light_snow: { hitThresholdModifier: 0, visionRangeModifier: 0 },
  heavy_snow: { hitThresholdModifier: 0, visionRangeModifier: 0 },
  fog: { hitThresholdModifier: 0, visionRangeModifier: 0, tankVisionRangeOverride: 2 },
};

export function normalizeWeather(value: unknown): WeatherType {
  return value === 'rain' || value === 'light_snow' || value === 'heavy_snow' || value === 'fog' ? value : 'clear';
}

export function weatherRule(weather: WeatherType | undefined | null): WeatherRule {
  return WEATHER_RULES[normalizeWeather(weather)];
}

export function weatherHitThresholdModifier(weather: WeatherType | undefined | null): number {
  return weatherRule(weather).hitThresholdModifier;
}

export function weatherVisionRange(
  unit: Unit,
  baseRange: number,
  weather: WeatherType | undefined | null,
  sight: 'commander' | 'gunner' = 'commander',
): number {
  const normalizedBase = Math.max(0, Math.floor(baseRange));
  const rule = weatherRule(weather);
  const commanderAlive = unit.crew?.commander !== false;
  const openHatch = commanderAlive && unit.hatchOpen === true;
  if (rule.tankVisionRangeOverride !== undefined && isTankUnit(unit) && (sight === 'gunner' || openHatch)) {
    return rule.tankVisionRangeOverride;
  }
  // Rain retains its existing commander-only range modifier.
  const modifier = sight === 'gunner' ? 0 : rule.visionRangeModifier;
  if (modifier === 0) return normalizedBase;
  const minRange = openHatch ? 0 : 1;
  return Math.max(minRange, normalizedBase + modifier);
}
