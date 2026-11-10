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
}
export interface ArmoredTrainArtManifest {
  schemaVersion: number;
  canvas: { width: number; height: number };
  modules: TrainModuleArt[];
  weapons: TrainWeaponArt[];
}
export interface TrainBodyPose { x: number; y: number; angleDegrees: number; }

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
