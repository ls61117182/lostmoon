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
 *   - 继续游戏：读取当前账号对应的本地战斗存档；无存档时按钮灰态
 *   - 关卡按钮：未解锁 / 已解锁 / 已通关 三态；点击后切战斗场景
 *   - 顶部 ⚙ / ?：弹出模态面板，点击 ✕ 或遮罩空白处关闭
 */

import {
  _decorator, Canvas, Color, Component, EditBox, EventTouch, Graphics,
  HorizontalTextAlignment, Label, Layers, Mask, Node, ScrollView, UITransform,
  Vec3, VerticalTextAlignment, director,
} from 'cc';
import { getLang, setLang, t, LangCode } from '../core/Lang';
import { GameSession } from '../core/GameSession';
import { initGameAudio, onMenuVolumesChanged, playBgmMenu, playUiClick } from '../audio/GameAudio';
import {
  CHAPTERS,
  DEFAULT_CHAPTER_ID,
  LEVELS,
  LevelMeta,
  MenuProgress,
  getChapter,
  getChapterLevels,
} from '../core/LevelDB';
import { SaveData } from '../core/SaveLoad';
import { loginServer, registerServer, ServerProfile, syncServerProfile } from '../core/AuthService';
import { readActiveSaveRaw } from '../core/SaveSlot';

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
const LEVEL_GRID_START_Y = -88;
const CHAPTER_BTN_W = 210;
const CHAPTER_BTN_H = 44;
const CHAPTER_BTN_GAP = 18;
const CHAPTER_VIEW_W = 760;
const CHAPTER_VIEW_H = 54;

// ---------- 颜色（延续军事风） ----------
const BG_TOP          = new Color( 40,  52,  38, 255);
const BG_MID          = new Color( 26,  34,  28, 255);
const BG_BOTTOM       = new Color( 13,  18,  17, 255);

const TEXT_PRIMARY    = new Color(255, 255, 255, 255);
const TEXT_DISABLED   = new Color(150, 150, 150, 200);
const TEXT_OUTLINE    = new Color(  0,   0,   0, 220);
const TEXT_TITLE      = new Color(235, 207, 142, 255);
const TEXT_SUBTITLE   = new Color(198, 194, 176, 255);
const TEXT_STAR       = new Color(238, 188,  75, 255);
const TEXT_DIVIDER    = new Color(214, 204, 168, 255);

const BTN_CONTINUE         = new Color(145,  95,  44, 245);
const BTN_CONTINUE_HOVER   = new Color(177, 118,  58, 245);
const BTN_CONTINUE_DISABLE = new Color( 56,  58,  56, 190);

const BTN_LEVEL_UNLOCKED  = new Color( 74,  88,  55, 238);
const BTN_LEVEL_COMPLETED = new Color( 96, 118,  66, 238);
const BTN_LEVEL_LOCKED    = new Color( 49,  51,  48, 210);
const BTN_LEVEL_BORDER    = new Color(204, 190, 142, 230);

const ICON_BTN_BG         = new Color( 45,  50,  44, 230);
const ICON_BTN_BORDER     = new Color(204, 190, 142, 205);

const MENU_DIVIDER        = new Color(145, 138, 100, 210);

const MODAL_BACKDROP      = new Color(  0,   0,   0, 180);
const MODAL_PANEL_BG      = new Color( 36,  41,  34, 245);
const MODAL_PANEL_BORDER  = new Color(202, 188, 136, 230);
const MODAL_CLOSE_BG      = new Color(134,  49,  42, 245);

const SLIDER_TRACK        = new Color( 70,  80,  90, 255);
const SLIDER_FILL         = new Color(170, 110,  50, 255);
const SLIDER_THUMB        = new Color(240, 215, 150, 255);

const LANG_BTN_IDLE       = new Color( 59,  64,  54, 235);
const LANG_BTN_ACTIVE     = new Color(145,  95,  44, 245);
const LANG_BTN_ACTIVE_BD  = new Color(240, 215, 150, 255);
const CHAPTER_BTN_IDLE    = new Color( 58,  66,  56, 235);
const CHAPTER_BTN_ACTIVE  = new Color(148,  96,  46, 245);
const CHAPTER_EMPTY_BG    = new Color( 42,  48,  42, 222);

const AUTH_CARD_BG        = new Color( 44,  50,  42, 245);
const AUTH_CARD_ACTIVE    = new Color( 77,  88,  57, 248);
const AUTH_INPUT_BG       = new Color( 18,  22,  20, 245);
const AUTH_INPUT_BD       = new Color(116, 118,  92, 230);
const AUTH_PRIMARY        = new Color(150,  98,  48, 245);
const AUTH_OFFLINE        = new Color( 68,  82,  92, 245);
const AUTH_HINT           = new Color(202, 196, 174, 235);

type LoginMode = 'online' | 'offline';

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
  private chapterBtns: ButtonRefs[] = [];
  private selectedChapterId: string = DEFAULT_CHAPTER_ID;
  private levelGridRoot: Node | null = null;
  private chapterSubtitleLabel: Label | null = null;

  // 当前打开的模态；非 null 时主菜单点击被遮罩吞掉
  private modalRoot: Node | null = null;

  private authNameLabel: Label | null = null;
  private authStatusLabel: Label | null = null;

  // 设置 UI 组件引用（只在设置模态打开时有效）
  private settingsRefs: {
    bgmFill: Graphics | null;
    bgmThumb: Node | null;
    bgmLabel: Label | null;
    sfxFill: Graphics | null;
    sfxThumb: Node | null;
    sfxLabel: Label | null;
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
    const menuState = MenuProgress.load();
    setLang(menuState.lang);
    this.selectedChapterId = getChapter(menuState.selectedChapterId) ? menuState.selectedChapterId : DEFAULT_CHAPTER_ID;

    this.buildBackground();
    this.buildTitle();
    this.buildContinueButton();
    this.buildChapterTabs();
    this.buildLevelGrid();
    this.buildTopIcons();
    this.buildVersion();

    this.refreshContinueButton();
    this.refreshLevelButtons();

    initGameAudio();
    playBgmMenu();

    this.scheduleOnce(() => {
      if (!getAuthSession()) this.openLoginGate();
      this.refreshAuthBadge();
    }, 0);
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

    // Faint operations-map grid and route marks.
    g.strokeColor = new Color(210, 198, 150, 32);
    g.lineWidth = 1;
    for (let x = -560; x <= 560; x += 80) {
      g.moveTo(x, -300);
      g.lineTo(x + 90, 300);
      g.stroke();
    }
    for (let y = -260; y <= 260; y += 52) {
      g.moveTo(-560, y);
      g.lineTo(560, y + 18);
      g.stroke();
    }

    g.strokeColor = new Color(230, 205, 130, 80);
    g.lineWidth = 2;
    g.moveTo(-440, 118);
    g.bezierCurveTo(-260, 190, -130, 56, 20, 112);
    g.bezierCurveTo(145, 158, 245, 40, 410, 92);
    g.stroke();
    for (const [x, y] of [[-440, 118], [-125, 78], [105, 126], [410, 92]]) {
      g.circle(x, y, 5);
      g.stroke();
    }

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

    const rule = new Node('TitleRule');
    rule.layer = this.node.layer;
    rule.addComponent(UITransform).setContentSize(360, 14);
    rule.setPosition(0, 184, 0);
    const g = rule.addComponent(Graphics);
    g.strokeColor = MENU_DIVIDER;
    g.lineWidth = 2;
    g.moveTo(-180, 0);
    g.lineTo(-28, 0);
    g.moveTo(28, 0);
    g.lineTo(180, 0);
    g.stroke();
    g.fillColor = TEXT_TITLE;
    g.rect(-18, -3, 36, 6);
    g.fill();
    this.node.addChild(rule);
  }

  // ================================================================
  // 继续游戏（大按钮 + 存档摘要副文）
  // ================================================================
  private buildContinueButton() {
    const btn = this.makeRectButton(
      this.node, 0, 126, 420, 58, BTN_CONTINUE,
      () => this.onClickContinue(),
    );
    this.continueBtn = btn;

    // 两行文字：主（"继续游戏"）+ 副（"回合 5 · 攻击阶段 · 诺曼底"）
    this.continueTitleLabel = this.makeLabel(btn.node, t('menu.continue'),
      0, 10, 400, 28, 24, TEXT_PRIMARY);
    this.continueTitleLabel.enableOutline = true;
    this.continueTitleLabel.outlineColor = TEXT_OUTLINE;
    this.continueTitleLabel.outlineWidth = 2;

    this.continueSubLabel = this.makeLabel(btn.node, '',
      0, -13, 400, 20, 15, TEXT_PRIMARY);
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

  private buildChapterTabs() {
    this.chapterBtns = [];
    const chapters = CHAPTERS.slice().sort((a, b) => a.order - b.order);
    const totalW = chapters.length * CHAPTER_BTN_W + Math.max(0, chapters.length - 1) * CHAPTER_BTN_GAP;
    const contentW = Math.max(CHAPTER_VIEW_W, totalW);

    const viewport = new Node('ChapterTabsViewport');
    viewport.layer = this.node.layer;
    viewport.addComponent(UITransform).setContentSize(CHAPTER_VIEW_W, CHAPTER_VIEW_H);
    viewport.setPosition(0, 54, 0);
    viewport.addComponent(Mask);
    this.node.addChild(viewport);

    const sv = viewport.addComponent(ScrollView);
    sv.horizontal = true;
    sv.vertical = false;
    sv.inertia = true;
    sv.brake = 0.55;
    sv.cancelInnerEvents = false;

    const content = new Node('ChapterTabsContent');
    content.layer = this.node.layer;
    const cut = content.addComponent(UITransform);
    cut.setAnchorPoint(0.5, 0.5);
    cut.setContentSize(contentW, CHAPTER_VIEW_H);
    content.setPosition(0, 0, 0);
    viewport.addChild(content);
    sv.content = content;

    const startX = -totalW / 2 + CHAPTER_BTN_W / 2;
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!;
      const x = startX + i * (CHAPTER_BTN_W + CHAPTER_BTN_GAP);
      const btn = this.makeRectButton(
        content, x, 0, CHAPTER_BTN_W, CHAPTER_BTN_H,
        CHAPTER_BTN_IDLE, () => this.onClickChapter(chapter.id),
      );
      btn.node.name = `ChapterBtn_${chapter.id}`;
      const label = this.makeLabel(btn.node, t(chapter.titleKey), 0, 0, CHAPTER_BTN_W - 18, 28, 20, TEXT_PRIMARY);
      label.enableOutline = true;
      label.outlineColor = TEXT_OUTLINE;
      label.outlineWidth = 2;
      btn.label = label;
      this.chapterBtns.push(btn);
    }
    this.chapterSubtitleLabel = this.makeLabel(this.node, '', 0, 14, 700, 24, 17, TEXT_SUBTITLE);
    this.refreshChapterTabs();
  }

  private refreshChapterTabs() {
    const chapters = CHAPTERS.slice().sort((a, b) => a.order - b.order);
    for (let i = 0; i < this.chapterBtns.length; i++) {
      const chapter = chapters[i];
      const btn = this.chapterBtns[i];
      if (!chapter || !btn) continue;
      const active = chapter.id === this.selectedChapterId;
      btn.redraw(active ? CHAPTER_BTN_ACTIVE : CHAPTER_BTN_IDLE, { border: active });
      if (btn.label) {
        btn.label.string = t(chapter.titleKey);
        btn.label.color = active ? TEXT_TITLE : TEXT_PRIMARY;
      }
    }
    const current = getChapter(this.selectedChapterId) ?? getChapter(DEFAULT_CHAPTER_ID);
    if (this.chapterSubtitleLabel && current) {
      this.chapterSubtitleLabel.string = t(current.subtitleKey);
    }
  }

  private onClickChapter(chapterId: string) {
    if (chapterId === this.selectedChapterId) return;
    this.selectedChapterId = getChapter(chapterId) ? chapterId : DEFAULT_CHAPTER_ID;
    MenuProgress.setSelectedChapterId(this.selectedChapterId);
    this.refreshChapterTabs();
    this.buildLevelGrid();
    this.refreshLevelButtons();
  }

  // ================================================================
  // 12 关卡栅格（6 × 2）
  // ================================================================
  private buildLevelGrid() {
    if (this.levelGridRoot && this.levelGridRoot.isValid) this.levelGridRoot.destroy();
    this.levelBtns = [];

    const root = new Node('LevelGridRoot');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, 300);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    this.levelGridRoot = root;

    const levels = getChapterLevels(this.selectedChapterId);
    if (levels.length === 0) {
      const panelW = 520;
      const panelH = 126;
      const panel = new Node('ChapterEmptyPanel');
      panel.layer = this.node.layer;
      panel.addComponent(UITransform).setContentSize(panelW, panelH);
      panel.setPosition(0, -130, 0);
      const pg = panel.addComponent(Graphics);
      drawFieldPanel(pg, panelW, panelH, CHAPTER_EMPTY_BG, MENU_DIVIDER, TEXT_TITLE);
      root.addChild(panel);
      const title = this.makeLabel(panel, t('chapter.empty.title'), 0, 24, panelW - 48, 32, 24, TEXT_TITLE);
      title.enableOutline = true;
      title.outlineColor = TEXT_OUTLINE;
      title.outlineWidth = 2;
      const body = this.makeLabel(panel, t('chapter.empty.body'), 0, -20, panelW - 64, 42, 17, TEXT_SUBTITLE);
      body.overflow = Label.Overflow.RESIZE_HEIGHT;
      body.enableWrapText = true;
      body.lineHeight = 22;
      return;
    }

    for (let i = 0; i < levels.length; i++) {
      const meta = levels[i];
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = LEVEL_GRID_START_X + col * (LEVEL_BTN_W + LEVEL_GRID_GAP_X);
      const y = LEVEL_GRID_START_Y - row * (LEVEL_BTN_H + LEVEL_GRID_GAP_Y);

      const btn = this.makeRectButton(
        root, x, y, LEVEL_BTN_W, LEVEL_BTN_H,
        BTN_LEVEL_LOCKED, () => this.onClickLevel(meta),
      );
      btn.node.name = `LevelBtn_${meta.id}`;

      // 左上角大编号
      const idStr = meta.id > 0 ? String(meta.id).padStart(2, '0') : 'T';
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
    const levels = getChapterLevels(this.selectedChapterId);
    for (let i = 0; i < this.levelBtns.length; i++) {
      const meta = levels[i];
      const btn = this.levelBtns[i];
      if (!meta || !btn) continue;
      const unlocked = MenuProgress.isUnlocked(meta.id, meta.chapterId);
      const completed = MenuProgress.isCompleted(meta.id, meta.chapterId);

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
    if (!MenuProgress.isUnlocked(meta.id, meta.chapterId)) {
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

    const account = this.makeCircleButton(this.node, 460, 320, 24, 'ID', () => this.openLoginGate());
    account.node.name = 'AccountIcon';
    this.authNameLabel = this.makeLabel(this.node, '', 350, 320, 180, 24, 16, TEXT_SUBTITLE);
    this.authNameLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;

    void settings;
    void help;
    void account;
  }

  private refreshAuthBadge() {
    if (!this.authNameLabel) return;
    const s = getAuthSession();
    if (!s) {
      this.authNameLabel.string = authText('auth.badge.none');
      this.authNameLabel.color = TEXT_DISABLED;
      return;
    }
    this.authNameLabel.string = s.mode === 'online'
      ? authText('auth.badge.online', { name: s.username || authText('auth.defaultUser') })
      : authText('auth.badge.offline');
    this.authNameLabel.color = s.mode === 'online' ? TEXT_TITLE : TEXT_SUBTITLE;
  }

  // ================================================================
  // 版本号（右下角）
  // ================================================================
  private buildVersion() {
    const label = this.makeLabel(this.node, t('menu.version', { b: '2026' }),
      500, -340, 260, 20, 14, TEXT_DISABLED);
    label.horizontalAlign = HorizontalTextAlignment.RIGHT;
  }

  private openLoginGate() {
    this.closeModal(true);
    const panelW = 860;
    const panelH = 510;
    const { panel, contentY } = this.openModal(authText('auth.title'), panelW, panelH);
    if (this.modalRoot) this.modalRoot.name = 'AuthGate';

    const intro = this.makeLabel(panel, authText('auth.subtitle'), 0, contentY - 4, panelW - 120, 30, 18, AUTH_HINT);
    intro.horizontalAlign = HorizontalTextAlignment.CENTER;

    const cardY = -10;
    this.buildLoginCard(panel, -218, cardY);
    this.buildOfflineCard(panel, 218, cardY);

    this.authStatusLabel = this.makeLabel(panel, '', 0, -panelH / 2 + 34, panelW - 120, 26, 17, TEXT_DISABLED);
  }

  private buildLoginCard(panel: Node, x: number, y: number) {
    const cardW = 360;
    const cardH = 310;
    const card = new Node('LoginCard');
    card.layer = this.node.layer;
    card.addComponent(UITransform).setContentSize(cardW, cardH);
    card.setPosition(x, y, 0);
    const g = card.addComponent(Graphics);
    drawFieldPanel(g, cardW, cardH, AUTH_CARD_ACTIVE, MODAL_PANEL_BORDER, TEXT_TITLE);
    panel.addChild(card);

    const title = this.makeLabel(card, authText('auth.login.title'), 0, 112, cardW - 40, 34, 25, TEXT_TITLE);
    title.enableOutline = true;
    title.outlineColor = TEXT_OUTLINE;
    title.outlineWidth = 2;
    this.makeLabel(card, authText('auth.login.desc'), 0, 76, cardW - 52, 42, 16, AUTH_HINT);

    const userLab = this.makeLabel(card, authText('auth.username'), -118, 28, 92, 24, 16, TEXT_SUBTITLE);
    userLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    const username = this.makeInputField(card, 54, 28, 220, 38, authText('auth.username.placeholder'), false);
    const passLab = this.makeLabel(card, authText('auth.password'), -118, -32, 92, 24, 16, TEXT_SUBTITLE);
    passLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    const password = this.makeInputField(card, 54, -32, 220, 38, authText('auth.password.placeholder'), true);

    const loginBtn = this.makeRectButton(card, 0, -104, 250, 46, AUTH_PRIMARY, async () => {
      const name = username.string.trim();
      if (!name) {
        this.setAuthStatus(authText('auth.error.username'), false);
        return;
      }
      this.setAuthStatus(authText('auth.login.busy'), true);
      const result = await loginServer(name, password.string);
      if (!result.ok && result.code === 'ACCOUNT_NOT_FOUND') {
        this.openRegisterGate(name);
        return;
      }
      if (!result.ok) {
        this.setAuthStatus(authText(serverAuthMessageKey(result.code), { msg: result.message ?? '' }), false);
        return;
      }
      const displayName = result.username || name;
      setAuthSession({ mode: 'online', username: displayName });
      applyServerProfile(result.profile);
      this.setAuthStatus(authText('auth.login.ok', { name: displayName }), true);
      this.refreshAuthBadge();
      this.refreshContinueButton();
      this.refreshLevelButtons();
      this.scheduleOnce(() => this.closeModal(), 0.35);
    });
    this.makeLabel(loginBtn.node, authText('auth.login.button'), 0, 0, 250, 46, 19, TEXT_PRIMARY);
  }

  private openRegisterGate(prefillName: string) {
    this.closeModal(true);
    const panelW = 620;
    const panelH = 460;
    const { panel, contentY } = this.openModal(authText('auth.register.title'), panelW, panelH);
    if (this.modalRoot) this.modalRoot.name = 'AuthGate';

    const intro = this.makeLabel(panel, authText('auth.register.subtitle'), 0, contentY - 4, panelW - 100, 44, 18, AUTH_HINT);
    intro.overflow = Label.Overflow.RESIZE_HEIGHT;
    intro.enableWrapText = true;
    intro.lineHeight = 24;

    const formY = 64;
    const labelX = -210;
    const inputX = 58;
    const nameLab = this.makeLabel(panel, authText('auth.username'), labelX, formY, 90, 24, 17, TEXT_SUBTITLE);
    nameLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    const username = this.makeInputField(panel, inputX, formY, 290, 40, authText('auth.username.placeholder'), false, prefillName);

    const passLab = this.makeLabel(panel, authText('auth.password'), labelX, formY - 62, 90, 24, 17, TEXT_SUBTITLE);
    passLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    const password = this.makeInputField(panel, inputX, formY - 62, 290, 40, authText('auth.password.placeholder'), true);

    const confirmLab = this.makeLabel(panel, authText('auth.register.confirm'), labelX, formY - 124, 90, 24, 17, TEXT_SUBTITLE);
    confirmLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    const confirm = this.makeInputField(panel, inputX, formY - 124, 290, 40, authText('auth.register.confirmPlaceholder'), true);

    const registerBtn = this.makeRectButton(panel, -76, -156, 220, 46, AUTH_PRIMARY, async () => {
      const name = username.string.trim();
      if (!name) {
        this.setAuthStatus(authText('auth.error.username'), false);
        return;
      }
      if (!password.string) {
        this.setAuthStatus(authText('auth.error.passwordEmpty'), false);
        return;
      }
      if (password.string !== confirm.string) {
        this.setAuthStatus(authText('auth.error.passwordConfirm'), false);
        return;
      }
      this.setAuthStatus(authText('auth.register.busy'), true);
      const result = await registerServer(name, password.string, buildCurrentServerProfile());
      if (!result.ok) {
        this.setAuthStatus(authText(serverAuthMessageKey(result.code), { msg: result.message ?? '' }), false);
        return;
      }
      const displayName = result.username || name;
      setAuthSession({ mode: 'online', username: displayName });
      applyServerProfile(result.profile);
      this.setAuthStatus(authText('auth.register.ok', { name: displayName }), true);
      this.refreshAuthBadge();
      this.refreshContinueButton();
      this.refreshLevelButtons();
      this.scheduleOnce(() => this.closeModal(), 0.35);
    });
    this.makeLabel(registerBtn.node, authText('auth.register.button'), 0, 0, 220, 46, 19, TEXT_PRIMARY);

    const backBtn = this.makeRectButton(panel, 170, -156, 160, 46, AUTH_OFFLINE, () => this.openLoginGate());
    this.makeLabel(backBtn.node, authText('auth.register.back'), 0, 0, 160, 46, 18, TEXT_PRIMARY);

    this.authStatusLabel = this.makeLabel(panel, authText('auth.register.prefill', { name: prefillName }), 0, -panelH / 2 + 34, panelW - 100, 26, 17, TEXT_DISABLED);
  }

  private buildOfflineCard(panel: Node, x: number, y: number) {
    const cardW = 360;
    const cardH = 310;
    const card = new Node('OfflineCard');
    card.layer = this.node.layer;
    card.addComponent(UITransform).setContentSize(cardW, cardH);
    card.setPosition(x, y, 0);
    const g = card.addComponent(Graphics);
    drawFieldPanel(g, cardW, cardH, AUTH_CARD_BG, MODAL_PANEL_BORDER, TEXT_TITLE);
    panel.addChild(card);

    const title = this.makeLabel(card, authText('auth.offline.title'), 0, 112, cardW - 40, 34, 25, TEXT_TITLE);
    title.enableOutline = true;
    title.outlineColor = TEXT_OUTLINE;
    title.outlineWidth = 2;
    const desc = this.makeLabel(card, authText('auth.offline.desc'), 0, 42, cardW - 56, 118, 17, AUTH_HINT);
    desc.overflow = Label.Overflow.RESIZE_HEIGHT;
    desc.enableWrapText = true;
    desc.lineHeight = 24;

    const offlineBtn = this.makeRectButton(card, 0, -104, 250, 46, AUTH_OFFLINE, () => {
      setAuthSession({ mode: 'offline', username: '' });
      this.setAuthStatus(authText('auth.offline.ok'), true);
      this.refreshAuthBadge();
      this.refreshContinueButton();
      this.scheduleOnce(() => this.closeModal(), 0.25);
    });
    this.makeLabel(offlineBtn.node, authText('auth.offline.button'), 0, 0, 250, 46, 19, TEXT_PRIMARY);
  }

  private makeInputField(parent: Node, x: number, y: number, w: number, h: number, placeholder: string, password: boolean, initial = ''): EditBox {
    const root = new Node('InputField');
    root.layer = this.node.layer;
    const rootUt = root.addComponent(UITransform);
    rootUt.setContentSize(w, h);
    root.setPosition(x, y, 0);
    const g = root.addComponent(Graphics);
    g.fillColor = AUTH_INPUT_BG;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    g.strokeColor = AUTH_INPUT_BD;
    g.lineWidth = 2;
    g.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
    g.stroke();

    const textPadX = 12;
    const textPadY = 5;
    const textW = w - textPadX * 2;
    const textH = h - textPadY * 2;

    const textNode = new Node('TEXT_LABEL');
    textNode.layer = this.node.layer;
    const textUt = textNode.addComponent(UITransform);
    textUt.setAnchorPoint(0, 1);
    textUt.setContentSize(textW, textH);
    textNode.setPosition(-w / 2 + textPadX, h / 2 - textPadY, 0);
    const textLabel = textNode.addComponent(Label);
    textLabel.fontSize = 18;
    textLabel.lineHeight = 24;
    textLabel.color = TEXT_PRIMARY;
    textLabel.overflow = Label.Overflow.CLAMP;
    textLabel.enableWrapText = false;
    textLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    textLabel.verticalAlign = VerticalTextAlignment.CENTER;
    root.addChild(textNode);

    const placeholderNode = new Node('PLACEHOLDER_LABEL');
    placeholderNode.layer = this.node.layer;
    const placeholderUt = placeholderNode.addComponent(UITransform);
    placeholderUt.setAnchorPoint(0, 1);
    placeholderUt.setContentSize(textW, textH);
    placeholderNode.setPosition(-w / 2 + textPadX, h / 2 - textPadY, 0);
    const placeholderLabel = placeholderNode.addComponent(Label);
    placeholderLabel.fontSize = 16;
    placeholderLabel.lineHeight = 22;
    placeholderLabel.color = TEXT_DISABLED;
    placeholderLabel.overflow = Label.Overflow.CLAMP;
    placeholderLabel.enableWrapText = false;
    placeholderLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    placeholderLabel.verticalAlign = VerticalTextAlignment.CENTER;
    placeholderLabel.string = placeholder;
    root.addChild(placeholderNode);

    const edit = root.addComponent(EditBox);
    edit.fontSize = 18;
    edit.fontColor = TEXT_PRIMARY;
    edit.placeholder = placeholder;
    edit.placeholderFontSize = 16;
    edit.placeholderFontColor = TEXT_DISABLED;
    edit.string = initial;
    textLabel.string = initial;
    edit.maxLength = 24;
    edit.inputMode = EditBox.InputMode.SINGLE_LINE;
    if (password) edit.inputFlag = EditBox.InputFlag.PASSWORD;
    const editInternal = edit as unknown as {
      textLabel?: Label;
      placeholderLabel?: Label;
      _textLabel?: Label;
      _placeholderLabel?: Label;
    };
    editInternal.textLabel = textLabel;
    editInternal.placeholderLabel = placeholderLabel;
    editInternal._textLabel = textLabel;
    editInternal._placeholderLabel = placeholderLabel;
    parent.addChild(root);
    return edit;
  }

  private setAuthStatus(text: string, good: boolean) {
    if (!this.authStatusLabel) return;
    this.authStatusLabel.string = text;
    this.authStatusLabel.color = good ? TEXT_TITLE : new Color(230, 125, 100, 255);
  }

  // ================================================================
  // 模态：设置
  // ================================================================
  private openSettings() {
    this.closeModal();
    const { panel, contentY } = this.openModal(t('menu.settings.title'), 480, 500);
    const labelLeftX = -panel.getComponent(UITransform)!.contentSize.width / 2 + 80;
    const state = MenuProgress.load();

    const bgmRowY = contentY - 28;
    this.makeLabel(panel, t('menu.settings.bgmVolume'), labelLeftX, bgmRowY, 100, 28, 20, TEXT_PRIMARY);
    const bgmTrack = this.buildVolumeSlider(panel, 40, bgmRowY, 220, state.bgmVolume, (vol) => {
      MenuProgress.setBgmVolume(vol);
      onMenuVolumesChanged();
      if (this.settingsRefs?.bgmLabel) this.settingsRefs.bgmLabel.string = `${vol}%`;
      syncServerProfile(MenuProgress.load());
    });
    const bgmLabel = this.makeLabel(panel, `${state.bgmVolume}%`, 200, bgmRowY, 60, 28, 20, TEXT_PRIMARY);

    const sfxRowY = contentY - 92;
    this.makeLabel(panel, t('menu.settings.sfxVolume'), labelLeftX, sfxRowY, 100, 28, 20, TEXT_PRIMARY);
    const sfxTrack = this.buildVolumeSlider(panel, 40, sfxRowY, 220, state.sfxVolume, (vol) => {
      MenuProgress.setSfxVolume(vol);
      onMenuVolumesChanged();
      if (this.settingsRefs?.sfxLabel) this.settingsRefs.sfxLabel.string = `${vol}%`;
      syncServerProfile(MenuProgress.load());
    });
    const sfxLabel = this.makeLabel(panel, `${state.sfxVolume}%`, 200, sfxRowY, 60, 28, 20, TEXT_PRIMARY);

    const langRowY = contentY - 168;
    this.makeLabel(panel, t('menu.settings.lang'), labelLeftX, langRowY, 80, 28, 20, TEXT_PRIMARY);

    const curLang = getLang();
    const zhBtn = this.makeRectButton(panel, 10, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchLang('zh'));
    this.makeLabel(zhBtn.node, t('menu.settings.langZh'), 0, 0, 100, 40, 18, TEXT_PRIMARY);

    const enBtn = this.makeRectButton(panel, 130, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchLang('en'));
    this.makeLabel(enBtn.node, t('menu.settings.langEn'), 0, 0, 100, 40, 18, TEXT_PRIMARY);

    this.settingsRefs = {
      bgmFill: bgmTrack.fill,
      bgmThumb: bgmTrack.thumb,
      bgmLabel,
      sfxFill: sfxTrack.fill,
      sfxThumb: sfxTrack.thumb,
      sfxLabel,
      langZhBtn: zhBtn,
      langEnBtn: enBtn,
    };
    this.refreshLangButtons(curLang);
  }

  private buildVolumeSlider(
    panel: Node, centerX: number, centerY: number, width: number, initial: number,
    onChange: (vol: number) => void,
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
      onChange(vol);
      refreshBar(vol);
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
    syncServerProfile(MenuProgress.load());
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
    this.authNameLabel = null;
    this.authStatusLabel = null;
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
    drawFieldPanel(pg, panelW, panelH, MODAL_PANEL_BG, MODAL_PANEL_BORDER, MENU_DIVIDER);
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

  private closeModal(force = false) {
    if (!force && this.modalRoot?.name === 'AuthGate' && !getAuthSession()) {
      this.setAuthStatus(authText('auth.error.chooseMode'), false);
      return;
    }
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
      drawFieldPanel(g, w, h, c, opts?.border ? BTN_LEVEL_BORDER : MENU_DIVIDER, TEXT_TITLE);
    };
    redraw(color);

    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      playUiClick();
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
      g.fillColor = new Color(0, 0, 0, 70);
      g.circle(2, -3, r);
      g.fill();
      g.fillColor = c;
      g.strokeColor = ICON_BTN_BORDER;
      g.lineWidth = 2;
      g.circle(0, 0, r);
      g.fill();
      g.stroke();
      g.strokeColor = new Color(230, 215, 160, 110);
      g.lineWidth = 1;
      g.circle(0, 0, r - 5);
      g.stroke();
    };
    redraw(ICON_BTN_BG);

    const label = this.makeLabel(n, iconText, 0, 0, r * 2, r * 2, r + 2, TEXT_PRIMARY);

    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      playUiClick();
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

function drawFieldPanel(g: Graphics, w: number, h: number, fill: Color, border: Color, accent: Color) {
  const x = -w / 2;
  const y = -h / 2;
  g.fillColor = new Color(0, 0, 0, 70);
  g.rect(x + 4, y - 5, w, h);
  g.fill();
  g.fillColor = fill;
  g.rect(x, y, w, h);
  g.fill();
  g.fillColor = new Color(255, 242, 190, 22);
  g.rect(x + 4, h / 2 - 18, w - 8, 10);
  g.fill();
  g.strokeColor = border;
  g.lineWidth = 2;
  g.rect(x + 1, y + 1, w - 2, h - 2);
  g.stroke();
  g.strokeColor = new Color(20, 22, 18, 180);
  g.lineWidth = 1;
  g.rect(x + 6, y + 6, w - 12, h - 12);
  g.stroke();
  g.strokeColor = accent;
  g.lineWidth = 2;
  const l = Math.min(24, Math.max(10, Math.min(w, h) * 0.18));
  g.moveTo(x + 8, y + h - 8); g.lineTo(x + 8 + l, y + h - 8);
  g.moveTo(x + 8, y + h - 8); g.lineTo(x + 8, y + h - 8 - l);
  g.moveTo(x + w - 8, y + h - 8); g.lineTo(x + w - 8 - l, y + h - 8);
  g.moveTo(x + w - 8, y + h - 8); g.lineTo(x + w - 8, y + h - 8 - l);
  g.moveTo(x + 8, y + 8); g.lineTo(x + 8 + l, y + 8);
  g.moveTo(x + 8, y + 8); g.lineTo(x + 8, y + 8 + l);
  g.moveTo(x + w - 8, y + 8); g.lineTo(x + w - 8 - l, y + 8);
  g.moveTo(x + w - 8, y + 8); g.lineTo(x + w - 8, y + 8 + l);
  g.stroke();
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
    const raw = readActiveSaveRaw();
    if (!raw) return null;
    return JSON.parse(raw) as SaveData;
  } catch (e) {
    console.warn('[Menu] 存档读取失败', e);
    return null;
  }
}

interface AuthSession {
  mode: LoginMode;
  username: string;
}

interface AuthAccount {
  username: string;
  password: string;
}

const AUTH_SESSION_KEY = 'lone_sherman_auth_session_v1';
const AUTH_ACCOUNTS_KEY = 'lone_sherman_auth_accounts_v1';
let memoryAuthSession: AuthSession | null = null;
let memoryAuthAccounts: AuthAccount[] = [];

function getAuthSession(): AuthSession | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return memoryAuthSession;
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return memoryAuthSession;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (parsed.mode !== 'online' && parsed.mode !== 'offline') return null;
    return {
      mode: parsed.mode,
      username: typeof parsed.username === 'string' ? parsed.username : '',
    };
  } catch (e) {
    console.warn('[Menu] auth session read failed', e);
    return null;
  }
}

function setAuthSession(s: AuthSession): void {
  memoryAuthSession = s;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('[Menu] auth session write failed', e);
  }
}

function loadAuthAccounts(): AuthAccount[] {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return memoryAuthAccounts;
    const raw = localStorage.getItem(AUTH_ACCOUNTS_KEY);
    if (!raw) return memoryAuthAccounts;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return memoryAuthAccounts;
    return parsed
      .filter((a): a is AuthAccount => !!a && typeof a.username === 'string' && typeof a.password === 'string')
      .map(a => ({ username: a.username, password: a.password }));
  } catch (e) {
    console.warn('[Menu] auth accounts read failed', e);
    return memoryAuthAccounts;
  }
}

function writeAuthAccounts(accounts: AuthAccount[]): void {
  memoryAuthAccounts = accounts;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.warn('[Menu] auth accounts write failed', e);
  }
}

function normalizeAuthName(name: string): string {
  return name.trim().toLowerCase();
}

function hasAuthAccount(name: string): boolean {
  const key = normalizeAuthName(name);
  return loadAuthAccounts().some(a => normalizeAuthName(a.username) === key);
}

function verifyAuthAccount(name: string, password: string): boolean {
  const key = normalizeAuthName(name);
  const account = loadAuthAccounts().find(a => normalizeAuthName(a.username) === key);
  return !!account && account.password === password;
}

function saveAuthAccount(name: string, password: string): void {
  const accounts = loadAuthAccounts();
  accounts.push({ username: name.trim(), password });
  writeAuthAccounts(accounts);
}

function buildCurrentServerProfile(): ServerProfile {
  return {
    menuState: MenuProgress.load(),
    settings: null,
  };
}

function applyServerProfile(profile?: ServerProfile): void {
  if (!profile) return;
  if (profile.menuState) {
    MenuProgress.replace(profile.menuState);
  }
}

function serverAuthMessageKey(code?: string): string {
  switch (code) {
    case 'BAD_PASSWORD': return 'auth.error.password';
    case 'ACCOUNT_EXISTS': return 'auth.error.accountExists';
    case 'NETWORK_ERROR': return 'auth.error.network';
    case 'NETWORK_TIMEOUT': return 'auth.error.timeout';
    default: return 'auth.error.server';
  }
}

const AUTH_EXTRA_ZH: Record<string, string> = {
  'auth.error.password': '密码不正确',
  'auth.error.passwordEmpty': '请输入密码',
  'auth.error.passwordConfirm': '两次输入的密码不一致',
  'auth.error.accountExists': '该账号已存在，请返回登录',
  'auth.error.network': '无法连接服务器，请确认 server 已启动',
  'auth.error.timeout': '服务器响应超时',
  'auth.error.server': '服务器错误：{msg}',
  'auth.login.busy': '正在登录...',
  'auth.register.busy': '正在注册...',
  'auth.register.title': '注册账号',
  'auth.register.subtitle': '未找到该账号。你可以直接注册一个新账号，账号名已为你填好，也可以手动修改。',
  'auth.register.confirm': '确认密码',
  'auth.register.confirmPlaceholder': '再次输入密码',
  'auth.register.button': '注册并登录',
  'auth.register.back': '返回登录',
  'auth.register.ok': '注册成功：{name}',
  'auth.register.prefill': '已填入刚才输入的账号：{name}',
};

const AUTH_EXTRA_EN: Record<string, string> = {
  'auth.error.password': 'Incorrect password',
  'auth.error.passwordEmpty': 'Enter a password',
  'auth.error.passwordConfirm': 'Passwords do not match',
  'auth.error.accountExists': 'This account already exists; return to sign in',
  'auth.error.network': 'Cannot connect to server. Make sure server is running.',
  'auth.error.timeout': 'Server timed out',
  'auth.error.server': 'Server error: {msg}',
  'auth.login.busy': 'Signing in...',
  'auth.register.busy': 'Creating account...',
  'auth.register.title': 'Create Account',
  'auth.register.subtitle': 'Account not found. Create a new account below; the name is prefilled and can be changed.',
  'auth.register.confirm': 'Confirm',
  'auth.register.confirmPlaceholder': 'Enter password again',
  'auth.register.button': 'Create & Sign In',
  'auth.register.back': 'Back',
  'auth.register.ok': 'Account created: {name}',
  'auth.register.prefill': 'Prefilled from your login attempt: {name}',
};

function authText(key: string, params?: Record<string, string | number>): string {
  const zh: Record<string, string> = {
    'auth.title': '选择游玩模式',
    'auth.subtitle': '登录后可同步关卡进度、游戏存档和音量设置；离线模式保持当前本地玩法。',
    'auth.login.title': '账号登录',
    'auth.login.desc': '适合长期存档和跨设备同步。',
    'auth.username': '账号',
    'auth.password': '密码',
    'auth.username.placeholder': '输入账号',
    'auth.password.placeholder': '输入密码',
    'auth.login.button': '登录并进入',
    'auth.login.ok': '已登录：{name}',
    'auth.error.username': '请输入账号后再登录',
    'auth.error.chooseMode': '请选择登录或离线模式',
    'auth.offline.title': '离线作战',
    'auth.offline.desc': '不连接服务器，直接进入游戏。进度、存档和设置继续保存在本机，行为与现在一致。',
    'auth.offline.button': '离线进入',
    'auth.offline.ok': '已进入离线模式',
    'auth.badge.none': '未选择模式',
    'auth.badge.online': '账号：{name}',
    'auth.badge.offline': '离线模式',
    'auth.defaultUser': '玩家',
  };
  const en: Record<string, string> = {
    'auth.title': 'Choose Play Mode',
    'auth.subtitle': 'Sign in to sync progress, saves, and volume settings. Offline keeps the current local flow.',
    'auth.login.title': 'Account Login',
    'auth.login.desc': 'Best for long-term saves and cross-device sync.',
    'auth.username': 'Account',
    'auth.password': 'Password',
    'auth.username.placeholder': 'Enter account',
    'auth.password.placeholder': 'Enter password',
    'auth.login.button': 'Sign In',
    'auth.login.ok': 'Signed in: {name}',
    'auth.error.username': 'Enter an account first',
    'auth.error.chooseMode': 'Choose login or offline mode',
    'auth.offline.title': 'Offline',
    'auth.offline.desc': 'No server connection. Progress, saves, and settings stay on this device, just like the current game.',
    'auth.offline.button': 'Play Offline',
    'auth.offline.ok': 'Offline mode selected',
    'auth.badge.none': 'No mode selected',
    'auth.badge.online': 'Account: {name}',
    'auth.badge.offline': 'Offline mode',
    'auth.defaultUser': 'Player',
  };
  const dict = getLang() === 'en' ? en : zh;
  const extra = getLang() === 'en' ? AUTH_EXTRA_EN : AUTH_EXTRA_ZH;
  let s = dict[key] ?? extra[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split('{' + k + '}').join(String(params[k]));
    }
  }
  return s;
}
