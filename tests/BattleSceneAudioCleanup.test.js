const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gameAudio = fs.readFileSync(path.join(root, 'assets/scripts/audio/GameAudio.ts'), 'utf8');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /export\s+function\s+stopBattleSfx\s*\(/.test(gameAudio),
  'GameAudio should export stopBattleSfx() for clearing persistent battle effects',
);

assert(
  /let\s+sfxPlayId\s*=\s*0/.test(gameAudio),
  'GameAudio should track SFX play generations so late load callbacks can be cancelled',
);

assert(
  /if\s*\(\s*myId\s*!==\s*sfxPlayId\s*\|\|\s*!clip\s*\|\|\s*sfxPool\.length\s*===\s*0\s*\)\s*return/.test(gameAudio),
  'playSfxKey() should ignore late callbacks after battle SFX cleanup',
);

assert(
  /stopBattleSfx/.test(battleScene),
  'BattleScene should call stopBattleSfx() before leaving the battle scene',
);

const onBackToMenu = battleScene.match(/private\s+onBackToMenu\s*\(\)\s*{[\s\S]*?director\.loadScene/);
assert(onBackToMenu, 'BattleScene.onBackToMenu() should be found');
assert(
  onBackToMenu[0].includes('stopBattleSfx();'),
  'BattleScene.onBackToMenu() should stop persistent battle SFX before loading the menu scene',
);

console.log('BattleScene audio cleanup test passed');
