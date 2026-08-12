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

assert.match(types, /\| 'panther'/, 'panther must be a UnitKind');
assert.match(types, /kind === 'panther'/, 'panther must use tank rules');
assert.match(visuals, /SPLIT_TANK_KINDS[^\n]*'panther'/, 'panther must render as split hull and turret');
assert.match(visuals, /panther: \{ topSpritePath: "textures\/units\/panther_top\/spriteFrame"/, 'panther assets must be generated into the visual DB');
assert.match(visuals, /panther: \{ hullFitScale: 0\.84, turretScale: 0\.82,/, 'panther turret must retain the corrected reference proportion');
assert.match(visuals, /topTrim: \{ x: 0, y: 0, w: 100, h: 46 \}/, 'panther hull must use the approved covered-track canvas');
assert.match(visuals, /turretTrim: \{ x: 0, y: 0, w: 95, h: 34 \}/, 'panther turret geometry must preserve the long-gun source scale');
assert.match(visuals, /pivot: \{ bodyX: 50, bodyY: 23, spriteX: 72, spriteY: 17 \}/, 'panther pivots must match the approved composite');
assert.match(units, /panther: \{/, 'panther combat stats must be generated');
assert.match(lang, /'unit\.name\.panther': \{ zh: "豹式坦克", en: "Panther G" \}/, 'panther must have localized battle labels');
assert.match(menu, /case 'panther': return '豹式坦克'/, 'tank image debugger must label the Panther option');
assert.match(battle, /case 'panther':[\s\S]*?splitTankGeometryConfigOf\('panther'\)/, 'destroyed Panther sizing must use split hull geometry');

for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  const png = path.join(root, 'assets', 'resources', 'textures', 'units', `panther_${suffix}.png`);
  assert.ok(fs.existsSync(png), `missing ${path.basename(png)}`);
  assert.ok(fs.existsSync(`${png}.meta`), `missing ${path.basename(png)}.meta`);
}

console.log('PantherTankVisual.test.js passed');
