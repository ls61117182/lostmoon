const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const types = read('assets', 'scripts', 'core', 'types.ts');
const visuals = read('assets', 'scripts', 'core', 'TankVisualDB.ts');
const units = read('assets', 'scripts', 'core', 'UnitDB.ts');
const lang = read('assets', 'scripts', 'core', 'LangDB.ts');
const menu = read('assets', 'scripts', 'view', 'MainMenuScene.ts');

assert.match(types, /\| 'maus'/, 'maus must be a UnitKind');
assert.match(types, /kind === 'maus'/, 'maus must use tank rules');
assert.match(visuals, /SPLIT_TANK_KINDS[^\n]*'maus'/, 'maus must render as split hull and turret');
assert.match(visuals, /maus: \{ topSpritePath: "textures\/units\/maus_top\/spriteFrame"/, 'maus assets must be generated into the visual DB');
assert.match(visuals, /maus: \{ hullFitScale: 0\.95, turretScale: 1,/, 'maus hull and turret must retain their shared three-view source scale');
assert.match(visuals, /topTrim: \{ x: 0, y: 0, w: 100, h: 38 \}/, 'maus hull geometry must use the strict three-view canvas');
assert.match(visuals, /turretTrim: \{ x: 0, y: 0, w: 96, h: 34 \}/, 'maus turret geometry must preserve the three-view aspect ratio');
assert.match(visuals, /pivot: \{ bodyX: 54, bodyY: 20, spriteX: 68, spriteY: 18 \}/, 'maus pivot must match the three-view turret-ring position');
assert.match(visuals, /muzzle: \{ spriteX: 0, spriteY: 17 \}/, 'maus muzzle effects must follow the centered 128mm main gun');
assert.match(units, /maus: \{/, 'maus combat stats must be generated into the unit DB');
assert.match(lang, /'unit\.name\.maus': \{ zh: "鼠式坦克", en: "Panzer VIII Maus" \}/, 'maus must have localized battle labels');
assert.match(menu, /case 'maus': return '鼠式坦克'/, 'tank image debug selector must label the Maus option');

for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  const png = path.join(root, 'assets', 'resources', 'textures', 'units', `maus_${suffix}.png`);
  assert.ok(fs.existsSync(png), `missing ${path.basename(png)}`);
  assert.ok(fs.existsSync(`${png}.meta`), `missing ${path.basename(png)}.meta`);
}

const topMeta = JSON.parse(read('assets', 'resources', 'textures', 'units', 'maus_top.png.meta'));
const topFrame = Object.values(topMeta.subMetas).find(meta => meta.importer === 'sprite-frame');
assert.strictEqual(topFrame.userData.width, 142, 'complete Maus preview must keep the protruding guns instead of compressing them into 100px');
assert.strictEqual(topFrame.userData.height, 38, 'complete Maus preview must use the same vertical scale as the strict three-view hull');

console.log('MausTankVisual.test.js passed');
