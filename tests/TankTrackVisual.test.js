const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/TankTrackVisual.ts');
assert(fs.existsSync(sourcePath), 'TankTrackVisual.ts should define permanent tank-track visuals');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);

const {
  renderedTankBodyLength,
  renderedTankBodyWidth,
  tankTrackAlphaAfterTurns,
  tankTrackEdgeKey,
  tankTrackHalfGap,
  tankTrackLineWidth,
  tankTrackProgressSegment,
  tankTrackStyleForTerrain,
  tankTrackSweptSegment,
  tankTrackTraversalKey,
  TANK_TRACK_STYLE_ORDER,
} = loaded.exports;

assert.strictEqual(tankTrackStyleForTerrain('mud', false), 'strong');
assert.strictEqual(tankTrackStyleForTerrain('field', false), 'normal');
assert.strictEqual(tankTrackStyleForTerrain('clear', false), 'shallow');
assert.strictEqual(tankTrackStyleForTerrain('beach', false), 'none');
assert.strictEqual(tankTrackStyleForTerrain('road', false), 'faint');
assert.strictEqual(tankTrackStyleForTerrain('airstrip', false), 'faint');
assert.strictEqual(tankTrackStyleForTerrain('water', false), 'none');
assert.strictEqual(tankTrackStyleForTerrain('deep_water', false), 'none');
assert.strictEqual(
  tankTrackStyleForTerrain('water', true),
  'faint',
  'a bridge deck must override its water base',
);
assert.deepStrictEqual(TANK_TRACK_STYLE_ORDER, ['strong', 'normal', 'shallow', 'faint']);

assert.strictEqual(renderedTankBodyWidth(60, 100, 50, 0.7), 37.8);
assert.strictEqual(renderedTankBodyLength(60, 100, 50, 0.7), 75.6);
assert.strictEqual(tankTrackHalfGap(50), 19);
assert.strictEqual(tankTrackLineWidth(20), 4, 'small tanks should still leave a readable thick mark');
assert.strictEqual(tankTrackLineWidth(37.8), 7.5, 'track width should grow with rendered hull width');
assert.strictEqual(tankTrackLineWidth(50), 10, 'very wide hulls should use the capped batch width');
assert.strictEqual(tankTrackAlphaAfterTurns(78, 0), 78, 'new marks should use their terrain base alpha');
assert.strictEqual(tankTrackAlphaAfterTurns(78, 1), 39, 'one completed turn should retain 50% alpha');
assert.strictEqual(tankTrackAlphaAfterTurns(78, 2), 20, 'decay should compound from the current alpha');
assert.deepStrictEqual(
  tankTrackSweptSegment(0, 0, 100, 0, 20),
  { fromX: -20, fromY: 0, toX: 120, toY: 0 },
  'forward tracks should cover the initial rear through the final front',
);
assert.deepStrictEqual(
  tankTrackSweptSegment(100, 0, 0, 0, 20),
  { fromX: 120, fromY: 0, toX: -20, toY: 0 },
  'reversing a right-facing tank should cover the initial front through the final rear',
);
assert.deepStrictEqual(
  tankTrackProgressSegment(0, 0, 100, 0, 20, 0),
  { fromX: -20, fromY: 0, toX: 20, toY: 0 },
  'starting movement should include the full initial hull footprint',
);
assert.deepStrictEqual(
  tankTrackProgressSegment(0, 0, 100, 0, 20, 0.25),
  { fromX: -20, fromY: 0, toX: 45, toY: 0 },
  'the growing endpoint must reach the leading edge of the moving hull',
);
for (const [dx, dy] of [[100, 0], [-100, 0], [50, 80], [-50, 80], [50, -80], [-50, -80]]) {
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  for (const progress of [0, 0.4, 1]) {
    const segment = tankTrackProgressSegment(0, 0, dx, dy, 20, progress);
    assert(Math.abs(segment.fromX * ux + segment.fromY * uy + 20) < 1e-9,
      'the initial trailing edge must be included in every movement direction');
    assert(Math.abs(segment.toX * ux + segment.toY * uy - (length * progress + 20)) < 1e-9,
      'the entire animated hull must be covered, including its leading half');
    assert(Math.abs(Math.hypot(segment.toX - segment.fromX, segment.toY - segment.fromY)
      - (length * progress + 40)) < 1e-9,
      'the swept trail must include one full hull length beyond centre travel');
  }
  const forward = tankTrackSweptSegment(0, 0, dx, dy, 20);
  const reverse = tankTrackSweptSegment(dx, dy, 0, 0, 20);
  assert(Math.hypot(forward.fromX - reverse.toX, forward.fromY - reverse.toY) < 1e-9);
  assert(Math.hypot(forward.toX - reverse.fromX, forward.toY - reverse.fromY) < 1e-9,
    'forward and reverse traversal must cover the same full ground footprint');
}
assert.strictEqual(
  tankTrackEdgeKey(1, 2, 2, 2),
  tankTrackEdgeKey(2, 2, 1, 2),
  'the same ground edge should have one replacement key in either direction',
);
assert.strictEqual(
  tankTrackEdgeKey(1, 2, 2, 2),
  tankTrackEdgeKey(1, 2, 2, 2),
  'different tanks traversing the same edge must target the same visible mark',
);
assert.strictEqual(
  tankTrackTraversalKey('tank-1', 1, 2, 2, 2),
  tankTrackTraversalKey('tank-1', 2, 2, 1, 2),
  'the same tank must not redraw an edge when traversing it in reverse',
);
assert(
  renderedTankBodyWidth(60, 100, 66, 0.6755) > renderedTankBodyWidth(60, 100, 44, 0.7),
  'a wider rendered hull should automatically leave wider-spaced tracks',
);

const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
assert(battleScene.includes("new Node('TankTracks')"), 'BattleScene should create one permanent track layer');
assert(
  battleScene.includes("new Node('VisibleTrackMask')"),
  'tank tracks should be clipped by the currently visible hex mask',
);
assert(
  battleScene.includes('this.beginTankTrackAnimation(this.anim);'),
  'tank movement should begin its track before advancing the animation',
);
assert(
  battleScene.includes('const swept = tankTrackProgressSegment('),
  'BattleScene should draw only the ground area reached by current movement progress',
);
assert(
  battleScene.includes('this.clearTankTracks();'),
  'loading or restarting a mission should clear the previous mission tracks',
);
assert(
  battleScene.includes('this.tankTracks = this.tankTracks.filter(track => this.tankTrackRemainsVisible(track));'),
  'turn-end fading should discard track records after their rendered alpha reaches zero',
);
assert(
  /tankTrackRemainsVisible[\s\S]*?tankTrackAlphaAfterTurns\(TANK_TRACK_COLORS\[style\]\.a, track\.fadeSteps\) > 0/.test(battleScene),
  'track cleanup should use the same rounded alpha calculation as rendering',
);

console.log('Tank-track visual tests passed');
