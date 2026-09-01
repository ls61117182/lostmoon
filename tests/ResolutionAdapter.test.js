const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop resolution adapter preserves 16:9 content and exposes surplus screen area', () => {
  const adapter = read('assets/scripts/view/ResolutionAdapter.ts');
  assert.match(adapter, /DESIGN_RESOLUTION_WIDTH = 1920/);
  assert.match(adapter, /DESIGN_RESOLUTION_HEIGHT = 1080/);
  assert.match(adapter, /aspect >= DESIGN_ASPECT[\s\S]*?ResolutionPolicy\.FIXED_HEIGHT[\s\S]*?ResolutionPolicy\.FIXED_WIDTH/);
  assert.match(adapter, /view\.setDesignResolutionSize\(DESIGN_RESOLUTION_WIDTH, DESIGN_RESOLUTION_HEIGHT, policy\)/);
  assert.match(adapter, /screen\.on\('window-resize', handleWindowResize\)/);
});

test('menu and battle backgrounds expand to the visible logical area', () => {
  for (const file of [
    'assets/scripts/view/MainMenuScene.ts',
    'assets/scripts/view/BattleScene.ts',
  ]) {
    const source = read(file);
    assert.match(source, /applyAdaptiveResolution\(\)/, `${file} must apply the shared policy`);
    assert.match(source, /visibleSizeInRootSpace\(UI_ROOT_SCALE\)/, `${file} must size its background to the visible area`);
    assert.match(source, /subscribeAdaptiveResolution/, `${file} must react to window aspect changes`);
  }
});

test('all modal backdrops use the shared adaptive fullscreen mask', () => {
  const adapter = read('assets/scripts/view/ResolutionAdapter.ts');
  assert.match(adapter, /class AdaptiveFullscreenMask extends Component/);
  assert.match(adapter, /visibleSizeInRootSpace\(this\.rootScale\)/);
  assert.match(adapter, /subscribeAdaptiveResolution\(\(\) => this\.redraw\(\)\)/);
  assert.match(adapter, /graphics\.rect\(-width \* 0\.5, -height \* 0\.5, width, height\)/);
  assert.match(adapter, /onDestroy\(\)[\s\S]*?this\.resolutionUnsubscribe\?\.\(\)/);

  const menu = read('assets/scripts/view/MainMenuScene.ts');
  const battle = read('assets/scripts/view/BattleScene.ts');
  assert.match(menu, /createAdaptiveFullscreenMask\(/);
  assert.match(battle, /createAdaptiveFullscreenMask\(/);
  assert.doesNotMatch(menu, /const backdrop = new Node\('Backdrop'\)/);
  assert.doesNotMatch(battle, /const backdrop = new Node\('Backdrop'\)/);
  assert.doesNotMatch(battle, /const mask = new Node\('Mask'\)[\s\S]{0,300}?DICE_BACKDROP/);
});
