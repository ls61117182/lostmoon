import { HexMap } from './HexGrid';
import { computePlayerVisibleHexes } from './FogOfWar';
import type { LoadedMission } from './MissionLoader';
import type { Unit, WeatherType } from './types';

function sightState(unit: Unit) {
  return [unit.id, unit.kind, unit.faction, unit.sideId, unit.pos.q, unit.pos.r,
    unit.destroyed, unit.facing, unit.turretFacing, unit.previousTurretFacing,
    unit.diagonalGunnerSidePreference, unit.hatchOpen, unit.radioDamaged, unit.turretDamaged,
    unit.crew, unit.visionRange, unit.gunnerVisionRange, unit.interiorVisionRange,
    unit.stats.visionType, unit.stats.hasRadio, unit.stats.visionRange, unit.stats.gunnerVisionRange,
    unit.stats.interiorVisionRange, unit.campaignUpgradeIds, unit.mountedOnUnitId,
    unit.attachedToATGunId, unit.atGunControllerUnitId, unit.atGunCrewAlive];
}

/** Cache rules sight, excluding presentation-only movement interpolation and ammo/UI state. */
export class PlayerVisionCache {
  private source: HexMap | null = null;
  private shape = '';
  private signature = '';
  private regionMap: HexMap | null = null;
  private visible = new Set<string>();

  constructor(private compute = computePlayerVisibleHexes) {}

  get(mission: LoadedMission, weather: WeatherType, fog: boolean, radio: boolean): Set<string> {
    const map = mission.map, player = mission.sherman;
    const region = map.regions.get(HexMap.keyOf(player.pos));
    const tiles = map.all().filter(tile => !region || map.regions.get(HexMap.keyOf(tile.pos)) === region);
    const allies = mission.allies.filter(unit => !region || map.sameRegion(player.pos, unit.pos));
    const shape = tiles.map(tile => HexMap.keyOf(tile.pos)).join('|');
    if (this.source !== map || shape !== this.shape) {
      this.source = map; this.shape = shape; this.signature = '';
      this.regionMap = region ? new HexMap(map.cols, map.rows) : null;
    }
    if (this.regionMap) for (const tile of tiles) {
      this.regionMap.set(tile); this.regionMap.regions.set(HexMap.keyOf(tile.pos), region!);
    }
    const smoke = Array.from(mission.smokeHexes).filter(key => !region || map.regions.get(key) === region).sort();
    const signature = JSON.stringify([weather, fog, radio, region, sightState(player), allies.map(sightState),
      tiles.map(tile => [tile.pos.q, tile.pos.r, map.lineOfSightBlockedByTile(tile)]), smoke]);
    if (signature !== this.signature) {
      this.visible = fog
        ? this.compute(this.regionMap ?? map, player, allies, radio, weather, mission.smokeHexes)
        : new Set(tiles.map(tile => HexMap.keyOf(tile.pos)));
      this.signature = signature;
    }
    // The scene adds timed reveals to its copy; those must not contaminate cached rules sight.
    return new Set(this.visible);
  }
}
