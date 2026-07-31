const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  battleScene,
  /private\s+infantryVisualFacing\s*=\s*new Map<string, Direction>\(\)/,
  'BattleScene should own presentation-only infantry facing state',
);
assert.match(
  battleScene,
  /private\s+setInfantryVisualFacing\s*\(unit:\s*Unit,\s*target:\s*Axial\)[\s\S]*?if\s*\(!isFootUnit\(unit\)\)\s*return;[\s\S]*?infantryVisualDirection\(unit\.pos, target\)/,
  'visual facing should be gated to foot units and derived from actor-to-target geometry',
);
assert.match(
  battleScene,
  /private\s+infantryVisualAngle\s*\(unit:\s*Unit\)[\s\S]*?this\.infantryVisualFacing\.get\(unit\.id\)[\s\S]*?unit\.facing[\s\S]*?infantrySpriteAngle/,
  'rendering should prefer the latest visual direction and fall back to initial unit facing',
);

const movingDraw = battleScene.match(/private\s+drawUnitMaybeAnim\s*\(u:\s*Unit\)[\s\S]*?\n  }\n\n/);
assert(movingDraw, 'drawUnitMaybeAnim() should be found');
assert(
  movingDraw[0].includes('this.setInfantryVisualFacing(u, { q: this.anim.toQ, r: this.anim.toR })'),
  'foot units should face the move destination before and during their move animation',
);

const fireCue = battleScene.match(/private\s+playAttackFireCue\s*\([\s\S]*?\n  }\n\n/);
assert(fireCue, 'playAttackFireCue() should be found');
assert(
  fireCue[0].includes('this.setInfantryVisualFacing(attacker, target.pos)'),
  'the shared attack presentation path should face foot attackers toward the target',
);
assert.match(
  battleScene,
  /case 'machine_gun':[\s\S]*?this\.setInfantryVisualFacing\(attacker, target\.pos\)/,
  'remote PVP machine-gun presentation should also update infantry facing',
);
assert.match(
  battleScene,
  /case 'ai_attack':[\s\S]*?this\.setInfantryVisualFacing\(attacker, target\.pos\)/,
  'remote PVP AI-attack presentation should also update infantry facing',
);
assert.match(
  battleScene,
  /beginAdjacentInfantryDiceChain[\s\S]*?v\.attackerId[\s\S]*?attacker,[\s\S]*?target:\s*sh/,
  'turn-end adjacent infantry volleys should retain their attacker for visual facing',
);

const drawInfantry = battleScene.match(/private\s+drawInfantry\s*\(\s*u:\s*Unit,[\s\S]*?\n  }\n\n/);
assert(drawInfantry, 'drawInfantry() should be found');
assert(
  drawInfantry[0].includes('const visualAngle = customVisualAngle ?? this.infantryVisualAngle(u)'),
  'ordinary infantry should retain its visual facing while composite units may provide an interpolated angle',
);
assert(drawInfantry[0].includes('slot.node.angle = visualAngle'), 'officer and squad sprites should use visualAngle');
assert.strictEqual(
  (drawInfantry[0].match(/slot\.node\.angle = visualAngle/g) || []).length,
  2,
  'both the officer sprite and the infantry squad loop should apply visualAngle',
);

const inspect = battleScene.match(/private\s+paintTileInspectUnitPreview\s*\([\s\S]*?\n  }\n\n/);
assert(inspect, 'paintTileInspectUnitPreview() should be found');
assert(
  inspect[0].includes('const visualAngle = this.infantryVisualAngle(u)'),
  'tile inspect should use the same visual-facing state',
);
assert(
  inspect[0].includes('visualAngle'),
  'tile inspect sprite creation should receive the infantry angle',
);

const facingHelper = battleScene.match(/private\s+setInfantryVisualFacing\s*\([\s\S]*?\n  }\n\n/);
assert(facingHelper);
assert(!/unit\.facing\s*=/.test(facingHelper[0]), 'visual facing must not mutate gameplay-facing state');

const turretReset = battleScene.match(/private\s+resetTurretFacingState\s*\([\s\S]*?\n  }\n/);
assert(turretReset);
assert(
  !turretReset[0].includes('infantryVisualFacing.clear()'),
  'routine PVP turret snapshots must not erase persistent infantry visual facing',
);
assert.match(
  battleScene,
  /private\s+loadAndDraw\s*\([^)]*\)[\s\S]*?infantryVisualFacing\.clear\(\)/,
  'loading a new mission should clear presentation-only infantry facing',
);

console.log('BattleScene infantry facing integration test passed');
