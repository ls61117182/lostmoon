const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const {
  ROAD_CANONICAL_MASKS,
  europeanRoadCenterlineDistance,
  roadSpriteTransform,
  rotateUrbanRoadMask,
} = require('../assets/scripts/core/UrbanTerrain.ts');
const generator = require('../tools/prepareEuropeanRoadArt.cjs');
const roadDir = 'assets/resources/textures/terrain/european_roads';
const manifest = JSON.parse(fs.readFileSync(path.join(roadDir, 'european_road_manifest.json'), 'utf8'));
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const roadsForMask = mask => Array.from({ length: 6 }, (_, bit) => !!(mask & (1 << bit)));

test('European roads collapse all directions to 13 rotational shapes', () => {
  assert.deepEqual(ROAD_CANONICAL_MASKS, [1, 3, 5, 7, 9, 11, 13, 15, 21, 23, 27, 31, 63]);
  assert.deepEqual(generator.CANONICAL_MASKS, ROAD_CANONICAL_MASKS);
  for (let mask = 1; mask < 64; mask++) {
    const transform = roadSpriteTransform(roadsForMask(mask));
    assert.ok(transform);
    assert.equal(rotateUrbanRoadMask(transform.canonicalMask, transform.rotationSteps), mask);
  }
});

test('building clearance geometry matches every prebuilt European road shape within a subpixel', () => {
  const sampleCoordinates = [-0.8, -0.55, -0.3, -0.1, 0, 0.1, 0.3, 0.55, 0.8];
  for (let mask = 1; mask < 64; mask++) {
    const distanceAt = generator.shapeFor(mask);
    const roads = roadsForMask(mask);
    for (const y of sampleCoordinates) for (const x of sampleCoordinates) {
      // Generator coordinates are y-down pixels; BattleScene uses y-up local units.
      const expected = distanceAt(111 + x * 128, 128 - y * 128) / 128;
      const actual = europeanRoadCenterlineDistance(roads, x, y);
      // The 222px-wide bitmap rounds the ideal 128*sqrt(3) hex width, so its
      // sampled direction vectors differ from runtime geometry by < 0.1 pixel.
      assert.ok(Math.abs(actual - expected) < 0.001,
        `mask ${mask}, point (${x}, ${y}): ${actual} != ${expected}`);
    }
  }
});

test('road building fallback requires actual road clearance', () => {
  const method = battleScene.match(/private drawBuildingOverlay[\s\S]*?\n  private /)?.[0];
  assert.ok(method, 'drawBuildingOverlay must exist');
  assert.match(method, /europeanRoadSurfaceClearance\(roads/);
  assert.match(method, /roads && bestScore < halfDiag \+ roadPadding/);
  assert.match(method, /if \(!best \|\| \(roads && bestScore < halfDiag \+ roadPadding\)\) continue;[\s\S]*?placed\.push/);
});

test('summer and winter each contain only the 13 canonical road sprites', () => {
  const files = fs.readdirSync(roadDir);
  for (const season of ['summer', 'winter']) {
    const pngs = files.filter(name => new RegExp(`^european_road_surface_${season}_[01]{6}_v1\\.png$`).test(name));
    const metas = files.filter(name => new RegExp(`^european_road_surface_${season}_[01]{6}_v1\\.png\\.meta$`).test(name));
    assert.equal(pngs.length, 13);
    assert.equal(metas.length, 13);
  }
  assert.equal(manifest.canonicalSurfaceCountPerSeason, 13);
  assert.deepEqual(manifest.seasons, ['summer', 'winter']);
  assert.equal(manifest.variants.length, 64);
});

test('European road sprites are full-hex transparent overlays with visible road mouths', async () => {
  const mouthSamples = [[219, 128], [165, 221], [57, 221], [2, 128], [57, 35], [165, 35]];
  for (const season of ['summer', 'winter']) {
    for (const mask of ROAD_CANONICAL_MASKS) {
      const rd = generator.flags(mask);
      const file = path.join(roadDir, `european_road_surface_${season}_${rd}_v1.png`);
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([info.width, info.height, info.channels], [222, 256, 4]);
      assert.equal(data[3], 0, `${file} must keep its corner transparent`);
      for (let direction = 0; direction < 6; direction++) {
        const [mx, my] = mouthSamples[direction];
        const alpha = data[(my * info.width + mx) * 4 + 3];
        assert.equal(alpha > 128, !!(mask & (1 << direction)), `${season} ${rd} direction ${direction}`);
      }
    }
  }
});

test('opposite road mouths use the same seam-free surface color', async () => {
  for (const season of ['summer', 'winter']) {
    const file = path.join(roadDir, `european_road_surface_${season}_100100_v1.png`);
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    const east = pixel(info.width - 1, 128);
    const west = pixel(0, 128);
    assert.deepEqual(east, west, `${season} straight-road mouths must meet without a color seam`);
    assert.equal(east[3], 255);
  }
});

test('all diagonal road mouths bleed past the hex border to cover rotated seams', async () => {
  assert.equal(generator.MOUTH_BLEED, 5);
  for (const season of ['summer', 'winter']) {
    for (const mask of ROAD_CANONICAL_MASKS) {
      const file = path.join(roadDir, `european_road_surface_${season}_${generator.flags(mask)}_v1.png`);
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      for (let direction = 1; direction < 6; direction++) {
        if (direction === 3 || !(mask & (1 << direction))) continue;
        const [mx, my] = generator.EDGES[direction];
        const [ux, uy] = generator.RAYS[direction];
        const x = Math.round(mx + ux * 3);
        const y = Math.round(my + uy * 3);
        const alpha = data[(y * info.width + x) * 4 + 3];
        assert.ok(alpha > 200, `${season} ${generator.flags(mask)} direction ${direction} lacks mouth bleed`);
      }
    }
  }
});

test('battle renderer preloads seasonal European road sprites and rotates canonical shapes', () => {
  assert.match(battleScene, /for \(const season of \['summer', 'winter'\]\)/);
  assert.match(battleScene, /european_road_surface_\$\{season\}_\$\{rd\}_v1/);
  assert.match(battleScene, /tile\.terrain !== 'road'[\s\S]*?roadSpriteTransform\(tile\.roads\)/);
  assert.match(battleScene, /european_road_surface_\$\{season\}_\$\{transform\.canonicalFlags\}_v1/);
  assert.match(battleScene, /drawTerrainSpriteFrame\([\s\S]*?this\.hexSize \* ROAD_SURFACE_OVERLAP_SCALE, info\.frame, info\.rotationDegrees/);
  assert.match(battleScene, /addTileInspectRoadSurfaceSprite\(preview, tile/);
});
