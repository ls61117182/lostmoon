const assert = require('node:assert/strict');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class Node {
  constructor(name) { this.name = name; this.children = []; this.angle = 0; this.position = { x: 0, y: 0 }; }
  addChild(node) { this.children.push(node); node.parent = this; }
  addComponent(Type) { const component = new Type(); component.node = this; return component; }
  setPosition(x, y) { this.position = { x, y }; }
}
class UITransform { setContentSize() {} }
class Graphics {}
class Color {}
const Scene = sceneMethods(['addTileInspectTilePreview', 'addTileInspectUnitPreview'], {
  Node, UITransform, Graphics, Color, t: key => key, tileHasBridge: () => false,
  HorizontalTextAlignment: { CENTER: 0 }, VerticalTextAlignment: { CENTER: 0 },
});
function worldPoint(node, point = { x: 0, y: 0 }) {
  const a = node.angle * Math.PI / 180;
  const result = { x: node.position.x + point.x * Math.cos(a) - point.y * Math.sin(a),
    y: node.position.y + point.x * Math.sin(a) + point.y * Math.cos(a) };
  return node.parent ? worldPoint(node.parent, result) : result;
}
function near(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8,
    `${JSON.stringify(actual)} should match ${JSON.stringify(expected)}`);
}
for (const rotation of [undefined, 0, 90]) {
  const scene = new Scene();
  scene.node = { layer: 1 };
  scene.mission = { data: { cameraRotation: rotation } };
  const renderedParents = [];
  for (const name of ['addTileInspectTerrainSprite', 'addTileInspectBridgeSurfaceSprite',
    'addTileInspectRoadSurfaceSprite', 'addTileInspectUrbanBuildingSprite',
    'addTileInspectForestSprites', 'addTileInspectHedgeSprites']) {
    scene[name] = parent => renderedParents.push(parent);
  }
  scene.paintTileInspectPreview = () => {};
  scene.usesWinterTerrainVisuals = () => false;
  scene.makeBattleModalLabel = (parent, text, x, y) => {
    const label = new Node('Caption'); label.text = text; label.setPosition(x, y); parent.addChild(label); return label;
  };
  const parent = new Node('ModalContent');
  scene.addTileInspectTilePreview(parent, { terrain: 'field', hasBuilding: false }, 50, -20, 44);
  const layout = parent.children[0];
  const view = layout.children.find(node => node.name === 'TilePreviewView');
  const art = view.children[0];
  const caption = layout.children.find(node => node.name === 'Caption');
  assert.equal(view.angle, rotation ?? 0);
  assert.equal(caption.angle, 0, 'terrain caption stays upright');
  assert.equal(caption.parent, layout, 'caption is outside the rotating artwork');
  assert.ok(renderedParents.every(node => node === art), 'terrain, roads, buildings and foliage rotate together');
  near(worldPoint(art, { x: 0, y: 24 }), { x: 50, y: -53 });
  near(worldPoint(art, { x: 10, y: 24 }), rotation === 90 ? { x: 50, y: -43 } : { x: 60, y: -53 });
  near(worldPoint(caption), { x: 50, y: -119 });

  scene.paintTileInspectUnitPreview = node => {
    const hull = new Node('Hull'); hull.angle = 180; node.addChild(hull);
    const turret = new Node('Turret'); turret.angle = 120; node.addChild(turret);
  };
  scene.addTileInspectUnitPreview(parent, {}, 50, -150, 44);
  const unitPreview = parent.children[1];
  assert.equal(unitPreview.angle, rotation ?? 0);
  assert.equal(unitPreview.children[0].angle + unitPreview.angle, 180 + (rotation ?? 0));
  assert.equal(unitPreview.children[1].angle + unitPreview.angle, 120 + (rotation ?? 0));
  near(worldPoint(unitPreview), { x: 50, y: -196 });
}
console.log('Tile inspection previews follow camera rotation while captions and centers keep their layout');
