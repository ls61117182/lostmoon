import { BlockInputEvents, Color, Graphics, HorizontalTextAlignment, Label, Node, UITransform, VerticalTextAlignment } from 'cc';
import { BattleStatistics, battleStatisticRate } from '../core/BattleStatistics';
import { t } from '../core/Lang';
import { bindButtonPressScale } from './ButtonFeedback';
import { playUiClick } from '../audio/GameAudio';

const TEXT = new Color(235, 232, 215);
const MUTED = new Color(163, 174, 156);
const GOLD = new Color(225, 196, 117);
const RED = new Color(224, 133, 119);

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
  private note: Label;
  private retry: Label;
  private menu: Label;
  private accent: Graphics;
  private panel: Node;
  private dim: Graphics;

  constructor(
    parent: Node, onRetry: () => void, onMenu: () => void,
    visibleSize: { width: number; height: number } = { width: 1280, height: 720 },
  ) {
    this.root = this.node(parent, 'BattleOutcome', 0, 0, 1280, 720);
    this.root.addComponent(BlockInputEvents);
    this.dim = this.root.addComponent(Graphics);
    const panel = this.panel = this.node(this.root, 'Report', 0, 0, 880, 600);
    this.layout(visibleSize);
    this.box(panel, 880, 600, new Color(27, 34, 28), new Color(102, 116, 88));
    this.accent = this.node(panel, 'ResultAccent', 0, 0, 880, 600).addComponent(Graphics);
    this.title = this.label(panel, 'Result', 0, 238, 780, 68, 48, GOLD);
    this.subtitle = this.label(panel, 'Scope', 0, 187, 790, 34, 19, MUTED);
    this.receivedTitle = this.label(panel, 'ReceivedTitle', -295, 143, 220, 28, 19, GOLD, false);
    for (let i = 0; i < 3; i++) {
      const tile = this.node(panel, `Received${i}`, -270 + i * 270, 72, 252, 104);
      this.box(tile, 252, 104, new Color(36, 44, 35));
      this.receivedValues.push(this.label(tile, 'Count', 0, 15, 220, 48, 36, i === 2 ? RED : TEXT));
      this.receivedLabels.push(this.label(tile, 'Caption', 0, -29, 230, 28, 18, MUTED));
    }
    const main = this.node(panel, 'MainGun', -135, -83, 522, 164);
    const mg = this.node(panel, 'MachineGun', 270, -83, 252, 164);
    this.box(main, 522, 164, new Color(36, 44, 35));
    this.box(mg, 252, 164, new Color(36, 44, 35));
    this.mainTitle = this.label(main, 'Title', 0, 56, 480, 28, 20, GOLD);
    this.mgTitle = this.label(mg, 'Title', 0, 56, 230, 28, 20, GOLD);
    for (let i = 0; i < 3; i++) {
      const host = i < 2 ? main : mg;
      const x = i < 2 ? -131 + i * 262 : 0;
      this.rateValues.push(this.label(host, `Rate${i}`, x, 12, 230, 48, 36, TEXT));
      this.rateLabels.push(this.label(host, `Caption${i}`, x, -26, 230, 26, 18, MUTED));
      this.fractions.push(this.label(host, `Fraction${i}`, x, -56, 238, 23, 15, MUTED));
    }
    this.note = this.label(panel, 'CountingRules', 0, -199, 790, 56, 16, MUTED);
    this.note.enableWrapText = true;
    this.retry = this.button(panel, 'RestartBtn', -114, -259, true, onRetry);
    this.menu = this.button(panel, 'BackToMenuBtn', 114, -259, false, onMenu);
  }

  /** The host's UITransform can be Cocos's default 100x100, not the viewport. */
  layout({ width, height }: { width: number; height: number }): void {
    this.root.getComponent(UITransform)!.setContentSize(width, height);
    const scale = Math.min(1, width / 920, height / 640);
    this.panel.setScale(scale, scale, 1);
    this.dim.clear();
    this.dim.fillColor = new Color(8, 12, 10, 218);
    this.dim.rect(-width / 2, -height / 2, width, height);
    this.dim.fill();
  }

  refresh(stats: BattleStatistics, victory: boolean, pvp: boolean, campaign: boolean, turn: number): void {
    this.root.active = true;
    this.root.setSiblingIndex(this.root.parent!.children.length - 1);
    const color = victory ? GOLD : RED;
    this.title.string = t(victory ? 'outcome.win' : 'outcome.lose');
    this.title.color = color;
    this.accent.clear();
    this.accent.fillColor = color;
    this.accent.rect(-439, 294, 878, 5);
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
    this.note.string = `${t('outcome.report.rules.main')}\n${t('outcome.report.rules.mg')}`;
    this.retry.string = t(campaign && !victory ? 'btn.retryCampaignSegment' : 'btn.restart');
    this.menu.string = t('btn.backToMenu');
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

  private button(parent: Node, name: string, x: number, y: number, primary: boolean, onClick: () => void): Label {
    const node = this.node(parent, name, x, y, 208, 48);
    this.box(node, 208, 48, primary ? new Color(81, 94, 60) : new Color(43, 52, 41), new Color(113, 128, 93));
    const label = this.label(node, 'Label', 0, 0, 190, 44, 22, TEXT);
    bindButtonPressScale(node);
    node.on(Node.EventType.TOUCH_END, () => { playUiClick(); onClick(); });
    return label;
  }
}
