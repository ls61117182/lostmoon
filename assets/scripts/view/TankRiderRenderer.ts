import { Color, Graphics, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { tankRiders } from '../core/TankRiding';
import type { Unit } from '../core/types';
import { AMERICAN_SEATED_SPRITE_PATHS, TANK_RIDER_COLORS, TANK_RIDER_HIP_ANCHOR, TANK_RIDER_INWARD_OFFSET_TO_HEIGHT, TANK_RIDER_SEATS, TANK_RIDER_WIDTH_TO_HULL, tankRiderSeats } from './TankRiderVisual';

interface RiderSlot { sprite: Sprite; fallback: Graphics }
interface RiderGroup { root: Node; slots: RiderSlot[]; shadow: Graphics }

/** Children of the hull inherit move/turn interpolation and engine vibration, never turret rotation. */
export class TankRiderRenderer {
  private frames: Array<SpriteFrame | null> = [null, null, null];
  private groups = new Map<string, RiderGroup>();

  load(onReady: () => void): void {
    AMERICAN_SEATED_SPRITE_PATHS.forEach((path, index) => {
      resources.load(path, SpriteFrame, (error, frame) => {
        if (error || !frame) { console.warn(`[TankRiders] Cannot load ${path}`, error); return; }
        this.frames[index] = frame;
        onReady();
      });
    });
  }

  begin(): void {
    for (const group of this.groups.values()) group.root.active = false;
  }

  clear(): void {
    for (const group of this.groups.values()) if (group.root.isValid) group.root.destroy();
    this.groups.clear();
  }

  draw(tank: Unit, hull: Sprite, units: readonly Unit[]): void {
    const infantry = tankRiders(tank, units)[0];
    if (tank.destroyed || !infantry) return;
    this.drawPreview(tank.id, hull, infantry.mountedDoubleSide);
  }

  /** The tank image debugger shares the runtime seats, sprites and hull parenting. */
  drawPreview(id: string, hull: Sprite, doubleSide: 'left' | 'right' = 'right'): void {
    let group = this.groups.get(id);
    if (!group) {
      const root = new Node(`TankRiders_${id}`);
      root.layer = hull.node.layer;
      root.addComponent(UITransform).setContentSize(1, 1);
      const shadow = root.addComponent(Graphics);
      const slots = TANK_RIDER_SEATS.map((_, index) => {
        const node = new Node(`SeatedAmerican_${index + 1}`);
        node.layer = hull.node.layer;
        node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const fallbackNode = new Node('LoadingFallback');
        fallbackNode.layer = hull.node.layer;
        fallbackNode.addComponent(UITransform).setContentSize(1, 1);
        const fallback = fallbackNode.addComponent(Graphics);
        node.addChild(fallbackNode);
        root.addChild(node);
        return { sprite, fallback };
      });
      group = { root, slots, shadow };
      this.groups.set(id, group);
    }
    if (group.root.parent !== hull.node) hull.node.addChild(group.root);
    const size = hull.node.getComponent(UITransform)!.contentSize;
    const width = size.width * TANK_RIDER_WIDTH_TO_HULL;
    group.root.active = true;
    group.shadow.clear();
    group.shadow.fillColor = new Color(0, 0, 0, Math.round(hull.color.a * 0.35));
    tankRiderSeats(doubleSide).forEach((seat, index) => {
      const { sprite, fallback } = group!.slots[index];
      const frame = this.frames[index];
      const height = width * (frame ? frame.rect.height / frame.rect.width : 1359 / 1158);
      const node = sprite.node;
      const x = seat.x * size.width;
      const y = seat.y * size.height - Math.sign(seat.y) * height * TANK_RIDER_INWARD_OFFSET_TO_HEIGHT;
      group!.shadow.ellipse(x, y, width * 0.17, width * 0.12);
      group!.shadow.fill();
      node.setPosition(x, y, 0);
      node.angle = seat.angle;
      sprite.spriteFrame = frame;
      const color = TANK_RIDER_COLORS[index];
      sprite.color = new Color(color.r, color.g, color.b, hull.color.a);
      const transform = node.getComponent(UITransform)!;
      transform.setAnchorPoint(TANK_RIDER_HIP_ANCHOR.x, TANK_RIDER_HIP_ANCHOR.y);
      transform.setContentSize(width, height);
      fallback.clear();
      if (!frame) {
        fallback.fillColor = new Color(85, 91, 54, hull.color.a);
        fallback.circle(0, width * 0.12, width * 0.13);
        fallback.fill();
      }
    });
  }
}
