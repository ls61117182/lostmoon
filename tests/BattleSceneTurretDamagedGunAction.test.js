const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

test('turret damage disables fire/rotate actions with the turret-damaged prompt', () => {
  const start = source.indexOf("private gunActionUnavailable(crewSlot?: 'gunner')");
  const end = source.indexOf('private precisionGunActionUnavailable()', start);
  assert.ok(start >= 0 && end > start, 'gunActionUnavailable should be present');

  const method = source.slice(start, end);
  assert.match(method, /if \(s\.turretDamaged\) return t\('dmg\.effect\.turret'\);/);
  assert.ok(
    method.indexOf('if (s.turretDamaged)') < method.indexOf('crewActionUnavailable(crewSlot)'),
    'turret damage should take priority so clicking always reports 炮塔受损',
  );

  const popoverStart = source.indexOf('private showDiePopover(idx: number)');
  const popoverEnd = source.indexOf('// ---------- 移动阶段动作 ----------', popoverStart);
  const popover = source.slice(popoverStart, popoverEnd);
  assert.match(popover, /color: unavailableReason \? DIE_ACTION_UNAVAILABLE : color/);
  assert.match(popover, /this\.showDieActionUnavailable\(it\.unavailableReason!, btn\)/);
});
