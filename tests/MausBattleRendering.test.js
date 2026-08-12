const fs = require('fs');
const path = require('path');
const assert = require('assert');

const battle = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

const liveGuard = battle.match(/function isEnemyTopKind[\s\S]*?\n\}/)?.[0] ?? '';
const destroyedGuard = battle.match(/function isDestroyedTopKind[\s\S]*?\n\}/)?.[0] ?? '';

assert.match(liveGuard, /TANK_VISUAL_KINDS/, 'live tank rendering must use the generated visual-kind registry');
assert.match(destroyedGuard, /TANK_VISUAL_KINDS/, 'destroyed tank rendering must use the generated visual-kind registry');
assert.doesNotMatch(liveGuard, /k === 'maus'/, 'live rendering must not maintain a second hand-written Maus whitelist');
assert.doesNotMatch(destroyedGuard, /k === 'maus'/, 'destroyed rendering must not maintain a second hand-written Maus whitelist');

console.log('MausBattleRendering.test.js passed');
