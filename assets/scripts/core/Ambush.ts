import type { GameMode } from './GameMode';
import type { CrewSkillId, ShermanCrew, Unit } from './types';
import { isFootUnit } from './types';

/** 只有存活乘员携带的技能才对车组生效。 */
export function hasLivingCrewSkill(
  unit: Pick<Unit, 'crew' | 'crewSkills'>,
  skill: CrewSkillId,
): boolean {
  if (!unit.crewSkills) return false;
  for (const slot of Object.keys(unit.crewSkills) as Array<keyof ShermanCrew>) {
    if (unit.crew?.[slot] === false) continue;
    if (unit.crewSkills[slot]?.includes(skill)) return true;
  }
  return false;
}

/** 在单位自己的行动开始时锁定本回合资格。 */
export function beginAmbushTurn(unit: Unit, mode: GameMode): void {
  unit.ambushActedThisTurn = false;
  unit.ambushReadyThisTurn = mode === 'hardcore'
    && !isFootUnit(unit)
    && (!unit.ambushAttackedSinceTurnEnd || hasLivingCrewSkill(unit, 'calm'));
}

/** 自身行动结束后开启下一次伏击的“未受攻击”观察窗口。 */
export function endAmbushTurn(unit: Unit): void {
  unit.ambushAttackedSinceTurnEnd = false;
  unit.ambushReadyThisTurn = false;
  unit.ambushActedThisTurn = false;
}

/** 成为炮击或机枪攻击的目标即算受到攻击，不要求命中。 */
export function markAmbushTargeted(unit: Unit): void {
  unit.ambushAttackedSinceTurnEnd = true;
}

/** 攻击、机枪扫射、移动或转向均取消本回合后续伏击。 */
export function markAmbushAction(unit: Unit): void {
  unit.ambushActedThisTurn = true;
}

export type AmbushAttackKind = 'main_gun' | 'machine_gun';

/** 伏击只修正主炮命中；机枪虽会取消伏击，但永远不会获得该命中加成。 */
export function ambushHitThresholdModifier(
  unit: Unit,
  mode: GameMode,
  attackKind: AmbushAttackKind = 'main_gun',
): number {
  if (attackKind !== 'main_gun') return 0;
  if (mode !== 'hardcore' || isFootUnit(unit)) return 0;
  if (!unit.ambushReadyThisTurn || unit.ambushActedThisTurn) return 0;
  return hasLivingCrewSkill(unit, 'ambush_master') ? -2 : -1;
}

/** 将基础伏击与“伏击大师”拆成两条 UI 明细。 */
export function ambushHitThresholdModifierDetails(
  unit: Unit,
  mode: GameMode,
  attackKind: AmbushAttackKind = 'main_gun',
): Array<{ labelKey: string; value: number }> {
  if (ambushHitThresholdModifier(unit, mode, attackKind) === 0) return [];
  const details = [{ labelKey: 'dice.rule.ambush', value: -1 }];
  if (hasLivingCrewSkill(unit, 'ambush_master')) {
    details.push({ labelKey: 'crew.skill.ambushMaster.name', value: -1 });
  }
  return details;
}
