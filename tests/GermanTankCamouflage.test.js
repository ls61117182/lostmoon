const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file);
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const camouflage = require('../assets/scripts/core/TankCamouflage.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const { GERMAN_LATE_WAR_VISUAL_KINDS: kinds, usesGermanLateWarCamouflage: usesLate, lateWarTankVisualAssetConfigOf: lateAssets } = camouflage;

test('omitted mission paint defaults to grey and explicit paint is validated', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/missions/mission_01.json'), 'utf8'));
  delete data.germanTankCamouflage;
  const m = loadMission(data, new RNG(7));
  assert.equal(data.germanTankCamouflage, undefined);
  assert.equal(camouflage.normalizeGermanTankCamouflage(undefined), 'grey');
  for (const u of m.enemies) assert.equal(usesLate(m.data, u), false);
  for (const value of [null, true, '', 'ambush']) assert.throws(() => loadMission({ ...data, germanTankCamouflage: value }), /germanTankCamouflage/);
  for (const value of ['grey', 'late_war']) assert.doesNotThrow(() => loadMission({ ...data, germanTankCamouflage: value }, new RNG(7)));
});

test('paint follows German faction across player, allies, enemies and future units, excluding guns and foreign tanks', () => {
  assert.equal(kinds.length, 16);
  const mission = { germanTankCamouflage: 'late_war' };
  for (const kind of kinds) {
    for (const sideId of ['player', 'enemy']) assert.equal(usesLate(mission, { kind, faction: 'german', sideId }), true, kind);
    assert.equal(usesLate(mission, { kind, faction: 'usa' }), false);
    assert.equal(usesLate(undefined, { kind, faction: 'german' }), false);
    assert.equal(usesLate({ germanTankCamouflage: 'grey' }, { kind, faction: 'german' }), false);
  }
  for (const kind of ['sherman', 'type97', 'pak38', 'flak88', 'german_heavy_artillery', 'truck', 'german_infantry']) {
    assert.equal(usesLate(mission, { kind, faction: getUnitStats(kind).faction }), false);
  }
});

test('reinforcements and saved wrecks retain the level paint without unit-level flags', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/missions/mission_01.json'), 'utf8'));
  data.germanTankCamouflage = 'late_war';
  const mission = loadMission(structuredClone(data), new RNG(7));
  const occupied = [mission.playerTank, ...mission.allies, ...mission.enemies];
  const spawn = mission.map.all().find(tile => tile.enemyStartId && !occupied.some(u => u.pos.q === tile.pos.q && u.pos.r === tile.pos.r));
  assert.ok(spawn, 'fixture needs a free reinforcement marker');
  const prepared = prepareTurnEndEvent({ effectType: 'tiger_spawn', reinforcementSide: 'enemy' }, [1, 1], 2,
    { mission, rng: { d6: () => spawn.enemyStartId }, nextEnemyId: () => 'late-reinforcement' });
  prepared.apply();
  const reinforcement = mission.enemies.find(u => u.id === 'late-reinforcement');
  assert.ok(reinforcement, 'the event must create an actual reinforcement');
  assert.equal(usesLate(mission.data, reinforcement), true);
  reinforcement.destroyed = true;
  const save = captureSave({ gameMode: 'standard', missionId: data.id, mission, turn: 3, phase: 'player', movesLeft: 0, attacksLeft: 0, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const restored = loadMission(structuredClone(data), new RNG(7));
  assert.equal(applySave(restored, data.id, JSON.parse(JSON.stringify(save))).ok, true);
  const wreck = restored.enemies.find(u => u.id === reinforcement.id);
  assert.equal(wreck.destroyed, true);
  assert.equal(usesLate(restored.data, wreck), true);
});

const methods = ['ensureSplitTankSprites', 'splitTankSpritesFor', 'tankTopMetaFor', 'destroyedTankTopMetaFor', 'loadTankVisualSprites', 'loadMissionTankCamouflage'];
const Scene = sceneMethods(methods, {
  ...visuals, ...camouflage, getUnitStats,
  isSplitTankKind: kind => visuals.SPLIT_TANK_KINDS.includes(kind),
});
function scene() {
  const s = new Scene();
  for (const key of ['splitTankSprites', 'lateWarSplitTankSprites', 'enemyTopMeta', 'lateWarTopMeta', 'destroyedTopMeta', 'lateWarDestroyedTopMeta', 'commanderHatchSpriteFrames']) s[key] = {};
  return s;
}

test('the battle loader registers both complete skins; rendering can switch levels without stale caches', () => {
  const s = scene(), pending = [];
  s.loadSpriteFrame = (resource, warning, loaded) => {
    if (!resource) return;
    const complete = () => loaded({ path: resource }, 150, 85);
    if (resource.includes('/late_war/')) pending.push({ resource, complete });
    else complete();
  };
  s.loadTankVisualSprites();
  assert.equal(pending.length, 0, 'default grey levels must not request any alternate textures');
  const tiger = { kind: 'tiger', faction: 'german' };
  s.mission = { data: { germanTankCamouflage: 'late_war' } };
  s.loadMissionTankCamouflage();
  assert.equal(pending.length, 54);
  s.loadMissionTankCamouflage();
  assert.equal(pending.length, 54, 'campaign transitions must not duplicate pending requests');
  const grey = s.splitTankSpritesFor(tiger, 'tiger');
  pending.find(p => p.resource.includes('/tiger_top_hull/')).complete();
  assert.equal(s.splitTankSpritesFor(tiger, 'tiger'), grey, 'partially loaded layers must not mix paints');
  for (const p of [...pending].reverse()) p.complete();
  for (const kind of kinds) {
    const u = { kind, faction: 'german' };
    assert.equal(s.tankTopMetaFor(u).sf.path, lateAssets(kind).topSpritePath);
    assert.equal(s.destroyedTankTopMetaFor(u).sf.path, lateAssets(kind).destroyedSpritePath);
    if (visuals.SPLIT_TANK_KINDS.includes(kind)) {
      const layers = s.splitTankSpritesFor(u, kind);
      assert.equal(layers.hull.path, lateAssets(kind).hullSpritePath);
      assert.equal(layers.turret.path, lateAssets(kind).turretSpritePath);
    }
  }
  assert.equal(s.tankTopMetaFor({ ...tiger, faction: 'usa' }).sf.path, visuals.tankVisualAssetConfigOf('tiger').topSpritePath);
  s.mission = { data: {} };
  assert.equal(s.splitTankSpritesFor(tiger, 'tiger'), grey);
  assert.equal(s.tankTopMetaFor(tiger).sf.path, visuals.tankVisualAssetConfigOf('tiger').topSpritePath);
  assert.equal(s.destroyedTankTopMetaFor(tiger).sf.path, visuals.tankVisualAssetConfigOf('tiger').destroyedSpritePath);
});

test('all 54 skins preserve source pixels and Cocos geometry while keeping every grey file untouched', async () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'source_art/tanks/german-late-war/asset-report.json'), 'utf8'));
  assert.deepEqual(report.models.map(m => m.kind).sort(), [...kinds].sort());
  const uuids = new Set();
  let count = 0;
  for (const model of report.models) {
    const assets = lateAssets(model.kind), base = visuals.tankVisualAssetConfigOf(model.kind);
    for (const f of model.files) {
      const resource = assets[`${f.role}SpritePath`];
      assert.equal(resource, base[`${f.role}SpritePath`].replace('textures/units/', 'textures/units/late_war/'));
      const original = path.join(root, 'assets/resources/textures/units', f.name);
      const variant = path.join(root, 'assets/resources', resource.replace('/spriteFrame', '.png'));
      assert.equal(sha(fs.readFileSync(original)), f.greySha256, `${f.name}: original RGB changed`);
      assert.equal(sha(fs.readFileSync(`${original}.meta`)), f.greyMetaSha256, `${f.name}: original metadata changed`);
      assert.equal(sha(fs.readFileSync(variant)), f.lateWarSha256);
      const grey = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const late = await sharp(variant).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(late.info.width, grey.info.width);
      assert.equal(late.info.height, grey.info.height);
      let changed = 0;
      for (let i = 0; i < grey.data.length; i += 4) {
        assert.equal(late.data[i + 3], grey.data[i + 3], `${f.name}: silhouette changed`);
        if (grey.data[i + 3] && !grey.data.subarray(i, i + 3).equals(late.data.subarray(i, i + 3))) changed++;
      }
      assert.ok(changed > 100, `${f.name}: missing camouflage paint`);
      const gm = JSON.parse(fs.readFileSync(`${original}.meta`, 'utf8'));
      const lm = JSON.parse(fs.readFileSync(`${variant}.meta`, 'utf8'));
      assert.notEqual(lm.uuid, gm.uuid);
      assert.equal(uuids.has(lm.uuid), false, 'each skin needs its own import UUID');
      uuids.add(lm.uuid);
      assert.deepEqual(JSON.parse(JSON.stringify(lm).split(lm.uuid).join(gm.uuid)), gm, `${f.name}: Cocos trim, UVs, pivots or import settings changed`);
      count++;
    }
  }
  assert.equal(count, 54);
});
