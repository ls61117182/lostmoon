const assert = require('node:assert/strict');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

const offsetToAxial = ({ col, row }) => ({ q: col - Math.floor(row / 2), r: row });
const axialToPixel = ({ q, r }, size) => ({ x: Math.sqrt(3) * size * (q + r / 2), y: 1.5 * size * r });
class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
const UITransform = {};
const Scene = sceneMethods(['applyBattlefieldCameraRotation', 'mapFitScale', 'pickTileAtScreenUi',
  'mapScreenOffset', 'positionMapScreenNode', 'screenAlignedMapGraphics', 'advanceFloaters'], {
  offsetToAxial, axialToPixel, Vec3, UITransform, Color,
});
const scene = new Scene();
scene.battlefieldViewNode = { angle: 0 };
scene.mission = { data: { cameraRotation: 90 } };
scene.applyBattlefieldCameraRotation();
assert.equal(scene.battlefieldViewNode.angle, 90);
// Cocos uses Y-up: a point to the left rotates to below the pivot.
const angle = scene.battlefieldViewNode.angle * Math.PI / 180;
assert.ok(Math.abs(-100 * Math.cos(angle)) < 1e-10);
assert.equal(-100 * Math.sin(angle), -100);
scene.mission.data = {};
scene.applyBattlefieldCameraRotation();
assert.equal(scene.battlefieldViewNode.angle, 0, 'loading a normal mission resets the view');

const columns = [[2, 6], [1, 6], [1, 7], [0, 6], [1, 6], [1, 5]];
const tiles = columns.flatMap(([first, last], row) => Array.from({ length: last - first + 1 },
  (_, i) => ({ pos: offsetToAxial({ col: first + i, row }) })));
scene.cameraReferenceTiles = () => tiles;
scene.campaignRuntime = null;
assert.equal(scene.mapFitScale(), 1);
scene.mission.data.cameraRotation = 90;
const scale = scene.mapFitScale();
const width = Math.max(...tiles.map(t => axialToPixel(t.pos, 1).x))
  - Math.min(...tiles.map(t => axialToPixel(t.pos, 1).x)) + Math.sqrt(3);
const height = Math.max(...tiles.map(t => axialToPixel(t.pos, 1).y))
  - Math.min(...tiles.map(t => axialToPixel(t.pos, 1).y)) + 2;
assert.ok(Math.abs(scale - height / width) < 1e-10, 'the rotated footprint fits the original board height');
scene.campaignRuntime = { segments: [0, 1] };
scene.cameraReferenceTilesForSegment = index => index === 0 ? tiles : tiles.map(t => ({ pos: { q: t.pos.q + 100, r: t.pos.r } }));
assert.ok(Math.abs(scene.mapFitScale() - scale) < 1e-10, 'campaign offsets do not affect rotated sizing');

// Exercise tile picking with an inverse view transform and a panned map.
const pivotY = 38, panX = 25, panY = -60;
scene.hexSize = 40;
scene.mission.map = { all: () => tiles };
scene.project = (q, r) => { const p = axialToPixel({ q, r }, scene.hexSize); return { x: p.x - 180, y: -p.y + 190 }; };
scene.mapNode = { getComponent: () => ({
  convertToNodeSpaceAR: p => new Vec3(p.y - pivotY - panX, pivotY - p.x - panY, 0),
}) };
for (const tile of tiles) {
  const local = scene.project(tile.pos.q, tile.pos.r);
  const ui = { x: -(local.y + panY - pivotY), y: local.x + panX + pivotY };
  assert.equal(scene.pickTileAtScreenUi({ getUILocation: () => ui }), tile, 'rotated clicks select the original logical tile');
}
assert.equal(scene.pickTileAtScreenUi({ getUILocation: () => ({ x: 10000, y: 10000 }) }), null);
console.log('BattleScene camera rotation test passed');

const labelNode = { setPosition(x, y) { this.position = { x, y }; } };
scene.positionMapScreenNode(labelNode, 100, 200, 10, -30);
assert.deepEqual({ ...labelNode.position }, { x: 70, y: 190 });
assert.equal(labelNode.angle, -90, 'map label cancels camera rotation');
const calls = [];
const graphics = {
  circle(...args) { calls.push(['circle', ...args]); },
  ellipse(...args) { calls.push(['ellipse', ...args]); },
  rect(...args) { calls.push(['rect', ...args]); },
  moveTo(...args) { calls.push(['moveTo', ...args]); },
  fill() { calls.push(['fill']); },
};
const aligned = scene.screenAlignedMapGraphics(graphics, 100, 200);
aligned.circle(100, 220, 5);
aligned.ellipse(110, 220, 8, 4);
aligned.rect(100, 200, 10, 20);
aligned.moveTo(110, 220);
aligned.fillColor = 'test';
aligned.fill();
assert.deepEqual(calls, [
  ['circle', 120, 200, 5], ['ellipse', 120, 190, 4, 8],
  ['rect', 100, 190, 20, 10], ['moveTo', 120, 190], ['fill'],
]);
assert.equal(graphics.fillColor, 'test', 'style writes reach the actual Graphics component');
const mapFloater = { parent: scene.mapNode, setPosition(x, y) { this.position = { x, y }; }, destroy() {} };
const hudFloater = { parent: {}, setPosition(x, y) { this.position = { x, y }; }, destroy() {} };
scene.floaters = [mapFloater, hudFloater].map(node => ({ node, label: {},
  baseX: 100, baseY: 200, baseR: 255, baseG: 255, baseB: 255, t: 0, dur: 1, rise: 40 }));
scene.advanceFloaters(0.5);
assert.deepEqual(mapFloater.position, { x: 120, y: 200 }, 'map floater rises toward screen-up');
assert.deepEqual(hudFloater.position, { x: 100, y: 220 }, 'HUD floater keeps its original screen motion');
scene.mission.data.cameraRotation = 0;
scene.positionMapScreenNode(labelNode, 100, 200, 10, -30);
assert.deepEqual({ ...labelNode.position }, { x: 110, y: 170 });
assert.equal(labelNode.angle, 0, 'pooled labels reset in normal missions');
assert.equal(scene.screenAlignedMapGraphics(graphics, 100, 200), graphics);
