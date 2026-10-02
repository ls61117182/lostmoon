import { Color, Graphics, Mask, Material, Node, Sprite, UITransform, Vec4, dynamicAtlasManager } from 'cc';

export type OcclusionShape = { circle: [number, number, number] } | { polygon: Array<[number, number]> };

/** Sprite alpha stencils clip the second unit pass to actual foliage/roof pixels.
 * The parent visibility stencil also clips silhouettes at fog boundaries. */
export class UnitOcclusionRenderer {
  private material: Material | null = null;
  private liveCopies: Array<{ source: Sprite; copy: Sprite }> = [];
  private slots: Array<{ node: Node; mask: Mask; copies: Sprite[]; vectors?: Graphics }> = [];

  constructor(public readonly root: Node) {}

  setMaterial(material: Material) {
    this.material?.destroy();
    this.material = material;
  }

  sync(sources: Map<Sprite, Color>, blockers: Sprite[], shapes: OcclusionShape[] = [], vectors: Array<{ circle: [number, number, number]; color: Color }> = []) {
    this.liveCopies.length = 0;
    for (const slot of this.slots) slot.node.active = false;
    if (!this.material) return;
    let next = 0;
    for (const blocker of [...blockers, ...(shapes.length ? [null] : [])]) {
      if (blocker && (!blocker.node.activeInHierarchy || !blocker.spriteFrame)) continue;
      const bounds = blocker?.getComponent(UITransform)!.getBoundingBoxToWorld();
      const overlapping = [...sources].filter(([sprite]) => sprite.node.activeInHierarchy
        && !!sprite.spriteFrame && (!bounds || bounds.intersects(sprite.getComponent(UITransform)!.getBoundingBoxToWorld())));
      if (!overlapping.length && !vectors.length) continue;
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
      if (vectors.length && !slot.vectors) {
        const node = new Node('VectorUnitSilhouettes');
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        slot.node.addChild(node);
        slot.vectors = node.addComponent(Graphics);
      }
      if (slot.vectors) {
        slot.vectors.clear();
        slot.vectors.node.setWorldPosition(this.root.worldPosition);
        slot.vectors.node.setWorldRotation(this.root.worldRotation);
        slot.vectors.node.setWorldScale(this.root.worldScale);
        for (const vector of vectors) {
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
