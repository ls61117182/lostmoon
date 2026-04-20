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
import { Direction } from '../assets/scripts/core/types';

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

  test('countHedgesAlong 统计沿途树篱', () => {
    const map = new HexMap(3, 1);
    map.set({
      pos: { q: 0, r: 0 },
      terrain: 'field',
      hedges: [true, false, false, false, false, false],
    });
    map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
    map.set({ pos: { q: 2, r: 0 }, terrain: 'field' });
    expect(map.countHedgesAlong({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(1);
  });
});
