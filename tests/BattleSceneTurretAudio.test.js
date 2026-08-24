const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const audio = fs.readFileSync(path.join(root, 'assets/scripts/audio/GameAudio.ts'), 'utf8');
const battle = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

assert.match(audio, /turretTraverse:\s*'audio\/tank_turret_rotate'/);
assert.match(audio, /let turretTraversePlayId = 0/);
assert.match(
  audio,
  /export function startTurretTraverseSound[\s\S]*?\+\+turretTraversePlayId[\s\S]*?myId !== turretTraversePlayId[\s\S]*?turretTraverseSource\.loop = true[\s\S]*?turretTraverseSource\.play\(\)/,
  'turret audio must loop on a cancellable dedicated source',
);
assert.match(
  audio,
  /export function stopTurretTraverseSound[\s\S]*?turretTraversePlayId\+\+[\s\S]*?turretTraverseSource\.stop\(\)/,
  'turret audio stop must cancel late loads and active playback',
);
assert.match(
  battle,
  /private beginTurretAimAnim[\s\S]*?this\.turretAimAnim = anim[\s\S]*?!anim\.suppressTurretSound[\s\S]*?anim\.from !== anim\.to[\s\S]*?startTurretTraverseSound\(\)/,
  'only a real turret-angle animation should start the sound',
);
assert.match(
  battle,
  /if \(this\.turretAimAnim\)[\s\S]*?if \(a\.t < 1\)[\s\S]*?return;[\s\S]*?!a\.suppressTurretSound[\s\S]*?stopTurretTraverseSound\(\)[\s\S]*?this\.turretAimAnim = null/,
  'turret sound must stop in the same update frame that completes the animation',
);
assert.match(
  battle,
  /private startHardcoreATGunAim[\s\S]*?beginTurretAimAnim\(\{[\s\S]*?unit: gun,[\s\S]*?suppressTurretSound: true/,
  'AT-gun whole-mount rotation must suppress the tank turret motor sound',
);
assert.match(battle, /private resetTurretFacingState\(\)[\s\S]*?stopTurretTraverseSound\(\)/);
assert.match(audio, /stopBattleSfx[\s\S]*?stopTurretTraverseSound\(\)/);
assert.ok(fs.existsSync(path.join(root, 'assets/resources/audio/tank_turret_rotate.mp3')));
assert.ok(fs.existsSync(path.join(root, 'assets/resources/audio/tank_turret_rotate.mp3.meta')));

console.log('BattleScene turret audio tests passed');
