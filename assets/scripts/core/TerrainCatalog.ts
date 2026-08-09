import type { Theater, TileDef } from './types';

/**
 * 地形资源所属的战场分类。后续新增北非、苏联地形时，只需向对应分组追加代码，
 * 不需要再改关卡编辑器的布局和筛选逻辑。
 */
export type TerrainCategory = Theater;
export type ActiveTerrainCategory = TerrainCategory;

export interface TerrainCategoryDefinition {
  id: TerrainCategory;
  /** 当前已有可供编辑器使用的地形资源。 */
  available: boolean;
  label: Readonly<{ zh: string; en: string }>;
  terrainCodes: readonly TileDef['t'][];
}

export const TERRAIN_CATEGORIES: readonly TerrainCategoryDefinition[] = [
  {
    id: 'europe',
    available: true,
    label: { zh: '欧洲战场', en: 'European' },
    terrainCodes: ['f', 'r', 'm', 'F', 'w'],
  },
  {
    id: 'pacific',
    available: true,
    label: { zh: '太平洋战场', en: 'Pacific' },
    terrainCodes: ['c', 'a', 'T', 'B', 'H', 'dw'],
  },
  {
    id: 'north_africa',
    available: false,
    label: { zh: '北非战场', en: 'North Africa' },
    terrainCodes: [],
  },
  {
    id: 'soviet',
    available: false,
    label: { zh: '苏联战场', en: 'Soviet' },
    terrainCodes: [],
  },
] as const;

export const ACTIVE_TERRAIN_CATEGORIES = TERRAIN_CATEGORIES.filter(
  (category): category is TerrainCategoryDefinition & { id: ActiveTerrainCategory; available: true } =>
    category.available,
);

export function terrainCategoryForCode(code: TileDef['t']): TerrainCategory | undefined {
  return TERRAIN_CATEGORIES.find(category => category.terrainCodes.includes(code))?.id;
}

export function activeTerrainCategoryForTheater(theater: Theater | undefined): ActiveTerrainCategory {
  return TERRAIN_CATEGORIES.some(category => category.id === theater) ? theater! : 'europe';
}
