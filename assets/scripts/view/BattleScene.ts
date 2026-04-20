/**
 * BattleScene —— 把 mission_01.json 渲染为六角格地图，支持回合制移动、攻击与存读档。
 *
 * 玩法：
 *   - 谢尔曼周围绿圈 = 1 行动力可走，橙圈 = 2 行动力，点击即移动
 *   - 视线中的敌人外缘会出现红色六边形描边，点击该格即开炮
 *   - 2d6 ≥ 命中所需 = 命中；MVP 命中即推进伤害（一击起火、二击摧毁），跳过穿甲检定
 *   - 结算后目标格上方会短暂浮现 MISS / 起火 / 击毁 字样
 *   - 起火单位 = 鲜橙色 + 黄边 + 下方"起火"小字；摧毁 = 灰底红 X + 下方"已毁"小字
 *   - 行动力 / 攻击力归零后右下"结束回合"按钮变红，点击进入敌方阶段
 *   - 敌方坦克贪心地向谢尔曼移动，移动结束后若有视线 → 立即开火（每敌 1 发/回合）
 *   - 摧毁任务目标单位 → 屏幕中央"胜利！"；谢尔曼被摧毁 → "战败"
 *   - 胜负出现后下方"再来一局"按钮可点击重置整局，使用同一份任务 JSON
 *   - 右上"存档 / 读档"：单槽 localStorage，仅玩家阶段且无动画时可存
 *
 * 用法：
 *   1. 打开任意场景（如 changjing2.scene）
 *   2. 在 Canvas 下新建一个空 Node（命名随意，如 "battle"）
 *   3. 把本脚本拖到该 Node 上
 *   4. 预览即可看到地图与 HUD
 *
 * Inspector 可调：hexSize / missionPath / showReachable / moveDuration /
 *                 movesPerTurn / attacksPerTurn / rngSeed
 */

import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  JsonAsset,
  Label,
  Node,
  sys,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  resources,
} from 'cc';
import {
  axialToPixel,
  approximateDirection,
  directionTo,
  hexDistance,
  neighbor,
  neighbors,
} from '../core/HexGrid';
import { AttackReport, canAttack, hitThreshold, resolveAttack } from '../core/Combat';
import { RNG } from '../core/Dice';
import { decideEnemyMove } from '../core/EnemyAI';
import { loadMission, LoadedMission } from '../core/MissionLoader';
import { terrainMoveCost } from '../core/MoveCost';
import { checkOutcome, MissionOutcome } from '../core/Objective';
import { applySave, captureSave, SAVE_KEY, SaveData } from '../core/SaveLoad';
import { MissionData, TerrainType, Tile, Unit } from '../core/types';

const { ccclass, property } = _decorator;

/** 三阶缓出：起步快、收尾慢，最适合"惯性滑停"的坦克移动 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 任意单位正在播放的移动动画（谢尔曼 / 敌坦克通用） */
interface MoveAnim {
  unit: Unit;    // 当前正在动画的单位
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  t: number;     // 0..1
  dur: number;   // 秒
}

type Phase = 'player' | 'enemy';

/** 战报浮字：一条挂在 mapNode 下的 Label，会上浮 + 渐隐 + 自毁 */
interface Floater {
  node: Node;
  label: Label;
  baseR: number;   // 原色 RGB，透明度在 update() 里重算
  baseG: number;
  baseB: number;
  baseX: number;   // 生成时的起点
  baseY: number;
  t: number;       // 已播放时长（秒）
  dur: number;     // 总时长（秒）
  rise: number;    // 整段动画向上移动的像素
}

// ---------- 配色 ----------
const TERRAIN_COLORS: Record<TerrainType, Color> = {
  road:     new Color(190, 175, 145, 255),
  field:    new Color(196, 220, 130, 255),
  mud:      new Color(140, 110,  80, 255),
  forest:   new Color( 70, 130,  60, 255),
  building: new Color(110, 100,  90, 255),
  water:    new Color( 90, 145, 200, 255),
};

const FACTION_COLORS = {
  allied: new Color( 60, 160,  80, 255),
  german: new Color( 60,  60,  60, 255),
};

const HEDGE_COLOR        = new Color( 35,  90,  35, 255);
const TILE_BORDER        = new Color( 40,  40,  40, 220);
const FACING_COLOR       = new Color(255, 210,  60, 255);
const UNIT_BORDER        = new Color(255, 255, 255, 255);
// 可达高亮按地形开销分色：1 点畅通=绿，2 点缓慢=橙
const REACHABLE_CHEAP    = new Color(120, 230, 120, 255);
const REACHABLE_COSTLY   = new Color(255, 165,  60, 255);

// HUD 配色：行动力归零时按钮换成"提醒色"，引导玩家结束回合
const BTN_BG_NORMAL  = new Color( 60,  90, 140, 230);
const BTN_BG_URGENT  = new Color(190,  80,  60, 240);
const BTN_BORDER     = new Color(255, 255, 255, 255);
const HUD_TEXT_COLOR = new Color(255, 255, 255, 255);

// 战斗视觉：起火（被命中 1 次）= 鲜橙底 + 亮黄边 + 双层火焰环；摧毁 = 暗灰 + 红 X
const ONFIRE_FILL      = new Color(255, 110,  30, 255);
const ONFIRE_BORDER    = new Color(255, 230,  60, 255);
const ONFIRE_RING_OUT  = new Color(255, 160,  40, 200);
const DESTROYED_FILL   = new Color( 60,  60,  60, 220);
const DESTROYED_BORDER = new Color(220,  40,  40, 255);
// 持久化状态文字（"起火" / "已毁"），在单位下方绘制
const STATUS_TEXT_FIRE = new Color(255, 200,  60, 255);
const STATUS_TEXT_DEAD = new Color(220,  60,  60, 255);
const STATUS_TEXT_OUT  = new Color(  0,   0,   0, 220);
// 可攻击目标（视线中、非摧毁敌方）高亮
const ATTACKABLE_COLOR = new Color(255,  60,  60, 255);

// 命中预览：按 2d6≥N 的成功概率分四档配色
const PREVIEW_COLOR_GREAT = new Color(120, 240, 120, 255); // ≥70%
const PREVIEW_COLOR_GOOD  = new Color(240, 220,  90, 255); // 40%~70%
const PREVIEW_COLOR_FAIR  = new Color(240, 160,  60, 255); // 20%~40%
const PREVIEW_COLOR_BAD   = new Color(240,  90,  90, 255); // <20%
// 黑色描边让浅色字在任意地形上都能看清
const PREVIEW_OUTLINE     = new Color(  0,   0,   0, 200);

/**
 * 2d6 之和 ≥ N 的精确概率（N 取 2..13；超出范围按边界处理）。
 * 36 种可能性下的累积分布，末位按百分比四舍五入展示。
 */
const HIT_PROB_GE: ReadonlyArray<number> = [
  /* 0 */ 1.000, 1.000,
  /* 2 */ 36 / 36,
  /* 3 */ 35 / 36,
  /* 4 */ 33 / 36,
  /* 5 */ 30 / 36,
  /* 6 */ 26 / 36,
  /* 7 */ 21 / 36,
  /* 8 */ 15 / 36,
  /* 9 */ 10 / 36,
  /* 10 */ 6 / 36,
  /* 11 */ 3 / 36,
  /* 12 */ 1 / 36,
  /* 13 */ 0,
];

@ccclass('BattleScene')
export class BattleScene extends Component {

  @property({ tooltip: '六角形单边长度（像素）。地图过大请调小，过小请调大。' })
  hexSize: number = 26;

  @property({ tooltip: '任务 JSON 在 resources/ 下的相对路径，无需扩展名。' })
  missionPath: string = 'missions/mission_01';

  @property({ tooltip: '是否在谢尔曼周围高亮可移动的相邻格' })
  showReachable: boolean = true;

  @property({ tooltip: '谢尔曼移动一格的动画时长（秒）' })
  moveDuration: number = 0.28;

  @property({ tooltip: '玩家每回合的最大移动格数（手册：坦克满速 2 格/回合）' })
  movesPerTurn: number = 2;

  @property({ tooltip: '玩家每回合的攻击次数（手册原版是骰子驱动，这里简化为固定 1 次）' })
  attacksPerTurn: number = 1;

  @property({ tooltip: '战斗随机种子；留 0 用时间种子，非 0 便于复现' })
  rngSeed: number = 0;

  private g: Graphics | null = null;
  private mapNode: Node | null = null;
  private mission: LoadedMission | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private anim: MoveAnim | null = null;

  // 回合状态
  private turn: number = 1;
  private movesLeft: number = 0;
  private attacksLeft: number = 0;
  private phase: Phase = 'player';
  // 敌方阶段调度：当前正在行动的敌人下标 + 该敌剩余预算
  private enemyIndex: number = 0;
  private enemyBudget: number = 0;
  // 战斗 / 胜负
  private rng: RNG = new RNG(1);
  private outcome: MissionOutcome = 'ongoing';
  private outcomeLabel: Label | null = null;
  private restartBtn: Node | null = null;
  // 战报浮字池：挂在 mapNode 下，随 update() 上浮 + 渐隐自毁
  private floaters: Floater[] = [];
  // 命中预览 Label 池：常驻显示，随 redraw 整批重建
  private previewLabels: Node[] = [];
  // 单位状态文字池（起火 / 已毁）：随 redraw 整批重建
  private statusLabels: Node[] = [];

  // HUD
  private hudLabel: Label | null = null;
  private endTurnBtn: Node | null = null;
  private endTurnBg: Graphics | null = null;

  // 存档/读档
  private missionId: string = '';

  onLoad() {
    // 把 battle 节点提到 Canvas 兄弟列表最末（=渲染最上层），
    // 避免被同 Canvas 的其他 UI 元素（SpriteSplash / 登录 等）遮挡。
    const parentNode = this.node.parent;
    if (parentNode) {
      this.node.setSiblingIndex(parentNode.children.length - 1);
    }

    // 自动创建子 Graphics 节点，免去编辑器手动配置
    const gNode = new Node('MapGraphics');
    // UI Graphics 必须在 UI_2D 层才会被 Canvas 的 UI 相机渲染。
    // new Node() 默认 layer 是 DEFAULT (1<<30)，会被 UI 相机过滤掉。
    gNode.layer = this.node.layer;
    const ut = gNode.addComponent(UITransform);
    ut.setContentSize(1280, 720);
    this.g = gNode.addComponent(Graphics);
    this.g.lineWidth = 2;
    this.node.addChild(gNode);
    this.mapNode = gNode;

    // 注册触摸事件（点击地图任意位置）
    gNode.on(Node.EventType.TOUCH_END, this.onTouchMap, this);

    // HUD：回合数 + 行动力 + 结束回合按钮
    this.buildHUD();

    // 从 resources/ 加载任务 JSON（注意：路径不含扩展名）
    resources.load(this.missionPath, JsonAsset, (err, asset) => {
      if (err || !asset) {
        console.error('[BattleScene] 加载任务失败:', this.missionPath, err);
        return;
      }
      this.loadAndDraw(asset.json as MissionData);
    });
  }

  // ---------- 状态 ----------

  private loadAndDraw(data: MissionData) {
    this.missionId = data.id;
    this.mission = loadMission(data);
    const tiles = this.mission.map.all();

    // 计算地图像素包围盒，用于居中
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      const p = axialToPixel(t.pos, this.hexSize);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.offsetX = -(minX + maxX) / 2;
    // Cocos Y 朝上，但我们希望 row 0 在屏幕顶部 → Y 取负
    this.offsetY = (minY + maxY) / 2;

    // 初始化回合状态
    this.turn = 1;
    this.phase = 'player';
    this.movesLeft = this.movesPerTurn;
    this.attacksLeft = this.attacksPerTurn;
    this.outcome = 'ongoing';
    this.rng = new RNG(this.rngSeed || undefined);
    this.clearFloaters();
    this.updateHUD();
    this.updateOutcomeOverlay();

    this.redraw();
    console.log(
      `[BattleScene] 任务加载成功: ${data.name}, ${tiles.length} 格, ` +
      `1 + ${this.mission.enemies.length} 个单位`
    );
  }

  private project(q: number, r: number) {
    const p = axialToPixel({ q, r }, this.hexSize);
    return { x: p.x + this.offsetX, y: -p.y + this.offsetY };
  }

  // ---------- 绘制 ----------

  private redraw() {
    if (!this.g || !this.mission) return;
    const g = this.g;
    g.clear();
    // 命中预览 Label 是常驻节点（非纯 Graphics），需要随每次重绘整批重建，
    // 否则谢尔曼移动后旧位置的预览会留在屏幕上误导玩家。
    this.clearPreviewLabels();

    const { map, sherman, enemies } = this.mission;
    const tiles = map.all();

    // 1. 地形格
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      this.drawHex(c.x, c.y, this.hexSize, TERRAIN_COLORS[t.terrain]);
    }

    // 2. 树篱
    for (const t of tiles) {
      if (!t.hedges) continue;
      const c = this.project(t.pos.q, t.pos.r);
      for (let i = 0; i < 6; i++) {
        if (t.hedges[i]) this.drawHedgeEdge(c.x, c.y, this.hexSize, i);
      }
    }

    // 3. 可移动高亮（仅玩家阶段、未在动画时显示）
    if (this.showReachable && !this.anim && this.phase === 'player' && this.outcome === 'ongoing') {
      this.drawReachableHighlights();
    }

    // 4. 可攻击目标高亮（同条件 + 还有攻击次数）
    if (!this.anim && this.phase === 'player'
        && this.outcome === 'ongoing' && this.attacksLeft > 0) {
      this.drawAttackableHighlights();
    }

    // 5. 单位 —— 正在动画的那个用插值像素坐标，其余用本格坐标
    this.drawUnitMaybeAnim(sherman);
    for (const e of enemies) this.drawUnitMaybeAnim(e);

    // 6. 单位状态常驻文字（起火 / 已毁），整批重建
    this.clearStatusLabels();
    this.spawnStatusLabelIfAny(sherman);
    for (const e of enemies) this.spawnStatusLabelIfAny(e);
  }

  private drawAttackableHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    for (const e of enemies) {
      if (e.destroyed) continue;
      const ctx = { attacker: sherman, target: e, map };
      if (!canAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      this.g.strokeColor = ATTACKABLE_COLOR;
      this.g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 3);

      // 命中预览：≥需要值 + 命中概率
      const need = hitThreshold(ctx);
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.7, need);
    }
    this.g.lineWidth = 2;
  }

  /** 命中概率分档配色：成功率越高越绿，越低越红 */
  private previewColor(prob: number): Color {
    if (prob >= 0.7)  return PREVIEW_COLOR_GREAT;
    if (prob >= 0.4)  return PREVIEW_COLOR_GOOD;
    if (prob >= 0.2)  return PREVIEW_COLOR_FAIR;
    return PREVIEW_COLOR_BAD;
  }

  /** 在地图上某像素点生成一条"≥N\n##%"的命中预览 Label。 */
  private spawnPreviewLabel(x: number, y: number, need: number) {
    if (!this.mapNode) return;
    const idx = Math.max(0, Math.min(13, need));
    const prob = HIT_PROB_GE[idx];
    const color = this.previewColor(prob);

    const n = new Node('AttackPreview');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(80, 40);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = 18;
    l.lineHeight = 20;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    if (prob <= 0) {
      l.string = `≥${need}\n几乎不可能`;
      l.fontSize = 14;
    } else {
      l.string = `≥${need}\n${Math.round(prob * 100)}%`;
    }

    // 加描边让字在任何底色上都清晰
    l.enableOutline = true;
    l.outlineColor = PREVIEW_OUTLINE;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    n.setPosition(x, y, 0);
    this.previewLabels.push(n);
  }

  private clearPreviewLabels() {
    for (const n of this.previewLabels) n.destroy();
    this.previewLabels.length = 0;
  }

  // ---------- 单位状态常驻文字 ----------

  /** 给"起火/已毁"的单位在格子下方挂一条短文字，整批生成、整批销毁。 */
  private spawnStatusLabelIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!u.damaged && !u.destroyed) return;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const text = u.destroyed ? '已毁' : '起火';
    const color = u.destroyed ? STATUS_TEXT_DEAD : STATUS_TEXT_FIRE;

    const n = new Node('StatusLabel');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(80, 24);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = 18;
    l.lineHeight = 20;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;
    l.enableOutline = true;
    l.outlineColor = STATUS_TEXT_OUT;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    n.setPosition(c.x, c.y - this.hexSize * 0.65, 0);
    this.statusLabels.push(n);
  }

  private clearStatusLabels() {
    for (const n of this.statusLabels) n.destroy();
    this.statusLabels.length = 0;
  }

  /** 单位若正在动画，返回插值像素位置；否则等价 project(u.pos)。给状态文字定位用。 */
  private interpolatedPos(u: Unit): { x: number; y: number } {
    if (!this.anim || this.anim.unit !== u) return this.project(u.pos.q, u.pos.r);
    const k = easeOutCubic(this.anim.t);
    const a = this.project(this.anim.fromQ, this.anim.fromR);
    const b = this.project(this.anim.toQ, this.anim.toR);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  // ---------- 战报浮字 ----------

  /** 在目标格上方生成一条短暂浮字（MISS/HIT/受损/击毁）。 */
  private spawnFloater(
    atQ: number, atR: number,
    text: string, color: Color,
    opts?: { size?: number; dur?: number; rise?: number },
  ) {
    if (!this.mapNode) return;
    const pixel = this.project(atQ, atR);
    const startY = pixel.y + this.hexSize * 0.55;

    const n = new Node('Floater');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const size = opts?.size ?? 34;
    ut.setContentSize(160, size + 6);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.color = new Color(color.r, color.g, color.b, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;

    this.mapNode.addChild(n);
    n.setPosition(pixel.x, startY, 0);

    this.floaters.push({
      node: n,
      label: l,
      baseR: color.r,
      baseG: color.g,
      baseB: color.b,
      baseX: pixel.x,
      baseY: startY,
      t: 0,
      dur: opts?.dur ?? 1.1,
      rise: opts?.rise ?? 42,
    });
  }

  private advanceFloaters(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const p = Math.min(f.t / f.dur, 1);
      // 位置：匀速上浮
      f.node.setPosition(f.baseX, f.baseY + f.rise * p, 0);
      // 透明度：前 30% 全显，后 70% 线性淡出
      const alphaNorm = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7;
      const alpha = Math.max(0, Math.min(255, Math.round(alphaNorm * 255)));
      f.label.color = new Color(f.baseR, f.baseG, f.baseB, alpha);
      if (p >= 1) {
        f.node.destroy();
        this.floaters.splice(i, 1);
      }
    }
  }

  /** 清空所有浮字（切换任务或读档时调用） */
  private clearFloaters() {
    for (const f of this.floaters) f.node.destroy();
    this.floaters.length = 0;
  }

  /** 同一接口画任意单位：若该单位正是当前动画对象，使用插值位置 */
  private drawUnitMaybeAnim(u: Unit) {
    if (this.anim && this.anim.unit === u) {
      const k = easeOutCubic(this.anim.t);
      const a = this.project(this.anim.fromQ, this.anim.fromR);
      const b = this.project(this.anim.toQ, this.anim.toR);
      this.drawUnit(u, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    } else {
      this.drawUnit(u);
    }
  }

  update(dt: number) {
    // 浮字和移动动画独立推进：读档/胜负已决时也要让残留浮字自然淡出
    if (this.floaters.length > 0) this.advanceFloaters(dt);

    if (!this.anim || !this.mission) return;
    this.anim.t += dt / this.anim.dur;
    if (this.anim.t < 1) {
      this.redraw();
      return;
    }
    // 动画结束：把数据真正落到目标格，清空状态
    const finishedUnit = this.anim.unit;
    finishedUnit.pos = { q: this.anim.toQ, r: this.anim.toR };
    this.anim = null;
    this.redraw();
    console.log(
      `[BattleScene] ${finishedUnit.kind} 到达 (q=${finishedUnit.pos.q}, r=${finishedUnit.pos.r})`
    );
    // 若处于敌方阶段，紧接着调度下一步
    if (this.phase === 'enemy') this.runNextEnemyStep();
  }

  private drawReachableHighlights() {
    if (!this.g || !this.mission) return;
    if (this.movesLeft <= 0) return; // 行动力耗尽，不再提示可走格
    const { map, sherman, enemies } = this.mission;
    // 摧毁的单位视作"残骸"，不阻挡移动
    const occupied = new Set(
      enemies.filter(e => !e.destroyed).map(e => `${e.pos.q},${e.pos.r}`)
    );

    for (const n of neighbors(sherman.pos)) {
      const tile = map.get(n);
      if (!tile) continue;
      if (!map.canTankEnter(n)) continue;
      if (occupied.has(`${n.q},${n.r}`)) continue;
      const cost = terrainMoveCost(tile.terrain);
      if (cost > this.movesLeft) continue; // 行动力不够，不画

      const c = this.project(n.q, n.r);
      const color = cost === 1 ? REACHABLE_CHEAP : REACHABLE_COSTLY;
      this.g.strokeColor = color;
      this.g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 3);
      this.drawCostPips(c.x, c.y, cost, color);
    }
    this.g.lineWidth = 2;
  }

  /** 在格子上方画 cost 个小圆点，让玩家一眼看到这格"几点行动力"。 */
  private drawCostPips(cx: number, cy: number, cost: number, color: Color) {
    const g = this.g!;
    const r = this.hexSize * 0.11;
    const gap = this.hexSize * 0.32;
    const startX = cx - (gap * (cost - 1)) / 2;
    const y = cy + this.hexSize * 0.42; // 上方约 4/10 处
    g.fillColor = color;
    for (let i = 0; i < cost; i++) {
      g.circle(startX + i * gap, y, r);
      g.fill();
    }
  }

  /** 实心六边形 */
  private drawHex(cx: number, cy: number, size: number, fill: Color) {
    const g = this.g!;
    g.fillColor = fill;
    g.strokeColor = TILE_BORDER;
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.fill();
    g.stroke();
  }

  /** 仅描边的六边形（用于高亮） */
  private drawHexOutline(cx: number, cy: number, size: number) {
    const g = this.g!;
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.stroke();
  }

  /** 第 dir 条边的树篱 */
  private drawHedgeEdge(cx: number, cy: number, size: number, dir: number) {
    const g = this.g!;
    const a1 = (-30 + 60 * (dir)) * Math.PI / 180;
    const a2 = (-30 + 60 * (dir + 1)) * Math.PI / 180;
    g.strokeColor = HEDGE_COLOR;
    g.lineWidth = 5;
    g.moveTo(cx + size * Math.cos(a1), cy + size * Math.sin(a1));
    g.lineTo(cx + size * Math.cos(a2), cy + size * Math.sin(a2));
    g.stroke();
    g.lineWidth = 2;
  }

  /** 单位：圆 + 朝向短线。可传 overrideX/Y 以画在动画插值位置。 */
  private drawUnit(u: Unit, overrideX?: number, overrideY?: number) {
    const g = this.g!;
    const c = overrideX !== undefined && overrideY !== undefined
      ? { x: overrideX, y: overrideY }
      : this.project(u.pos.q, u.pos.r);
    const r = this.hexSize * 0.5;

    // 摧毁：暗灰色 + 穿心 X
    if (u.destroyed) {
      g.fillColor = DESTROYED_FILL;
      g.strokeColor = DESTROYED_BORDER;
      g.lineWidth = 2;
      g.circle(c.x, c.y, r);
      g.fill();
      g.stroke();
      g.strokeColor = DESTROYED_BORDER;
      g.lineWidth = 3;
      const d = r * 0.8;
      g.moveTo(c.x - d, c.y - d); g.lineTo(c.x + d, c.y + d); g.stroke();
      g.moveTo(c.x - d, c.y + d); g.lineTo(c.x + d, c.y - d); g.stroke();
      g.lineWidth = 2;
      return; // 摧毁的单位不再画朝向线
    }

    // 起火：鲜橙填充 + 亮黄边 + 外层橙红环（保留阵营辨识度时仍以"危险色"为主）
    if (u.damaged) {
      g.fillColor = ONFIRE_FILL;
      g.strokeColor = ONFIRE_BORDER;
      g.lineWidth = 3;
      g.circle(c.x, c.y, r);
      g.fill();
      g.stroke();
      // 外层橙红环（半透明），制造"火苗外沿"感
      g.strokeColor = ONFIRE_RING_OUT;
      g.lineWidth = 4;
      g.circle(c.x, c.y, r + 5);
      g.stroke();
      g.lineWidth = 2;
    } else {
      g.fillColor = FACTION_COLORS[u.faction];
      g.strokeColor = UNIT_BORDER;
      g.lineWidth = 2;
      g.circle(c.x, c.y, r);
      g.fill();
      g.stroke();
    }

    if (u.facing !== null) {
      // 用"邻居中心 - 自身中心"得到屏幕方向，避免手算 Y 轴翻转
      const np = this.project(neighbor(u.pos, u.facing).q, neighbor(u.pos, u.facing).r);
      const dx = np.x - c.x;
      const dy = np.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      g.strokeColor = FACING_COLOR;
      g.lineWidth = 4;
      g.moveTo(c.x, c.y);
      g.lineTo(c.x + ux * r * 1.1, c.y + uy * r * 1.1);
      g.stroke();
      g.lineWidth = 2;
    }
  }

  // ---------- HUD ----------

  /** 一次性创建 HUD：左上角状态 Label + 右下角"结束回合"按钮。无需任何美术资源。 */
  private buildHUD() {
    // ---- 左上角状态 Label ----
    const labelNode = new Node('HUDLabel');
    labelNode.layer = this.node.layer;
    const lUT = labelNode.addComponent(UITransform);
    lUT.setContentSize(420, 60);
    lUT.setAnchorPoint(0, 1); // 锚点在左上，方便对齐屏幕角
    const label = labelNode.addComponent(Label);
    label.fontSize = 26;
    label.lineHeight = 30;
    label.color = HUD_TEXT_COLOR;
    label.horizontalAlign = HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.TOP;
    label.string = '回合 - | 行动力 -/-';
    // Canvas 1280x720，左上角对应 (-640, 360)，再留 16px 边距
    labelNode.setPosition(-624, 344, 0);
    this.node.addChild(labelNode);
    this.hudLabel = label;

    // ---- 右下角"结束回合"按钮 ----
    const btn = new Node('EndTurnButton');
    btn.layer = this.node.layer;
    const bUT = btn.addComponent(UITransform);
    const BTN_W = 180, BTN_H = 60;
    bUT.setContentSize(BTN_W, BTN_H);
    bUT.setAnchorPoint(0.5, 0.5);
    // 右下角 (640, -360)，往内收 110/40 让按钮不贴边
    btn.setPosition(640 - BTN_W / 2 - 20, -360 + BTN_H / 2 + 20, 0);

    // 背景 Graphics（直接挂在 btn 上）
    const bg = btn.addComponent(Graphics);
    this.endTurnBg = bg;
    this.drawEndTurnBg(false);

    // 文字 Label 作为子节点，自动叠在背景之上
    const txtNode = new Node('Label');
    txtNode.layer = this.node.layer;
    const tUT = txtNode.addComponent(UITransform);
    tUT.setContentSize(BTN_W, BTN_H);
    const txt = txtNode.addComponent(Label);
    txt.fontSize = 28;
    txt.lineHeight = 32;
    txt.color = HUD_TEXT_COLOR;
    txt.horizontalAlign = HorizontalTextAlignment.CENTER;
    txt.verticalAlign = VerticalTextAlignment.CENTER;
    txt.string = '结束回合';
    btn.addChild(txtNode);

    btn.on(Node.EventType.TOUCH_END, this.onEndTurn, this);
    this.node.addChild(btn);
    this.endTurnBtn = btn;

    // ---- 右上角"存档 / 读档"按钮 ----
    // 放在右上角而非底部，视觉上和"战局操作"（结束回合）分区：上=元操作，下=回合内行动
    this.makeSimpleButton('SaveBtn', '存档',
      640 - 70 - 16, 360 - 24 - 16,
      new Color(60, 120, 80, 230),
      () => this.onSave());
    this.makeSimpleButton('LoadBtn', '读档',
      640 - 70 - 16 - 140 - 10, 360 - 24 - 16,
      new Color(80, 60, 130, 230),
      () => this.onLoad_Save());
  }

  /** 简版按钮工厂：静态背景色，无状态切换，比结束回合按钮简单。 */
  private makeSimpleButton(
    name: string,
    text: string,
    x: number, y: number,
    bgColor: Color,
    onClick: () => void,
  ): Node {
    const W = 140, H = 48;
    const btn = new Node(name);
    btn.layer = this.node.layer;
    const bUT = btn.addComponent(UITransform);
    bUT.setContentSize(W, H);
    bUT.setAnchorPoint(0.5, 0.5);
    btn.setPosition(x, y, 0);

    const bg = btn.addComponent(Graphics);
    bg.fillColor = bgColor;
    bg.strokeColor = BTN_BORDER;
    bg.lineWidth = 2;
    bg.rect(-W / 2, -H / 2, W, H);
    bg.fill();
    bg.stroke();

    const txtNode = new Node('Label');
    txtNode.layer = this.node.layer;
    txtNode.addComponent(UITransform).setContentSize(W, H);
    const txt = txtNode.addComponent(Label);
    txt.fontSize = 24;
    txt.lineHeight = 28;
    txt.color = HUD_TEXT_COLOR;
    txt.horizontalAlign = HorizontalTextAlignment.CENTER;
    txt.verticalAlign = VerticalTextAlignment.CENTER;
    txt.string = text;
    btn.addChild(txtNode);

    btn.on(Node.EventType.TOUCH_END, onClick, this);
    this.node.addChild(btn);
    return btn;
  }

  /** 绘制结束回合按钮的背景。urgent=true 时换提醒色。 */
  private drawEndTurnBg(urgent: boolean) {
    if (!this.endTurnBg) return;
    const g = this.endTurnBg;
    g.clear();
    g.fillColor = urgent ? BTN_BG_URGENT : BTN_BG_NORMAL;
    g.strokeColor = BTN_BORDER;
    g.lineWidth = 2;
    // 锚点 0.5 → 矩形围绕原点
    g.rect(-90, -30, 180, 60);
    g.fill();
    g.stroke();
  }

  private updateHUD() {
    if (this.hudLabel) {
      this.hudLabel.string = this.phase === 'player'
        ? `回合 ${this.turn} | 玩家 | 移动 ${this.movesLeft}/${this.movesPerTurn} | 攻击 ${this.attacksLeft}/${this.attacksPerTurn}`
        : `回合 ${this.turn} | 敌方行动中...`;
    }
    // 玩家阶段，且"既无移动也无攻击"才亮红；其它情况蓝色
    const urgent = this.phase === 'player' && this.movesLeft <= 0 && this.attacksLeft <= 0;
    this.drawEndTurnBg(urgent);
  }

  /** 胜负覆盖层：懒创建，仅在 outcome 非 ongoing 时显示，并联动"再来一局"按钮的可见性 */
  private updateOutcomeOverlay() {
    if (this.outcome === 'ongoing') {
      if (this.outcomeLabel) this.outcomeLabel.node.active = false;
      if (this.restartBtn) this.restartBtn.active = false;
      return;
    }
    if (!this.outcomeLabel) {
      const n = new Node('OutcomeLabel');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(600, 120);
      ut.setAnchorPoint(0.5, 0.5);
      n.setPosition(0, 0, 0);
      const l = n.addComponent(Label);
      l.fontSize = 72;
      l.lineHeight = 84;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      this.node.addChild(n);
      this.outcomeLabel = l;
    }
    this.outcomeLabel.node.active = true;
    if (this.outcome === 'victory') {
      this.outcomeLabel.string = '胜利！';
      this.outcomeLabel.color = new Color(255, 230, 80, 255);
    } else {
      this.outcomeLabel.string = '战败';
      this.outcomeLabel.color = new Color(255, 80, 80, 255);
    }

    // "再来一局"按钮：放在标题正下方
    if (!this.restartBtn) {
      this.restartBtn = this.makeSimpleButton(
        'RestartBtn', '再来一局',
        0, -90,
        BTN_BG_NORMAL,
        () => this.restartMission(),
      );
    }
    this.restartBtn.active = true;
    // 保证按钮在最上层（避免被后续 redraw 创建的浮字 / 状态文字盖住的视觉印象）
    this.restartBtn.setSiblingIndex(this.node.children.length - 1);
  }

  /**
   * 重开当前任务：丢弃 mission 引用并用同一份 MissionData 重新走 loadAndDraw，
   * 这样所有 Unit 都会被 makeUnit 重新构造（damaged/destroyed 自然为 undefined）。
   * 同时清干净动画 / 敌方调度残留状态，避免上一局尾巴串到下一局。
   */
  private restartMission() {
    if (!this.mission) return;
    const data = this.mission.data;
    // 中断动画与敌方阶段调度，丢弃所有过场视觉
    this.anim = null;
    this.enemyIndex = 0;
    this.enemyBudget = 0;
    this.clearFloaters();
    // 隐藏胜负覆盖层与按钮（loadAndDraw 内部 updateOutcomeOverlay 也会再做一次保险）
    if (this.outcomeLabel) this.outcomeLabel.node.active = false;
    if (this.restartBtn) this.restartBtn.active = false;
    this.loadAndDraw(data);
    console.log('[BattleScene] === 重开当前任务 ===');
  }

  private onEndTurn() {
    if (this.anim) return;            // 动画途中不允许结束回合
    if (this.phase !== 'player') return; // 敌方阶段按钮失灵
    if (this.outcome !== 'ongoing') return; // 胜负已决
    this.phase = 'enemy';
    this.enemyIndex = 0;
    this.enemyBudget = this.movesPerTurn;
    this.updateHUD();
    this.redraw();
    console.log(`[BattleScene] === 回合 ${this.turn} 敌方阶段开始 ===`);
    this.runNextEnemyStep();
  }

  // ---------- 存档 / 读档 ----------

  private onSave() {
    if (!this.mission) return;
    // 仅在玩家阶段且无动画时存档，避免保存到"敌方行动到一半"这种半态
    if (this.anim || this.phase !== 'player') {
      console.log('[Save] 当前不可存档：仅玩家阶段且无动画时允许');
      return;
    }
    const data = captureSave({
      missionId: this.missionId,
      mission: this.mission,
      turn: this.turn,
      phase: this.phase,
      movesLeft: this.movesLeft,
      attacksLeft: this.attacksLeft,
    });
    try {
      sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      console.log(`[Save] 已存档：回合 ${data.turn}, 行动力 ${data.movesLeft}`);
    } catch (e) {
      console.error('[Save] 写入失败:', e);
    }
  }

  private onLoad_Save() {
    if (!this.mission) return;
    if (this.anim) {
      console.log('[Load] 动画进行中，稍后再试');
      return;
    }
    const raw = sys.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      console.log('[Load] 无存档');
      return;
    }
    let save: SaveData;
    try {
      save = JSON.parse(raw);
    } catch (e) {
      console.error('[Load] 存档损坏:', e);
      return;
    }
    const result = applySave(this.mission, this.missionId, save);
    if (!result.ok) {
      console.warn('[Load] 读档失败:', result.reason);
      return;
    }
    // 写回场景状态；中断任何敌方阶段调度
    this.turn = result.turn!;
    this.phase = result.phase!;
    this.movesLeft = result.movesLeft!;
    this.attacksLeft = result.attacksLeft ?? this.attacksPerTurn;
    this.enemyIndex = 0;
    this.enemyBudget = 0;
    this.anim = null;          // 若在动画中点读档，直接丢弃动画状态
    this.clearFloaters();
    // 胜负状态也要随读档重新判定
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    this.updateHUD();
    this.redraw();
    console.log(`[Load] 已读档：回合 ${this.turn}, 移动 ${this.movesLeft}, 攻击 ${this.attacksLeft}`);
  }

  /**
   * 敌方阶段调度核心：循环跳过没有合法落点的敌人，直到找到一个能动的，
   * 启动它的动画并 return 等待 update 回调；若所有敌人都动完，进入下回合。
   *
   * 用循环 + 提前 return 而不是递归，是为了避免"所有敌人都不动"时栈累积。
   */
  private runNextEnemyStep() {
    if (!this.mission) return;
    const { enemies, sherman, map } = this.mission;

    while (true) {
      if (this.enemyIndex >= enemies.length) {
        this.endEnemyPhase();
        return;
      }
      const enemy = enemies[this.enemyIndex];

      // 摧毁的敌人不动也不打
      if (enemy.destroyed) {
        this.enemyIndex++;
        this.enemyBudget = this.movesPerTurn;
        continue;
      }

      // 当前敌人预算用完 → 开火 → 切下一个
      if (this.enemyBudget <= 0) {
        this.tryEnemyAttack(enemy);
        if (this.outcome !== 'ongoing') return; // 战败：立刻停止后续敌人调度
        this.enemyIndex++;
        this.enemyBudget = this.movesPerTurn;
        continue;
      }

      // 摧毁的敌人不算占格障碍（残骸可被碾过）
      const others = enemies.filter(e => e !== enemy && !e.destroyed);
      const decision = decideEnemyMove(enemy, sherman, map, others, this.enemyBudget);
      if (!decision) {
        // 走不动了（或第一格就在最优位置）→ 直接开火，再切下一个
        this.tryEnemyAttack(enemy);
        if (this.outcome !== 'ongoing') return;
        this.enemyIndex++;
        this.enemyBudget = this.movesPerTurn;
        continue;
      }

      // 启动敌人移动动画
      const dir = directionTo(enemy.pos, decision.to);
      if (dir !== null) enemy.facing = dir;
      this.enemyBudget -= decision.cost;
      this.anim = {
        unit: enemy,
        fromQ: enemy.pos.q,
        fromR: enemy.pos.r,
        toQ: decision.to.q,
        toR: decision.to.r,
        t: 0,
        dur: Math.max(0.05, this.moveDuration),
      };
      this.redraw();
      return; // 让 update() 在动画结束时再次调度
    }
  }

  private endEnemyPhase() {
    this.turn += 1;
    this.movesLeft = this.movesPerTurn;
    this.attacksLeft = this.attacksPerTurn;
    this.phase = 'player';
    // 敌方阶段也可能击毁谢尔曼（未来）；重入玩家回合时复查胜负
    if (this.mission) {
      this.outcome = checkOutcome(this.mission);
      this.updateOutcomeOverlay();
    }
    this.updateHUD();
    this.redraw();
    console.log(`[BattleScene] === 进入回合 ${this.turn}（玩家） ===`);
  }

  // ---------- 交互 ----------

  private onTouchMap(event: EventTouch) {
    if (!this.mission || !this.mapNode) return;
    if (this.anim) return;             // 动画期间不接受新指令
    if (this.phase !== 'player') return; // 敌方回合不响应点击
    if (this.outcome !== 'ongoing') return; // 胜负已决，不再响应
    const ut = this.mapNode.getComponent(UITransform);
    if (!ut) return;

    // UI 触点 → MapGraphics 局部坐标
    const uiPos = event.getUILocation();
    const localPos = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));

    // 找到离触点最近的格
    const tiles = this.mission.map.all();
    let target: Tile | null = null;
    let minDist = Infinity;
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      const d = Math.hypot(c.x - localPos.x, c.y - localPos.y);
      if (d < minDist) { minDist = d; target = t; }
    }
    if (!target || minDist > this.hexSize) return; // 点空白处

    // 命中格上有活着的敌人 → 攻击意图；否则 → 移动意图
    const enemyOnTile = this.mission.enemies.find(
      e => !e.destroyed && e.pos.q === target!.pos.q && e.pos.r === target!.pos.r
    );
    if (enemyOnTile) {
      this.tryAttack(enemyOnTile);
    } else {
      this.tryMoveSherman(target);
    }
  }

  private tryAttack(target: Unit) {
    if (!this.mission) return;
    const { map, sherman } = this.mission;

    if (this.attacksLeft <= 0) {
      console.log('[Combat] 本回合已无攻击次数');
      return;
    }
    const check = canAttack({ attacker: sherman, target, map });
    if (!check.ok) {
      console.log(`[Combat] 无法攻击: ${check.reason}`);
      // 玩家点到一个"其实打不到"的敌人（比如偏出六向直线 / 被树遮挡），给一条
      // 从射击者向上飘的浮字，免得玩家以为点击没响应。
      const msg = check.reason === '非六向直线' ? '需在六向直线上' : (check.reason ?? '无法攻击');
      const warnColor = new Color(255, 120, 120, 255);
      this.spawnFloater(sherman.pos.q, sherman.pos.r, msg, warnColor, { size: 22, dur: 0.9, rise: 24 });
      return;
    }

    const report = resolveAttack({ attacker: sherman, target, map }, this.rng);
    this.attacksLeft -= 1;
    this.presentAttackResult('玩家', report, sherman, target);
    this.updateHUD();
  }

  /**
   * 敌方在结束自身移动子阶段时尝试朝谢尔曼开火（每个敌人 1 发/回合）。
   * 已摧毁、无视线、不可达均会被 canAttack 过滤掉，安全调用。
   */
  private tryEnemyAttack(enemy: Unit) {
    if (!this.mission) return;
    if (enemy.destroyed) return;
    if (this.outcome !== 'ongoing') return; // 谢尔曼已死，无需再补刀
    const { map, sherman } = this.mission;
    if (!canAttack({ attacker: enemy, target: sherman, map }).ok) return;

    // 开火前转向目标，否则可能用错装甲面（其实算的是 sherman 的面，但视觉上敌人面对玩家更合理）
    enemy.facing = approximateDirection(enemy.pos, sherman.pos);

    const report = resolveAttack({ attacker: enemy, target: sherman, map }, this.rng);
    this.presentAttackResult(`敌方 ${enemy.kind}`, report, enemy, sherman);
  }

  /**
   * 攻击结算后的统一展示：console 日志 + 目标格上方浮字 + 重绘 + 胜负判定。
   * 玩家与敌方都走这条路径，确保战报格式与 UI 反馈一致。
   */
  private presentAttackResult(actor: string, report: AttackReport, attacker: Unit, target: Unit) {
    if (!this.mission) return;
    const base = `[Combat] ${actor} 2d6=${report.dice[0]}+${report.dice[1]}=${report.roll} 需要${report.threshold}`;
    let text: string;
    let color: Color;
    let size: number;
    if (!report.hit) {
      console.log(`${base} → 未命中`);
      text = 'MISS'; color = new Color(230, 230, 230, 255); size = 32;
    } else {
      // armor/face 仅作战报展示，MVP 下不再决定伤害进度
      const armorInfo = `命中 ${report.armorFace}面 (装甲${report.armor} / 穿甲${report.penetration})`;
      if (report.statusChange === 'damaged') {
        console.log(`${base} → ${armorInfo} → ${target.kind} 起火`);
        text = '起火'; color = new Color(255, 170, 40, 255); size = 42;
      } else {
        // statusChange === 'destroyed'
        console.log(`${base} → ${armorInfo} → ${target.kind} 已毁`);
        text = '击毁'; color = new Color(255, 60, 60, 255); size = 50;
      }
    }
    this.spawnFloater(target.pos.q, target.pos.r, text, color, { size });
    this.redraw();

    this.outcome = checkOutcome(this.mission);
    if (this.outcome !== 'ongoing') {
      this.updateOutcomeOverlay();
    }
  }

  private tryMoveSherman(target: Tile) {
    if (!this.mission) return;
    const { map, sherman, enemies } = this.mission;

    // 校验 0：行动力（最早拒绝，避免后续无谓计算）
    if (this.movesLeft <= 0) {
      console.log('[BattleScene] 行动力已用尽，请点击右下角"结束回合"');
      return;
    }

    // 校验 1：相邻
    const dist = hexDistance(sherman.pos, target.pos);
    if (dist === 0) {
      console.log('[BattleScene] 这里就是当前格');
      return;
    }
    if (dist !== 1) {
      console.log(`[BattleScene] 不可移动: 距离 ${dist} 格（只能移动到相邻格）`);
      return;
    }

    // 校验 2：地形可入
    if (!map.canTankEnter(target.pos)) {
      console.log(`[BattleScene] 不可移动: 地形 ${target.terrain} 坦克不可进入`);
      return;
    }

    // 校验 3：地形开销 ≤ 当前行动力
    const cost = terrainMoveCost(target.terrain);
    if (cost > this.movesLeft) {
      console.log(
        `[BattleScene] 不可移动: 进入 ${target.terrain} 需 ${cost} 行动力, 仅剩 ${this.movesLeft}`
      );
      return;
    }

    // 校验 4：无敌方占据
    const occupied = enemies.find(
      e => !e.destroyed && e.pos.q === target.pos.q && e.pos.r === target.pos.r
    );
    if (occupied) {
      console.log(`[BattleScene] 不可移动: 被 ${occupied.kind} 占据`);
      return;
    }

    // 通过 —— 朝向立即 snap（坦克转向→开车），位置交给动画
    const dir = directionTo(sherman.pos, target.pos);
    if (dir !== null) sherman.facing = dir;

    // 按地形开销扣行动力，刷新 HUD（位置等动画结束再落到数据）
    this.movesLeft -= cost;
    this.updateHUD();

    this.anim = {
      unit: sherman,
      fromQ: sherman.pos.q,
      fromR: sherman.pos.r,
      toQ: target.pos.q,
      toR: target.pos.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
    };
    // 立即重绘一次：让黄圈消失、朝向更新
    this.redraw();
  }
}
