import {
  _decorator, Camera, Canvas, Color, Component, DirectionalLight, EventKeyboard, EventMouse,
  EventTouch, Graphics, HorizontalTextAlignment, Input, KeyCode, Label, Layers, Material,
  Mesh, MeshRenderer, Node, Rect, Tween, UITransform, Vec2, Vec3, VerticalTextAlignment, director, input, primitives, profiler, tween,
} from 'cc';
import { getLang } from '../core/Lang';
import {
  PROTOTYPE_HEX_RADIUS, Prototype3DBattle, prototypeHeight, prototypeKey, prototypeWorld,
} from '../core/Prototype3DScenario';
import type { Axial } from '../core/types';
import { applyAdaptiveResolution } from './ResolutionAdapter';
import { PrototypeGeometry } from './Prototype3DGeometry';

const { ccclass, property } = _decorator;
const rad = Math.PI / 180;
const P = (x = 0, y = 0, z = 0) => new Vec3(x, y, z);
const C = {
  ink: new Color(17, 27, 30), panel: new Color(23, 36, 39), line: new Color(63, 83, 82),
  text: new Color(238, 232, 211), muted: new Color(156, 177, 169), gold: new Color(230, 192, 112),
  green: new Color(107, 204, 169), red: new Color(227, 123, 99),
};
interface TankModel { root: Node; turret: Node; barrel: Node; muzzle: Node }

/** An independent 3D sandbox: procedural assets, real depth/lighting, no campaign state. */
@ccclass('Prototype3DScene')
export class Prototype3DScene extends Component {
  @property(Material)
  surfaceMaterial: Material | null = null;

  private battle = new Prototype3DBattle();
  private world!: Node;
  private camera!: Camera;
  private player!: TankModel;
  private enemy!: TankModel;
  private markers!: Node;
  private ui!: Node;
  private status!: Label;
  private resourcesLabel!: Label;
  private turnLabel!: Label;
  private targetLabel!: Label;
  private playerLabel!: Label;
  private fireButton!: { node: Node; draw(active: boolean): void };
  private moveButton!: { node: Node; draw(active: boolean): void };
  private endButton!: { node: Node; draw(active: boolean): void };
  private materials: Material[] = [];
  private meshes: Mesh[] = [];
  private markerMeshes: Mesh[] = [];
  private palette!: Record<string, Material>;
  private busy = false;
  private mode: 'move' | 'fire' = 'move';
  private yaw = -18;
  private pitch = 48;
  private distance = 25;
  private pointerStart: Vec2 | null = null;
  private pointerLast: Vec2 | null = null;
  private dragging = false;
  private pointerId: number | null = null;
  private pinchDistance = 0;
  private touchCount = 0;
  private movementProgress: { value: number } | null = null;

  private text(zh: string, en: string): string { return getLang() === 'en' ? en : zh; }

  onLoad(): void {
    applyAdaptiveResolution();
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setPosition(0, 0, 0);
    this.node.setScale(1.5, 1.5, 1);
    this.ui = this.node;
    (this.ui.getComponent(UITransform) ?? this.ui.addComponent(UITransform)).setContentSize(1280, 720);
    const canvas = this.node.parent!.getComponent(Canvas)!;
    if (canvas.cameraComponent) {
      canvas.cameraComponent.priority = 2;
      canvas.cameraComponent.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
      canvas.cameraComponent.visibility = Layers.Enum.UI_2D;
    }
    this.world = new Node('Prototype3DWorld');
    director.getScene()!.addChild(this.world);
    this.makePalette();
    this.setupEnvironment();
    this.makeTerrain();
    this.makeScenery();
    this.player = this.makeTank(false);
    this.enemy = this.makeTank(true);
    this.placeTank(this.player, this.battle.player);
    this.placeTank(this.enemy, this.battle.enemy);
    this.player.root.setRotationFromEuler(0, -55, 0);
    this.enemy.root.setRotationFromEuler(0, 125, 0);
    this.buildUI();
    this.refresh();
    this.bindInput(true);
    this.scheduleOnce(() => profiler.hideStats(), 0);
    console.info('[Prototype3D] Ready: 37 hexes, procedural Sherman/Panzer IV, move/fire/end turn.');
  }

  private material(name: string, hex: string, unlit = false): Material {
    const material = new Material();
    material.name = name;
    if (unlit) material.initialize({ effectName: 'builtin-unlit' });
    else material.initialize({ effectAsset: this.surfaceMaterial!.effectAsset });
    material.setProperty('mainColor', Color.fromHEX(new Color(), hex));
    if (!unlit) {
      material.setProperty('roughness', 0.92);
      material.setProperty('metallic', 0);
    }
    this.materials.push(material);
    return material;
  }

  private makePalette(): void {
    this.palette = {};
    const colors: Record<string, string> = {
      soil: '#665847', road: '#b2a37c', grass0: '#788356', grass1: '#818b5c', grass2: '#737f50',
      grid: '#58664c', wood: '#685540', leaf: '#455e43', leafLight: '#66794b', leafDark: '#344e3e',
      wall: '#c6b99c', roof: '#806251', window: '#394a4a', stone: '#8d927c',
      sherman: '#68794d', shermanLight: '#879263', panzer: '#a89a70', panzerLight: '#beb082',
      track: '#303b38', wheel: '#525c49', metal: '#48554b', white: '#dedbc5', wreck: '#424942',
    };
    for (const key of Object.keys(colors)) this.palette[key] = this.material(key, colors[key]);
    this.palette.reachable = this.material('reachable', '#6acaa8', true);
    this.palette.selected = this.material('selected', '#eac77e', true);
    this.palette.target = this.material('target', '#dc8067', true);
    this.palette.flash = this.material('flash', '#ffe4a0', true);
    this.palette.smoke = this.material('smoke', '#727b71');
  }

  private setupEnvironment(): void {
    const globals = director.getScene()!.globals;
    globals.skybox.enabled = false;
    globals.skybox.useHDR = true;
    globals.ambient.skyLightingColor = new Color(180, 198, 189);
    globals.ambient.groundLightingColor = new Color(115, 123, 106);
    globals.ambient.skyIllum = 24000;
    globals.shadows.type = 1;
    globals.shadows.shadowMapSize = 1024;
    globals.shadows.enabled = true;
    const sun = new Node('AfternoonSun');
    this.world.addChild(sun);
    sun.setRotationFromEuler(-56, -32, 0);
    const light = sun.addComponent(DirectionalLight);
    light.color = new Color(255, 237, 202);
    light.illuminance = 48000;
    light.shadowEnabled = true;
    light.shadowPcf = 1;
    light.shadowBias = 0.001;
    light.shadowNormalBias = 0.025;
    light.shadowDistance = 45;
    light.csmLevel = 1;
    const cameraNode = new Node('PrototypeCamera');
    this.world.addChild(cameraNode);
    this.camera = cameraNode.addComponent(Camera);
    this.camera.projection = Camera.ProjectionType.PERSPECTIVE;
    this.camera.fov = 42;
    this.camera.near = 0.1;
    this.camera.far = 90;
    this.camera.clearColor = new Color(45, 60, 59);
    this.camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    this.camera.visibility = Layers.Enum.DEFAULT;
    this.camera.rect = new Rect(0, 0.265, 1, 0.605);
    this.camera.priority = 0;
    this.updateCamera();
  }

  private makeTerrain(): void {
    const batch = new PrototypeGeometry();
    for (const [index, cell] of this.battle.cells.entries()) {
      const center = prototypeWorld(cell.pos);
      const positions: number[] = [center.x, prototypeHeight(center.x, center.z), center.z];
      const normals: number[] = [], indices: number[] = [];
      const rim: Vec3[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (30 + i * 60) * rad;
        const x = center.x + Math.cos(a) * PROTOTYPE_HEX_RADIUS * 0.998;
        const z = center.z + Math.sin(a) * PROTOTYPE_HEX_RADIUS * 0.998;
        rim.push(P(x, prototypeHeight(x, z), z));
        positions.push(x, prototypeHeight(x, z), z);
        indices.push(0, (i + 1) % 6 + 1, i + 1);
      }
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], slope = (prototypeHeight(x + 0.01, 0) - prototypeHeight(x - 0.01, 0)) / 0.02;
        const n = P(-slope, 1, 0).normalize();
        normals.push(n.x, n.y, n.z);
      }
      batch.add(cell.terrain === 'road' ? this.palette.road : this.palette[`grass${index % 3}`], { positions, normals, indices });
      for (let i = 0; i < 6; i++) {
        const a = rim[i], b = rim[(i + 1) % 6];
        const n = P((a.x + b.x) / 2 - center.x, 0, (a.z + b.z) / 2 - center.z).normalize();
        batch.add(this.palette.soil, {
          positions: [a.x, a.y, a.z, b.x, b.y, b.z, b.x, -0.75, b.z, a.x, -0.75, a.z],
          normals: [...Array.from({ length: 4 }, () => [n.x, n.y, n.z]).flat()], indices: [0, 1, 2, 0, 2, 3],
        });
        batch.line(this.palette.grid, P(a.x, a.y + 0.012, a.z), P(b.x, b.y + 0.012, b.z), 0.009);
      }
    }
    batch.build(this.world, 'ContinuousHexTerrain', this.meshes, false);
  }

  private makeScenery(): void {
    const batch = new PrototypeGeometry(), m = this.palette;
    for (const [index, cell] of this.battle.cells.entries()) {
      const { x, z } = prototypeWorld(cell.pos), y = prototypeHeight(x, z);
      if (cell.terrain === 'forest') {
        for (let j = 0; j < 3; j++) {
          const tx = x + Math.cos(j * 2.1 + index) * 0.6, tz = z + Math.sin(j * 2.1 + index) * 0.6;
          const ty = prototypeHeight(tx, tz), h = 1.5 + (index + j) % 3 * 0.2;
          batch.cylinder(m.wood, P(tx, ty + 0.5, tz), 0.09, 0.14, 1, 6);
          batch.cylinder(m.leafDark, P(tx, ty + h * 0.65, tz), 0, 0.7, h, 7);
          batch.cylinder(j % 2 ? m.leaf : m.leafLight, P(tx, ty + h, tz), 0, 0.55, h * 0.8, 7);
        }
      } else if (cell.terrain === 'building') {
        batch.box(m.wall, P(x, y + 0.65, z), P(1.6, 1.3, 1.35));
        // Gabled roof, with flat normals for its two sloping faces.
        const roof = { positions: [-.95, 0, -.85, .95, 0, -.85, 0, .65, -.85,
          -.95, 0, .85, 0, .65, .85, .95, 0, .85,
          -.95, 0, -.85, 0, .65, -.85, 0, .65, .85, -.95, 0, .85,
          0, .65, -.85, .95, 0, -.85, .95, 0, .85, 0, .65, .85],
          normals: [0,0,-1, 0,0,-1, 0,0,-1, 0,0,1, 0,0,1, 0,0,1,
            -.56,.83,0, -.56,.83,0, -.56,.83,0, -.56,.83,0, .56,.83,0, .56,.83,0, .56,.83,0, .56,.83,0],
          indices: [0,2,1, 3,5,4, 6,7,8, 6,8,9, 10,11,12, 10,12,13] };
        batch.add(m.roof, roof, P(x, y + 1.3, z));
        batch.box(m.stone, P(x + 0.48, y + 1.85, z + 0.2), P(.24, .8, .25));
        for (const dx of [-.45, .45]) batch.box(m.window, P(x + dx, y + .8, z + .682), P(.28, .4, .025));
        batch.box(m.wood, P(x, y + .36, z + .686), P(.32, .72, .03));
      } else if (cell.terrain === 'grass' && index % 3 === 0) {
        for (let i = 0; i < 5; i++) {
          const gx = x + Math.sin(i * 7 + index) * 1.1, gz = z + Math.cos(i * 3 + index) * 1.05;
          batch.cylinder(m.leafLight, P(gx, prototypeHeight(gx, gz) + .12, gz), .01, .08, .25, 4);
        }
      }
    }
    // A small fence along the village, and a few roadside stones.
    for (let i = 0; i < 9; i++) {
      const x = -4.2 + i * .65, z = -2.95, y = prototypeHeight(x, z);
      batch.box(m.wood, P(x, y + .35, z), P(.09, .7, .09));
      if (i < 8) batch.box(m.wood, P(x + .325, prototypeHeight(x + .325, z) + .46, z), P(.65, .08, .06));
    }
    batch.build(this.world, 'VillageAndWoods', this.meshes);
  }

  private makeTank(enemy: boolean): TankModel {
    const root = new Node(enemy ? 'PanzerIV' : 'M4Sherman');
    this.world.addChild(root);
    const m = this.palette, paint = enemy ? m.panzer : m.sherman, light = enemy ? m.panzerLight : m.shermanLight;
    const body = new PrototypeGeometry();
    body.box(paint, P(0, .56, 0), P(1.3, .46, 1.95));
    body.box(light, P(0, .85, -.54), P(1.28, .12, .9), P(-24, 0, 0));
    body.box(paint, P(0, .87, .5), P(1.3, .2, .8));
    for (const side of [-1, 1]) {
      body.box(m.track, P(side * .79, .34, 0), P(.35, .56, 2.3));
      for (let j = 0; j < 6; j++) {
        body.cylinder(m.wheel, P(side * .978, .34, -.91 + j * .36), .22, .22, .035, 10, P(0, 0, 90));
        body.cylinder(m.metal, P(side * 1.002, .34, -.91 + j * .36), .075, .075, .04, 8, P(0, 0, 90));
      }
      body.box(light, P(side * .78, .67, 0), P(.4, .07, 2.42));
      if (enemy) body.box(paint, P(side * 1.01, .58, .02), P(.06, .58, 1.85));
      for (let j = 0; j < 11; j++) body.box(m.metal, P(side * .79, .615, -1.02 + j * .2), P(.35, .025, .035));
      body.cylinder(m.white, P(side * .5, .9, -.9), .075, .075, .05, 8, P(70, 0, 0));
    }
    for (let j = 0; j < 5; j++) body.box(m.metal, P(0, 1, .5 + j * .075), P(.7, .015, .025));
    body.box(m.wood, P(0, 1.04, .86), P(.58, .15, .28));
    body.build(root, 'HullAndTracks', this.meshes);
    const turret = new Node('TurretPivot');
    root.addChild(turret);
    turret.setPosition(0, .94, -.12);
    const top = new PrototypeGeometry();
    top.cylinder(m.metal, P(0, .03, 0), .58, .58, .12, 12);
    if (enemy) top.box(paint, P(0, .25, 0), P(1.06, .52, .99));
    else top.cylinder(paint, P(0, .27, .03), .46, .62, .55, 12);
    top.cylinder(light, P(.18, .6, .18), .19, .19, .16, 10);
    top.cylinder(m.metal, P(.18, .69, .18), .16, .16, .025, 10);
    top.box(light, P(0, .24, -.53), P(.58, .38, .22));
    top.cylinder(m.metal, P(-.3, 1.02, .18), .014, .014, .85, 5);
    if (!enemy) {
      const star = { positions: [0,0,0], normals: [0,1,0], indices: [] as number[] };
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5, radius = i % 2 ? .1 : .23;
        star.positions.push(Math.sin(a) * radius, 0, -Math.cos(a) * radius);
        star.normals.push(0, 1, 0);
        star.indices.push(0, (i + 1) % 10 + 1, i + 1);
      }
      top.add(m.white, star, P(-.15, .551, -.04));
    }
    top.build(turret, 'TurretArmor', this.meshes);
    const barrel = new Node('RecoilBarrel');
    turret.addChild(barrel);
    const gun = new PrototypeGeometry();
    gun.cylinder(paint, P(0, .25, -1.12), .065, .075, 1.16, 10, P(90, 0, 0));
    gun.cylinder(m.metal, P(0, .25, -1.73), .07, .07, .07, 10, P(90, 0, 0));
    if (enemy) gun.box(m.metal, P(0, .25, -1.68), P(.18, .17, .23));
    gun.build(barrel, 'MainGun', this.meshes);
    const muzzle = new Node('Muzzle');
    barrel.addChild(muzzle);
    muzzle.setPosition(0, .25, -1.82);
    return { root, turret, barrel, muzzle };
  }

  private placeTank(tank: TankModel, pos: Axial): void {
    const { x, z } = prototypeWorld(pos);
    tank.root.setPosition(x, prototypeHeight(x, z) + .035, z);
  }

  private buildUI(): void {
    this.panel('Header', 0, 313, 10000, 94, C.ink);
    this.label('LONE SHERMAN   /   FIELD LAB 01', -420, 336, 390, 22, 14, C.gold);
    this.label(this.text('诺曼底 · 3D 样板战场', 'NORMANDY / 3D FIELD PROTOTYPE'), -342, 300, 548, 38, 28, C.text);
    this.turnLabel = this.label('', 310, 326, 220, 28, 21, C.gold);
    this.label(this.text('目标：击毁高地上的四号坦克', 'OBJECTIVE: DESTROY THE PANZER IV'), 258, 297, 324, 24, 16, C.muted);
    this.button('Back', this.text('返回菜单', 'MAIN MENU'), 536, 317, 142, 43, () => director.loadScene('main'));

    this.panel('Orders', 0, -288, 10000, 144, C.ink);
    this.panel('StatusBand', 0, -194, 10000, 44, C.panel);
    this.label(this.text('M4 谢尔曼', 'M4 SHERMAN'), -475, -246, 268, 30, 25, C.text);
    this.resourcesLabel = this.label('', -475, -285, 268, 54, 17, C.green);
    this.status = this.label('', 107, -194, 1030, 30, 17, C.text);
    this.moveButton = this.button('Move', this.text('01  移动', '01  MOVE'), -202, -262, 180, 56, () => this.chooseMode('move'));
    this.fireButton = this.button('Fire', this.text('02  主炮射击', '02  FIRE'), -4, -262, 180, 56, () => this.shoot(false));
    this.endButton = this.button('EndTurn', this.text('结束回合', 'END TURN'), 218, -262, 228, 56, () => this.endTurn());
    this.button('Reset', this.text('重新演练', 'RESTART'), 475, -262, 210, 56, () => this.restart());
    this.label(this.text('拖动战场旋转 · 滚轮缩放 · 右侧按钮调整俯角', 'DRAG TO ORBIT  /  SCROLL TO ZOOM  /  RIGHT CONTROLS TO TILT'),
      100, -327, 1010, 22, 14, C.muted);
    this.label(this.text('3D 演练 · 简化战斗规则', '3D SANDBOX / SIMPLIFIED COMBAT'), -440, 244, 350, 22, 13, C.muted);

    const controls: Array<[string, () => void]> = [
      ['↶', () => { this.yaw -= 25; this.updateCamera(); }],
      ['↷', () => { this.yaw += 25; this.updateCamera(); }],
      ['＋', () => this.zoom(-2)], ['－', () => this.zoom(2)],
      ['▱', () => { this.pitch = this.pitch > 50 ? 35 : 65; this.updateCamera(); }],
      ['⌂', () => { this.yaw = -18; this.pitch = 48; this.distance = 25; this.updateCamera(); }],
    ];
    controls.forEach(([title, action], i) => this.button(`Camera${i}`, title, 584, 190 - i * 57, 46, 46, action));
    this.playerLabel = this.label('', 0, 0, 180, 34, 14, C.green);
    this.targetLabel = this.label('', 0, 0, 190, 34, 14, C.red);
    for (const label of [this.playerLabel, this.targetLabel]) {
      label.enableOutline = true;
      label.outlineWidth = 3;
      label.outlineColor = C.ink;
    }
  }

  private panel(name: string, x: number, y: number, width: number, height: number, color: Color): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    this.ui.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-width / 2, -height / 2, width, height);
    g.fill();
    return node;
  }

  private label(text: string, x: number, y: number, w: number, h: number, size: number, color: Color): Label {
    const node = new Node('Text');
    node.layer = Layers.Enum.UI_2D;
    this.ui.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size * 1.4;
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private button(name: string, title: string, x: number, y: number, w: number, h: number, action: () => void) {
    const node = this.panel(name, x, y, w, h, C.panel), g = node.getComponent(Graphics)!;
    const draw = (active: boolean) => {
      g.clear();
      g.fillColor = active ? new Color(48, 73, 65) : C.panel;
      g.strokeColor = active ? C.gold : C.line;
      g.lineWidth = active ? 2 : 1;
      g.roundRect(-w / 2, -h / 2, w, h, 4);
      g.fill(); g.stroke();
    };
    draw(false);
    const label = this.label(title, x, y, w - 12, h - 6, w < 60 ? 25 : 19, C.text);
    label.node.setParent(node);
    label.node.setPosition(0, 0);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; action(); });
    return { node, draw };
  }

  private chooseMode(mode: 'move' | 'fire'): void {
    if (this.busy || this.battle.outcome !== 'playing') return;
    this.mode = mode;
    this.refresh();
  }

  private refresh(message?: string): void {
    const b = this.battle;
    this.turnLabel.string = this.text(`第 ${b.turn} 回合`, `TURN ${String(b.turn).padStart(2, '0')}`);
    this.resourcesLabel.string = this.text(`耐久 ${b.playerHP}/3  ·  移动 ${b.moves}/3\n主炮 ${b.fired ? '已射击' : '就绪'}`,
      `HULL ${b.playerHP}/3  ·  MOVE ${b.moves}/3\nGUN ${b.fired ? 'SPENT' : 'READY'}`);
    this.playerLabel.string = `M4 SHERMAN  ${'▰'.repeat(b.playerHP)}`;
    this.targetLabel.string = `PANZER IV  ${'▰'.repeat(b.enemyHP)}`;
    this.moveButton.draw(!this.busy && this.mode === 'move' && b.outcome === 'playing');
    this.fireButton.draw(!this.busy && b.canFire);
    this.endButton.draw(!this.busy && b.outcome === 'playing');
    if (message) this.status.string = message;
    else if (b.outcome === 'won') this.status.string = this.text('目标已摧毁 · 演练完成。可继续调整镜头，或重新演练。', 'TARGET DESTROYED / Exercise complete. Orbit the battlefield or restart.');
    else if (b.outcome === 'lost') this.status.string = this.text('谢尔曼已被击毁 · 点击“重新演练”再试一次。', 'SHERMAN DESTROYED / Restart the exercise to try again.');
    else if (this.busy) this.status.string = this.text('行动执行中…', 'Executing orders…');
    else if (b.fired) this.status.string = this.text('主炮已射击。可继续移动，或结束回合让敌方行动。', 'Gun spent. Reposition or end the turn for the enemy response.');
    else if (!b.clearShot) this.status.string = this.text('建筑或树林阻挡射线。移动到绿色格子，寻找射击位置。', 'Buildings or woods block the shot. Move to a green hex for a clear line.');
    else this.status.string = this.text('点击绿色格子移动；点击敌方坦克或“主炮射击”开火。每回合 3 格 / 1 发。', 'Click a green hex to move; click the target or FIRE. Three hexes and one shot per turn.');
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    if (this.markers?.isValid) { this.markers.active = false; this.markers.destroy(); }
    for (const mesh of this.markerMeshes) mesh.destroy();
    this.markerMeshes = [];
    const batch = new PrototypeGeometry();
    const outline = (pos: Axial, material: Material, inset: number, width: number) => {
      const { x, z } = prototypeWorld(pos), points: Vec3[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (30 + i * 60) * rad, px = x + Math.cos(a) * PROTOTYPE_HEX_RADIUS * inset;
        const pz = z + Math.sin(a) * PROTOTYPE_HEX_RADIUS * inset;
        points.push(P(px, prototypeHeight(px, pz) + .045, pz));
      }
      for (let i = 0; i < 6; i++) batch.line(material, points[i], points[(i + 1) % 6], width);
    };
    if (!this.busy && this.battle.outcome === 'playing') {
      for (const [key, path] of this.battle.reachablePaths()) {
        if (path.length) outline(this.battle.cellMap.get(key)!.pos, this.palette.reachable, .89, .016);
      }
    }
    outline(this.battle.player, this.palette.selected, .92, .035);
    if (this.battle.enemyHP > 0) outline(this.battle.enemy, this.palette.target, .91, .028);
    this.markers = batch.build(this.world, 'TacticalHighlights', this.markerMeshes, false);
  }

  private async moveTo(pos: Axial): Promise<void> {
    if (this.busy) return;
    const path = this.battle.moveTo(pos);
    if (!path) { this.refresh(this.text('请选择绿色可达格；树林、建筑与敌方格不可进入。', 'Choose a green reachable hex. Woods, houses and the target block movement.')); return; }
    this.busy = true;
    this.refresh();
    for (const step of path) {
      if (!this.isValid) return;
      const start = this.player.root.position.clone(), target = prototypeWorld(step);
      const yaw = Math.atan2(-(target.x - start.x), -(target.z - start.z)) / rad;
      this.player.root.setRotationFromEuler(0, yaw, 0);
      // Sample the same height field during the whole move, so tracks follow the ramp.
      const progress = { value: 0 };
      this.movementProgress = progress;
      await new Promise<void>(resolve => tween(progress).to(.4, { value: 1 }, { onUpdate: () => {
        if (!this.isValid) return;
        const x = start.x + (target.x - start.x) * progress.value, z = start.z + (target.z - start.z) * progress.value;
        this.player.root.setPosition(x, prototypeHeight(x, z) + .035, z);
      }}).call(() => resolve()).start());
    }
    if (!this.isValid) return;
    this.movementProgress = null;
    this.busy = false;
    this.refresh();
  }

  private async shoot(enemyShot: boolean): Promise<void> {
    if (!enemyShot && (this.busy || !this.battle.canFire)) {
      if (!this.busy) this.refresh(this.text('主炮未就绪或射线被遮挡。移动寻找射界，或结束回合装填。', 'Gun spent or line blocked. Reposition, or end the turn to reload.'));
      return;
    }
    if (!enemyShot) { this.battle.fire(); this.busy = true; this.refresh(); }
    const from = enemyShot ? this.enemy : this.player, to = enemyShot ? this.player : this.enemy;
    const delta = Vec3.subtract(P(), to.root.worldPosition, from.root.worldPosition);
    const yaw = Math.atan2(-delta.x, -delta.z) / rad;
    from.turret.setRotationFromEuler(0, yaw - from.root.eulerAngles.y, 0);
    // The same ramp height difference also changes the gun's elevation.
    const elevation = Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) / rad;
    from.barrel.setRotationFromEuler(elevation, 0, 0);
    tween(from.barrel).to(.08, { position: P(0, 0, .16) }).to(.3, { position: P() }).start();
    const shotBatch = new PrototypeGeometry();
    shotBatch.add(this.palette.flash, primitives.sphere(.1, { segments: 8 }));
    const shotMeshes: Mesh[] = [], shell = shotBatch.build(this.world, 'Shell', shotMeshes, false);
    this.meshes.push(...shotMeshes);
    shell.setWorldPosition(from.muzzle.worldPosition);
    const target = Vec3.add(P(), to.root.worldPosition, P(0, 1.1, 0));
    await new Promise<void>(resolve => tween(shell).to(.3, { position: target }).call(() => resolve()).start());
    if (!this.isValid) return;
    shell.destroy();
    shotMeshes.forEach(mesh => mesh.destroy());
    this.impact(target, (!enemyShot && this.battle.enemyHP <= 0) || (enemyShot && this.battle.playerHP <= 0));
    if (!enemyShot && this.battle.enemyHP <= 0) this.wreck(this.enemy);
    if (enemyShot && this.battle.playerHP <= 0) this.wreck(this.player);
    if (!enemyShot) { this.busy = false; this.refresh(); }
  }

  private impact(position: Vec3, destroyed: boolean): void {
    const geometry = new PrototypeGeometry();
    geometry.add(this.palette.flash, primitives.sphere(.24, { segments: 8 }));
    const meshes: Mesh[] = [], flash = geometry.build(this.world, 'ImpactFlash', meshes, false);
    this.meshes.push(...meshes);
    flash.setPosition(position);
    tween(flash).to(.12, { scale: P(2, 2, 2) }).to(.16, { scale: P(.01, .01, .01) })
      .call(() => { flash.destroy(); meshes.forEach(mesh => mesh.destroy()); }).start();
    if (destroyed) {
      const smoke = new PrototypeGeometry();
      for (let i = 0; i < 5; i++) smoke.add(this.palette.smoke, primitives.sphere(.3 + i * .08, { segments: 7 }),
        P(Math.sin(i * 3) * .18, i * .45, Math.cos(i * 4) * .15));
      const node = smoke.build(this.world, 'WreckSmoke', this.meshes, false);
      node.setPosition(position);
      tween(node).to(2.5, { position: Vec3.add(P(), position, P(.6, 1.8, 0)), scale: P(1.5, 1.5, 1.5) })
        .call(() => node.destroy()).start();
    }
  }

  private wreck(tank: TankModel): void {
    tank.turret.setRotationFromEuler(-8, 35, 12);
    for (const renderer of tank.root.getComponentsInChildren(MeshRenderer)) {
      renderer.setSharedMaterial(this.palette.wreck, 0);
    }
  }

  private async endTurn(): Promise<void> {
    if (this.busy || this.battle.outcome !== 'playing') return;
    this.busy = true;
    const firedBack = this.battle.endTurn();
    this.refresh(this.text('敌方回合…', 'Enemy turn…'));
    if (firedBack) await this.shoot(true);
    if (!this.isValid) return;
    this.busy = false;
    this.refresh();
  }

  private restart(): void {
    if (this.busy) return;
    director.loadScene('prototype3d');
  }

  private bindInput(bind: boolean): void {
    const method = bind ? 'on' : 'off';
    input[method](Input.EventType.TOUCH_START, this.onTouchStart, this);
    input[method](Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input[method](Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input[method](Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    input[method](Input.EventType.MOUSE_WHEEL, this.onWheel, this);
    input[method](Input.EventType.KEY_DOWN, this.onKey, this);
  }

  private withinBattlefield(point: Vec2): boolean {
    const local = this.ui.getComponent(UITransform)!.convertToNodeSpaceAR(P(point.x, point.y));
    return local.y < 234 && local.y > -166 && local.x < 548 && local.x > -625;
  }

  private onTouchStart(event: EventTouch): void {
    this.touchCount = event.getAllTouches().length;
    if (this.touchCount > 1) { this.dragging = true; this.pinchDistance = this.touchSeparation(event); return; }
    const point = event.getUILocation();
    if (!this.withinBattlefield(point)) return;
    this.pointerId = event.getID();
    this.pointerStart = point.clone();
    this.pointerLast = point.clone();
    this.dragging = false;
  }

  private touchSeparation(event: EventTouch): number {
    const touches = event.getAllTouches();
    return touches.length >= 2 ? Vec2.distance(touches[0].getLocation(), touches[1].getLocation()) : 0;
  }

  private onTouchMove(event: EventTouch): void {
    if (event.getAllTouches().length > 1) {
      const distance = this.touchSeparation(event);
      if (this.pinchDistance) this.zoom((this.pinchDistance - distance) * .035);
      this.pinchDistance = distance;
      this.dragging = true;
      return;
    }
    if (!this.pointerStart || !this.pointerLast || event.getID() !== this.pointerId || this.touchCount > 1) return;
    const point = event.getUILocation();
    if (Vec2.distance(point, this.pointerStart) > 6) this.dragging = true;
    if (this.dragging) {
      this.yaw -= (point.x - this.pointerLast.x) * .25;
      this.pitch = Math.max(25, Math.min(78, this.pitch + (point.y - this.pointerLast.y) * .16));
      this.updateCamera();
    }
    this.pointerLast = point.clone();
  }

  private onTouchEnd(event: EventTouch): void {
    if (event.getID() === this.pointerId && this.pointerStart && !this.dragging && this.touchCount < 2) this.pick(event.getLocation());
    this.onTouchCancel();
  }

  private onTouchCancel(): void {
    this.pointerStart = this.pointerLast = null;
    this.pointerId = null;
    this.pinchDistance = 0;
    this.touchCount = 0;
  }

  private onWheel(event: EventMouse): void {
    if (this.withinBattlefield(event.getUILocation())) this.zoom(-event.getScrollY() * .005);
  }

  private onKey(event: EventKeyboard): void {
    if (event.keyCode === KeyCode.KEY_Q) this.yaw -= 15;
    else if (event.keyCode === KeyCode.KEY_E) this.yaw += 15;
    else if (event.keyCode === KeyCode.KEY_F) { void this.shoot(false); return; }
    else if (event.keyCode === KeyCode.SPACE) { void this.endTurn(); return; }
    else return;
    this.updateCamera();
  }

  private zoom(delta: number): void {
    this.distance = Math.max(14, Math.min(36, this.distance + delta));
    this.updateCamera();
  }

  private updateCamera(): void {
    if (!this.camera) return;
    const horizontal = Math.cos(this.pitch * rad) * this.distance;
    this.camera.node.setPosition(Math.sin(this.yaw * rad) * horizontal,
      Math.sin(this.pitch * rad) * this.distance + .6, Math.cos(this.yaw * rad) * horizontal);
    this.camera.node.lookAt(P(0, .6, 0));
  }

  private pick(point: Vec2): void {
    if (this.busy || this.battle.outcome !== 'playing') return;
    const ray = this.camera.screenPointToRay(point.x, point.y);
    // Ray/height-field intersection: use bisection against the rendered ramp.
    let lo = 0, hi = 90;
    if (ray.d.y >= -.001) return;
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2, x = ray.o.x + ray.d.x * t, z = ray.o.z + ray.d.z * t;
      if (ray.o.y + ray.d.y * t > prototypeHeight(x, z)) lo = t; else hi = t;
    }
    const x = ray.o.x + ray.d.x * hi, z = ray.o.z + ray.d.z * hi;
    let nearest: Axial | null = null, distance = Infinity;
    for (const cell of this.battle.cells) {
      const world = prototypeWorld(cell.pos), d = Math.hypot(world.x - x, world.z - z);
      if (d < distance) { distance = d; nearest = cell.pos; }
    }
    if (!nearest || distance > PROTOTYPE_HEX_RADIUS) return;
    if (prototypeKey(nearest) === prototypeKey(this.battle.enemy)) void this.shoot(false);
    else void this.moveTo(nearest);
  }

  update(dt: number): void {
    if (!this.camera || !this.playerLabel) return;
    for (const [tank, label] of [[this.player, this.playerLabel], [this.enemy, this.targetLabel]] as const) {
      const position = Vec3.add(P(), tank.root.worldPosition, P(0, 2.2, 0));
      this.camera.convertToUINode(position, this.ui, position);
      label.node.setPosition(position.x, position.y, 0);
      label.node.active = position.y < 235 && position.y > -162 && Math.abs(position.x) < 520;
    }
  }

  onDestroy(): void {
    this.bindInput(false);
    if (this.movementProgress) Tween.stopAllByTarget(this.movementProgress);
    const stop = (node: Node) => { Tween.stopAllByTarget(node); node.children.forEach(stop); };
    if (this.world?.isValid) { stop(this.world); this.world.destroy(); }
    for (const mesh of [...this.meshes, ...this.markerMeshes]) if (mesh.isValid) mesh.destroy();
    for (const material of this.materials) if (material.isValid) material.destroy();
  }
}
