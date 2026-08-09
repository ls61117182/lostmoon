const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { canAttack, canMGAttack, hitBreakdown, previewAttack, rollAttack } = require('../assets/scripts/core/Combat.ts');

const map = new HexMap(2, 2);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });

const infantry = {
  id: 'inf',
  kind: 'infantry',
  faction: 'german',
  pos: { q: 0, r: 0 },
  facing: null,
  stats: {
    faction: 'german', size: 0, armorFront: 0, armorFrontSide: 0,
    armorRearSide: 0, armorRear: 0, penetration: 1, effectiveRange: 1,
    visionRange: 2, visionType: 'omni',
  },
};
const tank = {
  id: 'tank',
  kind: 'sherman',
  faction: 'american',
  pos: { q: 0, r: 0 },
  facing: 0,
  stats: {
    faction: 'american', size: 4, armorFront: 4, armorFrontSide: 3,
    armorRearSide: 2, armorRear: 1, penetration: 3, effectiveRange: 3,
    visionRange: 4, visionType: 'turreted',
  },
};

assert.strictEqual(
  canAttack({ attacker: infantry, target: tank, map }).ok,
  false,
  'classic rules should still reject overlapping attacks',
);
const hardcoreContext = {
  attacker: infantry,
  target: tank,
  map,
  sameHexInfantryTankAttack: true,
};
assert.strictEqual(canAttack(hardcoreContext).ok, true, 'hardcore infantry should attack a same-hex enemy tank');
assert.strictEqual(hitBreakdown(hardcoreContext).distance, 0, 'same-hex infantry attacks should use distance 0');
const preview = previewAttack(hardcoreContext);
assert.strictEqual(preview.pen.armorFace, 'rear', 'same-hex infantry attack previews should target rear armor');
assert.strictEqual(preview.pen.armor, tank.stats.armorRear, 'the preview should use the target tank rear armor value');
const report = rollAttack({ ...hardcoreContext, directionalDamageCheck: true }, { d6: () => 6 });
assert.strictEqual(report.armorFace, 'rear', 'same-hex infantry attacks should resolve against rear armor');
assert.strictEqual(report.armor, tank.stats.armorRear, 'penetration should use the target tank rear armor value');
assert.strictEqual(report.damageCheckType, 'rear', 'directional damage should treat the attack as coming from the rear');
assert.strictEqual(
  canAttack({ ...hardcoreContext, target: { ...tank, faction: infantry.faction } }).ok,
  false,
  'the overlap exception should apply only to an enemy tank',
);
assert.strictEqual(
  canMGAttack({ attacker: tank, target: infantry, map }).ok,
  false,
  'tank MG fire should remain illegal against same-hex infantry',
);

const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
assert.match(
  scene,
  /GameSession\.gameMode === 'hardcore'[\s\S]*?isTankUnit\(mover\) && isFootUnit\(occupant\)\) return false/,
  'hardcore tanks should ignore infantry as movement blockers regardless of faction',
);
assert.match(
  scene,
  /const sameHexInfantryTankAttack = GameSession\.gameMode === 'hardcore'[\s\S]*?if \(adjacentOnly && d !== 1 && !sameHexInfantryTankAttack\) continue/,
  'same-hex tanks should remain valid targets for infantry shoot-adjacent actions',
);
assert.match(
  scene,
  /private enemyTankSharingInfantryHex[\s\S]*?isTankUnit\(o\)[\s\S]*?o\.faction !== u\.faction/,
  'infantry rendering should identify a co-located enemy tank',
);
assert.match(
  scene,
  /slot\.node\.angle = coLocatedEnemyTank[\s\S]*?Math\.atan2\(-off\.oy, -off\.ox\)/,
  'each dispersed soldier should independently face the enemy tank at hex center',
);
assert.match(
  scene,
  /private releaseATGunCrew[\s\S]*?attachedToATGunId = undefined[\s\S]*?gun\.atGunCrewAlive = false/,
  'overrun AT-gun crews should be restored as ordinary infantry',
);
assert.match(
  scene,
  /private crushEnemyATGunsAt[\s\S]*?this\.releaseATGunCrew\(unit\)[\s\S]*?unit\.destroyed = true/,
  'AT-gun overrun should release its crew and destroy only the gun',
);

console.log('Hardcore same-hex rules tests passed');
