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
  tankTrackEdgesContinueStraight,
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
  'forward movement should cover the initial hull rear through the final hull front',
);
assert.deepStrictEqual(
  tankTrackSweptSegment(100, 0, 0, 0, 20),
  { fromX: 120, fromY: 0, toX: -20, toY: 0 },
  'reverse movement should cover the initial hull front through the final hull rear',
);
assert.deepStrictEqual(
  tankTrackSweptSegment(0, 0, 100, 0, 20, false, true),
  { fromX: 0, fromY: 0, toX: 120, toY: 0 },
  'a connected start should meet the previous mark at the shared hex centre without overlap',
);
assert.deepStrictEqual(
  tankTrackSweptSegment(0, 0, 100, 0, 20, true, false),
  { fromX: -20, fromY: 0, toX: 100, toY: 0 },
  'a connected end should meet the next mark at the shared hex centre without overlap',
);
assert.deepStrictEqual(
  tankTrackProgressSegment(0, 0, 100, 0, 20, 0.25),
  { fromX: -20, fromY: 0, toX: 45, toY: 0 },
  'the mark should grow with the moving tank instead of appearing at arrival',
);
assert.strictEqual(
  tankTrackEdgesContinueStraight(0, 0, -1, 0, 1, 0),
  true,
  'opposite directions through a shared centre form one straight run',
);
assert.strictEqual(
  tankTrackEdgesContinueStraight(0, 0, -1, 0, 0, 1),
  false,
  'a turn must retain both directional half-hull marks',
);
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

console.log('Tank-track visual tests passed');
