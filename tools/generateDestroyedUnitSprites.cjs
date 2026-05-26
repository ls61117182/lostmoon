const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const unitsDir = path.join(__dirname, "..", "assets", "resources", "textures", "units");
const sprites = ["panzer3_top", "panzer4_top", "sherman_top", "tiger_top", "truck_top"];

function hashSeed(text) {
  let seed = 2166136261;
  for (const ch of text) {
    seed ^= ch.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function noise(seed, x, y) {
  let n = seed ^ Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 2246822519, 3266489917);
  n ^= n >>> 13;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function damageProfile(name, width, height) {
  const turretX = name === "tiger_top" ? 0.55 : 0.5;
  return [
    { cx: width * turretX, cy: height * 0.5, rx: width * 0.12, ry: height * 0.25, strength: 1.1 },
    { cx: width * 0.72, cy: height * 0.45, rx: width * 0.11, ry: height * 0.28, strength: 0.95 },
    { cx: width * 0.32, cy: height * 0.56, rx: width * 0.13, ry: height * 0.22, strength: 0.8 },
    { cx: width * 0.54, cy: height * 0.18, rx: width * 0.08, ry: height * 0.16, strength: 0.65 },
  ];
}

function burnPixel(r, g, b, d, strength, edgeNoise) {
  const core = clamp((1 - d) * strength, 0, 1);
  const char = 1 - core * 0.86;
  const ember = d > 0.24 && d < 0.42 && edgeNoise > 0.56 ? 1 : 0;
  let nr = r * char;
  let ng = g * char;
  let nb = b * char;
  if (ember) {
    nr = Math.max(nr, 128 + edgeNoise * 70);
    ng = Math.max(ng, 42 + edgeNoise * 30);
    nb = Math.min(nb, 24);
  }
  return [nr, ng, nb];
}

function drawLine(buf, width, height, alpha, x0, y0, x1, y1, seed) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        if (alpha[i + 3] < 16 || noise(seed, px, py) < 0.24) continue;
        const center = ox === 0 && oy === 0;
        buf[i] = center ? 18 : Math.min(buf[i], 38);
        buf[i + 1] = center ? 17 : Math.min(buf[i + 1], 34);
        buf[i + 2] = center ? 14 : Math.min(buf[i + 2], 30);
        if (center && noise(seed ^ 0x9e3779b9, px, py) > 0.72) {
          buf[i] = 170;
          buf[i + 1] = 62;
          buf[i + 2] = 20;
        }
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

async function writeMeta(sourceName, outputName) {
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

async function generateDestroyedSprite(name) {
  const inputPath = path.join(unitsDir, `${name}.png`);
  const outputName = `${name}_destroyed`;
  const outputPath = path.join(unitsDir, `${outputName}.png`);
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const alpha = Buffer.from(data);
  const seed = hashSeed(name);
  const burns = damageProfile(name, info.width, info.height);

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const a = data[i + 3];
      if (a < 8) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      const grain = (noise(seed, x, y) - 0.5) * 24;
      out[i] = clamp(lum * 0.42 + r * 0.22 + grain);
      out[i + 1] = clamp(lum * 0.42 + g * 0.2 + grain);
      out[i + 2] = clamp(lum * 0.4 + b * 0.18 + grain);

      for (const burn of burns) {
        const nx = (x - burn.cx) / burn.rx;
        const ny = (y - burn.cy) / burn.ry;
        const rough = (noise(seed ^ 0xa53a9b1d, Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 0.32;
        const d = nx * nx + ny * ny + rough;
        if (d < 1) {
          const burned = burnPixel(out[i], out[i + 1], out[i + 2], d, burn.strength, noise(seed ^ 0x7f4a7c15, x, y));
          out[i] = clamp(burned[0]);
          out[i + 1] = clamp(burned[1]);
          out[i + 2] = clamp(burned[2]);
        }
        if (d < 0.16 && noise(seed ^ 0x4cf5ad43, x, y) > 0.34) {
          out[i] = 4;
          out[i + 1] = 4;
          out[i + 2] = 4;
          out[i + 3] = Math.floor(a * 0.18);
        }
      }
    }
  }

  const crackSets = [
    [0.42, 0.35, 0.6, 0.67],
    [0.62, 0.42, 0.76, 0.22],
    [0.34, 0.62, 0.25, 0.38],
    [0.5, 0.22, 0.45, 0.78],
  ];
  crackSets.forEach((line, index) => {
    const wobble = noise(seed, index, 1) * 0.08 - 0.04;
    drawLine(
      out,
      info.width,
      info.height,
      alpha,
      Math.round(info.width * (line[0] + wobble)),
      Math.round(info.height * line[1]),
      Math.round(info.width * (line[2] - wobble)),
      Math.round(info.height * line[3]),
      seed ^ index
    );
  });

  await sharp(out, { raw: info }).png().toFile(outputPath);
  await writeMeta(name, outputName);
  return outputPath;
}

(async () => {
  for (const sprite of sprites) {
    const output = await generateDestroyedSprite(sprite);
    console.log(output);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
