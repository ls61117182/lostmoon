const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const lang = fs.readFileSync(path.join(root, 'assets/scripts/core/LangDB.ts'), 'utf8');

for (const shell of ['ap', 'he', 'hvap']) {
  assert.match(lang, new RegExp(`'ammo\\.tooltip\\.${shell}\\.title'`));
  assert.match(lang, new RegExp(`'ammo\\.tooltip\\.${shell}\\.description'`));
}
assert.match(scene, /'reload-ap', doubles, undefined, 'ap'\)/);
assert.match(scene, /'reload-he', doubles, undefined, 'he'\)/);
assert.match(scene, /'reload-hvap', doubles, String\(remaining\), 'hvap'\)/);

assert.match(scene, /btn\.on\(Node\.EventType\.MOUSE_ENTER[\s\S]*?showAmmoTooltip\(ammoType, event\)/);
assert.match(scene, /btn\.on\(Node\.EventType\.MOUSE_LEAVE[\s\S]*?closeAmmoTooltip\(\)/);
assert.match(scene, /HVAP_PENETRATION_BONUS[\s\S]*?HVAP_EFFECTIVE_RANGE_BONUS/);
assert.match(scene, /local\.x >= 0 \? -W \/ 2 : W \/ 2/);
assert.match(scene, /local\.y >= 0 \? -H \/ 2 : H \/ 2/);
assert.match(scene, /root\.setPosition\(centerX, centerY, 0\)/);

console.log('Ammo reload tooltip tests passed');
