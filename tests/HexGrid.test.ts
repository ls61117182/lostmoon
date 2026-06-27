/**
 * HexGrid 单元测试示例。
 *
 * 注意：这个文件**不能**放在 assets/ 下，因为 Cocos Creator 会把
 * 资源目录里的所有 .ts 当游戏脚本编译，从而在运行时报
 * `ReferenceError: describe is not defined`（运行时没有 Jest）。
 *
 * 运行方式（需先安装依赖）：
 *   npm i -D typescript ts-node jest @types/jest ts-jest
 *   npx ts-jest config:init
 *   npx jest
 */

import {
  HEX_DIRECTIONS,
  HexMap,
  axialEquals,
  axialToOffset,
  directionTo,
  fireDirectionTo,
  hexDistance,
  hexLine,
  neighbor,
  offsetToAxial,
  rotateDirection,
} from '../assets/scripts/core/HexGrid';
import { Direction, Unit, effectiveDiceTerrain, tileHasBridge } from '../assets/scripts/core/types';
import { terrainMoveCost, tileMoveCost } from '../assets/scripts/core/MoveCost';
import { computePlayerVisibleHexes, computeRadioSharedVisibleHexes, computeUnitVisibleHexes, currentVisionRange, fogOfWarEnabled, hasFogLineOfSight, hasRadioReceive, hasRadioTransmit, isWithinOwnVisionRange } from '../assets/scripts/core/FogOfWar';
import { getGameModeConfig } from '../assets/scripts/core/GameMode';
import { applyAttack, armorFaceFrom, attackDirectionRuleFrom, canAttack, effectivePenetration, hitThreshold, incomingAngleFrom, previewAttack, rollAttack } from '../assets/scripts/core/Combat';
import { actionDicePool } from '../assets/scripts/core/ActionDice';
import { RNG } from '../assets/scripts/core/Dice';

const rngFrom = (...values): RNG => {
  const queue = [...values];
  return { d6: () => queue.shift() ?? 1 } as unknown as RNG;
};

describe('HexGrid 基础运算', () => {
  test('距离：原点到自身 = 0', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
  });

  test('距离：6 方向相邻 = 1', () => {
    for (const d of HEX_DIRECTIONS) {
      expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
    }
  });

  test('邻居取回再算距离 = 1', () => {
    const origin = { q: 2, r: -1 };
    for (let dir = 0 as Direction; dir < 6; dir = (dir + 1) as Direction) {
      const n = neighbor(origin, dir);
      expect(hexDistance(origin, n)).toBe(1);
    }
  });

  test('Offset ↔ Axial 来回转换', () => {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 7; col++) {
        const ax = offsetToAxial({ col, row });
        const back = axialToOffset(ax);
        expect(back).toEqual({ col, row });
      }
    }
  });

  test('rotateDirection 顺时针旋转', () => {
    expect(rotateDirection(0, 1)).toBe(1);
    expect(rotateDirection(0, 6)).toBe(0);
    expect(rotateDirection(0, -1)).toBe(5);
    expect(rotateDirection(3, 3)).toBe(0);
  });

  test('directionTo 同直线时返回方向，否则 null', () => {
    const o = { q: 0, r: 0 };
    expect(directionTo(o, { q: 3, r: 0 })).toBe(0);
    expect(directionTo(o, { q: 0, r: 3 })).toBe(1);
    expect(directionTo(o, { q: -3, r: 3 })).toBe(2);
    expect(directionTo(o, { q: 1, r: 2 })).toBeNull();
  });

  test('hexLine 包含两端点', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 3, r: 0 });
    expect(line.length).toBe(4);
    expect(axialEquals(line[0], { q: 0, r: 0 })).toBe(true);
    expect(axialEquals(line[3], { q: 3, r: 0 })).toBe(true);
  });
});

describe('HexMap 视线 / 树篱', () => {
  test('林地阻挡视线', () => {
    const map = new HexMap(5, 1);
    for (let q = 0; q < 5; q++) {
      map.set({ pos: { q, r: 0 }, terrain: q === 2 ? 'forest' : 'field' });
    }
    expect(map.hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 })).toBe(false);
  });

  test('两端是林地不算阻挡（只算路径中间）', () => {
    const map = new HexMap(5, 1);
    for (let q = 0; q < 5; q++) {
      map.set({
        pos: { q, r: 0 },
        terrain: (q === 0 || q === 4) ? 'forest' : 'field',
      });
    }
    expect(map.hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 })).toBe(true);
  });

  test('countHedgesAlong：紧挨攻击者格的树篱不计（编码在攻击者格指向邻格）', () => {
    const map = new HexMap(3, 1);
    map.set({
      pos: { q: 0, r: 0 },
      terrain: 'field',
      hedges: [true, false, false, false, false, false], // 攻击者格东向树篱
    });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    expect(map.countHedgesAlong({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(0);
  });

  test('countHedgesAlong：紧挨攻击者格的树篱不计（编码在邻格指回攻击者方向）', () => {
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({
      pos: { q: 1, r: 0 },
      terrain: 'field',
      hedges: [false, false, false, true, false, false], // 邻格西向（指回攻击者）树篱
    });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    expect(map.countHedgesAlong({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(0);
  });

  test('countHedgesAlong：路径中段树篱仍按 1 计，且任一侧编码都识别', () => {
    // (1,0).hedges[0]: 1↔2 之间的树篱编码在 (1,0) 指向 (2,0)
    const map1 = new HexMap(4, 1);
    map1.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map1.set({
      pos: { q: 1, r: 0 },
      terrain: 'field',
      hedges: [true, false, false, false, false, false],
    });
    map1.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    map1.set({ pos: { q: 3, r: 0 }, terrain: 'field' });
    expect(map1.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(1);

    // (2,0).hedges[3]: 同一物理边在 (2,0) 指向 (1,0) 一侧编码
    const map2 = new HexMap(4, 1);
    map2.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map2.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    map2.set({
      pos: { q: 2, r: 0 },
      terrain: 'field',
      hedges: [false, false, false, true, false, false],
    });
    map2.set({ pos: { q: 3, r: 0 }, terrain: 'field' });
    expect(map2.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(1);
  });

  test('countHedgesAlong：相邻目标（路径仅 1 段）→ 紧挨攻击者一律不计', () => {
    const map = new HexMap(2, 1);
    map.set({
      pos: { q: 0, r: 0 },
      terrain: 'field',
      hedges: [true, false, false, false, false, false],
    });
    map.set({
      pos: { q: 1, r: 0 },
      terrain: 'field',
      hedges: [false, false, false, true, false, false],
    });
    expect(map.countHedgesAlong({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(0);
  });
});

describe('Effective range penetration', () => {
  const unitAt = (id: string, q: number, penetration: number, effectiveRange: number): Unit => ({
    id,
    kind: 'panzer4',
    faction: id === 'attacker' ? 'allied' : 'german',
    pos: { q, r: 0 },
    facing: 0,
    stats: {
      faction: id === 'attacker' ? 'allied' : 'german',
      size: 4,
      armorFront: 10,
      armorFrontSide: 9,
      armorRearSide: 8,
      armorRear: 7,
      penetration,
      effectiveRange,
      usCasualtyDice: 0,
      moveSound: '',
      attackSound: '',
      infantryTankCoordination: 0,
      visionType: 'turreted',
      visionRange: 4,
      hasRadio: true,
    },
  });

  test('顶部扩一行并切换 odd-r 基准后，旧格子保持统一平移', () => {
    for (const oldParity of [0, 1] as const) {
      const newParity = (oldParity === 0 ? 1 : 0) as 0 | 1;
      const originBefore = offsetToAxial({ col: 0, row: 0 }, oldParity);
      const originAfter = offsetToAxial({ col: 0, row: 1 }, newParity);
      const delta = { q: originAfter.q - originBefore.q, r: originAfter.r - originBefore.r };
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 12; col++) {
          const before = offsetToAxial({ col, row }, oldParity);
          const after = offsetToAxial({ col, row: row + 1 }, newParity);
          expect(after).toEqual({ q: before.q + delta.q, r: before.r + delta.r });
          expect(axialToOffset(after, newParity)).toEqual({ col, row: row + 1 });
        }
      }
    }
  });

  test('does not decay within range, then loses one per extra hex down to zero', () => {
    const attacker = unitAt('attacker', 0, 3, 4);
    expect(effectivePenetration(attacker, unitAt('target', 4, 0, 4), true)).toBe(3);
    expect(effectivePenetration(attacker, unitAt('target', 5, 0, 4), true)).toBe(2);
    expect(effectivePenetration(attacker, unitAt('target', 9, 0, 4), true)).toBe(0);
    expect(attacker.stats.penetration).toBe(3);
  });

  test('classic mode keeps base penetration beyond effective range', () => {
    const attacker = unitAt('attacker', 0, 3, 4);
    expect(effectivePenetration(attacker, unitAt('target', 9, 0, 4), false)).toBe(3);
  });

  test('attack preview uses the temporary decayed value', () => {
    const attacker = unitAt('attacker', 0, 3, 4);
    const target = unitAt('target', 5, 0, 4);
    const map = new HexMap(6, 1);
    for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
    expect(previewAttack({ attacker, target, map, effectiveRangePenetration: true }).pen.penetration).toBe(2);
    expect(attacker.stats.penetration).toBe(3);
  });

  test('attack report uses the temporary value without mutating base penetration', () => {
    const attacker = unitAt('attacker', 0, 3, 4);
    const target = unitAt('target', 5, 0, 4);
    const map = new HexMap(6, 1);
    for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
    const report = rollAttack({ attacker, target, map, effectiveRangePenetration: true }, new RNG(12345));
    expect(report.penetration).toBe(2);
    expect(attacker.stats.penetration).toBe(3);
  });
});

describe('Hardcore twelve-direction turret fire', () => {
  const tankAt = (id: string, q: number, r: number, facing: Direction = 0): Unit => ({
    id,
    kind: 'panzer4',
    faction: id === 'attacker' ? 'allied' : 'german',
    pos: { q, r },
    facing,
    stats: {
      faction: id === 'attacker' ? 'allied' : 'german',
      size: 4,
      armorFront: 10,
      armorFrontSide: 9,
      armorRearSide: 8,
      armorRear: 7,
      penetration: 3,
      effectiveRange: 4,
      usCasualtyDice: 0,
      moveSound: '',
      attackSound: '',
      infantryTankCoordination: 0,
      visionType: 'turreted',
      visionRange: 6,
      hasRadio: true,
    },
  });

  const fieldMap = (min: number, max: number): HexMap => {
    const map = new HexMap(max - min + 1, max - min + 1);
    for (let q = min; q <= max; q++) {
      for (let r = min; r <= max; r++) map.set({ pos: { q, r }, terrain: 'field' });
    }
    return map;
  };

  test('recognizes all six halfway rays and keeps shortest hex distance', () => {
    const targets = [
      { q: 2, r: 2 }, { q: -2, r: 4 }, { q: -4, r: 2 },
      { q: -2, r: -2 }, { q: 2, r: -4 }, { q: 4, r: -2 },
    ];
    targets.forEach((target, i) => {
      expect(fireDirectionTo({ q: 0, r: 0 }, target)).toBe(6 + i);
      expect(hexDistance({ q: 0, r: 0 }, target)).toBe(4);
    });
  });

  test('halfway target is legal only with the hardcore expansion', () => {
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    expect(canAttack({ attacker, target, map }).ok).toBe(false);
    expect(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok).toBe(true);
    attacker.stats = { ...attacker.stats, visionType: 'fixed' };
    expect(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok).toBe(false);
  });

  test('hardcore halfway main gun fire ignores a single flanking LoS blocker', () => {
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    expect(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok).toBe(true);
  });

  test('hardcore halfway main gun fire is blocked by both flanking LoS blockers', () => {
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 0, r: 1 }, terrain: 'forest' });

    expect(canAttack({ attacker, target, map, expandedTurretDirections: true })).toEqual({
      ok: false,
      reason: 'attack.reason.blocked',
    });
  });

  test('incoming-fire angles use the CSV armor and damage-check direction table', () => {
    const target = tankAt('target', 0, 0, 0);
    const cases = [
      { pos: { q: 1, r: 0 }, angle: 0, armor: 'front', damage: 'front' },
      { pos: { q: 1, r: 1 }, angle: 30, armor: 'front', damage: 'front' },
      { pos: { q: 2, r: -1 }, angle: -30, armor: 'front', damage: 'front' },
      { pos: { q: 0, r: 1 }, angle: 60, armor: 'frontSide', damage: 'right' },
      { pos: { q: 1, r: -1 }, angle: -60, armor: 'frontSide', damage: 'left' },
      { pos: { q: -1, r: 2 }, angle: 90, armor: 'frontSide', damage: 'right' },
      { pos: { q: 1, r: -2 }, angle: -90, armor: 'rearSide', damage: 'left' },
      { pos: { q: -1, r: 1 }, angle: 120, armor: 'rearSide', damage: 'left' },
      { pos: { q: 0, r: -1 }, angle: -120, armor: 'rearSide', damage: 'right' },
      { pos: { q: -2, r: 1 }, angle: 150, armor: 'rear', damage: 'rear' },
      { pos: { q: -1, r: -1 }, angle: -150, armor: 'rear', damage: 'rear' },
      { pos: { q: -1, r: 0 }, angle: 180, armor: 'rear', damage: 'rear' },
    ] as const;
    for (const c of cases) {
      expect(incomingAngleFrom(target, c.pos)).toBe(c.angle);
      const rule = attackDirectionRuleFrom(target, c.pos);
      expect(rule.armorFace).toBe(c.armor);
      expect(rule.damageCheckType).toBe(c.damage);
      expect(armorFaceFrom(target, c.pos)).toBe(c.armor);
    }
  });

  test('attack reports use direction-specific damage tables only when hardcore enables them', () => {
    const attacker = tankAt('attacker', 0, 1);
    const target = tankAt('target', 0, 0, 0);
    const map = fieldMap(0, 1);
    const classicReport = rollAttack({ attacker, target, map, expandedTurretDirections: true }, new RNG(12345));
    expect(classicReport.damageCheckType).toBeUndefined();
    const hardcoreReport = rollAttack({
      attacker,
      target,
      map,
      expandedTurretDirections: true,
      directionalDamageCheck: true,
    }, new RNG(12345));
    expect(hardcoreReport.damageCheckType).toBe('right');
  });

  test('hardcore table applies combined fire and crew effects to non-protagonist tanks', () => {
    const attacker = tankAt('attacker', 1, -1);
    const target = tankAt('target', 0, 0, 0);
    target.crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
    const map = fieldMap(-1, 1);
    const rng = rngFrom(6, 6, 6, 6, 1);
    const report = rollAttack({
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      protagonist: attacker,
    }, rng);
    applyAttack(target, report);

    expect(report.damageCheckType).toBe('left');
    expect(report.damageEffects?.map(e => e.effect)).toEqual(['fire', 'crewCheck']);
    expect(report.damageEffects?.find(e => e.effect === 'crewCheck')?.crewSlot).toBe(3);
    expect(target.fireLevel).toBe(1);
    expect(target.crew!.gunner).toBe(false);
    expect(target.damaged).toBeFalsy();
  });

  test('hardcore burning non-protagonist tank is destroyed by the next penetration', () => {
    const attacker = tankAt('attacker', 0, -1);
    const target = tankAt('target', 0, 0, 0);
    target.fireLevel = 1;
    const map = fieldMap(-1, 1);
    const rng = { d6: () => 6 } as unknown as RNG;
    const report = rollAttack({
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      protagonist: attacker,
    }, rng);
    applyAttack(target, report);

    expect(report.damageEffect).toBe('destroyed');
    expect(report.damageDie).toBeUndefined();
    expect(target.destroyed).toBe(true);
  });

  test('hardcore destroyed damage target class skips damage dice after penetration', () => {
    const attacker = tankAt('attacker', 1, 0);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'type97';
    target.faction = 'japanese';
    target.stats = { ...target.stats, faction: 'japanese', damageTargetClass: 'destroyed' };
    const map = fieldMap(0, 1);
    const report = rollAttack({
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      unitDamageTargetClass: true,
      protagonist: attacker,
    }, rngFrom(6, 6, 6, 6, 1));
    applyAttack(target, report);

    expect(report.damageEffect).toBe('destroyed');
    expect(report.damageDie).toBeUndefined();
    expect(report.stagedDamageDie).toBeUndefined();
    expect(target.destroyed).toBe(true);
  });

  test('configured damage target class is ignored when the hardcore mode flag is off', () => {
    const attacker = tankAt('attacker', 1, 0);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'type97';
    target.faction = 'japanese';
    target.stats = { ...target.stats, faction: 'japanese', damageTargetClass: 'destroyed' };
    const map = fieldMap(0, 1);
    const report = rollAttack({
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      unitDamageTargetClass: false,
      protagonist: attacker,
    }, rngFrom(6, 6, 6, 6, 1));
    applyAttack(target, report);

    expect(report.damageDie).toBe(1);
    expect(report.damageEffect).toBe('fire');
    expect(target.destroyed).toBeFalsy();
    expect(target.fireLevel).toBe(1);
  });

  test('hardcore protagonist right-side crew priority skips dead gunner before commander', () => {
    const attacker = tankAt('attacker', 0, 1);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'sherman';
    target.faction = 'allied';
    target.crew = { commander: true, loader: true, gunner: false, driver: true, coDriver: true };
    const map = fieldMap(-1, 1);
    const report = rollAttack({
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      protagonist: target,
    }, rngFrom(6, 6, 6, 6, 6));
    applyAttack(target, report);

    expect(report.damageCheckType).toBe('right');
    expect(report.stagedCrewCheck).toBeUndefined();
    expect(report.crewCheck).toBeUndefined();
    expect(report.damageEffects?.find(e => e.effect === 'crewCheck')?.crewSlot).toBe(4);
    expect(target.crew!.driver).toBe(false);
    expect(target.crew!.commander).toBe(true);
  });

  test('hardcore protagonist rear damage prioritizes radio before immobilization and fire', () => {
    const attacker = tankAt('attacker', -1, 0);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'sherman';
    target.faction = 'allied';
    target.crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
    const map = fieldMap(-1, 1);
    const ctx = {
      attacker,
      target,
      map,
      directionalDamageCheck: true,
      expandedTurretDirections: true,
      protagonist: target,
    };

    const reportRadio = rollAttack(ctx, rngFrom(6, 6, 6, 6, 4));
    applyAttack(target, reportRadio);
    expect(reportRadio.damageCheckType).toBe('rear');
    expect(target.radioDamaged).toBe(true);
    expect(target.paralyzed).toBeFalsy();
    expect(target.fireLevel ?? 0).toBe(0);

    const reportParalyzed = rollAttack(ctx, rngFrom(6, 6, 6, 6, 4));
    applyAttack(target, reportParalyzed);
    expect(target.paralyzed).toBe(true);
    expect(target.fireLevel ?? 0).toBe(0);
  });

  test('halfway ray counts both bordering hedge paths, divides by two and floors', () => {
    const map = fieldMap(0, 3);
    const hedgeEdges: Array<[{ q: number; r: number }, Direction]> = [
      [{ q: 1, r: 0 }, 1],
      [{ q: 1, r: 1 }, 0],
      [{ q: 2, r: 1 }, 1],
      [{ q: 2, r: 2 }, 0],
      [{ q: 0, r: 1 }, 0],
    ];
    for (const [pos, direction] of hedgeEdges) {
      const tile = map.get(pos)!;
      tile.hedges = [false, false, false, false, false, false];
      tile.hedges[direction] = true;
    }
    expect(map.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 3 })).toBe(2);
  });

  test('closed turret vision follows a selected halfway ray', () => {
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf({ q: 1, r: 1 }))).toBe(true);
    expect(visible.has(HexMap.keyOf({ q: 2, r: 2 }))).toBe(true);
    expect(visible.has(HexMap.keyOf({ q: 3, r: 3 }))).toBe(false);
  });

  test('closed turret halfway fog ignores a single flanking blocker', () => {
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf({ q: 1, r: 1 }))).toBe(true);
    expect(visible.has(HexMap.keyOf({ q: 2, r: 2 }))).toBe(true);
  });

  test('closed turret halfway fog requires both flanking blockers to stop vision', () => {
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 0, r: 1 }, terrain: 'forest' });

    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf({ q: 1, r: 1 }))).toBe(false);
    expect(visible.has(HexMap.keyOf({ q: 2, r: 2 }))).toBe(false);
  });
});

describe('战争迷雾玩家视野', () => {
  test('经典与硬核模式启用各自规则差异', () => {
    expect(fogOfWarEnabled('classic')).toBe(false);
    expect(fogOfWarEnabled('hardcore')).toBe(true);
    expect(getGameModeConfig('classic').aiMainGunFallbackToMG).toBe(false);
    expect(getGameModeConfig('hardcore').aiMainGunFallbackToMG).toBe(true);
    expect(getGameModeConfig('classic').precisionFire).toBe(false);
    expect(getGameModeConfig('hardcore').precisionFire).toBe(true);
    expect(getGameModeConfig('classic').commanderBonusWithoutOpenHatch).toBe(false);
    expect(getGameModeConfig('hardcore').commanderBonusWithoutOpenHatch).toBe(true);
    expect(getGameModeConfig('classic').miscCloseHatchWithDoubles).toBe(false);
    expect(getGameModeConfig('hardcore').miscCloseHatchWithDoubles).toBe(true);
    expect(getGameModeConfig('classic').effectiveRangePenetration).toBe(false);
    expect(getGameModeConfig('hardcore').effectiveRangePenetration).toBe(true);
    expect(getGameModeConfig('classic').directionalDamageCheck).toBe(false);
    expect(getGameModeConfig('hardcore').directionalDamageCheck).toBe(true);
    expect(getGameModeConfig('classic').unitDamageTargetClass).toBe(false);
    expect(getGameModeConfig('hardcore').unitDamageTargetClass).toBe(true);
    expect(getGameModeConfig('classic').radioVisionSharing).toBe(false);
    expect(getGameModeConfig('hardcore').radioVisionSharing).toBe(true);
  });

  test('硬核车长关舱时仅为移动和攻击阶段提供额外骰', () => {
    const crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
    const hardcoreBonus = getGameModeConfig('hardcore').commanderBonusWithoutOpenHatch;
    expect(actionDicePool({ subPhase: 'movement', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus })).toBe(5);
    expect(actionDicePool({ subPhase: 'attack', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus })).toBe(5);
    expect(actionDicePool({ subPhase: 'misc', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus })).toBe(1);
    expect(actionDicePool({ subPhase: 'misc', terrain: 'road', hatchOpen: true, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus })).toBe(2);
  });

  const addRect = (map: HexMap, cols: number, rows: number) => {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        map.set({ pos: offsetToAxial({ col, row }), terrain: 'field' });
      }
    }
  };

  const shermanAt = (col: number, row: number, facing: Direction, hatchOpen: boolean): Unit => ({
    id: 'sherman',
    kind: 'sherman',
    faction: 'allied',
    pos: offsetToAxial({ col, row }),
    facing,
    stats: {} as Unit['stats'],
    hatchOpen,
    visionRange: 4,
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  });

  test('精确射击只在最终命中阈值上应用 -2', () => {
    const map = new HexMap(5, 5);
    addRect(map, 5, 5);
    const attacker = shermanAt(2, 2, 0, false);
    const target: Unit = {
      ...shermanAt(2, 1, 3, false),
      id: 'target',
      kind: 'panzer4',
      faction: 'german',
      stats: { size: 4 } as Unit['stats'],
    };
    const normal = hitThreshold({ attacker, target, map });
    const precision = hitThreshold({ attacker, target, map, hitThresholdModifier: -2 });
    expect(precision).toBe(normal - 2);
  });

  test('关舱：六个相邻格可见，远处仅沿炮塔方向形成射线', () => {
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 3, 0, false);
    sherman.turretFacing = 1;
    const blocker = neighbor(sherman.pos, 1);
    const behind = neighbor(blocker, 1);
    const bodyForward2 = neighbor(neighbor(sherman.pos, 0), 0);
    map.set({ pos: blocker, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    expect(visible.has(HexMap.keyOf(blocker))).toBe(true);
    expect(visible.has(HexMap.keyOf(behind))).toBe(false);
    expect(visible.has(HexMap.keyOf(bodyForward2))).toBe(false);
    for (let direction = 0; direction < 6; direction++) {
      expect(visible.has(HexMap.keyOf(neighbor(sherman.pos, direction as Direction)))).toBe(true);
    }
  });

  test('开舱：半径四格无遮挡目标可见，五格非正前方目标不可见', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(4, 4, 0, true);
    const visible = computePlayerVisibleHexes(map, sherman);
    const radius4 = { q: sherman.pos.q + 2, r: sherman.pos.r + 2 };
    const radius5 = { q: sherman.pos.q + 2, r: sherman.pos.r + 3 };
    expect(hexDistance(sherman.pos, radius4)).toBe(4);
    expect(hexDistance(sherman.pos, radius5)).toBe(5);
    expect(visible.has(HexMap.keyOf(radius4))).toBe(true);
    expect(visible.has(HexMap.keyOf(radius5))).toBe(false);
  });

  test('开舱：夹角方向半径视野忽略单侧阻挡格', () => {
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 2, 0, true);
    const blocker = { q: sherman.pos.q + 1, r: sherman.pos.r };
    const target = { q: sherman.pos.q + 1, r: sherman.pos.r + 1 };
    map.set({ pos: blocker, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    expect(visible.has(HexMap.keyOf(target))).toBe(true);
  });

  test('开舱：夹角方向半径视野需要两侧阻挡格同时存在才遮挡', () => {
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 2, 0, true);
    const blockerA = { q: sherman.pos.q + 1, r: sherman.pos.r };
    const blockerB = { q: sherman.pos.q, r: sherman.pos.r + 1 };
    const target = { q: sherman.pos.q + 1, r: sherman.pos.r + 1 };
    map.set({ pos: blockerA, terrain: 'forest' });
    map.set({ pos: blockerB, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    expect(visible.has(HexMap.keyOf(target))).toBe(false);
  });

  test('当前视野属性同时限制开舱半径与正前方直线', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(3, 4, 0, true);
    sherman.visionRange = 2;
    const forward2 = neighbor(neighbor(sherman.pos, 0), 0);
    const forward3 = neighbor(forward2, 0);
    const offAxis3 = { q: sherman.pos.q, r: sherman.pos.r + 3 };
    const visible = computePlayerVisibleHexes(map, sherman);

    expect(currentVisionRange(sherman)).toBe(2);
    expect(visible.has(HexMap.keyOf(forward2))).toBe(true);
    expect(visible.has(HexMap.keyOf(forward3))).toBe(false);
    expect(visible.has(HexMap.keyOf(offAxis3))).toBe(false);
  });

  test('关舱时炮塔方向视野不得超过当前视野属性', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(3, 4, 0, false);
    sherman.turretFacing = 1;
    sherman.visionRange = 2;
    const turret2 = neighbor(neighbor(sherman.pos, 1), 1);
    const turret3 = neighbor(turret2, 1);
    const bodyForward2 = neighbor(neighbor(sherman.pos, 0), 0);
    const visible = computePlayerVisibleHexes(map, sherman);

    expect(visible.has(HexMap.keyOf(turret2))).toBe(true);
    expect(visible.has(HexMap.keyOf(turret3))).toBe(false);
    expect(visible.has(HexMap.keyOf(bodyForward2))).toBe(false);
  });

  test('own vision range blocks turret vision turn beyond configured distance', () => {
    const unit = shermanAt(0, 0, 0, false);
    unit.stats = { ...unit.stats, visionType: 'turreted', visionRange: 4 };
    unit.visionRange = undefined;
    const inRange = shermanAt(4, 0, 3, false);
    const outOfRange = shermanAt(5, 0, 3, false);

    expect(isWithinOwnVisionRange(unit, inRange)).toBe(true);
    expect(isWithinOwnVisionRange(unit, outOfRange)).toBe(false);
  });

  test('中心点几何连线：{4,1} 建筑遮挡 {2,3} 到 {5,0}/{6,0}', () => {
    const map = new HexMap(8, 6);
    addRect(map, 8, 6);
    const from = offsetToAxial({ col: 2, row: 3 });
    const building = offsetToAxial({ col: 4, row: 1 });
    const targetA = offsetToAxial({ col: 5, row: 0 });
    const targetB = offsetToAxial({ col: 6, row: 0 });
    map.set({ pos: building, terrain: 'field', hasBuilding: true });

    expect(hasFogLineOfSight(map, from, building)).toBe(true);
    expect(hasFogLineOfSight(map, from, targetA)).toBe(false);
    expect(hasFogLineOfSight(map, from, targetB)).toBe(false);
  });

  test('车长阵亡时即使 hatchOpen=true 也按关舱视野计算', () => {
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(3, 3, 0, true);
    sherman.crew!.commander = false;
    const rearAdjacent = neighbor(sherman.pos, 2);
    const rearDistance2 = neighbor(neighbor(sherman.pos, 2), 2);
    const visible = computePlayerVisibleHexes(map, sherman);
    expect(visible.has(HexMap.keyOf(rearAdjacent))).toBe(true);
    expect(visible.has(HexMap.keyOf(rearDistance2))).toBe(false);
  });

  test('有炮塔单位：周围一格可见，远处只沿炮塔方向看到配置距离', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.stats = { ...unit.stats, visionType: 'turreted', visionRange: 4 };
    unit.turretFacing = 1;
    unit.visionRange = undefined;
    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf(neighbor(unit.pos, 2)))).toBe(true);
    expect(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 2), 2)))).toBe(false);
    expect(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 1), 1)))).toBe(true);
  });

  test('无炮塔单位：只沿车体朝向看到配置距离', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.stats = { ...unit.stats, visionType: 'fixed', visionRange: 4 };
    unit.visionRange = undefined;
    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf(neighbor(unit.pos, 0)))).toBe(true);
    expect(visible.has(HexMap.keyOf(neighbor(unit.pos, 1)))).toBe(false);
  });

  test('步兵单位：不依赖朝向，视野固定为周围两格', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.facing = null;
    unit.stats = { ...unit.stats, visionType: 'infantry', visionRange: 4 };
    const visible = computeUnitVisibleHexes(map, unit);
    expect(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 2), 2)))).toBe(true);
    expect(visible.has(HexMap.keyOf(neighbor(neighbor(neighbor(unit.pos, 2), 2), 2)))).toBe(false);
  });

  test('玩家只获得存活队友所在格，不获得队友周围或朝向视野', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(1, 4, 0, false);
    sherman.visionRange = 1;
    const ally = shermanAt(6, 4, 1, false);
    ally.id = 'ally';
    ally.turretFacing = 1;
    const allyForward = neighbor(ally.pos, 1);
    const visible = computePlayerVisibleHexes(map, sherman, [ally]);

    expect(visible.has(HexMap.keyOf(ally.pos))).toBe(true);
    expect(visible.has(HexMap.keyOf(allyForward))).toBe(false);
    ally.destroyed = true;
    expect(computePlayerVisibleHexes(map, sherman, [ally]).has(HexMap.keyOf(ally.pos))).toBe(false);
  });

  test('hardcore radio shares friendly transmitter vision', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(1, 4, 0, false);
    sherman.visionRange = 1;
    const ally = shermanAt(6, 4, 1, false);
    ally.id = 'ally';
    ally.turretFacing = 1;
    const allyForward = neighbor(ally.pos, 1);

    expect(computePlayerVisibleHexes(map, sherman, [ally]).has(HexMap.keyOf(allyForward))).toBe(false);
    expect(computePlayerVisibleHexes(map, sherman, [ally], true).has(HexMap.keyOf(allyForward))).toBe(true);
  });

  test('tank radio transmit requires commander and receive requires co-driver', () => {
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const receiver = shermanAt(1, 4, 0, false);
    const sender = shermanAt(6, 4, 1, false);
    sender.id = 'sender';
    sender.turretFacing = 1;
    const senderForward = neighbor(sender.pos, 1);

    expect(hasRadioReceive(receiver)).toBe(true);
    expect(hasRadioTransmit(sender)).toBe(true);
    expect(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward))).toBe(true);

    receiver.crew!.coDriver = false;
    expect(hasRadioReceive(receiver)).toBe(false);
    expect(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward))).toBe(false);

    receiver.crew!.coDriver = true;
    sender.crew!.commander = false;
    expect(hasRadioTransmit(sender)).toBe(false);
    expect(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward))).toBe(false);
  });

  test('non-tank intact radio can both receive and transmit', () => {
    const infantry = shermanAt(4, 4, 0, false);
    infantry.kind = 'infantry';
    infantry.facing = null;
    infantry.crew = undefined;
    infantry.stats = { ...infantry.stats, visionType: 'infantry', visionRange: 2 };

    expect(hasRadioReceive(infantry)).toBe(true);
    expect(hasRadioTransmit(infantry)).toBe(true);
    infantry.radioDamaged = true;
    expect(hasRadioReceive(infantry)).toBe(false);
    expect(hasRadioTransmit(infantry)).toBe(false);
  });
});

describe('GDD §3.2 桥梁规则', () => {
  test('tileHasBridge：仅水域 + 配置 bridgeEnds 才算桥梁', () => {
    expect(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'water' })).toBe(false);
    expect(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] })).toBe(true);
    // 公路 / 田地等基底就算误填 bridgeEnds 也不算桥梁（MissionLoader 会先抛错，这里只是 helper 兜底）
    expect(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'road', bridgeEnds: [0, 3] } as never)).toBe(false);
  });

  test('effectiveDiceTerrain：水域+桥梁 → road；其他原样', () => {
    expect(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] }))
      .toBe('road');
    expect(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'water' })).toBe('water');
    expect(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'mud' })).toBe('mud');
  });

  test('tileMoveCost：桥梁 cost 同公路（=1，水域=Infinity）', () => {
    expect(terrainMoveCost('water')).toBe(Infinity);
    expect(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'water' })).toBe(Infinity);
    expect(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] })).toBe(1);
    expect(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'road' })).toBe(1);
  });

  test('canTankEnter：水域不可入；水域+桥梁可入', () => {
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    expect(map.canTankEnter({ q: 0, r: 0 })).toBe(false);
    expect(map.canTankEnter({ q: 1, r: 0 })).toBe(true);
  });

  test('canTankCrossEdge：邻格 → 桥梁，进入方向必须命中桥端', () => {
    // (0,0)=field, (1,0)=water+bridge[0=E, 3=W]
    // 从 (0,0) 进入 (1,0)：dir(B→A) = 3 (W) ∈ [0,3] → 允许
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
  });

  test('canTankCrossEdge：邻格 → 桥梁，方向不在桥端 → 拒绝', () => {
    // 桥梁两端 [1=SE, 4=NW]：从 W 邻居 (0,0) 进入 (1,0)，dir(B→A)=3 不在端内 → 拒绝
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [1, 4] });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(false);
  });

  test('canTankCrossEdge：桥梁 → 邻格，出方向必须命中桥端', () => {
    // (0,0)=water+bridge[0=E, 3=W], (1,0)=field
    // 从 (0,0) 出向 (1,0)：dir(A→B)=0 ∈ [0,3] → 允许
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    // 反之试一个不在端内的方向（向 SE 邻居走）：场上没那格 → 不可入兜底
    map.set({ pos: { q: 0, r: 1 }, terrain: 'field' });
    expect(directionTo({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(false);
  });

  test('canTankCrossEdge：相邻两座桥相连 → 两端方向必须同时对齐', () => {
    // (0,0)=water+bridge[0,3], (1,0)=water+bridge[0,3] —— 两座桥沿 E-W 轴相连，物理边方向 0/3 双侧都覆盖
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);

    // (1,0) 改为 [1,4]：物理边 0/3 不在 (1,0) 桥端内 → 拒绝
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [1, 4] });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(false);
  });

  test('canTankCrossEdge：非桥梁场景退化为 canTankEnter（不会误拒）', () => {
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'road' });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'forest' });
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(false); // 距离 = 2，越界
    expect(map.canTankCrossEdge({ q: 1, r: 0 }, { q: 2, r: 0 })).toBe(false); // 林地拒入
  });
});
