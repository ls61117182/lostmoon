const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const buildMethod = battleScene.match(/private\s+buildStatusPanel\s*\([\s\S]*?\n  }\n\n  \/\*\*/);
assert(buildMethod, 'Status panel builder should be present');
assert(
  buildMethod[0].includes('crewStartX + i * (crewIconSize + crewIconGap)'),
  'Crew status icons should be arranged in one horizontal row',
);
assert(
  !buildMethod[0].includes("t('status.crew."),
  'Crew role text should not be rendered in the status panel',
);
assert(
  buildMethod[0].includes('this.statusCrewRankNodes.push(rankNode);'),
  'Each crew icon should own a bottom-right rank badge',
);

const refreshMethod = battleScene.match(/private\s+refreshStatusPanel\s*\([\s\S]*?\n  }\n\n/);
assert(refreshMethod, 'Status panel refresh should be present');
assert(
  refreshMethod[0].includes('CREW_STATUS_HATCH_OPEN_COLOR'),
  'An alive open-hatch commander should use the green icon state',
);
assert(
  refreshMethod[0].includes('CREW_STATUS_DEAD_COLOR')
    && refreshMethod[0].includes('this.statusCrewDeadMarkers[i].active = dead'),
  'Dead crew should be greyed and display the red diagonal marker',
);
assert(
  refreshMethod[0].includes("level === 'veteran' || level === 'elite'"),
  'Veteran and elite crew should display their rank badge',
);

console.log('BattleScene crew status icon test passed');
