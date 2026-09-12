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
  const {
    commanderHatchVisualState,
    fixedTankCommanderHatchTransform,
    shouldNonPlayerTankOpenCommanderHatch,
  } = require('../assets/scripts/core/CommanderHatch.ts');
  const { applyAttack } = require('../assets/scripts/core/Combat.ts');
  const {
    SPLIT_TANK_KINDS,
    commanderHatchRenderedScaleCoefficient,
    emptyCommanderHatchScaleOf,
    tankVisualConfigOf,
  } = require('../assets/scripts/core/TankVisualDB.ts');
  const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');

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

  const protagonist = { kind: 'sherman', faction: 'usa', destroyed: false };
  const deadCommanderOpenTank = {
    kind: 'tiger',
    faction: 'german',
    destroyed: false,
    hatchOpen: true,
    crew: { commander: false },
    fireLevel: 0,
  };
  const nextGermanTank = {
    kind: 'panzer4',
    faction: 'german',
    destroyed: false,
    hatchOpen: false,
    crew: { commander: true },
    fireLevel: 0,
    unitLevel: 'veteran',
  };
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    true,
    'an open hatch with a dead commander must not reserve the faction commander slot',
  );

  deadCommanderOpenTank.crew.commander = true;
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    false,
    'a living open-hatch commander must still reserve the faction commander slot',
  );

  deadCommanderOpenTank.hatchOpen = false;
  nextGermanTank.unitLevel = 'recruit';
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    false,
    'a recruit NPC commander must not open the hatch without the observation skill',
  );

  nextGermanTank.fireLevel = 1;
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    false,
    'fire must not bypass the open-hatch observation skill requirement',
  );

  nextGermanTank.crewSkills = { commander: ['open_hatch_observation'] };
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    true,
    'an explicitly skilled recruit commander may use the open-hatch rule',
  );

  nextGermanTank.fireLevel = 0;
  delete nextGermanTank.crewSkills;
  nextGermanTank.unitLevel = 'elite';
  assert.strictEqual(
    shouldNonPlayerTankOpenCommanderHatch(
      nextGermanTank,
      [deadCommanderOpenTank, nextGermanTank],
      protagonist,
      'hardcore',
    ),
    true,
    'an elite NPC commander receives the observation skill by default',
  );

  const expectedEmptyScales = {
    sherman: 0.5,
    sherman76: 0.45801526717557245,
    sherman_jumbo: 0.3424946693320997,
    m26_pershing: 0.4432808610886812,
    t34: 0.3050384729774042,
    t34_85: 0.41942790034393085,
    tiger: 0.5366957470010905,
    tigerking: 0.529677519862907,
    maus: 0.5569403333852626,
    panther: 0.4598926283299579,
    panzer4: 0.3636017653129186,
    panzer3: 0.48372020563950774,
    type97: 0.4556784545879421,
    type95: 0.38985823336968384,
    type4: 0.4318429661941113,
  };
  for (const kind of SPLIT_TANK_KINDS) {
    assert.ok(commanderHatchRenderedScaleCoefficient(kind) > 0);
    assert.ok(Math.abs(emptyCommanderHatchScaleOf(kind, 0.5) - expectedEmptyScales[kind]) < 1e-12, kind);
  }

  for (const kind of ['stug3', 'su152']) {
    const unit = { ...nextGermanTank, kind, stats: getUnitStats(kind), hatchOpen: true };
    assert.strictEqual(commanderHatchVisualState(unit), 'occupied');
    assert.ok(unit.stats.commanderSpritePath);
    assert.ok(tankVisualConfigOf(kind).commanderHatchScale > 0);
    assert.strictEqual(shouldNonPlayerTankOpenCommanderHatch(unit, [unit], protagonist, 'hardcore'), true);
    assert.strictEqual(commanderHatchVisualState({ ...unit, crew: { commander: false } }), 'empty');
    assert.strictEqual(commanderHatchVisualState({ ...unit, hatchOpen: false }), 'hidden');
    assert.strictEqual(commanderHatchVisualState({ ...unit, destroyed: true }), 'hidden');
  }

  // Whole-image coordinates are scaled around the body centre, including aspect ratio.
  const config = { commanderHatchSpriteX: 70, commanderHatchSpriteY: 15, commanderHatchScale: 14 };
  const hatch = fixedTankCommanderHatchTransform(config, 100, 50, 2, 0.5, 0, false);
  assert.deepStrictEqual(hatch, { x: 40, y: 5, size: 14, angle: -90 });
  const rotated = fixedTankCommanderHatchTransform(config, 100, 50, 2, 0.5, Math.PI / 2, false);
  assert.ok(Math.abs(rotated.x + 5) < 1e-12);
  assert.ok(Math.abs(rotated.y - 40) < 1e-12);
  assert.strictEqual(rotated.size, hatch.size);
  assert.strictEqual(rotated.angle, 0);
  const empty = fixedTankCommanderHatchTransform(config, 100, 50, 2, 0.5, 0, true);
  assert.strictEqual(empty.x, hatch.x);
  assert.strictEqual(empty.y, hatch.y);
  assert.strictEqual(empty.size, 10);

  const stugVisual = tankVisualConfigOf('stug3');
  assert.deepStrictEqual(
    {
      x: stugVisual.commanderHatchSpriteX,
      y: stugVisual.commanderHatchSpriteY,
      scale: stugVisual.commanderHatchScale,
    },
    { x: 114, y: 60, scale: 24 },
    'StuG III commander overlay must be anchored to the fixed superstructure cupola',
  );
  assert.strictEqual(
    getUnitStats('stug3').commanderSpritePath,
    'textures/units/german_commander_hatch_open/spriteFrame',
  );

  const battleSceneSource = fs.readFileSync(
    require.resolve('../assets/scripts/view/BattleScene.ts'),
    'utf8',
  );
  assert.match(battleSceneSource, /TANK_VISUAL_KINDS\s*\n\s*\.map\(\(kind\) => getUnitStats\(kind\)\.commanderSpritePath/);
  assert.match(battleSceneSource, /private applyFixedTankCommanderHatchSprite[\s\S]*?fixedTankCommanderHatchTransform\(/);
  assert.match(battleSceneSource, /this\.applyTopDownTankSprite\([\s\S]*?this\.applyFixedTankCommanderHatchSprite\(/);
  const menuSource = fs.readFileSync(require.resolve('../assets/scripts/view/MainMenuScene.ts'), 'utf8');
  assert.match(menuSource, /commanderHatchScale: split\?\.commanderHatchScale \?\? top\.commanderHatchScale/);
  assert.match(menuSource, /if \(loaded\.top\)[\s\S]*?fixedTankCommanderHatchTransform\(/);

  console.log('Commander hatch visual tests passed.');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
