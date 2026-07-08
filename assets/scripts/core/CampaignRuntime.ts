import type { CampaignDefinition } from './CampaignDB';
import type { MissionData, Offset, TileDef, UnitPlacement } from './types';

export interface CampaignSegmentRuntime {
  index: number;
  id: string;
  missionPath: string;
  sourcePacificMissionId: string;
  colOffset: number;
  rowOffset: number;
  cols: number;
  rows: number;
  missionId: string;
}

export interface StitchedCampaignData {
  campaign: CampaignDefinition;
  data: MissionData;
  segmentMissionData: MissionData[];
  segments: CampaignSegmentRuntime[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function translateOffset(pos: Offset | undefined, colOffset: number, rowOffset: number): Offset | undefined {
  if (!pos) return undefined;
  return { col: pos.col + colOffset, row: pos.row + rowOffset };
}

function translatePlacement(p: UnitPlacement, colOffset: number, rowOffset: number): UnitPlacement {
  const out: UnitPlacement = { ...p };
  if (p.at) out.at = translateOffset(p.at, colOffset, rowOffset);
  if (p.crew) out.crew = { ...p.crew };
  if (p.startEids) out.startEids = p.startEids.slice();
  if (p.startRids) out.startRids = p.startRids.slice();
  return out;
}

function translateObjective(obj: MissionData['objective'], colOffset: number, rowOffset: number): MissionData['objective'] {
  const out = cloneJson(obj);
  if (out.evacAt) out.evacAt = translateOffset(out.evacAt, colOffset, rowOffset);
  return out;
}

function stripStartMarkers(tile: TileDef): TileDef {
  const out: TileDef = { ...tile };
  delete out.eid;
  delete out.ef;
  delete out.rid;
  delete out.rf;
  return out;
}

function translateTruckPath(data: MissionData, colOffset: number, rowOffset: number): MissionData['truckPath'] {
  return data.truckPath?.map(p => ({ ...p, col: p.col + colOffset, row: p.row + rowOffset }));
}

export function translateMissionData(data: MissionData, segmentIndex: number, colOffset: number, rowOffset = 0): MissionData {
  void segmentIndex;
  return {
    ...cloneJson(data),
    sherman: translatePlacement(data.sherman, colOffset, rowOffset),
    allies: (data.allies ?? []).map(p => translatePlacement(p, colOffset, rowOffset)),
    enemies: data.enemies.map(p => translatePlacement(p, colOffset, rowOffset)),
    objective: translateObjective(data.objective, colOffset, rowOffset),
    truckPath: translateTruckPath(data, colOffset, rowOffset),
  };
}

function buildTilesForActiveSegment(
  missions: MissionData[],
  segments: CampaignSegmentRuntime[],
  activeIndex: number,
  totalCols: number,
  totalRows: number,
): Array<Array<TileDef | null>> {
  const rows: Array<Array<TileDef | null>> = Array.from(
    { length: totalRows },
    () => Array.from({ length: totalCols }, () => null),
  );

  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i]!;
    const segment = segments[i]!;
    for (let row = 0; row < mission.rows; row++) {
      for (let col = 0; col < mission.cols; col++) {
        const tile = mission.tiles[row]?.[col] ?? null;
        if (!tile) continue;
        rows[row + segment.rowOffset]![col + segment.colOffset] = i === activeIndex
          ? { ...tile }
          : stripStartMarkers(tile);
      }
    }
  }

  return rows;
}

function buildActiveMissionData(
  campaign: CampaignDefinition,
  missions: MissionData[],
  segments: CampaignSegmentRuntime[],
  activeIndex: number,
  totalCols: number,
  totalRows: number,
): MissionData {
  const source = missions[activeIndex]!;
  const segment = segments[activeIndex]!;
  const translated = translateMissionData(source, activeIndex, segment.colOffset, segment.rowOffset);
  return {
    ...translated,
    id: activeIndex === 0 ? campaign.missionId : translated.id,
    name: translated.name,
    description: translated.description,
    cols: totalCols,
    rows: totalRows,
    tiles: buildTilesForActiveSegment(missions, segments, activeIndex, totalCols, totalRows),
  };
}

export function stitchCampaignMissions(campaign: CampaignDefinition, missions: MissionData[]): StitchedCampaignData {
  if (missions.length !== campaign.segments.length) {
    throw new Error(`Campaign ${campaign.id} expected ${campaign.segments.length} segments, got ${missions.length}`);
  }

  const totalCols = missions.reduce((sum, mission) => sum + mission.cols, 0);
  const totalRows = Math.max(...missions.map(mission => mission.rows));
  const segments: CampaignSegmentRuntime[] = [];
  let colOffset = 0;

  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i]!;
    const definition = campaign.segments[i]!;
    segments.push({
      index: i,
      id: definition.id,
      missionPath: definition.missionPath,
      sourcePacificMissionId: definition.sourcePacificMissionId,
      colOffset,
      rowOffset: 0,
      cols: mission.cols,
      rows: mission.rows,
      missionId: mission.id,
    });
    colOffset += mission.cols;
  }

  const segmentMissionData = missions.map((_, index) =>
    buildActiveMissionData(campaign, missions, segments, index, totalCols, totalRows),
  );

  return {
    campaign,
    data: segmentMissionData[0]!,
    segmentMissionData,
    segments,
  };
}

export function campaignSegmentForOffset(stitched: StitchedCampaignData, pos: Offset): number | null {
  for (const segment of stitched.segments) {
    const inCol = pos.col >= segment.colOffset && pos.col < segment.colOffset + segment.cols;
    const inRow = pos.row >= segment.rowOffset && pos.row < segment.rowOffset + segment.rows;
    if (inCol && inRow) return segment.index;
  }
  return null;
}

export function carryShermanToNextSegment(current: UnitPlacement, nextTemplate: UnitPlacement): UnitPlacement {
  return {
    kind: 'sherman',
    faction: current.faction ?? nextTemplate.faction,
    at: nextTemplate.at ? { ...nextTemplate.at } : undefined,
    facing: current.facing ?? nextTemplate.facing,
    turretFacing: current.turretFacing ?? nextTemplate.turretFacing,
    crew: current.crew ? { ...current.crew } : nextTemplate.crew ? { ...nextTemplate.crew } : undefined,
    loaded: current.loaded === true,
    hatchOpen: current.hatchOpen === true,
  };
}
