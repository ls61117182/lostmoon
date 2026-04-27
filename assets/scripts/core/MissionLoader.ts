/**
 * 任务加载器：把 JSON 任务数据 → 内存中的 HexMap + 单位列表。
 *
 * 用法：
 *   const data = JSON.parse(jsonText) as MissionData;
 *   const { map, sherman, enemies } = loadMission(data, rng);
 */

import { HexMap, offsetToAxial, axialToOffset } from './HexGrid';
import {
  Axial,
  Direction,
  MissionData,
  Offset,
  TerrainType,
  Tile,
  TileDef,
  Unit,
  UnitKind,
  UnitPlacement,
} from './types';
import { getUnitStats } from './UnitDB';
import { RNG } from './Dice';

/** TileDef 简写（不含已废弃的整格 b）→ TerrainType */
const TERRAIN_MAP = {
  r: 'road',
  f: 'field',
  m: 'mud',
  F: 'forest',
  w: 'water',
} as const;

export interface LoadedMission {
  map: HexMap;
  sherman: Unit;
  enemies: Unit[];
  data: MissionData;
  /** destroy_kind_evac：谢尔曼已成功执行离场移动（驶出地图） */
  shermanEvacuated?: boolean;
}

export function loadMission(data: MissionData, rng?: RNG): LoadedMission {
  // 1. 构建 HexMap
  const map = new HexMap(data.cols, data.rows);
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const def: TileDef | undefined = data.tiles[row]?.[col];
      if (!def) continue;
      const { terrain, hasBuilding } = parseTileDefBase(def);
      const eid = def.eid;
      const efRaw = def.ef;
      const facing: Direction | undefined = efRaw !== undefined && efRaw !== null
        ? ((((Number(efRaw) % 6) + 6) % 6) as Direction)
        : undefined;
      const tile: Tile = {
        pos: offsetToAxial({ col, row }),
        terrain,
        ...(hasBuilding ? { hasBuilding: true } : {}),
        hedges: parseHedges(def.h),
        reinforceId: def.rid,
        ...(eid !== undefined && eid !== null ? { enemyStartId: eid } : {}),
        ...(facing !== undefined ? { enemyStartFacing: facing } : {}),
      };
      map.set(tile);
    }
  }

  // 2. 谢尔曼（必须先有坐标，掷骰敌方时需避开谢尔曼格）
  if (!data.sherman.at) {
    throw new Error(`任务 ${data.id}：sherman.at 必填`);
  }
  const sherman = makeUnit('sherman_player', data.sherman as UnitPlacement);

  // 3. 德军：可选掷骰出生
  // enemyStartByDice 为 true 时：有 `at` 的单位用 JSON 固定格；无 `at` 的单位在剩余黑格 eid 上各掷 1d6 链式占位（见 GDD）
  const useDice = !!data.enemyStartByDice;
  const needsDice = useDice && data.enemies.some(p => !p.at);
  const rngResolved = rng ?? (useDice && needsDice ? new RNG(0x5EEDFACE) : undefined);
  const diceList =
    useDice && needsDice && rngResolved
      ? resolveEnemyDicePlacements(data, map, sherman.pos, rngResolved)
      : null;

  let di = 0;
  const enemies = data.enemies.map((p, i) => {
    if (useDice) {
      if (p.at) {
        return makeUnit(`enemy_${i}`, p);
      }
      if (!diceList || di >= diceList.length) {
        throw new Error(`任务 ${data.id}： enemyStartByDice 时缺少第 ${i} 个单位的掷骰格`);
      }
      const slot = diceList[di++]!;
      const merged: UnitPlacement = {
        kind: p.kind,
        faction: p.faction,
        at: slot.at,
        facing: slot.facing,
      };
      return makeUnit(`enemy_${i}`, merged);
    }
    if (!p.at) {
      throw new Error(`任务 ${data.id}：敌方单位 ${i} 缺少 at（非 enemyStartByDice 模式）`);
    }
    return makeUnit(`enemy_${i}`, p);
  });
  if (diceList && di !== diceList.length) {
    throw new Error(
      `任务 ${data.id}：内部错误：无坐标掷骰数 ${diceList.length} 与无 at 的敌方数不一致`,
    );
  }

  return { map, sherman, enemies, data, shermanEvacuated: false };
}

/** 每个敌方单位掷 1d6：先试 eid=点数之格；被占则 eid+1…6→1 循环直至空位或试满 6 档。 */
function resolveEnemyDicePlacements(
  data: MissionData,
  map: HexMap,
  shermanPos: Axial,
  rng: RNG,
): Array<{ at: Offset; facing: Direction }> {
  const cellsByEid = new Map<number, { pos: Axial; facing: Direction }>();
  for (const tile of map.all()) {
    const id = tile.enemyStartId;
    if (id == null) continue;
    if (!Number.isInteger(id) || id < 1 || id > 6) {
      throw new Error(`任务 ${data.id}：非法 enemyStartId / eid=${id}（须为 1..6）`);
    }
    if (cellsByEid.has(id)) {
      throw new Error(`任务 ${data.id}：重复的敌方出生编号 eid=${id}（全图须唯一）`);
    }
    const facing = (tile.enemyStartFacing ?? 0) as Direction;
    cellsByEid.set(id, { pos: tile.pos, facing });
  }

  const taken = new Set<string>([`${shermanPos.q},${shermanPos.r}`]);
  for (let i = 0; i < data.enemies.length; i++) {
    const p = data.enemies[i];
    if (p.at) {
      const ax = offsetToAxial(p.at);
      taken.add(`${ax.q},${ax.r}`);
    }
  }

  const out: Array<{ at: Offset; facing: Direction }> = [];
  for (let ei = 0; ei < data.enemies.length; ei++) {
    const p = data.enemies[ei];
    if (p.at) {
      continue;
    }
    const d = rng.d6();
    let placed: { pos: Axial; facing: Direction } | null = null;
    for (let step = 0; step < 6; step++) {
      const eid = ((d - 1 + step) % 6) + 1;
      const cell = cellsByEid.get(eid);
      if (!cell) continue;
      const key = `${cell.pos.q},${cell.pos.r}`;
      if (taken.has(key)) continue;
      placed = cell;
      break;
    }
    if (!placed) {
      throw new Error(
        `任务 ${data.id}：第 ${ei + 1} 个无坐标敌方单位掷骰出生失败（1d6=${d}，链式 1..6 均无空位或缺格）`,
      );
    }
    taken.add(`${placed.pos.q},${placed.pos.r}`);
    out.push({ at: axialToOffset(placed.pos), facing: placed.facing });
  }
  return out;
}

/** 解析基底地形 + 是否带建筑；兼容旧版 `t: "b"` 整格建筑 */
function parseTileDefBase(def: TileDef): { terrain: TerrainType; hasBuilding: boolean } {
  if (def.t === 'b') {
    return { terrain: 'field', hasBuilding: true };
  }
  const hasBuilding = def.bd === 1;
  const terrain = TERRAIN_MAP[def.t as keyof typeof TERRAIN_MAP];
  return { terrain, hasBuilding };
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
  if (!p.at) {
    throw new Error(`makeUnit(${id})：缺少 at`);
  }
  const stats = getUnitStats(p.kind);
  /** 朝向仅 0..5（E…NE）。关卡 JSON 误填 6 或负数时归一，避免 neighbor → axialAdd 读 undefined.q 崩溃。 */
  let facingNorm: Direction | null = p.facing ?? null;
  if (facingNorm !== null) {
    const n = ((Number(facingNorm) % 6) + 6) % 6;
    facingNorm = n as Direction;
  }
  const u: Unit = {
    id,
    kind: p.kind,
    faction: p.faction,
    pos: offsetToAxial(p.at),
    facing: facingNorm,
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
