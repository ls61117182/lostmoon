/**
 * 单位数据库 —— 自动生成，请勿手改本文件。
 *
 * 数据源：data/units.csv （数值策划用 Excel 维护）
 * 重新生成：node tools/buildUnitDB.js
 */

import { UnitKind, UnitStats } from './types';

const DB: Record<UnitKind, UnitStats> = {
  sherman: { // 谢尔曼 M4 - 玩家方坦克
    size: 4, armorFront: 6, armorFrontSide: 6, armorRearSide: 5, armorRear: 5, penetration: 4,
  },
  tiger: { // 虎式 - 重型敌方坦克
    size: 5, armorFront: 8, armorFrontSide: 6, armorRearSide: 5, armorRear: 5, penetration: 6,
  },
  panzer4: { // 四号坦克 - 中坚敌方坦克
    size: 4, armorFront: 7, armorFrontSide: 5, armorRearSide: 5, armorRear: 4, penetration: 4,
  },
  panzer3: { // 三号坦克 - 次级敌方坦克
    size: 4, armorFront: 6, armorFrontSide: 5, armorRearSide: 5, armorRear: 4, penetration: 4,
  },
  truck: { // 卡车 - 占位 - 后续按特殊规则结算
    size: 4, armorFront: 0, armorFrontSide: 0, armorRearSide: 0, armorRear: 0, penetration: 0,
  },
  infantry: { // 步兵 - 占位 - 仅事件中作为攻击方
    size: 0, armorFront: 0, armorFrontSide: 0, armorRearSide: 0, armorRear: 0, penetration: 1,
  },
};

export function getUnitStats(kind: UnitKind): UnitStats {
  return { ...DB[kind] };
}
