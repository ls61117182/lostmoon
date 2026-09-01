import type { ActionDiceSubPhase } from './ActionDice';
import {
  CAMPAIGN_UPGRADE_BY_ID,
  CAMPAIGN_UPGRADES,
  CampaignUpgradeDefinition,
  CampaignUpgradeId,
} from './CampaignUpgradeDB';
import type { RNG } from './Dice';
import { resolvedLoadedShell } from './types';
import type { ShellType, TerrainType, Unit } from './types';

export const HVAP_AMMO_CAPACITY = 2;

/** Load a hardcore shell while keeping the finite HVAP reserve in sync with the chamber. */
export function loadCampaignShell(sherman: Unit, nextShell: ShellType): boolean {
  const currentShell = resolvedLoadedShell(sherman);
  if (currentShell === nextShell) return true;
  if (nextShell === 'hvap') {
    const remaining = sherman.hvapAmmoRemaining ?? 0;
    if (remaining <= 0) return false;
    sherman.hvapAmmoRemaining = remaining - 1;
  } else if (currentShell === 'hvap') {
    sherman.hvapAmmoRemaining = Math.min(HVAP_AMMO_CAPACITY, (sherman.hvapAmmoRemaining ?? 0) + 1);
  }
  sherman.loaded = true;
  sherman.loadedShell = nextShell;
  return true;
}

export type { CampaignUpgradeDefinition, CampaignUpgradeId } from './CampaignUpgradeDB';

export function campaignUpgradeDefinition(id: CampaignUpgradeId): CampaignUpgradeDefinition {
  return CAMPAIGN_UPGRADE_BY_ID[id];
}

export function hasCampaignUpgrade(ids: readonly CampaignUpgradeId[], id: CampaignUpgradeId): boolean {
  return ids.includes(id);
}

export function drawCampaignUpgradeCandidates(
  rng: RNG,
  acquired: readonly CampaignUpgradeId[],
  count = 3,
): CampaignUpgradeId[] {
  const acquiredSet = new Set(acquired);
  const pool = CAMPAIGN_UPGRADES.map(def => def.id).filter(id => !acquiredSet.has(id));
  const out: CampaignUpgradeId[] = [];
  while (pool.length > 0 && out.length < count) {
    const index = Math.floor(rng.next() * pool.length);
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

export function campaignUpgradeDiceBonus(
  ids: readonly CampaignUpgradeId[],
  terrain: TerrainType,
  phase: ActionDiceSubPhase,
): number {
  let bonus = 0;
  for (const id of ids) {
    const def = campaignUpgradeDefinition(id);
    if (phase === 'misc') bonus += def.miscDiceBonus;
    if (terrain === 'mud') {
      if (phase === 'attack') bonus += def.mudAttackDiceBonus;
      else if (phase === 'movement') bonus += def.mudMovementDiceBonus;
      else bonus += def.mudMiscDiceBonus;
    } else if (terrain === 'beach') {
      if (phase === 'attack') bonus += def.beachAttackDiceBonus;
      else if (phase === 'movement') bonus += def.beachMovementDiceBonus;
      else bonus += def.beachMiscDiceBonus;
    }
  }
  return bonus;
}

/** Apply newly acquired persistent vehicle modifiers exactly once to this loaded Sherman instance. */
export function applyCampaignUpgradesToSherman(sherman: Unit, ids: readonly CampaignUpgradeId[]): void {
  const applied = new Set(sherman.campaignUpgradeIds ?? []);
  for (const id of ids) {
    if (applied.has(id)) continue;
    const def = campaignUpgradeDefinition(id);
    sherman.interiorVisionRange = (sherman.interiorVisionRange ?? sherman.stats.interiorVisionRange ?? 1)
      + def.interiorVisionBonus;
    sherman.gunnerVisionRange = (sherman.gunnerVisionRange ?? sherman.stats.gunnerVisionRange ?? 4)
      + def.gunnerVisionBonus;
    sherman.stats.armorFrontSide += def.armorFrontSideBonus;
    sherman.stats.armorRearSide += def.armorRearSideBonus;
    sherman.stats.gunMantletArmor = (sherman.stats.gunMantletArmor ?? 0) + def.gunMantletArmorBonus;
    if (def.ignoreDestroyed) sherman.ignoreDestroyedDamage = true;
    if (def.ignoreCrewCheck) sherman.ignoreCrewCheckDamage = true;
    if (def.mineDamageImmune) sherman.campaignMineDamageImmune = true;
    if (def.hiddenLongRangeUntargetable) sherman.campaignHiddenLongRangeUntargetable = true;
    if (def.mechanicalFailureImmune) sherman.campaignMechanicalFailureImmune = true;
    if (def.ignoreFirstAttackParalyzedPerSegment) sherman.campaignParalyzedProtectionAvailable = true;
    if (def.commanderShieldPerSegment) sherman.campaignCommanderShieldAvailable = true;
    if (id === 'hvap' && sherman.hvapAmmoRemaining === undefined) {
      const chamberedHvap = resolvedLoadedShell(sherman) === 'hvap' ? 1 : 0;
      sherman.hvapAmmoRemaining = HVAP_AMMO_CAPACITY - chamberedHvap;
    }
    applied.add(id);
  }
  sherman.campaignUpgradeIds = [...applied];
}

/** Restore per-segment charges when retrying from that segment's start checkpoint. */
export function resetCampaignUpgradeSegmentCharges(sherman: Unit, ids: readonly CampaignUpgradeId[]): void {
  if (ids.some(id => campaignUpgradeDefinition(id).ignoreFirstAttackParalyzedPerSegment)) {
    sherman.campaignParalyzedProtectionAvailable = true;
  }
  if (ids.some(id => campaignUpgradeDefinition(id).commanderShieldPerSegment)) {
    sherman.campaignCommanderShieldAvailable = true;
  }
}

export function campaignUpgradeHitThresholdModifier(ids: readonly CampaignUpgradeId[]): number {
  return ids.reduce((sum, id) => sum + campaignUpgradeDefinition(id).hitThresholdModifier, 0);
}

/** Revive the first dead crew member in the campaign's canonical 1..5 order. */
export function reviveFirstCampaignCrewMember(
  sherman: { crew?: Partial<NonNullable<Unit['crew']>> },
): keyof NonNullable<Unit['crew']> | null {
  if (!sherman.crew) return null;
  const order: Array<keyof NonNullable<Unit['crew']>> = ['commander', 'gunner', 'loader', 'driver', 'coDriver'];
  const slot = order.find(candidate => sherman.crew?.[candidate] === false);
  if (!slot) return null;
  sherman.crew[slot] = true;
  return slot;
}
