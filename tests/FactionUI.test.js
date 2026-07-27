const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'assets/scripts/core/FactionUI.ts'), 'utf8');

const assert = (ok, message) => { if (!ok) throw new Error(message); };

assert(/faction === 'ussr' \? 'soviet'/.test(source), 'PVP ussr should resolve to the Soviet insignia');
assert(/faction === 'japanese' \? 'japan'/.test(source), 'battle japanese faction should resolve to the Japanese insignia');
assert(/germany\/spriteFrame/.test(source), 'Germany should load its transparent source icon');
assert(/britain/.test(source), 'Britain should be available as a reusable UI insignia');

console.log('Faction UI test passed');
