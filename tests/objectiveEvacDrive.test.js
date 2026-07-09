const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');

function loadTsModule(rel) {
  const abs = path.join(repo, rel);
  const source = fs.readFileSync(abs, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (id === './types') return loadTsModule('assets/scripts/core/types.ts');
    if (id === './MissionLoader') return loadTsModule('assets/scripts/core/MissionLoader.ts');
    if (id === './HexGrid') return loadTsModule('assets/scripts/core/HexGrid.ts');
    return require(id);
  };
  new Function('require', 'module', 'exports', js)(req, mod, mod.exports);
  return mod.exports;
}

const { isShermanEvacDrive } = loadTsModule('assets/scripts/core/Objective.ts');
const { offsetToAxial, neighbor } = loadTsModule('assets/scripts/core/HexGrid.ts');

function makeMission(hasTargetTile) {
  const evac = offsetToAxial({ col: 1, row: 0 }, 0);
  const target = neighbor(evac, 0);
  const tiles = new Map([[`${evac.q},${evac.r}`, { pos: evac, terrain: 'clear' }]]);
  if (hasTargetTile) tiles.set(`${target.q},${target.r}`, { pos: target, terrain: 'clear' });
  return {
    map: {
      get: (pos) => tiles.get(`${pos.q},${pos.r}`),
      has: (pos) => tiles.has(`${pos.q},${pos.r}`),
    },
    sherman: { destroyed: false },
    enemies: [],
    data: {
      rowParityOffset: 0,
      objective: { type: 'destroy_kind_evac', evacAt: { col: 1, row: 0 }, evacExitDir: 0 },
    },
  };
}

const from = offsetToAxial({ col: 1, row: 0 }, 0);
const to = neighbor(from, 0);

assert.strictEqual(isShermanEvacDrive(makeMission(false), from, 0, 1, to), true);
assert.strictEqual(isShermanEvacDrive(makeMission(true), from, 0, 1, to), false);
assert.strictEqual(
  isShermanEvacDrive(makeMission(true), from, 0, 1, to, { canExitTo: () => true }),
  true,
  'campaign transition can treat the next segment entry tile as an evac target',
);

console.log('objective evac drive tests passed');
