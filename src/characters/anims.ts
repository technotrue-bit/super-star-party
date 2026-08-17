import type * as THREE from 'three';
import { settings } from '../config/settings';
import { rng } from '../core/rng';
import type { CharacterKind } from './roster';

export type AnimName = 'idle' | 'walk' | 'jump' | 'cheer' | 'sad' | 'squash';

export interface AnimController {
  set(name: AnimName): void;
  current(): AnimName;
  update(dt: number): void;
  setFacing(angle: number): void;
}

const TAU = Math.PI * 2;
const PART_KEYS = ['ears', 'antenna', 'trunk', 'star'] as const;
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

  // Base rotations of the movable parts so fidgets and lag can restore them.
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
  let nextBlink = 3 + rng.next() * 2;
  let nextFidget = 5 + rng.int(0, 4);

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

  const set = (name: AnimName): void => {
    if (currentName === name) return; // keep phase continuity for repeats
    currentName = name;
    t = 0;
    blinkT = 0;
    fidgetT = 0;
    blinking = false;
    fidgeting = false;
    nextBlink = 3 + rng.next() * 2;
    nextFidget = 5 + rng.int(0, 4);
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
        nextBlink = 3 + rng.next() * 2;
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
  };

  const updateJump = (): void => {
    if (t < JUMP_CROUCH) {
      const e = smoothstep(t / JUMP_CROUCH);
      group.scale.y = baseScale.y * (1 - 0.15 * e);
      group.scale.x = baseScale.x * (1 + 0.08 * e);
      group.scale.z = baseScale.z * (1 + 0.08 * e);
      group.position.y = basePosY - 0.02 * e;
      group.rotation.x = baseRotX;
    } else if (t < JUMP_CROUCH + JUMP_AIR) {
      const p = (t - JUMP_CROUCH) / JUMP_AIR;
      group.position.y = basePosY + Math.sin(Math.PI * p) * 0.9;
      group.scale.copy(baseScale);
      // Bounce does a front flip over the arc.
      group.rotation.x = baseRotX + (kind.key === 'bounce' ? p * TAU : 0);
    } else {
      const p = (t - JUMP_CROUCH - JUMP_AIR) / JUMP_LAND;
      group.position.y = basePosY;
      const el = easeOutElastic(p);
      group.scale.y = baseScale.y * (0.7 + 0.3 * el);
      group.scale.x = baseScale.x * (1.15 - 0.15 * el);
      group.scale.z = baseScale.z * (1.15 - 0.15 * el);
      group.rotation.x = baseRotX + (kind.key === 'bounce' ? TAU : 0);
    }
    if (t >= JUMP_TOTAL) set('idle');
  };

  const updateCheer = (): void => {
    const cycle = 0.25;
    const p = (t % cycle) / cycle;
    const hop = Math.sin(Math.PI * p);
    group.position.y = basePosY + hop * 0.18;
    group.scale.y = baseScale.y * (1 + hop * 0.12);
    group.scale.x = baseScale.x * (1 - hop * 0.06);
    group.scale.z = baseScale.z * (1 - hop * 0.06);
    group.rotation.x = baseRotX;
    group.rotation.z = baseRotZ + Math.sin(t * 20) * 0.08;
  };

  const updateSad = (): void => {
    group.rotation.x = baseRotX + 0.18;
    group.position.y = basePosY - 0.06;
    group.scale.y = baseScale.y * (0.92 + Math.sin(t * 1.2) * 0.015);
    group.scale.x = baseScale.x * 1.04;
    group.scale.z = baseScale.z * 1.04;
    group.rotation.z = baseRotZ;
  };

  const updateSquash = (): void => {
    const e = easeOutElastic(Math.min(t / SQUASH_TIME, 1));
    group.scale.y = baseScale.y * (0.7 + 0.3 * e);
    group.scale.x = baseScale.x * (1.15 - 0.15 * e);
    group.scale.z = baseScale.z * (1.15 - 0.15 * e);
    group.position.y = basePosY;
    group.rotation.x = baseRotX;
    group.rotation.z = baseRotZ;
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
