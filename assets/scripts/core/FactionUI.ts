import type { Faction } from './types';
import type { PvpFactionId } from './PvpConfig';

export type FactionUiId = 'usa' | 'britain' | 'soviet' | 'german' | 'japan';

export interface FactionUiConfig {
  id: FactionUiId;
  iconPath: string;
  accent: { r: number; g: number; b: number };
  nameKey: string;
}

const FACTION_UI: Record<FactionUiId, FactionUiConfig> = {
  usa: { id: 'usa', iconPath: 'textures/ui/factions/usa/spriteFrame', accent: { r: 220, g: 203, b: 126 }, nameKey: 'faction.usa' },
  britain: { id: 'britain', iconPath: 'textures/ui/factions/britain/spriteFrame', accent: { r: 222, g: 168, b: 75 }, nameKey: 'faction.britain' },
  soviet: { id: 'soviet', iconPath: 'textures/ui/factions/soviet/spriteFrame', accent: { r: 222, g: 86, b: 67 }, nameKey: 'faction.soviet' },
  german: { id: 'german', iconPath: 'textures/ui/factions/germany/spriteFrame', accent: { r: 225, g: 225, b: 207 }, nameKey: 'faction.german' },
  japan: { id: 'japan', iconPath: 'textures/ui/factions/japan/spriteFrame', accent: { r: 217, g: 84, b: 68 }, nameKey: 'faction.japan' },
};

export function factionUiFor(faction: FactionUiId | Faction | PvpFactionId): FactionUiConfig {
  const id = faction === 'ussr' ? 'soviet' : faction === 'japanese' ? 'japan' : faction;
  return FACTION_UI[id as FactionUiId] ?? FACTION_UI.usa;
}

export function allFactionUiConfigs(): FactionUiConfig[] {
  return Object.values(FACTION_UI);
}
