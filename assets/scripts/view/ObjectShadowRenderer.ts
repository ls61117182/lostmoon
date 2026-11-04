import { Color, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import type { UnitFogRenderer } from './UnitFogRenderer';

export type ObjectShadowKind = 'tree' | 'building' | 'rocky' | 'vehicle' | 'groundProp' | 'infantry';

// Screen-space sunlight comes from the upper left (Cocos UI Y points up).
export const OBJECT_SHADOW_PROFILES = {
  tree: { reach: 0.08, flatten: 0.94, alpha: 72, contact: 0.35 },
  building: { reach: 0.08, flatten: 0.98, alpha: 78, contact: 0.80 },
  // Height is expressed by a longer cast without tilting the overhead rock art.
  rocky: { reach: 0.20, flatten: 1, alpha: 88, contact: 0.90 },
  vehicle: { reach: 0.08, flatten: 1, alpha: 70, contact: 0.66 },
  groundProp: { reach: 0.018, flatten: 1, alpha: 78, contact: 0.85 },
  infantry: { reach: 0.028, flatten: 1, alpha: 90, contact: 0.75 },
};

interface ShadowSlot {
  root: Node; sprite: Sprite; contact: Sprite;
  source: Sprite; kind: ObjectShadowKind; hexSize: number; visibilityAlpha: number;
  appearance: unknown[]; x: number; y: number; angle: number;
}

/** Reuses the source alpha silhouette and pooled nodes; never copies textures.
 * Sources and the layer must share the same map coordinate system. */
export class ObjectShadowRenderer {
  private layer: Node;
  private contacts: Node;
  private contactFrame: SpriteFrame;
  private contactTexture: Texture2D;
  private pool: ShadowSlot[] = [];
  private next = 0;
  private cameraRotation = 0;
  private fog: UnitFogRenderer | null = null;

  setFogRenderer(fog: UnitFogRenderer | null): void {
    this.fog = fog;
  }

  constructor(parent: Node, name: string, siblingIndex?: number) {
    this.layer = new Node(name);
    this.layer.layer = parent.layer;
    this.layer.addComponent(UITransform);
    // All contact sprites share a small alpha disc and one consecutive layer,
    // allowing batching without re-tessellating ellipses during movement.
    const size = 64, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(255 * Math.max(0, Math.min(1,
        size / 2 - .5 - Math.hypot(x + .5 - size / 2, y + .5 - size / 2))));
    }
    this.contactTexture = new Texture2D();
    this.contactTexture.reset({ width: size, height: size, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 1 });
    this.contactTexture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    this.contactTexture.uploadData(pixels);
    this.contactFrame = new SpriteFrame();
    this.contactFrame.texture = this.contactTexture;
    this.contacts = new Node('GroundContacts');
    this.contacts.layer = this.layer.layer;
    this.contacts.addComponent(UITransform);
    this.layer.addChild(this.contacts);
    parent.addChild(this.layer);
    if (siblingIndex !== undefined) this.layer.setSiblingIndex(siblingIndex);
  }

  begin(cameraRotation = 0): void {
    this.cameraRotation = cameraRotation;
    this.next = 0;
  }

  draw(source: Sprite, kind: ObjectShadowKind, hexSize: number, visibilityAlpha = 1): void {
    const node = source.node;
    const transform = node.getComponent(UITransform);
    if (!node.active || !source.spriteFrame || !transform) return;
    let slot = this.pool[this.next++];
    if (!slot) {
      const root = new Node('ProjectedSilhouette');
      root.layer = this.layer.layer;
      root.addComponent(UITransform);
      const shape = new Node('Shape');
      shape.layer = root.layer;
      shape.addComponent(UITransform);
      const sprite = shape.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      root.addChild(shape);
      this.layer.addChild(root);
      const contactNode = new Node('GroundContact');
      contactNode.layer = this.layer.layer;
      contactNode.addComponent(UITransform);
      const contact = contactNode.addComponent(Sprite);
      contact.sizeMode = Sprite.SizeMode.CUSTOM;
      contact.spriteFrame = this.contactFrame;
      this.contacts.addChild(contactNode);
      slot = { root, sprite, contact, source, kind, hexSize, visibilityAlpha,
        appearance: [], x: NaN, y: NaN, angle: NaN };
      this.pool.push(slot);
      // Keep the contacts together above all projected casts.
      this.contacts.setSiblingIndex(this.layer.children.length - 1);
    }
    Object.assign(slot, { source, kind, hexSize, visibilityAlpha });
    this.updateSlot(slot);
    // A rules redraw may have cleared fog bindings without changing appearance.
    if (this.fog) {
      const policy = this.fog.policyOf(source.node);
      this.fog.bind(slot.sprite, policy); this.fog.bind(slot.contact, policy);
    }
  }

  private updateSlot(slot: ShadowSlot): void {
    const { source, kind, hexSize, visibilityAlpha } = slot;
    const node = source.node;
    const transform = node.isValid !== false ? node.getComponent(UITransform) : null;
    const active = node.isValid !== false && node.activeInHierarchy && !!source.spriteFrame && !!transform;
    slot.root.active = slot.contact.node.active = active;
    if (!active || !transform) return;
    const profile = OBJECT_SHADOW_PROFILES[kind];
    const opacity = source.color.a / 255 * visibilityAlpha;
    const width = transform.width * Math.abs(node.scale.x);
    const height = transform.height * Math.abs(node.scale.y);
    // Trees, buildings and tanks share the same hex-relative offset.
    // Keep ground props and infantry attached to their small footprints.
    const footprint = Math.min(width, height);
    const reach = kind === 'groundProp' || kind === 'infantry'
      ? Math.min(hexSize * profile.reach, footprint * (kind === 'groundProp' ? 0.08 : 0.16))
      : hexSize * profile.reach;
    const rotated = this.cameraRotation === 90;
    const policy = this.fog?.policyOf(node);
    const appearance = [source.spriteFrame, source.trim, kind, hexSize, opacity,
      transform.width, transform.height, transform.anchorPoint.x, transform.anchorPoint.y,
      node.scale.x, node.scale.y, node.scale.z, this.cameraRotation, policy];
    const changed = appearance.some((v, i) => v !== slot.appearance[i]);
    if (changed) {
      slot.appearance = appearance;
      slot.root.angle = rotated ? -90 : 0;
      // Flatten in the screen frame; the sunlight never rotates with the hull.
      slot.root.setScale(1, profile.flatten, 1);
      slot.sprite.spriteFrame = source.spriteFrame;
      slot.sprite.trim = source.trim;
      slot.sprite.color = new Color(0, 0, 0, Math.round(profile.alpha * opacity));
      const shadowTransform = slot.sprite.node.getComponent(UITransform)!;
      shadowTransform.setContentSize(transform.contentSize);
      shadowTransform.setAnchorPoint(transform.anchorPoint);
      slot.sprite.node.setScale(node.scale);
      const radius = Math.min(width, height) * profile.contact * .5;
      slot.contact.node.getComponent(UITransform)!.setContentSize(
        (rotated ? radius * .72 : radius) * 2, (rotated ? radius : radius * .72) * 2);
      slot.contact.color = new Color(0, 0, 0, Math.round(48 * opacity));
      if (policy) { this.fog?.bind(slot.sprite, policy); this.fog?.bind(slot.contact, policy); }
    }
    if (changed || slot.x !== node.position.x || slot.y !== node.position.y) {
      slot.x = node.position.x; slot.y = node.position.y;
      slot.root.setPosition(slot.x + (rotated ? -reach : reach), slot.y - reach, 0);
      slot.contact.node.setPosition(slot.x, slot.y, 0);
    }
    if (changed || slot.angle !== node.angle) {
      slot.angle = node.angle;
      slot.sprite.node.angle = node.angle + this.cameraRotation;
    }
  }

  end(): void {
    for (let i = this.next; i < this.pool.length; i++) {
      this.pool[i].root.active = this.pool[i].contact.node.active = false;
    }
  }

  /** No geometry rebuild or material binding for unchanged casts. */
  syncTransforms(): void {
    for (let i = 0; i < this.next; i++) this.updateSlot(this.pool[i]);
  }

  destroy(): void {
    this.pool.length = 0;
    this.contactFrame.destroy();
    this.contactTexture.destroy();
  }
}
