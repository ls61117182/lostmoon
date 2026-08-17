const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

try {
  const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
  const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
  const { commanderHasSkill } = require('../assets/scripts/core/UnitLevel.ts');

  const map = new HexMap(1, 1);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  const tank = level => ({
    id: `tank-${level}`,
    kind: 'panzer4',
    faction: 'german',
    pos: { q: 0, r: 0 },
    facing: 0,
    stats: { faction: 'german' },
    crew: { commander: true },
    unitLevel: level,
  });
  const target = {
    id: 'target',
    kind: 'sherman',
    faction: 'usa',
    pos: { q: 1, r: 0 },
    facing: 3,
    stats: { faction: 'usa' },
  };
  const canSmoke = unit => canExecuteAction(unit, 'smoke', target, map, new Set(), new Set());

  const recruit = tank('recruit');
  assert.strictEqual(commanderHasSkill(recruit, 'use_smoke_grenade'), false);
  assert.strictEqual(canSmoke(recruit), false, 'recruit NPC tanks cannot deploy smoke by default');

  const veteran = tank('veteran');
  assert.strictEqual(commanderHasSkill(veteran, 'use_smoke_grenade'), true);
  assert.strictEqual(canSmoke(veteran), true, 'veteran NPC commanders receive the smoke skill');

  const elite = tank('elite');
  assert.strictEqual(commanderHasSkill(elite, 'use_smoke_grenade'), true);
  assert.strictEqual(canSmoke(elite), true, 'elite NPC commanders receive the smoke skill');

  recruit.crewSkills = { commander: ['use_smoke_grenade'] };
  assert.strictEqual(canSmoke(recruit), true, 'an explicitly skilled recruit may deploy smoke');
  recruit.crew.commander = false;
  assert.strictEqual(canSmoke(recruit), false, 'a dead skilled commander cannot deploy smoke');

  const playerCrewTank = tank('veteran');
  playerCrewTank.crewLevels = {
    commander: 'veteran', loader: 'recruit', gunner: 'recruit', driver: 'recruit', coDriver: 'recruit',
  };
  assert.strictEqual(
    commanderHasSkill(playerCrewTank, 'use_smoke_grenade'),
    false,
    'rank defaults apply only to non-player tanks',
  );

  recruit.crew.commander = true;
  delete recruit.crewSkills;
  assert.strictEqual(commanderHasSkill(veteran, 'open_hatch_observation'), true);
  assert.strictEqual(commanderHasSkill(recruit, 'open_hatch_observation'), false);

  console.log('AI commander skill tests passed.');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
