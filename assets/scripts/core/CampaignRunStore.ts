import type { StitchedCampaignData } from './CampaignRuntime';
import type { CustomMissionPackage } from './CustomMissionStore';
import type { CampaignUpgradeId } from './CampaignUpgradeDB';
import type { CampaignCheckpoint } from './CampaignCheckpointStore';
import type { SaveData } from './SaveLoad';
import type { MissionData } from './types';
import { getActiveSaveKey } from './SaveSlot';

/** One active campaign per account, independent of the standalone mission slot. */
export interface CampaignRunSave {
  version: 1;
  runtime: StitchedCampaignData;
  mission: MissionData;
  segmentIndex: number;
  save: SaveData;
  packages: CustomMissionPackage[] | null;
  upgradeIds: CampaignUpgradeId[];
  chosenSegments: number[];
  checkpoint: CampaignCheckpoint | null;
  retainedAttackDiePip?: number | null;
  paralyzedProtectionAvailable?: boolean;
  commanderShieldAvailable?: boolean;
}

export function readCampaignRun(): CampaignRunSave | null {
  try {
    const raw = localStorage.getItem(`${getActiveSaveKey()}:campaign_run_v1`);
    if (!raw) return null;
    const run = JSON.parse(raw) as CampaignRunSave;
    if (run.version !== 1 || !run.runtime?.campaign?.id
      || !Array.isArray(run.runtime.segmentMissionData)
      || !Number.isInteger(run.segmentIndex) || run.segmentIndex < 0
      || run.segmentIndex >= run.runtime.segmentMissionData.length
      || !run.mission?.tiles || !run.save?.sherman
      || !Array.isArray(run.upgradeIds) || !Array.isArray(run.chosenSegments)) return null;
    return run;
  } catch { return null; }
}

export function writeCampaignRun(run: CampaignRunSave): void {
  localStorage.setItem(`${getActiveSaveKey()}:campaign_run_v1`, JSON.stringify(run));
}

export function clearCompletedCampaignRun(campaignId: string): void {
  if (readCampaignRun()?.runtime.campaign.id !== campaignId) return;
  localStorage.removeItem(`${getActiveSaveKey()}:campaign_run_v1`);
}
