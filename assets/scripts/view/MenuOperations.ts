import {
  BlockInputEvents, Color, EventTouch, Graphics, HorizontalTextAlignment, JsonAsset,
  Label, Mask, Node, ScrollView, UITransform, Vec2, Vec3, VerticalTextAlignment, resources,
} from 'cc';
import { t } from '../core/Lang';
import { BUILD_FEATURES } from '../core/BuildProfile';
import { CAMPAIGNS, getCampaign } from '../core/CampaignDB';
import { getChapterLevels, getRandomMissionLevels, LevelMeta, MenuProgress } from '../core/LevelDB';
import { CustomMissionStore } from '../core/CustomMissionStore';
import { GameMode } from '../core/GameMode';
import type { MissionData, TileDef } from '../core/types';
import { axialToPixel, offsetToAxial } from '../core/HexGrid';
import { bindButtonPressScale } from './ButtonFeedback';
import { createMenuBackground } from './MenuBackground';
import { playUiClick } from '../audio/GameAudio';

const C = {
  bg: new Color(14, 22, 19), panel: new Color(25, 35, 28), inset: new Color(11, 18, 15),
  gold: new Color(227, 199, 129), muted: new Color(163, 177, 158), text: new Color(236, 239, 223),
  line: new Color(89, 103, 70), active: new Color(99, 77, 30), idle: new Color(40, 53, 40),
};

export interface OperationsActions {
  back(): void;
  start(level: LevelMeta): void;
  mode(): GameMode;
  setMode(mode: GameMode): void;
  editor(): void;
  tankDebug(): void;
  tankPicker(): void;
}

/** Fullscreen menu pages. Selecting an item never starts or generates a mission. */
export class MenuOperations {
  private root: Node | null = null;
  private body: Node | null = null;
  private preview: Node | null = null;
  private selectionToken = 0;
  private selected: LevelMeta | null = null;
  private kind: 'mission' | 'campaign' = 'mission';
  private tab = 'europe';
  private testing = false;

  constructor(private parent: Node, private actions: OperationsActions) {}

  close() {
    this.selectionToken++;
    if (this.root?.isValid) {
      this.root.active = false;
      this.root.destroy();
    }
    this.root = this.body = this.preview = null;
    this.selected = null;
  }

  private page(title: string, subtitle: string): Node {
    this.close();
    const root = this.node(this.parent, 'OperationsPage', 0, 0, 1280, 720);
    this.root = root;
    const bg = createMenuBackground(root, 'PageBackground');
    bg.addComponent(BlockInputEvents);
    this.button(root, 'Back', t('menu.operations.back'), -542, 313, 130, 42, () => {
      this.close();
      this.actions.back();
    });
    this.label(root, title, -235, 321, 440, 38, 31, C.gold, true);
    this.label(root, subtitle, 266, 311, 658, 40, 16, C.muted);
    return root;
  }

  open(kind: 'mission' | 'campaign', tab = 'europe') {
    this.testing = false;
    this.kind = kind;
    this.tab = tab;
    const root = this.page(t(`menu.operations.${kind}`), t('menu.operations.selectHint'));
    if (kind === 'mission') {
      const tabs = ['europe', 'pacific', 'random', 'custom'];
      tabs.forEach((id, i) => this.button(root, `Tab_${id}`, t(`menu.operations.tab.${id}`),
        -450 + i * 300, 228, 282, 46, () => this.open('mission', id), id === tab));
    } else {
      this.label(root, t('menu.operations.campaignHint'), 0, 228, 1140, 38, 18, C.muted);
    }
    this.body = this.node(root, 'SelectionBody', 0, 0, 1280, 720);
    this.panel(this.body, 'MissionListPanel', -400, -58, 416, 498, C.panel);
    this.label(this.body, t('menu.operations.catalog'), -400, 158, 374, 28, 16, C.gold, true);
    this.panel(this.body, 'PreviewPanel', 220, -58, 776, 498, C.panel);
    const levels = kind === 'campaign'
      ? CAMPAIGNS.slice().sort((a, b) => a.order - b.order).map(c => ({
        chapterId: 'campaign', id: c.levelId, titleKey: c.titleKey, missionId: c.missionId,
        missionPath: '', entryKind: 'campaign' as const, campaignId: c.id, alwaysUnlocked: true,
      }))
      : tab === 'random' ? getRandomMissionLevels()
        : getChapterLevels(tab).filter(level => level.entryKind !== 'editor');
    const content = this.scroll(this.body, 'MissionList', -400, -71, 392, 416,
      Math.max(416, levels.length * 63));
    const buttons: Array<{ node: Node; draw(active: boolean): void }> = [];
    levels.forEach((level, i) => {
      const completed = MenuProgress.isCompleted(level.id, level.chapterId);
      const title = level.titleOverride ?? t(level.titleKey);
      const button = this.button(content, `Mission_${level.chapterId}_${level.id}`,
        `${String(i + 1).padStart(2, '0')}   ${title}`,
        0, -31 - i * 63, 376, 54, () => {
          buttons.forEach((b, index) => b.draw(index === i));
          this.select(level);
        }, i === 0, 18, true);
      // Reserve a separate right-hand slot so completion never replaces the ID.
      const titleNode = button.node.getChildByName('Text')!;
      titleNode.setPosition(-18, 0);
      titleNode.getComponent(UITransform)!.setContentSize(312, 46);
      if (completed) this.label(button.node, '★', 160, 0, 28, 46, 20, C.gold);
      buttons.push(button);
    });
    if (levels.length) this.select(levels[0]);
    else {
      this.label(this.body, t('menu.operations.empty'), 220, 36, 696, 74, 24, C.gold);
      this.label(this.body, t('menu.operations.emptyHint'), 220, -36, 650, 68, 18, C.muted);
      if (tab === 'custom') this.button(this.body, 'CreateMission', t('menu.operations.editor'),
        220, -123, 230, 48, () => this.actions.editor());
    }
    this.label(root, t('menu.operations.saveHint'), 0, -335, 1170, 26, 14, C.muted);
  }

  openTests() {
    this.testing = true;
    const root = this.page(t('menu.operations.tests'), t('menu.operations.testsHint'));
    const tools: Array<{ id: string; title: string; desc: string; run(): void }> = [];
    if (BUILD_FEATURES.tankVisualDebugger) tools.push({ id: 'TankDebug', title: 'menu.operations.tankDebug', desc: 'menu.operations.tankDebugHint', run: this.actions.tankDebug });
    if (BUILD_FEATURES.playerTankSelection) tools.push({ id: 'TankPicker', title: 'menu.tankSelect.title', desc: 'menu.operations.tankPickerHint', run: this.actions.tankPicker });
    if (BUILD_FEATURES.testChapter) {
      const test = getChapterLevels('test').find(level => level.entryKind !== 'random');
      if (test) tools.push({ id: 'TestBattle', title: 'level.test.title', desc: 'menu.operations.testBattleHint', run: () => this.actions.start(test) });
    }
    tools.forEach((tool, i) => {
      const x = -295 + (i % 2) * 590;
      const y = 125 - Math.floor(i / 2) * 210;
      const card = this.button(root, tool.id, '', x, y, 552, 182, tool.run);
      this.label(card.node, `0${i + 1}`, -210, 44, 70, 38, 28, C.gold, true);
      this.label(card.node, t(tool.title), 38, 43, 396, 38, 25, C.text, true);
      this.label(card.node, t(tool.desc), 0, -17, 470, 60, 18, C.muted, true);
      this.label(card.node, t('menu.operations.openTool'), 0, -65, 470, 24, 15, C.gold, true);
    });
  }

  refreshCustomCatalog() {
    if (this.root?.isValid && !this.testing && this.kind === 'mission' && this.tab === 'custom') {
      this.open('mission', 'custom');
    }
  }

  private select(level: LevelMeta) {
    this.selected = level;
    const token = ++this.selectionToken;
    if (this.preview?.isValid) { this.preview.active = false; this.preview.destroy(); }
    const preview = this.node(this.body!, 'MissionPreview', 220, -58, 744, 478);
    this.preview = preview;
    this.label(preview, level.titleOverride ?? t(level.titleKey), 0, 211, 716, 36, 26, C.gold, true);
    const loading = this.label(preview, t('menu.operations.loading'), 0, 35, 700, 40, 19, C.muted);
    const campaign = level.campaignId ? getCampaign(level.campaignId) : undefined;
    const hidden = level.entryKind === 'random' || !!campaign?.generator;
    const accept = (missions: MissionData[], error?: Error | null) => {
      if (token !== this.selectionToken || !preview.isValid || !this.root?.isValid) return;
      loading.node.destroy();
      if (error || (!hidden && !missions.length)) {
        this.label(preview, t('menu.operations.loadError'), 0, 20, 680, 80, 20, C.gold);
        this.button(preview, 'RetryPreview', t('menu.operations.retry'), 0, -80, 180, 44, () => this.select(level));
        return;
      }
      this.renderPreview(preview, level, missions, hidden);
    };
    if (hidden) { accept([]); return; }
    if (level.entryKind === 'custom') {
      const pkg = level.customPackageId ? CustomMissionStore.load(level.customPackageId) : null;
      accept(pkg ? [pkg.mission] : []);
      return;
    }
    const paths = campaign ? campaign.segments.map(s => s.missionPath) : [level.missionPath];
    Promise.all(paths.map(path => new Promise<MissionData>((resolve, reject) => {
      resources.load(path, JsonAsset, (error, asset) => {
        if (error || !asset) reject(error ?? new Error(path));
        else resolve(asset.json as MissionData);
      });
    }))).then(missions => accept(missions), error => accept([], error));
  }

  private renderPreview(parent: Node, level: LevelMeta, missions: MissionData[], hidden: boolean) {
    const campaign = level.campaignId ? getCampaign(level.campaignId) : undefined;
    const mapCount = campaign?.generator ? 3 : campaign ? campaign.segments.length : 1;
    const mapW = 708 / mapCount;
    for (let i = 0; i < mapCount; i++) {
      const frame = this.panel(parent, `MapPreview_${i}`, -354 + mapW * (i + 0.5), 87, mapW - 8, 188, C.inset);
      this.drawMap(frame, missions[i], hidden, mapW - 30, 158, !!campaign);
      if (campaign) this.label(frame, `${i + 1} / ${mapCount}`, 0, -79, mapW - 16, 18, 12, C.gold);
    }
    const counts = new Map<string, number>();
    missions.forEach(mission => mission.enemies.forEach(enemy => counts.set(enemy.kind, (counts.get(enemy.kind) ?? 0) + 1)));
    const enemies = hidden ? t('menu.operations.unknownEnemies')
      : Array.from(counts.entries()).map(([kind, count]) => `${t(`unit.name.${kind}`)} × ${count}`).join('    ') || t('menu.operations.noEnemies');
    const description = hidden ? t('menu.operations.randomDescription')
      : missions.map((m, i) => `${campaign ? `${i + 1}. ` : ''}${this.briefing(m, level.entryKind === 'custom')}`).join('\n\n');
    this.label(parent, t('menu.operations.briefing'), 0, -24, 696, 24, 15, C.gold, true);
    const contentHeight = Math.max(70, 26 * (description.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 36)), 0)));
    const content = this.scroll(parent, 'BriefingScroll', 0, -76, 704, 70, contentHeight);
    const brief = this.label(content, description, 0, -contentHeight / 2, 680, contentHeight, 17, C.text, true);
    brief.verticalAlign = VerticalTextAlignment.TOP;
    brief.lineHeight = 26;
    this.label(parent, `${t('menu.operations.enemies')}  ·  ${enemies}`, 0, -142, 696, 48, 17, C.text, true);
    if (campaign) {
      this.label(parent, t('menu.operations.hardcoreOnly'), -179, -198, 338, 44, 18, C.gold, true);
    } else if (BUILD_FEATURES.gameModeSelection) {
      let classic: ReturnType<MenuOperations['button']>;
      let hardcore: ReturnType<MenuOperations['button']>;
      const change = (mode: GameMode) => {
        this.actions.setMode(mode);
        classic.draw(mode === 'classic'); hardcore.draw(mode === 'hardcore');
      };
      classic = this.button(parent, 'ClassicMode', t('menu.mode.classic'), -273, -198, 150, 44,
        () => change('classic'), this.actions.mode() === 'classic', 17);
      hardcore = this.button(parent, 'HardcoreMode', t('menu.mode.hardcore'), -111, -198, 150, 44,
        () => change('hardcore'), this.actions.mode() === 'hardcore', 17);
    } else this.label(parent, t('menu.mode.hardcore'), -200, -198, 280, 40, 18, C.gold);
    const unlocked = level.alwaysUnlocked || level.entryKind === 'custom' || level.entryKind === 'random'
      || MenuProgress.isUnlocked(level.id, level.chapterId);
    this.button(parent, 'StartMission', t(unlocked ? (campaign ? 'menu.operations.startCampaign' : 'menu.operations.startMission') : 'menu.operations.locked'),
      231, -198, 236, 48, () => { if (unlocked && this.selected === level) this.actions.start(level); }, true, 21);
  }

  private drawMap(parent: Node, mission: MissionData | undefined, hidden: boolean, width: number, height: number, playableOnly = false) {
    const root = this.node(parent, 'HexMap', 0, 4, width, height);
    const g = root.addComponent(Graphics);
    const cells: Array<{ x: number; y: number; tile: TileDef | null }> = [];
    const rows = hidden ? 6 : mission!.rows;
    const cols = hidden ? 8 : mission!.cols;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const tile = hidden ? null : mission!.tiles[row]?.[col];
      if (!hidden && !tile) continue;
      if (!hidden && playableOnly && tile?.disp) continue;
      const p = axialToPixel(offsetToAxial({ col, row }, mission?.rowParityOffset ?? 0), 1);
      cells.push({ x: p.x, y: -p.y, tile: tile ?? null });
    }
    if (!cells.length) return;
    const minX = Math.min(...cells.map(c => c.x)) - Math.sqrt(3) / 2;
    const maxX = Math.max(...cells.map(c => c.x)) + Math.sqrt(3) / 2;
    const minY = Math.min(...cells.map(c => c.y)) - 1;
    const maxY = Math.max(...cells.map(c => c.y)) + 1;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
    const palette: Record<string, number[]> = {
      f: [105, 122, 65], r: [147, 138, 106], m: [103, 79, 52], F: [40, 77, 45],
      w: [46, 88, 110], dw: [25, 55, 75], c: [167, 157, 114], T: [54, 103, 64],
      B: [187, 166, 114], H: [120, 121, 114], a: [139, 137, 120], b: [137, 111, 83],
    };
    cells.forEach(cell => {
      const x = (cell.x - (minX + maxX) / 2) * scale;
      const y = (cell.y - (minY + maxY) / 2) * scale;
      const rgb = hidden ? [0, 0, 0] : mission?.season === 'winter' && !['w', 'dw'].includes(cell.tile!.t)
        ? [170, 183, 177] : palette[cell.tile!.t] ?? [90, 100, 70];
      g.fillColor = new Color(rgb[0], rgb[1], rgb[2]);
      g.strokeColor = hidden ? new Color(60, 64, 58) : new Color(20, 29, 22);
      g.lineWidth = Math.max(0.5, scale * 0.045);
      const points = Array.from({ length: 6 }, (_, i) => {
        const a = (30 + i * 60) * Math.PI / 180;
        return { x: x + Math.cos(a) * scale * 0.96, y: y + Math.sin(a) * scale * 0.96 };
      });
      points.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
      g.close(); g.fill(); g.stroke();
      if (hidden) return;
      if (cell.tile?.rd || cell.tile?.br) {
        g.strokeColor = new Color(201, 188, 142); g.lineWidth = Math.max(1, scale * 0.18);
        for (let d = 0; d < 6; d++) if (cell.tile.rd?.[d] === '1' || cell.tile.br?.includes(d)) {
          const a = -d * Math.PI / 3;
          g.moveTo(x, y); g.lineTo(x + Math.cos(a) * scale * 0.84, y + Math.sin(a) * scale * 0.84); g.stroke();
        }
      }
      if (cell.tile?.bd || cell.tile?.t === 'b') {
        g.fillColor = new Color(222, 199, 145);
        g.rect(x - scale * 0.23, y - scale * 0.2, scale * 0.46, scale * 0.4); g.fill();
      }
      if (cell.tile?.disp) {
        g.fillColor = new Color(0, 0, 0, 120);
        points.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
        g.close(); g.fill();
      }
    });
  }

  private briefing(mission: MissionData, custom: boolean): string {
    // Several bundled legacy descriptions contain encoding damage and editor coordinates.
    // Derive player-facing briefings from the actual objective, preserving custom authors' text.
    if (custom && mission.description) return mission.description;
    const objective = mission.objective;
    const kinds = objective.kinds?.length ? objective.kinds : objective.kind ? [objective.kind] : [];
    let goal = '';
    if (objective.type === 'destroy_all_enemies' || objective.destroyAllEnemiesBeforeEvac) {
      goal = t('menu.operations.destroyAll');
    } else if (objective.type === 'destroy_truck') {
      goal = t('menu.operations.destroyTargets', { targets: t('unit.name.truck') });
    } else if (kinds.length) {
      goal = t('menu.operations.destroyTargets', { targets: kinds.map(kind => t(`unit.name.${kind}`)).join(' / ') });
    }
    if (['destroy_kind_evac', 'destroy_truck', 'exit_from_edge'].includes(objective.type)) {
      goal += `${goal ? ' ' : ''}${t('menu.operations.evacuate')}`;
    }
    return `${goal}\n${t('menu.operations.mapSize', { cols: mission.cols, rows: mission.rows })}`;
  }

  private node(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const node = new Node(name); node.layer = parent.layer;
    node.addComponent(UITransform).setContentSize(w, h);
    node.setPosition(x, y); parent.addChild(node); return node;
  }

  private panel(parent: Node, name: string, x: number, y: number, w: number, h: number, fill: Color): Node {
    const node = this.node(parent, name, x, y, w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = fill; g.strokeColor = C.line; g.lineWidth = 1;
    g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke(); return node;
  }

  private label(parent: Node, text: string, x: number, y: number, w: number, h: number, size: number, color: Color, left = false): Label {
    const node = this.node(parent, 'Text', x, y, w, h);
    const label = node.addComponent(Label);
    label.string = text; label.fontSize = size; label.lineHeight = size + 6; label.color = color;
    label.horizontalAlign = left ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.enableWrapText = true; label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private button(parent: Node, name: string, text: string, x: number, y: number, w: number, h: number, run: () => void, active = false, size = 20, left = false) {
    const node = this.node(parent, name, x, y, w, h);
    const g = node.addComponent(Graphics);
    const label = this.label(node, text, 0, 0, w - 28, h - 8, size, C.text, left);
    const draw = (chosen: boolean) => {
      g.clear(); g.fillColor = chosen ? C.active : C.idle; g.strokeColor = chosen ? C.gold : C.line;
      g.lineWidth = chosen ? 2 : 1; g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
      if (chosen) { g.fillColor = C.gold; g.rect(-w / 2, -h / 2, 4, h); g.fill(); }
      label.color = chosen ? C.gold : C.text;
    };
    draw(active); bindButtonPressScale(node);
    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; playUiClick(); run(); });
    return { node, draw };
  }

  private scroll(parent: Node, name: string, x: number, y: number, w: number, h: number, contentH: number): Node {
    const view = this.node(parent, name, x, y, w, h);
    view.addComponent(Mask);
    const scroll = view.addComponent(ScrollView);
    scroll.horizontal = false; scroll.vertical = true; scroll.inertia = true;
    scroll.cancelInnerEvents = true;
    const content = this.node(view, 'Content', 0, h / 2, w, contentH);
    content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    scroll.content = content;
    if (name === 'MissionList' && contentH > h) {
      const rail = this.node(parent, 'MissionListScrollbar', x + w / 2 + 3, y, 16, h);
      const graphics = rail.addComponent(Graphics);
      const thumbH = Math.max(36, h * h / contentH);
      const travel = h - thumbH;
      const maxOffset = contentH - h;
      const offset = () => Math.max(0, Math.min(maxOffset, scroll.getScrollOffset().y));
      const thumbTop = () => h / 2 - offset() / maxOffset * travel;
      const redraw = () => {
        graphics.clear();
        graphics.fillColor = C.idle;
        graphics.roundRect(-5, -h / 2, 10, h, 5); graphics.fill();
        graphics.fillColor = C.gold;
        graphics.roundRect(-5, thumbTop() - thumbH, 10, thumbH, 5); graphics.fill();
      };
      const localY = (event: EventTouch) => {
        const point = event.getUILocation();
        return rail.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0)).y;
      };
      let dragging = false, startY = 0, startOffset = 0;
      rail.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
        event.propagationStopped = true;
        scroll.stopAutoScroll();
        startY = localY(event);
        const top = thumbTop();
        if (startY > top || startY < top - thumbH) {
          const ratio = Math.max(0, Math.min(1, (h / 2 - thumbH / 2 - startY) / travel));
          scroll.scrollToOffset(new Vec2(0, ratio * maxOffset), 0);
        }
        startOffset = offset(); dragging = true; redraw();
      });
      rail.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
        event.propagationStopped = true;
        if (!dragging) return;
        const next = Math.max(0, Math.min(maxOffset, startOffset + (startY - localY(event)) / travel * maxOffset));
        scroll.scrollToOffset(new Vec2(0, next), 0); redraw();
      });
      const stop = (event: EventTouch) => { event.propagationStopped = true; dragging = false; };
      rail.on(Node.EventType.TOUCH_END, stop);
      rail.on(Node.EventType.TOUCH_CANCEL, stop);
      view.on(ScrollView.EventType.SCROLLING, redraw);
      view.on(ScrollView.EventType.SCROLL_ENDED, redraw);
      redraw();
    }
    return content;
  }
}
