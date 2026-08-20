import type { Axial, Unit } from './types';
import { isFriendlyFaction } from './types';

export type BattleSide = 'friendly' | 'enemy';
export type LastEnemyAttackBySide = Partial<Record<BattleSide, Axial>>;

export interface AttackPositionMemory {
  /** 本回合中，各阵营观察到的敌方最后攻击位置。 */
  currentTurn: LastEnemyAttackBySide;
  /** 上一完整回合中，各阵营观察到的敌方最后攻击位置。 */
  previousTurn: LastEnemyAttackBySide;
}

export function battleSideOf(unit: Pick<Unit, 'faction'>): BattleSide {
  return isFriendlyFaction(unit.faction) ? 'friendly' : 'enemy';
}

export function createAttackPositionMemory(): AttackPositionMemory {
  return { currentTurn: {}, previousTurn: {} };
}

function clonePosition(value: unknown): Axial | undefined {
  const pos = value as Partial<Axial> | undefined;
  return typeof pos?.q === 'number' && Number.isFinite(pos.q)
    && typeof pos.r === 'number' && Number.isFinite(pos.r)
    ? { q: pos.q, r: pos.r }
    : undefined;
}

function cloneSidePositions(value: unknown): LastEnemyAttackBySide {
  const source = value as LastEnemyAttackBySide | undefined;
  const friendly = clonePosition(source?.friendly);
  const enemy = clonePosition(source?.enemy);
  return {
    ...(friendly ? { friendly } : {}),
    ...(enemy ? { enemy } : {}),
  };
}

export function cloneAttackPositionMemory(value?: Partial<AttackPositionMemory>): AttackPositionMemory {
  return {
    currentTurn: cloneSidePositions(value?.currentTurn),
    previousTurn: cloneSidePositions(value?.previousTurn),
  };
}

/** 一次实际攻击会更新敌对阵营所记忆的攻击者当时位置。 */
export function recordAttackPosition(memory: AttackPositionMemory, attacker: Pick<Unit, 'faction' | 'pos'>): void {
  const observerSide: BattleSide = battleSideOf(attacker) === 'friendly' ? 'enemy' : 'friendly';
  memory.currentTurn[observerSide] = { ...attacker.pos };
}

/** 完整回合结束：本回合记录成为上回合记录，新的本回合从空白开始。 */
export function advanceAttackPositionMemory(memory: AttackPositionMemory): void {
  memory.previousTurn = cloneSidePositions(memory.currentTurn);
  memory.currentTurn = {};
}

export function previousEnemyAttackPosition(
  memory: AttackPositionMemory,
  observer: Pick<Unit, 'faction'>,
): Axial | undefined {
  const pos = memory.previousTurn[battleSideOf(observer)];
  return pos ? { ...pos } : undefined;
}
