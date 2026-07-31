import type { ActionDiceSubPhase } from './ActionDice';
import {
  CAMPAIGN_UPGRADE_BY_ID,
  CAMPAIGN_UPGRADES,
  CampaignUpgradeDefinition,
  CampaignUpgradeId,
} from './CampaignUpgradeDB';
import type { RNG } from './Dice';
import type { TerrainType, Unit } from './types';

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
    if (terrain !== 'mud') continue;
    if (phase === 'attack') bonus += def.mudAttackDiceBonus;
    else if (phase === 'movement') bonus += def.mudMovementDiceBonus;
    else bonus += def.mudMiscDiceBonus;
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
    if (def.ignoreDestroyed) sherman.ignoreDestroyedDamage = true;
    if (def.ignoreCrewCheck) sherman.ignoreCrewCheckDamage = true;
    applied.add(id);
  }
  sherman.campaignUpgradeIds = [...applied];
}

export function campaignUpgradeHitThresholdModifier(ids: readonly CampaignUpgradeId[]): number {
  return ids.reduce((sum, id) => sum + campaignUpgradeDefinition(id).hitThresholdModifier, 0);
}
