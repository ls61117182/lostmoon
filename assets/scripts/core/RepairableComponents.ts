import { GameMode } from './GameMode';
import { Unit } from './types';

export type RepairableComponentId = 'turret' | 'mobility' | 'radio';

export interface RepairableComponent {
  id: RepairableComponentId;
  actionKey: string;
  floaterKey: string;
  battleLogKey: string;
  statusIntactKey?: string;
  statusDamagedKey: string;
  playerAvailable: (mode: GameMode) => boolean;
  isDamaged: (unit: Unit) => boolean;
  repair: (unit: Unit) => void;
}

export const REPAIRABLE_COMPONENT_IDS: RepairableComponentId[] = ['turret', 'mobility', 'radio'];

export const REPAIRABLE_COMPONENTS: readonly RepairableComponent[] = [
  {
    id: 'turret',
    actionKey: 'action.repairTurret',
    floaterKey: 'floater.turretFixed',
    battleLogKey: 'battleLog.misc.repairTurret',
    statusDamagedKey: 'tileInspect.status.turretDamaged',
    playerAvailable: () => true,
    isDamaged: (unit) => !!unit.turretDamaged,
    repair: (unit) => { unit.turretDamaged = false; },
  },
  {
    id: 'mobility',
    actionKey: 'action.repairMobility',
    floaterKey: 'floater.mobilityFixed',
    battleLogKey: 'battleLog.misc.repairMobility',
    statusDamagedKey: 'tileInspect.status.paralyzed',
    playerAvailable: () => true,
    isDamaged: (unit) => !!unit.paralyzed,
    repair: (unit) => { unit.paralyzed = false; },
  },
  {
    id: 'radio',
    actionKey: 'action.repairRadio',
    floaterKey: 'floater.radioFixed',
    battleLogKey: 'battleLog.misc.repairRadio',
    statusIntactKey: 'tileInspect.status.radioIntact',
    statusDamagedKey: 'tileInspect.status.radioDamaged',
    playerAvailable: (mode) => mode === 'hardcore',
    isDamaged: (unit) => !!unit.radioDamaged,
    repair: (unit) => { unit.radioDamaged = false; },
  },
];

export function repairableComponentsFor(mode: GameMode): readonly RepairableComponent[] {
  return REPAIRABLE_COMPONENTS.filter((component) => component.playerAvailable(mode));
}

export function repairableComponentById(id: RepairableComponentId): RepairableComponent {
  return REPAIRABLE_COMPONENTS.find((component) => component.id === id)!;
}

export function firstDamagedRepairableComponent(unit: Unit): RepairableComponent | null {
  return REPAIRABLE_COMPONENTS.find((component) => component.isDamaged(unit)) ?? null;
}
