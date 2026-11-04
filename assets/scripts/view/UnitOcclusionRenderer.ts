import { Color, Graphics, Mask, Material, Node, Rect, Sprite, UITransform, Vec4, dynamicAtlasManager } from 'cc';
import type { UnitFogRenderer } from './UnitFogRenderer';

export type OcclusionShape = { circle: [number, number, number] } | { polygon: Array<[number, number]> };
export type UnitSpriteOccluder = {
  blocker: Sprite;
  sources: Map<Sprite, Color>;
  vectors?: Array<{ circle: [number, number, number]; color: Color }>;
};

type VectorOutline = { circle: [number, number, number]; color: Color };
type Slot = { node: Node; mask: Mask; copies: Sprite[]; vectors?: Graphics };
type Pass = {
  blocker: Sprite | null; sources: Map<Sprite, Color>; vectors: VectorOutline[];
  moving?: boolean; bounds: Rect | null; slot?: Slot;
};
type SpriteState = { frame: Sprite['spriteFrame']; values: unknown[]; active: boolean; bounds: Rect | null };

/** World-space broad phase, rebuilt when the shared map transform changes. */
class BoundsGrid<T> {
  private cells = new Map<string, Set<T>>();
  private keys = new Map<T, string[]>();
  private cellKeys(bounds: Rect): string[] {
    const keys: string[] = [];
    for (let y = Math.floor(bounds.y / 256); y <= Math.floor((bounds.y + bounds.height) / 256); y++) {
      for (let x = Math.floor(bounds.x / 256); x <= Math.floor((bounds.x + bounds.width) / 256); x++) keys.push(`${x},${y}`);
    }
    return keys;
  }
  set(value: T, bounds: Rect | null): void {
    for (const key of this.keys.get(value) ?? []) {
      const cell = this.cells.get(key)!; cell.delete(value);
      if (!cell.size) this.cells.delete(key);
    }
    this.keys.delete(value);
    if (!bounds) return;
    const keys = this.cellKeys(bounds); this.keys.set(value, keys);
    for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set());
      cell.add(value);
    }
  }
  query(bounds: Rect): Set<T> {
    const result = new Set<T>();
    for (const key of this.cellKeys(bounds)) for (const value of this.cells.get(key) ?? []) result.add(value);
    return result;
  }
}

/** Sprite alpha stencils clip the second unit pass to actual foliage/roof pixels.
 * The scene's shared terrain fog texture also fades each outline pixel. */
export class UnitOcclusionRenderer {
  private material: Material | null = null;
  private fog: UnitFogRenderer | null = null;
  private slots: Slot[] = [];
  private next = 0;
  private passes: Pass[] = [];
  private shapePasses: Pass[] = [];
  private sprites = new Map<Sprite, SpriteState>();
  private sources = new Set<Sprite>();
  private sourceOrder = new Map<Sprite, number>();
  private animatedSprites: Sprite[] = [];
  private movingBlockers = new Map<Sprite, Pass[]>();
  private sourceGrid = new BoundsGrid<Sprite>();
  private passGrid = new BoundsGrid<Pass>();
  private vectors = new Map<VectorOutline, { values: unknown[]; bounds: Rect }>();
  private outlineSampling = new WeakMap<Sprite, { material: Material; values: number[] }>();
  private rootTransform = '';
  private inputs: Parameters<UnitOcclusionRenderer['sync']> | null = null;

  constructor(public readonly root: Node) {}

  setFogRenderer(fog: UnitFogRenderer | null): void { this.fog = fog; }

  setMaterial(material: Material) {
    this.material?.destroy();
    this.material = material;
    this.outlineSampling = new WeakMap();
  }

  sync(sources: Map<Sprite, Color>, blockers: Sprite[], shapes: OcclusionShape[] = [], vectors: Array<{ circle: [number, number, number]; color: Color }> = [], unitBlockers: UnitSpriteOccluder[] = []) {
    this.inputs = [sources, blockers, shapes, vectors, unitBlockers];
    this.rootTransform = this.mapTransform();
    this.next = 0;
    for (const slot of this.slots) slot.node.active = false;
    this.sprites.clear(); this.sources.clear(); this.sourceOrder.clear(); this.movingBlockers.clear(); this.vectors.clear();
    this.sourceGrid = new BoundsGrid(); this.passGrid = new BoundsGrid();
    this.passes = [];
    this.shapePasses = [];
    this.animatedSprites = [];
    if (!this.material) return;
    this.passes = [
      ...[...blockers, ...(shapes.length ? [null] : [])].map(blocker => ({ blocker, sources, vectors, bounds: null })),
      ...unitBlockers.map(entry => ({ ...entry, vectors: entry.vectors ?? [], moving: true, bounds: null })),
    ];
    this.shapePasses = this.passes.filter(pass => !pass.blocker);
    for (const pass of this.passes) {
      for (const sprite of pass.sources.keys()) this.sources.add(sprite);
      if (pass.blocker && pass.moving) {
        const entries = this.movingBlockers.get(pass.blocker) ?? [];
        entries.push(pass); this.movingBlockers.set(pass.blocker, entries);
      }
      for (const vector of pass.vectors) this.vectors.set(vector, this.vectorState(vector));
    }
    this.animatedSprites = [...new Set([...this.sources, ...this.movingBlockers.keys()])];
    for (const source of this.sources) this.sourceOrder.set(source, this.sourceOrder.size);
    for (const sprite of new Set([...this.sources, ...this.passes.flatMap(pass => pass.blocker ? [pass.blocker] : [])])) {
      const state = this.spriteState(sprite);
      state.bounds = state.active ? sprite.getComponent(UITransform)!.getBoundingBoxToWorld() : null;
      this.sprites.set(sprite, state);
      if (this.sources.has(sprite)) this.sourceGrid.set(sprite, state.bounds);
    }
    for (const pass of this.passes) {
      pass.bounds = pass.blocker ? this.sprites.get(pass.blocker)!.bounds : null;
      this.passGrid.set(pass, pass.bounds);
      this.renderPass(pass, shapes);
    }
  }

  private renderPass(pass: Pass, shapes: OcclusionShape[] = this.inputs?.[2] ?? []): void {
    const { blocker, sources: passSources, vectors: passVectors, bounds } = pass;
    const candidates = bounds ? this.sourceGrid.query(bounds) : passSources.keys();
    const overlapping: Array<[Sprite, Color]> = [];
    if (!blocker || this.sprites.get(blocker)?.active) for (const sprite of candidates) {
      const state = this.sprites.get(sprite), color = passSources.get(sprite);
      if (color && state?.active && (!bounds || bounds.intersects(state.bounds!))) overlapping.push([sprite, color]);
    }
    // Grid removals/reinsertions must not change hull/turret or faction order.
    overlapping.sort(([a], [b]) => this.sourceOrder.get(a)! - this.sourceOrder.get(b)!);
    const overlappingVectors = blocker && !this.sprites.get(blocker)?.active ? [] : passVectors.filter(vector => {
      const state = this.vectors.get(vector);
      return !!state && (!bounds || bounds.intersects(state.bounds));
    });
    if (!overlapping.length && !overlappingVectors.length) {
      if (pass.slot) pass.slot.node.active = false;
      return;
    }
    let slot = pass.slot;
    const newPass = !slot;
    if (!slot) {
      slot = this.slots[this.next++];
      if (!slot) {
        const node = new Node('OccluderAlphaStencil');
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        this.root.addChild(node);
        const mask = node.addComponent(Mask);
        mask.type = Mask.Type.SPRITE_STENCIL;
        mask.alphaThreshold = 0.1;
        slot = { node, mask, copies: [] };
        this.slots.push(slot);
      }
      pass.slot = slot;
      slot.node.setSiblingIndex(this.passes.slice(0, this.passes.indexOf(pass)).filter(other => other.slot).length);
    }
    slot.node.active = true;
    if (blocker) {
      slot.mask.type = Mask.Type.SPRITE_STENCIL;
      const transform = blocker.getComponent(UITransform)!;
      const target = slot.node.getComponent(UITransform)!;
      target.setAnchorPoint(transform.anchorPoint);
      target.setContentSize(transform.contentSize);
      const stencil = slot.mask.subComp as Sprite;
      stencil.sizeMode = Sprite.SizeMode.CUSTOM;
      stencil.trim = blocker.trim;
      stencil.spriteFrame = blocker.spriteFrame;
      slot.node.setWorldPosition(blocker.node.worldPosition);
      slot.node.setWorldRotation(blocker.node.worldRotation);
      slot.node.setWorldScale(blocker.node.worldScale);
    } else if (newPass) {
      slot.node.setPosition(0, 0, 0);
      slot.node.setRotationFromEuler(0, 0, 0);
      slot.node.setScale(1, 1, 1);
      slot.mask.type = Mask.Type.GRAPHICS_STENCIL;
      const graphics = slot.mask.subComp as Graphics;
      graphics.clear();
      for (const shape of shapes) {
        if ('circle' in shape) graphics.circle(...shape.circle);
        else {
          graphics.moveTo(...shape.polygon[0]);
          for (const point of shape.polygon.slice(1)) graphics.lineTo(...point);
          graphics.close();
        }
        graphics.fill();
      }
    }
    if (overlappingVectors.length && !slot.vectors) {
      const node = new Node('VectorUnitSilhouettes');
      node.layer = this.root.layer;
      node.addComponent(UITransform);
      slot.node.addChild(node);
      slot.vectors = node.addComponent(Graphics);
    }
    if (slot.vectors) {
      this.fog?.bind(slot.vectors, 'hidden');
      slot.vectors.clear();
      slot.vectors.node.setWorldPosition(this.root.worldPosition);
      slot.vectors.node.setWorldRotation(this.root.worldRotation);
      slot.vectors.node.setWorldScale(this.root.worldScale);
      for (const vector of overlappingVectors) {
        slot.vectors.strokeColor = vector.color;
        slot.vectors.lineWidth = 2;
        slot.vectors.circle(...vector.circle);
        slot.vectors.stroke();
      }
    }
    for (let i = overlapping.length; i < slot.copies.length; i++) slot.copies[i].node.active = false;
    overlapping.forEach(([source, color], index) => {
      let copy = slot.copies[index];
      if (!copy) {
        const node = new Node('UnitSilhouette');
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        copy = node.addComponent(Sprite);
        copy.sizeMode = Sprite.SizeMode.CUSTOM;
        slot.node.addChild(node);
        slot.copies.push(copy);
      }
      if (copy.customMaterial !== this.material) copy.customMaterial = this.material;
      // Resolve atlas UVs before submitting the shader's sampling bounds.
      dynamicAtlasManager?.packToDynamicAtlas(source, source.spriteFrame!);
      copy.spriteFrame = source.spriteFrame;
      this.updateOutlineSampling(source, copy);
      this.fog?.configure(copy.getMaterialInstance(0)!, this.fog.policyOf(source.node));
      copy.trim = source.trim;
      copy.color = color;
      const original = source.getComponent(UITransform)!;
      copy.getComponent(UITransform)!.setAnchorPoint(original.anchorPoint);
      copy.getComponent(UITransform)!.setContentSize(original.contentSize);
      copy.node.setWorldPosition(source.node.worldPosition);
      copy.node.setWorldRotation(source.node.worldRotation);
      copy.node.setWorldScale(source.node.worldScale);
      copy.node.active = true;
    });
  }

  private updateOutlineSampling(source: Sprite, copy: Sprite) {
    const uv = source.spriteFrame!.uv;
    const size = source.getComponent(UITransform)!.contentSize;
    const scale = source.node.worldScale;
    const material = copy.getMaterialInstance(0)!;
    const values = [...uv, size.width, size.height, Math.abs(scale.x), Math.abs(scale.y)];
    const previous = this.outlineSampling.get(copy);
    if (previous?.material === material && this.sameValues(values, previous.values)) return;
    this.outlineSampling.set(copy, { material, values });
    const xs = [uv[0], uv[2], uv[4], uv[6]];
    const ys = [uv[1], uv[3], uv[5], uv[7]];
    material.setProperty('uvBounds', new Vec4(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    const xStep = 2 / Math.max(1, size.width * Math.abs(scale.x));
    const yStep = 2 / Math.max(1, size.height * Math.abs(scale.y));
    material.setProperty('outlineStep', new Vec4(
      (uv[2] - uv[0]) * xStep, (uv[3] - uv[1]) * xStep,
      (uv[4] - uv[0]) * yStep, (uv[5] - uv[1]) * yStep,
    ));
  }

  private sameValues(a: unknown[], b: unknown[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }

  private mapTransform(): string {
    const m = this.root.worldMatrix;
    return [m.m00, m.m01, m.m04, m.m05, m.m12, m.m13].join(',');
  }

  private spriteState(sprite: Sprite): SpriteState {
    const n = sprite.node;
    if (n.isValid === false || !n.activeInHierarchy || !sprite.spriteFrame) {
      return { frame: sprite.spriteFrame, active: false, values: [], bounds: null };
    }
    const p = n.worldPosition, r = n.worldRotation, s = n.worldScale;
    const t = sprite.getComponent(UITransform)!;
    return { frame: sprite.spriteFrame, active: true, bounds: null, values: [
      p.x, p.y, p.z, r.x, r.y, r.z, r.w, s.x, s.y, s.z,
      t.contentSize.width, t.contentSize.height, t.anchorPoint.x, t.anchorPoint.y,
      sprite.trim, sprite.color?.r, sprite.color?.g, sprite.color?.b, sprite.color?.a,
      ...sprite.spriteFrame.uv, this.fog?.policyOf(n),
    ] };
  }

  private vectorState(vector: VectorOutline): { values: unknown[]; bounds: Rect } {
    const [x, y, radius] = vector.circle, r = radius + 2, m = this.root.worldMatrix;
    const cx = m.m00 * x + m.m04 * y + m.m12, cy = m.m01 * x + m.m05 * y + m.m13;
    const rx = r * Math.hypot(m.m00, m.m04), ry = r * Math.hypot(m.m01, m.m05);
    return { values: [x, y, radius, vector.color.r, vector.color.g, vector.color.b, vector.color.a],
      bounds: new Rect(cx - rx, cy - ry, rx * 2, ry * 2) };
  }

  /** Final-pose update: only changed bounds and their neighbouring passes. */
  syncTransforms(): void {
    if (!this.material || !this.inputs) return;
    if (this.mapTransform() !== this.rootTransform) { this.sync(...this.inputs); return; }
    const dirty = new Set<Pass>();
    const touch = (bounds: Rect | null) => {
      if (bounds) for (const pass of this.passGrid.query(bounds)) {
        if (pass.bounds?.intersects(bounds)) dirty.add(pass);
      }
      for (const pass of this.shapePasses) dirty.add(pass);
    };
    for (const sprite of this.animatedSprites) {
      const before = this.sprites.get(sprite)!, after = this.spriteState(sprite);
      if (before.frame === after.frame && before.active === after.active && this.sameValues(before.values, after.values)) continue;
      if (this.sources.has(sprite)) touch(before.bounds);
      after.bounds = after.active ? sprite.getComponent(UITransform)!.getBoundingBoxToWorld() : null;
      this.sprites.set(sprite, after);
      if (this.sources.has(sprite)) { this.sourceGrid.set(sprite, after.bounds); touch(after.bounds); }
      for (const pass of this.movingBlockers.get(sprite) ?? []) {
        pass.bounds = after.bounds; this.passGrid.set(pass, after.bounds); dirty.add(pass);
      }
    }
    for (const [vector, before] of this.vectors) {
      const after = this.vectorState(vector);
      if (this.sameValues(before.values, after.values)) continue;
      touch(before.bounds); touch(after.bounds); this.vectors.set(vector, after);
    }
    for (const pass of dirty) this.renderPass(pass);
  }

  destroy() {
    this.material?.destroy();
    this.material = null;
    this.inputs = null;
    this.passes = []; this.shapePasses = []; this.slots = [];
    this.animatedSprites = [];
    this.sprites.clear(); this.sources.clear(); this.sourceOrder.clear(); this.movingBlockers.clear(); this.vectors.clear();
    this.sourceGrid = new BoundsGrid(); this.passGrid = new BoundsGrid();
    this.outlineSampling = new WeakMap();
  }
}
