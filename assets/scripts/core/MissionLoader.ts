/**
 * 任务加载器：把 JSON 任务数据 → 内存中的 HexMap + 单位列表。
 *
 * 用法：
 *   const data = JSON.parse(jsonText) as MissionData;
 *   const { map, units } = loadMission(data);
 */

import { HexMap, offsetToAxial } from './HexGrid';
import {
  Direction,
  MissionData,
  Tile,
  TileDef,
  Unit,
  UnitKind,
  UnitPlacement,
} from './types';
import { getUnitStats } from './UnitDB';

/** TileDef 简写 → TerrainType */
const TERRAIN_MAP = {
  r: 'road',
  f: 'field',
  m: 'mud',
  F: 'forest',
  b: 'building',
  w: 'water',
} as const;

export interface LoadedMission {
  map: HexMap;
  sherman: Unit;
  enemies: Unit[];
  data: MissionData;
}

export function loadMission(data: MissionData): LoadedMission {
  // 1. 构建 HexMap
  const map = new HexMap(data.cols, data.rows);
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const def: TileDef | undefined = data.tiles[row]?.[col];
      if (!def) continue;
      const tile: Tile = {
        pos: offsetToAxial({ col, row }),
        terrain: TERRAIN_MAP[def.t],
        hedges: parseHedges(def.h),
        reinforceId: def.rid,
        enemyStartId: def.eid,
      };
      map.set(tile);
    }
  }

  // 2. 构建谢尔曼
  const sherman = makeUnit('sherman_player', data.sherman);

  // 3. 构建德军单位
  const enemies = data.enemies.map((p, i) => makeUnit(`enemy_${i}`, p));

  return { map, sherman, enemies, data };
}

/** "010100" → [false, true, false, true, false, false] */
function parseHedges(s?: string): Tile['hedges'] {
  if (!s || s.length !== 6) return undefined;
  return [
    s[0] === '1', s[1] === '1', s[2] === '1',
    s[3] === '1', s[4] === '1', s[5] === '1',
  ] as Tile['hedges'];
}

function makeUnit(id: string, p: UnitPlacement): Unit {
  const stats = getUnitStats(p.kind);
  const u: Unit = {
    id,
    kind: p.kind,
    faction: p.faction,
    pos: offsetToAxial(p.at),
    facing: p.facing ?? null,
    stats,
  };
  if (p.kind === 'sherman') {
    u.crew = {
      commander: true,
      loader: true,
      gunner: true,
      driver: true,
      coDriver: true,
    };
    u.fireLevel = 0;
    u.loaded = false;     // 说明书：谢尔曼游戏开始时未装填
    u.hatchOpen = false;  // 起始关闭舱盖
  }
  return u;
}
