const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const storage = new Map();
global.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const {
  DEFAULT_PLAYER_TANK_KIND,
  missionWithSelectedPlayerTank,
  normalizeSelectedPlayerTankKind,
  selectablePlayerTankKinds,
} = require('../assets/scripts/core/PlayerTankSelection.ts');
const { GameSession } = require('../assets/scripts/core/GameSession.ts');
const { MENU_STATE_KEY, MenuProgress } = require('../assets/scripts/core/LevelDB.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { isSameSide } = require('../assets/scripts/core/types.ts');

assert.strictEqual(DEFAULT_PLAYER_TANK_KIND, 'sherman');
assert.strictEqual(normalizeSelectedPlayerTankKind('not_a_tank'), 'sherman');
const selectable = selectablePlayerTankKinds();
assert(selectable.includes('sherman'));
assert(selectable.includes('tiger'));
assert(selectable.includes('type97'));
assert(!selectable.includes('truck'));
assert(!selectable.includes('infantry'));

const sourcePlayer = {
  kind: 'sherman',
  faction: 'usa',
  at: { col: 0, row: 0 },
  facing: 2,
  hatchOpen: false,
  loaded: true,
  crew: { loader: false },
};
const sourceMission = {
  id: 'player_tank_selection_test',
  name: 'Selection test',
  description: '',
  cols: 3,
  rows: 1,
  tiles: [[{ t: 'f' }, { t: 'f' }, { t: 'f' }]],
  playerTank: sourcePlayer,
  sherman: sourcePlayer,
  allies: [{ kind: 'sherman76', faction: 'usa', at: { col: 1, row: 0 }, facing: 0 }],
  enemies: [{ kind: 'panzer3', faction: 'german', at: { col: 2, row: 0 }, facing: 3 }],
  objective: { type: 'destroy_all_enemies' },
};

const selectedMission = missionWithSelectedPlayerTank(sourceMission, 'tiger');
assert.notStrictEqual(selectedMission, sourceMission, 'selection should not mutate a resource mission object');
assert.notStrictEqual(selectedMission.playerTank, sourcePlayer);
assert.strictEqual(selectedMission.playerTank, selectedMission.sherman, 'compatibility aliases must share one placement');
assert.strictEqual(selectedMission.playerTank.kind, 'tiger');
assert.strictEqual(selectedMission.playerTank.faction, 'german');
assert.deepStrictEqual(selectedMission.playerTank.at, sourcePlayer.at);
assert.strictEqual(selectedMission.playerTank.facing, 2);
assert.strictEqual(selectedMission.playerTank.hatchOpen, false);
assert.strictEqual(selectedMission.playerTank.loaded, true);
assert.deepStrictEqual(selectedMission.playerTank.crew, { loader: false });
assert.strictEqual(sourceMission.playerTank.kind, 'sherman');
assert.strictEqual(sourceMission.playerTank.faction, 'usa');

const loaded = loadMission(selectedMission);
assert.strictEqual(loaded.playerTank.kind, 'tiger');
assert.strictEqual(loaded.playerTank.faction, 'german');
assert.strictEqual(loaded.playerTank.sideId, 'player');
assert.strictEqual(loaded.playerTank.controller, 'local_player');
assert.strictEqual(loaded.allies[0].faction, 'usa');
assert.strictEqual(isSameSide(loaded.playerTank, loaded.allies[0]), true,
  'a German player tank and American AI teammates must remain friendly');

assert.strictEqual(MenuProgress.load().selectedPlayerTankKind, 'sherman');
MenuProgress.setSelectedPlayerTankKind('panther');
assert.strictEqual(MenuProgress.load().selectedPlayerTankKind, 'panther');
const persisted = JSON.parse(storage.get(MENU_STATE_KEY));
persisted.selectedPlayerTankKind = 'infantry';
storage.set(MENU_STATE_KEY, JSON.stringify(persisted));
assert.strictEqual(MenuProgress.load().selectedPlayerTankKind, 'sherman', 'invalid persisted choices fall back safely');

GameSession.setSelectedPlayerTankKind('maus');
assert.strictEqual(GameSession.selectedPlayerTankKind, 'maus');
GameSession.setSelectedPlayerTankKind('truck');
assert.strictEqual(GameSession.selectedPlayerTankKind, 'sherman');
GameSession.reset();
assert.strictEqual(GameSession.selectedPlayerTankKind, 'sherman');

const root = path.resolve(__dirname, '..');
const menuSource = fs.readFileSync(path.join(root, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');
const battleSource = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
assert.match(menuSource, /PlayerTankSelectButton/);
assert.match(menuSource, /selectablePlayerTankKinds\(\)/);
assert.match(menuSource, /setSelectedPlayerTankKind\(save\.playerTank\?\.kind \?\? save\.sherman\.kind\)/,
  'continue flow should select the saved protagonist kind before mission loading');
assert.match(battleSource,
  /if \(!GameSession\.isPvp\) \{\s*data = missionWithSelectedPlayerTank\(data, GameSession\.selectedPlayerTankKind\);\s*\}/,
  'single-player missions should apply the choice while PVP keeps its dedicated lineup');

delete global.localStorage;
console.log('player tank selection tests passed');
