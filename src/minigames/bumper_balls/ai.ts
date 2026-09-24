/**
 * Bumper Balls — CPU brains.
 *
 * Deterministic: every decision consumes ctx.rng() (the framework's seeded
 * stream) at strategy-pick time only. Per-step steering is pure math over
 * live positions — no per-step randomness, so seeded replays are stable.
 * Re-pick timing is an INTEGER fixed-step countdown (see game.ts), so the
 * step at which a re-pick fires — and therefore the rng draw order — is a
 * pure function of the seeded rng + step index, identical across runs.
 */
import type { MinigameContext } from "../framework";

export type CpuStrategy = "chase" | "center" | "flee";

export interface CpuBrain {
  /** Fixed 1/60s steps until the next strategy re-pick. */
  pickIn: number;
  strategy: CpuStrategy;
  /** Fraction of the human top speed (0.65–0.95). */
  speedMul: number;
  /** Flavor roll (0..1) — orbit side / wander angle, fixed per pick. */
  flavor: number;
}

export interface CpuRival {
  id: number;
  x: number;
  z: number;
}

/** Strategy weights: 40% chase nearest rival, 35% drift to center, 25% flee. */
const CHASE_P = 0.4;
const CENTER_P = 0.75;

/** Fresh brain for a CPU player (picks on the first step of play). */
export function freshBrain(): CpuBrain {
  return { pickIn: 0, strategy: "chase", speedMul: 0.85, flavor: 0.5 };
}

/**
 * Full strategy re-pick (4 rng draws, fixed order):
 * strategy roll, speed roll, next-pick timer, flavor roll.
 * The timer is stored in whole fixed steps (1/60s) so the re-pick fires at
 * a deterministic step index regardless of frame timing.
 */
export function repick(brain: CpuBrain, ctx: Pick<MinigameContext, "rng">): void {
  const roll = ctx.rng();
  brain.strategy = roll < CHASE_P ? "chase" : roll < CENTER_P ? "center" : "flee";
  brain.speedMul = 0.65 + ctx.rng() * 0.3;
  brain.pickIn = Math.round((0.6 + ctx.rng() * 0.6) * 60);
  brain.flavor = ctx.rng();
}

/**
 * Desired movement direction (unit vector, or null to drift).
 * Pure function of current positions + brain — no rng, no hidden state.
 */
export function cpuDesiredDir(
  pos: { x: number; z: number },
  rivals: CpuRival[],
  ringR: number,
  brain: CpuBrain
): { x: number; z: number } | null {
  const d = Math.hypot(pos.x, pos.z);
  const side = brain.flavor < 0.5 ? -1 : 1;

  switch (brain.strategy) {
    case "chase": {
      // Ring-gated chase: when the ring is still wide (> ~2.5u), CPUs drift
      // slowly toward center — they don't chase or bump (which would eject
      // players at wide radii), but they also don't stand still and block
      // the human's path. Only when the ring closes below ~2.5u do CPUs
      // start hunting.
      const d0 = Math.hypot(pos.x, pos.z);
      if (ringR > 2.5) {
        if (d0 > 0.3) return norm(-pos.x / d0, -pos.z / d0);
        return null;
      }
      // Ring is close — hunt the nearest rival
      let best: CpuRival | null = null;
      let bestD = Infinity;
      for (const o of rivals) {
        const dd = Math.hypot(o.x - pos.x, o.z - pos.z);
        if (dd < bestD) {
          bestD = dd;
          best = o;
        }
      }
      if (!best) return null;
      return norm(best.x - pos.x, best.z - pos.z);
    }
    case "center": {
      if (d < 0.35) {
        // Already home: wander a little so the CPU never freezes.
        const a = brain.flavor * Math.PI * 2;
        return { x: Math.cos(a) * 0.7, z: Math.sin(a) * 0.7 };
      }
      return { x: -pos.x / d, z: -pos.z / d };
    }
    case "flee": {
      // Run inward hard when the ring is close...
      const margin = ringR - d;
      if (margin < 1.4) {
        const tx = -pos.x / d;
        const tz = -pos.z / d;
        // Slight tangential lean so fleers arc instead of beelining.
        return norm(tx - tz * 0.45 * side, tz + tx * 0.45 * side);
      }
      // ...orbit the centre when safe, so the CPU keeps hunting angles.
      return { x: (-pos.z / Math.max(d, 0.001)) * side, z: (pos.x / Math.max(d, 0.001)) * side };
    }
  }
}

function norm(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}
