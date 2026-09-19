const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const { HexMap, fireDirectionVector } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const map = new HexMap(40, 40);
for (let q = 0; q < 40; q++) for (let r = 0; r < 40; r++) map.set({ pos: { q, r }, terrain: 'field' });
const unit = (kind, q = 20, r = 20, facing = 0) => ({ id: kind, kind, pos: { q, r }, facing, turretFacing: facing,
  faction: getUnitStats(kind).faction, stats: getUnitStats(kind) });
function rng(dice) { let n = 0; return { d6() { assert.ok(n < dice.length, 'unexpected extra die'); return dice[n++]; } }; }
function ctx() { const attacker = unit('sherman', 22, 20, 3), target = unit('german_heavy_artillery');
  return { attacker, target, map, units: [attacker, target], hardcoreHeavyArtilleryRules: true, precisionFire: true, hitThresholdModifier: -2 }; }

test('slit cone follows the hull across all 12 bearings; includes exactly +/-30 degrees', () => {
  const c = ctx();
  for (let facing = 0; facing < 12; facing++) for (let bearing = 0; bearing < 12; bearing++) {
    const degrees = d => d < 6 ? d * 60 : (d - 6) * 60 + 30;
    const separation = Math.min((degrees(facing) - degrees(bearing) + 360) % 360, (degrees(bearing) - degrees(facing) + 360) % 360);
    const v = fireDirectionVector(bearing);
    c.target.facing = facing; c.target.turretFacing = (facing + 3) % 6;
    c.attacker.pos = { q: 20 + 3 * v.q, r: 20 + 3 * v.r };
    c.attacker.turretFacing = bearing;
    assert.equal(combat.isBunkerShootingPortAttack(c), separation <= 30, `${facing}/${bearing}`);
  }
  c.target.facing = 0;
  for (const [q, r, expected] of [[2, 1, true], [1, 1, true], [1, 2, false], [0, 0, false], [-2, 0, false]]) {
    c.attacker.pos = { q: 20 + q, r: 20 + r }; assert.equal(combat.isBunkerShootingPortAttack(c), expected);
  }
  c.attacker.pos = { q: 22, r: 20 };
  assert.equal(combat.isBunkerShootingPortAttack({ ...c, precisionFire: false }), false);
  assert.equal(combat.isBunkerShootingPortAttack({ ...c, hardcoreHeavyArtilleryRules: false }), false);
});

test('AP and HE slit hits destroy; misses resolve against armor; side precision is illegal', () => {
  for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
    const c = ctx(); c.target.kind = kind; c.target.stats = getUnitStats(kind);
    assert.equal(combat.hitThreshold(c), 10);
    assert.equal(combat.rollAttack(c, rng([5, 5])).damageEffect, 'destroyed');
    assert.equal(combat.rollHighExplosiveAttack(c, rng([5, 5])).outcome, 'destroyed');
    const ap = combat.rollAttack(c, rng([4, 5, 5, 5, 6]));
    assert.equal(ap.shootingPortHit, false); assert.equal(ap.hit, true); assert.equal(ap.penetrated, false);
    const he = combat.rollHighExplosiveAttack(c, rng([4, 5, 5, 5]));
    assert.equal(he.shootingPortHit, false); assert.equal(he.outcome, 'fire');
    for (const pos of [{ q: 20, r: 22 }, { q: 18, r: 20 }]) {
      c.attacker.pos = pos;
      for (const shellType of ['ap', 'he', 'hvap']) {
        assert.equal(combat.canAttack({ ...c, shellType }).reason, 'attack.reason.bunkerSlitAngle');
        assert.equal(combat.canAttack({ ...c, shellType, precisionFire: false }).ok, true);
      }
      for (const roll of [combat.rollAttack, combat.rollHighExplosiveAttack]) {
        const report = roll({ ...c, precisionFire: false }, rng([1, 1, 6]));
        assert.equal(report.automaticHit, true); assert.equal(report.shootingPortHit, undefined);
        assert.notEqual(report.damageEffect ?? report.outcome, 'destroyed');
      }
    }
  }
});

test('AP difficulty is entirely in hitting the gun; a hit destroys without penetration dice', () => {
  for (const kind of ['at_gun', 'pak38', 'flak88']) {
    const attacker = unit('sherman', 18), target = unit(kind, 20, 20, 3);
    let kills = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const report = combat.rollAttack({ attacker, target, map, shellType: 'ap', overpenetration: true, directionalDamageCheck: true, unitDamageTargetClass: true }, rng([a, b, 1, 1]));
      assert.equal(report.threshold, 10);
      assert.equal(report.penDice, undefined);
      assert.equal(report.penDie, undefined);
      assert.equal(report.penThreshold, undefined);
      assert.equal(report.overpenetrated, undefined);
      assert.equal(report.directHitDestroy, true);
      if (report.hit) { assert.equal(report.penetrated, true); assert.equal(report.damageEffect, 'destroyed'); kills++; }
      else { assert.equal(report.penetrated, false); assert.equal(report.damageEffect, undefined); }
    }
    assert.equal(kills, 6);
    const hvap = combat.rollAttack({ attacker, target, map, shellType: 'hvap' }, rng([6, 6]));
    assert.equal(hvap.directHitDestroy, true); assert.equal(hvap.damageEffect, 'destroyed'); assert.equal(hvap.penDice, undefined);
    const classic = combat.rollAttack({ attacker, target, map }, rng([6, 6, 1, 1, 1]));
    assert.deepEqual(classic.penDice, [1, 1], 'classic mode keeps its original undifferentiated-shell flow');
  }
});

test('HE0 is still lethal; attached crews use base 8 while ordinary infantry retains base 6', () => {
  for (let power = 0; power <= 6; power++) {
    const attacker = unit('sherman'); attacker.stats = { ...attacker.stats, highExplosivePower: power };
    const target = unit('german_infantry', 22); target.attachedToATGunId = 'gun';
    let kills = 0, suppressed = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const report = combat.rollHighExplosiveAttack({ attacker, target, map }, rng([a, b]));
      assert.equal(report.suppressThreshold, 8 - power); assert.equal(report.destroyThreshold, 12 - power);
      kills += report.outcome === 'destroyed'; suppressed += report.outcome === 'suppressed';
    }
    if (power === 0) assert.equal(kills, 1);
    if (power === 2) { assert.equal(kills, 6); assert.equal(suppressed, 20); }
    delete target.attachedToATGunId;
    assert.equal(combat.rollHighExplosiveAttack({ attacker, target, map }, rng([1, 1])).suppressThreshold, 6 - power);
  }
});

// Execute the scene's real independent rolls and state transitions without loading Cocos.
const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'BattleScene');
test('ordinary bunker AP preview displays penetration odds and consumes no hit dice', () => {
  const method = sceneClass.members.find(m => m.name?.getText(source) === 'drawAttackableHighlights').getText(source);
  const code = ts.transpileModule(`class PreviewScene { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const rules = { expandedTurretDirections: true, effectiveRangePenetration: true, directionalDamageCheck: true, gunMantletArmor: true };
  const PreviewScene = vm.runInNewContext(code + '\nPreviewScene', {
    ...types, ...combat, HexMap, GameSession: { gameMode: 'hardcore' },
    resolvedLoadedShell: u => u.loadedShell, getGameModeConfig: () => rules,
    ambushHitThresholdModifier: () => 0, isMainGunSuppressionAttack: () => false,
  });
  for (const kind of ['heavy_artillery', 'german_heavy_artillery']) for (const shellType of ['ap', 'hvap']) for (const distance of [2, 8]) {
    const attacker = unit('sherman', 20 + distance, 20, 3), target = unit(kind);
    attacker.loadedShell = shellType;
    const c = { attacker, target, map, shellType, hardcoreHeavyArtilleryRules: true, unitDamageTargetClass: true, ...rules };
    const expected = combat.previewAttack(c).pen;
    let penetrations = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const report = combat.rollAttack(c, rng([a, b, 6]));
      assert.equal(report.automaticHit, true);
      assert.deepEqual(report.dice, [0, 0]);
      assert.deepEqual(report.penDice, [a, b]);
      assert.equal(report.penThreshold, expected.threshold);
      penetrations += report.penetrated;
    }
    assert.equal(expected.probability, penetrations / 36);
    const labels = [];
    const scene = new PreviewScene();
    Object.assign(scene, {
      g: {}, hexSize: 100, selectedGunHitThresholdModifier: 0,
      mission: { sherman: attacker, map, data: {} },
      playerMainGunHexTargets: () => [target], isUnitVisible: () => true,
      allUnits: () => [attacker, target], currentWeather: () => undefined,
      campaignMainGunHitThresholdModifier: () => 0, playerMainGunHitThresholdModifierDetails: () => [],
      canTurretReachDirection: () => true, turretTargetDirection: () => 3,
      project: () => ({ x: 0, y: 0 }), canDirectlyAttackUrbanBuilding: () => false,
      spawnPreviewLabel: (_x, _y, need, probability) => labels.push({ need, probability }),
    });
    scene.drawAttackableHighlights();
    assert.deepEqual(labels, [{ need: expected.threshold, probability: expected.probability }]);
  }
});
test('direct AT-gun destruction skips the penetration row and ends after the hit reveal', () => {
  const sceneText = source.getFullText();
  assert.match(sceneText, /directHitDestroy = report\.shootingPortHit === true \|\| report\.directHitDestroy === true/);
  assert.match(sceneText, /if \(!mg && !directHitDestroy && \(!highExplosiveReport \|\| heHasEffectRow\)\)/);
  assert.match(sceneText, /show\.report\.directHitDestroy \|\| show\.report\.shootingPortHit === true[\s\S]*?enterDiceShowHold\(show\)/);
});
const names = ['rollHighExplosiveCollateralResults', 'applyHighExplosiveAttackResult', 'atGunController', 'killATGunCrew', 'releaseATGunCrew'];
const methods = names.map(name => sceneClass.members.find(m => m.name?.getText(source) === name).getText(source));
const js = ts.transpileModule(`class Scene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const Scene = vm.runInNewContext(js + '\nScene', { ...types, ...combat });
test('precision target selection excludes side bunkers; clicking them consumes no dice or ammunition', () => {
  const methods = ['playerWeaponTargetHexKeys', 'canPlayerMainGunAttack', 'canDirectlyAttackUrbanBuilding', 'tryAttack'].map(name => sceneClass.members.find(m => m.name?.getText(source) === name).getText(source));
  const code = ts.transpileModule(`class PreviewScene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const PreviewScene = vm.runInNewContext(code + '\nPreviewScene', {
    ...types, ...combat, HexMap, GameSession: { gameMode: 'hardcore' },
    getGameModeConfig: () => ({ expandedTurretDirections: true }),
    ambushHitThresholdModifier: () => 0, isMainGunSuppressionAttack: () => false,
    t: key => key, Color: class {},
  });
  for (const kind of ['heavy_artillery', 'german_heavy_artillery']) for (const shell of ['ap', 'he', 'hvap']) {
    const c = ctx(); c.target.kind = kind; c.target.stats = getUnitStats(kind);
    c.attacker.loadedShell = shell;
    const scene = new PreviewScene();
    Object.assign(scene, {
      mission: { sherman: c.attacker, enemies: [c.target], map, data: { theater: 'europe' } },
      selectedMGDieIdx: -1, selectedGunDieIdx: 0, selectedGunDoublesIdx: 1,
      selectedGunHitThresholdModifier: -2, playerStep: 'attack', phaseDice: [{ used: false }, { used: false }],
      playerMainGunHexTargets: () => [c.target], isUnitVisible: () => true,
      canTurretReachDirection: () => true, turretTargetDirection: () => 0,
      currentWeather: () => undefined, campaignMainGunHitThresholdModifier: () => -2,
      playerMainGunHitThresholdModifierDetails: () => [], battleLogI18n: () => {}, spawnFloater: () => {},
      hideTurretTargetOverlayForCommittedAction: () => assert.fail('invalid target committed an attack'),
    });
    assert.equal(scene.playerWeaponTargetHexKeys().size, 1, 'front bunker remains selectable');
    c.attacker.pos = { q: 20, r: 22 };
    assert.equal(scene.playerWeaponTargetHexKeys().size, 0, 'side bunker cannot be selected');
    scene.tryAttack(c.target);
    assert.deepEqual(scene.phaseDice, [{ used: false }, { used: false }]);
    assert.equal(c.attacker.loadedShell, shell);
    scene.selectedGunHitThresholdModifier = 0;
    assert.equal(scene.playerWeaponTargetHexKeys().size, 1, 'ordinary fire remains selectable');
  }
});
test('HE precision rejects automatic-hit targets and preserves bunker slit targeting', () => {
  for (const kind of ['german_infantry', 'at_gun', 'pak38', 'flak88', 'heavy_artillery', 'german_heavy_artillery']) {
    const c = ctx(); c.target = unit(kind); c.shellType = 'he'; c.mainGunSuppressesInfantry = true;
    assert.equal(combat.canAttack(c).ok, types.isHeavyArtilleryUnit(c.target), kind);
    assert.equal(combat.canAttack({ ...c, precisionFire: false }).ok, true);
  }
  const methods = ['canDirectlyAttackUrbanBuilding', 'urbanBuildingTarget', 'tryAttackUrbanBuilding']
    .map(name => sceneClass.members.find(m => m.name?.getText(source) === name).getText(source));
  const code = ts.transpileModule(`class BuildingScene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const BuildingScene = vm.runInNewContext(code + '\nBuildingScene', {
    ...types, ...combat, GameSession: { gameMode: 'hardcore' },
    getGameModeConfig: () => ({ expandedTurretDirections: true }),
  });
  const c = ctx(); c.attacker.loadedShell = 'he';
  const scene = new BuildingScene();
  const tile = { pos: { ...c.target.pos }, urbanKind: 'destructible', terrain: 'urban_destructible' };
  Object.assign(scene, {
    mission: { sherman: c.attacker, map, data: {} }, selectedGunHitThresholdModifier: -2,
    selectedGunDieIdx: 0, selectedGunDoublesIdx: 1, phaseDice: [{ used: false }, { used: false }],
    isHexVisible: () => true, currentWeather: () => undefined,
    canTurretReachDirection: () => true, turretTargetDirection: () => 3,
    hideTurretTargetOverlayForCommittedAction: () => assert.fail('precision building attack committed'),
  });
  assert.equal(scene.canDirectlyAttackUrbanBuilding(tile), false);
  scene.tryAttackUrbanBuilding(tile);
  assert.deepEqual(scene.phaseDice, [{ used: false }, { used: false }]);
  assert.equal(c.attacker.loadedShell, 'he');
  scene.selectedGunHitThresholdModifier = 0;
  assert.equal(scene.canDirectlyAttackUrbanBuilding(tile), true);
});

test('all 1296 independent HE body/crew outcomes apply to real scene state correctly', () => {
  let stopped = 0, eliminated = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) {
    const attacker = unit('sherman', 18), gun = unit('pak38'), crew = unit('german_infantry');
    Object.assign(gun, { atGunCrewAlive: true, atGunControllerUnitId: crew.id }); crew.attachedToATGunId = gun.id;
    const units = [attacker, gun, crew]; const scene = new Scene();
    Object.assign(scene, { mission: { map, data: { theater: 'europe' }, enemies: [gun, crew], allies: [] }, rng: rng([a, b, c, d]),
      allUnits: () => units, atGunCrewFormationOffsets: () => [], spawnInfantryBloodDecalsAt: () => {}, inheritReleasedATGunCrewFacing: () => {} });
    const body = combat.rollHighExplosiveAttack({ attacker, target: gun, map }, scene.rng);
    const collateral = scene.rollHighExplosiveCollateralResults(attacker, gun);
    assert.equal(collateral.length, 1); assert.equal(collateral[0].target, crew);
    scene.applyHighExplosiveAttackResult(gun, body, collateral);
    const bodyKilled = a + b >= 10, crewKilled = c + d >= 10, crewSuppressed = c + d >= 6 && !crewKilled;
    assert.equal(!!gun.destroyed, bodyKilled); assert.equal(!!crew.destroyed, crewKilled);
    assert.equal(!!crew.suppressed, crewSuppressed);
    if (bodyKilled || crewKilled) { assert.equal(gun.faction, 'neutral'); assert.equal(gun.atGunCrewAlive, false); assert.equal(crew.attachedToATGunId, undefined); }
    else { assert.equal(crew.attachedToATGunId, gun.id); assert.equal(!!gun.suppressed, crewSuppressed); }
    eliminated += bodyKilled || crewKilled; stopped += bodyKilled || crewKilled || crewSuppressed;
  }
  assert.equal(eliminated, 396); assert.equal(stopped, 996);
});
