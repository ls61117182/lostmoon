import type { RoundEventConfig, WeatherType } from './types';
export const ROUND_EVENT_EFFECTS = ['none', 'sniper', 'commander_extra', 'infantry_spawn', 'adjacent_infantry_fire', 'mechanical_failure', 'stuka', 'panzer3_spawn', 'road_mine', 'panzer4_spawn', 'tiger_spawn', 'sherman_spawn', 'german_truck_move', 'clear_mine', 'type95_spawn', 'type97_spawn', 'heavy_mortar', 'airborne_support'] as const;

/** Unknown future weather is deliberately not treated as sunny. */
export function isAirborneWeather(weather: unknown): boolean {
  return weather == null || weather === 'clear';
}

export function roundEventConditionMet(event: RoundEventConfig, weather: WeatherType | undefined): boolean {
  return (event.condition !== 'clear' && event.effectType !== 'airborne_support') || isAirborneWeather(weather);
}

export function roundEventsForTurn(events: readonly RoundEventConfig[] | undefined, turn: number): RoundEventConfig[] {
  return (events ?? []).filter(event => event.turns == null || event.turns === 'every' || event.turns.includes(turn));
}

export function validateRoundEvents(events: unknown): string[] {
  if (events == null) return [];
  if (!Array.isArray(events)) return ['roundEvents must be an array'];
  const errors: string[] = [];
  events.forEach((event, i) => {
    if (!event || typeof event !== 'object') { errors.push(`roundEvents[${i}] must be an object`); return; }
    if (!ROUND_EVENT_EFFECTS.includes(event.effectType)) errors.push(`roundEvents[${i}].effectType is invalid`);
    if (event.turns != null && event.turns !== 'every'
      && (!Array.isArray(event.turns) || !event.turns.length
        || event.turns.some((turn: unknown) => !Number.isInteger(turn) || Number(turn) < 1)
        || new Set(event.turns).size !== event.turns.length)) errors.push(`roundEvents[${i}].turns must contain unique positive round numbers`);
    if (event.reinforcementSide != null && !['friendly', 'enemy'].includes(event.reinforcementSide)) errors.push(`roundEvents[${i}].reinforcementSide is invalid`);
    if ((event.effectType === 'airborne_support' || (typeof event.effectType === 'string' && event.effectType.endsWith('_spawn'))) && !event.reinforcementSide) errors.push(`roundEvents[${i}] reinforcement effect requires reinforcementSide`);
    if (event.condition != null && event.condition !== 'clear') errors.push(`roundEvents[${i}].condition is invalid`);
  });
  return errors;
}
