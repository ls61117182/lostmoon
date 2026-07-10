const fs = require('fs');
const assert = require('assert');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

for (const index of [1, 2, 3]) {
  const resourcePath = `assets/resources/textures/units/JapaneseInfantry0${index}.png`;
  assert(fs.existsSync(resourcePath), `${resourcePath} should exist`);
  assert(fs.existsSync(`${resourcePath}.meta`), `${resourcePath}.meta should exist`);
  assert(
    battleScene.includes(`textures/units/JapaneseInfantry0${index}/spriteFrame`),
    `BattleScene should load JapaneseInfantry0${index}`,
  );
}

assert(
  /private\s+japaneseInfantrySpriteFrames:\s*Array<SpriteFrame\s*\|\s*null>/.test(battleScene),
  'BattleScene should keep Japanese infantry sprite frames separate from German infantry frames',
);

const selector = battleScene.match(/private\s+infantryVisualsFor\s*\(u:\s*Unit\)[\s\S]*?\n  }\n\n/);
assert(selector, 'infantryVisualsFor() should centralize infantry visual selection');
assert(
  selector[0].includes("u.kind === 'japanese_infantry'"),
  'Japanese infantry visuals should be selected by the narrow japanese_infantry unit-kind boundary',
);

const drawInfantry = battleScene.match(/private\s+drawInfantry\s*\(u:\s*Unit,[\s\S]*?\n  }\n\n/);
assert(drawInfantry, 'drawInfantry() should be found');
assert(
  drawInfantry[0].includes('this.infantryVisualsFor(u)'),
  'Battlefield infantry rendering should use the unit-kind visual selector',
);

const tileInspect = battleScene.match(/private\s+paintTileInspectUnitPreview\s*\([\s\S]*?\n  }\n\n/);
assert(tileInspect, 'paintTileInspectUnitPreview() should be found');
assert(
  tileInspect[0].includes('this.infantryVisualsFor(u)'),
  'Tile inspection should use the same unit-kind visual selector',
);

console.log('BattleScene Japanese infantry visuals test passed');
