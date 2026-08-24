const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

test('main-gun projectile presentation has a straight-through overpenetration phase', () => {
  assert.match(scene, /type ProjectileTraceMode = [^;]*'overpenetration'/);
  assert.match(scene, /report\.overpenetrated[\s\S]*?\? 'overpenetration'/);
  assert.match(scene, /tr\.phase = 'overpenetration-hidden'/);
  assert.match(scene, /tr\.dur = 0\.06/);
  assert.match(scene, /tr\.phase = 'overpenetration'/);
  assert.match(scene, /tr\.startX = tr\.exitX/);
  assert.match(scene, /tr\.endX = tr\.exitX \+ tr\.ux \* this\.hexSize \* 1\.35/);
  assert.match(scene, /Math\.min\(baseTail, Math\.hypot\(x - tr\.startX, y - tr\.startY\)\)/);
  assert.match(scene, /drawProjectileSpark\(g, tr\.exitX, tr\.exitY, tr/);
});

test('dice and combat feedback explicitly identify overpenetration', () => {
  assert.match(scene, /t\('dice\.panel\.overpenetrated'\)/);
  assert.match(scene, /t\('dmg\.outcome\.overpenetration'\)/);
  assert.match(scene, /battleLog\.combat\.overpenetration/);
});
