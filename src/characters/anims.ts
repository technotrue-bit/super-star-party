import type * as THREE from 'three';
import { settings } from '../config/settings';
import { mulberry32 } from '../core/rng';
import type { CharacterKind } from './roster';
import type { Expression } from './faces';

// Presentation-only RNG: character idle animations (blink/fidget/look timing)
// draw from their OWN fixed-seed stream so they never consume the shared
// gameplay rng. Animation draws must not affect gameplay determinism.
const animRng = mulberry32(0xa11ce5eed);

export type AnimName = 'idle' | 'walk' | 'jump' | 'cheer' | 'sad' | 'squash';

export interface AnimController {
  set(name: AnimName): void;
  current(): AnimName;
  update(dt: number): void;
  setFacing(angle: number): void;
}

const TAU = Math.PI * 2;
const PART_KEYS = ['ears', 'antenna', 'trunk', 'star', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
type PartKey = (typeof PART_KEYS)[number];
/** Floppy bits that trail the body on a spring (secondary motion). */
const SPRING_KEYS = ['ears', 'antenna', 'trunk'] as const;

const smoothstep = (p: number): number => p * p * (3 - 2 * p);
const clamp01 = (p: number): number => (p < 0 ? 0 : p > 1 ? 1 : p);
const easeOutElastic = (p: number): number => {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
};
/** Shortest signed angle from a to b. */
const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

// ---- timing ----
const BLEND_TIME = 0.16; // cross-fade between two animations' poses
const JUMP_CROUCH = 0.14;
const JUMP_AIR = 0.5;
const JUMP_LAND = 0.22;
const JUMP_TOTAL = JUMP_CROUCH + JUMP_AIR + JUMP_LAND;
const SQUASH_TIME = 0.45;
const FIDGET_TIME = 0.9;
const BLINK_TIME = 0.11;
const LOOK_TIME = 1.3;

// ---- pose tuning ----
const ARMS_UP = -2.8; // jump: arms thrown overhead
const CHEER_PUMP_CYCLE = 0.36;
const CHEER_HOP_CYCLE = 0.45;
const WALK_SWING = 0.55;
const WALK_TUCK = 0.7; // legs tuck up mid-hop
const SAD_DROOP = 0.32;
const SAD_LIMP = 0.35;

/**
 * Pose for one frame, relative to the rig's rest pose. Built fresh each frame
 * by the active animation, then cross-faded from the previous animation's last
 * pose for BLEND_TIME, so switching never pops.
 */
interface Pose {
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number; // lean (forward +)
  rz: number; // roll
  yaw: number; // offset on top of the facing yaw
  parts: Record<PartKey, [number, number, number]>;
}

const blankPose = (): Pose => ({
  y: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  rx: 0,
  rz: 0,
  yaw: 0,
  parts: Object.fromEntries(PART_KEYS.map((k) => [k, [0, 0, 0]])) as Record<PartKey, [number, number, number]>,
});

const copyPose = (from: Pose, to: Pose): void => {
  to.y = from.y;
  to.sx = from.sx;
  to.sy = from.sy;
  to.sz = from.sz;
  to.rx = from.rx;
  to.rz = from.rz;
  to.yaw = from.yaw;
  for (const k of PART_KEYS) {
    to.parts[k][0] = from.parts[k][0];
    to.parts[k][1] = from.parts[k][1];
    to.parts[k][2] = from.parts[k][2];
  }
};

const resetPose = (p: Pose): void => {
  p.y = 0;
  p.sx = p.sy = p.sz = 1;
  p.rx = p.rz = p.yaw = 0;
  for (const k of PART_KEYS) p.parts[k][0] = p.parts[k][1] = p.parts[k][2] = 0;
};

/**
 * Drives one character's rig. `rig` is the animation group inside the
 * character's placement root: everything here is relative to its rest pose,
 * so whoever places the character (board hops, the hill, minigames, scaled
 * screens) is never overwritten.
 */
export function createAnimController(
  rig: THREE.Group,
  parts: Record<string, THREE.Object3D>,
  kind: CharacterKind,
  setExpression: (e: Expression) => void = () => undefined,
): AnimController {
  const basePosY = rig.position.y;
  const baseScale = rig.scale.clone();
  const baseRotX = rig.rotation.x;
  const baseRotZ = rig.rotation.z;
  let yaw = rig.rotation.y;
  let targetYaw = yaw;
  let yawRate = 0;

  const partBase: Partial<Record<PartKey, THREE.Euler>> = {};
  for (const key of PART_KEYS) {
    const p = parts[key];
    if (p) partBase[key] = p.rotation.clone();
  }

  let currentName: AnimName = 'idle';
  let t = 0;
  const pose = blankPose();
  const from = blankPose();
  const shown = blankPose();
  let blendT = BLEND_TIME;

  // Idle life: blinks, fidgets, look-arounds (own timers, own rng).
  let nextBlink = 2.5 + animRng() * 2.5;
  let blinkT = -1;
  let nextFidget = 5 + animRng() * 4;
  let fidgetT = -1;
  let nextLook = 3 + animRng() * 3;
  let lookT = -1;
  let lookDir = 1;

  // Secondary motion: one damped spring per floppy part, pushed by the rig's
  // vertical velocity and turn rate.
  const spring = SPRING_KEYS.map(() => ({ x: 0, vx: 0, z: 0, vz: 0 }));
  let lastY = 0;

  const set = (name: AnimName): void => {
    if (currentName === name) return; // keep phase continuity for repeats
    copyPose(shown, from);
    blendT = 0;
    currentName = name;
    t = 0;
    fidgetT = -1;
    lookT = -1;
  };

  // ---- per-animation poses (write into `pose`) -------------------------------------
  const arm = (side: 'armL' | 'armR', rx: number, rz = 0): void => {
    pose.parts[side][0] = rx;
    pose.parts[side][2] = rz;
  };
  const leg = (side: 'legL' | 'legR', rx: number): void => {
    pose.parts[side][0] = rx;
  };

  const fidget = (e: number): void => {
    switch (kind.key) {
      case 'pip':
        pose.parts.star[1] = e * TAU * 0.5; // star head spins half a turn
        break;
      case 'bounce': {
        const arc = Math.sin(Math.PI * e);
        pose.y += arc * 0.18;
        pose.sy *= 1 - arc * 0.1;
        pose.sx *= 1 + arc * 0.05;
        pose.sz *= 1 + arc * 0.05;
        break;
      }
      case 'glimmer':
        pose.parts.antenna[2] = Math.sin(e * TAU * 1.5) * 0.45;
        arm('armR', -1.2 * Math.sin(Math.PI * e), -0.3); // a cheeky little wave
        break;
      case 'tusk':
        pose.parts.ears[2] = Math.sin(e * TAU * 2) * 0.3;
        pose.parts.trunk[0] = -Math.sin(Math.PI * e) * 0.6; // trunk lifts
        break;
      default:
        break;
    }
  };

  const idle = (dt: number): void => {
    // Breathing, a slow weight shift and relaxed arms.
    pose.y = Math.sin(t * 2) * 0.02;
    const breath = Math.sin(t * 1.6) * 0.022;
    pose.sy = 1 + breath;
    pose.sx = pose.sz = 1 - breath * 0.5;
    pose.rz = Math.sin(t * 0.85) * 0.035;
    const sway = Math.sin(t * 1.5) * 0.06;
    arm('armL', sway, 0.05);
    arm('armR', -sway, -0.05);

    // Look around now and then: the head (and a bit of the body) turns aside.
    if (lookT < 0 && t >= nextLook) {
      lookT = 0;
      lookDir = animRng() < 0.5 ? -1 : 1;
    }
    if (lookT >= 0) {
      lookT += dt;
      const u = clamp01(lookT / LOOK_TIME);
      const w = Math.sin(Math.PI * u);
      pose.parts.head[1] = lookDir * 0.55 * smoothstep(Math.min(1, w * 1.6));
      pose.yaw = lookDir * 0.12 * w;
      if (u >= 1) {
        lookT = -1;
        nextLook = t + 4 + animRng() * 4;
      }
    }

    if (fidgetT < 0 && t >= nextFidget) fidgetT = 0;
    if (fidgetT >= 0) {
      fidgetT += dt;
      fidget(smoothstep(clamp01(fidgetT / FIDGET_TIME)));
      if (fidgetT >= FIDGET_TIME) {
        fidgetT = -1;
        nextFidget = t + 6 + animRng() * 5;
      }
    }
  };

  const walk = (): void => {
    // One hop per board space (hopDuration): crouch, spring up stretched,
    // tuck the legs at the top, land squashed. Lean into the hop.
    const cycle = settings.hopDuration;
    const p = (t % cycle) / cycle;
    const air = Math.sin(Math.PI * p);
    pose.y = air * 0.3;
    let stretch = 0;
    if (p < 0.18) stretch = -0.16 * Math.sin((p / 0.18) * Math.PI); // takeoff crouch
    else if (p < 0.55) stretch = 0.12 * Math.sin(((p - 0.18) / 0.37) * Math.PI); // stretch up
    else if (p > 0.86) stretch = -0.2 * Math.sin(((p - 0.86) / 0.14) * Math.PI); // landing squash
    pose.sy = 1 + stretch;
    pose.sx = pose.sz = 1 - stretch * 0.6;
    pose.rx = 0.16 + air * 0.06;
    pose.rz = Math.sin(p * TAU) * 0.05;
    const swing = Math.sin(p * TAU) * WALK_SWING;
    arm('armL', swing, 0.1);
    arm('armR', -swing, -0.1);
    leg('legL', -WALK_TUCK * air + 0.15);
    leg('legR', -WALK_TUCK * air - 0.15);
  };

  const jump = (): void => {
    if (t < JUMP_CROUCH) {
      const e = smoothstep(t / JUMP_CROUCH);
      pose.sy = 1 - 0.22 * e;
      pose.sx = pose.sz = 1 + 0.12 * e;
      pose.y = -0.03 * e;
      arm('armL', 0.5 * e);
      arm('armR', 0.5 * e);
      setExpression('normal');
    } else if (t < JUMP_CROUCH + JUMP_AIR) {
      const p = (t - JUMP_CROUCH) / JUMP_AIR;
      pose.y = Math.sin(Math.PI * p) * 0.95;
      // Stretched on the way up, round at the top, a little stretched falling.
      const s = p < 0.5 ? 0.18 * (1 - p * 2) : 0.06 * (p * 2 - 1);
      pose.sy = 1 + s;
      pose.sx = pose.sz = 1 - s * 0.6;
      if (kind.key === 'bounce') pose.rx = p * TAU; // front flip
      if (kind.key === 'pip') pose.parts.star[1] = p * TAU; // star head spins
      if (kind.key === 'glimmer') pose.yaw = p * TAU; // pirouette
      const up = ARMS_UP * smoothstep(Math.min(1, p * 3));
      arm('armL', up, 0.25);
      arm('armR', up, -0.25);
      leg('legL', -0.8);
      leg('legR', -0.8);
      setExpression('happy');
    } else {
      const p = clamp01((t - JUMP_CROUCH - JUMP_AIR) / JUMP_LAND);
      const el = easeOutElastic(p);
      pose.sy = 0.72 + 0.28 * el;
      pose.sx = pose.sz = 1.16 - 0.16 * el;
      arm('armL', ARMS_UP * (1 - el));
      arm('armR', ARMS_UP * (1 - el));
    }
    if (t >= JUMP_TOTAL) set('idle');
  };

  const cheer = (): void => {
    setExpression('happy');
    const pumpPhase = ((t % CHEER_PUMP_CYCLE) / CHEER_PUMP_CYCLE) * TAU;
    arm('armL', -2.5 * Math.max(0, Math.sin(pumpPhase)), 0.3);
    arm('armR', -2.5 * Math.max(0, Math.sin(pumpPhase + Math.PI)), -0.3);
    const hopP = (t % CHEER_HOP_CYCLE) / CHEER_HOP_CYCLE;
    const hop = Math.sin(Math.PI * hopP);
    pose.y = hop * 0.2;
    const s = hopP < 0.12 || hopP > 0.9 ? -0.12 : hop * 0.12;
    pose.sy = 1 + s;
    pose.sx = pose.sz = 1 - s * 0.55;
    pose.rz = Math.sin(t * 7) * 0.07;
    pose.yaw = Math.sin(t * 7) * 0.3;
    leg('legL', -0.5 * hop);
    leg('legR', -0.5 * hop);
    // Each hero celebrates their own way.
    switch (kind.key) {
      case 'pip':
        pose.parts.star[1] = t * 5; // star head whirls
        break;
      case 'bounce':
        pose.y += hop * 0.12; // extra-springy
        pose.parts.ears[2] = Math.sin(t * 14) * 0.25;
        break;
      case 'glimmer':
        pose.parts.antenna[2] = Math.sin(t * 16) * 0.5;
        pose.yaw = t * 6; // spins on the spot
        break;
      case 'tusk':
        pose.parts.trunk[0] = -0.9 + Math.sin(t * 9) * 0.25; // trunk raised, trumpeting
        pose.parts.ears[2] = Math.sin(t * 10) * 0.35;
        break;
      default:
        break;
    }
  };

  const sad = (): void => {
    setExpression('sad');
    pose.parts.head[0] = SAD_DROOP;
    const heave = Math.sin(Math.PI * ((t % 0.75) / 0.75)) * 0.08;
    arm('armL', SAD_LIMP + heave, 0.14);
    arm('armR', SAD_LIMP + heave * 0.7, -0.14);
    pose.rx = 0.16;
    pose.y = -0.06;
    pose.sy = 0.9 + Math.sin(t * 1.2) * 0.015;
    pose.sx = pose.sz = 1.04;
    pose.rz = Math.sin(t * 1.1) * 0.05; // slow, mopey sway
    if (kind.key === 'tusk') pose.parts.trunk[0] = 0.35; // trunk droops
    if (kind.key === 'glimmer') pose.parts.antenna[0] = 0.6;
  };

  const squash = (): void => {
    setExpression(t < SQUASH_TIME * 0.6 ? 'surprised' : 'normal');
    const e = easeOutElastic(clamp01(t / SQUASH_TIME));
    pose.sy = 0.66 + 0.34 * e;
    pose.sx = pose.sz = 1.2 - 0.2 * e;
    const flail = 0.6 * (1 - e);
    arm('armL', -flail, 0.6 * (1 - e));
    arm('armR', flail, -0.6 * (1 - e));
    if (t >= SQUASH_TIME) set('idle');
  };

  // ---- apply ---------------------------------------------------------------------------
  const applyPose = (p: Pose): void => {
    rig.position.y = basePosY + p.y;
    rig.scale.set(baseScale.x * p.sx, baseScale.y * p.sy, baseScale.z * p.sz);
    rig.rotation.x = baseRotX + p.rx;
    rig.rotation.z = baseRotZ + p.rz;
    rig.rotation.y = yaw + p.yaw;
    for (const k of PART_KEYS) {
      const obj = parts[k];
      const b = partBase[k];
      if (!obj || !b) continue;
      obj.rotation.set(b.x + p.parts[k][0], b.y + p.parts[k][1], b.z + p.parts[k][2]);
    }
  };

  const update = (dt: number): void => {
    t += dt;

    // Facing: critically-damped turn the SHORT way round (never a 340° spin).
    const prevYaw = yaw;
    yaw += angleDelta(yaw, targetYaw) * (1 - Math.exp(-dt * 12));
    yawRate = dt > 0 ? angleDelta(prevYaw, yaw) / dt : 0;

    resetPose(pose);
    switch (currentName) {
      case 'idle':
        idle(dt);
        break;
      case 'walk':
        walk();
        break;
      case 'jump':
        jump();
        break;
      case 'cheer':
        cheer();
        break;
      case 'sad':
        sad();
        break;
      case 'squash':
        squash();
        break;
    }

    // Expressions owned by the idle/walk states: blink now and then.
    if (currentName === 'idle' || currentName === 'walk') {
      if (blinkT < 0 && t >= nextBlink) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        setExpression(blinkT < BLINK_TIME ? 'blink' : 'normal');
        if (blinkT >= BLINK_TIME) {
          blinkT = -1;
          nextBlink = t + 2.5 + animRng() * 3;
          // Sometimes a quick double blink.
          if (animRng() < 0.25) nextBlink = t + 0.18;
        }
      } else {
        setExpression('normal');
      }
    }

    // Secondary motion: springs pushed by vertical velocity and turning.
    const vy = dt > 0 ? (pose.y - lastY) / dt : 0;
    lastY = pose.y;
    for (let i = 0; i < SPRING_KEYS.length; i++) {
      const s = spring[i];
      const kx = -vy * 0.09; // rising: floppy bits trail down
      const kz = -yawRate * 0.05; // turning: they swing out
      const K = 120;
      const D = 9;
      s.vx += (K * (kx - s.x) - D * s.vx) * dt;
      s.x += s.vx * dt;
      s.vz += (K * (kz - s.z) - D * s.vz) * dt;
      s.z += s.vz * dt;
      const key = SPRING_KEYS[i];
      pose.parts[key][0] += Math.max(-0.6, Math.min(0.6, s.x));
      pose.parts[key][2] += Math.max(-0.5, Math.min(0.5, s.z));
    }

    // Cross-fade from the previous animation's last pose.
    if (blendT < BLEND_TIME) {
      blendT += dt;
      const e = smoothstep(clamp01(blendT / BLEND_TIME));
      const mix = (a: number, b: number): number => a + (b - a) * e;
      shown.y = mix(from.y, pose.y);
      shown.sx = mix(from.sx, pose.sx);
      shown.sy = mix(from.sy, pose.sy);
      shown.sz = mix(from.sz, pose.sz);
      shown.rx = mix(from.rx, pose.rx);
      shown.rz = mix(from.rz, pose.rz);
      shown.yaw = from.yaw + angleDelta(from.yaw, pose.yaw) * e;
      for (const k of PART_KEYS) {
        for (let a = 0; a < 3; a++) shown.parts[k][a] = mix(from.parts[k][a], pose.parts[k][a]);
      }
    } else {
      copyPose(pose, shown);
    }
    // Keep the shown yaw offset bounded so a spin-on-the-spot blends cleanly.
    shown.yaw = angleDelta(0, shown.yaw);
    applyPose(shown);
  };

  const setFacing = (angle: number): void => {
    targetYaw = angle;
  };

  return {
    set,
    current: (): AnimName => currentName,
    update,
    setFacing,
  };
}
