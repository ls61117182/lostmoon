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

const { roadSpriteTransform } = require('../assets/scripts/core/UrbanTerrain.ts');
const roadDir = 'assets/resources/textures/terrain/european_roads';
const manifest = JSON.parse(fs.readFileSync(path.join(roadDir, 'european_road_manifest.json'), 'utf8'));
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const missionLoader = fs.readFileSync('assets/scripts/core/MissionLoader.ts', 'utf8');
const mainMenu = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');

test('bridge uses one straight sprite per season', () => {
  const files = fs.readdirSync(roadDir);
  for (const season of ['summer', 'winter']) {
    const png = `european_bridge_surface_${season}_v1.png`;
    assert.ok(files.includes(png));
    assert.ok(files.includes(`${png}.meta`));
  }
  assert.equal(files.filter(name => /^european_bridge_surface_(summer|winter)_v1\.png$/.test(name)).length, 2);
  assert.equal(manifest.bridge.shapeCountPerSeason, 1);
  assert.deepEqual(manifest.bridge.canonicalEnds, ['E', 'W']);
});

test('bridge roadway pixels exactly reuse the ordinary road surface', async () => {
  for (const season of ['summer', 'winter']) {
    const road = await sharp(path.join(roadDir, `european_road_surface_${season}_100100_v1.png`)).raw().toBuffer();
    const bridge = await sharp(path.join(roadDir, `european_bridge_surface_${season}_v1.png`)).raw().toBuffer();
    for (let x = 0; x < 222; x++) {
      const offset = (128 * 222 + x) * 4;
      assert.deepEqual(
        Array.from(bridge.subarray(offset, offset + 4)),
        Array.from(road.subarray(offset, offset + 4)),
        `${season} bridge roadway differs from road at x=${x}`,
      );
    }
  }
});

test('the single bridge sprite covers all three straight axes by rotation', () => {
  const cases = [
    { ends: [0, 3], rotation: 0 },
    { ends: [1, 4], rotation: -60 },
    { ends: [2, 5], rotation: -120 },
  ];
  for (const { ends, rotation } of cases) {
    const roads = Array.from({ length: 6 }, (_, direction) => ends.includes(direction));
    const transform = roadSpriteTransform(roads);
    assert.equal(transform.canonicalMask, 9);
    assert.equal(transform.rotationDegrees, rotation);
  }
});

test('battle renderer preloads and uses bridge sprites before Graphics fallback', () => {
  assert.match(battleScene, /european_bridge_surface_\$\{season\}_v1\/spriteFrame/);
  assert.match(battleScene, /bridgeSurfaceSpriteInfo\(t\)[\s\S]*?drawBridgeSpriteFrame[\s\S]*?else \{[\s\S]*?drawBridgeOverlay/);
  assert.match(battleScene, /ROAD_SURFACE_OVERLAP_SCALE = 1\.025/);
  assert.match(battleScene, /prebuilt bridge already contains the same seasonal road surface/);
});

test('bridge sprite layer stays above riverbank graphics and below ground decals', () => {
  const mapGraphics = battleScene.indexOf("new Node('MapGraphics')");
  const bridges = battleScene.indexOf("new Node('BridgeSprites')");
  const tracks = battleScene.indexOf("new Node('VisibleTrackMask')");
  assert.ok(mapGraphics >= 0 && bridges > mapGraphics && tracks > bridges);
  assert.match(battleScene, /bridgeSpritePoolNext = 0;[\s\S]*?bridgeSpritePool[\s\S]*?node\.active = false/);
  assert.match(battleScene, /private drawBridgeSpriteFrame\([\s\S]*?this\.bridgeSpritePool\[this\.bridgeSpritePoolNext\+\+\]/);
});

test('missions and editor only accept opposite bridge ends', () => {
  assert.match(missionLoader, /\(aRaw \+ 3\) % 6 !== bRaw/);
  const editorAssignments = mainMenu.match(/tile\.br = \[i, \(i \+ 3\) % 6\]/g) ?? [];
  assert.equal(editorAssignments.length, 2);
});
