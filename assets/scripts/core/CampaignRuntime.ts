import type { CampaignDefinition } from './CampaignDB';
import { axialAdd, axialToOffset, neighbor, offsetToAxial } from './HexGrid';
import type { Axial, Direction, MissionData, Offset, TileDef, UnitPlacement } from './types';

export interface CampaignSegmentRuntime {
  index: number;
  id: string;
  missionPath: string;
  sourcePacificMissionId: string;
  colOffset: number;
  rowOffset: number;
  axialQOffset: number;
  axialROffset: number;
  maxColOffset: number;
  maxRowOffset: number;
  cols: number;
  rows: number;
  tileKeys: string[];
  missionId: string;
}

interface RawSegmentOffset {
  q: number;
  r: number;
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

function offsetKey(pos: Offset): string {
  return `${pos.col},${pos.row}`;
}

function localRowParity(data: MissionData): 0 | 1 {
  return data.rowParityOffset === 1 ? 1 : 0;
}

function translateOffset(pos: Offset | undefined, data: MissionData, segment: CampaignSegmentRuntime): Offset | undefined {
  if (!pos) return undefined;
  return axialToOffset(
    axialAdd(offsetToAxial(pos, localRowParity(data)), { q: segment.axialQOffset, r: segment.axialROffset }),
    0,
  );
}

function translatePlacement(p: UnitPlacement, data: MissionData, segment: CampaignSegmentRuntime): UnitPlacement {
  const out: UnitPlacement = { ...p };
  if (p.at) out.at = translateOffset(p.at, data, segment);
  if (p.crew) out.crew = { ...p.crew };
  if (p.startEids) out.startEids = p.startEids.slice();
  if (p.startRids) out.startRids = p.startRids.slice();
  return out;
}

function translateObjective(data: MissionData, segment: CampaignSegmentRuntime): MissionData['objective'] {
  const obj = data.objective;
  const out = cloneJson(obj);
  if (out.evacAt) out.evacAt = translateOffset(out.evacAt, data, segment);
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

function translateTruckPath(data: MissionData, segment: CampaignSegmentRuntime): MissionData['truckPath'] {
  return data.truckPath?.map(p => ({ ...p, ...translateOffset(p, data, segment)! }));
}

function campaignExitTarget(data: MissionData, segmentOffset: RawSegmentOffset): Axial | null {
  const evacAt = data.objective.evacAt;
  const evacExitDir = data.objective.evacExitDir;
  if (!evacAt || evacExitDir == null) return null;
  const globalEvacAt = axialAdd(offsetToAxial(evacAt, localRowParity(data)), segmentOffset);
  return neighbor(globalEvacAt, evacExitDir as Direction);
}

function segmentEntryAnchor(data: MissionData): Axial {
  return offsetToAxial(data.sherman.at ? data.sherman.at : { col: 0, row: 0 }, localRowParity(data));
}

function calculateSegmentOffsets(missions: MissionData[]): CampaignSegmentRuntime[] {
  const rawOffsets: RawSegmentOffset[] = [{ q: 0, r: 0 }];

  for (let i = 1; i < missions.length; i++) {
    const prev = missions[i - 1]!;
    const current = missions[i]!;
    const prevOffset = rawOffsets[i - 1]!;
    const exitTarget = campaignExitTarget(prev, prevOffset)
      ?? axialAdd(offsetToAxial({ col: prev.cols, row: 0 }, localRowParity(prev)), prevOffset);
    const entry = segmentEntryAnchor(current);
    rawOffsets.push({
      q: exitTarget.q - entry.q,
      r: exitTarget.r - entry.r,
    });
  }

  const translatedTileAxials: Axial[] = [];
  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i]!;
    const offset = rawOffsets[i]!;
    for (let row = 0; row < mission.rows; row++) {
      for (let col = 0; col < mission.cols; col++) {
        if (!mission.tiles[row]?.[col]) continue;
        translatedTileAxials.push(axialAdd(offsetToAxial({ col, row }, localRowParity(mission)), offset));
      }
    }
  }

  const minQ = Math.min(...translatedTileAxials.map((pos) => pos.q));
  const minR = Math.min(...translatedTileAxials.map((pos) => pos.r));
  const normalize = { q: -minQ, r: -minR };

  return rawOffsets.map((offset, index) => {
    const mission = missions[index]!;
    const axialOffset = axialAdd(offset, normalize);
    const translatedOffsets: Offset[] = [];
    for (let row = 0; row < mission.rows; row++) {
      for (let col = 0; col < mission.cols; col++) {
        if (!mission.tiles[row]?.[col]) continue;
        translatedOffsets.push(axialToOffset(
          axialAdd(offsetToAxial({ col, row }, localRowParity(mission)), axialOffset),
          0,
        ));
      }
    }
    const minCol = Math.min(...translatedOffsets.map((pos) => pos.col));
    const minRow = Math.min(...translatedOffsets.map((pos) => pos.row));
    const maxCol = Math.max(...translatedOffsets.map((pos) => pos.col));
    const maxRow = Math.max(...translatedOffsets.map((pos) => pos.row));
    const tileKeys = translatedOffsets.map(offsetKey);
    return {
      index,
      id: '',
      missionPath: '',
      sourcePacificMissionId: '',
      colOffset: minCol,
      rowOffset: minRow,
      axialQOffset: axialOffset.q,
      axialROffset: axialOffset.r,
      maxColOffset: maxCol,
      maxRowOffset: maxRow,
      cols: mission.cols,
      rows: mission.rows,
      tileKeys,
      missionId: mission.id,
    };
  });
}

export function translateMissionData(data: MissionData, segmentIndex: number, segment: CampaignSegmentRuntime): MissionData {
  void segmentIndex;
  return {
    ...cloneJson(data),
    rowParityOffset: 0,
    sherman: translatePlacement(data.sherman, data, segment),
    allies: (data.allies ?? []).map(p => translatePlacement(p, data, segment)),
    enemies: data.enemies.map(p => translatePlacement(p, data, segment)),
    objective: translateObjective(data, segment),
    truckPath: translateTruckPath(data, segment),
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
        const target = translateOffset({ col, row }, mission, segment)!;
        rows[target.row]![target.col] = i === activeIndex
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
  const translated = translateMissionData(source, activeIndex, segment);
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
      missionId: mission.id,
    };
  }

  const totalCols = Math.max(...segments.map(segment => segment.maxColOffset + 1));
  const totalRows = Math.max(...segments.map(segment => segment.maxRowOffset + 1));

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
  const key = offsetKey(pos);
  for (const segment of stitched.segments) {
    if (segment.tileKeys.includes(key)) return segment.index;
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
