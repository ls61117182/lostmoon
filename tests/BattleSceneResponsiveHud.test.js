const fs = require('fs');
const assert = require('assert');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert(
  battleScene.includes("const root = new Node('BattleHUD');")
    && battleScene.includes('this.hudRoot = root;'),
  'BattleScene should isolate persistent screen UI under a dedicated BattleHUD root',
);

const responsiveLayout = battleScene.match(
  /private\s+layoutBattleHud\s*\(\)\s*{[\s\S]*?\n  }\n\n/,
);
assert(responsiveLayout, 'BattleScene.layoutBattleHud() should be found');
const layout = responsiveLayout[0];

assert(
  layout.includes('visibleSizeInRootSpace(UI_ROOT_SCALE)')
    && layout.includes('const left = -width * 0.5 + margin;')
    && layout.includes('const right = width * 0.5 - margin;')
    && layout.includes('const top = height * 0.5 - margin;')
    && layout.includes('const bottom = -height * 0.5 + margin;'),
  'HUD layout should derive all four visible edges from the adaptive visible size',
);

assert(
  layout.includes('this.missionTitleLabel?.node.setPosition(left, top, 0);')
    && layout.includes('this.statusPanel.setPosition(right - statusSize.width * 0.5')
    && layout.includes('this.combatLogPanel.setPosition(left, bottom, 0);')
    && layout.includes('this.chooseBar?.setPosition(0, operationY, 0);')
    && layout.includes('this.diceTrayRoot?.setPosition(0, operationY, 0);'),
  'Mission HUD, status panel, combat log, and player controls should use their requested screen anchors',
);

assert(
  /const\s+BOTTOM_CONTROL_SAFE_INSET\s*=\s*64;/.test(battleScene)
    && layout.includes('const operationY = bottom + BOTTOM_CONTROL_SAFE_INSET;')
    && /placeEnemyDiceTrayRoot[\s\S]*?BOTTOM_CONTROL_SAFE_INSET/.test(battleScene),
  'Player and enemy dice trays should share enough bottom inset for their action subtitles',
);

assert(
  /subscribeAdaptiveResolution\(\(\)\s*=>\s*{[\s\S]*?this\.layoutBattleHud\(\);/.test(battleScene),
  'Window and orientation changes should trigger responsive HUD layout',
);

assert(
  battleScene.includes('this.createHudRoot();')
    && /this\.buildCombatLog\(\);[\s\S]*?this\.layoutBattleHud\(\);/.test(battleScene),
  'Initial scene construction should create and lay out the HUD after all persistent widgets exist',
);

console.log('responsive battle HUD tests passed');
