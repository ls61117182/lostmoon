import { ResolutionPolicy, screen, view } from 'cc';

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
