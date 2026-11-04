// Offline North Africa art preparation. Does not write runtime resources or game rules.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const ts = require('typescript');
const DIR = __dirname, ROOT = path.resolve(DIR, '../../..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, filename);
const { ElevationContourRaster, elevationContour } = require(path.join(ROOT, 'assets/scripts/view/ElevationContour.ts'));
const { elevationEdges, isCliffEdge } = require(path.join(ROOT, 'assets/scripts/core/Elevation.ts'));
const SQ = Math.sqrt(3), R = 48;
const uri = buffer => 'data:image/png;base64,' + buffer.toString('base64');
const point = tile => ({ x: SQ * R * (tile.pos.q + tile.pos.r / 2), y: 1.5 * R * tile.pos.r });
const vertices = tile => {
  const p = point(tile);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (-30 + i * 60) * Math.PI / 180;
    return `${p.x + R * Math.cos(a)},${p.y + R * Math.sin(a)}`;
  }).join(' ');
};

// Same production intent as tools/prepareElevationMaterial.cjs: clean source alpha,
// normalize the chips, retain their authored shape, and derive relightable normals.
async function prepareStones() {
  const { data, info } = await sharp(path.join(DIR, 'limestone-chips-source.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const stones = [], previews = [], size = 48;
  let rejectedPixels = 0;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const left = Math.floor(col * info.width / 4), top = Math.floor(row * info.height / 4);
    const width = Math.floor((col + 1) * info.width / 4) - left;
    const height = Math.floor((row + 1) * info.height / 4) - top;
    const cell = Buffer.alloc(width * height * 4), eligible = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = ((top + y) * info.width + left + x) * 4, i = (y * width + x) * 4;
      data.copy(cell, i, at, at + 4);
      const [r, g, b, a] = cell.subarray(i, i + 4);
      const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 100 && !(r > g * 1.65 && r > b * 2) && !(r > 170 && g > 150 && b < 90);
      if (a > 32 && neutral) eligible[y * width + x] = 1;
      else if (a > 0) rejectedPixels++;
    }
    // Keep the largest connected stone, excluding detached generation speckles.
    const seen = new Uint8Array(eligible.length); let largest = [];
    for (let seed = 0; seed < eligible.length; seed++) {
      if (!eligible[seed] || seen[seed]) continue;
      const queue = [seed]; seen[seed] = 1;
      for (let k = 0; k < queue.length; k++) {
        const at = queue[k], x = at % width, y = Math.floor(at / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || !eligible[next]) continue;
          seen[next] = 1; queue.push(next);
        }
      }
      if (queue.length > largest.length) largest = queue;
    }
    assert(largest.length > width * height * .08, `Missing stone ${row},${col}`);
    const keep = new Uint8Array(eligible.length);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const at of largest) {
      keep[at] = 1; const x = at % width, y = Math.floor(at / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    for (let at = 0; at < keep.length; at++) if (!keep[at]) cell.fill(0, at * 4, at * 4 + 4);
    const png = await sharp(cell, { raw: { width, height, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .resize(size - 4, size - 4, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({ left: 2, right: 2, top: 2, bottom: 2, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const rgba = await sharp(png).raw().toBuffer();
    const blur = await sharp(png).removeAlpha().blur(5).raw().toBuffer();
    const heights = Buffer.alloc(size * size), normals = Buffer.alloc(size * size * 2);
    const support = Array(8).fill(0), directions = support.map((_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (rgba[(y * size + x) * 4 + 3] > 128)
      for (let d = 0; d < 8; d++) support[d] = Math.max(support[d], (x - 23.5) * directions[d][0] + (y - 23.5) * directions[d][1]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const at = y * size + x; let h = 1;
      for (let d = 0; d < 8; d++) h = Math.min(h, Math.max(0, (1 - ((x - 23.5) * directions[d][0] + (y - 23.5) * directions[d][1]) / Math.max(1, support[d])) * 2.5));
      heights[at] = Math.round(h * 255);
      for (let c = 0; c < 3; c++) rgba[at * 4 + c] = Math.min(255, Math.round(rgba[at * 4 + c] * (.65 + .35 * 140 / Math.max(50, blur[at * 3 + c]))));
    }
    const sample = (x, y) => heights[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))] / 255;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * size * .09;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * size * .09;
      const len = Math.hypot(dx, dy, 1), at = (y * size + x) * 2;
      normals[at] = Math.round(128 - dx / len * 127); normals[at + 1] = Math.round(128 - dy / len * 127);
    }
    // Resampling can amplify nearly invisible RGB on the transparent fringe.
    for (let at = 0; at < size * size; at++) if (rgba[at * 4 + 3] <= 32) rgba.fill(0, at * 4, at * 4 + 4);
    stones.push({ size, rgba: rgba.toString('base64'), normals: normals.toString('base64') });
    const file = `limestone-chip-${String(stones.length).padStart(2, '0')}.png`;
    await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toFile(path.join(DIR, 'prepared', file));
    previews.push({ input: await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).resize(144, 144).png().toBuffer(), left: col * 160 + 8, top: row * 160 + 8 });
  }
  await sharp({ create: { width: 640, height: 640, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(previews).png().toFile(path.join(DIR, 'prepared/limestone-chips.png'));
  return { stones, rejectedPixels };
}

function scenario(kind) {
  const tiles = [];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
    let height = 0, surface = 'sand', terrain = 'field';
    if (kind === 'dune') {
      // An elongated bending ridge, rather than a concentric mesa-shaped mound.
      const distance = Math.abs(col + (row & 1) * .5 - (5.3 - row * .62));
      if (row >= 1 && row <= 4 && distance < 1.35) height = 1;
      if (row >= 2 && row <= 3 && distance < .5) height = 2;
      terrain = 'mud';
    } else if (kind === 'plateau') {
      if (row >= 1 && row <= 4 && col >= 2 && col <= 5) { height = 1; surface = 'limestone'; }
    } else {
      const centers = [3, 3, 4, 3, 3, 2];
      if (col === centers[row] || col === centers[row] + 1) { height = -1; surface = 'wadi-silt'; }
    }
    tiles.push({ pos: { q: col - ((row - (row & 1)) >> 1), r: row }, terrain, height, surface });
  }
  if (kind !== 'dune') for (const edge of elevationEdges(tiles)) {
    const a = point(edge.high), b = point(edge.low);
    // Broad approach on the left, rocky impassable flank on the right.
    if ((a.x + b.x) / 2 > (kind === 'plateau' ? 340 : 360)) {
      edge.high.cliffs ??= Array(6).fill(false); edge.high.cliffs[edge.direction] = true;
    }
  }
  return tiles;
}

async function renderScene(kind, material, textures, camera = 0) {
  const tiles = scenario(kind), x = -58, y = -54, width = 760, height = 478;
  const contours = elevationContour(tiles), raster = new ElevationContourRaster(material);
  const chunk = raster.render(tiles, contours, x, y, width, camera);
  const overlay = await sharp(Buffer.from(chunk.pixels), { raw: { width: width + 2, height: width + 2, channels: 4 } })
    .extract({ left: 1, top: 1, width, height }).png().toBuffer();
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"><defs>`;
  for (const [name, png] of Object.entries(textures)) svg += `<pattern id="${name}" patternUnits="userSpaceOnUse" width="384" height="384"><image width="384" height="384" href="${uri(png)}"/></pattern>`;
  svg += '</defs>';
  for (const tile of tiles) svg += `<polygon points="${vertices(tile)}" fill="url(#${tile.surface})"/>`;
  svg += `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${uri(overlay)}"/>`;
  for (const tile of tiles) svg += `<polygon points="${vertices(tile)}" fill="none" stroke="#655b45" stroke-opacity=".23" stroke-width=".7"/>`;
  svg += '</svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.promises.writeFile(path.join(DIR, `preview-${kind}${camera ? '-camera90' : ''}.png`), png);
  return { png, tiles, raster, contours };
}

async function verify(material, cases) {
  const report = { renderer: 'Existing ElevationContourRaster, unchanged', scenes: [], materialVersion: material.version, stones: material.stones.length };
  for (const [name, scene] of Object.entries(cases)) {
    let maxDelta = 0;
    // Two separately baked chunks compared with one bake over identical world pixels.
    for (const camera of [0, 90]) {
      const whole = scene.raster.render(scene.tiles, scene.contours, 150, 100, 192, camera);
      for (const offset of [0, 96]) {
        const part = scene.raster.render(scene.tiles, scene.contours, 150 + offset, 100, 96, camera);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) for (let c = 0; c < 4; c++) {
          const a = whole.pixels[((y + 1) * 194 + x + offset + 1) * 4 + c];
          const b = part.pixels[((y + 1) * 98 + x + 1) * 4 + c];
          maxDelta = Math.max(maxDelta, Math.abs(a - b));
        }
      }
    }
    const edges = elevationEdges(scene.tiles), blocked = edges.filter(e => e.blocked).length;
    assert.equal(maxDelta, 0, `${name}: chunk sampling differs`);
    assert(edges.every(e => e.high.height > e.low.height));
    assert(edges.every(e => e.blocked === isCliffEdge(e.high, e.low, e.direction)));
    const directions = [...new Set(edges.map(e => e.direction))].sort();
    assert.equal(directions.length, 6, `${name}: missing edge direction`);
    report.scenes.push({ name, tiles: scene.tiles.length, heights: [...new Set(scene.tiles.map(t => t.height))], boundaryEdges: edges.length, blockedEdges: blocked, openEdges: edges.length - blocked, directions, maximumChunkPixelDelta: maxDelta });
  }
  return report;
}

async function main() {
  fs.mkdirSync(path.join(DIR, 'prepared'), { recursive: true });
  const textures = {}, materials = {};
  for (const name of ['sand', 'limestone', 'wadi-silt']) {
    const file = path.join(DIR, `${name}-albedo-source.png`);
    const png = await sharp(file).resize(384, 384).removeAlpha().png().toBuffer();
    await fs.promises.writeFile(path.join(DIR, 'prepared', `${name}-albedo-384.png`), png);
    textures[name] = png;
    const rgb = await sharp(file).resize(256, 256).removeAlpha().raw().toBuffer();
    materials[name] = { width: 256, height: 256, rgb: rgb.toString('base64') };
  }
  const { stones, rejectedPixels } = await prepareStones();
  const material = { version: 5, rock: materials.limestone, stones };
  fs.writeFileSync(path.join(DIR, 'prepared/continuous-material-north-africa.json'), JSON.stringify(material) + '\n');
  const cases = {};
  for (const kind of ['dune', 'plateau', 'wadi']) cases[kind] = await renderScene(kind, material, textures);
  await renderScene('plateau', material, textures, 90);
  const smallSize = Math.round(760 * 40 / (SQ * R)), smallImages = [];
  for (const [index, scene] of Object.values(cases).entries()) smallImages.push({ input: await sharp(scene.png).resize(smallSize).png().toBuffer(), left: 15 + index * (smallSize + 20), top: 15 });
  await sharp({ create: { width: (smallSize + 20) * 3 + 10, height: Math.ceil(478 * smallSize / 760) + 30, channels: 4, background: '#efe9da' } }).composite(smallImages).png().toFile(path.join(DIR, 'preview-40px-hex.png'));
  const report = await verify(material, cases); report.removedSourceArtifactPixels = rejectedPixels;
  fs.writeFileSync(path.join(DIR, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(DIR, 'height-layouts.json'), JSON.stringify(Object.fromEntries(Object.entries(cases).map(([name, c]) => [name, c.tiles])), null, 2) + '\n');
  let sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960"><rect width="1920" height="960" fill="#efe9da"/><g font-family="Microsoft YaHei,sans-serif" fill="#353a30"><text x="38" y="60" font-size="36">北非地形 V2 · 连续高程资源</text><text x="40" y="98" font-size="20">离线材质合成 / 现有高程轮廓渲染 / 同高内部不画坡 / 未接入战场</text>';
  const names = [['dune', '沙丘', '软沙地面 + 连续高程 + 可通行沙坡'], ['plateau', '岩石台地', '平坦连片顶面 / 左侧缓坡 / 右侧岩质陡坡'], ['wadi', '干河床', '连续低地通道 / 冲积土底 / 两岸按高差生成']];
  for (let i = 0; i < names.length; i++) {
    const [kind, label, detail] = names[i], left = 36 + i * 630;
    sheet += `<text x="${left}" y="156" font-size="28">${label}</text><text x="${left}" y="188" font-size="17">${detail}</text><image x="${left}" y="216" width="604" height="380" href="${uri(cases[kind].png)}"/>`;
    const h = kind === 'dune' ? '高度 0 / 1 / 2 · 全部缓坡' : kind === 'plateau' ? '高度 0 / 1 · 缓坡和陡坡混接' : '地面 0 / 河床 -1 · 入口与岸坡连续';
    sheet += `<text x="${left}" y="622" font-size="18">${h}</text>`;
  }
  sheet += '<line x1="38" y1="652" x2="1880" y2="652" stroke="#c9beaa"/>';
  const swatches = [['sand', '细沙地表'], ['limestone', '石灰岩表面'], ['wadi-silt', '干河床冲积土']];
  for (let i = 0; i < swatches.length; i++) {
    const [key, label] = swatches[i], left = 42 + i * 370;
    sheet += `<image x="${left}" y="686" width="160" height="160" href="${uri(textures[key])}"/><text x="${left + 178}" y="728" font-size="21">${label}</text><text x="${left + 178}" y="762" font-size="16">地表材质 384×384</text><text x="${left + 178}" y="790" font-size="16">不烘焙坡形与阴影</text>`;
  }
  const chips = fs.readFileSync(path.join(DIR, 'prepared/limestone-chips.png'));
  sheet += `<image x="1180" y="680" width="174" height="174" href="${uri(chips)}"/><text x="1378" y="728" font-size="22">石灰岩碎石 × 16</text><text x="1378" y="762" font-size="17">透明切片 / 48×48 / 可重新受光</text><text x="1378" y="794" font-size="17">沿陡坡散布，不重复围满每格</text>`;
  sheet += '<text x="40" y="910" font-size="19">玩法仍复用地面规则、height 与 cliff；明暗、坡带、接头由高程轮廓生成。</text></g></svg>';
  fs.writeFileSync(path.join(DIR, 'north-africa-elevation-v2.svg'), sheet);
  await sharp(Buffer.from(sheet)).png().toFile(path.join(DIR, 'north-africa-elevation-v2.png'));
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
