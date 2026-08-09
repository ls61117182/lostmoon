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
  const { commanderHatchVisualState } = require('../assets/scripts/core/CommanderHatch.ts');
  const { applyAttack } = require('../assets/scripts/core/Combat.ts');
  const {
    SPLIT_TANK_KINDS,
    commanderHatchRenderedScaleCoefficient,
    emptyCommanderHatchScaleOf,
  } = require('../assets/scripts/core/TankVisualDB.ts');

  const tank = {
    kind: 'sherman',
    destroyed: false,
    hatchOpen: true,
    crew: { commander: true },
  };

  assert.strictEqual(commanderHatchVisualState(tank), 'occupied');

  tank.crew.commander = false;
  assert.strictEqual(commanderHatchVisualState(tank), 'empty');

  tank.hatchOpen = false;
  assert.strictEqual(commanderHatchVisualState(tank), 'hidden');

  tank.hatchOpen = true;
  tank.destroyed = true;
  assert.strictEqual(commanderHatchVisualState(tank), 'hidden');

  const openHatchTarget = {
    kind: 'sherman',
    destroyed: false,
    hatchOpen: true,
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  };
  applyAttack(openHatchTarget, {
    hit: true,
    penetrated: false,
    commanderKilledByHitDoubles: true,
  });
  assert.strictEqual(openHatchTarget.crew.commander, false);
  assert.strictEqual(openHatchTarget.hatchOpen, true);
  assert.strictEqual(commanderHatchVisualState(openHatchTarget), 'empty');

  const closedHatchTarget = {
    ...openHatchTarget,
    hatchOpen: false,
    crew: { ...openHatchTarget.crew, commander: true },
  };
  applyAttack(closedHatchTarget, {
    hit: true,
    penetrated: false,
    commanderKilledByHitDoubles: true,
  });
  assert.strictEqual(closedHatchTarget.crew.commander, false);
  assert.strictEqual(closedHatchTarget.hatchOpen, false);
  assert.strictEqual(commanderHatchVisualState(closedHatchTarget), 'hidden');

  const expectedEmptyScales = {
    sherman: 0.5,
    sherman76: 0.45801526717557245,
    t34: 0.35986913849509267,
    tiger: 0.5366957470010905,
    tigerking: 0.529677519862907,
    panzer4: 0.47655398037077423,
    panzer3: 0.48372020563950774,
    type97: 0.4556784545879421,
    type95: 0.38985823336968384,
    type4: 0.4318429661941113,
  };
  for (const kind of SPLIT_TANK_KINDS) {
    assert.ok(commanderHatchRenderedScaleCoefficient(kind) > 0);
    assert.ok(Math.abs(emptyCommanderHatchScaleOf(kind, 0.5) - expectedEmptyScales[kind]) < 1e-12);
  }

  console.log('Commander hatch visual tests passed.');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
