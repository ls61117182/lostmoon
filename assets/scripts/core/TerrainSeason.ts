import type { MissionData, SeasonType, SnowCover } from './types';

export type EuropeanTerrainLook = 'spring' | 'summer' | 'autumn' | 'winter_bare' | 'winter_snow';
export const EXTRA_EUROPEAN_LOOKS = ['spring', 'autumn', 'winter_bare'] as const;
type SeasonSource = Partial<Pick<MissionData, 'theater' | 'season' | 'snowCover'>>;

export function normalizeSeason(value: unknown): SeasonType {
  return value === 'spring' || value === 'autumn' || value === 'winter' ? value : 'summer';
}

/** Only explicit none opts a legacy winter map out of its existing snow. */
export function normalizeSnowCover(season: unknown, value: unknown): SnowCover {
  return normalizeSeason(season) === 'winter' && value !== 'none' ? 'snow' : 'none';
}

export function europeanTerrainLook(data?: SeasonSource | null): EuropeanTerrainLook {
  if (data?.theater && data.theater !== 'europe') return 'summer';
  const season = normalizeSeason(data?.season);
  return season === 'winter'
    ? normalizeSnowCover(season, data?.snowCover) === 'snow' ? 'winter_snow' : 'winter_bare'
    : season;
}

export function usesSnowTerrain(data?: SeasonSource | null): boolean {
  return europeanTerrainLook(data) === 'winter_snow';
}

/** The two original packs retain their resource names and UUIDs. */
export function europeanRoadSeason(look: EuropeanTerrainLook): string {
  return look === 'winter_snow' ? 'winter' : look;
}

export function seasonalTerrainPath(look: EuropeanTerrainLook, terrain: string): string | null {
  if (look === 'summer' || look === 'winter_snow') return null;
  if (!['field', 'road', 'mud', 'forest', 'water', 'deep_water', 'europe_beach', 'beach'].includes(terrain)) return null;
  return `textures/terrain/seasons/${look}/terrain_${terrain}/spriteFrame`;
}

type RGB = readonly [number, number, number];
const palettes: Record<EuropeanTerrainLook, readonly RGB[]> = {
  spring: [[154,167,110],[150,151,137],[96,80,68],[84,108,58],[81,139,149],[48,94,112],[173,167,143]],
  summer: [[177,173,112],[160,153,134],[120,96,68],[82,104,49],[74,145,159],[43,91,116],[194,181,151]],
  autumn: [[161,140,94],[143,141,129],[92,73,59],[128,99,49],[91,127,144],[50,80,102],[160,151,129]],
  winter_bare: [[140,135,116],[123,128,127],[81,74,65],[94,89,72],[86,116,137],[48,72,94],[142,139,124]],
  winter_snow: [[215,217,212],[175,181,179],[122,114,103],[157,165,158],[75,111,133],[42,70,94],[203,204,195]],
};
const terrainSlots: Record<string, number> = {field:0,road:1,mud:2,forest:3,water:4,deep_water:5,europe_beach:6,beach:4};
const codeTerrain: Record<string, string> = {f:'field',r:'road',m:'mud',F:'forest',w:'water',dw:'deep_water',eb:'europe_beach',esw:'beach'};

/** Shared subdued fallback/thumbnail colors; unit and terrain rules are untouched. */
export function seasonalTerrainRGB(look: EuropeanTerrainLook, terrainOrCode: string): RGB | undefined {
  const slot = terrainSlots[codeTerrain[terrainOrCode] ?? terrainOrCode];
  return slot === undefined ? undefined : palettes[look][slot];
}

export function seasonalFoliageRGB(look: EuropeanTerrainLook): readonly RGB[] {
  switch (look) {
    case 'spring': return [[49,66,36],[76,103,49],[111,140,68],[151,169,96]];
    case 'autumn': return [[70,57,36],[112,86,44],[151,115,54],[182,150,78]];
    case 'winter_bare': return [[58,53,44],[77,70,56],[101,91,70],[125,113,88]];
    case 'winter_snow': return [[61,43,31],[91,65,45],[126,94,64],[160,125,86]];
    default: return [[34,59,28],[48,80,36],[69,104,43],[105,137,62]];
  }
}
