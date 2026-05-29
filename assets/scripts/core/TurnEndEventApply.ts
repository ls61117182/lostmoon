/**
 * 回合结束事件：根据已掷好的主骰与配置行，生成说明文案 key + 延迟执行的应用函数。
 * UI 层先播动画，玩家确认后再调用 apply()。
 */

import {
  applyAttack,
  AttackReport,
  canAttack,
  resolveCrewCheck,
  resolveDamageEffect,
  rollAttack,
} from './Combat';
import { RNG } from './Dice';
import {
  approximateDirection,
  directionTo,
  hexDistance,
  neighbor,
  offsetToAxial,
  rotateDirection,
} from './HexGrid';
import { LoadedMission } from './MissionLoader';
import { TurnEndEffectType, TurnEndEventRow } from './TurnEndEventDB';
import { getUnitStats } from './UnitDB';
import { Axial, Direction, effectiveDiceTerrain, isFootUnit, Offset, Unit, UnitKind } from './types';

export interface TurnEndApplyContext {
  mission: LoadedMission;
  rng: RNG;
  nextEnemyId: () => string;
}

/** 主骰播完后依次展示的额外掷骰（点数已预掷，仅用于动画与说明节奏） */
export interface TurnEndExtraDicePhase {
  dice: number[];
  captionKey: string;
}

/** 回合结束「德军卡车沿路推进」：与敌方坦克 AI 一致，按格转向 + 平移 */
export type GermanTruckMoveSegment =
  | { type: 'turn'; at: Axial; from: Direction; to: Direction }
  | { type: 'move'; from: Axial; to: Axial };

/** 相邻步兵对谢尔曼齐射：一发对应一条预掷战报（UI 用主炮同款 DiceShow 逐发播放） */
export interface AdjacentInfantryVolleyPreview {
  report: AttackReport;
  attackerKind: UnitKind;
}

export interface TurnEndPrepared {
  bodyKey: string;
  bodyParams: Record<string, string | number>;
  apply: () => void;
  /** 有则：主骰结算后按顺序各播一段掷骰动画（增援格 / 斯图卡各段等） */
  extraDicePhases?: TurnEndExtraDicePhase[];
  /** 德军卡车移动：确认后 BattleScene 依序播片段，再调用 apply */
  germanTruckMoveSegments?: GermanTruckMoveSegment[];
  /** 仅「已在路径末端、沿朝向驶离地图」：在驶离移动的动画帧上置 truckEscapeDefeat，勿在 apply 里置位（避免与抵达最后一格混淆） */
  germanTruckDefeatAfterExitMove?: boolean;
  /** 相邻步兵集火：由 BattleScene 在主骰后串联完整攻击骰面板（命中→穿甲→伤害），确认后再 apply */
  adjacentInfantryVolleys?: AdjacentInfantryVolleyPreview[];
}

/** 下一步朝向：优先顺时针若步数更少 */
function singleStepTowardFacing(from: Direction, to: Direction): Direction {
  const cw = (to - from + 6) % 6;
  const ccw = (from - to + 6) % 6;
  if (cw <= ccw) return rotateDirection(from, 1);
  return rotateDirection(from, 5);
}

/** 从斯图卡预模拟结果拆出需在 UI 上逐段展示的骰子 */
function buildStukaExtraDicePhases(sim: {
  aa?: [number, number];
  bomb?: [number, number];
  shotDown: boolean;
  report: AttackReport | null;
  /** 击穿后伤害表 1d6（与 report.damageDie 同源）；单独带回避免 UI 漏段 */
  stukaDamageDie?: number;
}): TurnEndExtraDicePhase[] {
  const out: TurnEndExtraDicePhase[] = [];
  if (sim.aa) {
    out.push({ dice: [...sim.aa], captionKey: 'turnEnd.extra.stukaAa' });
  }
  if (sim.bomb) {
    out.push({ dice: [...sim.bomb], captionKey: 'turnEnd.extra.stukaBomb' });
  }
  const rep = sim.report;
  if (rep && rep.penDie !== undefined) {
    out.push({ dice: [rep.penDie], captionKey: 'turnEnd.extra.stukaPen' });
  }
  const dmg = sim.stukaDamageDie ?? rep?.damageDie;
  if (dmg !== undefined && dmg !== null) {
    out.push({ dice: [dmg], captionKey: 'turnEnd.extra.stukaDamage' });
  }
  if (rep?.crewCheck) {
    out.push({ dice: [rep.crewCheck.die], captionKey: 'turnEnd.extra.stukaCrew' });
  }
  return out;
}

function shermanLosToAnyInfantry(mission: LoadedMission): boolean {
  const sh = mission.sherman;
  for (const e of mission.enemies) {
    // 「徒步类」单位（步兵 / 军官）都纳入狙击手视线检查 —— 任务 8 起军官与步兵共享 LOS 触发条件。
    if (e.destroyed || !isFootUnit(e)) continue;
    if (directionTo(e.pos, sh.pos) === null) continue;
    if (mission.map.hasLineOfSight(e.pos, sh.pos)) return true;
  }
  return false;
}

function findTileByReinforceId(mission: LoadedMission, rid: number) {
  for (const t of mission.map.all()) {
    if (t.reinforceId === rid) return t.pos;
  }
  return null;
}

function findTileByEnemyStartId(mission: LoadedMission, eid: number) {
  for (const t of mission.map.all()) {
    if (t.enemyStartId === eid) return t;
  }
  return null;
}

function unitAt(mission: LoadedMission, pos: { q: number; r: number }): Unit | null {
  if (mission.sherman.pos.q === pos.q && mission.sherman.pos.r === pos.r) return mission.sherman;
  for (const e of mission.enemies) {
    if (!e.destroyed && e.pos.q === pos.q && e.pos.r === pos.r) return e;
  }
  return null;
}

function isTankUnitKind(k: UnitKind): boolean {
  return k === 'sherman' || k === 'panzer4' || k === 'panzer3' || k === 'tiger' || k === 'truck';
}

/** 某格上是否站着任何坦克（含谢尔曼 / 敌坦 / 另一辆 truck，不计已毁） */
function cellHasTank(mission: LoadedMission, pos: { q: number; r: number }, selfTruck: Unit): boolean {
  const u = unitAt(mission, pos);
  if (!u || u.destroyed || u === selfTruck) return false;
  return isTankUnitKind(u.kind);
}

/** 深拷贝用于回合结束预结算（对齐 RNG 顺序，不改变真实 mission） */
function cloneUnitForSim(u: Unit): Unit {
  return JSON.parse(JSON.stringify(u)) as Unit;
}

/**
 * 相邻步兵集火：预掷骰并返回每发战报（BattleScene 用主炮同款 DiceShow 播放）；返回待应用的战报表；
 * 与原先「确认后再掷骰」等价 RNG，仅在克隆谢尔曼上演练 applyAttack 以保持顺序与终止条件。
 */
/** 是否存在与谢尔曼六角相邻的存活敌军步兵（事件触发时用于文案：无相邻则无射击条件） */
function hasInfantryAdjacentToSherman(mission: LoadedMission): boolean {
  const sh = mission.sherman;
  if (sh.destroyed) return false;
  // 步兵 / 军官都计入「相邻徒步单位」 —— 任务 8 起军官在相邻齐射事件中与步兵同等参与。
  return mission.enemies.some(
    e => !e.destroyed && isFootUnit(e) && hexDistance(e.pos, sh.pos) === 1,
  );
}

function simulateAdjacentInfantryVolleysForTurnEnd(mission: LoadedMission, rng: RNG): {
  volleys: AdjacentInfantryVolleyPreview[];
} {
  const sh = mission.sherman;
  const volleys: AdjacentInfantryVolleyPreview[] = [];

  if (sh.destroyed) {
    return { volleys };
  }

  const simTarget = cloneUnitForSim(sh);
  // 任务 8 起：军官与步兵同属「徒步类」，相邻齐射时也参与。
  const infs = mission.enemies.filter(
    e => !e.destroyed && isFootUnit(e) && hexDistance(e.pos, sh.pos) === 1,
  );

  for (const inf of infs) {
    if (simTarget.destroyed) break;
    const ctx = { attacker: inf, target: simTarget, map: mission.map };
    if (canAttack(ctx).ok) {
      const rep = rollAttack(ctx, rng);
      volleys.push({ report: rep, attackerKind: inf.kind });
      applyAttack(simTarget, rep);
      continue;
    }
    const d1 = rng.d6();
    const d2 = rng.d6();
    const roll = d1 + d2;
    if (roll < 7) continue;
    const penDie = rng.d6();
    const penTh = 3;
    if (penDie < penTh) continue;
    const damageDie = rng.d6();
    const damageEffect = resolveDamageEffect(simTarget, damageDie);
    const crewCheck = damageEffect === 'crewCheck' ? resolveCrewCheck(simTarget, rng) : undefined;
    const rep: AttackReport = {
      dice: [d1, d2],
      roll,
      threshold: 7,
      hit: true,
      armorFace: 'front',
      armor: 4,
      penetration: 1,
      penDie,
      penThreshold: penTh,
      penetrated: true,
      damageDie,
      damageEffect,
      crewCheck,
      statusChange: damageEffect === 'destroyed' ? 'destroyed' : 'damaged',
    };
    volleys.push({ report: rep, attackerKind: inf.kind });
    applyAttack(simTarget, rep);
  }

  return { volleys };
}

/** 仅掷骰构造战报，不写入单位（确认后再 applyAttack） */
function simulateStukaReport(sh: Unit, rng: RNG): {
  aa?: [number, number];
  bomb?: [number, number];
  shotDown: boolean;
  report: AttackReport | null;
  stukaDamageDie?: number;
} {
  if (sh.destroyed) return { shotDown: false, report: null };
  const hatch = !!sh.hatchOpen && !!sh.crew?.commander;
  if (hatch) {
    const aa: [number, number] = [rng.d6(), rng.d6()];
    if (aa[0] + aa[1] >= 6) {
      return { aa, shotDown: true, report: null };
    }
    const bomb: [number, number] = [rng.d6(), rng.d6()];
    const bombSum = bomb[0] + bomb[1];
    if (bombSum < 8) return { aa, bomb, shotDown: false, report: null };
    const penDie = rng.d6();
    const penTh = 3;
    if (penDie < penTh) return { aa, bomb, shotDown: false, report: null };
    const damageDie = rng.d6();
    const damageEffect = resolveDamageEffect(sh, damageDie);
    const crewCheck = damageEffect === 'crewCheck' ? resolveCrewCheck(sh, rng) : undefined;
    return {
      aa,
      bomb,
      shotDown: false,
      stukaDamageDie: damageDie,
      report: {
        dice: [bomb[0], bomb[1]],
        roll: bombSum,
        threshold: 8,
        hit: true,
        armorFace: 'front',
        armor: 4,
        penetration: 1,
        penDie,
        penThreshold: penTh,
        penetrated: true,
        damageDie,
        damageEffect,
        crewCheck,
        statusChange: damageEffect === 'destroyed' ? 'destroyed' : 'damaged',
      },
    };
  }
  const bomb: [number, number] = [rng.d6(), rng.d6()];
  const bombSum = bomb[0] + bomb[1];
  if (bombSum < 8) return { bomb, shotDown: false, report: null };
  const penDie = rng.d6();
  const penTh = 3;
  if (penDie < penTh) return { bomb, shotDown: false, report: null };
  const damageDie = rng.d6();
  const damageEffect = resolveDamageEffect(sh, damageDie);
  const crewCheck = damageEffect === 'crewCheck' ? resolveCrewCheck(sh, rng) : undefined;
  return {
    bomb,
    shotDown: false,
    stukaDamageDie: damageDie,
    report: {
      dice: [bomb[0], bomb[1]],
      roll: bombSum,
      threshold: 8,
      hit: true,
      armorFace: 'front',
      armor: 4,
      penetration: 1,
      penDie,
      penThreshold: penTh,
      penetrated: true,
      damageDie,
      damageEffect,
      crewCheck,
      statusChange: damageEffect === 'destroyed' ? 'destroyed' : 'damaged',
    },
  };
}

export function prepareTurnEndEvent(
  row: TurnEndEventRow,
  primaryDice: number[],
  sum: number,
  ctx: TurnEndApplyContext,
): TurnEndPrepared {
  const { mission, rng, nextEnemyId } = ctx;
  const sh = mission.sherman;
  const d1 = primaryDice[0] ?? 0;
  const d2 = primaryDice[1] ?? 0;
  const baseParams: Record<string, string | number> = { d1, d2, sum };

  switch (row.effectType as TurnEndEffectType) {
    case 'none': {
      // 显式「本回合无事件」行（mission_07 7-8）：保持事件面板的范围完整列表，
      // 不触发任何骰 / 行动；turnEndRowForSum 落到这里时也走完正常 UI 流程，避免 console.warn。
      return {
        bodyKey: 'turnEnd.none.body',
        bodyParams: baseParams,
        apply: () => {},
      };
    }
    case 'sniper': {
      const los = shermanLosToAnyInfantry(mission);
      const hatch = !!sh.hatchOpen && !!sh.crew?.commander;
      const willKill = hatch && los && !!sh.crew?.commander;
      return {
        bodyKey: willKill ? 'turnEnd.sniper.kia' : 'turnEnd.sniper.safe',
        bodyParams: { ...baseParams, los: los ? 1 : 0, hatch: hatch ? 1 : 0 },
        apply: () => {
          if (!willKill || !sh.crew) return;
          sh.crew.commander = false;
          sh.hatchOpen = false;
        },
      };
    }
    case 'commander_extra': {
      let bodyKey = 'turnEnd.commanderExtra.skip';
      if (!sh.crew?.commander) bodyKey = 'turnEnd.commanderExtra.skip';
      else if ((sh.fireLevel ?? 0) > 0) bodyKey = 'turnEnd.commanderExtra.fire';
      else if (sh.paralyzed) bodyKey = 'turnEnd.commanderExtra.paralyze';
      else if (sh.turretDamaged) bodyKey = 'turnEnd.commanderExtra.turret';
      else bodyKey = 'turnEnd.commanderExtra.load';
      return {
        bodyKey,
        bodyParams: baseParams,
        apply: () => {
          if (!sh.crew?.commander) return;
          if ((sh.fireLevel ?? 0) > 0) {
            sh.fireLevel = (sh.fireLevel ?? 1) - 1;
            return;
          }
          if (sh.paralyzed) {
            sh.paralyzed = false;
            return;
          }
          if (sh.turretDamaged) {
            sh.turretDamaged = false;
            return;
          }
          sh.loaded = true;
        },
      };
    }
    case 'infantry_spawn': {
      const spawnDie = rng.d6();
      const pos = findTileByReinforceId(mission, spawnDie);
      const occ = pos ? unitAt(mission, pos) : null;
      const placed = !!pos && !occ;
      return {
        bodyKey: placed ? 'turnEnd.infantry.placed' : 'turnEnd.infantry.blocked',
        bodyParams: { ...baseParams, spawnDie, rid: spawnDie },
        extraDicePhases: [{ dice: [spawnDie], captionKey: 'turnEnd.extra.spawnReinforce' }],
        apply: () => {
          if (!placed || !pos) return;
          const facing = approximateDirection(pos, sh.pos) as Direction;
          mission.enemies.push({
            id: nextEnemyId(),
            kind: 'infantry',
            faction: 'german',
            pos: { ...pos },
            facing,
            stats: getUnitStats('infantry'),
          });
        },
      };
    }
    case 'adjacent_infantry_fire': {
      const { volleys } = simulateAdjacentInfantryVolleysForTurnEnd(mission, rng);
      const reports = volleys.map(v => v.report);
      const bodyKey =
        !sh.destroyed && !hasInfantryAdjacentToSherman(mission)
          ? 'turnEnd.adjacent.noTarget'
          : 'turnEnd.adjacent';
      return {
        bodyKey,
        bodyParams: baseParams,
        adjacentInfantryVolleys: volleys.length > 0 ? volleys : undefined,
        apply: () => {
          const sherman = mission.sherman;
          for (const rep of reports) {
            applyAttack(sherman, rep);
            if (sherman.destroyed) return;
          }
        },
      };
    }
    case 'mechanical_failure': {
      const already = !!sh.paralyzed;
      return {
        bodyKey: already ? 'turnEnd.mechanical.already' : 'turnEnd.mechanical.ok',
        bodyParams: baseParams,
        apply: () => {
          if (sh.destroyed || sh.paralyzed) return;
          sh.paralyzed = true;
        },
      };
    }
    case 'stuka': {
      const sim = simulateStukaReport(sh, rng);
      const bp: Record<string, string | number> = { ...baseParams };
      if (sim.aa) {
        bp.aa1 = sim.aa[0];
        bp.aa2 = sim.aa[1];
        bp.aasum = sim.aa[0] + sim.aa[1];
      }
      if (sim.bomb) {
        bp.b1 = sim.bomb[0];
        bp.b2 = sim.bomb[1];
        bp.bsum = sim.bomb[0] + sim.bomb[1];
      }
      let bodyKey = 'turnEnd.stuka.miss';
      if (sim.shotDown) bodyKey = 'turnEnd.stuka.shotDown';
      else if (sim.report) bodyKey = 'turnEnd.stuka.hit';
      else if (sim.bomb && sim.bomb[0] + sim.bomb[1] < 8) bodyKey = 'turnEnd.stuka.bombMiss';
      else if (sim.bomb) bodyKey = 'turnEnd.stuka.ric';
      const rep = sim.report;
      const extraDicePhases = buildStukaExtraDicePhases(sim);
      return {
        bodyKey,
        bodyParams: bp,
        extraDicePhases: extraDicePhases.length ? extraDicePhases : undefined,
        apply: () => {
          if (rep) applyAttack(sh, rep);
        },
      };
    }
    case 'panzer3_spawn': {
      const spawnDie = rng.d6();
      const tile = findTileByEnemyStartId(mission, spawnDie);
      const pos = tile?.pos;
      const occ = pos ? unitAt(mission, pos) : null;
      const tankKinds: UnitKind[] = ['sherman', 'panzer4', 'panzer3', 'tiger', 'truck'];
      const blocked = !!occ && tankKinds.includes(occ.kind);
      const placed = !!pos && !blocked;
      const face = (tile?.enemyStartFacing ?? (pos ? approximateDirection(pos, sh.pos) : 0)) as Direction;
      return {
        bodyKey: placed ? 'turnEnd.panzer3.placed' : 'turnEnd.panzer3.blocked',
        bodyParams: { ...baseParams, spawnDie, eid: spawnDie },
        extraDicePhases: [{ dice: [spawnDie], captionKey: 'turnEnd.extra.panzer3Start' }],
        apply: () => {
          if (!placed || !pos) return;
          mission.enemies.push({
            id: nextEnemyId(),
            kind: 'panzer3',
            faction: 'german',
            pos: { ...pos },
            facing: face,
            stats: getUnitStats('panzer3'),
          });
        },
      };
    }
    case 'panzer4_spawn': {
      const spawnDie = rng.d6();
      const tile = findTileByEnemyStartId(mission, spawnDie);
      const pos = tile?.pos;
      const occ = pos ? unitAt(mission, pos) : null;
      const tankKinds: UnitKind[] = ['sherman', 'panzer4', 'panzer3', 'tiger', 'truck'];
      const blocked = !!occ && tankKinds.includes(occ.kind);
      const placed = !!pos && !blocked;
      const face = (tile?.enemyStartFacing ?? (pos ? approximateDirection(pos, sh.pos) : 0)) as Direction;
      return {
        bodyKey: placed ? 'turnEnd.panzer4.placed' : 'turnEnd.panzer4.blocked',
        bodyParams: { ...baseParams, spawnDie, eid: spawnDie },
        extraDicePhases: [{ dice: [spawnDie], captionKey: 'turnEnd.extra.panzer4Start' }],
        apply: () => {
          if (!placed || !pos) return;
          mission.enemies.push({
            id: nextEnemyId(),
            kind: 'panzer4',
            faction: 'german',
            pos: { ...pos },
            facing: face,
            stats: getUnitStats('panzer4'),
          });
        },
      };
    }
    case 'german_truck_move': {
      const path = ctx.mission.data.truckPath;
      if (!path || path.length < 2) {
        return { bodyKey: 'turnEnd.germanTruck.noConfig', bodyParams: baseParams, apply: () => {} };
      }
      const truck = ctx.mission.enemies.find(e => e.kind === 'truck' && !e.destroyed) ?? null;
      if (!truck) {
        return { bodyKey: 'turnEnd.germanTruck.dead', bodyParams: baseParams, apply: () => {} };
      }
      const startIdx = path.findIndex(o => {
        const a = offsetToAxial(o);
        return a.q === truck.pos.q && a.r === truck.pos.r;
      });

      // 规则：卡车每次事件至少前进 1 格；落点若有任何坦克（不论谢尔曼 / 敌坦 / 别的卡车）就再多走 1 格，
      // 直到落在「没有坦克」的格子；途中任意一步落到地图外即整体判定为驶离地图、动画末段判负。
      const segments: GermanTruckMoveSegment[] = [];
      let cursor: Axial = { q: truck.pos.q, r: truck.pos.r };
      let simFace: Direction = (truck.facing ?? 0) as Direction;
      let landCell: Axial = { ...cursor };
      let offMap = false;
      let stepCells = 0;
      const MAX_STEPS = 32;
      for (let step = 0; step < MAX_STEPS; step++) {
        // 当前格仍位于 truckPath 中段 → 沿路径走向下一格；
        // 当前格 = 末格且配了 exitDir → 沿 exitDir 强制驶出；
        // 否则（已离开路径 / 末格未配 exitDir）沿当前朝向 simFace 走一格
        const idxNow = path.findIndex(o => {
          const a = offsetToAxial(o);
          return a.q === cursor.q && a.r === cursor.r;
        });
        let targetCell: Axial;
        if (idxNow >= 0 && idxNow < path.length - 1) {
          targetCell = offsetToAxial(path[idxNow + 1]!);
        } else if (idxNow === path.length - 1 && path[idxNow]!.exitDir !== undefined) {
          targetCell = neighbor(cursor, path[idxNow]!.exitDir as Direction);
        } else {
          targetCell = neighbor(cursor, simFace);
        }
        const targetDir = directionTo(cursor, targetCell);
        if (targetDir !== null) {
          while (simFace !== targetDir) {
            const nf = singleStepTowardFacing(simFace, targetDir);
            segments.push({ type: 'turn', at: { ...cursor }, from: simFace, to: nf });
            simFace = nf;
          }
        }
        segments.push({ type: 'move', from: { ...cursor }, to: { ...targetCell } });
        cursor = targetCell;
        stepCells += 1;

        if (!ctx.mission.map.has(cursor)) {
          offMap = true;
          landCell = { ...cursor };
          break;
        }
        if (!cellHasTank(ctx.mission, cursor, truck)) {
          landCell = { ...cursor };
          break;
        }
        // 此格已有坦克，本次循环尚未落地，继续沿路径 / 朝向再前进一格
      }
      const finalFace = simFace;

      // 落点出地图：动画末段挂 truckExitDefeat，动画结束后判负
      if (offMap) {
        return {
          bodyKey: 'turnEnd.germanTruck.escapeDrive',
          bodyParams: baseParams,
          germanTruckMoveSegments: segments,
          germanTruckDefeatAfterExitMove: true,
          apply: () => {},
        };
      }

      // 落点在地图内：apply 推进 truck.pos / facing；按是否仍在 truckPath 选择 bodyKey
      const landIdx = path.findIndex(o => {
        const a = offsetToAxial(o);
        return a.q === landCell.q && a.r === landCell.r;
      });
      if (landIdx >= 0) {
        return {
          bodyKey: 'turnEnd.germanTruck.moved',
          bodyParams: { ...baseParams, stepCells, toIdx: landIdx + 1 },
          germanTruckMoveSegments: segments,
          germanTruckDefeatAfterExitMove: false,
          apply: () => {
            truck.pos = { ...landCell };
            truck.facing = finalFace;
          },
        };
      }
      return {
        bodyKey: 'turnEnd.germanTruck.atRoadEnd',
        bodyParams: baseParams,
        germanTruckMoveSegments: segments,
        germanTruckDefeatAfterExitMove: false,
        apply: () => {
          truck.pos = { ...landCell };
          truck.facing = finalFace;
        },
      };
    }
    case 'road_mine': {
      const t = mission.map.get(sh.pos);
      // GDD §3.2：桥梁叠加格视同公路（`effectiveDiceTerrain` 把水域+桥梁折算成 'road'），
      // 因此谢尔曼站在桥上也满足「公路地雷」的触发条件。
      const onRoad = effectiveDiceTerrain(t) === 'road';
      if (sh.destroyed || sh.paralyzed || !onRoad) {
        return {
          bodyKey: 'turnEnd.mine.skip',
          bodyParams: { ...baseParams, onRoad: onRoad ? 1 : 0, paralyzed: sh.paralyzed ? 1 : 0 },
          apply: () => {},
        };
      }
      const penDie = rng.d6();
      const penTh = 4;
      const penetrated = penDie >= penTh;
      if (!penetrated) {
        return {
          bodyKey: 'turnEnd.mine.ric',
          bodyParams: { ...baseParams, penDie },
          extraDicePhases: [{ dice: [penDie], captionKey: 'turnEnd.extra.minePen' }],
          apply: () => {},
        };
      }
      const damageDie = rng.d6();
      const damageEffect = resolveDamageEffect(sh, damageDie);
      const crewCheck = damageEffect === 'crewCheck' ? resolveCrewCheck(sh, rng) : undefined;
      const rep: AttackReport = {
        dice: [d1, d2],
        roll: sum,
        threshold: 2,
        hit: true,
        armorFace: 'front',
        armor: 4,
        penetration: 0,
        penDie,
        penThreshold: penTh,
        penetrated: true,
        damageDie,
        damageEffect,
        crewCheck,
        statusChange: damageEffect === 'destroyed' ? 'destroyed' : 'damaged',
      };
      return {
        bodyKey: 'turnEnd.mine.hit',
        bodyParams: { ...baseParams, penDie, damageDie },
        extraDicePhases: [
          { dice: [penDie], captionKey: 'turnEnd.extra.minePen' },
          { dice: [damageDie], captionKey: 'turnEnd.extra.mineDmg' },
        ],
        apply: () => applyAttack(sh, rep),
      };
    }
    default:
      return {
        bodyKey: 'turnEnd.unknown',
        bodyParams: baseParams,
        apply: () => {},
      };
  }
}
