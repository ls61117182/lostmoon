import { RNG } from './Dice';
import { axialToOffset, HexMap, neighbor, offsetToAxial } from './HexGrid';
import { standardMapOffsets } from './StandardMapLayout';
import { generateMultiRegionTerrain, type RegionalTerrainCell } from './MultiRegionTerrain';
import type { CustomMissionPackage } from './CustomMissionStore';
import type { TurnEndEventRow, TurnEndEffectType } from './TurnEndEventDB';
import type { Axial, Direction, MissionData, MultiRegionDefinition, UnitKind, UnitPlacement } from './types';

export const MULTI_REGION_TEST_SEED = 20261026;
export const MULTI_REGION_POWER: Partial<Record<UnitKind, number>> = {
  sherman: 3, sherman76: 4, american_infantry: 1, german_infantry: 1,
  panzer3: 2, panzer4: 3, panzer4_f: 3, stug3: 3,
};

/** Standard 36-cell boards tile exactly using (8,-4), (-3,6), determinant 36. */
export function generateMultiRegionPackage(seed = Date.now(), count: 4 | 5 | 6 = 4): CustomMissionPackage {
  if (![4, 5, 6].includes(count)) throw new Error('Multi-region maps require 4–6 regions');
  seed = (seed >>> 0) || 1;
  const rng = new RNG(seed);
  const origins = Array.from({ length: count }, (_, index) => {
    const col = index % (count === 4 ? 2 : 3), row = Math.floor(index / (count === 4 ? 2 : 3));
    // Even row translations preserve the standard odd-r row alignment as well as its exact outline.
    return { q: col * 8 - row * 3, r: col * -4 + row * 6 };
  });
  const centers = origins.map(origin => ({ q: origin.q + 2, r: origin.r + 3 }));
  const raw = new Map<string, RegionalTerrainCell>();
  origins.forEach((origin, region) => {
    for (const offset of standardMapOffsets()) {
      const local = offsetToAxial(offset);
      const pos = { q: origin.q + local.q, r: origin.r + local.r };
      const key = HexMap.keyOf(pos);
      if (raw.has(key)) throw new Error('Overlapping region template');
      raw.set(key, { pos, region, tile: { t: 'f' } });
    }
  });
  const ensureTerrainAccess = generateMultiRegionTerrain(raw, centers, rng);
  const minR = Math.min(...Array.from(raw.values(), cell => cell.pos.r));
  const rowShift = -minR;
  const offsets = Array.from(raw.values(), cell => axialToOffset({ q: cell.pos.q, r: cell.pos.r + rowShift }));
  const colShift = -Math.min(...offsets.map(pos => pos.col));
  const global = (pos: Axial): Axial => ({ q: pos.q + colShift, r: pos.r + rowShift });
  const coords = Array.from(raw.values(), cell => axialToOffset(global(cell.pos)));
  const cols = Math.max(...coords.map(pos => pos.col)) + 1, rows = Math.max(...coords.map(pos => pos.row)) + 1;
  const tiles: MissionData['tiles'] = Array.from({ length: rows }, () => Array(cols).fill(null));
  const regions: MultiRegionDefinition[] = centers.map((center, index) => ({
    id: `A${index + 1}`, center: global(center), tileKeys: [], enemyBudget: index < 2 ? 12 : 16,
    friendlySpawnKeys: [], enemySpawnKeys: [],
    events: [
      { min: 2, max: 3, side: 'player', kind: 'american_infantry' },
      { min: 4, max: 5, side: 'enemy', kind: 'german_infantry' },
      { min: 8, max: 8, side: 'player', kind: 'sherman' },
      { min: 9, max: 9, side: 'enemy', kind: 'panzer3' },
      { min: 10, max: 10, side: 'player', kind: 'american_infantry', airborne: true },
    ],
  }));
  const occupied = new Set<string>();
  const allies: UnitPlacement[] = [], enemies: UnitPlacement[] = [];
  let player: UnitPlacement;
  origins.forEach((origin, index) => {
    const cells = Array.from(raw.values()).filter(cell => cell.region === index);
    const localOffset = (cell: RegionalTerrainCell) => axialToOffset({ q: cell.pos.q - origin.q, r: cell.pos.r - origin.r });
    const land = cells.filter(cell => cell.tile.t !== 'w').sort((a, b) =>
      localOffset(a).col - localOffset(b).col || localOffset(a).row - localOffset(b).row);
    const friendlyZone = land.filter(cell => localOffset(cell).col <= 3);
    const enemyZone = land.filter(cell => localOffset(cell).col >= 4).reverse();
    regions[index].friendlySpawnKeys = friendlyZone.map(cell => HexMap.keyOf(global(cell.pos)));
    regions[index].enemySpawnKeys = enemyZone.map(cell => HexMap.keyOf(global(cell.pos)));
    const place = (kind: UnitKind, friendly: boolean): UnitPlacement => {
      const zone = friendly ? friendlyZone : enemyZone;
      const cell = zone.find(candidate => !occupied.has(HexMap.keyOf(candidate.pos)));
      if (!cell) throw new Error(`No legal spawn in A${index + 1}`);
      occupied.add(HexMap.keyOf(cell.pos));
      // Spawn zones are authored as passable land; never erase the global river or road.
      if (cell.tile.t === 'F') cell.tile = { t: 'f' };
      return { kind, faction: friendly ? 'usa' : 'german', at: axialToOffset(global(cell.pos)), facing: friendly ? 0 : 3, hatchOpen: true };
    };
    if (index < 2) {
      const company: UnitKind[] = ['sherman', 'sherman', 'sherman76', 'sherman76',
        'american_infantry', 'american_infantry', 'american_infantry', 'american_infantry'];
      company.forEach((kind, slot) => {
        const unit = place(kind, true);
        if (index === 0 && slot === 0) player = unit;
        else allies.push(unit);
      });
    }
    // One required IV G per region, included in that region's exact initial budget.
    enemies.push(place('panzer4', false));
    let remaining = regions[index].enemyBudget - MULTI_REGION_POWER.panzer4!;
    while (remaining > 0) {
      const slots = enemyZone.filter(cell => !occupied.has(HexMap.keyOf(cell.pos))).length;
      const available = (['panzer3', 'panzer4_f', 'stug3', 'german_infantry'] as UnitKind[])
        .filter(kind => MULTI_REGION_POWER[kind]! <= remaining
          && Math.ceil((remaining - MULTI_REGION_POWER[kind]!) / 3) <= slots - 1);
      if (!available.length) throw new Error(`Insufficient deployment cells in A${index + 1}`);
      const kind = rng.pick(available);
      enemies.push(place(kind, false));
      remaining -= MULTI_REGION_POWER[kind]!;
    }
  });
  ensureTerrainAccess();
  for (const cell of raw.values()) {
    const pos = global(cell.pos), offset = axialToOffset(pos);
    if (cell.tile.t === 'r' || cell.tile.br) {
      cell.tile.rd = Array.from({ length: 6 }, (_, index) => {
        const adjacent = raw.get(HexMap.keyOf(neighbor(cell.pos, index as Direction)));
        if (!adjacent || (adjacent.tile.t !== 'r' && !adjacent.tile.br)) return '0';
        if (cell.tile.br && !cell.tile.br.includes(index as Direction)) return '0';
        if (adjacent.tile.br && !adjacent.tile.br.includes(((index + 3) % 6) as Direction)) return '0';
        return '1';
      }).join('');
    }
    tiles[offset.row][offset.col] = cell.tile;
    regions[cell.region].tileKeys.push(HexMap.keyOf(pos));
  }
  const mission: MissionData = {
    id: 'multi_region_01', name: '多区域关卡', theater: 'europe', season: 'summer', weather: 'clear',
    description: `${count}区域联合作战：击毁4辆4号G。每区使用标准8×6轮廓；A1、A2各一个美军连队。seed=${seed >>> 0}`,
    cols, rows, tiles, playerTank: player!, sherman: player!, allies, enemies,
    objective: { type: 'destroy_kind', kind: 'panzer4', count: 4 },
    multiRegion: { version: 1, seed: seed >>> 0, regions, reinforcementLimit: 10, powerCosts: { ...MULTI_REGION_POWER } },
  };
  const turnEndEvents: TurnEndEventRow[] = [];
  for (const region of regions) for (let sum = 2; sum <= 12; sum++) {
    const event = region.events?.find(event => sum >= event.min && sum <= event.max);
    const effectType: TurnEndEffectType = !event ? 'none' : event.airborne ? 'airborne_support'
      : event.kind === 'sherman' ? 'sherman_spawn' : event.kind === 'panzer3' ? 'panzer3_spawn' : 'infantry_spawn';
    turnEndEvents.push({ missionId: `${mission.id}_${region.id}`, sumMin: sum, sumMax: sum,
      diceCount: 2, effectType, ...(event ? { reinforcementSide: event.side === 'player' ? 'friendly' : 'enemy' } : {}) });
  }
  return { schemaVersion: 2, editorVersion: 'multi-region-1', savedAt: 0, source: 'developer', mission,
    turnEndEvents, editor: { tags: ['random', 'multi-region', 'europe'], notes: '标准8×6、36格拼接；全图随机地形。' } };
}
