import type { Unit } from './types';

export type WeatherType = 'clear' | 'rain';

export interface WeatherRule {
  hitThresholdModifier: number;
  visionRangeModifier: number;
}

const WEATHER_RULES: Record<WeatherType, WeatherRule> = {
  clear: { hitThresholdModifier: 0, visionRangeModifier: 0 },
  rain: { hitThresholdModifier: 1, visionRangeModifier: -1 },
};

export function normalizeWeather(value: unknown): WeatherType {
  return value === 'rain' ? 'rain' : 'clear';
}

export function weatherRule(weather: WeatherType | undefined | null): WeatherRule {
  return WEATHER_RULES[normalizeWeather(weather)];
}

export function weatherHitThresholdModifier(weather: WeatherType | undefined | null): number {
  return weatherRule(weather).hitThresholdModifier;
}

export function weatherVisionRange(unit: Unit, baseRange: number, weather: WeatherType | undefined | null): number {
  const normalizedBase = Math.max(0, Math.floor(baseRange));
  const modifier = weatherRule(weather).visionRangeModifier;
  if (modifier === 0) return normalizedBase;

  const commanderAlive = unit.crew?.commander !== false;
  const openHatch = commanderAlive && unit.hatchOpen === true;
  const minRange = openHatch ? 0 : 1;
  return Math.max(minRange, normalizedBase + modifier);
}
