const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const terrainDir = path.join(root, 'assets/resources/textures/terrain');

const pairs = [
  ['terrain_field.png', 'terrain_field_snow.png'],
  ['terrain_mud.png', 'terrain_mud_snow.png'],
  ['terrain_road.png', 'terrain_road_snow.png'],
  ['terrain_forest.png', 'terrain_forest_snow.png'],
  ['terrain_water.png', 'terrain_water_snow.png'],
  ['tree_01.png', 'tree_01_snow.png'],
  ['tree_02.png', 'tree_02_snow.png'],
  ['tree_03.png', 'tree_03_snow.png'],
  ['tree_04.png', 'tree_04_snow.png'],
];

async function alphaBytes(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(info.width * info.height);
  for (let src = 3, dst = 0; src < data.length; src += 4, dst++) alpha[dst] = data[src];
  return { alpha, width: info.width, height: info.height };
}

async function assertTransparentRgbPreserved(sourceFile, winterFile, label) {
  const [source, winter] = await Promise.all([
    sharp(sourceFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(winterFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.strictEqual(winter.info.width, source.info.width, `${label} transparent RGB width must match`);
  assert.strictEqual(winter.info.height, source.info.height, `${label} transparent RGB height must match`);
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] !== 0) continue;
    assert.strictEqual(winter.data[i], source.data[i], `${label} transparent red must match at pixel ${i / 4}`);
    assert.strictEqual(winter.data[i + 1], source.data[i + 1], `${label} transparent green must match at pixel ${i / 4}`);
    assert.strictEqual(winter.data[i + 2], source.data[i + 2], `${label} transparent blue must match at pixel ${i / 4}`);
  }
}

(async () => {
  const uuids = new Set();
  for (const [summerName, winterName] of pairs) {
    const summerPath = path.join(terrainDir, summerName);
    const winterPath = path.join(terrainDir, winterName);
    assert.ok(fs.existsSync(winterPath), `${winterName} should exist`);
    assert.ok(fs.existsSync(`${winterPath}.meta`), `${winterName}.meta should exist`);

    const summer = await alphaBytes(summerPath);
    const winter = await alphaBytes(winterPath);
    assert.strictEqual(winter.width, summer.width, `${winterName} width must match the original`);
    assert.strictEqual(winter.height, summer.height, `${winterName} height must match the original`);
    assert.deepStrictEqual(winter.alpha, summer.alpha, `${winterName} must preserve the original silhouette exactly`);
    if (summerName.startsWith('terrain_')) {
      await assertTransparentRgbPreserved(summerPath, winterPath, winterName);
    }

    const meta = JSON.parse(fs.readFileSync(`${winterPath}.meta`, 'utf8'));
    assert.ok(!uuids.has(meta.uuid), `${winterName} must have a unique Cocos uuid`);
    uuids.add(meta.uuid);
    assert.strictEqual(meta.subMetas.f9941.displayName, path.basename(winterName, '.png'));
  }

  const mud = await sharp(path.join(terrainDir, 'terrain_mud_snow.png')).ensureAlpha().raw().toBuffer();
  let mudOpaque = 0;
  let mudSnow = 0;
  let mudExposed = 0;
  for (let i = 0; i < mud.length; i += 4) {
    if (mud[i + 3] < 220) continue;
    mudOpaque++;
    const brightness = (mud[i] + mud[i + 1] + mud[i + 2]) / 3;
    if (brightness > 195) mudSnow++;
    if (brightness < 175 && mud[i] >= mud[i + 1] && mud[i + 1] >= mud[i + 2]) mudExposed++;
  }
  assert(mudSnow / mudOpaque > 0.70, 'snow-covered mud must be mostly continuous bright snow');
  assert(mudExposed / mudOpaque > 0.01 && mudExposed / mudOpaque < 0.20,
    'snow-covered mud should expose only a few dirt patches');

  for (const winterName of ['terrain_forest_snow.png', 'tree_01_snow.png', 'tree_02_snow.png', 'tree_03_snow.png', 'tree_04_snow.png']) {
    const pixels = await sharp(path.join(terrainDir, winterName)).ensureAlpha().raw().toBuffer();
    let greenPixels = 0;
    let brownPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 80) continue;
      if (pixels[i + 1] > pixels[i] + 10 && pixels[i + 1] > pixels[i + 2] + 10) greenPixels++;
      if (pixels[i] > pixels[i + 1] && pixels[i + 1] > pixels[i + 2]) brownPixels++;
    }
    assert.strictEqual(greenPixels, 0, `${winterName} must contain no green foliage`);
    assert(brownPixels > 0, `${winterName} should contain brown dormant vegetation`);
  }
  for (const winterName of ['tree_01_snow.png', 'tree_02_snow.png', 'tree_03_snow.png', 'tree_04_snow.png']) {
    const pixels = await sharp(path.join(terrainDir, winterName)).ensureAlpha().raw().toBuffer();
    let opaque = 0;
    let snow = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 80) continue;
      opaque++;
      const average = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      const spread = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (average > 140 && spread < 25) snow++;
    }
    assert(snow / opaque > 0.40, `${winterName} snow should cover about half the canopy`);
    assert(snow / opaque < 0.60, `${winterName} snow should leave about half the brown canopy visible`);
  }

  const winterGenerator = fs.readFileSync(path.join(root, 'tools/generateWinterTerrain.cjs'), 'utf8');
  assert.match(winterGenerator, /const frostBranches = \[\]/,
    'winter trees should build a branch-following hoarfrost network');
  assert.match(winterGenerator, /distanceToBranch/,
    'winter tree snow should be measured against branch segments');
  assert.doesNotMatch(winterGenerator, /const snowPatches =/,
    'winter trees should not fall back to circular snow-dot patches');

  const types = fs.readFileSync(path.join(root, 'assets/scripts/core/types.ts'), 'utf8');
  assert.match(types, /export type SeasonType = 'summer' \| 'winter'/);
  assert.match(types, /season\?: SeasonType/);

  const battle = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
  assert.match(battle, /data\?\.season === 'winter' && \(data\.theater \?\? 'europe'\) === 'europe'/);
  for (const [, winterName] of pairs.slice(0, 5)) {
    assert.ok(battle.includes(path.basename(winterName, '.png')), `BattleScene should load ${winterName}`);
  }
  assert.match(battle, /`textures\/terrain\/\$\{name\}_snow\/spriteFrame`/);
  assert.match(battle, /WINTER_BUILDING_ROOF/);
  assert.match(battle, /activeTreeSpriteFrames\(\)/);

  const editor = fs.readFileSync(path.join(root, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');
  assert.match(editor, /mission\.season = 'winter'/);
  assert.match(editor, /季节：\$\{seasonLabel\(draftSeason\)\}/);

  const lang = fs.readFileSync(path.join(root, 'data/lang.csv'), 'utf8');
  for (const key of ['road', 'field', 'mud', 'forest', 'water']) {
    assert.ok(lang.includes(`terrain.${key}_snow`), `snow label should exist for ${key}`);
  }

  console.log('winter terrain tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
