import type { ChapterId } from './LevelDB';

export const CAMPAIGN_CHAPTER_ID = 'campaign' as const;
export const RANDOM_ISLAND_CAMPAIGN_ID = 'random_island' as const;
export const RANDOM_SNOW_CAMPAIGN_ID = 'random_snow' as const;

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
  generator?: 'pacific_random_island' | 'europe_random_snow';
  /** Destroy-all stages drive the Sherman to the standard exit before victory. */
  autoEvacAfterDestroyAll?: boolean;
}

export function createRandomIslandCampaign(generatedMissionIds: readonly string[]): CampaignDefinition {
  if (generatedMissionIds.length !== 3) {
    throw new Error(`Random Island requires exactly 3 generated missions, got ${generatedMissionIds.length}`);
  }
  return {
    id: RANDOM_ISLAND_CAMPAIGN_ID,
    order: 5,
    levelId: 5,
    titleKey: 'campaign.randomIsland.title',
    missionId: 'campaign_random_island',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    generator: 'pacific_random_island',
    segments: generatedMissionIds.map((missionId, index) => ({
      id: `campaign_random_island_${index + 1}_${missionId}`,
      missionPath: '',
      sourcePacificMissionId: missionId,
    })),
  };
}

export function createRandomSnowCampaign(generatedMissionIds: readonly string[]): CampaignDefinition {
  if (generatedMissionIds.length !== 3) {
    throw new Error(`Random Snow requires exactly 3 generated missions, got ${generatedMissionIds.length}`);
  }
  return {
    id: RANDOM_SNOW_CAMPAIGN_ID,
    order: 6,
    levelId: 6,
    titleKey: 'campaign.randomSnow.title',
    missionId: 'campaign_random_snow',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    generator: 'europe_random_snow',
    autoEvacAfterDestroyAll: true,
    segments: generatedMissionIds.map((missionId, index) => ({
      id: `campaign_random_snow_${index + 1}_${missionId}`,
      missionPath: '',
      sourcePacificMissionId: missionId,
    })),
  };
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
  {
    id: RANDOM_ISLAND_CAMPAIGN_ID,
    order: 5,
    levelId: 5,
    titleKey: 'campaign.randomIsland.title',
    missionId: 'campaign_random_island',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    generator: 'pacific_random_island',
    segments: [],
  },
  {
    id: RANDOM_SNOW_CAMPAIGN_ID,
    order: 6,
    levelId: 6,
    titleKey: 'campaign.randomSnow.title',
    missionId: 'campaign_random_snow',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    generator: 'europe_random_snow',
    autoEvacAfterDestroyAll: true,
    segments: [],
  },
];

export function getCampaign(id: string): CampaignDefinition | undefined {
  return CAMPAIGNS.find(candidate => candidate.id === id);
}

export function isCampaignChapter(chapterId: ChapterId): boolean {
  return chapterId === CAMPAIGN_CHAPTER_ID;
}
