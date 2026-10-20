import { Color, EffectAsset, Graphics, Mask, Material, Node, Rect, resources, Size, Sprite, SpriteFrame, Texture2D, UITransform, Vec4 } from 'cc';
import type { FogMaskCell } from './FogMaskRaster';

export interface FogWeatherFootprint {
  left: number; top: number; spanX: number; spanY: number;
  /** Six counterclockwise vertices per hex, in map coordinates. */
  vertices: Float32Array;
}

/** Exact geometry: never magnify a low-resolution binary coverage texture. */
export function buildFogWeatherFootprint(cells: readonly FogMaskCell[]): FogWeatherFootprint {
  if (!cells.length) throw new Error('Cannot build an empty weather fog footprint');
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
  const vertices = new Float32Array(cells.length * 12);
  const halfWidth = Math.sqrt(3) / 2;
  // Exact half-integer Y offsets keep adjoining hexes on identical vertices.
  const corners = [[halfWidth, -0.5], [halfWidth, 0.5], [0, 1], [-halfWidth, 0.5], [-halfWidth, -0.5], [0, -1]];
  for (let cell = 0; cell < cells.length; cell++) {
    const c = cells[cell];
    for (let i = 0; i < 6; i++) {
      const x = c.x + corners[i][0], y = c.y + corners[i][1];
      vertices[cell * 12 + i * 2] = x;
      vertices[cell * 12 + i * 2 + 1] = y;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.max(top, y); bottom = Math.min(bottom, y);
    }
  }
  const padding = 0.125;
  return { left: left - padding, top: top + padding,
    spanX: right - left + padding * 2, spanY: top - bottom + padding * 2, vertices };
}

/** Weather only: cached geometric stencil and one animated Sprite, below labels. */
export class FogWeatherRenderer {
  private clipNode: Node | null;
  private clipGraphics: Graphics | null;
  private quad: Node | null;
  private sprite: Sprite | null;
  private material: Material | null = null;
  private texture: Texture2D | null = null;
  private frame: SpriteFrame | null = null;
  private data: FogWeatherFootprint | null = null;
  private cells: readonly FogMaskCell[] | null = null;
  private disposed = false;
  private readonly bounds = new Vec4();
  private readonly params = new Vec4();
  private readonly origin = new Vec4();

  constructor(parent: Node) {
    const clip = new Node('FogWeatherFootprint');
    this.clipNode = clip;
    clip.layer = parent.layer;
    parent.addChild(clip);
    clip.addComponent(UITransform);
    const mask = clip.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    this.clipGraphics = mask.subComp as Graphics;
    clip.active = false;
    const quad = new Node('FogWeatherLayer');
    this.quad = quad;
    quad.layer = parent.layer;
    clip.addChild(quad);
    quad.addComponent(UITransform);
    this.sprite = quad.addComponent(Sprite);
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.sprite.color = new Color(194, 207, 214, 255);
    quad.active = false;
    resources.load('effects/weather-fog', EffectAsset, (error, effect) => {
      if (this.disposed || !this.quad?.isValid || !this.sprite?.isValid) return;
      if (error || !effect) {
        console.warn('Weather fog shader unavailable', error);
        return;
      }
      this.material = new Material();
      this.material.initialize({ effectAsset: effect, defines: { USE_TEXTURE: true } });
      this.sprite.customMaterial = this.material;
    });
  }

  hide(): void {
    if (this.clipNode?.isValid) this.clipNode.active = false;
  }

  draw(cells: readonly FogMaskCell[], size: number, offsetX: number, offsetY: number, time: number, playerX: number, playerY: number): void {
    if (this.disposed || !this.clipNode?.isValid || !this.quad?.isValid || !this.sprite?.isValid || !this.material) return;
    if (!cells.length) { this.hide(); return; }
    if (this.cells !== cells) {
      const d = buildFogWeatherFootprint(cells);
      const centerX = d.left + d.spanX / 2, centerY = d.top - d.spanY / 2;
      const g = this.clipGraphics!;
      g.clear();
      g.fillColor = new Color(255, 255, 255, 0);
      for (let start = 0; start < d.vertices.length; start += 12) {
        for (let i = 0; i < 6; i++) {
          const x = d.vertices[start + i * 2] - centerX;
          const y = d.vertices[start + i * 2 + 1] - centerY;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.close();
        g.fill();
      }
      this.clipNode.getComponent(UITransform)!.setContentSize(d.spanX, d.spanY);
      this.quad.getComponent(UITransform)!.setContentSize(d.spanX, d.spanY);
      this.data = d;
      this.cells = cells;
      this.bounds.set(d.left, d.top, d.spanX, d.spanY);
    }
    if (!this.texture) {
      // Sprite needs a frame, but map coverage now comes from the stencil.
      this.texture = new Texture2D();
      this.texture.reset({ width: 1, height: 1, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 1 });
      this.texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      this.texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
      this.texture.uploadData(new Uint8Array([255, 255, 255, 255]));
      this.frame = new SpriteFrame();
      this.frame.packable = false;
      this.frame.reset({ texture: this.texture, rect: new Rect(0, 0, 1, 1), originalSize: new Size(1, 1) }, true);
      this.sprite.spriteFrame = this.frame;
    }
    const d = this.data!;
    this.clipNode.setScale(size, size, 1);
    this.clipNode.setPosition((d.left + d.spanX / 2) * size + offsetX, (d.top - d.spanY / 2) * size + offsetY);
    this.params.set(Math.max(0, time), 0.05, 0.20, 0.10);
    this.origin.set(playerX, playerY, 0, 0);
    this.material.setProperty('mapBounds', this.bounds);
    this.material.setProperty('weatherParams', this.params);
    this.material.setProperty('fogOrigin', this.origin);
    const rendered = this.sprite.getRenderMaterial(0);
    if (rendered && rendered !== this.material) {
      rendered.setProperty('mapBounds', this.bounds);
      rendered.setProperty('weatherParams', this.params);
      rendered.setProperty('fogOrigin', this.origin);
    }
    this.quad.active = true;
    this.clipNode.active = true;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.clipNode?.isValid) this.clipNode.destroy();
    this.frame?.destroy(); this.texture?.destroy(); this.material?.destroy();
    this.quad = null; this.sprite = null; this.frame = null;
    this.clipNode = null; this.clipGraphics = null;
    this.texture = null; this.material = null; this.data = null; this.cells = null;
  }
}
