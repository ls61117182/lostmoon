const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const coLocationHelper = battleScene.match(
  /private\s+infantrySharesHexWithOtherUnit\s*\(u:\s*Unit\):\s*boolean\s*\{[\s\S]*?\n  \}/,
);
assert(coLocationHelper, 'BattleScene should detect other units sharing an infantry hex');
const ts = require('typescript');
const helperSource = coLocationHelper[0].replace(/^private\s+/, '');
const compiledHelper = ts.transpileModule(`class FormationProbe { ${helperSource} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const GameSession = { gameMode: 'hardcore' };
const FormationProbe = new Function('isTankUnit', 'isHeavyArtilleryUnit', 'GameSession', `${compiledHelper}\nreturn FormationProbe;`)(
  unit => unit.kind === 'sherman' || unit.kind === 'tiger',
  unit => unit.kind === 'heavy_artillery' || unit.kind === 'german_heavy_artillery',
  GameSession,
);
const probe = new FormationProbe();
const infantry = { kind: 'infantry', pos: { q: 2, r: 3 }, destroyed: false };
const tank = { kind: 'sherman', pos: { q: 2, r: 3 }, destroyed: false };
probe.mission = { sherman: tank, allies: [infantry], enemies: [] };
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), true, 'a live tank should spread the squad');
tank.destroyed = true;
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), true, 'the squad should stay spread after the tank is destroyed');
tank.pos = { q: 3, r: 3 };
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), false, 'a wreck in another hex should not spread the squad');
const enemyWreck = { kind: 'tiger', pos: { ...infantry.pos }, destroyed: true };
probe.mission.enemies = [enemyWreck];
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), true, 'enemy tank wrecks should also spread the squad');
probe.mission.enemies = [{ kind: 'infantry', pos: { ...infantry.pos }, destroyed: true }];
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), false, 'destroyed foot units should not trigger the wide formation');
probe.mission.enemies[0].destroyed = false;
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), true, 'live foot units should still spread the squad');
for (const gameMode of ['hardcore', 'test', 'classic']) {
  GameSession.gameMode = gameMode;
  for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
    for (const destroyed of [false, true]) {
      probe.mission.enemies = [{ kind, pos: { ...infantry.pos }, destroyed }];
      assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), gameMode === 'classic' && !destroyed,
        `${gameMode}: ${kind} must act like a building for infantry formation outside classic mode`);
      tank.pos = { ...infantry.pos };
      assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), true,
        'a tank sharing the hex should still spread the squad');
      tank.pos = { q: 3, r: 3 };
    }
  }
}
probe.mission = null;
assert.strictEqual(probe.infantrySharesHexWithOtherUnit(infantry), false, 'a missing mission should not trigger the wide formation');
assert(
  !coLocationHelper[0].includes('isFootUnit(o)'),
  'foot units and officers should trigger the same wide infantry formation as vehicles',
);
assert.match(
  battleScene,
  /const\s+coLocateOtherUnit\s*=\s*this\.infantrySharesHexWithOtherUnit\(u\);[\s\S]*?infantrySquadOffsets\(this\.hexSize,\s*coLocateOtherUnit\)/,
  'live infantry sprites should use the wide formation whenever another unit shares their hex',
);

console.log('BattleScene infantry co-location formation test passed');
