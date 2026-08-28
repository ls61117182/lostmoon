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
const battle = read('assets', 'scripts', 'view', 'BattleScene.ts');

assert.match(types, /\| 'm26_pershing'/, 'M26 Pershing must be a UnitKind');
assert.match(types, /kind === 'm26_pershing'/, 'M26 Pershing must use tank rules');
assert.match(visuals, /SPLIT_TANK_KINDS[^\n]*'m26_pershing'/, 'M26 Pershing must render as split hull and turret');
assert.match(visuals, /m26_pershing: \{ topSpritePath: "textures\/units\/m26_pershing_top\/spriteFrame"/, 'M26 Pershing assets must be generated into the visual DB');
assert.match(visuals, /topTrim: \{ x: 0, y: 0, w: 131, h: 73 \}/, 'M26E1 hull must preserve the three-view proportions');
assert.match(visuals, /turretTrim: \{ x: 0, y: 0, w: 199, h: 73 \}/, 'M26E1 turret must preserve the three-view long-gun proportion');
assert.match(visuals, /pivot: \{ bodyX: 57, bodyY: 37, spriteX: 131, spriteY: 37 \}/, 'M26E1 hull and turret pivots must match the corrected split art');
assert.match(units, /m26_pershing: \{/, 'M26 Pershing combat stats must be generated');
assert.match(units, /m26_pershing:[\s\S]*?penetration: 5, highExplosivePower: 3,[\s\S]*?mobility: 2,/, 'M26 Pershing must use its 90mm gun and heavy-tank mobility profile');
assert.match(lang, /'unit\.name\.m26_pershing': \{ zh: "M26E1 潘兴", en: "M26E1 Pershing" \}/, 'M26E1 Pershing must have localized battle labels');
assert.match(menu, /case 'm26_pershing': return 'M26E1 潘兴'/, 'tank image debugger must label the M26E1 Pershing option');
assert.match(battle, /case 'm26_pershing':[\s\S]*?splitTankGeometryConfigOf\('m26_pershing'\)/, 'destroyed M26 Pershing sizing must use split hull geometry');

for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  const png = path.join(root, 'assets', 'resources', 'textures', 'units', `m26_pershing_${suffix}.png`);
  assert.ok(fs.existsSync(png), `missing ${path.basename(png)}`);
  assert.ok(fs.existsSync(`${png}.meta`), `missing ${path.basename(png)}.meta`);
}

console.log('M26PershingTankVisual.test.js passed');
