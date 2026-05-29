const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const workspace = path.join(__dirname, "..");
const unitsDir = path.join(workspace, "assets", "resources", "textures", "units");
const sourceName = "sherman_top";
const defaultMaskPath = "F:/Work/AI游戏/孤胆谢尔曼/9d1e2e5f-80b3-4eb4-b3d0-66df4f600c06.png";
const maskPath = process.argv[2] || defaultMaskPath;

function isRed(r, g, b, a) {
  return a > 24 && r > 180 && g < 85 && b < 85 && r > g * 2.2 && r > b * 2.2;
}

function dilate(mask, width, height, radius) {
  const out = new Uint8Array(mask.length);
  const r2 = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = false;
      for (let oy = -radius; oy <= radius && !on; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > r2) continue;
          const xx = x + ox;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            on = true;
            break;
          }
        }
      }
      out[y * width + x] = on ? 1 : 0;
    }
  }
  return out;
}

function fillClosedRegions(redMask, width, height) {
  const blocked = redMask;
  const outside = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (outside[i] || blocked[i]) return;
    outside[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width;
    const y = Math.floor(i / width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) {
    filled[i] = (!outside[i] || redMask[i]) ? 1 : 0;
  }
  return filled;
}

function shouldFillHullHole(source, holeMask, width, height, x, y) {
  const maxDist = 18;
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  for (let d = 1; d <= maxDist; d++) {
    if (!up && y - d >= 0) {
      const mi = (y - d) * width + x;
      const i = mi * 4;
      up = !holeMask[mi] && source[i + 3] > 8;
    }
    if (!down && y + d < height) {
      const mi = (y + d) * width + x;
      const i = mi * 4;
      down = !holeMask[mi] && source[i + 3] > 8;
    }
    if (!left && x - d >= 0) {
      const mi = y * width + (x - d);
      const i = mi * 4;
      left = !holeMask[mi] && source[i + 3] > 8;
    }
    if (!right && x + d < width) {
      const mi = y * width + (x + d);
      const i = mi * 4;
      right = !holeMask[mi] && source[i + 3] > 8;
    }
  }
  return (up && down) || (left && right);
}

function columnCounts(mask, width, height) {
  const counts = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) counts[x]++;
    }
  }
  return counts;
}


function fillHullHolesFromNearest(source, hull, holeMask, width, height) {
  const seen = new Uint8Array(width * height);
  const nearest = new Int32Array(width * height);
  nearest.fill(-1);
  const queue = [];

  const pushSeed = (mi) => {
    seen[mi] = 1;
    nearest[mi] = mi;
    queue.push(mi);
  };
  const tryPush = (from, x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const mi = y * width + x;
    if (seen[mi]) return;
    seen[mi] = 1;
    nearest[mi] = nearest[from];
    queue.push(mi);
  };

  for (let mi = 0; mi < width * height; mi++) {
    const i = mi * 4;
    if (!holeMask[mi] && source[i + 3] > 8) pushSeed(mi);
  }

  for (let head = 0; head < queue.length; head++) {
    const mi = queue[head];
    const x = mi % width;
    const y = Math.floor(mi / width);
    tryPush(mi, x + 1, y);
    tryPush(mi, x - 1, y);
    tryPush(mi, x, y + 1);
    tryPush(mi, x, y - 1);
  }

  for (let mi = 0; mi < width * height; mi++) {
    if (!holeMask[mi]) continue;
    const si = nearest[mi] * 4;
    if (si < 0) continue;
    const i = mi * 4;
    hull[i] = source[si];
    hull[i + 1] = source[si + 1];
    hull[i + 2] = source[si + 2];
    hull[i + 3] = Math.max(source[i + 3], source[si + 3]);
  }
}

function smoothHullHoleFill(hull, holeMask, width, height, iterations = 28) {
  const next = Buffer.from(hull);
  for (let pass = 0; pass < iterations; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const mi = y * width + x;
        if (!holeMask[mi]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= height) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= width) continue;
            const ni = (yy * width + xx) * 4;
            if (hull[ni + 3] <= 8) continue;
            const weight = ox === 0 && oy === 0 ? 2 : 1;
            r += hull[ni] * weight;
            g += hull[ni + 1] * weight;
            b += hull[ni + 2] * weight;
            a += hull[ni + 3] * weight;
            n += weight;
          }
        }
        if (n <= 0) continue;
        const i = mi * 4;
        next[i] = Math.round(r / n);
        next[i + 1] = Math.round(g / n);
        next[i + 2] = Math.round(b / n);
        next[i + 3] = Math.round(a / n);
      }
    }
    for (let mi = 0; mi < width * height; mi++) {
      if (!holeMask[mi]) continue;
      const i = mi * 4;
      hull[i] = next[i];
      hull[i + 1] = next[i + 1];
      hull[i + 2] = next[i + 2];
      hull[i + 3] = next[i + 3];
    }
  }
}

function fillHullHolesFromLocalAverage(source, hull, holeMask, width, height) {
  const stride = width + 1;
  const area = (width + 1) * (height + 1);
  const sums = [
    new Float64Array(area),
    new Float64Array(area),
    new Float64Array(area),
    new Float64Array(area),
    new Float64Array(area),
  ];

  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const srcMi = (y - 1) * width + (x - 1);
      const srcI = srcMi * 4;
      const valid = !holeMask[srcMi] && source[srcI + 3] > 8;
      const values = valid
        ? [source[srcI], source[srcI + 1], source[srcI + 2], source[srcI + 3], 1]
        : [0, 0, 0, 0, 0];
      const ii = y * stride + x;
      const left = ii - 1;
      const up = ii - stride;
      const diag = up - 1;
      for (let c = 0; c < sums.length; c++) {
        sums[c][ii] = values[c] + sums[c][left] + sums[c][up] - sums[c][diag];
      }
    }
  }

  const query = (sum, x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(width, x0));
    y0 = Math.max(0, Math.min(height, y0));
    x1 = Math.max(0, Math.min(width, x1));
    y1 = Math.max(0, Math.min(height, y1));
    const a = y0 * stride + x0;
    const b = y0 * stride + x1;
    const c = y1 * stride + x0;
    const d = y1 * stride + x1;
    return sum[d] - sum[b] - sum[c] + sum[a];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mi = y * width + x;
      if (!holeMask[mi]) continue;
      let count = 0;
      let radius = 10;
      let channels = [0, 0, 0, 0];
      while (radius <= 80) {
        const x0 = x - radius;
        const y0 = y - radius;
        const x1 = x + radius + 1;
        const y1 = y + radius + 1;
        count = query(sums[4], x0, y0, x1, y1);
        if (count > 12) {
          channels = [
            query(sums[0], x0, y0, x1, y1) / count,
            query(sums[1], x0, y0, x1, y1) / count,
            query(sums[2], x0, y0, x1, y1) / count,
            query(sums[3], x0, y0, x1, y1) / count,
          ];
          break;
        }
        radius += 10;
      }
      if (count <= 0) continue;
      const i = mi * 4;
      hull[i] = Math.round(channels[0]);
      hull[i + 1] = Math.round(channels[1]);
      hull[i + 2] = Math.round(channels[2]);
      hull[i + 3] = Math.max(source[i + 3], Math.round(channels[3]));
    }
  }
}

function fillHullHolesFromRows(source, hull, holeMask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!holeMask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return;
  const sampleX0 = Math.max(0, minX - 36);
  const sampleX1 = Math.min(width - 1, maxX + 36);

  const rowColors = Array.from({ length: height }, () => null);
  const sampleRow = (y0, y1) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = sampleX0; x <= sampleX1; x++) {
        const mi = y * width + x;
        const i = mi * 4;
        if (holeMask[mi] || source[i + 3] <= 8) continue;
        r += source[i];
        g += source[i + 1];
        b += source[i + 2];
        a += source[i + 3];
        n++;
      }
    }
    if (n <= 0) return null;
    return [
      Math.round(r / n),
      Math.round(g / n),
      Math.round(b / n),
      Math.round(a / n),
    ];
  };

  for (let y = minY; y <= maxY; y++) {
    let color = null;
    for (let radius = 0; radius <= 24 && !color; radius += 2) {
      color = sampleRow(y - radius, y + radius);
    }
    rowColors[y] = color;
  }

  for (let y = minY; y <= maxY; y++) {
    const color = rowColors[y] || [190, 185, 105, 255];
    for (let x = minX; x <= maxX; x++) {
      const mi = y * width + x;
      if (!holeMask[mi]) continue;
      const i = mi * 4;
      hull[i] = color[0];
      hull[i + 1] = color[1];
      hull[i + 2] = color[2];
      hull[i + 3] = Math.max(source[i + 3], color[3]);
    }
  }
}

function fillHullHolesSolidAverage(source, hull, holeMask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!holeMask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return;
  const sampleX0 = Math.max(0, minX - 42);
  const sampleY0 = Math.max(0, minY - 24);
  const sampleX1 = Math.min(width - 1, maxX + 42);
  const sampleY1 = Math.min(height - 1, maxY + 24);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let y = sampleY0; y <= sampleY1; y++) {
    for (let x = sampleX0; x <= sampleX1; x++) {
      const mi = y * width + x;
      const i = mi * 4;
      if (holeMask[mi] || source[i + 3] <= 8) continue;
      r += source[i];
      g += source[i + 1];
      b += source[i + 2];
      a += source[i + 3];
      n++;
    }
  }
  const color = n > 0
    ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]
    : [190, 185, 105, 255];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const mi = y * width + x;
      if (!holeMask[mi]) continue;
      const i = mi * 4;
      hull[i] = color[0];
      hull[i + 1] = color[1];
      hull[i + 2] = color[2];
      hull[i + 3] = Math.max(source[i + 3], color[3]);
    }
  }
}


async function writeMeta(outputName) {
  const sourceMetaPath = path.join(unitsDir, `${sourceName}.png.meta`);
  const outputMetaPath = path.join(unitsDir, `${outputName}.png.meta`);
  const text = await fs.readFile(sourceMetaPath, "utf8");
  const meta = JSON.parse(text);
  const uuid = crypto.randomUUID();

  meta.uuid = uuid;
  for (const subMeta of Object.values(meta.subMetas || {})) {
    if (subMeta.uuid) {
      const suffix = subMeta.uuid.includes("@") ? subMeta.uuid.slice(subMeta.uuid.indexOf("@")) : "";
      subMeta.uuid = `${uuid}${suffix}`;
    }
    subMeta.displayName = outputName;
    if (subMeta.userData) {
      subMeta.userData.imageUuidOrDatabaseUri = uuid;
    }
  }

  await fs.writeFile(outputMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function main() {
  const sourcePath = path.join(unitsDir, `${sourceName}.png`);
  const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const maskImage = await sharp(maskPath)
    .resize(source.info.width, source.info.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const redMask = new Uint8Array(source.info.width * source.info.height);
  for (let y = 0; y < source.info.height; y++) {
    for (let x = 0; x < source.info.width; x++) {
      const i = (y * source.info.width + x) * 4;
      redMask[y * source.info.width + x] = isRed(
        maskImage.data[i],
        maskImage.data[i + 1],
        maskImage.data[i + 2],
        maskImage.data[i + 3],
      ) ? 1 : 0;
    }
  }

  const turretMask = fillClosedRegions(redMask, source.info.width, source.info.height);
  const turretColumnCounts = columnCounts(turretMask, source.info.width, source.info.height);
  const hull = Buffer.from(source.data);
  const turret = Buffer.from(source.data);
  const maskPreview = Buffer.alloc(source.info.width * source.info.height * 4);
  const hullHoleMask = new Uint8Array(source.info.width * source.info.height);

  for (let y = 0; y < source.info.height; y++) {
    for (let x = 0; x < source.info.width; x++) {
      const mi = y * source.info.width + x;
      const i = mi * 4;
      const sourceAlpha = source.data[i + 3];
      const inTurret = turretMask[mi] && sourceAlpha > 8;
      if (inTurret) {
        if (turretColumnCounts[x] >= 26) {
          hullHoleMask[mi] = 1;
        } else {
          hull[i + 3] = 0;
        }
      } else {
        turret[i + 3] = 0;
      }
      maskPreview[i] = inTurret ? 255 : 0;
      maskPreview[i + 1] = 0;
      maskPreview[i + 2] = inTurret ? 255 : 0;
      maskPreview[i + 3] = inTurret ? 220 : 0;
    }
  }
  fillHullHolesSolidAverage(source.data, hull, hullHoleMask, source.info.width, source.info.height);

  const hullName = `${sourceName}_hull`;
  const turretName = `${sourceName}_turret`;
  const maskName = `${sourceName}_turret_mask_filled`;
  const previewName = `${sourceName}_mask_split_preview`;
  const hullPath = path.join(unitsDir, `${hullName}.png`);
  const turretPath = path.join(unitsDir, `${turretName}.png`);
  const maskOutPath = path.join(unitsDir, `${maskName}.png`);
  const previewPath = path.join(unitsDir, `${previewName}.png`);

  await sharp(hull, { raw: source.info }).png().toFile(hullPath);
  await sharp(turret, { raw: source.info }).png().toFile(turretPath);
  await sharp(maskPreview, { raw: source.info }).png().toFile(maskOutPath);

  const cellW = source.info.width;
  const cellH = source.info.height;
  const gap = 16;
  const bg = "#ece8dc";
  const preview = await sharp({
    create: { width: cellW * 5 + gap * 6, height: cellH + gap * 2, channels: 4, background: "#2d302b" },
  }).composite([
    { input: await sharp(sourcePath).flatten({ background: bg }).png().toBuffer(), left: gap, top: gap },
    { input: await sharp(hullPath).flatten({ background: bg }).png().toBuffer(), left: gap * 2 + cellW, top: gap },
    { input: await sharp(turretPath).flatten({ background: bg }).png().toBuffer(), left: gap * 3 + cellW * 2, top: gap },
    {
      input: await sharp({ create: { width: cellW, height: cellH, channels: 4, background: bg } })
        .composite([{ input: hullPath }, { input: turretPath }])
        .png()
        .toBuffer(),
      left: gap * 4 + cellW * 3,
      top: gap,
    },
    {
      input: await sharp(sourcePath)
        .flatten({ background: bg })
        .composite([{ input: maskOutPath }])
        .png()
        .toBuffer(),
      left: gap * 5 + cellW * 4,
      top: gap,
    },
  ]).png().toBuffer();
  await sharp(preview).png().toFile(previewPath);

  for (const name of [hullName, turretName, maskName, previewName]) {
    await writeMeta(name);
  }

  console.log(path.relative(workspace, hullPath));
  console.log(path.relative(workspace, turretPath));
  console.log(path.relative(workspace, maskOutPath));
  console.log(path.relative(workspace, previewPath));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
