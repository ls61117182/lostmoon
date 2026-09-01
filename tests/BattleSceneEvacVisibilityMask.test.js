const fs = require('fs');
const assert = require('assert');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const redrawMasks = battleScene.match(/private\s+redrawUnitVisibilityMask\s*\(\)\s*{[\s\S]*?\n  }\n\n/);
assert(redrawMasks, 'redrawUnitVisibilityMask() should be found');
assert(
  redrawMasks[0].includes('this.redrawVisibleHexMask(this.unitVisibilityMaskGraphics, true)'),
  'The unit stencil should include the player tank off-map evacuation extension',
);
assert(
  redrawMasks[0].includes('this.redrawVisibleHexMask(this.trackVisibilityMaskGraphics)'),
  'The track stencil should keep using normal visible-map clipping',
);

const evacExtension = battleScene.match(/private\s+playerTankEvacVisibilityExtension\s*\(\)\s*:\s*Axial\s*\|\s*null\s*{[\s\S]*?\n  }\n\n/);
assert(evacExtension, 'playerTankEvacVisibilityExtension() should be found');
assert(
  evacExtension[0].includes('this.anim?.evacExit')
    && evacExtension[0].includes('this.anim.unit === playerTank')
    && evacExtension[0].includes('this.anim.toQ'),
  'The evacuation animation target should remain inside the unit stencil',
);
assert(
  evacExtension[0].includes('this.mission.playerTankEvacuated || this.mission.shermanEvacuated')
    && evacExtension[0].includes('pos = playerTank.pos'),
  'The evacuated player tank should remain inside the unit stencil after the animation',
);
assert(
  evacExtension[0].includes('!this.mission.map.has(pos)'),
  'Only a true off-map evacuation should extend the unit stencil',
);

console.log('BattleScene evacuation visibility mask test passed');
