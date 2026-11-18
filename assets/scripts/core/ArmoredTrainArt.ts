/** Art-only types and transforms; angles are battlefield-local Cocos CCW degrees, zero points up. */
export interface TrainArtPoint { x: number; y: number; }
export interface TrainWeaponSlot {
  slotId: string;
  id: string;
  pivot: TrainArtPoint;
  initialAngleDegrees: number;
  rotationMode: 'independent';
}
export interface TrainWeaponArt {
  id: string; label: string; sprite: string; pivot: TrainArtPoint; muzzles: TrainArtPoint[];
}
export interface TrainModuleArt {
  id: string; label: string; body: string; destroyed: string; pivot: TrainArtPoint; weapons: TrainWeaponSlot[];
  frontCoupler?: TrainArtPoint;
  rearCoupler?: TrainArtPoint;
  bogies?: TrainArtPoint[];
  /** Source-image body bounds excluding the narrow coupler appendages. */
  bodyBounds?: { top: number; bottom: number };
}
export interface ArmoredTrainArtManifest {
  schemaVersion: number;
  canvas: { width: number; height: number };
  modules: TrainModuleArt[];
  weapons: TrainWeaponArt[];
}
export interface TrainBodyPose { x: number; y: number; angleDegrees: number; }

/** Both bogies follow the same ordered rail path, including the middle of a move. */
export function trainTrackPose(pointAt: (index: number) => TrainArtPoint, index: number,
  halfWheelbase = 1 / (2 * Math.sqrt(3))): TrainBodyPose {
  const sample = (at: number) => {
    const i = Math.floor(at), k = at - i, a = pointAt(i), b = pointAt(i + 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const front = sample(index + halfWheelbase), rear = sample(index - halfWheelbase);
  const corner = Math.round(index), center = pointAt(corner), before = pointAt(corner - 1), after = pointAt(corner + 1);
  const inward = { x: before.x + after.x - 2 * center.x, y: before.y + after.y - 2 * center.y };
  const spacing = (Math.hypot(before.x - center.x, before.y - center.y)
    + Math.hypot(after.x - center.x, after.y - center.y)) / 2;
  // Ease an extra inward offset through each bend. It vanishes on straights
  // and at cell edges, and is capped at 8% of the neighbouring center spacing.
  const weight = (1 + Math.cos((index - corner) * Math.PI * 2)) / 2;
  const inset = .08 * weight * Math.min(1, spacing / Math.max(1e-9, Math.hypot(inward.x, inward.y)));
  return { x: (front.x + rear.x) / 2 + inward.x * inset, y: (front.y + rear.y) / 2 + inward.y * inset,
    angleDegrees: Math.atan2(front.y - rear.y, front.x - rear.x) * 180 / Math.PI - 90 };
}

export function trainCouplerPoint(manifest: ArmoredTrainArtManifest, module: TrainModuleArt,
  body: TrainBodyPose, end: 'front' | 'rear', hexRadius: number): TrainArtPoint {
  const p = (end === 'front' ? module.frontCoupler : module.rearCoupler)
    ?? { x: module.pivot.x, y: module.pivot.y + (end === 'front' ? -1 : 1) * manifest.canvas.width * Math.sqrt(3) / 4 };
  return trainBodyPoint(manifest, module, body, p, hexRadius);
}

/** Attach a single swivelling drawbar beneath the body edge, rather than to a fixed hook tip. */
export function trainCouplingAnchor(manifest: ArmoredTrainArtManifest, module: TrainModuleArt,
  body: TrainBodyPose, end: 'front' | 'rear', hexRadius: number): TrainArtPoint {
  const crop = trainBodyCrop(manifest, module, false, false);
  const hook = end === 'front' ? module.frontCoupler : module.rearCoupler;
  return trainBodyPoint(manifest, module, body, {
    x: hook?.x ?? module.pivot.x,
    y: end === 'front' ? crop.top + 1 : crop.top + crop.height - 1,
  }, hexRadius);
}

function trainBodyPoint(manifest: ArmoredTrainArtManifest, module: TrainModuleArt,
  body: TrainBodyPose, p: TrainArtPoint, hexRadius: number): TrainArtPoint {
  const scale = 2 * hexRadius / manifest.canvas.width;
  const d = rotateTrainArtPoint({ x: (p.x - module.pivot.x) * scale, y: (module.pivot.y - p.y) * scale }, body.angleDegrees);
  return { x: body.x + d.x, y: body.y + d.y };
}

export function trainBodyCrop(manifest: ArmoredTrainArtManifest, module: TrainModuleArt, front: boolean, rear: boolean) {
  const top = front ? 0 : module.bodyBounds?.top ?? 67;
  const bottom = rear ? manifest.canvas.height : module.bodyBounds?.bottom ?? manifest.canvas.height - 67;
  return { top, height: bottom - top };
}

export function trainModuleArt(manifest: ArmoredTrainArtManifest, id: string): TrainModuleArt {
  const art = manifest.modules.find(m => m.id === id);
  if (!art) throw new Error(`Unknown train module: ${id}`);
  return art;
}
export function trainWeaponArt(manifest: ArmoredTrainArtManifest, id: string): TrainWeaponArt {
  const art = manifest.weapons.find(w => w.id === id);
  if (!art) throw new Error(`Unknown train weapon: ${id}`);
  return art;
}
export function validateArmoredTrainArt(manifest: ArmoredTrainArtManifest): void {
  if (manifest.schemaVersion !== 2 || manifest.canvas.width <= 0 || manifest.canvas.height <= 0) {
    throw new Error('Independent train weapons require art manifest version 2');
  }
  for (const module of manifest.modules) {
    const ids = new Set<string>();
    for (const slot of module.weapons) {
      if (!slot.slotId || ids.has(slot.slotId) || slot.rotationMode !== 'independent') throw new Error(`Invalid independent weapon slot: ${module.id}`);
      ids.add(slot.slotId);
      const art = trainWeaponArt(manifest, slot.id);
      for (const p of [slot.pivot, art.pivot, ...art.muzzles]) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Invalid train weapon pivot or muzzle');
      }
    }
  }
}
export function rotateTrainArtPoint(p: TrainArtPoint, angleDegrees: number): TrainArtPoint {
  const angle = angleDegrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
/** Mount follows the carriage; gun aim is independent and must not inherit body rotation. */
export function trainWeaponPose(manifest: ArmoredTrainArtManifest, module: TrainModuleArt, slot: TrainWeaponSlot,
  body: TrainBodyPose, angleDegrees: number, hexRadius: number) {
  const scale = hexRadius * 2 / manifest.canvas.width;
  const local = rotateTrainArtPoint({ x: (slot.pivot.x - module.pivot.x) * scale, y: (module.pivot.y - slot.pivot.y) * scale }, body.angleDegrees);
  const position = { x: body.x + local.x, y: body.y + local.y };
  const art = trainWeaponArt(manifest, slot.id);
  const muzzles = art.muzzles.map(p => {
    const d = rotateTrainArtPoint({ x: (p.x - art.pivot.x) * scale, y: (art.pivot.y - p.y) * scale }, angleDegrees);
    return { x: position.x + d.x, y: position.y + d.y };
  });
  return { position, angleDegrees, muzzles };
}
