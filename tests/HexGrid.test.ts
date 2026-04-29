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
  hexDistance,
  hexLine,
  neighbor,
  offsetToAxial,
  rotateDirection,
} from '../assets/scripts/core/HexGrid';
import { Direction, effectiveDiceTerrain, tileHasBridge } from '../assets/scripts/core/types';
import { terrainMoveCost, tileMoveCost } from '../assets/scripts/core/MoveCost';

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
