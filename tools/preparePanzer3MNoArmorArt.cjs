// Derive the no-Schurzen variant from the approved Ausf. M source art.
// The approved M sources remain intact except at the user's marked thin
// add-on rails and braces. Armor plates, track housings and the rest remain
// original pixels. The image edit supplies only the rail-free turret silhouette.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'source_art/tanks/panzer3_m');
const target = path.join(source, 'no-addon-armor');
const roles = {
  hull: path.join(source, 'ring-position/hull-selected.png'),
  turret: path.join(source, 'grey/turret-selected.png'),
  destroyed: path.join(source, 'ring-position/destroyed-selected.png'),
};

async function rgba(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function registeredTurretEdit(file) {
  const canvas = { width: 1589, height: 838, left: 48, top: 30 };
  const resized = await sharp(file).resize(canvas.width, canvas.height, { fit: 'fill' }).png().toBuffer();
  return rgba(await sharp({ create: { width: 1746, height: 901, channels: 4, background: '#00000000' } })
    .composite([{ input: resized, left: canvas.left, top: canvas.top }]).png().toBuffer());
}

function removeHullRails(original) {
  const { width, height } = original.info;
  const result = Buffer.from(original.data);
  const marks = [
    [390, 1430, 0, 51], [390, 1430, 850, 900],
    [595, 617, 51, 206], [1070, 1092, 51, 206], [1328, 1350, 51, 206],
    [595, 617, 704, 850], [1070, 1092, 704, 850], [1328, 1350, 704, 850],
  ];
  for (const [x0, x1, y0, y1] of marks.slice(0, 2)) for (let y = y0; y <= y1; y++) {
    const from = (y * width + x0) * 4;
    result.fill(0, from, (y * width + x1 + 1) * 4);
  }
  for (const center of [606, 1081, 1339]) eraseBrace(result, width, 51, 206, () => center, 11);
  for (const center of [606, 1081, 1339]) eraseBrace(result, width, 704, 850, () => center, 11);
  return { data: result, marks };
}

function eraseBrace(result, width, y0, y1, centerAtY, halfWidth = 8) {
  const source = Buffer.from(result);
  for (let y = y0; y <= y1; y++) {
    const center = Math.round(centerAtY(y));
    const left = (y * width + center - halfWidth - 12) * 4;
    const right = (y * width + center + halfWidth + 12) * 4;
    const verticalFade = Math.min(1, (y - y0) / 8, (y1 - y) / 8);
    for (let x = center - halfWidth; x <= center + halfWidth; x++) {
      const i = (y * width + x) * 4;
      const t = (x - center + halfWidth) / (halfWidth * 2);
      const horizontalFade = Math.min(1, (x - center + halfWidth) / 3, (center + halfWidth - x) / 3);
      const weight = Math.max(0, verticalFade * horizontalFade);
      for (let c = 0; c < 4; c++) {
        const fill = source[left + c] * (1 - t) + source[right + c] * t;
        result[i + c] = Math.round(source[i + c] * (1 - weight) + fill * weight);
      }
    }
  }
}

function clearDetachedTurretArcFragments(result, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let removedArcs = 0;
  for (let start = 0; start < width * height; start++) {
    if (visited[start] || result[start * 4 + 3] === 0) continue;
    let head = 0, tail = 0;
    let minX = width, minY = height, maxY = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const next of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1,
        y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (next < 0 || visited[next] || result[next * 4 + 3] === 0) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    // These are the two floating upper/lower Schurzen arcs identified in the
    // screenshot. Their alpha fringe is part of each separate component.
    if ((minX >= 1255 && maxY <= 350)
        || (minX >= 1275 && minY >= 600)) {
      if (tail >= 100) removedArcs++;
      for (let i = 0; i < tail; i++) result.fill(0, queue[i] * 4, queue[i] * 4 + 4);
    }
  }
  assert.equal(removedArcs, 2, 'expected the two detached turret armor arcs');
}

function removeTurretRail(original, edit) {
  const { width, height } = original.info;
  const result = Buffer.from(original.data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (!original.data[i + 3]) continue;
    // The cannon and armor roof are verbatim original pixels. The approved
    // edit's alpha marks the solid roof and launchers outside that core.
    const onOriginalRoof = x >= 600 && x <= 1305 && y >= 269 && y <= 642;
    const onOriginalGun = x < 600 && y >= 405 && y <= 537;
    // The AI edit can overlap the old rail after registration. Cut those
    // short right-side remnants at the known edge of the original turret.
    const rightUpperRail = x > 1200 && y < 330 - (x - 1200) * 0.15;
    const rightLowerRail = x > 1200 && y > 635 + (x - 1200) * 0.15;
    if (!onOriginalRoof && !onOriginalGun
        && (edit.data[i + 3] < 32 || rightUpperRail || rightLowerRail))
      result.fill(0, i, i + 4);
  }
  // The red marks include the rail's thin legs across the roof. Interpolate
  // only their narrow strokes from neighboring approved roof pixels.
  eraseBrace(result, width, 207, 316, () => 796, 7);
  eraseBrace(result, width, 180, 318, () => 897, 7);
  eraseBrace(result, width, 620, 753, () => 796, 7);
  eraseBrace(result, width, 620, 754, () => 897, 7);
  eraseBrace(result, width, 210, 345, y => 1157 - (y - 210) * 0.51, 7);
  eraseBrace(result, width, 606, 735, y => 1074 + (y - 606) * 0.54, 7);
  clearDetachedTurretArcFragments(result, width, height);
  return result;
}

async function main() {
  fs.mkdirSync(target, { recursive: true });
  for (const role of ['hull', 'turret', 'destroyed']) {
    const original = await rgba(roles[role]);
    const edit = role === 'turret' ? await registeredTurretEdit(path.join(target, 'turret-edit.png')) : null;
    const processed = role === 'turret'
      ? { data: removeTurretRail(original, edit), marks: null }
      : removeHullRails(original);
    const result = processed.data;
    if (role !== 'turret') for (let y = 0; y < original.info.height; y++)
      for (let x = 0; x < original.info.width; x++) {
        if (processed.marks.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
        const i = (y * original.info.width + x) * 4;
        for (let channel = 0; channel < 4; channel++)
          assert.equal(result[i + channel], original.data[i + channel], `${role} armor changed at ${x},${y}`);
      }
    if (role === 'turret') for (let y = 355; y <= 600; y++) for (let x = 600; x <= 1305; x++) {
      const i = (y * original.info.width + x) * 4;
      for (let channel = 0; channel < 4; channel++)
        assert.equal(result[i + channel], original.data[i + channel], `turret roof changed at ${x},${y}`);
    }
    await sharp(result, { raw: original.info }).png().toFile(path.join(target, `${role}-selected.png`));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tank_art/panzer3_m.json'), 'utf8'));
  manifest.kind = 'panzer3_m_no_schurzen';
  manifest.notes = 'Derived from approved grey Ausf. M sources. Only user-marked thin external rails and braces removed; original armor plates, track housings, deck, gun, cupola and wreck interior retained.';
  for (const role of ['hull', 'turret', 'destroyed'])
    manifest.inputs[role].path = `source_art/tanks/panzer3_m/no-addon-armor/${role}-selected.png`;
  fs.writeFileSync(path.join(ROOT, 'data/tank_art/panzer3_m_no_schurzen.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
