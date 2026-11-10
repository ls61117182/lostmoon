const assert = require('node:assert/strict');
const test = require('node:test');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class Sprite {}
class UITransform {}
class Color { constructor(...rgba) { this.rgba = rgba; } }
class Node {
  constructor(parent) { this.parent = parent; this.position = { x: 0, y: 0 }; }
  setPosition(x, y) { this.position = { x, y }; }
  getComponent() { return null; }
  setScale() {}
  setSiblingIndex() {}
  getSiblingIndex() { return 1; }
}
class Graphics {
  calls = [];
  clear() { this.calls = []; }
  moveTo(...args) { this.calls.push(['move', ...args]); }
  lineTo(...args) { this.calls.push(['line', ...args]); }
  circle(...args) { this.calls.push(['circle', ...args]); }
  ellipse(...args) { this.calls.push(['ellipse', ...args]); }
  fill() {}
  stroke() {}
}
const Scene = sceneMethods(['playStukaFlyover', 'advanceStukaFlyover', 'applyMapViewPosition',
  'drawStukaShotDown', 'drawStukaCannonBurst', 'drawStukaBlast'], {
  Sprite, UITransform, Color, CANVAS_W: 1280,
  playStukaFlyover() {}, playStukaCannonFire() {}, stopStukaCannonFire() {}, playMgFire() {},
  machineGunBurstStartPoint: (source, ux, uy, size) => ({ x: source.x + ux * size, y: source.y + uy * size }),
});
function setup(player, shotDown, flyoverOnly) {
  const scene = new Scene();
  const layer = new Node();
  Object.assign(scene, {
    mission: {}, mapNode: new Node(), terrainLayerNode: new Node(), airSupportLayerNode: layer,
    stukaSpriteNode: new Node(layer), stukaBlastNode: new Node(layer), stukaBlastGraphics: new Graphics(),
    hexSize: 50, project: () => ({ x: 10, y: 15 }), hashStringToSeed: () => 1,
    canHearBattleAt: () => true, seededUnit: () => 0.5,
    spawnMachineGunBurst: () => ({ t: 0, dur: 0.62 }),
    drawFireSmoke(g, point) { g.calls.push(['smoke', point.x, point.y]); },
  });
  scene.applyMapViewPosition(90, -35);
  scene.playStukaFlyover({ id: 'target', pos: { q: 0, r: 0 } }, player, () => {}, shotDown, flyoverOnly);
  return scene;
}
test('Stuka flight, attack timing, smoke and cannon geometry remain map-local while dragging', () => {
  for (const player of [false, true]) for (const shotDown of [false, true]) for (const flyoverOnly of [false, true]) {
    const control = setup(player, shotDown, flyoverOnly);
    const dragged = setup(player, shotDown, flyoverOnly);
    assert.equal(dragged.stukaFlyover.y, 15, 'initial camera offset is not baked into flight height');
    for (let frame = 0; frame < 60; frame++) {
      dragged.applyMapViewPosition(frame % 2 ? -180 : 240, frame % 3 ? 115 : -95);
      control.advanceStukaFlyover(0.05);
      dragged.advanceStukaFlyover(0.05);
      assert.deepEqual(dragged.stukaSpriteNode.position, control.stukaSpriteNode.position, 'camera cannot change the flight path');
      assert.equal(dragged.stukaFlyover.cannonT, control.stukaFlyover.cannonT, 'camera cannot change cannon firing time');
      assert.equal(dragged.stukaFlyover.cannonSoundStarted, control.stukaFlyover.cannonSoundStarted);
      assert.deepEqual(dragged.stukaBlastGraphics.calls, control.stukaBlastGraphics.calls, 'tracers and impacts stay on the same map points');
      if (shotDown && !flyoverOnly) {
        assert.equal(dragged.stukaFlyover.aaBurst.targetX, dragged.stukaSpriteNode.position.x);
        assert.equal(dragged.stukaFlyover.aaBurst.targetY, dragged.stukaSpriteNode.position.y);
      }
      const map = dragged.mapNode.position, air = dragged.airSupportLayerNode.position;
      assert.deepEqual(air, map, 'the entire aircraft/effects layer shares map translation');
      // Relative to the ground, the world-space offset changes only with animation.
      const plane = dragged.stukaSpriteNode.position, reference = control.stukaSpriteNode.position;
      assert.ok(Math.abs(plane.x + air.x - map.x - reference.x) < 1e-9);
      assert.ok(Math.abs(plane.y + air.y - map.y - reference.y) < 1e-9);
    }
  }
});
test('Stuka explosion geometry follows the shared air layer without adding camera offset twice', () => {
  const scene = setup(false, false, false);
  scene.drawStukaBlast({ q: 0, r: 0 }, 0.4);
  const geometry = scene.stukaBlastGraphics.calls;
  assert.ok(geometry.length > 0);
  scene.applyMapViewPosition(-240, 125);
  scene.drawStukaBlast({ q: 0, r: 0 }, 0.4);
  assert.deepEqual(scene.stukaBlastGraphics.calls, geometry);
});
