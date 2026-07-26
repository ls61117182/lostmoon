import type { SaveData } from './SaveLoad';
import { getActiveSaveKey } from './SaveSlot';

/**
 * Campaign checkpoints intentionally use a different localStorage key from the
 * normal save slot. A campaign transition must never overwrite "Continue".
 */
const CAMPAIGN_CHECKPOINT_SUFFIX = ':campaign_checkpoint_v1';

export interface CampaignCheckpoint {
  campaignId: string;
  segmentIndex: number;
  save: SaveData;
}

export function writeCampaignCheckpoint(checkpoint: CampaignCheckpoint): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(checkpointKey(checkpoint.campaignId), JSON.stringify(checkpoint));
}

export function readCampaignCheckpoint(campaignId: string): CampaignCheckpoint | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(checkpointKey(campaignId));
    if (!raw) return null;
    const checkpoint = JSON.parse(raw) as CampaignCheckpoint;
    if (!checkpoint
      || typeof checkpoint.campaignId !== 'string'
      || !Number.isInteger(checkpoint.segmentIndex)
      || !checkpoint.save) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

function checkpointKey(campaignId: string): string {
  return `${getActiveSaveKey()}${CAMPAIGN_CHECKPOINT_SUFFIX}:${encodeURIComponent(campaignId)}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}
