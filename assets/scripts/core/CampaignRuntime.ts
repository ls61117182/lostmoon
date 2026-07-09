import type { CampaignDefinition } from './CampaignDB';
import { axialToOffset, neighbor, offsetToAxial } from './HexGrid';
import type { Direction, MissionData, Offset, TileDef, UnitPlacement } from './types';

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

interface RawSegmentOffset {
  col: number;
  row: number;
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

function campaignExitTarget(data: MissionData, segmentOffset: RawSegmentOffset): Offset | null {
  const evacAt = data.objective.evacAt;
  const evacExitDir = data.objective.evacExitDir;
  if (!evacAt || evacExitDir == null) return null;
  const rowParityOffset = data.rowParityOffset === 1 ? 1 : 0;
  const globalEvacAt = { col: evacAt.col + segmentOffset.col, row: evacAt.row + segmentOffset.row };
  return axialToOffset(
    neighbor(offsetToAxial(globalEvacAt, rowParityOffset), evacExitDir as Direction),
    rowParityOffset,
  );
}

function segmentEntryAnchor(data: MissionData): Offset {
  return data.sherman.at ? { ...data.sherman.at } : { col: 0, row: 0 };
}

function calculateSegmentOffsets(missions: MissionData[]): CampaignSegmentRuntime[] {
  const rawOffsets: RawSegmentOffset[] = [{ col: 0, row: 0 }];

  for (let i = 1; i < missions.length; i++) {
    const prev = missions[i - 1]!;
    const current = missions[i]!;
    const prevOffset = rawOffsets[i - 1]!;
    const exitTarget = campaignExitTarget(prev, prevOffset)
      ?? { col: prevOffset.col + prev.cols, row: prevOffset.row };
    const entry = segmentEntryAnchor(current);
    rawOffsets.push({
      col: exitTarget.col - entry.col,
      row: exitTarget.row - entry.row,
    });
  }

  const minCol = Math.min(...rawOffsets.map((offset) => offset.col));
  const minRow = Math.min(...rawOffsets.map((offset) => offset.row));

  return rawOffsets.map((offset, index) => ({
    index,
    id: '',
    missionPath: '',
    sourcePacificMissionId: '',
    colOffset: offset.col - minCol,
    rowOffset: offset.row - minRow,
    cols: missions[index]!.cols,
    rows: missions[index]!.rows,
    missionId: missions[index]!.id,
  }));
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

  const segments = calculateSegmentOffsets(missions);

  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i]!;
    const definition = campaign.segments[i]!;
    segments[i] = {
      ...segments[i]!,
      id: definition.id,
      missionPath: definition.missionPath,
      sourcePacificMissionId: definition.sourcePacificMissionId,
      cols: mission.cols,
      rows: mission.rows,
      missionId: mission.id,
    };
  }

  const totalCols = Math.max(...segments.map(segment => segment.colOffset + segment.cols));
  const totalRows = Math.max(...segments.map(segment => segment.rowOffset + segment.rows));

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
