const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { canMountTank, canDismountTank, mountTank, dismountTank, syncTankRiders, tankRiders } = require('../assets/scripts/core/TankRiding.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { createTankCrew } = require('../assets/scripts/core/types.ts');
const { isAIActorUnit, canExecuteAction, currentTargetFor } = require('../assets/scripts/core/EnemyAI.ts');
const { canAttack, canMGAttack, mgHitThreshold, rollMGAttack, rollSelectedTankMachineGunAttacks } = require('../assets/scripts/core/Combat.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');

function unit(id, kind, sideId = 'player') {
  const stats = getUnitStats(kind);
  return { id, kind, stats, faction: stats.faction, sideId, controller: 'ai', pos: { q: 1, r: 2 }, facing: 0,
    ...(kind === 'sherman' ? { crew: createTankCrew(stats) } : {}) };
}
function setup() {
  const tank = unit('tank', 'sherman');
  const infantry = unit('riders', 'american_infantry');
  return { tank, infantry, units: [tank, infantry] };
}

test('only an available same-side American squad in the same hex may board, one squad per tank', () => {
  const { tank, infantry, units } = setup();
  syncTankRiders(units);
  assert.equal(infantry.mountedOnUnitId, undefined, 'sharing a hex alone never boards');
  assert.equal(mountTank(infantry, tank, units), true);
  assert.equal(canMountTank(infantry, tank, units), false);
  const other = unit('other', 'american_infantry');
  assert.equal(canMountTank(other, tank, [...units, other]), false);
  assert.deepEqual(tankRiders(tank, units), [infantry]);
  assert.equal(dismountTank(infantry, units), true);
  assert.equal(canMountTank(other, tank, [...units, other]), true);
  for (const change of [u => u.kind = 'german_infantry', u => u.destroyed = true,
    u => u.suppressed = true, u => u.attachedToATGunId = 'gun', u => u.sideId = 'enemy',
    u => u.pos = { q: 2, r: 2 }]) {
    const f = setup(); change(f.infantry); assert.equal(canMountTank(f.infantry, f.tank, f.units), false);
  }
  for (const change of [u => u.destroyed = true, u => u.fireLevel = 1,
    u => u.crew = { commander: false, gunner: false, loader: false, driver: false, coDriver: false }]) {
    const f = setup(); change(f.tank); assert.equal(canMountTank(f.infantry, f.tank, f.units), false);
  }
});

test('riders follow movement, cannot act, remain targetable, and resume after dismount', () => {
  const { tank, infantry, units } = setup();
  mountTank(infantry, tank, units);
  tank.pos = { q: 4, r: 5 };
  syncTankRiders(units);
  assert.deepEqual(infantry.pos, tank.pos);
  assert.notEqual(infantry.pos, tank.pos, 'positions must not alias');
  assert.equal(isAIActorUnit(infantry, true), false);
  for (const action of ['infantry_move', 'shoot', 'conceal']) assert.equal(canExecuteAction(infantry, action), false);
  const enemy = unit('enemy', 'german_infantry', 'enemy');
  assert.equal(currentTargetFor(enemy, [infantry], [], new RNG(1)), infantry, 'riders remain exposed');
  for (const check of [canAttack, canMGAttack]) {
    assert.deepEqual(check({ attacker: infantry, target: enemy, map: new HexMap(8, 8) }), { ok: false, reason: 'attack.reason.mounted' });
  }
  assert.equal(dismountTank(infantry, units), true);
  assert.deepEqual(infantry.pos, tank.pos);
  assert.equal(isAIActorUnit(infantry, true), true);
  assert.equal(dismountTank(infantry, units), false);
});

test('other live infantry in the carrier hex block voluntary dismount, without mutating riding state', () => {
  for (const kind of ['american_infantry', 'german_infantry', 'japanese_infantry', 'officer']) {
    const { tank, infantry, units } = setup();
    mountTank(infantry, tank, units, () => 0);
    const other = unit('ground', kind, 'enemy'); units.push(other);
    assert.equal(canDismountTank(infantry, units), false, kind);
    assert.equal(dismountTank(infantry, units), false, kind);
    assert.equal(infantry.mountedOnUnitId, tank.id); assert.equal(infantry.mountedDoubleSide, 'left');
    other.destroyed = true;
    assert.equal(canDismountTank(infantry, units), true, 'destroyed infantry do not occupy the landing slot');
    other.destroyed = false; other.pos = { q: 2, r: 2 };
    assert.equal(dismountTank(infantry, units), true, 'infantry leaving the hex unlock dismount');
  }
  const { tank, infantry, units } = setup(); mountTank(infantry, tank, units);
  const otherTank = unit('otherTank', 'sherman'); units.push(otherTank);
  assert.equal(canDismountTank(infantry, units), true, 'another vehicle alone does not block');
  tank.pos = { q: 3, r: 3 };
  const ground = unit('ground', 'american_infantry'); ground.pos = { ...tank.pos }; units.push(ground);
  assert.equal(canDismountTank(infantry, units), false, 'check the current carrier hex, even before rider positions sync');
  tank.fireLevel = 1; syncTankRiders(units);
  assert.equal(infantry.mountedOnUnitId, undefined, 'forced evacuation from a burning carrier still works');
});

test('mounted MG targets receive no coordination bonus while same-hex ground infantry retain theirs', () => {
  const { tank, infantry, units } = setup();
  const attacker = unit('shooter', 'panzer4', 'enemy'); attacker.pos = { q: 0, r: 2 }; attacker.facing = 0;
  const ground = unit('ground', 'american_infantry'); units.push(ground, attacker);
  tank.stats = { ...tank.stats, infantryTankCoordination: 2 };
  const map = new HexMap(5, 5);
  map.set({ pos: { ...attacker.pos }, terrain: 'field' }); map.set({ pos: { ...tank.pos }, terrain: 'field' });
  mountTank(infantry, tank, units);
  for (const hardcoreTankMachineGuns of [false, true]) {
    const ctx = { attacker, target: infantry, map, units, hardcoreTankMachineGuns, tankMachineGun: 'both' };
    const unprotectedNeed = mgHitThreshold({ ...ctx, units: [attacker, infantry] });
    const groundCtx = { ...ctx, target: ground };
    assert.equal(mgHitThreshold(ctx), unprotectedNeed);
    assert.equal(mgHitThreshold(groundCtx), unprotectedNeed + 2);
    const report = rollMGAttack(ctx, { d6: () => unprotectedNeed });
    assert.equal(report.hit, true);
    assert.equal(report.hitModifiers.some(d => d.labelKey === 'dice.rule.infantryTankCoordination'), false);
    const groundReport = rollMGAttack(groundCtx, { d6: () => unprotectedNeed });
    assert.equal(groundReport.hit, false);
    assert.equal(groundReport.hitModifiers.find(d => d.labelKey === 'dice.rule.infantryTankCoordination').value, 2);
    const dual = rollSelectedTankMachineGunAttacks(ctx, { d6: () => unprotectedNeed });
    assert(dual.every(shot => shot.report.hit && shot.report.threshold === unprotectedNeed), 'both MGs use the unprotected rider threshold');
  }
  ground.pos = { q: 2, r: 2 }; assert(dismountTank(infantry, units));
  const dismountedCtx = { attacker, target: infantry, map, units };
  assert.equal(mgHitThreshold(dismountedCtx), mgHitThreshold({ ...dismountedCtx, units: [] }) + 2,
    'dismounted infantry regain the ordinary ground coordination bonus');
});

test('AI machine guns prefer legal hostile riders over same-hex ground infantry, retaining vision and range gates', () => {
  const rules = Object.assign({}, ...['HexGrid', 'FogOfWar', 'Combat', 'types', 'GameMode', 'EnemyAI', 'Suppression']
    .map(name => require(`../assets/scripts/core/${name}.ts`)));
  const GameSession = { gameMode: 'hardcore' };
  const Scene = require('./helpers/BattleSceneMethods.cjs')(['selectAIMGTarget', 'tankMachineGunContext'], { ...rules, GameSession });
  for (const mode of ['classic', 'hardcore', 'test']) {
    GameSession.gameMode = mode;
    const { tank, infantry, units } = setup();
    const ground = unit('ground', 'american_infantry');
    const attacker = unit('shooter', 'panzer4', 'enemy');
    Object.assign(attacker, { pos: { q: 0, r: 2 }, facing: 0, turretFacing: 0, hatchOpen: true,
      visionRange: 4, gunnerVisionRange: 4, interiorVisionRange: 1, unitLevel: 'elite' });
    units.push(ground, attacker); mountTank(infantry, tank, units);
    const map = new HexMap(5, 5);
    for (let q = 0; q < 5; q++) for (let r = 0; r < 5; r++) map.set({ pos: { q, r }, terrain: 'field' });
    const scene = new Scene(); let targets = [ground, infantry];
    Object.assign(scene, { mission: { map, data: { theater: 'europe' }, smokeHexes: new Set() },
      allUnits: () => units, aiTargetsFor: () => targets, aiFriendliesFor: () => [attacker],
      aiMissionTargetsFor: () => [ground], currentWeather: () => 'clear',
      tankMachineGunSelection: () => ({ weapon: 'both', rotateTurret: false }),
      rng: { intRange: () => { throw new Error('unique rider priority must not randomize with ground infantry'); } } });
    for (const order of [[ground, infantry], [infantry, ground]]) {
      targets = order;
      assert.equal(scene.selectAIMGTarget(attacker, false), infantry, mode);
      assert.equal(scene.selectAIMGTarget(attacker, true), infantry, mode);
    }
    infantry.pos = { q: 3, r: 2 };
    assert.equal(scene.selectAIMGTarget(attacker, false), ground, 'out-of-range riders cannot steal the target');
    infantry.pos = { ...tank.pos }; infantry.destroyed = true;
    assert.equal(scene.selectAIMGTarget(attacker, false), ground, 'destroyed riders cannot steal the target');
    infantry.destroyed = false; infantry.sideId = 'enemy';
    assert.equal(scene.selectAIMGTarget(attacker, false), ground, 'friendly riders cannot steal the target');
    infantry.sideId = 'player';
    if (mode !== 'classic') {
      scene.currentWeather = () => 'fog';
      scene.mission.smokeHexes.add(HexMap.keyOf(infantry.pos));
      assert.equal(scene.selectAIMGTarget(attacker, false), null, 'riding priority never bypasses smoke/vision');
    }
  }
});

test('boarding chooses either double side once, redraw/sync preserve it, and legacy links migrate deterministically', () => {
  for (const [sample, side] of [[0, 'left'], [0.4999, 'left'], [0.5, 'right'], [0.9999, 'right']]) {
    const { tank, infantry, units } = setup(); let calls = 0;
    assert(mountTank(infantry, tank, units, () => { calls++; return sample; }));
    for (let i = 0; i < 3; i++) syncTankRiders(units);
    assert.equal(infantry.mountedDoubleSide, side); assert.equal(calls, 1);
    assert.equal(mountTank(infantry, tank, units, () => { calls++; return 0; }), false);
    assert.equal(calls, 1, 'rejected board commands must not reroll');
    dismountTank(infantry, units); assert.equal(infantry.mountedDoubleSide, undefined);
    mountTank(infantry, tank, units, () => side === 'left' ? 0.9 : 0.1);
    assert.equal(infantry.mountedDoubleSide, side === 'left' ? 'right' : 'left');
    delete infantry.mountedDoubleSide; syncTankRiders(units); const migrated = infantry.mountedDoubleSide;
    delete infantry.mountedDoubleSide; syncTankRiders(units); assert.equal(infantry.mountedDoubleSide, migrated);
    tank.fireLevel = 1; syncTankRiders(units); assert.equal(infantry.mountedDoubleSide, undefined);
  }
});

test('both layouts put two riders along one hull side and one opposite, with outward legs and no rear seat', () => {
  const { tankRiderSeats } = require('../assets/scripts/view/TankRiderVisual.ts');
  for (const side of ['left', 'right']) {
    const seats = tankRiderSeats(side); const sign = side === 'right' ? 1 : -1;
    assert.equal(seats.filter(s => Math.sign(s.y) === sign).length, 2);
    assert.equal(seats.filter(s => Math.sign(s.y) === -sign).length, 1);
    const spacing = Math.abs(seats[0].x - seats[1].x);
    assert(spacing >= 0.10 && spacing <= 0.18, 'double seats sit close together without stacking heads');
    assert(seats.every(s => s.x >= 0.24 && s.x <= 0.40), 'riders stay on the rear deck, clear of the turret and tail edge');
    for (const seat of seats) { assert.equal(Math.abs(seat.y), 0.46); assert.equal(seat.angle, seat.y > 0 ? 180 : 0); }
  }
  assert.deepEqual(tankRiderSeats('left').map(s => s.x), tankRiderSeats('right').map(s => s.x));
});

test('fire, destruction, capture, missing carrier and stale/duplicate links safely release riders', () => {
  for (const damage of [tank => tank.fireLevel = 1, tank => tank.destroyed = true,
    tank => tank.sideId = 'enemy', tank => tank.crew = {}, tank => tank.kind = 'truck']) {
    const { tank, infantry, units } = setup();
    mountTank(infantry, tank, units); tank.pos = { q: 3, r: 4 }; damage(tank); syncTankRiders(units);
    assert.equal(infantry.mountedOnUnitId, undefined);
    assert.deepEqual(infantry.pos, tank.pos);
  }
  const { tank, infantry, units } = setup();
  infantry.mountedOnUnitId = 'missing'; syncTankRiders(units);
  assert.equal(infantry.mountedOnUnitId, undefined);
  mountTank(infantry, tank, units);
  const duplicate = unit('duplicate', 'american_infantry'); duplicate.mountedOnUnitId = tank.id;
  syncTankRiders([...units, duplicate]);
  assert.equal(duplicate.mountedOnUnitId, undefined);
  infantry.destroyed = true; syncTankRiders(units);
  assert.equal(infantry.mountedOnUnitId, undefined);
});

test('save/load preserves riding, follows the carrier and clears legacy or invalid saved state', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json', 'utf8'));
  const makeMission = () => {
    const mission = loadMission(data, new RNG(1), { hardcore: true });
    const infantry = unit('saved_riders', 'american_infantry'); infantry.pos = { ...mission.sherman.pos };
    mission.allies.push(infantry);
    return { mission, infantry };
  };
  const { mission, infantry } = makeMission();
  assert(mountTank(infantry, mission.sherman, [mission.sherman, ...mission.allies, ...mission.enemies], () => 0));
  const saved = JSON.parse(JSON.stringify(captureSave({ mission, missionId: data.id, gameMode: 'hardcore', turn: 2,
    phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', phaseDice: [] })));
  const restored = makeMission();
  const result = applySave(restored.mission, data.id, saved);
  assert.equal(result.ok, true, result.reason);
  assert.equal(restored.infantry.mountedOnUnitId, restored.mission.sherman.id);
  assert.equal(restored.infantry.mountedDoubleSide, 'left');
  assert.equal(isAIActorUnit(restored.infantry, true), false);
  delete saved.allies.find(u => u.id === infantry.id).mountedDoubleSide;
  assert.equal(applySave(restored.mission, data.id, saved).ok, true);
  assert(['left', 'right'].includes(restored.infantry.mountedDoubleSide));
  delete saved.allies.find(u => u.id === infantry.id).mountedOnUnitId;
  assert.equal(applySave(restored.mission, data.id, saved).ok, true);
  assert.equal(restored.infantry.mountedOnUnitId, undefined, 'old saves clear live riding state');
  assert.equal(restored.infantry.mountedDoubleSide, undefined);
  saved.allies.find(u => u.id === infantry.id).mountedOnUnitId = 'missing';
  assert.equal(applySave(restored.mission, data.id, saved).ok, true);
  assert.equal(restored.infantry.mountedOnUnitId, undefined);
});

test('seat sprites are actual hull children and survive hull movement, turret turns, slot reuse and cleanup', () => {
  class UITransform {
    contentSize = { width: 0, height: 0 };
    setContentSize(width, height) { this.contentSize = { width, height }; }
    setAnchorPoint(x, y) { this.anchor = { x, y }; }
  }
  class Node {
    children = []; components = new Map(); active = true; isValid = true; angle = 0; position = { x: 0, y: 0 };
    constructor(name) { this.name = name; }
    addComponent(type) { const c = new type(); c.node = this; this.components.set(type, c); return c; }
    getComponent(type) { return this.components.get(type); }
    addChild(child) { if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child); child.parent = this; this.children.push(child); }
    setPosition(x, y) { this.position = { x, y }; }
    destroy() { this.isValid = false; }
    worldPoint(x = 0, y = 0) { const a = this.angle * Math.PI / 180; const p = { x: this.position.x + x*Math.cos(a)-y*Math.sin(a), y: this.position.y+x*Math.sin(a)+y*Math.cos(a) }; return this.parent ? this.parent.worldPoint(p.x,p.y) : p; }
  }
  class Sprite { static SizeMode = { CUSTOM: 0 }; color = { a: 255 }; }
  class Graphics { clear() {} ellipse() {} fill() {} circle() {} }
  class Color { constructor(r,g,b,a) { Object.assign(this,{r,g,b,a}); } }
  const cc = { Node, UITransform, Sprite, Graphics, Color, SpriteFrame: class {},
    resources: { load(_path, _type, callback) { callback(null, { rect: { width: 1158, height: 1359 } }); } } };
  const source = fs.readFileSync('assets/scripts/view/TankRiderRenderer.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === 'cc' ? cc : require('../assets/scripts/view/' + name + '.ts'), module, module.exports);
  const renderer = new module.exports.TankRiderRenderer(); renderer.load(() => {});
  const hull = new Node('Hull'); hull.addComponent(UITransform).setContentSize(126, 55);
  const sprite = hull.addComponent(Sprite);
  const { tank, infantry, units } = setup(); mountTank(infantry, tank, units);
  renderer.draw(tank, sprite, units);
  const group = hull.children[0]; assert.equal(group.children.length, 3); assert.equal(group.parent, hull);
  const { tankRiderSeats, TANK_RIDER_COLORS } = require('../assets/scripts/view/TankRiderVisual.ts');
  for (const side of ['left', 'right']) {
    infantry.mountedDoubleSide = side; sprite.color.a = 128; renderer.draw(tank, sprite, units);
    const seats = tankRiderSeats(side);
    group.children.forEach((n, i) => {
      assert.equal(n.position.x, seats[i].x * 126);
      const inwardDistance = Math.abs(seats[i].y * 55) - Math.abs(n.position.y);
      const imageHeight = n.getComponent(UITransform).contentSize.height;
      assert(Math.abs(inwardDistance / imageHeight - 0.05) < 1e-9, 'both sides move inward by 5% of the displayed image length');
      assert.equal(Math.sign(n.position.y), Math.sign(seats[i].y));
      assert.equal(n.angle, seats[i].angle);
      assert.deepEqual({ ...n.getComponent(Sprite).color }, { ...TANK_RIDER_COLORS[i], a: 128 });
    });
  }
  const first = group.children[0]; const before = first.worldPoint();
  hull.setPosition(50, 60); hull.angle = 90;
  const after = first.worldPoint();
  assert(Math.abs(after.x - (50-before.y)) < 1e-8); assert(Math.abs(after.y-(60+before.x)) < 1e-8);
  const turret = new Node('Turret'); turret.angle = 135;
  assert.deepEqual(first.worldPoint(), after, 'turret transforms cannot move riders');
  const replacementHull = new Node('ReusedHull'); replacementHull.addComponent(UITransform).setContentSize(100, 45);
  renderer.begin(); assert.equal(group.active, false);
  renderer.draw(tank, replacementHull.addComponent(Sprite), units);
  assert.equal(group.parent, replacementHull); assert.equal(group.active, true);
  dismountTank(infantry, units); renderer.begin(); renderer.draw(tank, sprite, units);
  assert.equal(group.active, false);
  renderer.clear(); assert.equal(group.isValid, false);
});

test('tile-detail commands board and dismount, save the result and reject out-of-turn changes', () => {
  const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
  const scene = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'BattleScene');
  const methods = ['canManageTankRiders', 'changeTankRiding', 'drawUnit'].map(name =>
    scene.members.find(member => member.name?.getText(ast) === name).getText(ast).replace(/^private\s+/, ''));
  const compiled = ts.transpileModule(`class RidingProbe { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const { isSameSide } = require('../assets/scripts/core/types.ts');
  const Probe = new Function('isSameSide', 'canMountTank', 'mountTank', 'dismountTank', 'syncTankRiders',
    'unitDisplayName', 'isAttachedATGunCrew', `${compiled}; return RidingProbe;`)(
    isSameSide, canMountTank, mountTank, dismountTank, syncTankRiders, value => value, () => false);
  const { tank, infantry, units } = setup();
  const p = new Probe();
  let saves = 0, draws = 0; const events = [];
  Object.assign(p, { mission: { sherman: tank, map: { canUnitEnter: () => true } }, phase: 'player', outcome: 'ongoing',
    allUnits: () => units, closeTileInspectModal() {}, isBusy: () => false, battleLogI18n() {},
    sendPvpActionResult: name => events.push(name), redraw: () => draws++, writeCurrentSave: () => saves++ });
  p.changeTankRiding(infantry, tank);
  assert.equal(infantry.mountedOnUnitId, tank.id); assert.equal(saves, 1); assert.equal(draws, 1);
  assert.deepEqual(events, ['tank_mount']);
  assert.doesNotThrow(() => p.drawUnit(infantry), 'mounted infantry must exit before the ground draw path');
  const ground = unit('ground', 'american_infantry'); units.push(ground);
  p.changeTankRiding(infantry);
  assert.equal(infantry.mountedOnUnitId, tank.id, 'scene commands cannot bypass an occupied landing hex');
  assert.equal(saves, 1); assert.equal(draws, 1); assert.deepEqual(events, ['tank_mount']);
  ground.pos = { q: 2, r: 2 };
  p.phase = 'enemy'; p.changeTankRiding(infantry);
  assert.equal(infantry.mountedOnUnitId, tank.id); assert.equal(saves, 1);
  p.phase = 'player'; p.changeTankRiding(infantry);
  assert.equal(infantry.mountedOnUnitId, undefined); assert.equal(saves, 2);
  assert.deepEqual(events, ['tank_mount', 'tank_dismount']);
});

test('PVP server retains and clears the optional American riding link', () => {
  const source = fs.readFileSync('server/server.js', 'utf8');
  const ast = ts.createSourceFile('server.js', source, ts.ScriptTarget.Latest, true);
  const sanitizer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'sanitizePvpBattleUnit');
  const sanitize = new Function(`${sanitizer.getText(ast)}; return sanitizePvpBattleUnit;`)();
  const fallback = { id: 'pvp_support', kind: 'american_infantry', pos: { q: 0, r: 0 } };
  assert.equal(sanitize({ mountedOnUnitId: 'pvp_tank' }, fallback).mountedOnUnitId, 'pvp_tank');
  assert.equal(sanitize({}, { ...fallback, mountedOnUnitId: 'pvp_tank' }).mountedOnUnitId, undefined);
  assert.equal(sanitize({ mountedOnUnitId: 42 }, fallback).mountedOnUnitId, undefined);
  assert.equal(sanitize({ mountedOnUnitId: 'pvp_tank' }, { ...fallback, kind: 'japanese_infantry' }).mountedOnUnitId, undefined);
  for (const side of ['left', 'right']) assert.equal(sanitize({ mountedOnUnitId: 'pvp_tank', mountedDoubleSide: side }, fallback).mountedDoubleSide, side);
  assert.equal(sanitize({ mountedOnUnitId: 'pvp_tank', mountedDoubleSide: 'invalid' }, fallback).mountedDoubleSide, undefined);
  assert.equal(sanitize({ mountedDoubleSide: 'left' }, fallback).mountedDoubleSide, undefined);
  assert.equal(sanitize({}, { ...fallback, mountedOnUnitId: 'tank', mountedDoubleSide: 'left' }).mountedDoubleSide, undefined);
});

test('rendered seated RGB averages match each original standing sprite after small-size sampling', async () => {
  const sharp = require('sharp');
  const { TANK_RIDER_COLORS } = require('../assets/scripts/view/TankRiderVisual.ts');
  async function average(path, tint = { r: 255, g: 255, b: 255 }) {
    const data = await sharp(path).ensureAlpha().resize(24, 24, { fit: 'inside' }).raw().toBuffer();
    const sum = [0, 0, 0]; let alpha = 0; const gains = [tint.r, tint.g, tint.b];
    for (let p = 0; p < data.length; p += 4) {
      const weight = data[p + 3] / 255; alpha += weight;
      for (let c = 0; c < 3; c++) sum[c] += data[p + c] * gains[c] / 255 * weight;
    }
    return sum.map(v => v / alpha);
  }
  for (let i = 0; i < 3; i++) {
    const base = `assets/resources/textures/units/AmericanInfantry0${i + 1}`;
    const original = await average(base + '.png');
    const seated = await average(base + '_seated_olive.png', TANK_RIDER_COLORS[i]);
    for (let c = 0; c < 3; c++) assert(Math.abs(original[c] - seated[c]) < 2,
      `soldier ${i + 1}, channel ${c}: standing ${original[c]}, seated ${seated[c]}`);
  }
});

test('all seated assets retain consistent full-canvas hip anchors and independent UUIDs', () => {
  const uuids = new Set();
  const { AMERICAN_SEATED_SPRITE_PATHS } = require('../assets/scripts/view/TankRiderVisual.ts');
  for (const spritePath of AMERICAN_SEATED_SPRITE_PATHS) {
    const file = `assets/resources/${spritePath.replace('/spriteFrame', '.png')}`;
    const png = fs.readFileSync(file); const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
    const frame = meta.subMetas.f9941.userData;
    assert.equal(frame.trimType, 'none'); assert.equal(frame.width, png.readUInt32BE(16));
    assert.equal(frame.height, png.readUInt32BE(20)); assert.equal(frame.trimX, 0); assert.equal(frame.trimY, 0);
    assert.equal(meta.subMetas['6c48a'].userData.magfilter, 'nearest');
    assert.equal(meta.subMetas['6c48a'].userData.minfilter, 'linear');
    uuids.add(meta.uuid);
  }
  assert.equal(uuids.size, 3);
});
