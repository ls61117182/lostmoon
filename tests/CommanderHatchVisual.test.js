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
    commanderHatchDisplaySize,
    commanderHatchVisualState,
    fixedTankCommanderHatchTransform,
    shouldNonPlayerTankOpenCommanderHatch,
  } = require('../assets/scripts/core/CommanderHatch.ts');
  const { applyAttack } = require('../assets/scripts/core/Combat.ts');
  const {
    SPLIT_TANK_KINDS,
    emptyCommanderHatchScaleOf,
    tankVisualConfigOf,
    splitTankVisualConfigOf,
    splitTankGeometryConfigOf,
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

  const reference = splitTankVisualConfigOf('sherman');
  const referenceGeometry = splitTankGeometryConfigOf('sherman');
  const hexSize = 80;
  const referenceTurretScale = hexSize * 1.8 * reference.hullFitScale
    / Math.max(referenceGeometry.topTrim.w, referenceGeometry.topTrim.h) * reference.turretScale;
  for (const kind of SPLIT_TANK_KINDS) {
    const visual = splitTankVisualConfigOf(kind);
    const geometry = splitTankGeometryConfigOf(kind);
    const turretScale = hexSize * 1.8 * visual.hullFitScale
      / Math.max(geometry.topTrim.w, geometry.topTrim.h) * visual.turretScale;
    const occupiedSize = visual.commanderHatchScale * turretScale;
    const previousEmptySize = 20 * emptyCommanderHatchScaleOf(kind, 0.5) * referenceTurretScale;
    assert.ok(Math.abs(commanderHatchDisplaySize(occupiedSize, true) - 1.5 * previousEmptySize) < 1e-12,
      kind + ' empty hatch must be 1.5 times its original size');
    assert.strictEqual(commanderHatchDisplaySize(occupiedSize, false), occupiedSize);
    assert.strictEqual(commanderHatchDisplaySize(occupiedSize * 2, true),
      commanderHatchDisplaySize(occupiedSize, true) * 2,
      kind + ' empty hatch must follow the commander scale');
  }

  // Editing Sherman's commander size must not cancel itself or resize other tanks.
  const baselineEmptySize = commanderHatchDisplaySize(reference.commanderHatchScale * referenceTurretScale, true);
  const savedCommanderScale = reference.commanderHatchScale;
  try {
    reference.commanderHatchScale *= 2;
    assert.strictEqual(commanderHatchDisplaySize(reference.commanderHatchScale * referenceTurretScale, true),
      baselineEmptySize * 2);
    assert.ok(Math.abs(commanderHatchDisplaySize(12, true) - 12 * 15 / 22) < 1e-12);
  } finally {
    reference.commanderHatchScale = savedCommanderScale;
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
  assert.ok(Math.abs(empty.size - 14 * 15 / 22) < 1e-12);
  const enlargedEmpty = fixedTankCommanderHatchTransform(
    { ...config, commanderHatchScale: config.commanderHatchScale * 2 }, 100, 50, 2, 0.5, 0, true,
  );
  assert.strictEqual(enlargedEmpty.size, empty.size * 2);
  assert.strictEqual(enlargedEmpty.x, empty.x);
  assert.strictEqual(enlargedEmpty.y, empty.y);

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
