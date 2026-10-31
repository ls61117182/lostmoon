import type { Axial, Direction, Tile, TileDef } from './types';
import type { FortificationArtConfig, FortificationArtKind } from './FortificationArt';
import { validateFortificationArtConfig } from './FortificationArt';
import { axialToOffset, directionTo, neighbor, offsetToAxial } from './HexGrid';

export function parseFortification(raw: FortificationArtConfig | undefined, terrain: Tile['terrain']): FortificationArtConfig | undefined {
  if (raw === undefined) return undefined;
  validateFortificationArtConfig(raw);
  if (terrain === 'water' || terrain === 'deep_water' || terrain === 'beach') throw new Error('Fortifications require dry land');
  return { kind: raw.kind, connections: raw.connections };
}

/** Only a shot exactly along an authored open arm can enfilade its trench. */
export function trenchCoverModifier(tile: Tile | undefined, attacker: Axial, target: Axial): number {
  if (!tile?.fortification || (attacker.q === target.q && attacker.r === target.r)) return 0;
  const incoming = directionTo(target, attacker);
  return incoming !== null && tile.fortification.connections[incoming] === '1' ? 0 : 2;
}

/** Stable tie-breaking; maximize the angular separation of the authored arms. */
export function trenchFormationDirections(connections: string): number[] {
  const ports = Array.from({ length: 6 }, (_, d) => d).filter(d => connections[d] === '1');
  if (ports.length < 2) return ports;
  let pair = [ports[0], ports[1]], best = -1;
  for (let a = 0; a < ports.length; a++) for (let b = a + 1; b < ports.length; b++) {
    const delta = Math.abs(ports[a] - ports[b]), separation = Math.min(delta, 6 - delta);
    if (separation > best) { best = separation; pair = [ports[a], ports[b]]; }
  }
  return pair;
}

/** Matches the exported dogleg centerlines; convert PNG y-down to Cocos y-up. */
export function trenchInfantryOffsets(tile: Tile | undefined, size: number): Array<{ ox: number; oy: number }> | null {
  if (tile?.fortification?.kind !== 'trench') return null;
  const ports = trenchFormationDirections(tile.fortification.connections), scale = size / 128;
  const center = { ox: 0, oy: 0 };
  if (!ports.length) return [center, { ox: -32 * scale, oy: -5 * scale }, { ox: 32 * scale, oy: 9 * scale }];
  const onArm = (d: number, station: number) => {
    const a = d * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
    const bend = station < 32 ? station / 4 : station < 64 ? (64 - station) / 4 : 0;
    return { ox: (ux * station - uy * bend) * scale, oy: -(uy * station + ux * bend) * scale };
  };
  if (ports.length === 1) return [center, onArm(ports[0], 37), onArm(ports[0], 76)];
  return [center, onArm(ports[0], 60), onArm(ports[1], 60)];
}

type EditorGrid = Array<Array<TileDef | null>>;
const isDry = (tile: TileDef) => !['w', 'dw', 'B', 'esw'].includes(tile.t);
export function setEditorFortification(grid: EditorGrid, row: number, col: number, kind: FortificationArtKind | null): boolean {
  const tile = grid[row]?.[col];
  if (!tile || !isDry(tile)) return false;
  if (kind === null) delete tile.fort;
  else tile.fort = { kind, connections: tile.fort?.connections ?? '000000' };
  return true;
}

/** Editing an exit synchronizes the opposite exit of an existing adjacent earthwork. */
export function setEditorFortificationConnection(grid: EditorGrid, row: number, col: number, dir: Direction, enabled: boolean, parity: 0 | 1 = 0): boolean {
  const tile = grid[row]?.[col];
  if (!tile?.fort || !isDry(tile)) return false;
  const write = (target: TileDef, d: number) => {
    const bits = [...target.fort!.connections]; bits[d] = enabled ? '1' : '0';
    target.fort = { ...target.fort!, connections: bits.join('') };
  };
  write(tile, dir);
  const next = axialToOffset(neighbor(offsetToAxial({ row, col }, parity), dir), parity);
  const other = grid[next.row]?.[next.col];
  if (other?.fort && isDry(other)) write(other, (dir + 3) % 6);
  return true;
}
