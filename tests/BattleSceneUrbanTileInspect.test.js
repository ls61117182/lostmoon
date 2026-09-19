const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const methodBody = (name) => {
  const start = source.indexOf(`private ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf('\n  private ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

assert.match(
  methodBody('addTileInspectUrbanBuildingSprite'),
  /urbanBuildingSpritePath\(tile\)[\s\S]*?urbanOverlaySpriteFrames\[path\][\s\S]*?TileInspectUrbanBuildingSprite[\s\S]*?sp\.spriteFrame = sf/,
  'the tile information preview must use the selected building variant and damage-state sprite',
);
assert.match(
  methodBody('addTileInspectTilePreview'),
  /paintTileInspectPreview[\s\S]*?addTileInspectUrbanBuildingSprite\(preview, tile, 0, hexCY, hexR\)/,
  'the building image must be layered over the terrain preview',
);

console.log('BattleScene urban tile inspect tests passed');
