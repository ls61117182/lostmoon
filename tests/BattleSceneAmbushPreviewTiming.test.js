const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

const start = source.indexOf('  private tryAttack(target: Unit)');
const end = source.indexOf('\n  /**', start + 1);
assert.ok(start >= 0 && end > start, 'tryAttack must exist');
const body = source.slice(start, end);

const ambushCapture = body.indexOf(
  'const ambushModifier = ambushHitThresholdModifier(sherman, GameSession.gameMode);',
);
const reportRoll = body.indexOf('const report = rollAttack({');
const aimStart = body.indexOf('this.startShermanTurretAim(target, () => {', reportRoll);
const consumeAmbush = body.indexOf('markAmbushAction(sherman);', aimStart);

assert.ok(ambushCapture >= 0, 'the current attack must capture its ambush modifier');
assert.ok(reportRoll > ambushCapture, 'the attack report must use the captured ambush modifier');
assert.ok(aimStart > reportRoll, 'turret aiming must start after the report is locked');
assert.ok(
  consumeAmbush > aimStart,
  'ambush eligibility must remain active during turret rotation and be consumed in the firing callback',
);
assert.strictEqual(
  body.slice(ambushCapture, aimStart).includes('markAmbushAction(sherman);'),
  false,
  'committing a target must not change the live hit preview before turret rotation finishes',
);

console.log('BattleScene ambush preview timing tests passed');
