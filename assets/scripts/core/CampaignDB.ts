import type { ChapterId } from './LevelDB';

export const CAMPAIGN_CHAPTER_ID = 'campaign' as const;

export interface CampaignSegmentDefinition {
  id: string;
  missionPath: string;
  sourcePacificMissionId: string;
}

export interface CampaignDefinition {
  id: string;
  order: number;
  levelId: number;
  titleKey: string;
  missionId: string;
  transitionSeconds: number;
  stitchDirection: 'horizontal';
  segments: CampaignSegmentDefinition[];
}

export const CAMPAIGNS: CampaignDefinition[] = [
  {
    id: 'tarawa_red_beach_1',
    order: 1,
    levelId: 1,
    titleKey: 'campaign.tarawaRedBeach1.title',
    missionId: 'campaign_tarawa_red_beach_1',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_tarawa_red_beach_1_01', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_01', sourcePacificMissionId: 'mission_pacific_01' },
      { id: 'campaign_tarawa_red_beach_1_02', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_02', sourcePacificMissionId: 'mission_pacific_02' },
      { id: 'campaign_tarawa_red_beach_1_03', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_03', sourcePacificMissionId: 'mission_pacific_03' },
    ],
  },
  {
    id: 'saipan',
    order: 2,
    levelId: 2,
    titleKey: 'campaign.saipan.title',
    missionId: 'campaign_saipan',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_saipan_01', missionPath: 'missions/campaign_pacific/campaign_saipan_01', sourcePacificMissionId: 'mission_pacific_04' },
      { id: 'campaign_saipan_02', missionPath: 'missions/campaign_pacific/campaign_saipan_02', sourcePacificMissionId: 'mission_pacific_05' },
      { id: 'campaign_saipan_03', missionPath: 'missions/campaign_pacific/campaign_saipan_03', sourcePacificMissionId: 'mission_pacific_06' },
    ],
  },
  {
    id: 'tarawa_red_beach_2',
    order: 3,
    levelId: 3,
    titleKey: 'campaign.tarawaRedBeach2.title',
    missionId: 'campaign_tarawa_red_beach_2',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_tarawa_red_beach_2_01', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_01', sourcePacificMissionId: 'mission_pacific_07' },
      { id: 'campaign_tarawa_red_beach_2_02', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_02', sourcePacificMissionId: 'mission_pacific_08' },
      { id: 'campaign_tarawa_red_beach_2_03', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_03', sourcePacificMissionId: 'mission_pacific_09' },
    ],
  },
  {
    id: 'peleliu',
    order: 4,
    levelId: 4,
    titleKey: 'campaign.peleliu.title',
    missionId: 'campaign_peleliu',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_peleliu_01', missionPath: 'missions/campaign_pacific/campaign_peleliu_01', sourcePacificMissionId: 'mission_pacific_10' },
      { id: 'campaign_peleliu_02', missionPath: 'missions/campaign_pacific/campaign_peleliu_02', sourcePacificMissionId: 'mission_pacific_11' },
      { id: 'campaign_peleliu_03', missionPath: 'missions/campaign_pacific/campaign_peleliu_03', sourcePacificMissionId: 'mission_pacific_12' },
    ],
  },
];

export function getCampaign(id: string): CampaignDefinition | undefined {
  return CAMPAIGNS.find(campaign => campaign.id === id);
}

export function isCampaignChapter(chapterId: ChapterId): boolean {
  return chapterId === CAMPAIGN_CHAPTER_ID;
}
