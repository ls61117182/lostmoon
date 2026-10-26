import type { Graphics, Node } from 'cc';
import type { Unit } from '../core/types';

export interface UnitSpriteCursor { tank: number; hatch: number; infantry: number; officer: number; suppression: number; }
export interface UnitDrawPass { crewOnly: boolean; graphics: Graphics; start: UnitSpriteCursor; end: UnitSpriteCursor; }
export interface CachedUnitAnimation {
  unit: Unit; center: { x: number; y: number }; nodes: Set<Node>; passes: UnitDrawPass[];
  wreckPose: Unit['wreckPose'];
  visible?: boolean;
  vectors: Array<{ circle: [number, number, number] }>;
}

/** Retains the actual pooled nodes owned by each unit until the next rules redraw. */
export class UnitAnimationCache {
  readonly entries = new Map<Unit, CachedUnitAnimation>();

  clear(): void { this.entries.clear(); }

  record(unit: Unit, center: { x: number; y: number }, nodes: Node[], pass: UnitDrawPass,
    vectors: Array<{ circle: [number, number, number] }> = []): void {
    let entry = this.entries.get(unit);
    if (!entry) {
      entry = { unit, center: { ...center }, nodes: new Set(), passes: [], wreckPose: unit.wreckPose, vectors: [] };
      this.entries.set(unit, entry);
    }
    for (const node of nodes) entry.nodes.add(node);
    entry.passes.push(pass);
    entry.vectors.push(...vectors);
  }

  addNode(unit: Unit, node: Node): void { this.entries.get(unit)?.nodes.add(node); }

  translate(entry: CachedUnitAnimation, center: { x: number; y: number }, moved?: (node: Node, dx: number, dy: number) => void): void {
    const dx = center.x - entry.center.x, dy = center.y - entry.center.y;
    if (!dx && !dy) return;
    for (const node of entry.nodes) {
      if (!node.isValid) continue;
      let nested = false;
      for (let parent = node.parent; parent; parent = parent.parent) if (entry.nodes.has(parent)) { nested = true; break; }
      if (nested) continue;
      node.setPosition(node.position.x + dx, node.position.y + dy, node.position.z);
      moved?.(node, dx, dy);
    }
    entry.center = { ...center };
    for (const vector of entry.vectors) { vector.circle[0] += dx; vector.circle[1] += dy; }
  }
}
