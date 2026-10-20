import { _decorator, Component, Node, UITransform } from 'cc';
import { subscribeAdaptiveResolution, visibleSizeInRootSpace } from './ResolutionAdapter';

const { ccclass } = _decorator;
type PageLayout = (size: { width: number; height: number }) => void;

/** Resize a page in place, preserving its inputs, selection and editing state. */
@ccclass('AdaptivePageLayout')
export class AdaptivePageLayout extends Component {
  private rootScale = 1;
  private layout: PageLayout | null = null;
  private unsubscribe: (() => void) | null = null;

  configure(rootScale: number, layout: PageLayout): void {
    this.rootScale = rootScale;
    this.layout = layout;
    if (!this.unsubscribe) this.unsubscribe = subscribeAdaptiveResolution(() => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const size = visibleSizeInRootSpace(this.rootScale);
    this.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
    this.layout?.(size);
  }

  onDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.layout = null;
  }
}

export function bindAdaptivePageLayout(node: Node, rootScale: number, layout: PageLayout): void {
  node.addComponent(AdaptivePageLayout).configure(rootScale, layout);
}
