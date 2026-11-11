import { _decorator, Color, Component, Graphics, Node, UITransform } from 'cc';
import { subscribeAdaptiveResolution, visibleSizeInRootSpace } from './ResolutionAdapter';
const { ccclass } = _decorator;
const BG_TOP = new Color(35, 47, 39, 255);
const BG_MID = new Color(23, 34, 28, 255);
const BG_BOTTOM = new Color(12, 20, 17, 255);
const MENU_DIVIDER = new Color(196, 163, 101, 65);

/** Shared main-menu artwork, including full-screen resize handling. */
@ccclass('MenuBackground')
export class MenuBackground extends Component {
  private rootScale = 1.5;
  private unsubscribe: (() => void) | null = null;
  configure(rootScale: number): void {
    this.rootScale = rootScale;
    this.unsubscribe = subscribeAdaptiveResolution(() => this.redraw());
    this.redraw();
  }
  private redraw(): void {
    const { width: backgroundW, height: backgroundH } = visibleSizeInRootSpace(this.rootScale);
    this.node.getComponent(UITransform)!.setContentSize(backgroundW, backgroundH);
    const g = this.node.getComponent(Graphics)!;
    g.clear();
    // 把画布纵向分成 N 段，每段取 top/bottom 间插值颜色 —— 简易渐变
    const STEPS = 64;
    for (let i = 0; i < STEPS; i++) {
      const tRatio = i / (STEPS - 1);
      const c = tRatio < 0.5
        ? lerp(BG_TOP, BG_MID, tRatio * 2)
        : lerp(BG_MID, BG_BOTTOM, (tRatio - 0.5) * 2);
      const y = backgroundH / 2 - (i + 1) * (backgroundH / STEPS);
      g.fillColor = c;
      g.rect(-backgroundW / 2, y, backgroundW, backgroundH / STEPS + 1);
      g.fill();
    }

    // 装饰线条：顶部 + 底部各一条橄榄绿
    g.strokeColor = MENU_DIVIDER;
    g.lineWidth = 1;
    g.moveTo(-backgroundW / 2 + 50, backgroundH / 2 - 60);
    g.lineTo( backgroundW / 2 - 50, backgroundH / 2 - 60);
    g.stroke();
    g.moveTo(-backgroundW / 2 + 60, -backgroundH / 2 + 60);
    g.lineTo( backgroundW / 2 - 60, -backgroundH / 2 + 60);
    g.stroke();

    // Faint operations-map grid and route marks.
    g.strokeColor = new Color(190, 201, 174, 12);
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

    g.strokeColor = new Color(196, 163, 101, 32);
    g.lineWidth = 1;
    g.moveTo(-440, 118);
    g.bezierCurveTo(-260, 190, -130, 56, 20, 112);
    g.bezierCurveTo(145, 158, 245, 40, 410, 92);
    g.stroke();
    for (const [x, y] of [[-440, 118], [-125, 78], [105, 126], [410, 92]]) {
      g.circle(x, y, 5);
      g.stroke();
    }
    // Topographic contours give the map depth without adding visual noise.
    g.strokeColor = new Color(175, 192, 151, 12);
    for (let i = 0; i < 9; i++) {
      const d = i * 24;
      g.moveTo(30 + d, -280);
      g.bezierCurveTo(-100 + d, -60, 440 + d, -70, 310 + d, 280);
      g.stroke();
    }
    // The left side stays quiet behind the home navigation and headings.
    for (let i = 0; i < 24; i++) {
      g.fillColor = new Color(7, 14, 11, 70 * (1 - i / 24));
      g.rect(-backgroundW / 2 + i * backgroundW / 36, -backgroundH / 2,
        backgroundW / 36 + 1, backgroundH); g.fill();
    }
  }
  onDestroy(): void { this.unsubscribe?.(); }
}
export function createMenuBackground(parent: Node, name = 'MenuBG', rootScale = 1.5): Node {
  const node = new Node(name);
  node.layer = parent.layer;
  node.addComponent(UITransform);
  node.addComponent(Graphics);
  parent.addChild(node);
  node.addComponent(MenuBackground).configure(rootScale);
  return node;
}
function lerp(a: Color, b: Color, tRatio: number): Color {
  const k = Math.max(0, Math.min(1, tRatio));
  return new Color(
    Math.round(a.r + (b.r - a.r) * k),
    Math.round(a.g + (b.g - a.g) * k),
    Math.round(a.b + (b.b - a.b) * k),
    Math.round(a.a + (b.a - a.a) * k),
  );
}

