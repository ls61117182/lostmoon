import { EffectAsset, Graphics, Mask, Material, Node, Sprite, UITransform, Vec4, resources } from 'cc';
import type { UnitFogMaskState } from './FogOverlayRenderer';

export type UnitFogPolicy = 'hidden' | 'known' | 'unmasked';

/** Invert a quad's world transform, including map pan, zoom and 90-degree rotation. */
export function unitFogWorldUV(m: { m00: number; m01: number; m04: number; m05: number; m12: number; m13: number }, width: number, height: number) {
  const det = m.m00 * m.m05 - m.m01 * m.m04;
  if (Math.abs(det) < 1e-10 || width <= 0 || height <= 0) return null;
  return {
    x: [m.m05 / det / width, -m.m04 / det / width, .5 + (m.m04 * m.m13 - m.m05 * m.m12) / det / width],
    y: [m.m01 / det / height, -m.m00 / det / height, .5 + (m.m00 * m.m13 - m.m01 * m.m12) / det / height],
  };
}

/** Shares the terrain's existing GPU texture. No per-unit masks or pose snapshots. */
export class UnitFogRenderer {
  private disposed = false;
  private enabled = true;
  private state: UnitFogMaskState | null = null;
  private effects = new Map<'sprite' | 'graphics', EffectAsset>();
  private templates = new Map<string, Material>();
  private materials = new Map<Material, UnitFogPolicy>();
  private bindings = new Map<Sprite | Graphics, UnitFogPolicy>();
  private policies = new WeakMap<Node, UnitFogPolicy>();
  private texture: UnitFogMaskState['texture'] | null = null;
  private signature = '';
  private uvX = new Vec4(0, 0, 0, 0);
  private uvY = new Vec4(0, 0, 0, 0);
  private bounds = new Vec4();
  private shape = new Vec4();

  constructor(onReady: () => void) {
    for (const kind of ['sprite', 'graphics'] as const) {
      resources.load(`effects/unit-fog-${kind}`, EffectAsset, (error, effect) => {
        if (this.disposed) return;
        if (error || !effect) { console.warn(`[UnitFog] ${kind} shader unavailable`, error); return; }
        this.effects.set(kind, effect);
        onReady();
      });
    }
  }

  get ready(): boolean { return !this.disposed && this.effects.size === 2 && (!this.enabled || !!this.state); }
  policyOf(node: Node): UnitFogPolicy { return this.policies.get(node) ?? 'hidden'; }

  bindTree(node: Node, policy: UnitFogPolicy): void {
    this.policies.set(node, policy);
    // A water/foliage stencil's own renderer must retain its mask material.
    if (!node.getComponent(Mask)) {
      const renderer = node.getComponent(Sprite) ?? node.getComponent(Graphics);
      if (renderer) this.bind(renderer, policy);
    }
    for (const child of node.children) this.bindTree(child, policy);
  }

  bind(renderer: Sprite | Graphics, policy: UnitFogPolicy): void {
    this.policies.set(renderer.node, policy);
    if (policy === 'unmasked') {
      if (this.bindings.has(renderer)) renderer.customMaterial = null;
      this.bindings.delete(renderer);
      return;
    }
    const kind = renderer instanceof Sprite ? 'sprite' : 'graphics';
    const effect = this.effects.get(kind);
    if (!effect) return;
    const key = `${kind}:${policy}`;
    let material = this.templates.get(key);
    if (!material) {
      material = new Material();
      material.initialize({ effectAsset: effect, defines: kind === 'sprite' ? { USE_TEXTURE: true } : {} });
      this.templates.set(key, material);
      this.configure(material, policy);
    }
    if (renderer.customMaterial !== material) renderer.customMaterial = material;
    this.bindings.set(renderer, policy);
    const rendered = renderer.getRenderMaterial(0);
    if (rendered && rendered !== material) this.configure(rendered, policy);
  }

  configure(material: Material, policy: UnitFogPolicy): void {
    if (this.disposed) return;
    // Outline copies and stencil instances are rebound while units move.
    // update() already propagates changed fog/camera uniforms to known materials.
    if (this.materials.get(material) === policy) return;
    this.materials.set(material, policy);
    this.apply(material, policy);
  }

  update(state: UnitFogMaskState | null, enabled: boolean): void {
    if (this.disposed) return;
    this.state = state;
    this.enabled = enabled;
    let signature = 'disabled';
    if (state && enabled && state.quad.isValid) {
      const size = state.quad.getComponent(UITransform)!.contentSize;
      const uv = unitFogWorldUV(state.quad.worldMatrix, size.width, size.height);
      if (uv) {
        this.uvX.set(uv.x[0], uv.x[1], uv.x[2], 1);
        this.uvY.set(uv.y[0], uv.y[1], uv.y[2], 0);
        const d = state.data;
        this.bounds.set(d.left, d.top, d.spanX, d.spanY);
        this.shape.set(state.params.x, state.params.y, state.params.z, state.params.w);
        signature = [...uv.x, ...uv.y, d.left, d.top, d.spanX, d.spanY,
          state.params.x, state.params.y, state.params.z, state.params.w].join(',');
      } else this.uvX.w = 0;
    } else this.uvX.w = 0;
    const texture = state?.texture ?? null;
    const changed = signature !== this.signature || texture !== this.texture;
    this.signature = signature;
    this.texture = texture;
    // Stencil state may create a Cocos material instance after initial binding.
    for (const [renderer, policy] of this.bindings) {
      if (!renderer.isValid || !renderer.node?.isValid) { this.bindings.delete(renderer); continue; }
      const material = renderer.getRenderMaterial(0);
      if (material && this.materials.get(material) !== policy) this.configure(material, policy);
    }
    if (changed) for (const [material, policy] of this.materials) {
      if (!material.isValid) { this.materials.delete(material); continue; }
      this.apply(material, policy);
    }
  }

  private apply(material: Material, policy: UnitFogPolicy): void {
    const x = new Vec4(this.uvX.x, this.uvX.y, this.uvX.z, policy === 'unmasked' ? 0 : this.uvX.w);
    const y = new Vec4(this.uvY.x, this.uvY.y, this.uvY.z, policy === 'known' ? 1 : 0);
    if (this.state?.texture) material.setProperty('unitFogTexture', this.state.texture);
    material.setProperty('unitFogUvX', x);
    material.setProperty('unitFogUvY', y);
    material.setProperty('unitFogBounds', this.bounds);
    material.setProperty('unitFogShape', this.shape);
  }

  clear(): void {
    const owned = new Set(this.templates.values());
    for (const renderer of this.bindings.keys()) {
      if (renderer.isValid && renderer.node?.isValid && owned.has(renderer.customMaterial)) renderer.customMaterial = null;
    }
    this.bindings.clear(); this.policies = new WeakMap();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    // Texture ownership stays with FogOverlayRenderer.
    for (const material of this.templates.values()) material.destroy();
    this.templates.clear(); this.materials.clear(); this.effects.clear();
    this.state = null; this.texture = null;
  }
}
