/**
 * MainMenuScene —— 游戏主菜单（标题 / 继续游戏 / 12 关卡栅格 / 设置 / 说明）。
 *
 * 使用方式（见 docs/MainMenuSetup.md）：
 *   1. 在 `main.scene` 的 Canvas 下新建空节点（例如 "menu"）
 *   2. 把本脚本拖到该节点上（或 AddComponent → MainMenuScene）
 *   3. Build Settings 把 main.scene 设为启动场景，战斗场景名填到 `battleSceneName`
 *
 * 架构约定（与 BattleScene 一致，零美术资源）：
 *   - 全部 UI 用 Graphics + Label 动态构建，画布按 1280×720 设计
 *   - 文案走 i18n（`t('menu.*')` / `t('level.XX.title')`）
 *   - 关卡解锁 / 通关 / 音量 / 语言持久化到 `LevelDB.MenuProgress`
 *   - 跨场景状态通过 `GameSession` 传递，BattleScene 启动时读取
 *
 * 交互：
 *   - 继续游戏：读战斗存档 `SAVE_KEY`；无存档时按钮灰态
 *   - 关卡按钮：未解锁 / 已解锁 / 已通关 三态；点击后切战斗场景
 *   - 顶部 ⚙ / ?：弹出模态面板，点击 ✕ 或遮罩空白处关闭
 */

import {
  _decorator, Canvas, Color, Component, EventTouch, Graphics,
  HorizontalTextAlignment, Label, Layers, Mask, Node, ScrollView, UITransform,
  Vec3, VerticalTextAlignment, director,
} from 'cc';
import { getLang, setLang, t, LangCode } from '../core/Lang';
import { GameSession } from '../core/GameSession';
import { LEVELS, LevelMeta, MenuProgress } from '../core/LevelDB';
import { SAVE_KEY, SaveData } from '../core/SaveLoad';

const { ccclass, property } = _decorator;

// ---------- 设计尺寸 ----------
const CANVAS_W = 1280;
const CANVAS_H = 720;

// 按钮栅格（6 列 × 2 行）
const LEVEL_BTN_W = 140;
const LEVEL_BTN_H = 120;
const LEVEL_GRID_GAP_X = 24;
const LEVEL_GRID_GAP_Y = 24;
const LEVEL_GRID_START_X = -410; // 第一列中心 x
const LEVEL_GRID_START_Y = -30;  // 第一行中心 y

// ---------- 颜色（延续军事风） ----------
const BG_TOP          = new Color( 32,  46,  36, 255);
const BG_MID          = new Color( 22,  32,  26, 255);
const BG_BOTTOM       = new Color( 14,  20,  18, 255);

const TEXT_PRIMARY    = new Color(255, 255, 255, 255);
const TEXT_DISABLED   = new Color(150, 150, 150, 200);
const TEXT_OUTLINE    = new Color(  0,   0,   0, 220);
const TEXT_TITLE      = new Color(240, 215, 150, 255);
const TEXT_SUBTITLE   = new Color(180, 180, 180, 255);
const TEXT_STAR       = new Color(240, 200,  80, 255);
const TEXT_DIVIDER    = new Color(200, 220, 200, 255);

const BTN_CONTINUE         = new Color(170, 110,  50, 240);
const BTN_CONTINUE_HOVER   = new Color(195, 130,  65, 240);
const BTN_CONTINUE_DISABLE = new Color( 60,  60,  60, 180);

const BTN_LEVEL_UNLOCKED  = new Color( 70,  95,  70, 230);
const BTN_LEVEL_COMPLETED = new Color( 95, 135,  90, 230);
const BTN_LEVEL_LOCKED    = new Color( 50,  52,  56, 200);
const BTN_LEVEL_BORDER    = new Color(200, 200, 200, 220);

const ICON_BTN_BG         = new Color( 40,  50,  60, 220);
const ICON_BTN_BORDER     = new Color(200, 200, 200, 180);

const MENU_DIVIDER        = new Color(120, 150, 120, 200);

const MODAL_BACKDROP      = new Color(  0,   0,   0, 180);
const MODAL_PANEL_BG      = new Color( 34,  40,  54, 240);
const MODAL_PANEL_BORDER  = new Color(180, 180, 180, 220);
const MODAL_CLOSE_BG      = new Color(180,  60,  60, 240);

const SLIDER_TRACK        = new Color( 70,  80,  90, 255);
const SLIDER_FILL         = new Color(170, 110,  50, 255);
const SLIDER_THUMB        = new Color(240, 215, 150, 255);

const LANG_BTN_IDLE       = new Color( 60,  70,  80, 230);
const LANG_BTN_ACTIVE     = new Color(170, 110,  50, 240);
const LANG_BTN_ACTIVE_BD  = new Color(240, 215, 150, 255);

// ---------- 工具类型 ----------
interface ButtonRefs {
  node: Node;
  graphics: Graphics;
  label: Label | null;
  /** 重绘按钮底（支持 hover / pressed / disabled 状态切换）。
   *  opts.border=true 时加一圈外描边（关卡按钮用）。 */
  redraw: (color: Color, opts?: { border?: boolean }) => void;
}

@ccclass('MainMenuScene')
export class MainMenuScene extends Component {
  @property({ tooltip: '点击关卡后切换到的战斗场景名（需要在 Cocos Build Settings 里已登记）' })
  battleSceneName: string = 'changjing2';

  // UI 根
  private bgNode: Node | null = null;

  // 继续游戏按钮（需要 refresh 的组件）
  private continueBtn: ButtonRefs | null = null;
  private continueTitleLabel: Label | null = null;
  private continueSubLabel: Label | null = null;
  private continueEnabled: boolean = false;

  // 关卡按钮池（1..12，对应 LEVELS）
  private levelBtns: ButtonRefs[] = [];

  // 当前打开的模态；非 null 时主菜单点击被遮罩吞掉
  private modalRoot: Node | null = null;

  // 设置 UI 组件引用（只在设置模态打开时有效）
  private settingsRefs: {
    volumeFill: Graphics | null;
    volumeThumb: Node | null;
    volumeLabel: Label | null;
    langZhBtn: ButtonRefs | null;
    langEnBtn: ButtonRefs | null;
  } | null = null;

  onLoad() {
    // 兜底：如果用户把 menu 挂成了 Canvas 的兄弟节点（而非子节点），UI 相机看不到它。
    // 在这里自动找场景里的 Canvas 并 reparent 过去。
    // 注意：Cocos Creator 3.8 的 Component 上没有 getComponentInParent，得自己沿父链找。
    const canvasAncestor = findCanvasAncestor(this.node);
    if (!canvasAncestor) {
      const canvasNode = findFirstCanvasNode();
      if (canvasNode) {
        console.warn('[MainMenuScene] menu 不在 Canvas 下（parent=',
          this.node.parent ? this.node.parent.name : null,
          '），自动 reparent 到', canvasNode.name);
        this.node.setParent(canvasNode);
      } else {
        console.error('[MainMenuScene] 场景里找不到 Canvas 组件，UI 不会显示！');
      }
    }

    // 把 menu 根节点提到 Canvas 子节点列表最末，避免被其他 UI 遮挡
    const parentNode = this.node.parent;
    if (parentNode) this.node.setSiblingIndex(parentNode.children.length - 1);

    // Canvas 的 UI 相机只渲染 UI_2D 层。编辑器里新建空节点默认是 DEFAULT 层，
    // 会被过滤掉 → 黑屏。这里强制拉回 UI_2D 避免用户踩坑。
    this.node.layer = Layers.Enum.UI_2D;

    // 归零本地坐标：编辑器里把节点从场景根拖进 Canvas 时会保留世界坐标，
    // 本地位置会变成 (-640,-360) 让整个菜单跑到 Canvas 左下角。
    this.node.setPosition(0, 0, 0);

    // 每次进菜单读一次持久化语言，确保设置面板里切的语言已生效
    setLang(MenuProgress.load().lang);

    this.buildBackground();
    this.buildTitle();
    this.buildContinueButton();
    this.buildDivider();
    this.buildLevelGrid();
    this.buildTopIcons();
    this.buildVersion();

    this.refreshContinueButton();
    this.refreshLevelButtons();
  }

  // ================================================================
  // 背景：双段渐变（Graphics 画多条横条模拟）+ 顶部一条装饰线
  // ================================================================
  private buildBackground() {
    const n = new Node('MenuBG');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(CANVAS_W, CANVAS_H);
    n.setPosition(0, 0, 0);
    const g = n.addComponent(Graphics);

    // 把画布纵向分成 N 段，每段取 top/bottom 间插值颜色 —— 简易渐变
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      const tRatio = i / (STEPS - 1);
      const c = tRatio < 0.5
        ? lerp(BG_TOP, BG_MID, tRatio * 2)
        : lerp(BG_MID, BG_BOTTOM, (tRatio - 0.5) * 2);
      const y = CANVAS_H / 2 - (i + 1) * (CANVAS_H / STEPS);
      g.fillColor = c;
      g.rect(-CANVAS_W / 2, y, CANVAS_W, CANVAS_H / STEPS + 1);
      g.fill();
    }

    // 装饰线条：顶部 + 底部各一条橄榄绿
    g.strokeColor = MENU_DIVIDER;
    g.lineWidth = 1;
    g.moveTo(-CANVAS_W / 2 + 60, CANVAS_H / 2 - 80);
    g.lineTo( CANVAS_W / 2 - 60, CANVAS_H / 2 - 80);
    g.stroke();
    g.moveTo(-CANVAS_W / 2 + 60, -CANVAS_H / 2 + 60);
    g.lineTo( CANVAS_W / 2 - 60, -CANVAS_H / 2 + 60);
    g.stroke();

    this.node.addChild(n);
    this.bgNode = n;
  }

  // ================================================================
  // 标题（主文 + 副文）
  // ================================================================
  private buildTitle() {
    const title = this.makeLabel(this.node, t('menu.title'),
      0, 260, 900, 80, 64, TEXT_TITLE);
    title.enableOutline = true;
    title.outlineColor = TEXT_OUTLINE;
    title.outlineWidth = 3;

    const sub = this.makeLabel(this.node, t('menu.subtitle'),
      0, 208, 900, 30, 22, TEXT_SUBTITLE);
    sub.enableOutline = true;
    sub.outlineColor = TEXT_OUTLINE;
    sub.outlineWidth = 2;
  }

  // ================================================================
  // 继续游戏（大按钮 + 存档摘要副文）
  // ================================================================
  private buildContinueButton() {
    const btn = this.makeRectButton(
      this.node, 0, 130, 480, 72, BTN_CONTINUE,
      () => this.onClickContinue(),
    );
    this.continueBtn = btn;

    // 两行文字：主（"继续游戏"）+ 副（"回合 5 · 攻击阶段 · 诺曼底"）
    this.continueTitleLabel = this.makeLabel(btn.node, t('menu.continue'),
      0, 14, 460, 32, 28, TEXT_PRIMARY);
    this.continueTitleLabel.enableOutline = true;
    this.continueTitleLabel.outlineColor = TEXT_OUTLINE;
    this.continueTitleLabel.outlineWidth = 2;

    this.continueSubLabel = this.makeLabel(btn.node, '',
      0, -16, 460, 22, 16, TEXT_PRIMARY);
  }

  private refreshContinueButton() {
    if (!this.continueBtn) return;
    const save = readSaveSafe();
    this.continueEnabled = !!save;

    if (save) {
      this.continueBtn.redraw(BTN_CONTINUE);
      if (this.continueTitleLabel) {
        this.continueTitleLabel.string = t('menu.continue');
        this.continueTitleLabel.color = TEXT_PRIMARY;
      }
      if (this.continueSubLabel) {
        const lvl = LEVELS.find(l => l.missionId === save.missionId);
        const missionTitle = lvl ? t(lvl.titleKey) : save.missionId;
        const phaseStr = save.phase === 'player'
          ? t('menu.phase.player')
          : t('menu.phase.enemy');
        this.continueSubLabel.string = t('menu.continueSummary', {
          turn: save.turn,
          phase: phaseStr,
          mission: missionTitle,
        });
        this.continueSubLabel.color = TEXT_PRIMARY;
      }
    } else {
      this.continueBtn.redraw(BTN_CONTINUE_DISABLE);
      if (this.continueTitleLabel) {
        this.continueTitleLabel.string = t('menu.noSave');
        this.continueTitleLabel.color = TEXT_DISABLED;
      }
      if (this.continueSubLabel) {
        this.continueSubLabel.string = '';
      }
    }
  }

  private onClickContinue() {
    if (!this.continueEnabled) return;
    const save = readSaveSafe();
    if (!save) return;
    const lvl = LEVELS.find(l => l.missionId === save.missionId);
    if (!lvl) {
      // 存档指向的关卡已不在配置里（版本差异）；按新局进入默认关卡兜底
      GameSession.selectMission(1, LEVELS[0].missionPath);
    } else {
      GameSession.resumeMission(lvl.id, lvl.missionPath);
    }
    this.loadBattleScene();
  }

  // ================================================================
  // "选 择 任 务" 分隔行：左右两条横线 + 中间文字
  // ================================================================
  private buildDivider() {
    const n = new Node('MenuDivider');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(1000, 30);
    n.setPosition(0, 60, 0);
    const g = n.addComponent(Graphics);
    g.strokeColor = MENU_DIVIDER;
    g.lineWidth = 2;
    // 左右两条
    g.moveTo(-480, 0); g.lineTo(-120, 0); g.stroke();
    g.moveTo( 120, 0); g.lineTo( 480, 0); g.stroke();
    this.node.addChild(n);

    this.makeLabel(this.node, t('menu.selectMission'),
      0, 60, 240, 32, 22, TEXT_DIVIDER);
  }

  // ================================================================
  // 12 关卡栅格（6 × 2）
  // ================================================================
  private buildLevelGrid() {
    for (let i = 0; i < LEVELS.length; i++) {
      const meta = LEVELS[i];
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = LEVEL_GRID_START_X + col * (LEVEL_BTN_W + LEVEL_GRID_GAP_X);
      const y = LEVEL_GRID_START_Y - row * (LEVEL_BTN_H + LEVEL_GRID_GAP_Y);

      const btn = this.makeRectButton(
        this.node, x, y, LEVEL_BTN_W, LEVEL_BTN_H,
        BTN_LEVEL_LOCKED, () => this.onClickLevel(meta),
      );
      btn.node.name = `LevelBtn_${meta.id}`;

      // 左上角大编号
      const idStr = String(meta.id).padStart(2, '0');
      const idLabel = this.makeLabel(btn.node, idStr,
        -LEVEL_BTN_W / 2 + 32, LEVEL_BTN_H / 2 - 26, 60, 36, 30, TEXT_PRIMARY);
      idLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
      idLabel.enableOutline = true;
      idLabel.outlineColor = TEXT_OUTLINE;
      idLabel.outlineWidth = 2;
      idLabel.node.name = 'IdLabel';

      // 右上角 ★（仅通关显示）
      const starLabel = this.makeLabel(btn.node, '★',
        LEVEL_BTN_W / 2 - 20, LEVEL_BTN_H / 2 - 22, 24, 24, 22, TEXT_STAR);
      starLabel.enableOutline = true;
      starLabel.outlineColor = TEXT_OUTLINE;
      starLabel.outlineWidth = 2;
      starLabel.node.name = 'StarLabel';
      starLabel.node.active = false;

      // 正中 🔒（仅未解锁显示）
      const lockLabel = this.makeLabel(btn.node, '🔒',
        0, 6, 60, 48, 40, TEXT_DISABLED);
      lockLabel.node.name = 'LockLabel';
      lockLabel.node.active = false;

      // 底部居中标题：英文过长时自动换行；锚点在下沿，文本自下往上排布以保持在按钮绿色区域内
      const titlePadX = 8;
      const titleW = LEVEL_BTN_W - titlePadX * 2;
      const titleBottomInset = 10;
      const titleN = new Node('TitleLabel');
      titleN.layer = this.node.layer;
      const titleUt = titleN.addComponent(UITransform);
      titleUt.setAnchorPoint(0.5, 0);
      titleUt.setContentSize(titleW, 24);
      titleN.setPosition(0, -LEVEL_BTN_H / 2 + titleBottomInset, 0);
      const titleLabel = titleN.addComponent(Label);
      titleLabel.string = t(meta.titleKey);
      titleLabel.fontSize = 16;
      titleLabel.lineHeight = 20;
      titleLabel.color = TEXT_PRIMARY;
      titleLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
      titleLabel.enableWrapText = true;
      titleLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
      titleLabel.verticalAlign = VerticalTextAlignment.BOTTOM;
      titleLabel.enableOutline = true;
      titleLabel.outlineColor = TEXT_OUTLINE;
      titleLabel.outlineWidth = 2;
      btn.node.addChild(titleN);

      this.levelBtns.push(btn);
    }
  }

  private refreshLevelButtons() {
    const state = MenuProgress.load();
    for (let i = 0; i < this.levelBtns.length; i++) {
      const meta = LEVELS[i];
      const btn = this.levelBtns[i];
      const unlocked = meta.id <= state.unlockedLevel;
      const completed = state.completedLevels.indexOf(meta.id) >= 0;

      const color = !unlocked
        ? BTN_LEVEL_LOCKED
        : (completed ? BTN_LEVEL_COMPLETED : BTN_LEVEL_UNLOCKED);
      btn.redraw(color, { border: true });

      // 子标签可见性
      const star = btn.node.getChildByName('StarLabel');
      const lock = btn.node.getChildByName('LockLabel');
      const idl  = btn.node.getChildByName('IdLabel');
      const tit  = btn.node.getChildByName('TitleLabel');
      if (star) star.active = completed;
      if (lock) lock.active = !unlocked;
      if (idl)  idl.active  = unlocked;   // 锁定关卡不显示数字，只显示 🔒
      if (tit)  tit.active  = unlocked;
    }
  }

  private onClickLevel(meta: LevelMeta) {
    if (!MenuProgress.isUnlocked(meta.id)) {
      console.log('[Menu] 关卡未解锁:', meta.id);
      return;
    }
    GameSession.selectMission(meta.id, meta.missionPath);
    this.loadBattleScene();
  }

  // ================================================================
  // 右上角 icon 按钮（⚙ 设置、? 说明）
  // ================================================================
  private buildTopIcons() {
    const settings = this.makeCircleButton(this.node, 580, 320, 24, '⚙', () => this.openSettings());
    settings.node.name = 'SettingsIcon';

    const help = this.makeCircleButton(this.node, 520, 320, 24, '?', () => this.openHelp());
    help.node.name = 'HelpIcon';

    // 防止 TS 未使用警告
    void settings; void help;
  }

  // ================================================================
  // 版本号（右下角）
  // ================================================================
  private buildVersion() {
    const label = this.makeLabel(this.node, t('menu.version', { b: '2026' }),
      500, -340, 260, 20, 14, TEXT_DISABLED);
    label.horizontalAlign = HorizontalTextAlignment.RIGHT;
  }

  // ================================================================
  // 模态：设置
  // ================================================================
  private openSettings() {
    this.closeModal();
    const { panel, contentY } = this.openModal(t('menu.settings.title'), 480, 360);

    // 音量行
    const volRowY = contentY - 30;
    this.makeLabel(panel, t('menu.settings.volume'),
      -panel.getComponent(UITransform)!.contentSize.width / 2 + 80, volRowY,
      80, 28, 20, TEXT_PRIMARY);

    // 滑条（track / fill / thumb）
    const state = MenuProgress.load();
    const track = this.buildVolumeSlider(panel, 40, volRowY, 220, state.volume);

    // 右侧百分比
    const volLabel = this.makeLabel(panel, `${state.volume}%`,
      200, volRowY, 60, 28, 20, TEXT_PRIMARY);

    // 语言行
    const langRowY = contentY - 100;
    this.makeLabel(panel, t('menu.settings.lang'),
      -panel.getComponent(UITransform)!.contentSize.width / 2 + 80, langRowY,
      80, 28, 20, TEXT_PRIMARY);

    const curLang = getLang();
    const zhBtn = this.makeRectButton(panel, 10, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchLang('zh'));
    this.makeLabel(zhBtn.node, t('menu.settings.langZh'), 0, 0, 100, 40, 18, TEXT_PRIMARY);

    const enBtn = this.makeRectButton(panel, 130, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchLang('en'));
    this.makeLabel(enBtn.node, t('menu.settings.langEn'), 0, 0, 100, 40, 18, TEXT_PRIMARY);

    this.settingsRefs = {
      volumeFill: track.fill,
      volumeThumb: track.thumb,
      volumeLabel: volLabel,
      langZhBtn: zhBtn,
      langEnBtn: enBtn,
    };
    this.refreshLangButtons(curLang);
  }

  private buildVolumeSlider(
    panel: Node, centerX: number, centerY: number, width: number, initial: number,
  ): { fill: Graphics; thumb: Node } {
    const trackH = 8;
    const root = new Node('VolumeSlider');
    root.layer = this.node.layer;
    const ut = root.addComponent(UITransform);
    ut.setContentSize(width, 36); // 比 track 高一点，扩展点击热区
    root.setPosition(centerX, centerY, 0);
    panel.addChild(root);

    // 背景轨道
    const trackNode = new Node('Track');
    trackNode.layer = this.node.layer;
    trackNode.addComponent(UITransform).setContentSize(width, trackH);
    const trackG = trackNode.addComponent(Graphics);
    trackG.fillColor = SLIDER_TRACK;
    trackG.rect(-width / 2, -trackH / 2, width, trackH);
    trackG.fill();
    root.addChild(trackNode);

    // 填充条（随音量变化）
    const fillNode = new Node('Fill');
    fillNode.layer = this.node.layer;
    fillNode.addComponent(UITransform).setContentSize(width, trackH);
    const fillG = fillNode.addComponent(Graphics);
    root.addChild(fillNode);

    // 圆形拖把
    const thumb = new Node('Thumb');
    thumb.layer = this.node.layer;
    thumb.addComponent(UITransform).setContentSize(20, 20);
    const thumbG = thumb.addComponent(Graphics);
    thumbG.fillColor = SLIDER_THUMB;
    thumbG.strokeColor = TEXT_OUTLINE;
    thumbG.lineWidth = 2;
    thumbG.circle(0, 0, 9);
    thumbG.fill();
    thumbG.stroke();
    root.addChild(thumb);

    // 绘制初始值
    const refreshBar = (vol: number) => {
      const pct = Math.max(0, Math.min(100, vol)) / 100;
      fillG.clear();
      fillG.fillColor = SLIDER_FILL;
      fillG.rect(-width / 2, -trackH / 2, width * pct, trackH);
      fillG.fill();
      thumb.setPosition(-width / 2 + width * pct, 0, 0);
    };
    refreshBar(initial);

    // 点击 / 拖动设置音量
    const setVolFromTouch = (ev: EventTouch) => {
      const uiPos = ev.getUILocation();
      const local = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
      const pct = Math.max(0, Math.min(1, (local.x + width / 2) / width));
      const vol = Math.round(pct * 100);
      MenuProgress.setVolume(vol);
      refreshBar(vol);
      if (this.settingsRefs?.volumeLabel) {
        this.settingsRefs.volumeLabel.string = `${vol}%`;
      }
      ev.propagationStopped = true;
    };
    root.on(Node.EventType.TOUCH_START, setVolFromTouch, this);
    root.on(Node.EventType.TOUCH_MOVE, setVolFromTouch, this);

    return { fill: fillG, thumb };
  }

  private switchLang(lang: LangCode) {
    if (getLang() === lang) return;
    setLang(lang);
    MenuProgress.setLang(lang);
    // 切语言后刷新整个菜单：简单粗暴地关掉模态 + 重建所有文字
    this.closeModal();
    this.rebuildAllText();
  }

  private refreshLangButtons(cur: LangCode) {
    if (!this.settingsRefs) return;
    const zh = this.settingsRefs.langZhBtn;
    const en = this.settingsRefs.langEnBtn;
    if (zh) zh.redraw(cur === 'zh' ? LANG_BTN_ACTIVE : LANG_BTN_IDLE, { border: cur === 'zh' });
    if (en) en.redraw(cur === 'en' ? LANG_BTN_ACTIVE : LANG_BTN_IDLE, { border: cur === 'en' });
  }

  /** 切语言后整个重建一次文字（不重建背景 / 按钮骨架） */
  private rebuildAllText() {
    // 简单做法：把 menu 全部拆了重建。因为所有东西都在 this.node 下，清子节点即可。
    for (const c of [...this.node.children]) c.destroy();
    this.levelBtns = [];
    this.continueBtn = null;
    this.continueTitleLabel = null;
    this.continueSubLabel = null;
    this.modalRoot = null;
    this.settingsRefs = null;
    this.onLoad();
  }

  // ================================================================
  // 模态：游戏说明
  // ================================================================
  private openHelp() {
    this.closeModal();
    const panelW = 820;
    const panelH = 540;
    const { panel } = this.openModal(t('menu.help.title'), panelW, panelH);

    const topReserve = 80;
    const bottomReserve = 24;
    const padX = 32;
    const viewportW = panelW - padX * 2;
    const viewportH = panelH - topReserve - bottomReserve;
    const innerTextW = viewportW - 16;
    const bodyY = (panelH / 2 - topReserve) - viewportH / 2;

    const scrollN = new Node('HelpScroll');
    scrollN.layer = this.node.layer;
    scrollN.addComponent(UITransform).setContentSize(viewportW, viewportH);
    scrollN.setPosition(0, bodyY, 0);
    panel.addChild(scrollN);

    const sv = scrollN.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    sv.inertia = true;
    sv.brake = 0.55;
    sv.bounceDuration = 0.2;
    sv.verticalScrollBar = null;
    sv.horizontalScrollBar = null;

    const viewN = new Node('view');
    viewN.layer = this.node.layer;
    viewN.addComponent(Mask);
    const vut = viewN.addComponent(UITransform);
    vut.setContentSize(viewportW, viewportH);
    scrollN.addChild(viewN);

    const contentN = new Node('content');
    contentN.layer = this.node.layer;
    const cut = contentN.addComponent(UITransform);
    cut.setAnchorPoint(0.5, 1);
    cut.setContentSize(innerTextW, viewportH);
    const contentTopInset = 8;
    contentN.setPosition(0, viewportH * 0.5 - contentTopInset, 0);
    viewN.addChild(contentN);

    const bodyLabNode = new Node('HelpBody');
    bodyLabNode.layer = this.node.layer;
    const but = bodyLabNode.addComponent(UITransform);
    but.setAnchorPoint(0.5, 1);
    but.setContentSize(innerTextW, 40);
    const body = bodyLabNode.addComponent(Label);
    body.string = t('menu.help.body');
    body.fontSize = 18;
    body.lineHeight = 28;
    body.color = TEXT_PRIMARY;
    body.overflow = Label.Overflow.RESIZE_HEIGHT;
    body.enableWrapText = true;
    body.horizontalAlign = HorizontalTextAlignment.LEFT;
    body.verticalAlign = VerticalTextAlignment.TOP;
    contentN.addChild(bodyLabNode);

    sv.content = contentN;

    const syncHelpScrollContentSize = () => {
      if (!bodyLabNode.isValid || !contentN.isValid) return;
      const ut = bodyLabNode.getComponent(UITransform);
      if (!ut) return;
      const h = Math.ceil(ut.contentSize.height + 12);
      cut.setContentSize(innerTextW, Math.max(h, viewportH));
      sv.scrollToTop(0);
    };
    this.scheduleOnce(syncHelpScrollContentSize, 0);
  }

  // ================================================================
  // 模态基础设施（与 BattleScene DiceShow 同构：全屏遮罩 + 居中面板 + ✕）
  // ================================================================
  private openModal(titleText: string, panelW: number, panelH: number): {
    panel: Node;
    /** 面板内"标题下方"可用起始 y，向下布局更直观 */
    contentY: number;
  } {
    const root = new Node('MenuModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);

    // 全屏遮罩
    const backdrop = new Node('Backdrop');
    backdrop.layer = this.node.layer;
    backdrop.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const bd = backdrop.addComponent(Graphics);
    bd.fillColor = MODAL_BACKDROP;
    bd.rect(-CANVAS_W / 2, -CANVAS_H / 2, CANVAS_W, CANVAS_H);
    bd.fill();
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      // 点遮罩空白处关闭模态
      this.closeModal();
      e.propagationStopped = true;
    }, this);
    root.addChild(backdrop);

    // 面板本体
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pg = panel.addComponent(Graphics);
    pg.fillColor = MODAL_PANEL_BG;
    pg.strokeColor = MODAL_PANEL_BORDER;
    pg.lineWidth = 2;
    pg.rect(-panelW / 2, -panelH / 2, panelW, panelH);
    pg.fill();
    pg.stroke();
    // 标题下方装饰横线（复用同一个 Graphics，Cocos 限制一节点只能挂一份）
    pg.strokeColor = MENU_DIVIDER;
    pg.lineWidth = 1;
    pg.moveTo(-panelW / 2 + 30, panelH / 2 - 64);
    pg.lineTo( panelW / 2 - 30, panelH / 2 - 64);
    pg.stroke();
    // 吃掉点击事件，避免穿透到 backdrop
    panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.addChild(panel);

    // 标题
    const titleY = panelH / 2 - 36;
    const titleLab = this.makeLabel(panel, titleText,
      0, titleY, panelW - 100, 36, 28, TEXT_TITLE);
    titleLab.enableOutline = true;
    titleLab.outlineColor = TEXT_OUTLINE;
    titleLab.outlineWidth = 2;

    // 右上角 ✕
    const closeBtn = this.makeRectButton(
      panel, panelW / 2 - 28, panelH / 2 - 28, 36, 36,
      MODAL_CLOSE_BG, () => this.closeModal(),
    );
    this.makeLabel(closeBtn.node, '✕', 0, 0, 36, 36, 22, TEXT_PRIMARY);

    this.modalRoot = root;
    return { panel, contentY: panelH / 2 - 80 };
  }

  private closeModal() {
    if (this.modalRoot && this.modalRoot.isValid) this.modalRoot.destroy();
    this.modalRoot = null;
    this.settingsRefs = null;
  }

  // ================================================================
  // 场景切换
  // ================================================================
  private loadBattleScene() {
    console.log('[Menu] load battle scene:', this.battleSceneName,
      '  mission =', GameSession.selectedMissionPath,
      '  resume =', GameSession.resumeFromSave);
    director.loadScene(this.battleSceneName, (err) => {
      if (err) console.error('[Menu] 加载战斗场景失败:', this.battleSceneName, err);
    });
  }

  // ================================================================
  // UI 构造工具
  // ================================================================

  /** 矩形按钮（圆角 8）。返回 { node, graphics, redraw } 便于外部改色 / 状态。 */
  private makeRectButton(
    parent: Node,
    x: number, y: number, w: number, h: number,
    color: Color,
    onClick: () => void,
  ): ButtonRefs {
    const n = new Node('RectBtn');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);

    const redraw = (c: Color, opts?: { border?: boolean }) => {
      g.clear();
      g.fillColor = c;
      g.rect(-w / 2, -h / 2, w, h);
      g.fill();
      if (opts?.border) {
        g.strokeColor = BTN_LEVEL_BORDER;
        g.lineWidth = 2;
        g.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
        g.stroke();
      }
    };
    redraw(color);

    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      onClick();
      ev.propagationStopped = true;
    }, this);
    parent.addChild(n);
    return { node: n, graphics: g, label: null, redraw };
  }

  /** 圆形 icon 按钮（齿轮 / 问号） */
  private makeCircleButton(
    parent: Node, x: number, y: number, r: number,
    iconText: string, onClick: () => void,
  ): ButtonRefs {
    const n = new Node('CircleBtn');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(r * 2, r * 2);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);

    const redraw = (c: Color) => {
      g.clear();
      g.fillColor = c;
      g.strokeColor = ICON_BTN_BORDER;
      g.lineWidth = 2;
      g.circle(0, 0, r);
      g.fill();
      g.stroke();
    };
    redraw(ICON_BTN_BG);

    const label = this.makeLabel(n, iconText, 0, 0, r * 2, r * 2, r + 2, TEXT_PRIMARY);

    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      onClick();
      ev.propagationStopped = true;
    }, this);
    parent.addChild(n);
    return { node: n, graphics: g, label, redraw: (c: Color) => redraw(c) };
  }

  /** 居中 Label；返回 Label 便于外部 setString / 改颜色。 */
  private makeLabel(
    parent: Node, text: string,
    x: number, y: number, w: number, h: number,
    fontSize: number, color: Color,
  ): Label {
    const n = new Node('Label');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 4;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;
    parent.addChild(n);
    return l;
  }
}

// ============================================================
// 纯工具函数（与组件无关）
// ============================================================

function lerp(a: Color, b: Color, tRatio: number): Color {
  const k = Math.max(0, Math.min(1, tRatio));
  return new Color(
    Math.round(a.r + (b.r - a.r) * k),
    Math.round(a.g + (b.g - a.g) * k),
    Math.round(a.b + (b.b - a.b) * k),
    Math.round(a.a + (b.a - a.a) * k),
  );
}

/** 沿父节点链向上找第一个挂 Canvas 组件的祖先节点；找不到返回 null。 */
function findCanvasAncestor(n: Node): Node | null {
  let cur: Node | null = n.parent;
  while (cur) {
    if (cur.getComponent && cur.getComponent(Canvas)) return cur;
    cur = cur.parent;
  }
  return null;
}

/** 在当前场景里递归找第一个挂了 Canvas 组件的节点；H6 reparent 兜底用。 */
function findFirstCanvasNode(): Node | null {
  const scene = director.getScene();
  if (!scene) return null;
  const stack: Node[] = [scene as unknown as Node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.getComponent && n.getComponent(Canvas)) return n;
    const kids = n.children || [];
    for (const k of kids) stack.push(k);
  }
  return null;
}

/** 安全读取战斗存档：缺失 / 解析失败都返回 null，不抛 */
function readSaveSafe(): SaveData | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SaveData;
  } catch (e) {
    console.warn('[Menu] 存档读取失败', e);
    return null;
  }
}
