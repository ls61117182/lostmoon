const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exported = {};
const code = ts.transpileModule(fs.readFileSync('assets/scripts/view/RockyHighlandVariants.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('exports', code)(exported);
const { assignRockyHighlandVariants: assign, rockyCellKey: key, ROCKY_HIGHLAND_SPRITE_PATHS: paths } = exported;
assert.equal(paths.length, 6);
const assetUuids = new Set(), assetDigests = new Set();
const crypto = require('node:crypto');
for (const resource of paths) {
  const file = `assets/resources/${resource.replace('/spriteFrame', '.png')}`;
  const png = fs.readFileSync(file);
  assert.equal(png.readUInt32BE(16), 222); assert.equal(png.readUInt32BE(20), 256);
  assetDigests.add(crypto.createHash('sha256').update(png).digest('hex'));
  const meta = JSON.parse(fs.readFileSync(`${file}.meta`, 'utf8'));
  assetUuids.add(meta.uuid);
  assert.equal(meta.subMetas.f9941.userData.rawWidth, 222);
  assert.equal(meta.subMetas.f9941.userData.rawHeight, 256);
  assert.equal(meta.subMetas.f9941.userData.trimType, 'none');
}
assert.equal(assetUuids.size, 6, 'Each Cocos image has its own UUID');
assert.equal(assetDigests.size, 6, 'All six generated assets are different');
const cells = [];
for (let r = -16; r <= 16; r++) for (let q = -16; q <= 16; q++) {
  cells.push({ pos: { q, r }, terrain: (q + r) % 11 === 0 ? 'field' : 'rocky' });
}
const neighbors = [[1,0], [0,1], [-1,1], [-1,0], [0,-1], [1,-1]];
for (const seed of ['mission_01', 'random_pacific_42', 'random_pacific_43', '', 'negative-coordinates']) {
  const result = assign(cells, seed);
  assert.equal(result.size, cells.filter(cell => cell.terrain === 'rocky').length);
  assert.deepEqual(result, assign([...cells].reverse(), seed), 'Map serialization order does not change saved appearance');
  const counts = Array(6).fill(0);
  for (const cell of cells) {
    const value = result.get(key(cell.pos));
    if (cell.terrain !== 'rocky') { assert.equal(value, undefined); continue; }
    assert(value >= 0 && value < 6); counts[value]++;
    for (const [dq, dr] of neighbors) {
      assert.notEqual(value, result.get(key({ q: cell.pos.q + dq, r: cell.pos.r + dr })), 'Adjacent rocky hexes use different art');
    }
  }
  assert(counts.every(count => count > 100), 'All six variants are used across a dense map');
}
assert.notDeepEqual(assign(cells, 'random_pacific_42'), assign(cells, 'random_pacific_43'), 'New map seeds get different arrangements');
const isolated = Array.from({ length: 60 }, (_, i) => ({ terrain: 'rocky', pos: { q: i * 3, r: 0 } }));
const distribution = Array(6).fill(0);
for (const value of assign(isolated, 'balanced').values()) distribution[value]++;
assert.deepEqual(distribution, Array(6).fill(10), 'Distant hexes use a balanced selection, not repeated independent dice rolls');
assert.equal(assign([], 'empty').size, 0);

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
function method(name) {
  const start = source.indexOf(`  private ${name}(`);
  const end = source.indexOf('\n  private ', start + 10);
  assert(start >= 0 && end > start);
  return source.slice(start, end);
}
const sceneJS = ts.transpileModule(`class Scene { ${method('prepareRockyHighlandVariants')} ${method('terrainSpriteFrameFor')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const Scene = new Function('assignRockyHighlandVariants', 'rockyCellKey', `${sceneJS}; return Scene;`)(assign, key);
const scene = new Scene(), fallback = {}, grass = {}, winterGrass = {};
Object.assign(scene, {
  mission: { data: { id: 'random_pacific_42' } }, rockyVariantLayoutSignature: '', rockyVariantsByCell: new Map(),
  rockyVariantFrames: paths.map(() => ({})), terrainSpriteFrames: { rocky: fallback, field: grass },
  winterTerrainSpriteFrames: { field: winterGrass }, usesWinterTerrainVisuals: () => false,
});
scene.prepareRockyHighlandVariants(cells);
const cache = scene.rockyVariantsByCell;
scene.prepareRockyHighlandVariants([...cells].reverse());
assert.equal(scene.rockyVariantsByCell, cache, 'Redraws reuse the assignment cache');
const tile = cells.find(cell => cell.terrain === 'rocky');
const selected = scene.rockyVariantsByCell.get(key(tile.pos));
assert.equal(scene.terrainSpriteFrameFor('rocky', tile), scene.rockyVariantFrames[selected]);
assert.equal(scene.terrainSpriteFrameFor('field', tile), grass, 'Other terrain is unaffected');
scene.rockyVariantFrames[selected] = null;
assert.equal(scene.terrainSpriteFrameFor('rocky', tile), fallback, 'Missing variant falls back to legacy art');
scene.usesWinterTerrainVisuals = () => true;
assert.equal(scene.terrainSpriteFrameFor('field', tile), winterGrass);
assert.equal(scene.terrainSpriteFrameFor('rocky', tile), fallback);
scene.mission.data.id = 'random_pacific_43';
scene.prepareRockyHighlandVariants(cells);
assert.notDeepEqual(scene.rockyVariantsByCell, cache, 'Changing mission refreshes assignments');
scene.prepareRockyHighlandVariants(cells.filter(cell => cell !== tile));
assert(!scene.rockyVariantsByCell.has(key(tile.pos)), 'Removing highlands refreshes the cached topology');
assert.match(source, /terrainSpriteFrameFor\(tile\.terrain, tile\)/, 'Tile inspection uses the same selected frame');
console.log('Six rocky highland variants: stable seeded distribution, no adjacent repeats, balanced usage and fallback verified.');
