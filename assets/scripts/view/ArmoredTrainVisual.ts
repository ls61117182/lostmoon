import { JsonAsset, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { trainModuleArt, trainWeaponArt, trainWeaponPose, validateArmoredTrainArt } from '../core/ArmoredTrainArt';
import type { ArmoredTrainArtManifest, TrainBodyPose, TrainWeaponSlot } from '../core/ArmoredTrainArt';

export interface LoadedArmoredTrainArt { manifest: ArmoredTrainArtManifest; frames: Record<string, SpriteFrame>; }

/** Loads shared textures; individual visual instances only own their Nodes. */
export async function loadArmoredTrainArt(): Promise<LoadedArmoredTrainArt> {
  const manifest = await new Promise<ArmoredTrainArtManifest>((resolve, reject) => {
    resources.load('textures/units/trains/bp44/bp44_art_manifest', JsonAsset, (error, asset) => {
      if (error || !asset) reject(error ?? new Error('Missing BP44 art manifest'));
      else resolve(asset.json as ArmoredTrainArtManifest);
    });
  });
  validateArmoredTrainArt(manifest);
  const paths = new Set(manifest.modules.flatMap(m => [m.body, m.destroyed]).concat(manifest.weapons.map(w => w.sprite)));
  const frames: Record<string, SpriteFrame> = {};
  await Promise.all([...paths].map(path => new Promise<void>((resolve, reject) => {
    resources.load(path, SpriteFrame, (error, frame) => {
      if (error || !frame) reject(error ?? new Error(`Missing train art: ${path}`));
      else { frames[path] = frame; resolve(); }
    });
  })));
  return { manifest, frames };
}

/** A carriage plus separately aimed weapon Nodes; this class defines no train combat rules. */
export class ArmoredTrainVisual {
  readonly node: Node;
  readonly bodyNode: Node;
  private readonly module;
  private readonly bodySprite: Sprite;
  private readonly weaponNodes = new Map<string, { node: Node; slot: TrainWeaponSlot; angle: number }>();
  private pose: TrainBodyPose;
  private destroyed = false;

  constructor(parent: Node, private readonly art: LoadedArmoredTrainArt, moduleId: string,
    private hexRadius = 48, initialPose: TrainBodyPose = { x: 0, y: 0, angleDegrees: 0 }) {
    validateArmoredTrainArt(art.manifest);
    this.module = trainModuleArt(art.manifest, moduleId);
    this.pose = { ...initialPose };
    this.node = new Node(`Train:${moduleId}`); this.node.layer = parent.layer;
    this.node.addComponent(UITransform); parent.addChild(this.node);
    const body = this.spriteNode('Carriage', this.module.body, this.module.pivot);
    this.bodyNode = body.node; this.bodySprite = body.sprite;
    for (const slot of this.module.weapons) {
      const weapon = trainWeaponArt(art.manifest, slot.id);
      const node = this.spriteNode(`Weapon:${slot.slotId}`, weapon.sprite, weapon.pivot).node;
      this.weaponNodes.set(slot.slotId, { node, slot, angle: initialPose.angleDegrees - slot.initialAngleDegrees });
    }
    this.sync();
  }
  private spriteNode(name: string, path: string, pivot: { x: number; y: number }) {
    const frame = this.art.frames[path];
    if (!frame) throw new Error(`Unloaded train sprite: ${path}`);
    const node = new Node(name); node.layer = this.node.layer;
    const ui = node.addComponent(UITransform);
    ui.setAnchorPoint(pivot.x / this.art.manifest.canvas.width, 1 - pivot.y / this.art.manifest.canvas.height);
    const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false; sprite.spriteFrame = frame; this.node.addChild(node);
    return { node, sprite };
  }
  setPose(pose: TrainBodyPose): void { this.pose = { ...pose }; this.sync(); }
  setHexRadius(radius: number): void {
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Train hex radius must be positive');
    this.hexRadius = radius; this.sync();
  }
  setWeaponAngle(slotId: string, angleDegrees: number): void {
    const weapon = this.weaponNodes.get(slotId);
    if (!weapon) throw new Error(`Unknown train weapon slot: ${slotId}`);
    if (!Number.isFinite(angleDegrees)) throw new Error('Train weapon angle must be finite');
    weapon.angle = angleDegrees; this.sync();
  }
  getWeaponNode(slotId: string): Node | undefined { return this.weaponNodes.get(slotId)?.node; }
  getWeaponMuzzles(slotId: string) {
    const weapon = this.weaponNodes.get(slotId);
    if (!weapon) throw new Error(`Unknown train weapon slot: ${slotId}`);
    return this.destroyed ? [] : trainWeaponPose(this.art.manifest, this.module, weapon.slot, this.pose, weapon.angle, this.hexRadius).muzzles;
  }
  setDestroyed(destroyed: boolean): void { this.destroyed = destroyed; this.sync(); }
  private sync(): void {
    this.node.setPosition(this.pose.x, this.pose.y, 0);
    // Keep root angle zero. Body and weapon angles are siblings, never inherited from one another.
    this.node.angle = 0; this.bodyNode.angle = this.pose.angleDegrees;
    const side = this.hexRadius * 2;
    this.bodyNode.getComponent(UITransform)!.setContentSize(side, side);
    this.bodySprite.spriteFrame = this.art.frames[this.destroyed ? this.module.destroyed : this.module.body];
    for (const { node, slot, angle } of this.weaponNodes.values()) {
      const p = trainWeaponPose(this.art.manifest, this.module, slot, { ...this.pose, x: 0, y: 0 }, angle, this.hexRadius);
      node.setPosition(p.position.x, p.position.y, 0); node.angle = angle;
      node.getComponent(UITransform)!.setContentSize(side, side); node.active = !this.destroyed;
    }
  }
  destroy(): void { this.node.destroy(); }
}
