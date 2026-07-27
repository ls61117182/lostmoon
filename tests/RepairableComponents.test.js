const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/core/RepairableComponents.ts'),
  'utf8',
);

assert.match(source, /export type RepairableComponentId = 'turret' \| 'mobility' \| 'radio';/);
assert.match(source, /REPAIRABLE_COMPONENT_IDS: RepairableComponentId\[\] = \['turret', 'mobility', 'radio'\]/);
assert.match(source, /playerAvailable: \(mode\) => mode === 'hardcore'/);
assert.match(source, /repair: \(unit\) => \{ unit\.radioDamaged = false; \}/);
assert.match(source, /export function firstDamagedRepairableComponent\(unit: Unit\)/);

console.log('Repairable component configuration tests passed');
