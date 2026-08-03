import { Node, Tween, Vec3, tween } from 'cc';

const PRESSED_SCALE = 0.94;
const RELEASE_DURATION = 0.08;

interface PressScaleState {
  baseScale: Vec3 | null;
  pressed: boolean;
  releaseTween: Tween<Node> | null;
}

const states = new WeakMap<Node, PressScaleState>();

/**
 * Adds shared press feedback to a clickable UI node.
 *
 * `hitTarget` receives the touch events while `visualTarget` is scaled. Keeping
 * those separate lets a label mirror the feedback of its parent button.
 */
export function bindButtonPressScale(
  hitTarget: Node,
  visualTarget: Node = hitTarget,
  isEnabled: () => boolean = () => true,
) {
  const state = states.get(visualTarget) ?? {
    baseScale: null,
    pressed: false,
    releaseTween: null,
  };
  states.set(visualTarget, state);

  const press = () => {
    if (!isEnabled() || state.pressed || !visualTarget.isValid) return;
    // A rapid second tap may arrive while the previous release is still
    // tweening. Snap to the true resting scale first so taps never compound.
    if (state.releaseTween && state.baseScale) {
      state.releaseTween.stop();
      visualTarget.setScale(state.baseScale);
    }
    state.releaseTween = null;
    state.baseScale = visualTarget.scale.clone();
    state.pressed = true;
    visualTarget.setScale(
      state.baseScale.x * PRESSED_SCALE,
      state.baseScale.y * PRESSED_SCALE,
      state.baseScale.z,
    );
  };

  const release = () => {
    if (!state.pressed || !state.baseScale || !visualTarget.isValid) return;
    const baseScale = state.baseScale.clone();
    state.pressed = false;
    state.releaseTween?.stop();
    state.releaseTween = tween(visualTarget)
      .to(RELEASE_DURATION, { scale: baseScale }, { easing: 'sineOut' })
      .call(() => {
        state.baseScale = null;
        state.releaseTween = null;
      })
      .start();
  };

  hitTarget.on(Node.EventType.TOUCH_START, press);
  hitTarget.on(Node.EventType.TOUCH_END, release);
  hitTarget.on(Node.EventType.TOUCH_CANCEL, release);
}
