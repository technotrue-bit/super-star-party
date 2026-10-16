/**
 * Follow camera for travel races (Cake Dash and kin).
 *
 * The camera trails a point that is a pure function of course progress (the
 * race leader), never of raw input, so taps and stick moves cannot move it.
 * It is critically damped: it reaches the target without overshoot and about
 * 98% of a step is closed after `settle` seconds. The solution is the exact
 * closed form for a fixed target, so it is stable at any dt.
 *
 * No randomness. The rig keeps a constant offset from the focus point, so the
 * view direction never changes while following.
 */
import * as THREE from "three";

export interface FollowCamera {
  /** Smoothed point the camera looks at. Read-only for callers (HUD anchors). */
  readonly focus: THREE.Vector3;
  update(dt: number, target: THREE.Vector3): void;
}

/** (1 + w t) e^(-w t) = 0.02 at w t ~= 5.8. */
const SETTLE_K = 5.8;
/** A long frame (tab switch) must not fling the camera. */
const MAX_DT = 0.1;

export function createFollowCamera(
  cam: THREE.PerspectiveCamera,
  opts: { offset: THREE.Vector3; settle?: number },
): FollowCamera {
  const settle = Math.max(0.05, opts.settle ?? 0.6);
  const w = SETTLE_K / settle;
  const focus = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let primed = false;

  const axis = (axisKey: "x" | "y" | "z", dt: number, target: number): void => {
    const d = focus[axisKey] - target;
    const v = vel[axisKey];
    const e = Math.exp(-w * dt);
    const j = v + w * d;
    focus[axisKey] = target + (d + j * dt) * e;
    vel[axisKey] = (v - w * j * dt) * e;
  };

  return {
    focus,
    update(dt, target) {
      if (!primed) {
        // First frame: start on the target so the round never swings in.
        focus.copy(target);
        vel.set(0, 0, 0);
        primed = true;
      } else {
        const step = Math.min(Math.max(dt, 0), MAX_DT);
        axis("x", step, target.x);
        axis("y", step, target.y);
        axis("z", step, target.z);
      }
      // `offset` is read live so a reframe (resize, rotation) can mutate it.
      cam.position.copy(focus).add(opts.offset);
      cam.lookAt(focus);
    },
  };
}
