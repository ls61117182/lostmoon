const fs = require('fs');
const assert = require('assert');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const infantryVisuals = fs.readFileSync('data/infantry_visuals.csv', 'utf8');

for (const index of [1, 2, 3]) {
  const resourcePath = `assets/resources/textures/units/JapaneseInfantry0${index}.png`;
  assert(fs.existsSync(resourcePath), `${resourcePath} should exist`);
  assert(fs.existsSync(`${resourcePath}.meta`), `${resourcePath}.meta should exist`);
  assert(
    infantryVisuals.includes(`textures/units/JapaneseInfantry0${index}/spriteFrame`),
    `infantry_visuals.csv should configure JapaneseInfantry0${index}`,
  );
}

assert(
  /private\s+infantrySpriteFramesByKind:\s*Record<InfantryVisualKind/.test(battleScene),
  'BattleScene should cache infantry sprites independently by configured infantry kind',
);

const selector = battleScene.match(/private\s+infantryVisualsFor\s*\(u:\s*Unit\)[\s\S]*?\n  }\n\n/);
assert(selector, 'infantryVisualsFor() should centralize infantry visual selection');
assert(
  selector[0].includes('infantryVisualKindOf(u.kind)'),
  'Japanese infantry visuals should be selected through the shared configured unit-kind boundary',
);

const drawInfantry = battleScene.match(/private\s+drawInfantry\s*\(\s*u:\s*Unit,[\s\S]*?\n  }\n\n/);
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
