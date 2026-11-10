const assert = require('node:assert/strict');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
const Scene = sceneMethods(['onMapPanStart', 'onMapPanMove', 'onMapPanCancel', 'mapPanBlocked',
  'applyMapViewPosition', 'onTouchMap'], { UITransform: {}, Vec3 });
const makeScene = (rotated = false) => {
  const scene = new Scene();
  const movable = () => ({ position: { x: 0, y: 0 }, setPosition(x, y) { this.position = { x, y }; } });
  Object.assign(scene, {
    mission: {}, outcome: 'ongoing', terrainSpriteBatchReady: true,
    mapPanGesture: null, outsideMapTurretInputNodes: [],
    mapNode: movable(), terrainLayerNode: movable(), airSupportLayerNode: movable(),
    // Model the real root's 1.5 UI scale and the inverse 90-degree view rotation.
    battlefieldContentNode: { getComponent: () => ({ convertToNodeSpaceAR: p => rotated
      ? { x: p.y / 1.5, y: -p.x / 1.5 } : { x: p.x / 1.5, y: p.y / 1.5 } }) },
    mapPanBounds: () => ({ minX: -100, maxX: 100, minY: -50, maxY: 50 }),
    clearHoveredTile() { this.hoverCleared = true; },
    isBusy() { this.clickChecks = (this.clickChecks ?? 0) + 1; return true; },
  });
  return scene;
};
const touch = (x, y, startX = 0, startY = 0, id = 1) => ({
  getID: () => id, getLocation: () => ({ x, y }), getUILocation: () => ({ x, y }),
  getStartLocation: () => ({ x: startX, y: startY }),
});
const pos = node => ({ x: node.position.x, y: node.position.y });
let scene = makeScene();
scene.onMapPanStart(touch(0, 0));
scene.onMapPanMove(touch(60, 30));
assert.deepEqual(pos(scene.mapNode), { x: 40, y: 20 }, 'mouse/touch movement accounts for root scale');
assert.deepEqual(pos(scene.terrainLayerNode), pos(scene.mapNode), 'terrain and units pan together');
assert.deepEqual(pos(scene.airSupportLayerNode), pos(scene.mapNode), 'aircraft, parachutes and aerial effects pan with terrain');
assert.ok(scene.hoverCleared);
scene.onMapPanMove(touch(600, -600));
assert.deepEqual(pos(scene.mapNode), { x: 100, y: -50 }, 'dragging clamps to map edges');
scene.onMapPanMove(touch(-600, 600));
assert.deepEqual(pos(scene.mapNode), { x: -100, y: 50 });
scene.onMapPanMove(touch(0, 0));
scene.onTouchMap(touch(0, 0));
assert.equal(scene.clickChecks, undefined, 'a drag returning to its origin never becomes a click');
assert.equal(scene.mapPanGesture, null);
scene.onMapPanStart(touch(0, 0));
scene.onMapPanMove(touch(3, 2));
scene.onTouchMap(touch(3, 2));
assert.equal(scene.clickChecks, 1, 'small hand movement preserves normal clicks');
scene.onMapPanStart(touch(0, 0));
scene.onMapPanCancel(touch(0, 0));
assert.equal(scene.mapPanGesture, null, 'cancelled touches release drag state');
scene.onMapPanStart(touch(0, 0));
scene.onMapPanMove(touch(30, 30, 0, 0, 2));
scene.onTouchMap(touch(30, 30, 0, 0, 2));
assert.equal(scene.mapPanGesture.touchId, 1, 'another finger cannot move or release the active drag');
scene.onMapPanCancel(touch(0, 0));
scene.mapPanBounds = () => null;
scene.onMapPanStart(touch(0, 0));
assert.equal(scene.mapPanGesture, null, 'standard maps never start a drag');

scene = makeScene(true);
scene.onMapPanStart(touch(0, 0));
scene.onMapPanMove(touch(60, 30));
assert.deepEqual(pos(scene.mapNode), { x: 20, y: -40 }, 'a rotated battlefield follows the screen-space pointer');
scene.onMapPanCancel(touch(60, 30));
for (const field of ['campaignTransitionActive', 'campaignPanAnim', 'leavingBattle', 'combatLogReplayOpen']) {
  scene[field] = true;
  scene.onMapPanStart(touch(0, 0));
  assert.equal(scene.mapPanGesture, null, `${field} blocks new drags`);
  scene[field] = false;
}
scene.terrainSpriteBatchReady = false;
scene.onMapPanStart(touch(0, 0));
assert.equal(scene.mapPanGesture, null, 'loading terrain blocks drags');
console.log('BattleScene map dragging tests passed');
