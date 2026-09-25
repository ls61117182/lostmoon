const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const {
  rotateUrbanRoadMask,
  URBAN_ROAD_CANONICAL_MASKS,
  urbanRoadSpriteTransform,
} = require('../assets/scripts/core/UrbanTerrain.ts');

const roadDir = 'assets/resources/textures/terrain/urban/roads';
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const generator = require('../tools/prepareUrbanRoadArt.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(roadDir, 'urban_road_manifest.json'), 'utf8'));
const roadsForMask = mask => Array.from({ length: 6 }, (_, bit) => !!(mask & (1 << bit)));

test('63 urban-road direction masks collapse to 13 rotationally unique sprites', () => {
  assert.deepEqual(URBAN_ROAD_CANONICAL_MASKS, [1, 3, 5, 7, 9, 11, 13, 15, 21, 23, 27, 31, 63]);
  assert.deepEqual(generator.CANONICAL_MASKS, URBAN_ROAD_CANONICAL_MASKS);
  for (let mask = 1; mask < 64; mask++) {
    const transform = urbanRoadSpriteTransform(roadsForMask(mask));
    assert.ok(transform);
    assert.equal(rotateUrbanRoadMask(transform.canonicalMask, transform.rotationSteps), mask,
      `mask ${mask} cannot be reconstructed from its canonical sprite`);
    assert.equal(transform.rotationDegrees, transform.rotationSteps === 0 ? 0 : -transform.rotationSteps * 60);
  }
});

test('only canonical urban-road surface assets remain', () => {
  const pngs = fs.readdirSync(roadDir).filter(name => /^urban_road_surface_[01]{6}_v1\.png$/.test(name)).sort();
  const metas = fs.readdirSync(roadDir).filter(name => /^urban_road_surface_[01]{6}_v1\.png\.meta$/.test(name)).sort();
  assert.equal(pngs.length, 13);
  assert.equal(metas.length, 13);
  for (const mask of URBAN_ROAD_CANONICAL_MASKS) {
    const flags = Array.from({ length: 6 }, (_, bit) => mask & (1 << bit) ? '1' : '0').join('');
    assert.ok(pngs.includes(`urban_road_surface_${flags}_v1.png`));
    assert.ok(metas.includes(`urban_road_surface_${flags}_v1.png.meta`));
  }
});

test('manifest and battle renderer reuse canonical sprites with rotation', () => {
  assert.equal(manifest.canonicalSurfaceCount, 13);
  assert.equal(manifest.variants.length, 64);
  for (let mask = 1; mask < 64; mask++) {
    const entry = manifest.variants[mask];
    const transform = urbanRoadSpriteTransform(roadsForMask(mask));
    assert.equal(entry.canonicalRd, transform.canonicalFlags);
    assert.equal(entry.rotationDegrees, transform.rotationDegrees);
    assert.equal(entry.surface, `urban_road_surface_${transform.canonicalFlags}_v1.png`);
  }
  assert.match(battleScene, /for \(const mask of URBAN_ROAD_CANONICAL_MASKS\)/,
    'BattleScene must preload only canonical road surfaces');
  assert.match(battleScene, /urbanRoadSpriteTransform\(t\.roads\)[\s\S]*?transform\.canonicalFlags[\s\S]*?transform\.rotationDegrees/,
    'BattleScene must select a canonical road surface and rotate it');
});
