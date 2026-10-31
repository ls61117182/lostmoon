import { BlockInputEvents, Color, Graphics, HorizontalTextAlignment, Label, Mask, Node, ScrollView, UITransform, VerticalTextAlignment } from 'cc';
import { BattleCrewStatus, BattleStatistics, battleStatisticRate } from '../core/BattleStatistics';
import { t } from '../core/Lang';
import { bindButtonPressScale } from './ButtonFeedback';
import { playUiClick } from '../audio/GameAudio';

const TEXT = new Color(235, 232, 215);
const MUTED = new Color(163, 174, 156);
const GOLD = new Color(225, 196, 117);
const RED = new Color(224, 133, 119);
const PANEL_FILL = new Color(27, 34, 28, 230);
const CARD_FILL = new Color(36, 44, 35, 44);

/** A single modal owns its input mask, report and actions. */
export class BattleOutcomePanel {
  readonly root: Node;
  private title: Label;
  private subtitle: Label;
  private receivedTitle: Label;
  private receivedLabels: Label[] = [];
  private receivedValues: Label[] = [];
  private mainTitle: Label;
  private mgTitle: Label;
  private rateLabels: Label[] = [];
  private rateValues: Label[] = [];
  private fractions: Label[] = [];
  private killsTitle: Label;
  private killsContent: Node;
  private killsScroll: ScrollView;
  private killsSignature = '';
  private crewTitle: Label;
  private crewRows: Label[] = [];
  private retry: Label;
  private menu: Label;
  private viewBattlefieldLabel: Label;
  private returnReportLabel: Label;
  private viewingBattlefield = false;
  private visibleSize = { width: 1280, height: 720 };
  private accent: Graphics;
  private panel: Node;
  private dim: Graphics;
  private backdrop: Node;

  get isViewingBattlefield(): boolean { return this.viewingBattlefield; }

  constructor(
    parent: Node, onRetry: () => void, onMenu: () => void,
    visibleSize: { width: number; height: number } = { width: 1280, height: 720 },
    private readonly onBattlefieldViewChanged: (viewing: boolean) => void = () => {},
  ) {
    this.root = this.node(parent, 'BattleOutcome', 0, 0, 1280, 720);
    this.backdrop = this.node(this.root, 'OutcomeBackdrop', 0, 0, 1280, 720);
    this.backdrop.addComponent(BlockInputEvents);
    this.dim = this.backdrop.addComponent(Graphics);
    const panel = this.panel = this.node(this.root, 'Report', 0, 0, 1100, 640);
    this.layout(visibleSize);
    this.box(panel, 1100, 640, PANEL_FILL, new Color(102, 116, 88));
    this.accent = this.node(panel, 'ResultAccent', 0, 0, 1100, 640).addComponent(Graphics);
    this.title = this.label(panel, 'Result', 0, 268, 1000, 58, 44, GOLD);
    this.subtitle = this.label(panel, 'Scope', 0, 222, 1000, 30, 18, MUTED);
    this.receivedTitle = this.label(panel, 'ReceivedTitle', -261, 187, 510, 28, 18, GOLD);
    for (let i = 0; i < 3; i++) {
      const tile = this.node(panel, `Received${i}`, -435 + i * 174, 112, 166, 114);
      this.box(tile, 166, 114, CARD_FILL);
      this.receivedValues.push(this.label(tile, 'Count', 0, 13, 148, 48, 34, i === 2 ? RED : TEXT));
      this.receivedLabels.push(this.label(tile, 'Caption', 0, -28, 150, 28, 17, MUTED));
    }
    this.mainTitle = this.label(panel, 'MainGunTitle', 174, 187, 340, 28, 18, GOLD);
    this.mgTitle = this.label(panel, 'MachineGunTitle', 435, 187, 166, 28, 18, GOLD);
    for (let i = 0; i < 3; i++) {
      const host = this.node(panel, `WeaponRate${i}`, 87 + i * 174, 112, 166, 114);
      this.box(host, 166, 114, CARD_FILL);
      this.rateValues.push(this.label(host, `Rate${i}`, 0, 18, 150, 46, 34, TEXT));
      this.rateLabels.push(this.label(host, `Caption${i}`, 0, -17, 150, 26, 17, MUTED));
      this.fractions.push(this.label(host, `Fraction${i}`, 0, -43, 154, 22, 13, MUTED));
    }
    const kills = this.node(panel, 'Kills', -195, -91, 642, 268);
    const crew = this.node(panel, 'Crew', 335, -91, 360, 268);
    this.box(kills, 642, 268, CARD_FILL);
    this.box(crew, 360, 268, CARD_FILL);
    this.killsTitle = this.label(kills, 'KillsTitle', 0, 108, 594, 28, 20, GOLD, false);
    this.crewTitle = this.label(crew, 'CrewTitle', 0, 108, 312, 28, 20, GOLD, false);
    const viewport = this.node(kills, 'KillsViewport', 0, -20, 594, 204);
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
    this.killsContent = this.node(viewport, 'KillsContent', 0, 102, 594, 204);
    this.killsContent.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    this.killsScroll = viewport.addComponent(ScrollView);
    this.killsScroll.content = this.killsContent;
    this.killsScroll.horizontal = false;
    this.killsScroll.vertical = true;
    this.killsScroll.elastic = false;
    for (let i = 0; i < 6; i++) {
      this.crewRows.push(this.label(crew, `CrewRow${i}`, 0, 66 - i * 35, 312, 30, 20, TEXT, false));
    }
    this.viewBattlefieldLabel = this.button(panel, 'ViewBattlefieldBtn', -228, -275, false,
      () => this.setViewingBattlefield(true));
    this.retry = this.button(panel, 'RestartBtn', 0, -275, true, onRetry);
    this.menu = this.button(panel, 'BackToMenuBtn', 228, -275, false, onMenu);
    this.returnReportLabel = this.button(this.root, 'ReturnReportBtn', 0, 0, true,
      () => this.setViewingBattlefield(false), 256);
    this.returnReportLabel.node.parent!.active = false;
    this.layout(visibleSize);
  }

  /** The host's UITransform can be Cocos's default 100x100, not the viewport. */
  layout({ width, height }: { width: number; height: number }): void {
    this.visibleSize = { width, height };
    this.root.getComponent(UITransform)!.setContentSize(width, height);
    this.backdrop.getComponent(UITransform)!.setContentSize(width, height);
    const scale = Math.min(1, width / 1140, height / 680);
    this.panel.setScale(scale, scale, 1);
    this.dim.clear();
    if (!this.viewingBattlefield) {
      this.dim.fillColor = new Color(8, 12, 10, 40);
      this.dim.rect(-width / 2, -height / 2, width, height);
      this.dim.fill();
    }
    this.returnReportLabel?.node.parent?.setPosition(0, -height / 2 + 44, 0);
  }

  hide(): void {
    this.root.active = false;
    this.setViewingBattlefield(false);
  }

  /** Review restores HUD/map hit testing; game-action guards keep the battle ended. */
  private setViewingBattlefield(viewing: boolean): void {
    const changed = this.viewingBattlefield !== viewing;
    this.viewingBattlefield = viewing;
    this.panel.active = !viewing;
    this.backdrop.active = !viewing;
    this.returnReportLabel.node.parent!.active = viewing;
    this.layout(this.visibleSize);
    if (changed) this.onBattlefieldViewChanged(viewing);
  }

  refresh(stats: BattleStatistics, victory: boolean, pvp: boolean, campaign: boolean, turn: number, crew: readonly BattleCrewStatus[] = []): void {
    this.root.active = true;
    this.root.setSiblingIndex(this.root.parent!.children.length - 1);
    const color = victory ? GOLD : RED;
    this.title.string = t(victory ? 'outcome.win' : 'outcome.lose');
    this.title.color = color;
    this.accent.clear();
    this.accent.fillColor = color;
    this.accent.rect(-549, 314, 1098, 5);
    this.accent.fill();
    this.subtitle.string = t('outcome.report.scope', { turn })
      + (pvp ? ` · ${t(victory ? 'outcome.pvp.win' : 'outcome.pvp.lose')}` : '');
    this.receivedTitle.string = t('outcome.report.received');
    const counts = [stats.attacksReceived, stats.hitsReceived, stats.penetrationsReceived];
    ['attacks', 'hits', 'penetrations'].forEach((key, i) => {
      this.receivedLabels[i].string = t(`outcome.report.${key}`);
      this.receivedValues[i].string = String(counts[i]);
    });
    this.mainTitle.string = t('outcome.report.mainGun');
    this.mgTitle.string = t('outcome.report.machineGun');
    const rates = [
      [stats.mainGunHits, stats.mainGunHitChecks],
      [stats.mainGunPenetrations, stats.mainGunPenetrationChecks],
      [stats.machineGunHits, stats.machineGunShots],
    ];
    rates.forEach(([hits, checks], i) => {
      this.rateValues[i].string = battleStatisticRate(hits, checks);
      this.rateLabels[i].string = t(i === 1 ? 'outcome.report.penetrationRate' : 'outcome.report.hitRate');
      this.fractions[i].string = t(i === 1 ? 'outcome.report.penFraction' : 'outcome.report.hitFraction', { hits, checks });
    });
    this.refreshKills(stats);
    this.crewTitle.string = t('outcome.report.crew');
    this.crewRows.forEach((label, i) => {
      const member = crew[i];
      label.node.active = !!member;
      if (!member) return;
      label.string = `${t(`crew.role.${member.slot}`)} — ${t(member.alive ? 'outcome.report.alive' : 'outcome.report.kia')}`;
      label.color = member.alive ? TEXT : RED;
    });
    this.retry.string = t(campaign && !victory ? 'btn.retryCampaignSegment' : 'btn.restart');
    this.menu.string = t('btn.backToMenu');
    this.viewBattlefieldLabel.string = t('outcome.report.viewBattlefield');
    this.returnReportLabel.string = t('outcome.report.returnReport');
  }

  private refreshKills(stats: BattleStatistics): void {
    const entries = Object.entries(stats.killsByKind ?? {}).filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    this.killsTitle.string = t('outcome.report.kills', { count: total });
    const lines = entries.length ? entries.map(([kind, count]) => `${t(`unit.name.${kind}`)} × ${count}`) : [t('outcome.report.noKills')];
    const signature = JSON.stringify(lines);
    if (signature === this.killsSignature) return;
    this.killsSignature = signature;
    for (const child of [...this.killsContent.children]) { child.removeFromParent(); child.destroy(); }
    const height = Math.max(204, lines.length * 32);
    this.killsContent.getComponent(UITransform)!.setContentSize(594, height);
    lines.forEach((line, i) => {
      this.label(this.killsContent, `KillRow${i}`, 0, -16 - i * 32, 594, 30, 20, entries.length ? TEXT : MUTED, false).string = line;
    });
    this.killsScroll.scrollToTop(0);
  }

  private node(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.addComponent(UITransform).setContentSize(w, h);
    node.setPosition(x, y);
    parent.addChild(node);
    return node;
  }

  private box(node: Node, w: number, h: number, fill: Color, border?: Color): void {
    const g = node.addComponent(Graphics);
    g.fillColor = fill;
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.fill();
    if (border) { g.strokeColor = border; g.lineWidth = 1; g.stroke(); }
  }

  private label(parent: Node, name: string, x: number, y: number, w: number, h: number, font: number, color: Color, center = true): Label {
    const label = this.node(parent, name, x, y, w, h).addComponent(Label);
    label.fontSize = font;
    label.lineHeight = font + 6;
    label.color = color;
    label.horizontalAlign = center ? HorizontalTextAlignment.CENTER : HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    return label;
  }

  private button(parent: Node, name: string, x: number, y: number, primary: boolean, onClick: () => void, width = 208): Label {
    const node = this.node(parent, name, x, y, width, 48);
    this.box(node, width, 48, primary ? new Color(81, 94, 60) : new Color(43, 52, 41), new Color(113, 128, 93));
    const label = this.label(node, 'Label', 0, 0, width - 18, 44, 22, TEXT);
    bindButtonPressScale(node);
    node.on(Node.EventType.TOUCH_END, () => { playUiClick(); onClick(); });
    return label;
  }
}
