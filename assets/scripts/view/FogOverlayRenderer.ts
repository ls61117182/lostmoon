import { Color, EffectAsset, Material, Node, Rect, resources, Size, Sprite, SpriteFrame, Texture2D, UITransform, Vec4 } from 'cc';
import { buildFogMask, FogMaskCell, FogMaskData } from './FogMaskRaster';

/** One cached low-resolution texture and one draw. Animation changes uniforms only. */
export class FogOverlayRenderer {
  private sprite: Sprite | null;
  private quad: Node | null;
  private texture: Texture2D | null = null;
  private frame: SpriteFrame | null = null;
  private material: Material | null = null;
  private signature = '';
  private data: FogMaskData | null = null;
  private disposed = false;
  private params = new Vec4();

  constructor(private node: Node, onReady: () => void) {
    const quad = new Node('ContinuousFogMask');
    this.quad = quad;
    quad.layer = node.layer;
    node.addChild(quad);
    quad.addComponent(UITransform);
    this.sprite = quad.addComponent(Sprite);
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    quad.active = false;
    resources.load('effects/fog-overlay', EffectAsset, (error, effect) => {
      if (this.disposed || !this.node.isValid || !this.quad?.isValid || !this.sprite?.isValid) return;
      if (error || !effect) { console.warn('Fog shader unavailable; using hex overlay', error); return; }
      this.material = new Material();
      this.material.initialize({ effectAsset: effect, defines: { USE_TEXTURE: true } });
      this.sprite.customMaterial = this.material;
      onReady();
    });
  }

  draw(cells: readonly FogMaskCell[], size: number, offsetX: number, offsetY: number, progress: number, tint: Color): boolean {
    if (!this.material || this.disposed || !this.quad?.isValid || !this.sprite?.isValid) return false;
    if (!cells.length) { this.quad.active = false; return true; }
    // Neither animation progress nor camera/size changes invalidate pixel data.
    const signature = cells.map(c => `${c.x},${c.y},${c.from},${c.to}`).join('|');
    if (signature !== this.signature) {
      const d = buildFogMask(cells);
      if (!this.data || this.data.width !== d.width || this.data.height !== d.height) {
        // Cocos caches texture bindings by Texture2D identity. reset() destroys
        // its GPU view without invalidating that cache: never reset a bound
        // texture. A new map size gets a new identity; movement only uploads.
        const oldTexture = this.texture, oldFrame = this.frame;
        this.texture = new Texture2D();
        this.texture.reset({ width: d.width, height: d.height, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 1 });
        this.texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        this.texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        this.texture.uploadData(d.pixels);
        this.frame = new SpriteFrame();
        this.frame.packable = false;
        this.frame.reset({ texture: this.texture, rect: new Rect(0, 0, d.width, d.height), originalSize: new Size(d.width, d.height) }, true);
        this.sprite.spriteFrame = this.frame;
        oldFrame?.destroy(); oldTexture?.destroy();
      } else {
        this.texture!.uploadData(d.pixels);
      }
      this.data = d;
      this.signature = signature;
      this.material.setProperty('maskBounds', new Vec4(d.left, d.top, d.spanX, d.spanY));
    }
    const d = this.data!;
    this.quad.active = true;
    this.quad.getComponent(UITransform)!.setContentSize(d.spanX * size, d.spanY * size);
    this.quad.setPosition((d.left + d.spanX / 2) * size + offsetX, (d.top - d.spanY / 2) * size + offsetY);
    this.sprite.color = tint;
    this.params.set(Math.max(0, Math.min(1, progress)), 0.055, 0.25, 0.75);
    this.material.setProperty('fogParams', this.params);
    // Cocos may instantiate a render material when stencil state changes.
    const rendered = this.sprite.getRenderMaterial(0);
    if (rendered && rendered !== this.material) {
      rendered.setProperty('fogParams', this.params);
      rendered.setProperty('maskBounds', new Vec4(d.left, d.top, d.spanX, d.spanY));
    }
    return true;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    // The parent scene may already have destroyed this component. Setting its
    // material here would invoke updateMaterial on cleared engine internals.
    // Component destruction clears Sprite.node. Keep our own node reference
    // rather than dereferencing that component during scene teardown.
    if (this.quad?.isValid) this.quad.destroy();
    this.frame?.destroy(); this.texture?.destroy(); this.material?.destroy();
    this.frame = null; this.texture = null; this.material = null;
    this.quad = null; this.sprite = null;
    this.data = null;
  }
}
