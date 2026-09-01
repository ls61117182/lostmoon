import {
  _decorator,
  Color,
  Component,
  Graphics,
  Node,
  ResolutionPolicy,
  screen,
  UITransform,
  view,
} from 'cc';

const { ccclass } = _decorator;

export const DESIGN_RESOLUTION_WIDTH = 1920;
export const DESIGN_RESOLUTION_HEIGHT = 1080;
const DESIGN_ASPECT = DESIGN_RESOLUTION_WIDTH / DESIGN_RESOLUTION_HEIGHT;

type ResolutionChangeListener = () => void;

const listeners = new Set<ResolutionChangeListener>();
let listeningForResize = false;

/**
 * Keep the full 16:9 composition visible while exposing any surplus screen area.
 * Wide screens expand the logical width; tall screens expand the logical height.
 */
export function applyAdaptiveResolution(): void {
  const frame = screen.windowSize;
  const aspect = frame.height > 0 ? frame.width / frame.height : DESIGN_ASPECT;
  const policy = aspect >= DESIGN_ASPECT
    ? ResolutionPolicy.FIXED_HEIGHT
    : ResolutionPolicy.FIXED_WIDTH;
  view.resizeWithBrowserSize(true);
  view.setDesignResolutionSize(DESIGN_RESOLUTION_WIDTH, DESIGN_RESOLUTION_HEIGHT, policy);
}

/** Visible dimensions expressed in a UI root's unscaled local coordinates. */
export function visibleSizeInRootSpace(rootScale: number): { width: number; height: number } {
  const safeScale = rootScale > 0 ? rootScale : 1;
  const visible = view.getVisibleSize();
  return {
    width: Math.max(DESIGN_RESOLUTION_WIDTH, visible.width) / safeScale,
    height: Math.max(DESIGN_RESOLUTION_HEIGHT, visible.height) / safeScale,
  };
}

/**
 * Keeps one Graphics rectangle covering the complete visible area of a scaled
 * UI root. The component owns its resize subscription, so dynamically created
 * modal masks continue to cover surplus ultrawide/tall screen space and clean
 * themselves up when their node is destroyed.
 */
@ccclass('AdaptiveFullscreenMask')
export class AdaptiveFullscreenMask extends Component {
  private rootScale = 1;
  private fillColor = new Color(0, 0, 0, 0);
  private resolutionUnsubscribe: (() => void) | null = null;

  configure(rootScale: number, fillColor: Readonly<Color>): void {
    this.rootScale = rootScale > 0 ? rootScale : 1;
    this.fillColor.set(fillColor.r, fillColor.g, fillColor.b, fillColor.a);
    if (!this.resolutionUnsubscribe) {
      this.resolutionUnsubscribe = subscribeAdaptiveResolution(() => this.redraw());
    }
    this.redraw();
  }

  redraw(): void {
    const transform = this.node.getComponent(UITransform);
    const graphics = this.node.getComponent(Graphics);
    if (!transform || !graphics) return;
    const { width, height } = visibleSizeInRootSpace(this.rootScale);
    transform.setContentSize(width, height);
    graphics.clear();
    graphics.fillColor = this.fillColor;
    graphics.rect(-width * 0.5, -height * 0.5, width, height);
    graphics.fill();
  }

  onDestroy(): void {
    this.resolutionUnsubscribe?.();
    this.resolutionUnsubscribe = null;
  }
}

/** Create and attach a self-resizing, centered, full-visible-area Graphics mask. */
export function createAdaptiveFullscreenMask(
  parent: Node,
  name: string,
  fillColor: Readonly<Color>,
  rootScale: number,
): { node: Node; graphics: Graphics } {
  const node = new Node(name);
  node.layer = parent.layer;
  node.addComponent(UITransform);
  const graphics = node.addComponent(Graphics);
  parent.addChild(node);
  node.addComponent(AdaptiveFullscreenMask).configure(rootScale, fillColor);
  return { node, graphics };
}

export function subscribeAdaptiveResolution(listener: ResolutionChangeListener): () => void {
  listeners.add(listener);
  if (!listeningForResize) {
    screen.on('window-resize', handleWindowResize);
    screen.on('orientation-change', handleWindowResize);
    listeningForResize = true;
  }
  return () => listeners.delete(listener);
}

function handleWindowResize(): void {
  applyAdaptiveResolution();
  for (const listener of [...listeners]) listener();
}
