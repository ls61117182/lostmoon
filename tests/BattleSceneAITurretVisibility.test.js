const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

function methodBody(name, nextMarker) {
  const start = scene.indexOf(`private ${name}`);
  assert(start >= 0, `${name} must exist`);
  const end = scene.indexOf(nextMarker, start);
  assert(end > start, `${name} end marker must exist`);
  return scene.slice(start, end);
}

const selectTarget = methodBody('selectAIShootTarget', 'private selectAIMGTarget');
assert(
  selectTarget.indexOf('isUnitInVision(') < selectTarget.indexOf('canAttack({'),
  'main-gun target selection must reject unseen units before checking attack legality',
);

const resolveTarget = methodBody('canAIMainGunResolveSelectedTarget', 'private beginAllyPhase');
assert(resolveTarget.includes('return isUnitInVision('));
assert(!resolveTarget.includes('isWithinOwnVisionRange'));

const attack = methodBody('tryEnemyAttack', '// ---------- 攻击掷骰动画面板');
const visibleGate = attack.indexOf('const targetVisible =');
const firstTurretTurn = attack.indexOf("enemy.stats.visionType === 'turreted'", visibleGate);
assert(visibleGate >= 0 && firstTurretTurn > visibleGate,
  'visibility must be confirmed before any non-player main-gun turret rotation');
assert.match(attack, /if \(!targetVisible\)[\s\S]*?return false;/);
assert(!attack.includes('主炮目标不在视野内，炮塔转向'));

console.log('BattleScene AI turret visibility tests passed.');
