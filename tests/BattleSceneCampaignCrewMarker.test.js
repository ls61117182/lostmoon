const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /private\s+addTileInspectCrewDeadMarker\s*\(iconNode:\s*Node,\s*slot:\s*number,\s*iconSize:\s*number\)/.test(battleScene),
  'Tile inspection should have a dedicated crew KIA marker renderer',
);

const markerMethod = battleScene.match(/private\s+addTileInspectCrewDeadMarker[\s\S]*?\n  }\n\n/);
assert(markerMethod, 'Crew KIA marker renderer should be present');
assert(
  (markerMethod[0].match(/marker\.lineTo/g) || []).length === 4,
  'Crew KIA marker should draw two diagonals twice (dark under-stroke and red foreground)',
);

const crewRowMethod = battleScene.match(/private\s+addTileInspectCrewRow[\s\S]*?\n  }\n\n/);
assert(crewRowMethod, 'Tile inspection crew row renderer should be present');
assert(
  crewRowMethod[0].includes('icon.color = new Color(130, 130, 130, 210);'),
  'Dead crew icon should be dimmed so the KIA marker remains distinct',
);
assert(
  crewRowMethod[0].includes('this.addTileInspectCrewDeadMarker(iconNode, slot, iconSize);'),
  'Dead crew row should attach the dedicated KIA marker',
);

console.log('BattleScene campaign crew marker test passed');
