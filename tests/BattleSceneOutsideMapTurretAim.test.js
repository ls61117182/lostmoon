const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const start = source.indexOf('  private outsideMapTurretAimDirection(');
const end = source.indexOf('\n  private ', start + 10);
// Compile as a class method so the production guards run against a lightweight scene.
const code = ts.transpile(`class Scene { ${source.slice(start, end)} }`, { target: ts.ScriptTarget.ES2020 });
const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const directionTo = (a, b) => {
  const dq = b.q - a.q, dr = b.r - a.r;
  if (dq === 0 && dr === 0) return null;
  const axis = offsets.findIndex(([q, r]) => dq * r === dr * q && dq * q + dr * r > 0);
  if (axis >= 0) return axis;
  const diagonals = offsets.map(([q, r], i) => [q + offsets[(i + 1) % 6][0], r + offsets[(i + 1) % 6][1]]);
  const diagonal = diagonals.findIndex(([q, r]) => dq * r === dr * q && dq * q + dr * r > 0);
  return diagonal < 0 ? null : diagonal + 6;
};
const gunnerRange = unit => unit.gunnerVisionRange ?? 3;
const Scene = new Function('hexDistance', 'fireDirectionTo', 'MG_MAX_RANGE', 'currentGunnerVisionRange', `${code}; return Scene;`)(distance, directionTo, 1, gunnerRange);
const scene = new Scene();
Object.assign(scene, {
  mission: { sherman: { pos: { q: 0, r: 0 } }, map: { get: () => undefined } },
  phase: 'player', playerStep: 'attack', selectedGunDieIdx: 0, selectedGunHitThresholdModifier: 0,
  hasTurretReconGunSelection: () => true, playerTurretCanRotate: () => true,
  canWeaponAimDirection: (_unit, direction) => direction !== 3,
});
offsets.forEach(([q, r], direction) => assert.equal(scene.outsideMapTurretAimDirection({ q, r }), direction === 3 ? null : direction));
assert.equal(scene.outsideMapTurretAimDirection({ q: 2, r: 0 }), 0);
assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 1 }), 6);
assert.equal(scene.outsideMapTurretAimDirection({ q: 3, r: 0 }), null);
scene.selectedMGDieIdx = 0;
assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 0 }), 0);
assert.equal(scene.outsideMapTurretAimDirection({ q: 2, r: 0 }), null, 'MG range must exclude the second ring');
assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 1 }), null, 'MG range must exclude second-ring diagonal hexes');
scene.selectedMGDieIdx = -1;
scene.mission.sherman.gunnerVisionRange = 1;
assert.equal(scene.outsideMapTurretAimDirection({ q: 2, r: 0 }), null, 'main-gun direction selection must respect gunner range');
delete scene.mission.sherman.gunnerVisionRange;
assert.equal(scene.outsideMapTurretAimDirection({ q: 0, r: 0 }), null);
scene.mission.map.get = () => ({});
assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 0 }), null);
scene.mission.map.get = () => undefined;
for (const [key, value] of [['phase', 'enemy'], ['playerStep', 'move'], ['selectedGunHitThresholdModifier', -2], ['turretTargetOverlaySuppressed', true], ['turretAimAnim', {}]]) {
  const previous = scene[key];
  scene[key] = value;
  assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 0 }), null, key);
  scene[key] = previous;
}
scene.playerTurretCanRotate = () => false;
assert.equal(scene.outsideMapTurretAimDirection({ q: 1, r: 0 }), null);
console.log('Outside-map turret direction tests passed');

const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const productionScene = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BattleScene');
const getMethod = name => productionScene.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast);
const layout = getMethod('layoutBattleHud');
const layoutPrefix = layout.slice(0, layout.indexOf('this.missionTitleLabel')) + '}';
const harnessCode = ts.transpile(`class Harness {
  ${layoutPrefix}
  ${['outsideMapTurretAimDirection', 'outsideMapTurretAimPositions', 'shouldCombatLogTouchTargetMap', 'showOutsideMapTurretInput', 'onTouchMap', 'pixelToNearestAxial', 'tryAimShermanTurretAtFogTile'].map(getMethod).join('\n')}
}`, { target: ts.ScriptTarget.ES2020 });
const Harness = new Function('UITransform', 'Vec3', 'visibleSizeInRootSpace', 'UI_ROOT_SCALE', 'BOTTOM_CONTROL_SAFE_INSET', 'hexDistance', 'fireDirectionTo', 'diagonalGunnerClickPreference', 'MG_MAX_RANGE', 'currentGunnerVisionRange', `${harnessCode}; return Harness;`)(
  {}, class { constructor(x, y) { this.x = x; this.y = y; } },
  () => ({ width: 1280, height: 1100 }), 1.5, 60, distance, directionTo, () => null, 1, gunnerRange,
);
const host = new Harness();
let inputSize;
host.mapInputNode = { getComponent: () => ({ setContentSize: (width, height) => { inputSize = { width, height }; } }) };
host.layoutBattleHud();
assert.deepEqual(inputSize, { width: 1280, height: 1100 }, 'map input must expand into the tall viewport');
let rotatedTo;
let consumed;
Object.assign(host, {
  mission: { sherman: { pos: { q: 0, r: 0 }, facing: 0 }, map: { get: () => undefined } },
  mapNode: { getComponent: () => ({ convertToNodeSpaceAR: pos => pos }) },
  hexSize: 80, offsetX: 0, offsetY: -350,
  phase: 'player', playerStep: 'attack', outcome: 'ongoing',
  selectedGunDieIdx: 0, selectedMGDieIdx: -1, selectedGunDoublesIdx: -1, selectedGunHitThresholdModifier: 0,
  phaseDice: [{ used: false }],
  isBusy: () => false, hasTurretReconGunSelection: () => true, playerTurretCanRotate: () => true,
  canWeaponAimDirection: () => true, playerHasFixedWeaponArc: () => false, currentTurretFacingFor: () => 0,
  closeDiePopover: () => {}, hideTurretTargetOverlayForCommittedAction: () => {},
  startShermanTurretAimDirection: (direction, done) => { rotatedTo = direction; done(); },
  usePhaseDice: indices => { consumed = indices; }, clearGunSelection: () => {},
  refreshPhaseUI: () => {}, updateHUD: () => {}, redraw: () => {}, completePhaseDiceAction: () => {},
});
// Southwest off-map center lies below the old 720-high input rectangle.
const click = { x: -Math.sqrt(3) * 40, y: -470 };
host.onTouchMap({ getStartLocation: () => click, getLocation: () => click, getUILocation: () => click });
assert.equal(rotatedTo, 2, 'an off-map click must start turret rotation toward the clicked hex');
assert.deepEqual(consumed, [0], 'rotation must consume the selected die');
console.log('Outside-map input coverage and click-to-rotation tests passed');

// Exercise the independent target node with scene translation and UI scaling.
const inputCode = ts.transpile(`class InputHarness { ${getMethod('showOutsideMapTurretInput')} }`, { target: ts.ScriptTarget.ES2020 });
class MockNode {
  static EventType = { TOUCH_END: 'end' };
  addComponent() { return this.transform = { setContentSize: (w, h) => { this.size = [w, h]; } }; }
  getComponent() { return this.transform; }
  setPosition(pos) { this.position = pos; }
  setSiblingIndex(index) { this.siblingIndex = index; }
  off() {}
  on(_type, handler) { this.handler = handler; }
}
const InputHarness = new Function('Node', 'UITransform', 'Vec3', 'axialEquals', `${inputCode}; return InputHarness;`)(
  MockNode, {}, class { constructor(x, y) { this.x = x; this.y = y; } },
  (a, b) => a.q === b.q && a.r === b.r,
);
const inputHost = new InputHarness();
Object.assign(inputHost, host, {
  outsideMapTurretInputNodes: [],
  node: { layer: 1, addChild: () => {}, getComponent: () => ({ convertToNodeSpaceAR: p => ({ x: p.x / 1.5, y: p.y / 1.5 }) }) },
  mapNode: { getComponent: () => ({
    convertToWorldSpaceAR: p => ({ x: p.x * 1.5 + 30, y: p.y * 1.5 + 60 }),
    convertToNodeSpaceAR: p => ({ x: (p.x - 30) / 1.5, y: (p.y - 60) / 1.5 }),
  }) },
  mapInputNode: { getSiblingIndex: () => 4 },
  pixelToNearestAxial: host.pixelToNearestAxial.bind(host),
  outsideMapTurretAimDirection: host.outsideMapTurretAimDirection.bind(host),
  tryAimShermanTurretAtFogTile: host.tryAimShermanTurretAtFogTile.bind(host),
});
rotatedTo = undefined;
inputHost.showOutsideMapTurretInput({ q: -1, r: 1 }, click);
const targetNode = inputHost.outsideMapTurretInputNodes[0];
assert.equal(targetNode.siblingIndex, 5);
assert.deepEqual(targetNode.position, { x: click.x + 20, y: click.y + 40 });
const screenClick = { x: click.x * 1.5 + 30, y: click.y * 1.5 + 60 };
targetNode.handler({ getStartLocation: () => screenClick, getLocation: () => screenClick, getUILocation: () => screenClick });
assert.equal(rotatedTo, 2, 'the independent off-map touch node must rotate the turret after UI transforms');
console.log('Independent outside-map touch node test passed');

// Reproduce the real blocker: the transparent combat-log ScrollView owns the touch.
assert.equal(host.outsideMapTurretAimPositions().length, 18, 'both rings must have masks and touch nodes');
host.selectedMGDieIdx = 0;
assert.equal(host.outsideMapTurretAimPositions().length, 6, 'MG masks and touch nodes must cover only the first ring');
host.selectedMGDieIdx = -1;
rotatedTo = undefined;
const secondRingClick = { x: -Math.sqrt(3) * 80, y: -590 };
const secondRingEvent = { getStartLocation: () => secondRingClick, getLocation: () => secondRingClick, getUILocation: () => secondRingClick };
host.onTouchMap(secondRingEvent);
assert.equal(rotatedTo, 2, 'second-ring clicks must rotate toward the selected direction');
host.pickTileAtScreenUi = () => null;
assert.equal(host.shouldCombatLogTouchTargetMap(secondRingEvent), true, 'second-ring clicks must pass through the log');
const event = { getStartLocation: () => click, getLocation: () => click, getUILocation: () => click };
assert.equal(host.shouldCombatLogTouchTargetMap(event), true, 'off-map blue hexes must pass through the combat log');
const scrollView = { vertical: true, stopAutoScroll() {} };
const buildLog = productionScene.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'buildCombatLog');
const callbacks = {};
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'scrollN.on'
    && node.arguments[0]?.getText(ast).startsWith('Node.EventType.TOUCH_')) {
    const eventName = node.arguments[0].getText(ast).split('.').at(-1);
    const callbackCode = ts.transpile(`const handler = ${node.arguments[1].getText(ast)};`, { target: ts.ScriptTarget.ES2020 });
    callbacks[eventName] = new Function('sv', `${callbackCode}; return handler;`).call(host, scrollView);
  }
  ts.forEachChild(node, visit);
}
visit(buildLog);
rotatedTo = undefined;
callbacks.TOUCH_START(event);
assert.equal(scrollView.vertical, false, 'a blue-hex click must disable log scrolling for this gesture');
callbacks.TOUCH_END(event);
assert.equal(rotatedTo, 2, 'the combat-log event must reach map input and start turret rotation');
assert.equal(scrollView.vertical, true);
assert.equal(event.propagationStopped, true);
host.hasTurretReconGunSelection = () => false;
assert.equal(host.shouldCombatLogTouchTargetMap(event), false, 'without weapon selection, empty space still belongs to the log');
host.isDeepShadowTile = tile => !!tile.displayOnly || !!tile.otherSegment;
host.mission.map.get = () => ({ displayOnly: true });
assert.equal(host.shouldCombatLogTouchTargetMap(event), false, 'display-only terrain must leave combat history clickable');
host.mission.map.get = () => ({ otherSegment: true });
assert.equal(host.shouldCombatLogTouchTargetMap(event), false, 'inactive campaign segments must leave combat history clickable');
host.mission.map.get = () => ({});
assert.equal(host.shouldCombatLogTouchTargetMap(event), true, 'current battlefield terrain must retain map click priority');
console.log('Combat-log interception and off-map click forwarding tests passed');
