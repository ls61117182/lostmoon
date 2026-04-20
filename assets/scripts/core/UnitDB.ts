/**
 * 单位数据库 —— 所有单位的基础属性都在这里集中维护。
 * 数值来源：《孤胆谢尔曼》说明书 P5。
 */

import { UnitKind, UnitStats } from './types';

const DB: Record<UnitKind, UnitStats> = {
  sherman: {
    size: 4,
    armorFront: 6,
    armorFrontSide: 6,
    armorRearSide: 5,
    armorRear: 5,
    penetration: 4,
  },
  tiger: {
    size: 5,
    armorFront: 8,
    armorFrontSide: 6,
    armorRearSide: 5,
    armorRear: 5,
    penetration: 6,
  },
  panzer4: {
    size: 4,
    armorFront: 7,
    armorFrontSide: 5,
    armorRearSide: 5,
    armorRear: 4,
    penetration: 4,
  },
  panzer3: {
    size: 4,
    armorFront: 6,
    armorFrontSide: 5,
    armorRearSide: 5,
    armorRear: 4,
    penetration: 4,
  },
  // 卡车 / 步兵：本表占位，实际战斗按特殊规则结算
  truck: {
    size: 4,
    armorFront: 0,
    armorFrontSide: 0,
    armorRearSide: 0,
    armorRear: 0,
    penetration: 0,
  },
  infantry: {
    size: 0,
    armorFront: 0,
    armorFrontSide: 0,
    armorRearSide: 0,
    armorRear: 0,
    penetration: 1,  // 回合结束事件中相邻步兵攻击穿甲值 1
  },
};

export function getUnitStats(kind: UnitKind): UnitStats {
  return { ...DB[kind] };
}
