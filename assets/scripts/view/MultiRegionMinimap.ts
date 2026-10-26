import { axialToPixel, HEX_DIRECTIONS, HexMap } from '../core/HexGrid';
import type { LoadedMission } from '../core/MissionLoader';
import { europeanTerrainLook, seasonalTerrainRGB } from '../core/TerrainSeason';
import { tileHasBridge, tileHasBuilding } from '../core/types';
import type { MultiRegionIntel, Tile } from '../core/types';

type Point = { x: number; y: number };
export const REGION_MINIMAP_SIZE = { width: 224, height: 214 };
export const REGION_MINIMAP_COLORS = {
  empty: [129, 140, 133], friendly: [113, 181, 139],
  enemy: [211, 119, 105], contested: [221, 179, 90],
} as const;

export interface MinimapCell extends Point {
  key: string;
  regionId: string;
  color: readonly number[];
  building: boolean;
  roads: Array<{ from: Point; to: Point }>;
  corners: Point[];
}
export interface MinimapRegion extends Point {
  id: string;
  state: MultiRegionIntel['state'];
  power: string;
  current: boolean;
  edges: Array<{ from: Point; to: Point }>;
}

/** Geometry is built only when the minimap is refreshed, independently of unit rendering. */
export function buildMultiRegionMinimap(mission: LoadedMission) {
  const definitions = mission.data.multiRegion?.regions ?? [];
  const ownership = new Map(definitions.flatMap(region => region.tileKeys.map(key => [key, region.id] as const)));
  const tiles = mission.map.all().filter(tile => !tile.displayOnly && ownership.has(HexMap.keyOf(tile.pos)));
  if (!tiles.length) return { radius: 0, cells: [] as MinimapCell[], regions: [] as MinimapRegion[] };
  const raw = tiles.map(tile => axialToPixel(tile.pos, 1));
  const halfWidth = Math.sqrt(3) / 2;
  const minX = Math.min(...raw.map(p => p.x)) - halfWidth;
  const maxX = Math.max(...raw.map(p => p.x)) + halfWidth;
  const minY = Math.min(...raw.map(p => p.y)) - 1;
  const maxY = Math.max(...raw.map(p => p.y)) + 1;
  const radius = Math.min(198 / (maxX - minX), 142 / (maxY - minY));
  const project = (p: Point): Point => ({ x: (p.x - (minX + maxX) / 2) * radius,
    y: 3 - (p.y - (minY + maxY) / 2) * radius });
  const look = europeanTerrainLook(mission.data);
  const cells: MinimapCell[] = tiles.map((tile, index) => {
    const center = project(raw[index]);
    const corners = Array.from({ length: 6 }, (_, i) => {
      const angle = (-30 + i * 60) * Math.PI / 180;
      return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    });
    const roads: MinimapCell['roads'] = [];
    for (let direction = 0; direction < 6; direction++) {
      const delta = HEX_DIRECTIONS[direction];
      const adjacent = mission.map.get({ q: tile.pos.q + delta.q, r: tile.pos.r + delta.r });
      if (!tile.roads?.[direction] && !(isRoad(tile) && isRoad(adjacent))) continue;
      const p = axialToPixel(delta, radius);
      roads.push({ from: center, to: { x: center.x + p.x / 2, y: center.y - p.y / 2 } });
    }
    const color = seasonalTerrainRGB(look, tile.terrain)
      ?? ({ trees: [64, 101, 69], rocky: [126, 128, 117], clear: [160, 158, 121],
        urban_ground: [151, 147, 131], urban_road: [118, 121, 113],
        urban_indestructible: [120, 115, 106], urban_destructible: [162, 125, 97] }[tile.terrain])
      ?? seasonalTerrainRGB(look, 'field')!;
    return { ...center, key: HexMap.keyOf(tile.pos), regionId: ownership.get(HexMap.keyOf(tile.pos))!,
      color, building: tileHasBuilding(tile), roads, corners };
  });
  const currentId = ownership.get(HexMap.keyOf(mission.sherman.pos));
  const regions: MinimapRegion[] = definitions.map(region => {
    const group = cells.filter(cell => cell.regionId === region.id);
    const intel = mission.multiRegionState?.intel.find(item => item.id === region.id);
    const edges: MinimapRegion['edges'] = [];
    for (const cell of group) {
      const tile = tiles.find(tile => HexMap.keyOf(tile.pos) === cell.key)!;
      for (let direction = 0; direction < 6; direction++) {
        const delta = HEX_DIRECTIONS[direction];
        if (ownership.get(HexMap.keyOf({ q: tile.pos.q + delta.q, r: tile.pos.r + delta.r })) === region.id) continue;
        // UI Y is inverted: axial direction 1 crosses geometric edge 5.
        const edge = (6 - direction) % 6;
        edges.push({ from: cell.corners[edge], to: cell.corners[(edge + 1) % 6] });
      }
    }
    return { id: region.id, state: intel?.state ?? 'empty', current: region.id === currentId,
      power: `${intel?.friendlyPower ?? 0} / ${!intel || intel.enemyPower === null ? '?' : intel.enemyPower}`,
      x: group.reduce((sum, cell) => sum + cell.x, 0) / Math.max(1, group.length),
      y: group.reduce((sum, cell) => sum + cell.y, 0) / Math.max(1, group.length), edges };
  });
  return { radius, cells, regions };
}

function isRoad(tile: Tile | undefined): boolean {
  return !!tile && (tile.terrain === 'road' || tile.terrain === 'urban_road' || tileHasBridge(tile));
}
