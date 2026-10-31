import { Color, Graphics, Mask, Material, Node, Rect, Sprite, UITransform, Vec4, dynamicAtlasManager } from 'cc';
import type { UnitFogRenderer } from './UnitFogRenderer';

export type OcclusionShape = { circle: [number, number, number] } | { polygon: Array<[number, number]> };
export type UnitSpriteOccluder = {
  blocker: Sprite;
  sources: Map<Sprite, Color>;
  vectors?: Array<{ circle: [number, number, number]; color: Color }>;
};

/** Sprite alpha stencils clip the second unit pass to actual foliage/roof pixels.
 * The scene's shared terrain fog texture also fades each outline pixel. */
export class UnitOcclusionRenderer {
  private material: Material | null = null;
  private fog: UnitFogRenderer | null = null;
  private liveCopies: Array<{ source: Sprite; copy: Sprite }> = [];
  private liveUnitBlockers: Array<{ source: Sprite; mask: Node }> = [];
  private slots: Array<{ node: Node; mask: Mask; copies: Sprite[]; vectors?: Graphics }> = [];

  constructor(public readonly root: Node) {}

  setFogRenderer(fog: UnitFogRenderer | null): void { this.fog = fog; }

  setMaterial(material: Material) {
    this.material?.destroy();
    this.material = material;
  }

  sync(sources: Map<Sprite, Color>, blockers: Sprite[], shapes: OcclusionShape[] = [], vectors: Array<{ circle: [number, number, number]; color: Color }> = [], unitBlockers: UnitSpriteOccluder[] = []) {
    this.liveCopies.length = 0;
    this.liveUnitBlockers.length = 0;
    for (const slot of this.slots) slot.node.active = false;
    if (!this.material) return;
    let next = 0;
    // World bounds walk node transforms. Compute them once per source for this
    // sync, rather than once for every tree/roof against every unit.
    const boundsCache = new Map<Sprite, Rect>();
    const boundsOf = (sprite: Sprite) => {
      let bounds = boundsCache.get(sprite);
      if (!bounds) {
        bounds = sprite.getComponent(UITransform)!.getBoundingBoxToWorld();
        boundsCache.set(sprite, bounds);
      }
      return bounds;
    };
    const sourceCache = new Map<Map<Sprite, Color>, Array<[Sprite, Color]>>();
    const sourcesOf = (entries: Map<Sprite, Color>) => {
      let active = sourceCache.get(entries);
      if (!active) {
        active = Array.from(entries).filter(([sprite]) => sprite.node.activeInHierarchy && !!sprite.spriteFrame);
        sourceCache.set(entries, active);
      }
      return active;
    };
    const vectorBounds = new Map<typeof vectors[number], Rect>();
    const passes: Array<{ blocker: Sprite | null; sources: Map<Sprite, Color>; vectors: typeof vectors; moving?: boolean }> = [
      ...[...blockers, ...(shapes.length ? [null] : [])].map(blocker => ({ blocker, sources, vectors })),
      ...unitBlockers.map(entry => ({ ...entry, vectors: entry.vectors ?? [], moving: true })),
    ];
    for (const { blocker, sources: passSources, vectors: passVectors, moving } of passes) {
      if (blocker && (!blocker.node.activeInHierarchy || !blocker.spriteFrame)) continue;
      if (!passSources.size && !passVectors.length) continue;
      const bounds = blocker ? boundsOf(blocker) : null;
      const overlapping = sourcesOf(passSources).filter(([sprite]) => !bounds || bounds.intersects(boundsOf(sprite)));
      const overlappingVectors = bounds ? passVectors.filter(vector => {
        let rect = vectorBounds.get(vector);
        if (!rect) {
          const [x, y, radius] = vector.circle, r = radius + 2;
          const m = this.root.worldMatrix;
          const cx = m.m00 * x + m.m04 * y + m.m12, cy = m.m01 * x + m.m05 * y + m.m13;
          const rx = r * Math.hypot(m.m00, m.m04), ry = r * Math.hypot(m.m01, m.m05);
          rect = new Rect(cx - rx, cy - ry, rx * 2, ry * 2);
          vectorBounds.set(vector, rect);
        }
        return bounds.intersects(rect);
      }) : passVectors;
      if (!overlapping.length && !overlappingVectors.length) continue;
      let slot = this.slots[next++];
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
        if (moving) this.liveUnitBlockers.push({ source: blocker, mask: slot.node });
      } else {
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
      for (const copy of slot.copies) copy.node.active = false;
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
        copy.customMaterial = this.material;
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
        this.liveCopies.push({ source, copy });
      });
    }
  }

  private updateOutlineSampling(source: Sprite, copy: Sprite) {
    const uv = source.spriteFrame!.uv;
    const xs = [uv[0], uv[2], uv[4], uv[6]];
    const ys = [uv[1], uv[3], uv[5], uv[7]];
    const material = copy.getMaterialInstance(0)!;
    material.setProperty('uvBounds', new Vec4(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    const size = source.getComponent(UITransform)!.contentSize;
    const scale = source.node.worldScale;
    const xStep = 2 / Math.max(1, size.width * Math.abs(scale.x));
    const yStep = 2 / Math.max(1, size.height * Math.abs(scale.y));
    material.setProperty('outlineStep', new Vec4(
      (uv[2] - uv[0]) * xStep, (uv[3] - uv[1]) * xStep,
      (uv[4] - uv[0]) * yStep, (uv[5] - uv[1]) * yStep,
    ));
  }

  syncTransforms() {
    for (const { source, mask } of this.liveUnitBlockers) {
      mask.setWorldPosition(source.node.worldPosition);
      mask.setWorldRotation(source.node.worldRotation);
      mask.setWorldScale(source.node.worldScale);
    }
    for (const { source, copy } of this.liveCopies) {
      this.updateOutlineSampling(source, copy);
      copy.node.setWorldPosition(source.node.worldPosition);
      copy.node.setWorldRotation(source.node.worldRotation);
      copy.node.setWorldScale(source.node.worldScale);
    }
  }

  destroy() {
    this.material?.destroy();
    this.material = null;
  }
}
