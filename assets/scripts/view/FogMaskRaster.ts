/** Rendering-only data: coordinates use a hex radius of one, Y points up. */
export interface FogMaskCell { x: number; y: number; from: number; to: number; }
export interface FogMaskData {
  width: number; height: number; left: number; top: number;
  spanX: number; spanY: number; pixels: Uint8Array;
}

/** Sliding-window separable blur, linear in pixel count regardless of radius. */
function boxBlur(input: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(input.length), output = new Float32Array(input.length);
  const count = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += input[row + Math.max(0, Math.min(width - 1, x))];
    for (let x = 0; x < width; x++) {
      temp[row + x] = sum / count;
      sum += input[row + Math.min(width - 1, x + radius + 1)] - input[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += temp[Math.max(0, Math.min(height - 1, y)) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / count;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return output;
}

/** A small shared field rounds both convex corners and concave hex joins.
 * R/G store animation endpoints; B clips to the original map footprint.
 * Normalized convolution prevents absent/deep-shadow cells darkening map edges. */
export function buildFogMask(cells: readonly FogMaskCell[]): FogMaskData {
  if (!cells.length) throw new Error('Cannot rasterize an empty fog map');
  const halfWidth = Math.sqrt(3) / 2;
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
  for (const c of cells) {
    left = Math.min(left, c.x - halfWidth); right = Math.max(right, c.x + halfWidth);
    top = Math.max(top, c.y + 1); bottom = Math.min(bottom, c.y - 1);
  }
  // Sixteen samples per hex diameter; at most 512 pixels per axis.
  // Soft boundaries need much less resolution than the underlying terrain.
  const step = Math.max(1 / 8, (right - left) / 508, (top - bottom) / 508);
  left -= step * 2; top += step * 2;
  const width = Math.min(512, Math.ceil((right - left) / step) + 2);
  const height = Math.min(512, Math.ceil((top - bottom) / step) + 2);
  const n = width * height;
  const from = new Float32Array(n), to = new Float32Array(n), coverage = new Float32Array(n);
  for (const c of cells) {
    const y0 = Math.max(0, Math.floor((top - c.y - 1) / step));
    const y1 = Math.min(height - 1, Math.ceil((top - c.y + 1) / step));
    for (let y = y0; y <= y1; y++) {
      const dy = Math.abs(top - (y + 0.5) * step - c.y);
      if (dy > 1) continue;
      const extent = halfWidth * Math.min(1, 2 * (1 - dy));
      const x0 = Math.max(0, Math.ceil((c.x - extent - left) / step - 0.5));
      const x1 = Math.min(width - 1, Math.floor((c.x + extent - left) / step - 0.5));
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        coverage[i] = 1; from[i] = c.from; to[i] = c.to;
      }
    }
  }
  // Three box passes approximate a Gaussian with sigma about 0.28 hex radii.
  const radius = Math.max(1, Math.round(0.28 / step));
  const blur = (field: Float32Array) => {
    for (let pass = 0; pass < 3; pass++) field = boxBlur(field, width, height, radius);
    return field;
  };
  const weight = blur(coverage), a = blur(from), b = blur(to);
  const pixels = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = Math.max(weight[i], 0.000001);
    pixels[i * 4] = Math.round(Math.max(0, Math.min(1, a[i] / w)) * 255);
    pixels[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, b[i] / w)) * 255);
    pixels[i * 4 + 2] = coverage[i] * 255;
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, left, top, spanX: width * step, spanY: height * step, pixels };
}
