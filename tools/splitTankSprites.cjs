const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const unitsDir = path.join(__dirname, "..", "assets", "resources", "textures", "units");
const outPreview = path.join(__dirname, "..", "assets", "resources", "textures", "units", "_split_preview.png");

const profiles = {
  sherman_top: {
    turret: { cx: 306, cy: 102, rx: 72, ry: 58 },
    barrel: { x0: 92, y0: 76, x1: 252, y1: 111, r: 14 },
    mantlet: { cx: 244, cy: 96, rx: 24, ry: 24 },
  },
  panzer3_top: {
    turret: { cx: 306, cy: 101, rx: 92, ry: 65 },
    barrel: { x0: 106, y0: 78, x1: 254, y1: 111, r: 17 },
    mantlet: { cx: 246, cy: 95, rx: 28, ry: 28 },
  },
  panzer4_top: {
    turret: { cx: 306, cy: 100, rx: 92, ry: 68 },
    barrel: { x0: 112, y0: 76, x1: 256, y1: 111, r: 18 },
    mantlet: { cx: 247, cy: 96, rx: 28, ry: 29 },
  },
  tiger_top: {
    turret: { cx: 324, cy: 92, rx: 92, ry: 76 },
    barrel: { x0: 0, y0: 83, x1: 278, y1: 111, r: 14 },
    mantlet: { cx: 274, cy: 97, rx: 30, ry: 31 },
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inEllipse(x, y, ellipse) {
  const nx = (x - ellipse.cx) / ellipse.rx;
  const ny = (y - ellipse.cy) / ellipse.ry;
  return nx * nx + ny * ny <= 1;
}

function inRoundedRect(x, y, rect) {
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  const cy = (y0 + y1) * 0.5;
  const leftDx = x - x0;
  const rightDx = x - x1;
  const dy = y - cy;
  return (leftDx * leftDx + dy * dy <= rect.r * rect.r)
    || (rightDx * rightDx + dy * dy <= rect.r * rect.r);
}

function isTurretPixel(x, y, profile) {
  return inEllipse(x, y, profile.turret)
    || inRoundedRect(x, y, profile.barrel)
    || inEllipse(x, y, profile.mantlet);
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

async function splitSprite(name, profile) {
  const inputPath = path.join(unitsDir, `${name}.png`);
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hull = Buffer.from(data);
  const turret = Buffer.from(data);

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const alpha = data[i + 3];
      const inTurret = alpha > 8 && isTurretPixel(x, y, profile);
      if (inTurret) {
        hull[i + 3] = 0;
      } else {
        turret[i + 3] = 0;
      }
    }
  }

  const hullName = `${name}_hull`;
  const turretName = `${name}_turret`;
  const hullPath = path.join(unitsDir, `${hullName}.png`);
  const turretPath = path.join(unitsDir, `${turretName}.png`);
  await sharp(hull, { raw: info }).png().toFile(hullPath);
  await sharp(turret, { raw: info }).png().toFile(turretPath);
  await writeMeta(name, hullName);
  await writeMeta(name, turretName);
  return { name, hullPath, turretPath };
}

async function makePreview(results) {
  const rowW = 606;
  const rowH = 198;
  const scale = 0.45;
  const cellW = Math.round(rowW * scale);
  const cellH = Math.round(rowH * scale);
  const gap = 18;
  const labelH = 22;
  const cols = 5;
  const width = cols * cellW + (cols + 1) * gap;
  const height = results.length * (cellH + labelH + gap) + gap;
  const composites = [];
  const fitCell = async (input, background = { r: 0, g: 0, b: 0, alpha: 0 }) => {
    const resized = await sharp(input)
      .resize({ width: cellW, height: cellH, fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    return sharp({
      create: { width: cellW, height: cellH, channels: 4, background },
    }).composite([{
      input: resized,
      left: Math.floor((cellW - (meta.width ?? cellW)) / 2),
      top: Math.floor((cellH - (meta.height ?? cellH)) / 2),
    }]).png().toBuffer();
  };

  for (let row = 0; row < results.length; row++) {
    const { name, hullPath, turretPath } = results[row];
    const originalPath = path.join(unitsDir, `${name}.png`);
    const top = gap + row * (cellH + labelH + gap) + labelH;
    const original = await fitCell(originalPath, "#ece8dc");
    const hull = await fitCell(hullPath, "#ece8dc");
    const turret = await fitCell(turretPath, "#ece8dc");
    const recomposedFull = await sharp({
      create: { width: rowW, height: rowH, channels: 4, background: "#ece8dc" },
    })
      .composite([{ input: hullPath }, { input: turretPath }])
      .png()
      .toBuffer();
    const recomposed = await fitCell(recomposedFull);
    const rotatedTurret = await sharp(turretPath)
      .rotate(28, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
      .then(fitCell);
    const rotated = await sharp({
      create: { width: cellW, height: cellH, channels: 4, background: "#ece8dc" },
    })
      .composite([
        { input: await fitCell(hullPath) },
        { input: rotatedTurret, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();

    const cells = [original, hull, turret, recomposed, rotated];
    for (let col = 0; col < cols; col++) {
      composites.push({
        input: cells[col],
        left: gap + col * (cellW + gap),
        top,
      });
    }
  }

  await sharp({
    create: { width, height, channels: 4, background: "#2d302b" },
  }).composite(composites).png().toFile(outPreview);
  await writeMeta("sherman_top", "_split_preview");
}

(async () => {
  const results = [];
  for (const [name, profile] of Object.entries(profiles)) {
    const result = await splitSprite(name, profile);
    results.push(result);
    console.log(`${name}:`);
    console.log(`  ${path.relative(process.cwd(), result.hullPath)}`);
    console.log(`  ${path.relative(process.cwd(), result.turretPath)}`);
  }
  await makePreview(results);
  console.log(`preview: ${path.relative(process.cwd(), outPreview)}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
