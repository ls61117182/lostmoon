const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');

function loadSaveLoad() {
  const source = fs.readFileSync(path.join(repo, 'assets/scripts/core/SaveLoad.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (id === './types') return {
      isTankKind: (kind) => kind === 'sherman',
      neutralizeUncrewedTank: (unit) => {
        if (!unit.destroyed && unit.crew && !Object.values(unit.crew).some(Boolean)) {
          unit.faction = 'neutral';
          unit.hatchOpen = false;
          unit.visionRange = 0;
          return true;
        }
        return false;
      },
    };
    if (id === './UnitDB') return { getUnitStats: () => ({ faction: 'usa' }) };
    if (id === './HexGrid') return { HexMap: { keyOf: (p) => `${p.q},${p.r}` } };
    if (id === './UnitLevel') return {
      normalizeUnitLevel: (value) => value === 'veteran' || value === 'elite' ? value : 'recruit',
      normalizePlayerCrewLevels: (value = {}) => ({
        commander: value.commander === 'veteran' || value.commander === 'elite' ? value.commander : 'recruit',
        loader: value.loader === 'veteran' || value.loader === 'elite' ? value.loader : 'recruit',
        gunner: value.gunner === 'veteran' || value.gunner === 'elite' ? value.gunner : 'recruit',
        driver: value.driver === 'veteran' || value.driver === 'elite' ? value.driver : 'recruit',
        coDriver: value.coDriver === 'veteran' || value.coDriver === 'elite' ? value.coDriver : 'recruit',
      }),
    };
    if (id === './AttackPositionMemory') return {
      cloneAttackPositionMemory: (value) => value ? JSON.parse(JSON.stringify(value)) : {
        currentTurn: { friendly: undefined, enemy: undefined },
        previousTurn: { friendly: undefined, enemy: undefined },
      },
    };
    return {};
  };
  new Function('require', 'module', 'exports', js)(req, mod, mod.exports);
  return mod.exports;
}

const { captureSave, applySave } = loadSaveLoad();

const sherman = {
  id: 'sherman_player',
  kind: 'sherman',
  faction: 'usa',
  pos: { q: 2, r: 3 },
  facing: 1,
  stats: {},
  fireLevel: 0,
  loaded: true,
  hatchOpen: true,
  crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
};
const mission = {
  data: { theater: 'pacific' },
  sherman,
  allies: [],
  enemies: [],
  smokeHexes: new Set(),
  smokeHexOwners: new Map(),
};

// Campaign checkpoints pass through localStorage JSON. Clean-state optional
// booleans therefore disappear before a later retry restores the snapshot.
const checkpoint = JSON.parse(JSON.stringify(captureSave({
  gameMode: 'hardcore',
  missionId: 'campaign_peleliu_02',
  mission,
  turn: 1,
  phase: 'player',
  movesLeft: 2,
  attacksLeft: 1,
  miscDone: false,
  playerStep: 'choose',
  hatchChangedThisTurn: false,
  phaseDice: [],
  attackPositionMemory: {
    currentTurn: { friendly: { q: 4, r: 2 } },
    previousTurn: { friendly: { q: 3, r: 1 } },
  },
})));

sherman.fireLevel = 3;
sherman.turretDamaged = true;
sherman.paralyzed = true;
sherman.radioDamaged = true;
sherman.loaded = false;
sherman.hatchOpen = false;
sherman.crew.gunner = false;

const result = applySave(mission, 'campaign_peleliu_02', checkpoint);
assert.strictEqual(result.ok, true);
assert.strictEqual(sherman.fireLevel, 0);
assert.strictEqual(sherman.turretDamaged, false);
assert.strictEqual(sherman.paralyzed, false);
assert.strictEqual(sherman.radioDamaged, false);
assert.strictEqual(sherman.loaded, true);
assert.strictEqual(sherman.hatchOpen, true);
assert.strictEqual(sherman.crew.gunner, true);
assert.deepStrictEqual(result.attackPositionMemory, {
  currentTurn: { friendly: { q: 4, r: 2 } },
  previousTurn: { friendly: { q: 3, r: 1 } },
});

console.log('campaign checkpoint restore tests passed');
