/**
 * 任务加载器：把 JSON 任务数据 → 内存中的 HexMap + 单位列表。
 *
 * 用法：
 *   const data = JSON.parse(jsonText) as MissionData;
 *   const { map, sherman, enemies } = loadMission(data, rng);
 */

import { breakwaterFlagsFromMapJson, directionTo, HexMap, offsetToAxial, axialToOffset, hedgeFlagsFromMapJson, hexDistance, roadFlagsFromMapJson } from './HexGrid';
import {
  Axial,
  DEFAULT_VISION_RANGE,
  Direction,
  isFootKind,
  MissionData,
  Offset,
  TerrainType,
  Tile,
  TileDef,
  tileHasBridge,
  Unit,
  UnitKind,
  UnitPlacement,
  ShermanCrew,
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
  c: 'clear',
  T: 'trees',
  B: 'beach',
  H: 'rocky',
  dw: 'deep_water',
  a: 'airstrip',
} as const;

let currentMissionTheater: MissionData['theater'] = 'europe';

type StartOccupant = UnitKind | 'blocker';

function cellKey(pos: Axial): string {
  return `${pos.q},${pos.r}`;
}

function isJapaneseTankOrGunKind(kind: UnitKind): boolean {
  return kind === 'type95'
    || kind === 'type97'
    || kind === 'at_gun'
    || kind === 'heavy_artillery';
}

function canShareStartCell(existing: StartOccupant, incoming: UnitKind, theater: MissionData['theater']): boolean {
  if (theater !== 'pacific') return false;
  if (existing === 'blocker') return false;
  return (existing === 'japanese_infantry' && isJapaneseTankOrGunKind(incoming))
    || (incoming === 'japanese_infantry' && isJapaneseTankOrGunKind(existing));
}

function startCellBlocked(
  occupied: Map<string, StartOccupant[]>,
  pos: Axial,
  incoming: UnitKind,
  theater: MissionData['theater'],
): boolean {
  const occupants = occupied.get(cellKey(pos)) ?? [];
  return occupants.some(existing => !canShareStartCell(existing, incoming, theater));
}

function addStartOccupant(occupied: Map<string, StartOccupant[]>, pos: Axial, occupant: StartOccupant): void {
  const key = cellKey(pos);
  const occupants = occupied.get(key);
  if (occupants) occupants.push(occupant);
  else occupied.set(key, [occupant]);
}

export interface LoadedMission {
  map: HexMap;
  sherman: Unit;
  allies: Unit[];
  enemies: Unit[];
  data: MissionData;
  /** destroy_kind_evac：谢尔曼已成功执行离场移动（驶出地图） */
  shermanEvacuated?: boolean;
  /** 任务 5：德军卡车因回合结束事件驶出地图底/终点 → 玩家判负 */
  truckEscapeDefeat?: boolean;
  /** Pacific: accumulated US casualties for this mission. */
  usCasualties?: number;
}

/** 从地图收集 eid 1..6 → 轴向坐标 + 朝向（掷骰放坦克 / 谢尔曼共用）。 */
function buildCellsByEidFromMap(missionId: string, map: HexMap): Map<number, { pos: Axial; facing: Direction }> {
  const cellsByEid = new Map<number, { pos: Axial; facing: Direction }>();
  for (const tile of map.all()) {
    const eid = tile.enemyStartId;
    if (eid != null) {
      if (!Number.isInteger(eid) || eid < 1 || eid > 6) {
        throw new Error(`任务 ${missionId}：非法 enemyStartId / eid=${eid}（须为 1..6）`);
      }
      if (cellsByEid.has(eid)) {
        throw new Error(`任务 ${missionId}：重复的敌方出生编号 eid=${eid}（全图须唯一）`);
      }
      const facing = (tile.enemyStartFacing ?? 0) as Direction;
      cellsByEid.set(eid, { pos: tile.pos, facing });
    }
  }
  return cellsByEid;
}

/** 掷 1d6 后链式尝试 eid 1..maxEid（模 maxEid），首个未被 `taken` 占用的 eid 格胜出。 */
function pickEidDiceSlot(
  missionId: string,
  cellsByEid: Map<number, { pos: Axial; facing: Direction }>,
  occupied: Map<string, StartOccupant[]>,
  rng: RNG,
  ctxLabel: string,
  incomingKind: UnitKind,
  theater: MissionData['theater'],
  maxEid: number = 6,
): { pos: Axial; facing: Direction } {
  const cap = Math.min(6, Math.max(1, Math.floor(maxEid)));
  const d = rng.d6();
  for (let step = 0; step < cap; step++) {
    const slot = ((d - 1 + step) % cap) + 1;
    const cell = cellsByEid.get(slot);
    if (!cell) continue;
    if (startCellBlocked(occupied, cell.pos, incomingKind, theater)) continue;
    return cell;
  }
  throw new Error(
    `任务 ${missionId}：${ctxLabel} 掷骰链式占位失败（1d6=${d}，eid 1..${cap} 均无空位或缺格）`,
  );
}

function normalizeStartEids(missionId: string, raw: UnitPlacement['startEids'], ctxLabel: string): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`任务 ${missionId}：${ctxLabel} startEids 须为非空数组`);
  }
  const seen = new Set<number>();
  for (const eid of raw) {
    if (!Number.isInteger(eid) || eid < 1 || eid > 6) {
      throw new Error(`任务 ${missionId}：${ctxLabel} startEids=${JSON.stringify(raw)} 非法，eid 须为 1..6 整数`);
    }
    if (seen.has(eid)) {
      throw new Error(`任务 ${missionId}：${ctxLabel} startEids=${JSON.stringify(raw)} 含重复 eid=${eid}`);
    }
    seen.add(eid);
  }
  return [...seen].sort((a, b) => a - b);
}

function normalizeStartRids(missionId: string, raw: UnitPlacement['startRids'], ctxLabel: string): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`任务 ${missionId}：${ctxLabel} startRids 须为非空数组`);
  }
  const seen = new Set<number>();
  for (const rid of raw) {
    if (!Number.isInteger(rid) || rid < 1 || rid > 6) {
      throw new Error(`任务 ${missionId}：${ctxLabel} startRids=${JSON.stringify(raw)} 非法，rid 须为 1..6 整数`);
    }
    if (seen.has(rid)) {
      throw new Error(`任务 ${missionId}：${ctxLabel} startRids=${JSON.stringify(raw)} 含重复 rid=${rid}`);
    }
    seen.add(rid);
  }
  return [...seen].sort((a, b) => a - b);
}

function pickRestrictedNumberedSlot(
  missionId: string,
  cellsByNumber: Map<number, { pos: Axial; facing: Direction }>,
  occupied: Map<string, StartOccupant[]>,
  rng: RNG,
  ctxLabel: string,
  allowedNumbers: number[],
  markerLabel: 'eid' | 'rid',
  incomingKind: UnitKind,
  theater: MissionData['theater'],
): { pos: Axial; facing: Direction } {
  const available: Array<{ n: number; cell: { pos: Axial; facing: Direction } }> = [];
  for (const n of allowedNumbers) {
    const cell = cellsByNumber.get(n);
    if (!cell) continue;
    if (startCellBlocked(occupied, cell.pos, incomingKind, theater)) continue;
    available.push({ n, cell });
  }
  if (available.length === 0) {
    throw new Error(
      `任务 ${missionId}：${ctxLabel} 限定 ${markerLabel}=${allowedNumbers.join('/')} 的随机出生失败（均无空位或缺格）`,
    );
  }
  return rng.pick(available).cell;
}

export function loadMission(data: MissionData, rng?: RNG): LoadedMission {
  currentMissionTheater = data.theater ?? 'europe';
  // 1. 构建 HexMap
  const map = new HexMap(data.cols, data.rows);
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const def: TileDef | null | undefined = data.tiles[row]?.[col];
      if (!def) continue;
      const { terrain, hasBuilding } = parseTileDefBase(def);
      const eid = def.eid;
      // ef 与 h[i] 使用同一套方向索引 0..5，见 `HexGrid.hedgeFlagsFromMapJson` 与 `HEX_DIRECTIONS`
      const efRaw = def.ef;
      const facing: Direction | undefined = efRaw !== undefined && efRaw !== null
        ? ((((Number(efRaw) % 6) + 6) % 6) as Direction)
        : undefined;
      const rfRaw = def.rf;
      const reinforceFacing: Direction | undefined = rfRaw !== undefined && rfRaw !== null
        ? ((((Number(rfRaw) % 6) + 6) % 6) as Direction)
        : undefined;
      const bridgeEnds = parseBridgeEnds(data.id, { col, row }, terrain, def.br);
      const roads = parseRoadFlags(data.id, { col, row }, terrain, !!bridgeEnds, def.rd);
      const tile: Tile = {
        pos: offsetToAxial({ col, row }),
        terrain,
        ...(hasBuilding ? { hasBuilding: true } : {}),
        hedges: hedgeFlagsFromMapJson(def.h),
        breakwaters: breakwaterFlagsFromMapJson(def.bw),
        ...(roads ? { roads } : {}),
        reinforceId: def.rid,
        ...(reinforceFacing !== undefined ? { reinforceFacing } : {}),
        ...(eid !== undefined && eid !== null ? { enemyStartId: eid } : {}),
        ...(facing !== undefined ? { enemyStartFacing: facing } : {}),
        ...(bridgeEnds ? { bridgeEnds } : {}),
      };
      map.set(tile);
    }
  }

  // 2. 谢尔曼（须先于无坐标敌军的掷骰占位；可与敌军共用 eid 黑格表）
  const useDice = !!data.enemyStartByDice;
  const needsShermanDice = !!(data.shermanStartByDice && !data.sherman.at);
  const needsEnemyDice = useDice && data.enemies.some((p) => !p.at);
  if (data.shermanStartByDice && data.sherman.at) {
    throw new Error(`任务 ${data.id}：shermanStartByDice 为 true 时不应填写 sherman.at`);
  }
  if (needsShermanDice && !data.enemyStartByDice) {
    throw new Error(`任务 ${data.id}：shermanStartByDice 须与 enemyStartByDice 同时为 true`);
  }
  if (!needsShermanDice && !data.sherman.at) {
    throw new Error(`任务 ${data.id}：sherman.at 必填（未启用 shermanStartByDice）`);
  }
  const needsDice = needsEnemyDice || needsShermanDice;
  let rngResolved = rng;
  if (!rngResolved && needsDice) {
    rngResolved = new RNG(0x5EEDFACE);
  }

  const occupiedBeforeSherman = new Map<string, StartOccupant[]>();
  for (let i = 0; i < (data.allies ?? []).length; i++) {
    const p = data.allies![i];
    if (!p.at) {
      throw new Error(`任务 ${data.id}：友军单位 ${i} 缺少 at`);
    }
    const ax = offsetToAxial(p.at);
    addStartOccupant(occupiedBeforeSherman, ax, 'blocker');
  }
  for (let i = 0; i < data.enemies.length; i++) {
    const p = data.enemies[i];
    if (p.at) {
      const ax = offsetToAxial(p.at);
      addStartOccupant(occupiedBeforeSherman, ax, p.kind);
    }
  }

  let shermanPlacement: UnitPlacement;
  if (needsShermanDice) {
    const cellsByEid = buildCellsByEidFromMap(data.id, map);
    const cell = pickEidDiceSlot(
      data.id,
      cellsByEid,
      occupiedBeforeSherman,
      rngResolved!,
      '谢尔曼',
      'sherman',
      data.theater,
      6,
    );
    shermanPlacement = {
      ...data.sherman,
      at: axialToOffset(cell.pos),
      facing: cell.facing,
    };
  } else {
    shermanPlacement = data.sherman as UnitPlacement;
  }
  const sherman = makeUnit('sherman_player', shermanPlacement);
  const allies = (data.allies ?? []).map((p, i) => makeUnit(`ally_${i}`, p));

  // 3. 德军：可选掷骰出生
  // enemyStartByDice 为 true 时：有 `at` 的单位用 JSON 固定格；无 `at` 的单位掷 1d6 链式占位——
  // 步兵用红格 rid（1..6），坦克等非步兵用黑格 eid（1..6）（见 GDD）
  const diceList =
    useDice && needsEnemyDice && rngResolved
      ? resolveEnemyDicePlacements(data, map, sherman.pos, allies.map(u => u.pos), rngResolved)
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
        // 保留 placement 上其它「与位置无关」的状态位，避免因 dice 模式丢失
        paralyzed: p.paralyzed,
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

  if (data.truckPath && data.truckPath.length > 0) {
    validateTruckPath(data, map);
  }

  const mission: LoadedMission = {
    map,
    sherman,
    allies,
    enemies,
    data,
    shermanEvacuated: false,
    truckEscapeDefeat: false,
    usCasualties: 0,
  };
  if (data.truckPath && data.truckPath.length >= 2) {
    const truckU = enemies.find(e => e.kind === 'truck' && !e.destroyed);
    if (truckU) {
      const a0 = offsetToAxial(data.truckPath[0]!);
      const a1 = offsetToAxial(data.truckPath[1]!);
      const face = directionTo(a0, a1) ?? (0 as Direction);
      truckU.facing = face;
    }
  }
  return mission;
}

function validateTruckPath(data: MissionData, map: HexMap) {
  const p = data.truckPath!;
  for (let i = 0; i < p.length; i++) {
    const o = p[i]!;
    const t = map.get(offsetToAxial(o));
    if (!t) throw new Error(`任务 ${data.id}：truckPath[${i}] 不在地图内 ${JSON.stringify(o)}`);
    // 公路格 / 水域+桥梁格皆视为「卡车可走的路网」（GDD §3.2：桥梁等效公路）；其余抛错。
    const isRoad = t.terrain === 'road';
    const isBridge = tileHasBridge(t);
    if (!isRoad && !isBridge) {
      throw new Error(`任务 ${data.id}：truckPath[${i}] 非公路或桥梁格（须 t="r"，或 t="w" + br=[a,b]）`);
    }
    // exitDir 仅末格生效：中间格写了直接抛错（避免误以为可以中途换出口）
    if (o.exitDir !== undefined) {
      if (i !== p.length - 1) {
        throw new Error(
          `任务 ${data.id}：truckPath[${i}] 误填 exitDir，仅末格（i=${p.length - 1}）允许；当前值 ${o.exitDir}`,
        );
      }
      if (!Number.isInteger(o.exitDir) || o.exitDir < 0 || o.exitDir > 5) {
        throw new Error(
          `任务 ${data.id}：truckPath 末格 exitDir=${o.exitDir} 非法（须 0..5：0=E,1=SE,2=SW,3=W,4=NW,5=NE）`,
        );
      }
      // 末格若是桥梁，exitDir 必须是桥端两方向之一（GDD §3.2：车辆只能从桥端方向驶出桥梁格）
      if (isBridge && t.bridgeEnds && !t.bridgeEnds.includes(o.exitDir as Direction)) {
        throw new Error(
          `任务 ${data.id}：truckPath 末格 (${o.col},${o.row}) 是桥梁，exitDir=${o.exitDir} 不在桥端 [${t.bridgeEnds.join(',')}] 内`,
        );
      }
    }
  }
  for (let i = 0; i < p.length - 1; i++) {
    const a = offsetToAxial(p[i]!);
    const b = offsetToAxial(p[i + 1]!);
    if (hexDistance(a, b) !== 1) {
      throw new Error(
        `任务 ${data.id}：truckPath[${i}] 与 [${i + 1}] 不相邻：${JSON.stringify(p[i])} / ${JSON.stringify(p[i + 1])}`,
      );
    }
    // 桥梁边向校验：若 a / b 任一为桥梁格，跨边方向必须命中其桥端方向
    const tA = map.get(a);
    const tB = map.get(b);
    const dirAB = directionTo(a, b);
    const dirBA = directionTo(b, a);
    if (dirAB !== null && tileHasBridge(tA) && !tA!.bridgeEnds!.includes(dirAB)) {
      throw new Error(
        `任务 ${data.id}：truckPath[${i}]→[${i + 1}] 从桥梁 (${p[i]!.col},${p[i]!.row}) 驶出方向=${dirAB} 不在桥端 [${tA!.bridgeEnds!.join(',')}] 内`,
      );
    }
    if (dirBA !== null && tileHasBridge(tB) && !tB!.bridgeEnds!.includes(dirBA)) {
      throw new Error(
        `任务 ${data.id}：truckPath[${i}]→[${i + 1}] 进入桥梁 (${p[i + 1]!.col},${p[i + 1]!.row}) 的方向=${dirBA} 不在桥端 [${tB!.bridgeEnds!.join(',')}] 内`,
      );
    }
  }
}

/** 掷骰链：步兵用 rid 红格，坦克等用 eid 黑格；先试编号=骰点，再 eid/rid+1…6→1 循环直至空位或试满 6 档。 */
function resolveEnemyDicePlacements(
  data: MissionData,
  map: HexMap,
  shermanPos: Axial,
  alliedBlockedPositions: Axial[],
  rng: RNG,
): Array<{ at: Offset; facing: Direction }> {
  const cellsByEid = buildCellsByEidFromMap(data.id, map);
  const cellsByRid = new Map<number, { pos: Axial; facing: Direction }>();
  for (const tile of map.all()) {
    const rid = tile.reinforceId;
    if (rid != null) {
      if (!Number.isInteger(rid) || rid < 1 || rid > 6) {
        throw new Error(`任务 ${data.id}：非法 reinforceId / rid=${rid}（须为 1..6）`);
      }
      if (cellsByRid.has(rid)) {
        throw new Error(`任务 ${data.id}：重复的援军编号 rid=${rid}（全图须唯一）`);
      }
      const facing = (tile.reinforceFacing ?? tile.enemyStartFacing ?? 0) as Direction;
      cellsByRid.set(rid, { pos: tile.pos, facing });
    }
  }

  const occupied = new Map<string, StartOccupant[]>();
  addStartOccupant(occupied, shermanPos, 'blocker');
  for (const pos of alliedBlockedPositions) {
    addStartOccupant(occupied, pos, 'blocker');
  }
  for (let i = 0; i < data.enemies.length; i++) {
    const p = data.enemies[i];
    if (p.at) {
      const ax = offsetToAxial(p.at);
      addStartOccupant(occupied, ax, p.kind);
    }
  }

  const out: Array<{ at: Offset; facing: Direction }> = [];
  for (let ei = 0; ei < data.enemies.length; ei++) {
    const p = data.enemies[ei];
    if (p.at) {
      if (p.startEids || p.startRids) {
        throw new Error(`任务 ${data.id}：第 ${ei + 1} 个敌方单位已固定 at，不能同时配置 startEids/startRids`);
      }
      continue;
    }
    const ctxLabel = `第 ${ei + 1} 个无坐标敌方单位`;
    if (p.startEids && p.startRids) {
      throw new Error(`任务 ${data.id}：${ctxLabel} 不能同时配置 startEids 与 startRids`);
    }
    const allowedRids = normalizeStartRids(data.id, p.startRids, ctxLabel);
    if (allowedRids) {
      if (cellsByRid.size === 0) {
        throw new Error(
          `任务 ${data.id}：${ctxLabel} 配置了 startRids，但地图上没有 rid 编号格`,
        );
      }
      const placed = pickRestrictedNumberedSlot(data.id, cellsByRid, occupied, rng, ctxLabel, allowedRids, 'rid', p.kind, data.theater);
      addStartOccupant(occupied, placed.pos, p.kind);
      out.push({ at: axialToOffset(placed.pos), facing: placed.facing });
      continue;
    }
    const useRid = isFootKind(p.kind);
    const cellMap = useRid ? cellsByRid : cellsByEid;
    if (useRid && cellsByRid.size === 0) {
      throw new Error(
        `任务 ${data.id}：掷骰放置步兵需要地图上至少一处 rid（1..6 援军格），且与既有 rid 不重复`,
      );
    }
    if (!useRid) {
      const eidCtxLabel = `${ctxLabel}（坦克 eid）`;
      const allowedEids = normalizeStartEids(data.id, p.startEids, eidCtxLabel);
      const placed = allowedEids
        ? pickRestrictedNumberedSlot(data.id, cellsByEid, occupied, rng, eidCtxLabel, allowedEids, 'eid', p.kind, data.theater)
        : pickEidDiceSlot(
          data.id,
          cellsByEid,
          occupied,
          rng,
          eidCtxLabel,
          p.kind,
          data.theater,
          data.enemyDiceEidMax ?? 6,
        );
      addStartOccupant(occupied, placed.pos, p.kind);
      out.push({ at: axialToOffset(placed.pos), facing: placed.facing });
      continue;
    }
    if (p.startEids) {
      throw new Error(`任务 ${data.id}：第 ${ei + 1} 个无坐标步兵单位不能配置 startEids（步兵使用 rid）`);
    }
    const d = rng.d6();
    let placedRid: { pos: Axial; facing: Direction } | null = null;
    for (let step = 0; step < 6; step++) {
      const slot = ((d - 1 + step) % 6) + 1;
      const cell = cellMap.get(slot);
      if (!cell) continue;
      if (startCellBlocked(occupied, cell.pos, p.kind, data.theater)) continue;
      placedRid = cell;
      break;
    }
    if (!placedRid) {
      throw new Error(
        `任务 ${data.id}：第 ${ei + 1} 个无坐标敌方单位（步兵 rid）掷骰出生失败（1d6=${d}，链式 1..6 均无空位或缺格）`,
      );
    }
    addStartOccupant(occupied, placedRid.pos, p.kind);
    out.push({ at: axialToOffset(placedRid.pos), facing: placedRid.facing });
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

/**
 * 解析 `TileDef.br` → `Tile.bridgeEnds`，并强校验 GDD §3.2「桥梁」字段：
 * - 仅水域格允许带桥梁；任何非水域基底配 `br` 立即抛错（避免「公路上又叠桥」这类无意义配置悄悄忽略）；
 * - `br` 必须为长度 2 的数组，每项是 0..5 整数，且两端方向不能相同；
 * - 通过校验则归一为 `[Direction, Direction]`，未配置则返回 undefined。
 */
function parseBridgeEnds(
  missionId: string,
  pos: Offset,
  terrain: TerrainType,
  raw: TileDef['br'],
): [Direction, Direction] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (terrain !== 'water') {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 配置了桥梁 br=${JSON.stringify(raw)}，但基底地形非水域（t='${terrain}'）`
      + `。GDD §3.2：桥梁必须叠加在水域格上`,
    );
  }
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 桥梁 br=${JSON.stringify(raw)} 非法，须为长度 2 的方向数组 [a, b]`,
    );
  }
  const [aRaw, bRaw] = raw;
  if (!Number.isInteger(aRaw) || !Number.isInteger(bRaw)) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 桥梁 br=${JSON.stringify(raw)} 非法，两端方向须为整数`,
    );
  }
  if (aRaw < 0 || aRaw > 5 || bRaw < 0 || bRaw > 5) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 桥梁 br=${JSON.stringify(raw)} 非法，方向须 0..5（0=E,1=SE,2=SW,3=W,4=NW,5=NE）`,
    );
  }
  if (aRaw === bRaw) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 桥梁两端方向相同 (${aRaw})，须填两个不同方向`,
    );
  }
  return [aRaw as Direction, bRaw as Direction];
}

/**
 * 解析 `TileDef.rd` → `Tile.roads`（公路视觉条带方向），并强校验：
 * - 仅 `t==='r'`（公路）或水域+桥梁（视觉同公路）允许配置；其它基底立即抛错，避免田地/林地误配；
 * - 必须是长度 6、仅 `0/1` 字符的字符串；
 * - 全 0 等价于未配置（返回 undefined，不写入 Tile.roads）。
 */
function parseRoadFlags(
  missionId: string,
  pos: Offset,
  terrain: TerrainType,
  hasBridge: boolean,
  raw: TileDef['rd'],
): Tile['roads'] {
  if (raw === undefined || raw === null) return undefined;
  if (terrain !== 'road' && terrain !== 'airstrip' && !hasBridge) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 配置了道路方向 rd='${raw}'，但基底地形非公路（t='${terrain}'）。`
      + `公路视觉字段仅允许在 t='r' 或叠桥水域上使用`,
    );
  }
  if (typeof raw !== 'string' || raw.length !== 6 || !/^[01]{6}$/.test(raw)) {
    throw new Error(
      `任务 ${missionId}：tile (${pos.col},${pos.row}) 道路方向 rd='${raw}' 非法，须为长度 6 的 0/1 字符串`,
    );
  }
  const flags = roadFlagsFromMapJson(raw);
  if (!flags || !flags.some(Boolean)) return undefined;
  return flags;
}

function makeUnit(id: string, p: UnitPlacement): Unit {
  if (!p.at) {
    throw new Error(`makeUnit(${id})：缺少 at`);
  }
  const stats = getUnitStats(p.kind, currentMissionTheater ?? 'europe');
  /** 朝向仅 0..5（E…NE）。关卡 JSON 误填 6 或负数时归一，避免 neighbor → axialAdd 读 undefined.q 崩溃。 */
  let facingNorm: Direction | null = p.facing ?? null;
  if (facingNorm !== null) {
    const n = ((Number(facingNorm) % 6) + 6) % 6;
    facingNorm = n as Direction;
  }
  const u: Unit = {
    id,
    kind: p.kind,
    faction: p.faction ?? stats.faction,
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
    if (p.crew) {
      const slots: (keyof ShermanCrew)[] = [
        'commander',
        'loader',
        'gunner',
        'driver',
        'coDriver',
      ];
      for (const slot of slots) {
        const v = p.crew[slot];
        if (v === false || v === true) u.crew![slot] = v;
      }
    }
    u.fireLevel = p.fireLevel !== undefined ? p.fireLevel : 0;
    u.loaded = p.loaded === true;
    u.hatchOpen = !!p.hatchOpen;
    if (u.facing !== null) u.turretFacing = p.turretFacing ?? u.facing;
    u.visionRange = typeof p.visionRange === 'number' && Number.isFinite(p.visionRange)
      ? Math.max(0, Math.floor(p.visionRange))
      : DEFAULT_VISION_RANGE;
    if (p.turretDamaged) u.turretDamaged = true;
  }
  if (p.paralyzed) u.paralyzed = true;
  return u;
}
