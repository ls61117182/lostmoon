const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const collectStatuses = battleScene.match(
  /private\s+collectUnitInspectStatusLines\s*\([^)]*\)[^{]*{[\s\S]*?\n  }\n\n  \/\*\*/,
);
assert(collectStatuses, 'BattleScene.collectUnitInspectStatusLines() should be found');
const statusSource = collectStatuses[0];

for (const normalStatusKey of [
  'tileInspect.status.radioIntact',
  'tileInspect.status.loaded',
  'tileInspect.status.unloaded',
  'tileInspect.status.hatchOpen',
]) {
  assert(
    !statusSource.includes(normalStatusKey),
    `tile inspection should not display normal state: ${normalStatusKey}`,
  );
}
assert(
  statusSource.includes('if (radio.isDamaged(u)) parts.push(t(radio.statusDamagedKey));'),
  'hardcore radio status should only be displayed when the radio is damaged',
);

const fillContent = battleScene.match(
  /private\s+fillTileInspectScrollContent\s*\([^)]*\)[^{]*{[\s\S]*?\n  }\n\n  \/\*\*/,
);
assert(fillContent, 'BattleScene.fillTileInspectScrollContent() should be found');
assert(
  fillContent[0].includes('if (stLines.length > 0)'),
  'the current-status row should only be created when abnormal statuses exist',
);
assert(
  !fillContent[0].includes("t('tileInspect.statusNone')"),
  'the current-status row should not use a normal-state placeholder',
);

console.log('BattleScene abnormal tile-status checks passed.');
