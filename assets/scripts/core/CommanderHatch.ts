import { GameMode } from './GameMode';
import { commanderHasSkill } from './UnitLevel';
import { isSameSide, isTankUnit, Unit } from './types';
import {
  EMPTY_COMMANDER_HATCH_SPRITE_SIZE, SHERMAN_EMPTY_COMMANDER_HATCH_SCALE,
  splitTankVisualConfigOf, TankVisualConfig,
} from './TankVisualDB';

/** An invisible, fixed turret uses the complete body image as its source space. */
export function fixedTankCommanderHatchTransform(
  config: Pick<TankVisualConfig, 'commanderHatchSpriteX' | 'commanderHatchSpriteY' | 'commanderHatchScale'>,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  bodyAngle: number,
  empty: boolean,
): { x: number; y: number; size: number; angle: number } {
  const localX = (config.commanderHatchSpriteX - width / 2) * scaleX;
  const localY = (height / 2 - config.commanderHatchSpriteY) * scaleY;
  const occupiedSize = config.commanderHatchScale * Math.sqrt(scaleX * scaleY);
  const emptyRatio = EMPTY_COMMANDER_HATCH_SPRITE_SIZE * SHERMAN_EMPTY_COMMANDER_HATCH_SCALE
    / (splitTankVisualConfigOf('sherman').commanderHatchScale || 1);
  return {
    x: localX * Math.cos(bodyAngle) - localY * Math.sin(bodyAngle),
    y: localX * Math.sin(bodyAngle) + localY * Math.cos(bodyAngle),
    size: occupiedSize * (empty ? emptyRatio : 1),
    angle: bodyAngle * 180 / Math.PI - 90,
  };
}

export type CommanderHatchVisualState = 'hidden' | 'occupied' | 'empty';

/**
 * Visual-only hatch state. An open hatch remains visible after the commander
 * dies, but uses the empty-hatch sprite instead of the occupied commander art.
 */
export function commanderHatchVisualState(unit: Unit): CommanderHatchVisualState {
  if (unit.destroyed || !isTankUnit(unit) || unit.hatchOpen !== true) return 'hidden';
  return unit.crew?.commander === false ? 'empty' : 'occupied';
}

/**
 * “开舱观察”是非玩家车长主动开舱的前置技能。
 * 关卡可显式授予该技能；未单独配置乘员等级的非玩家坦克，则由整车等级
 * 决定默认技能：老兵与王牌车长拥有，新兵车长不拥有。
 */
export function hasOpenHatchObservationSkill(unit: Unit): boolean {
  return commanderHasSkill(unit, 'open_hatch_observation');
}

/**
 * Hardcore AI tank hatch rule. Only the protagonist may be controlled by the
 * player, so every other living tank decides its hatch state at action start.
 * An existing open hatch on a destroyed tank or a tank whose commander is
 * dead does not reserve the faction's living commander slot.
 */
export function shouldNonPlayerTankOpenCommanderHatch(
  unit: Unit,
  allUnits: readonly Unit[],
  protagonist: Unit,
  mode: GameMode,
): boolean {
  if (mode !== 'hardcore' || unit === protagonist || unit.destroyed || !isTankUnit(unit)
    || !hasOpenHatchObservationSkill(unit)) {
    return false;
  }

  if ((unit.fireLevel ?? 0) > 0) return true;

  return !allUnits.some(other =>
    other !== unit
    && !other.destroyed
    && isSameSide(other, unit)
    && isTankUnit(other)
    && other.crew?.commander !== false
    && other.hatchOpen === true,
  );
}
