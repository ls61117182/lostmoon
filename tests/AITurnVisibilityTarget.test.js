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
  const { RNG } = require('../assets/scripts/core/Dice.ts');
  const {
    fallbackAITurnTargetPosition,
    visibleAITurnTargetPositionFor,
  } = require('../assets/scripts/core/EnemyAI.ts');
  const {
    computeRadioSharedVisibleHexes,
    computeUnitVisibleHexes,
  } = require('../assets/scripts/core/FogOfWar.ts');
  const { HexMap } = require('../assets/scripts/core/HexGrid.ts');

  const map = new HexMap(6, 1);
  for (let q = 0; q <= 5; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });

  const stats = {
    faction: 'german',
    visionType: 'turreted',
    visionRange: 4,
    gunnerVisionRange: 1,
    interiorVisionRange: 0,
    hasRadio: true,
  };
  const receiver = {
    id: 'receiver',
    kind: 'panzer4',
    faction: 'german',
    pos: { q: 0, r: 0 },
    facing: 3,
    hatchOpen: false,
    crew: { commander: true },
    stats,
  };
  const sender = {
    id: 'sender',
    kind: 'panzer4',
    faction: 'german',
    pos: { q: 3, r: 0 },
    facing: 0,
    hatchOpen: true,
    crew: { commander: true },
    stats,
  };
  const target = {
    id: 'target',
    kind: 'sherman',
    faction: 'usa',
    pos: { q: 5, r: 0 },
    facing: 3,
    stats: { ...stats, faction: 'usa' },
  };
  const rng = new RNG(1);

  const ownVision = computeUnitVisibleHexes(map, receiver);
  assert.strictEqual(ownVision.has(HexMap.keyOf(target.pos)), false);
  assert.deepStrictEqual(
    visibleAITurnTargetPositionFor(
      receiver,
      [target],
      [],
      unit => ownVision.has(HexMap.keyOf(unit.pos)),
      rng,
    ),
    { q: -1, r: 3 },
    'an unseen enemy must not leak its position into turn targeting',
  );

  const sharedVision = computeRadioSharedVisibleHexes(map, receiver, [sender]);
  assert.strictEqual(sharedVision.has(HexMap.keyOf(target.pos)), true);
  assert.deepStrictEqual(
    visibleAITurnTargetPositionFor(
      receiver,
      [target],
      [],
      unit => sharedVision.has(HexMap.keyOf(unit.pos)),
      rng,
    ),
    target.pos,
    'a radio-shared visible enemy must be a valid turn target',
  );

  const friendlyAI = { ...receiver, id: 'friendly-ai', faction: 'usa' };
  assert.deepStrictEqual(
    fallbackAITurnTargetPosition(friendlyAI),
    { q: 6, r: 2 },
    'friendly AI must turn toward enemy offset hex {7,2}',
  );
  assert.deepStrictEqual(
    fallbackAITurnTargetPosition(receiver, 1),
    { q: -2, r: 3 },
    'fallback conversion must respect mission row parity',
  );

  console.log('AI turn visibility target tests passed.');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
