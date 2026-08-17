import type * as THREE from 'three';
import { settings } from '../config/settings';
import { mulberry32 } from '../core/rng';
import type { CharacterKind } from './roster';

// Presentation-only RNG: character idle animations (blink/fidget timing) draw
// from their OWN fixed-seed stream so they never consume the shared gameplay
// rng. Animation draws must not affect gameplay determinism.
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
const LAG_KEYS = ['ears', 'antenna', 'trunk'] as const;

const smoothstep = (p: number): number => p * p * (3 - 2 * p);

const easeOutElastic = (p: number): number => {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
};

const JUMP_CROUCH = 0.12;
const JUMP_AIR = 0.5;
const JUMP_LAND = 0.08;
const JUMP_TOTAL = JUMP_CROUCH + JUMP_AIR + JUMP_LAND;
const SQUASH_TIME = 0.35;
const FIDGET_TIME = 0.8;
const BLINK_TIME = 0.12;

// ---- limb pose tuning (all deterministic: dt accumulation only) ----
const ARMS_UP = -2.8; // jump: arms thrown overhead
const CHEER_PUMP_CYCLE = 0.36; // cheer: each arm pumps up for ~0.18s then switches
const CHEER_HOP_CYCLE = 0.45; // cheer: little hops (~3 per 1.3s dance loop)
const CHEER_SPIN = 0.35; // cheer: yaw wobble around the facing direction
const WALK_SWING = 0.45; // walk: arm swing amplitude per hop
const WALK_STEP = 0.25; // walk: leg-nub step amplitude per hop
const SAD_HEAVE_CYCLE = 0.7; // sad: shoulder heave every 0.7s
const SAD_HEAVE = 0.08; // sad: heave pulse size
const SAD_DROOP = 0.3; // sad: head tilt down
const SAD_LIMP = 0.35; // sad: arms hang back/down

export function createAnimController(
  group: THREE.Group,
  parts: Record<string, THREE.Object3D>,
  kind: CharacterKind,
): AnimController {
  const basePosY = group.position.y;
  const baseScale = group.scale.clone();
  const baseRotX = group.rotation.x;
  const baseRotZ = group.rotation.z;
  let yaw = group.rotation.y;
  let targetYaw = yaw;

  // Base rotations of the movable parts so fidgets, lag, and limb poses can
  // restore them whenever an animation starts.
  const partBase: Record<string, THREE.Euler> = {};
  for (const key of PART_KEYS) {
    const p = parts[key];
    if (p) partBase[key] = p.rotation.clone();
  }
  const face = parts.face;

  let currentName: AnimName = 'idle';
  let t = 0;
  let blinkT = 0;
  let fidgetT = 0;
  let blinking = false;
  let fidgeting = false;
  let nextBlink = 3 + animRng() * 2;
  let nextFidget = 5 + Math.floor(animRng() * 5);

  // Restores the base pose. Position x/z are left untouched so external
  // placement survives; only the y bob is animation-owned.
  const resetGroup = (): void => {
    group.position.y = basePosY;
    group.scale.copy(baseScale);
    group.rotation.x = baseRotX;
    group.rotation.z = baseRotZ;
  };

  const resetParts = (): void => {
    for (const key of PART_KEYS) {
      const p = parts[key];
      const b = partBase[key];
      if (p && b) p.rotation.copy(b);
    }
    if (face) face.scale.set(1, 1, 1);
  };

  // Limb pose helpers: rotate the pivot groups around their stored base.
  const setArm = (side: 'armL' | 'armR', rx: number, rz = 0): void => {
    const p = parts[side];
    const b = partBase[side];
    if (p && b) {
      p.rotation.x = b.x + rx;
      p.rotation.z = b.z + rz;
    }
  };

  const setLeg = (side: 'legL' | 'legR', rx: number): void => {
    const p = parts[side];
    const b = partBase[side];
    if (p && b) p.rotation.x = b.x + rx;
  };

  const setHeadTilt = (rx: number): void => {
    const h = parts.head;
    const b = partBase.head;
    if (h && b) h.rotation.x = b.x + rx;
  };

  const set = (name: AnimName): void => {
    if (currentName === name) return; // keep phase continuity for repeats
    currentName = name;
    t = 0;
    blinkT = 0;
    fidgetT = 0;
    blinking = false;
    fidgeting = false;
    nextBlink = 3 + animRng() * 2;
    nextFidget = 5 + Math.floor(animRng() * 5);
    resetGroup();
    resetParts();
  };

  const applyFidget = (e: number): void => {
    switch (kind.key) {
      case 'pip': {
        const star = parts.star;
        if (star) star.rotation.y = (partBase.star?.y ?? 0) + e * (Math.PI / 6);
        break;
      }
      case 'bounce': {
        const arc = Math.sin(Math.PI * e);
        group.position.y = basePosY + arc * 0.14;
        group.scale.y = baseScale.y - arc * 0.1;
        group.scale.x = baseScale.x + arc * 0.05;
        group.scale.z = baseScale.z + arc * 0.05;
        break;
      }
      case 'glimmer': {
        const antenna = parts.antenna;
        if (antenna) antenna.rotation.z = (partBase.antenna?.z ?? 0) + Math.sin(e * Math.PI * 2) * 0.4;
        break;
      }
      case 'tusk': {
        const ears = parts.ears;
        if (ears) ears.rotation.z = (partBase.ears?.z ?? 0) + Math.sin(e * Math.PI * 2) * 0.3;
        break;
      }
      default:
        break;
    }
  };

  const updateIdle = (dt: number): void => {
    resetGroup();
    // Gentle bob and breathing.
    group.position.y += Math.sin(t * 2) * 0.03;
    const breath = 1 + Math.sin(t * 1.4) * 0.02;
    group.scale.multiplyScalar(breath);

    // Relaxed arms at the sides with a tiny sway.
    const sway = Math.sin(t * 1.5) * 0.05;
    setArm('armL', sway, 0.04);
    setArm('armR', -sway, -0.04);

    // Blink every 3-5s: quick y-squash of the face part.
    if (!blinking && t >= nextBlink) {
      blinking = true;
      blinkT = 0;
    }
    if (blinking) {
      blinkT += dt;
      if (face) face.scale.y = blinkT < BLINK_TIME ? 0.1 : 1;
      if (blinkT >= BLINK_TIME) {
        blinking = false;
        if (face) face.scale.y = 1;
        nextBlink = 3 + animRng() * 2;
      }
    }

    // Fidget roughly every 7s, 0.8s duration.
    if (!fidgeting && t >= nextFidget) {
      fidgeting = true;
      fidgetT = 0;
    }
    if (fidgeting) {
      fidgetT += dt;
      const e = smoothstep(Math.min(fidgetT / FIDGET_TIME, 1));
      applyFidget(e);
      if (fidgetT >= FIDGET_TIME) {
        fidgeting = false;
        resetGroup();
        resetParts();
      }
    }
  };

  const updateWalk = (): void => {
    const cycle = settings.hopDuration;
    const p = (t % cycle) / cycle;
    const hop = Math.abs(Math.sin(Math.PI * p));
    group.position.y = basePosY + hop * 0.22;
    const sy = 0.82 + (1.08 - 0.82) * hop;
    group.scale.y = baseScale.y * sy;
    const sx = 1.13 - 0.13 * hop;
    group.scale.x = baseScale.x * sx;
    group.scale.z = baseScale.z * sx;
    group.rotation.x = baseRotX + 0.12;
    // Ears, antenna and trunk lag slightly against the hop.
    const lag = hop * 0.22;
    for (const key of LAG_KEYS) {
      const p2 = parts[key];
      const b = partBase[key];
      if (p2 && b) p2.rotation.x = b.x - lag;
    }
    // Arm swing and leg-step cycle: arms opposite each other, leg nubs
    // alternating with the same hop phase.
    const swing = Math.sin(p * TAU) * WALK_SWING;
    setArm('armL', swing);
    setArm('armR', -swing);
    const step = Math.sin(p * TAU) * WALK_STEP;
    setLeg('legL', step);
    setLeg('legR', -step);
  };

  const updateJump = (): void => {
    if (t < JUMP_CROUCH) {
      const e = smoothstep(t / JUMP_CROUCH);
      group.scale.y = baseScale.y * (1 - 0.15 * e);
      group.scale.x = baseScale.x * (1 + 0.08 * e);
      group.scale.z = baseScale.z * (1 + 0.08 * e);
      group.position.y = basePosY - 0.02 * e;
      group.rotation.x = baseRotX;
      // Arms swing back for the wind-up.
      setArm('armL', 0.3);
      setArm('armR', 0.3);
    } else if (t < JUMP_CROUCH + JUMP_AIR) {
      const p = (t - JUMP_CROUCH) / JUMP_AIR;
      group.position.y = basePosY + Math.sin(Math.PI * p) * 0.9;
      group.scale.copy(baseScale);
      // Bounce does a front flip over the arc.
      group.rotation.x = baseRotX + (kind.key === 'bounce' ? p * TAU : 0);
      // Both arms raised overhead through the arc (bounce keeps them up
      // through its flip).
      setArm('armL', ARMS_UP);
      setArm('armR', ARMS_UP);
    } else {
      const p = (t - JUMP_CROUCH - JUMP_AIR) / JUMP_LAND;
      group.position.y = basePosY;
      const el = easeOutElastic(p);
      group.scale.y = baseScale.y * (0.7 + 0.3 * el);
      group.scale.x = baseScale.x * (1.15 - 0.15 * el);
      group.scale.z = baseScale.z * (1.15 - 0.15 * el);
      group.rotation.x = baseRotX + (kind.key === 'bounce' ? TAU : 0);
      // Arms ease back down to neutral on landing.
      setArm('armL', ARMS_UP * (1 - el));
      setArm('armR', ARMS_UP * (1 - el));
    }
    if (t >= JUMP_TOTAL) set('idle');
  };

  const updateCheer = (): void => {
    // Victory dance: alternate arm pumps (switch every ~0.18s), little hops
    // with squash-stretch, and a spin wobble around the facing direction.
    const pumpPhase = ((t % CHEER_PUMP_CYCLE) / CHEER_PUMP_CYCLE) * TAU;
    const pumpL = Math.max(0, Math.sin(pumpPhase));
    const pumpR = Math.max(0, Math.sin(pumpPhase + Math.PI));
    setArm('armL', -2.4 * pumpL);
    setArm('armR', -2.4 * pumpR);

    const hopPhase = (t % CHEER_HOP_CYCLE) / CHEER_HOP_CYCLE;
    const hop = Math.sin(Math.PI * hopPhase);
    group.position.y = basePosY + hop * 0.16;
    group.scale.y = baseScale.y * (1 + hop * 0.12);
    group.scale.x = baseScale.x * (1 - hop * 0.06);
    group.scale.z = baseScale.z * (1 - hop * 0.06);
    group.rotation.x = baseRotX + Math.sin(t * 3.5) * 0.05;
    group.rotation.y = yaw + Math.sin(t * 7) * CHEER_SPIN;
    group.rotation.z = baseRotZ + Math.sin(t * 7) * 0.06;
  };

  const updateSad = (): void => {
    // Comedic sulk: head droops, arms hang limp, body slumps, and the
    // shoulders heave every 0.7s.
    setHeadTilt(SAD_DROOP);
    const heavePhase = (t % SAD_HEAVE_CYCLE) / SAD_HEAVE_CYCLE;
    const heave = Math.sin(Math.PI * heavePhase) * SAD_HEAVE;
    setArm('armL', SAD_LIMP + heave, 0.12);
    setArm('armR', SAD_LIMP + heave * 0.7, -0.12);

    group.rotation.x = baseRotX + 0.15;
    group.rotation.z = baseRotZ;
    group.position.y = basePosY - 0.06;
    group.scale.y = baseScale.y * (0.9 + Math.sin(t * 1.2) * 0.015);
    group.scale.x = baseScale.x * 1.04;
    group.scale.z = baseScale.z * 1.04;
  };

  const updateSquash = (): void => {
    const e = easeOutElastic(Math.min(t / SQUASH_TIME, 1));
    group.scale.y = baseScale.y * (0.7 + 0.3 * e);
    group.scale.x = baseScale.x * (1.15 - 0.15 * e);
    group.scale.z = baseScale.z * (1.15 - 0.15 * e);
    group.position.y = basePosY;
    group.rotation.x = baseRotX;
    group.rotation.z = baseRotZ;
    // Arms flail out (opposite directions) at impact, settling with the body.
    const flail = 0.4 * (1 - e);
    setArm('armL', flail);
    setArm('armR', -flail);
    if (t >= SQUASH_TIME) set('idle');
  };

  const update = (dt: number): void => {
    t += dt;

    // Smooth-turn toward the facing target at ~10 rad/s.
    const diff = targetYaw - yaw;
    const step = 10 * dt;
    if (diff > step) yaw += step;
    else if (diff < -step) yaw -= step;
    else yaw = targetYaw;
    group.rotation.y = yaw;

    switch (currentName) {
      case 'idle':
        updateIdle(dt);
        break;
      case 'walk':
        updateWalk();
        break;
      case 'jump':
        updateJump();
        break;
      case 'cheer':
        updateCheer();
        break;
      case 'sad':
        updateSad();
        break;
      case 'squash':
        updateSquash();
        break;
    }
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
