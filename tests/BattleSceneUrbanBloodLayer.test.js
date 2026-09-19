const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const blood = source.indexOf("new Node('InfantryBloodDecals')");
const buildings = source.indexOf("new Node('UrbanBuildingSprites')");
const units = source.indexOf("new Node('VisibleUnitMask')");
assert.ok(blood >= 0 && buildings > blood && units > buildings,
  'city buildings must render above infantry blood decals and below live units');
assert.match(source,
  /urbanBuildingSpritePoolNext = 0;[\s\S]*?urbanBuildingSpritePool[\s\S]*?node\.active = false/,
  'the city-building sprite pool must reset on every map redraw');
assert.match(source,
  /urbanBuildingSpritePath\(t\)[\s\S]*?drawUrbanBuildingSpriteFrame\(c\.x, c\.y, this\.hexSize, frame, urbanBuildingSpriteScale\(t\)\)/,
  'city buildings must use the dedicated layer instead of the ground terrain sprite pool');

console.log('BattleScene urban building/blood layer tests passed');
