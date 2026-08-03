/**
 * HexGrid 单元测试示例。
 *
 * 注意：这个文件**不能**放在 assets/ 下，因为 Cocos Creator 会把
 * 资源目录里的所有 .ts 当作游戏脚本编译。
 *
 * 测试使用 Node 内置的 assert，不依赖 Jest 或 Jest 全局类型。
 */

declare function require(name: string): any;

const assert = require('assert');

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
import { Direction, FireDirection, Unit, effectiveDiceTerrain, tileHasBridge } from '../assets/scripts/core/types';
import { terrainMoveCost, tileMoveCost } from '../assets/scripts/core/MoveCost';
import { computePlayerVisibleHexes, computeRadioSharedVisibleHexes, computeUnitVisibleHexes, currentVisionRange, fogOfWarEnabled, hasFogLineOfSight, hasRadioReceive, hasRadioTransmit, isWithinOwnVisionRange } from '../assets/scripts/core/FogOfWar';
import { getGameModeConfig } from '../assets/scripts/core/GameMode';
import { shouldNonPlayerTankOpenCommanderHatch } from '../assets/scripts/core/CommanderHatch';
import { fireCheckProfileFor, resolveFireCheckEffect, resolveFireCheckLowest } from '../assets/scripts/core/FireCheck';
import { applyAttack, armorFaceFrom, attackDirectionRuleFrom, canAttack, canMGAttack, effectivePenetration, effectivePenetrationBreakdown, hitThreshold, incomingAngleFrom, previewAttack, rollAttack } from '../assets/scripts/core/Combat';
import { actionDicePool } from '../assets/scripts/core/ActionDice';
import { RNG } from '../assets/scripts/core/Dice';

const rngFrom = (...values): RNG => {
  const queue = [...values];
  return { d6: () => queue.shift() ?? 1 } as unknown as RNG;
};

{
// group: 'HexGrid 基础运算'
  {
    // test: '距离：原点到自身 = 0'
    assert.strictEqual(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 }), 0);
  };

  {
    // test: '距离：6 方向相邻 = 1'
    for (const d of HEX_DIRECTIONS) {
      assert.strictEqual(hexDistance({ q: 0, r: 0 }, d), 1);
    }
  };

  {
    // test: '邻居取回再算距离 = 1'
    const origin = { q: 2, r: -1 };
    for (let dir = 0 as Direction; dir < 6; dir = (dir + 1) as Direction) {
      const n = neighbor(origin, dir);
      assert.strictEqual(hexDistance(origin, n), 1);
    }
  };

  {
    // test: 'Offset ↔ Axial 来回转换'
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 7; col++) {
        const ax = offsetToAxial({ col, row });
        const back = axialToOffset(ax);
        assert.deepStrictEqual(back, { col, row });
      }
    }
  };

  {
    // test: 'rotateDirection 顺时针旋转'
    assert.strictEqual(rotateDirection(0, 1), 1);
    assert.strictEqual(rotateDirection(0, 6), 0);
    assert.strictEqual(rotateDirection(0, -1), 5);
    assert.strictEqual(rotateDirection(3, 3), 0);
  };

  {
    // test: 'directionTo 同直线时返回方向，否则 null'
    const o = { q: 0, r: 0 };
    assert.strictEqual(directionTo(o, { q: 3, r: 0 }), 0);
    assert.strictEqual(directionTo(o, { q: 0, r: 3 }), 1);
    assert.strictEqual(directionTo(o, { q: -3, r: 3 }), 2);
    assert.strictEqual(directionTo(o, { q: 1, r: 2 }), null);
  };

  {
    // test: 'hexLine 包含两端点'
    const line = hexLine({ q: 0, r: 0 }, { q: 3, r: 0 });
    assert.strictEqual(line.length, 4);
    assert.strictEqual(axialEquals(line[0], { q: 0, r: 0 }), true);
    assert.strictEqual(axialEquals(line[3], { q: 3, r: 0 }), true);
  };
};

{
// group: 'HexMap 视线 / 树篱'
  {
    // test: '林地阻挡视线'
    const map = new HexMap(5, 1);
    for (let q = 0; q < 5; q++) {
      map.set({ pos: { q, r: 0 }, terrain: q === 2 ? 'forest' : 'field' });
    }
    assert.strictEqual(map.hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }), false);
  };

  {
    // test: '两端是林地不算阻挡（只算路径中间）'
    const map = new HexMap(5, 1);
    for (let q = 0; q < 5; q++) {
      map.set({
        pos: { q, r: 0 },
        terrain: (q === 0 || q === 4) ? 'forest' : 'field',
      });
    }
    assert.strictEqual(map.hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }), true);
  };

  {
    // test: 'countHedgesAlong：紧挨攻击者格的树篱不计（编码在攻击者格指向邻格）'
    const map = new HexMap(3, 1);
    map.set({
      pos: { q: 0, r: 0 },
      terrain: 'field',
      hedges: [true, false, false, false, false, false], // 攻击者格东向树篱
    });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    assert.strictEqual(map.countHedgesAlong({ q: 0, r: 0 }, { q: 2, r: 0 }), 0);
  };

  {
    // test: 'countHedgesAlong：紧挨攻击者格的树篱不计（编码在邻格指回攻击者方向）'
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({
      pos: { q: 1, r: 0 },
      terrain: 'field',
      hedges: [false, false, false, true, false, false], // 邻格西向（指回攻击者）树篱
    });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    assert.strictEqual(map.countHedgesAlong({ q: 0, r: 0 }, { q: 2, r: 0 }), 0);
  };

  {
    // test: 'countHedgesAlong：路径中段树篱仍按 1 计，且任一侧编码都识别'
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
    assert.strictEqual(map1.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 0 }), 1);

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
    assert.strictEqual(map2.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 0 }), 1);
  };

  {
    // test: 'countHedgesAlong：相邻目标（路径仅 1 段）→ 紧挨攻击者一律不计'
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
    assert.strictEqual(map.countHedgesAlong({ q: 0, r: 0 }, { q: 1, r: 0 }), 0);
  };
};

{
// group: 'Effective range penetration'
  const unitAt = (id: string, q: number, penetration: number, effectiveRange: number): Unit => ({
    id,
    kind: 'panzer4',
    faction: id === 'attacker' ? 'usa' : 'german',
    pos: { q, r: 0 },
    facing: 0,
    stats: {
      faction: id === 'attacker' ? 'usa' : 'german',
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
      crewMembers: [],
    },
  });

  {
    // test: '顶部扩一行并切换 odd-r 基准后，旧格子保持统一平移'
    for (const oldParity of [0, 1] as const) {
      const newParity = (oldParity === 0 ? 1 : 0) as 0 | 1;
      const originBefore = offsetToAxial({ col: 0, row: 0 }, oldParity);
      const originAfter = offsetToAxial({ col: 0, row: 1 }, newParity);
      const delta = { q: originAfter.q - originBefore.q, r: originAfter.r - originBefore.r };
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 12; col++) {
          const before = offsetToAxial({ col, row }, oldParity);
          const after = offsetToAxial({ col, row: row + 1 }, newParity);
          assert.deepStrictEqual(after, { q: before.q + delta.q, r: before.r + delta.r });
          assert.deepStrictEqual(axialToOffset(after, newParity), { col, row: row + 1 });
        }
      }
    }
  };

  {
    // test: 'does not decay within range, then loses one per extra hex down to zero'
    const attacker = unitAt('attacker', 0, 3, 4);
    assert.strictEqual(effectivePenetration(attacker, unitAt('target', 4, 0, 4), true), 3);
    assert.strictEqual(effectivePenetration(attacker, unitAt('target', 5, 0, 4), true), 2);
    assert.strictEqual(effectivePenetration(attacker, unitAt('target', 9, 0, 4), true), 0);
    assert.strictEqual(attacker.stats.penetration, 3);
  };

  {
    // test: 'breakdown reports adjacent range as distance 1 while applying no range penalty'
    const attacker = unitAt('attacker', 0, 3, 4);
    assert.deepStrictEqual(effectivePenetrationBreakdown(attacker, unitAt('target', 1, 0, 4), true), {
      basePenetration: 3,
      effectiveRange: 4,
      distance: 1,
      rangePenalty: 0,
      penetration: 3,
    });
  };

  {
    // test: 'classic mode keeps base penetration beyond effective range'
    const attacker = unitAt('attacker', 0, 3, 4);
    assert.strictEqual(effectivePenetration(attacker, unitAt('target', 9, 0, 4), false), 3);
  };

  {
    // test: 'attack preview uses the temporary decayed value'
    const attacker = unitAt('attacker', 0, 3, 4);
    const target = unitAt('target', 5, 0, 4);
    const map = new HexMap(6, 1);
    for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
    assert.strictEqual(previewAttack({ attacker, target, map, effectiveRangePenetration: true }).pen.penetration, 2);
    assert.strictEqual(attacker.stats.penetration, 3);
  };

  {
    // test: 'attack report uses the temporary value without mutating base penetration'
    const attacker = unitAt('attacker', 0, 3, 4);
    const target = unitAt('target', 5, 0, 4);
    const map = new HexMap(6, 1);
    for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
    const report = rollAttack({ attacker, target, map, effectiveRangePenetration: true }, new RNG(12345));
    assert.strictEqual(report.penetration, 2);
    assert.strictEqual(attacker.stats.penetration, 3);
  };
};

{
// group: 'Hardcore twelve-direction turret fire'
  const tankAt = (id: string, q: number, r: number, facing: Direction = 0): Unit => ({
    id,
    kind: 'panzer4',
    faction: id === 'attacker' ? 'usa' : 'german',
    pos: { q, r },
    facing,
    stats: {
      faction: id === 'attacker' ? 'usa' : 'german',
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
      crewMembers: [],
    },
  });

  const fieldMap = (min: number, max: number): HexMap => {
    const map = new HexMap(max - min + 1, max - min + 1);
    for (let q = min; q <= max; q++) {
      for (let r = min; r <= max; r++) map.set({ pos: { q, r }, terrain: 'field' });
    }
    return map;
  };

  {
    // test: 'recognizes all six halfway rays and keeps shortest hex distance'
    const targets = [
      { q: 2, r: 2 }, { q: -2, r: 4 }, { q: -4, r: 2 },
      { q: -2, r: -2 }, { q: 2, r: -4 }, { q: 4, r: -2 },
    ];
    targets.forEach((target, i) => {
      assert.strictEqual(fireDirectionTo({ q: 0, r: 0 }, target), 6 + i);
      assert.strictEqual(hexDistance({ q: 0, r: 0 }, target), 4);
    });
  };

  {
    // test: 'halfway target is legal only with the hardcore expansion'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    assert.strictEqual(canAttack({ attacker, target, map }).ok, false);
    assert.strictEqual(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok, true);
    attacker.stats = { ...attacker.stats, visionType: 'fixed' };
    assert.strictEqual(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok, false);
  };

  {
    // test: 'StuG III fixed gun may only fire along the hull facing'
    const attacker = tankAt('attacker', 0, 0);
    attacker.kind = 'stug3';
    attacker.stats = { ...attacker.stats, visionType: 'fixed' };
    const forward = tankAt('forward', 2, 0);
    const flank = tankAt('flank', 0, 2);
    const diagonal = tankAt('diagonal', 1, 1);
    const map = fieldMap(0, 2);

    assert.strictEqual(canAttack({ attacker, target: forward, map }).ok, true);
    assert.deepStrictEqual(canAttack({ attacker, target: flank, map }), {
      ok: false,
      reason: 'attack.reason.fixedGunFacing',
    });
    assert.deepStrictEqual(canAttack({ attacker, target: diagonal, map, expandedTurretDirections: true }), {
      ok: false,
      reason: 'attack.reason.notStraight',
    });
  };

  {
    // test: 'hardcore halfway main gun fire ignores a single flanking LoS blocker'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    assert.strictEqual(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok, true);
  };

  {
    // test: 'hardcore halfway main gun fire is blocked by both flanking LoS blockers'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 0, r: 1 }, terrain: 'forest' });

    assert.deepStrictEqual(canAttack({ attacker, target, map, expandedTurretDirections: true }), {
      ok: false,
      reason: 'attack.reason.blocked',
    });
  };

  {
    // test: 'halfway machine-gun target is legal only with the hardcore expansion'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    target.kind = 'infantry';
    const map = fieldMap(0, 1);

    assert.deepStrictEqual(canMGAttack({ attacker, target, map }), {
      ok: false,
      reason: 'attack.reason.notStraight',
    });
    assert.strictEqual(canMGAttack({ attacker, target, map, expandedTurretDirections: true }).ok, true);
  };

  {
    // test: 'hardcore halfway machine-gun fire ignores a single flanking LoS blocker'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    target.kind = 'infantry';
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    assert.strictEqual(canMGAttack({ attacker, target, map, expandedTurretDirections: true }).ok, true);
  };

  {
    // test: 'hardcore halfway machine-gun fire is blocked by both flanking LoS blockers'
    const attacker = tankAt('attacker', 0, 0);
    const target = tankAt('target', 1, 1);
    target.kind = 'infantry';
    const map = fieldMap(0, 1);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 0, r: 1 }, terrain: 'forest' });

    assert.deepStrictEqual(canMGAttack({ attacker, target, map, expandedTurretDirections: true }), {
      ok: false,
      reason: 'attack.reason.blocked',
    });
  };

  {
    // test: 'incoming-fire angles use the CSV armor and damage-check direction table'
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
      assert.strictEqual(incomingAngleFrom(target, c.pos), c.angle);
      const rule = attackDirectionRuleFrom(target, c.pos);
      assert.strictEqual(rule.armorFace, c.armor);
      assert.strictEqual(rule.damageCheckType, c.damage);
      assert.strictEqual(armorFaceFrom(target, c.pos), c.armor);
    }
  };

  {
    // test: 'attack reports use direction-specific damage tables only when hardcore enables them'
    const attacker = tankAt('attacker', 0, 1);
    const target = tankAt('target', 0, 0, 0);
    const map = fieldMap(0, 1);
    const classicReport = rollAttack({ attacker, target, map, expandedTurretDirections: true }, new RNG(12345));
    assert.strictEqual(classicReport.damageCheckType, undefined);
    const hardcoreReport = rollAttack({
      attacker,
      target,
      map,
      expandedTurretDirections: true,
      directionalDamageCheck: true,
    }, new RNG(12345));
    assert.strictEqual(hardcoreReport.damageCheckType, 'right');
  };

  {
    // test: 'hardcore table applies combined fire and crew effects to non-protagonist tanks'
    const attacker = tankAt('attacker', 1, -1);
    const target = tankAt('target', 0, 0, 0);
    target.crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
    target.hatchOpen = true;
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

    assert.strictEqual(report.damageCheckType, 'left');
    assert.deepStrictEqual(report.damageEffects?.map(e => e.effect), ['fire', 'crewCheck']);
    assert.strictEqual(report.damageEffects?.find(e => e.effect === 'crewCheck')?.crewSlot, 3);
    assert.strictEqual(target.fireLevel, 1);
    assert.strictEqual(target.crew!.gunner, false);
    assert.strictEqual(report.commanderKilledByHitDoubles, true);
    assert.strictEqual(target.crew!.commander, false);
    assert.strictEqual(target.hatchOpen, false);
    assert.ok(!(target.damaged));
  };

  {
    // test: 'hardcore burning non-protagonist tank is destroyed by the next penetration'
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

    assert.strictEqual(report.damageEffect, 'destroyed');
    assert.strictEqual(report.damageDie, undefined);
    assert.strictEqual(target.destroyed, true);
  };

  {
    // test: 'hardcore destroyed damage target class skips damage dice after penetration'
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

    assert.strictEqual(report.damageEffect, 'destroyed');
    assert.strictEqual(report.damageDie, undefined);
    assert.strictEqual(report.stagedDamageDie, undefined);
    assert.strictEqual(target.destroyed, true);
  };

  {
    // test: 'configured damage target class is ignored when the hardcore mode flag is off'
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

    assert.strictEqual(report.damageDie, 1);
    assert.strictEqual(report.damageEffect, 'fire');
    assert.ok(!(target.destroyed));
    assert.strictEqual(target.fireLevel, 1);
  };

  {
    // test: 'hardcore protagonist right-side crew priority skips dead gunner before commander'
    const attacker = tankAt('attacker', 0, 1);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'sherman';
    target.faction = 'usa';
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

    assert.strictEqual(report.damageCheckType, 'right');
    assert.strictEqual(report.stagedCrewCheck, undefined);
    assert.strictEqual(report.crewCheck, undefined);
    assert.strictEqual(report.damageEffects?.find(e => e.effect === 'crewCheck')?.crewSlot, 4);
    assert.strictEqual(target.crew!.driver, false);
    assert.strictEqual(target.crew!.commander, true);
  };

  {
    // test: 'hardcore protagonist rear damage prioritizes radio before immobilization and fire'
    const attacker = tankAt('attacker', -1, 0);
    const target = tankAt('target', 0, 0, 0);
    target.kind = 'sherman';
    target.faction = 'usa';
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
    assert.strictEqual(reportRadio.damageCheckType, 'rear');
    assert.strictEqual(target.radioDamaged, true);
    assert.ok(!(target.paralyzed));
    assert.strictEqual(target.fireLevel ?? 0, 0);

    const reportParalyzed = rollAttack(ctx, rngFrom(6, 6, 6, 6, 4));
    applyAttack(target, reportParalyzed);
    assert.strictEqual(target.paralyzed, true);
    assert.strictEqual(target.fireLevel ?? 0, 0);
  };

  {
    // test: 'fire check table profiles resolve classic Europe, classic Pacific, and hardcore outcomes'
    assert.strictEqual(fireCheckProfileFor('classic', 'europe'), 'classic_europe');
    assert.strictEqual(fireCheckProfileFor('classic', 'pacific'), 'classic_pacific');
    assert.strictEqual(fireCheckProfileFor('hardcore', 'europe'), 'hardcore');
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(die => resolveFireCheckEffect('classic_europe', die)), [
      'destroyed',
      'crewCheck',
      'fire',
      'fire',
      'turret',
      'paralyzed',
    ]);
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(die => resolveFireCheckEffect('classic_pacific', die)), [
      'destroyed',
      'crewCheck',
      'fire',
      'turret',
      'paralyzed',
      'none',
    ]);
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(die => resolveFireCheckEffect('hardcore', die)), [
      'destroyed',
      'crewCheck',
      'fire',
      'turret',
      'paralyzed',
      'none',
    ]);
    assert.strictEqual(resolveFireCheckLowest('classic_europe', [6, 5, 4, 3]).effect, 'fire');
    assert.strictEqual(resolveFireCheckLowest('classic_pacific', [6, 5, 4]).effect, 'turret');
  };

  {
    // test: 'halfway ray counts both bordering hedge paths, divides by two and floors'
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
    assert.strictEqual(map.countHedgesAlong({ q: 0, r: 0 }, { q: 3, r: 3 }), 2);
  };

  {
    // test: 'closed turret vision follows a selected halfway ray'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 1 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 3, r: 3 })), false);
  };

  {
    // test: 'closed halfway gunner sight fills one contiguous side through range five'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.previousTurretFacing = 0;
    unit.gunnerVisionRange = 5;
    const visible = computeUnitVisibleHexes(fieldMap(-1, 4), unit);

    for (const pos of [{ q: 1, r: 0 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 }, { q: 3, r: 2 }]) {
      assert.strictEqual(visible.has(HexMap.keyOf(pos)), true);
    }
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 2 })), false);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 3 })), false);
  };

  {
    // test: 'closed halfway gunner sight chooses the clear adjacent side'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.gunnerVisionRange = 5;
    const map = fieldMap(-1, 4);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 2 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 1 })), false);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), true);
  };

  {
    // test: 'closed halfway gunner sight uses the distance-three pair when adjacent sides are clear'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.gunnerVisionRange = 5;
    const map = fieldMap(-1, 4);
    map.set({ pos: { q: 2, r: 1 }, terrain: 'rocky' });

    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 2 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 1 })), false);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), true);
  };

  {
    // test: 'blockers on opposite side levels hide the distance-four center hex'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.gunnerVisionRange = 5;
    const map = fieldMap(-1, 4);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 1, r: 2 }, terrain: 'field', hasBuilding: true });

    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 1 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 2 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), false);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 3 })), false);
  };

  {
    // test: 'symmetric halfway sight prefers the side nearer the previous turret facing'
    const fromAxisZero = tankAt('attacker', 0, 0);
    fromAxisZero.turretFacing = 6;
    fromAxisZero.previousTurretFacing = 0;
    fromAxisZero.gunnerVisionRange = 5;
    const fromAxisOne = { ...fromAxisZero, previousTurretFacing: 1 as FireDirection };
    const map = fieldMap(-1, 4);

    const leftVisible = computeUnitVisibleHexes(map, fromAxisZero);
    const rightVisible = computeUnitVisibleHexes(map, fromAxisOne);
    assert.strictEqual(leftVisible.has(HexMap.keyOf({ q: 2, r: 1 })), true);
    assert.strictEqual(leftVisible.has(HexMap.keyOf({ q: 1, r: 2 })), false);
    assert.strictEqual(rightVisible.has(HexMap.keyOf({ q: 2, r: 1 })), false);
    assert.strictEqual(rightVisible.has(HexMap.keyOf({ q: 1, r: 2 })), true);
  };

  {
    // test: 'closed turret halfway fog ignores a single flanking blocker'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });

    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 1 })), true);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), true);
  };

  {
    // test: 'closed turret halfway fog requires both flanking blockers to stop vision'
    const unit = tankAt('attacker', 0, 0);
    unit.turretFacing = 6;
    unit.visionRange = 4;
    const map = fieldMap(-1, 3);
    map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
    map.set({ pos: { q: 0, r: 1 }, terrain: 'forest' });

    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 1, r: 1 })), false);
    assert.strictEqual(visible.has(HexMap.keyOf({ q: 2, r: 2 })), false);
  };
};

{
// group: '战争迷雾玩家视野'
  {
    // test: '经典与硬核模式启用各自规则差异'
    assert.strictEqual(fogOfWarEnabled('classic'), false);
    assert.strictEqual(fogOfWarEnabled('hardcore'), true);
    assert.strictEqual(getGameModeConfig('classic').aiMainGunFallbackToMG, false);
    assert.strictEqual(getGameModeConfig('hardcore').aiMainGunFallbackToMG, true);
    assert.strictEqual(getGameModeConfig('classic').precisionFire, false);
    assert.strictEqual(getGameModeConfig('hardcore').precisionFire, true);
    assert.strictEqual(getGameModeConfig('classic').commanderBonusWithoutOpenHatch, false);
    assert.strictEqual(getGameModeConfig('hardcore').commanderBonusWithoutOpenHatch, true);
    assert.strictEqual(getGameModeConfig('classic').miscCloseHatchWithDoubles, false);
    assert.strictEqual(getGameModeConfig('hardcore').miscCloseHatchWithDoubles, true);
    assert.strictEqual(getGameModeConfig('classic').effectiveRangePenetration, false);
    assert.strictEqual(getGameModeConfig('hardcore').effectiveRangePenetration, true);
    assert.strictEqual(getGameModeConfig('classic').directionalDamageCheck, false);
    assert.strictEqual(getGameModeConfig('hardcore').directionalDamageCheck, true);
    assert.strictEqual(getGameModeConfig('classic').unitDamageTargetClass, false);
    assert.strictEqual(getGameModeConfig('hardcore').unitDamageTargetClass, true);
    assert.strictEqual(getGameModeConfig('classic').radioVisionSharing, false);
    assert.strictEqual(getGameModeConfig('hardcore').radioVisionSharing, true);
  };

  {
    // test: '硬核车长关舱时仅为移动和攻击阶段提供额外骰'
    const crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
    const hardcoreBonus = getGameModeConfig('hardcore').commanderBonusWithoutOpenHatch;
    assert.strictEqual(actionDicePool({ subPhase: 'movement', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus }), 5);
    assert.strictEqual(actionDicePool({ subPhase: 'attack', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus }), 5);
    assert.strictEqual(actionDicePool({ subPhase: 'misc', terrain: 'road', hatchOpen: false, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus }), 1);
    assert.strictEqual(actionDicePool({ subPhase: 'misc', terrain: 'road', hatchOpen: true, crew,
      commanderBonusWithoutOpenHatch: hardcoreBonus }), 2);
  };

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
    faction: 'usa',
    pos: offsetToAxial({ col, row }),
    facing,
    stats: {} as Unit['stats'],
    hatchOpen,
    visionRange: 4,
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  });

  {
    // test: 'hardcore AI tanks only open a commander hatch when their faction has none open, unless on fire'
    const protagonist = shermanAt(2, 2, 0, false);
    const ally = { ...shermanAt(3, 2, 0, false), id: 'ally', kind: 'sherman76' as const };
    const enemy = { ...shermanAt(4, 2, 0, false), id: 'enemy', kind: 'panzer4' as const, faction: 'german' as const };

    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(ally, [protagonist, ally, enemy], protagonist, 'classic'), false);
    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(ally, [protagonist, ally, enemy], protagonist, 'hardcore'), true);

    protagonist.hatchOpen = true;
    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(ally, [protagonist, ally, enemy], protagonist, 'hardcore'), false);

    ally.fireLevel = 1;
    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(ally, [protagonist, ally, enemy], protagonist, 'hardcore'), true);

    ally.crew!.commander = false;
    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(ally, [protagonist, ally, enemy], protagonist, 'hardcore'), false);
  };

  {
    // test: '精确射击只在最终命中阈值上应用 -2'
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
    assert.strictEqual(precision, normal - 2);
  };

  {
    // test: 'rain weather increases hit threshold by one'
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
    const clear = hitThreshold({ attacker, target, map });
    const rain = hitThreshold({ attacker, target, map, weather: 'rain' });
    assert.strictEqual(rain, clear + 1);
  };

  {
    // test: '关舱：六个相邻格可见，远处仅沿炮塔方向形成射线'
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 3, 0, false);
    sherman.turretFacing = 1;
    const blocker = neighbor(sherman.pos, 1);
    const behind = neighbor(blocker, 1);
    const bodyForward2 = neighbor(neighbor(sherman.pos, 0), 0);
    map.set({ pos: blocker, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    assert.strictEqual(visible.has(HexMap.keyOf(blocker)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(behind)), false);
    assert.strictEqual(visible.has(HexMap.keyOf(bodyForward2)), false);
    for (let direction = 0; direction < 6; direction++) {
      assert.strictEqual(visible.has(HexMap.keyOf(neighbor(sherman.pos, direction as Direction))), true);
    }
  };

  {
    // test: '开舱：半径四格无遮挡目标可见，五格非正前方目标不可见'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(4, 4, 0, true);
    const visible = computePlayerVisibleHexes(map, sherman);
    const radius4 = { q: sherman.pos.q + 2, r: sherman.pos.r + 2 };
    const radius5 = { q: sherman.pos.q + 2, r: sherman.pos.r + 3 };
    assert.strictEqual(hexDistance(sherman.pos, radius4), 4);
    assert.strictEqual(hexDistance(sherman.pos, radius5), 5);
    assert.strictEqual(visible.has(HexMap.keyOf(radius4)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(radius5)), false);
  };

  {
    // test: '开舱：夹角方向半径视野忽略单侧阻挡格'
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 2, 0, true);
    const blocker = { q: sherman.pos.q + 1, r: sherman.pos.r };
    const target = { q: sherman.pos.q + 1, r: sherman.pos.r + 1 };
    map.set({ pos: blocker, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    assert.strictEqual(visible.has(HexMap.keyOf(target)), true);
  };

  {
    // test: '开舱：夹角方向半径视野需要两侧阻挡格同时存在才遮挡'
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(2, 2, 0, true);
    const blockerA = { q: sherman.pos.q + 1, r: sherman.pos.r };
    const blockerB = { q: sherman.pos.q, r: sherman.pos.r + 1 };
    const target = { q: sherman.pos.q + 1, r: sherman.pos.r + 1 };
    map.set({ pos: blockerA, terrain: 'forest' });
    map.set({ pos: blockerB, terrain: 'forest' });

    const visible = computePlayerVisibleHexes(map, sherman);
    assert.strictEqual(visible.has(HexMap.keyOf(target)), false);
  };

  {
    // test: '当前视野属性同时限制开舱半径与正前方直线'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(3, 4, 0, true);
    sherman.visionRange = 2;
    const forward2 = neighbor(neighbor(sherman.pos, 0), 0);
    const forward3 = neighbor(forward2, 0);
    const offAxis3 = { q: sherman.pos.q, r: sherman.pos.r + 3 };
    const visible = computePlayerVisibleHexes(map, sherman);

    assert.strictEqual(currentVisionRange(sherman), 2);
    assert.strictEqual(visible.has(HexMap.keyOf(forward2)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(forward3)), false);
    assert.strictEqual(visible.has(HexMap.keyOf(offAxis3)), false);
  };

  {
    // test: 'rain weather reduces vision with closed-hatch minimum one'
    const open = shermanAt(3, 4, 0, true);
    open.visionRange = 4;
    assert.strictEqual(currentVisionRange(open, 'rain'), 3);

    const closed = shermanAt(3, 4, 0, false);
    closed.visionRange = 1;
    assert.strictEqual(currentVisionRange(closed, 'rain'), 1);
  };

  {
    // test: '关舱时炮塔方向视野不得超过当前视野属性'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(3, 4, 0, false);
    sherman.turretFacing = 1;
    sherman.visionRange = 2;
    const turret2 = neighbor(neighbor(sherman.pos, 1), 1);
    const turret3 = neighbor(turret2, 1);
    const bodyForward2 = neighbor(neighbor(sherman.pos, 0), 0);
    const visible = computePlayerVisibleHexes(map, sherman);

    assert.strictEqual(visible.has(HexMap.keyOf(turret2)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(turret3)), false);
    assert.strictEqual(visible.has(HexMap.keyOf(bodyForward2)), false);
  };

  {
    // test: 'own vision range blocks turret vision turn beyond configured distance'
    const unit = shermanAt(0, 0, 0, false);
    unit.stats = { ...unit.stats, visionType: 'turreted', visionRange: 4 };
    unit.visionRange = undefined;
    const inRange = shermanAt(4, 0, 3, false);
    const outOfRange = shermanAt(5, 0, 3, false);

    assert.strictEqual(isWithinOwnVisionRange(unit, inRange), true);
    assert.strictEqual(isWithinOwnVisionRange(unit, outOfRange), false);
  };

  {
    // test: '中心点几何连线：{4,1} 建筑遮挡 {2,3} 到 {5,0}/{6,0}'
    const map = new HexMap(8, 6);
    addRect(map, 8, 6);
    const from = offsetToAxial({ col: 2, row: 3 });
    const building = offsetToAxial({ col: 4, row: 1 });
    const targetA = offsetToAxial({ col: 5, row: 0 });
    const targetB = offsetToAxial({ col: 6, row: 0 });
    map.set({ pos: building, terrain: 'field', hasBuilding: true });

    assert.strictEqual(hasFogLineOfSight(map, from, building), true);
    assert.strictEqual(hasFogLineOfSight(map, from, targetA), false);
    assert.strictEqual(hasFogLineOfSight(map, from, targetB), false);
  };

  {
    // test: '车长阵亡时即使 hatchOpen=true 也按关舱视野计算'
    const map = new HexMap(7, 7);
    addRect(map, 7, 7);
    const sherman = shermanAt(3, 3, 0, true);
    sherman.crew!.commander = false;
    const rearAdjacent = neighbor(sherman.pos, 2);
    const rearDistance2 = neighbor(neighbor(sherman.pos, 2), 2);
    const visible = computePlayerVisibleHexes(map, sherman);
    assert.strictEqual(visible.has(HexMap.keyOf(rearAdjacent)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(rearDistance2)), false);
  };

  {
    // test: '有炮塔单位：周围一格可见，远处只沿炮塔方向看到配置距离'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.stats = { ...unit.stats, visionType: 'turreted', visionRange: 4 };
    unit.turretFacing = 1;
    unit.visionRange = undefined;
    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(unit.pos, 2))), true);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 2), 2))), false);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 1), 1))), true);
  };

  {
    // test: '无炮塔单位：只沿车体朝向看到配置距离'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.stats = { ...unit.stats, visionType: 'fixed', visionRange: 4 };
    unit.visionRange = undefined;
    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(unit.pos, 0))), true);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(unit.pos, 1))), false);
  };

  {
    // test: '步兵单位：不依赖朝向，视野固定为周围两格'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const unit = shermanAt(4, 4, 0, false);
    unit.facing = null;
    unit.stats = { ...unit.stats, visionType: 'infantry', visionRange: 4 };
    const visible = computeUnitVisibleHexes(map, unit);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(neighbor(unit.pos, 2), 2))), true);
    assert.strictEqual(visible.has(HexMap.keyOf(neighbor(neighbor(neighbor(unit.pos, 2), 2), 2))), false);
  };

  {
    // test: '玩家只获得存活队友所在格，不获得队友周围或朝向视野'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(1, 4, 0, false);
    sherman.visionRange = 1;
    const ally = shermanAt(6, 4, 1, false);
    ally.id = 'ally';
    ally.turretFacing = 1;
    const allyForward = neighbor(ally.pos, 1);
    const visible = computePlayerVisibleHexes(map, sherman, [ally]);

    assert.strictEqual(visible.has(HexMap.keyOf(ally.pos)), true);
    assert.strictEqual(visible.has(HexMap.keyOf(allyForward)), false);
    ally.destroyed = true;
    assert.strictEqual(computePlayerVisibleHexes(map, sherman, [ally]).has(HexMap.keyOf(ally.pos)), false);
  };

  {
    // test: 'hardcore radio shares friendly transmitter vision'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const sherman = shermanAt(1, 4, 0, false);
    sherman.visionRange = 1;
    const ally = shermanAt(6, 4, 1, false);
    ally.id = 'ally';
    ally.turretFacing = 1;
    const allyForward = neighbor(ally.pos, 1);

    assert.strictEqual(computePlayerVisibleHexes(map, sherman, [ally]).has(HexMap.keyOf(allyForward)), false);
    assert.strictEqual(computePlayerVisibleHexes(map, sherman, [ally], true).has(HexMap.keyOf(allyForward)), true);
  };

  {
    // test: 'tank radio receive only requires intact radio while transmit requires commander'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const receiver = shermanAt(1, 4, 0, false);
    const sender = shermanAt(6, 4, 1, false);
    sender.id = 'sender';
    sender.turretFacing = 1;
    const senderForward = neighbor(sender.pos, 1);

    assert.strictEqual(hasRadioReceive(receiver), true);
    assert.strictEqual(hasRadioTransmit(sender), true);
    assert.strictEqual(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward)), true);

    receiver.crew!.coDriver = false;
    assert.strictEqual(hasRadioReceive(receiver), true);
    assert.strictEqual(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward)), true);

    sender.crew!.commander = false;
    assert.strictEqual(hasRadioTransmit(sender), false);
    assert.strictEqual(computeRadioSharedVisibleHexes(map, receiver, [sender]).has(HexMap.keyOf(senderForward)), false);
  };

  {
    // test: 'non-tank intact radio can both receive and transmit'
    const infantry = shermanAt(4, 4, 0, false);
    infantry.kind = 'infantry';
    infantry.facing = null;
    infantry.crew = undefined;
    infantry.stats = { ...infantry.stats, visionType: 'infantry', visionRange: 2 };

    assert.strictEqual(hasRadioReceive(infantry), true);
    assert.strictEqual(hasRadioTransmit(infantry), true);
    infantry.radioDamaged = true;
    assert.strictEqual(hasRadioReceive(infantry), false);
    assert.strictEqual(hasRadioTransmit(infantry), false);
  };

  {
    // test: 'non-radio infantry shares sight only with a friendly tank in the same hex'
    const map = new HexMap(9, 9);
    addRect(map, 9, 9);
    const receiver = shermanAt(2, 4, 0, false);
    receiver.visionRange = 1;
    const infantry = shermanAt(2, 4, 0, false);
    infantry.id = 'soviet_infantry';
    infantry.kind = 'soviet_infantry';
    infantry.faction = 'soviet';
    infantry.facing = null;
    infantry.crew = undefined;
    infantry.stats = { ...infantry.stats, hasRadio: false, visionType: 'infantry', visionRange: 2 };
    const infantrySight = neighbor(neighbor(receiver.pos, 2), 2);
    const remoteTank = shermanAt(7, 4, 0, false);
    remoteTank.id = 'remote';

    assert.strictEqual(computeRadioSharedVisibleHexes(map, receiver, [infantry]).has(HexMap.keyOf(infantrySight)), true);
    assert.strictEqual(computeRadioSharedVisibleHexes(map, remoteTank, [receiver, infantry]).has(HexMap.keyOf(infantrySight)), false);
  };
};

{
// group: 'GDD §3.2 桥梁规则'
  {
    // test: 'tileHasBridge：仅水域 + 配置 bridgeEnds 才算桥梁'
    assert.strictEqual(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'water' }), false);
    assert.strictEqual(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] }), true);
    // 公路 / 田地等基底就算误填 bridgeEnds 也不算桥梁（MissionLoader 会先抛错，这里只是 helper 兜底）
    assert.strictEqual(tileHasBridge({ pos: { q: 0, r: 0 }, terrain: 'road', bridgeEnds: [0, 3] } as never), false);
  };

  {
    // test: 'effectiveDiceTerrain：水域+桥梁 → road；其他原样'
    assert.strictEqual(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] }), 'road');
    assert.strictEqual(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'water' }), 'water');
    assert.strictEqual(effectiveDiceTerrain({ pos: { q: 0, r: 0 }, terrain: 'mud' }), 'mud');
  };

  {
    // test: 'tileMoveCost：桥梁 cost 同公路（=1，水域=Infinity）'
    assert.strictEqual(terrainMoveCost('water'), Infinity);
    assert.strictEqual(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'water' }), Infinity);
    assert.strictEqual(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] }), 1);
    assert.strictEqual(tileMoveCost({ pos: { q: 0, r: 0 }, terrain: 'road' }), 1);
  };

  {
    // test: 'canTankEnter：水域不可入；水域+桥梁可入'
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    assert.strictEqual(map.canTankEnter({ q: 0, r: 0 }), false);
    assert.strictEqual(map.canTankEnter({ q: 1, r: 0 }), true);
  };

  {
    // test: 'canTankCrossEdge：邻格 → 桥梁，进入方向必须命中桥端'
    // (0,0)=field, (1,0)=water+bridge[0=E, 3=W]
    // 从 (0,0) 进入 (1,0)：dir(B→A) = 3 (W) ∈ [0,3] → 允许
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), true);
  };

  {
    // test: 'canTankCrossEdge：邻格 → 桥梁，方向不在桥端 → 拒绝'
    // 桥梁两端 [1=SE, 4=NW]：从 W 邻居 (0,0) 进入 (1,0)，dir(B→A)=3 不在端内 → 拒绝
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [1, 4] });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), false);
  };

  {
    // test: 'canTankCrossEdge：桥梁 → 邻格，出方向必须命中桥端'
    // (0,0)=water+bridge[0=E, 3=W], (1,0)=field
    // 从 (0,0) 出向 (1,0)：dir(A→B)=0 ∈ [0,3] → 允许
    const map = new HexMap(2, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), true);
    // 反之试一个不在端内的方向（向 SE 邻居走）：场上没那格 → 不可入兜底
    map.set({ pos: { q: 0, r: 1 }, terrain: 'field' });
    assert.strictEqual(directionTo({ q: 0, r: 0 }, { q: 0, r: 1 }), 1);
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 0, r: 1 }), false);
  };

  {
    // test: 'canTankCrossEdge：相邻两座桥相连 → 两端方向必须同时对齐'
    // (0,0)=water+bridge[0,3], (1,0)=water+bridge[0,3] —— 两座桥沿 E-W 轴相连，物理边方向 0/3 双侧都覆盖
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), true);

    // (1,0) 改为 [1,4]：物理边 0/3 不在 (1,0) 桥端内 → 拒绝
    map.set({ pos: { q: 1, r: 0 }, terrain: 'water', bridgeEnds: [1, 4] });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), false);
  };

  {
    // test: 'canTankCrossEdge：非桥梁场景退化为 canTankEnter（不会误拒）'
    const map = new HexMap(3, 1);
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'road' });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'forest' });
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 1, r: 0 }), true);
    assert.strictEqual(map.canTankCrossEdge({ q: 0, r: 0 }, { q: 2, r: 0 }), false); // 距离 = 2，越界
    assert.strictEqual(map.canTankCrossEdge({ q: 1, r: 0 }, { q: 2, r: 0 }), false); // 林地拒入
  };
};
