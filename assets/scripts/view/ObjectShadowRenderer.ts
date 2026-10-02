import { Color, Graphics, Node, Sprite, UITransform } from 'cc';

export type ObjectShadowKind = 'tree' | 'building' | 'vehicle' | 'groundProp' | 'infantry';

// Screen-space sunlight comes from the upper left (Cocos UI Y points up).
const PROFILES = {
  tree: { reach: 0.08, flatten: 0.94, alpha: 72, contact: 0.35 },
  building: { reach: 0.08, flatten: 0.98, alpha: 78, contact: 0.80 },
  vehicle: { reach: 0.08, flatten: 1, alpha: 70, contact: 0.66 },
  groundProp: { reach: 0.018, flatten: 1, alpha: 78, contact: 0.85 },
  infantry: { reach: 0.028, flatten: 1, alpha: 90, contact: 0.75 },
};

/** Reuses the source alpha silhouette and pooled nodes; never copies textures.
 * Sources and the layer must share the same map coordinate system. */
export class ObjectShadowRenderer {
  private layer: Node;
  private contacts: Graphics;
  private pool: Array<{ root: Node; sprite: Sprite }> = [];
  private next = 0;

  constructor(parent: Node, name: string, siblingIndex?: number) {
    this.layer = new Node(name);
    this.layer.layer = parent.layer;
    this.layer.addComponent(UITransform);
    this.contacts = this.layer.addComponent(Graphics);
    parent.addChild(this.layer);
    if (siblingIndex !== undefined) this.layer.setSiblingIndex(siblingIndex);
  }

  begin(): void {
    this.next = 0;
    this.contacts.clear();
  }

  draw(source: Sprite, kind: ObjectShadowKind, hexSize: number): void {
    const node = source.node;
    const transform = node.getComponent(UITransform);
    if (!node.active || !source.spriteFrame || !transform) return;
    const profile = PROFILES[kind];
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
      slot = { root, sprite };
      this.pool.push(slot);
    }
    const opacity = source.color.a / 255;
    const width = transform.width * Math.abs(node.scale.x);
    const height = transform.height * Math.abs(node.scale.y);
    // Trees, buildings and tanks share the same hex-relative offset.
    // Keep ground props and infantry attached to their small footprints.
    const footprint = Math.min(width, height);
    const reach = kind === 'groundProp' || kind === 'infantry'
      ? Math.min(hexSize * profile.reach, footprint * (kind === 'groundProp' ? 0.08 : 0.16))
      : hexSize * profile.reach;
    slot.root.active = true;
    slot.root.setPosition(node.position.x + reach, node.position.y - reach, 0);
    // Flatten in world space so rotation never changes the sunlight direction.
    slot.root.setScale(1, profile.flatten, 1);
    slot.sprite.spriteFrame = source.spriteFrame;
    slot.sprite.trim = source.trim;
    slot.sprite.color = new Color(0, 0, 0, Math.round(profile.alpha * opacity));
    const shadowTransform = slot.sprite.node.getComponent(UITransform)!;
    shadowTransform.setContentSize(transform.contentSize);
    shadowTransform.setAnchorPoint(transform.anchorPoint);
    slot.sprite.node.angle = node.angle;
    slot.sprite.node.setScale(node.scale);

    // Compact ground contact makes the object feel seated, even with a long cast.
    const radius = Math.min(width, height) * profile.contact * 0.5;
    this.contacts.fillColor = new Color(0, 0, 0, Math.round(48 * opacity));
    this.contacts.ellipse(node.position.x, node.position.y, radius, radius * 0.72);
    this.contacts.fill();
  }

  end(): void {
    for (let i = this.next; i < this.pool.length; i++) this.pool[i].root.active = false;
  }
}
