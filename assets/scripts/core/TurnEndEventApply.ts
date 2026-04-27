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
import { approximateDirection, hexDistance } from './HexGrid';
import { LoadedMission } from './MissionLoader';
import { TurnEndEffectType, TurnEndEventRow } from './TurnEndEventDB';
import { getUnitStats } from './UnitDB';
import { Direction, Unit, UnitKind } from './types';

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

export interface TurnEndPrepared {
  bodyKey: string;
  bodyParams: Record<string, string | number>;
  apply: () => void;
  /** 有则：主骰结算后按顺序各播一段掷骰动画（增援格 / 斯图卡各段等） */
  extraDicePhases?: TurnEndExtraDicePhase[];
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
    if (e.destroyed || e.kind !== 'infantry') continue;
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

/** 相邻步兵对谢尔曼：优先走主炮检定链；无法直射时用 2d6≥7 + 穿甲 1 vs 装甲 4 */
function applyAdjacentInfantryVolleys(mission: LoadedMission, rng: RNG) {
  const sh = mission.sherman;
  if (sh.destroyed) return;
  const infs = mission.enemies.filter(
    e => !e.destroyed && e.kind === 'infantry' && hexDistance(e.pos, sh.pos) === 1,
  );
  for (const inf of infs) {
    const ctx = { attacker: inf, target: sh, map: mission.map };
    if (canAttack(ctx).ok) {
      const rep = rollAttack(ctx, rng);
      applyAttack(sh, rep);
      if (sh.destroyed) return;
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
    const damageEffect = resolveDamageEffect(sh, damageDie);
    const crewCheck = damageEffect === 'crewCheck' ? resolveCrewCheck(sh, rng) : undefined;
    applyAttack(sh, {
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
    });
    if (sh.destroyed) return;
  }
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
      return {
        bodyKey: 'turnEnd.adjacent',
        bodyParams: baseParams,
        apply: () => applyAdjacentInfantryVolleys(mission, rng),
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
    case 'road_mine': {
      const t = mission.map.get(sh.pos);
      const onRoad = t?.terrain === 'road';
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
