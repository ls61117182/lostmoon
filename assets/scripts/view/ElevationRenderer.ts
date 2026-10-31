import { Graphics, JsonAsset, Mask, Node, Rect, resources, Size, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { tileHeight } from '../core/Elevation';
import { ELEVATION_RADIUS, elevationContour, elevationFingerprint, ElevationContourRaster, type ElevationChunk, type ElevationMaterialData } from './ElevationContour';
import type { Tile } from '../core/types';

type Frames = Record<string, SpriteFrame | null>;
type Project = (q: number, r: number) => { x: number; y: number };
let raster: ElevationContourRaster | null = null, loading = false;
const waiters: Array<() => void> = [];
let bakeCache: { signature: string; chunks: ElevationChunk[] } | null = null;
function withRaster(ready: () => void): void {
  if (raster) { ready(); return; }
  waiters.push(ready); if (loading) return; loading = true;
  resources.load('textures/terrain/elevation/continuous-material', JsonAsset, (error, asset) => {
    loading = false;
    if (error || !asset) { waiters.length = 0; console.warn('[Elevation] Continuous material unavailable:', error); return; }
    raster = new ElevationContourRaster(asset.json as ElevationMaterialData);
    for (const waiter of waiters.splice(0)) waiter();
  });
}
function baked(tiles: readonly Tile[], camera: number): ElevationChunk[] {
  const signature = elevationFingerprint(tiles, camera);
  if (bakeCache?.signature === signature) return bakeCache.chunks;
  const segments = elevationContour(tiles);
  const chunks = raster!.plans(tiles).map(p => raster!.render(tiles, segments, p.x, p.y, undefined, camera));
  bakeCache = { signature, chunks }; return chunks;
}
interface Slot { node: Node; frame: SpriteFrame; texture: Texture2D; chunk: ElevationChunk; }
function createSlot(parent: Node, chunk: ElevationChunk): Slot {
  const texture = new Texture2D(), width = chunk.size + 2;
  texture.reset({ width, height: width }); texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
  texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE); texture.uploadData(chunk.pixels);
  const frame = new SpriteFrame(); frame.texture = texture; frame.packable = false;
  // Keep a sampling gutter, but never composite it over the neighboring chunk.
  frame.rect = new Rect(1, 1, chunk.size, chunk.size); frame.originalSize = new Size(chunk.size, chunk.size);
  const node = new Node('ContinuousElevationChunk'); node.layer = parent.layer; node.addComponent(UITransform);
  const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; sprite.spriteFrame = frame;
  parent.addChild(node); return { node, frame, texture, chunk };
}
function release(slots: Slot[]): void { for (const slot of slots) { slot.node.destroy(); slot.frame.destroy(); slot.texture.destroy(); } }
function position(slot: Slot, scaleX: number, scaleY: number, offset: { x: number; y: number }): void {
  const c = slot.chunk;
  slot.node.getComponent(UITransform)!.setContentSize(c.size * scaleX, c.size * scaleY);
  slot.node.setPosition(offset.x + (c.x + c.size / 2) * scaleX, offset.y - (c.y + c.size / 2) * scaleY, 0);
}

/** Bake the entire contour field once per scenery change. Camera/unit/UI redraws only reposition cached chunks. */
export class ElevationRenderer {
  private layer: Node;
  private slots: Slot[] = [];
  private signature = '';
  private lastDraw: [readonly Tile[], Frames, number, Project, number] | null = null;
  constructor(parent: Node) {
    this.layer = new Node('ElevationSlopes'); this.layer.layer = parent.layer;
    this.layer.addComponent(UITransform); parent.addChild(this.layer);
    withRaster(() => { if (this.layer.isValid && this.lastDraw) this.draw(...this.lastDraw); });
  }
  destroy(): void {
    this.lastDraw = null; release(this.slots); this.slots = []; this.layer.destroy();
    if (bakeCache?.signature === this.signature) bakeCache = null;
  }
  draw(tiles: readonly Tile[], frames: Frames, size: number, project: Project, camera = 0): void {
    if (!this.layer.isValid) return;
    this.lastDraw = [tiles, frames, size, project, camera]; if (!raster) return;
    const signature = elevationFingerprint(tiles, camera);
    if (signature !== this.signature) {
      release(this.slots); this.slots = baked(tiles, camera).map(chunk => createSlot(this.layer, chunk)); this.signature = signature;
    }
    // The editor has padding between hexes. Derive both scales from the actual grid,
    // rather than accumulating a placement error across rows and columns.
    const offset = project(0, 0), east = project(1, 0), southeast = project(0, 1);
    const scaleX = (east.x - offset.x) / (Math.sqrt(3) * ELEVATION_RADIUS);
    const scaleY = (offset.y - southeast.y) / (1.5 * ELEVATION_RADIUS);
    for (const slot of this.slots) position(slot, scaleX, scaleY, offset);
    this.layer.setSiblingIndex(this.layer.parent!.children.length - 1);
  }
}

/** Crop the exact map overlay, including slopes owned by a higher neighbor. */
export function addElevationPreview(parent: Node, tiles: readonly Tile[], tile: Tile, _frames: Frames,
  cx: number, cy: number, size: number, camera = 0): void {
  if (!tiles.some(t => tileHeight(t) !== 0)) return;
  const node = new Node('ElevationPreview'); node.layer = parent.layer;
  node.addComponent(UITransform); node.setPosition(cx, cy, 0); parent.addChild(node);
  const mask = node.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_STENCIL;
  const g = mask.subComp as Graphics; g.clear();
  for (let i = 0; i < 6; i++) {
    const a = (-30 + i * 60) * Math.PI / 180, x = size * Math.cos(a), y = size * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close(); g.fill();
  let slots: Slot[] = [];
  withRaster(() => {
    if (!node.isValid) return;
    const x = Math.sqrt(3) * ELEVATION_RADIUS * (tile.pos.q + tile.pos.r / 2), y = ELEVATION_RADIUS * 1.5 * tile.pos.r;
    slots = baked(tiles, camera).filter(c => c.x - 1 <= x + ELEVATION_RADIUS && c.x + c.size + 1 >= x - ELEVATION_RADIUS
      && c.y - 1 <= y + ELEVATION_RADIUS && c.y + c.size + 1 >= y - ELEVATION_RADIUS).map(c => createSlot(node, c));
    for (const slot of slots) position(slot, size / ELEVATION_RADIUS, size / ELEVATION_RADIUS,
      { x: -x * size / ELEVATION_RADIUS, y: y * size / ELEVATION_RADIUS });
  });
  node.once?.('node-destroyed', () => { release(slots); slots = []; });
}
