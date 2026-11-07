/**
 * SUPER STAR PARTY — the match-start flyover. Before the turn-order ceremony
 * the camera does one full, smooth spin round the board: it starts out wide
 * and low, circles the whole map once with the board centred in frame, and
 * rises into the party camera's overview, arriving there at rest so the
 * hand-off has no cut and no jolt. Tap, click, or any key skips it (a short
 * eased glide to the overview).
 *
 * One parameter drives everything (angle, radius, height, look), and it moves
 * on a trapezoid speed profile: ease in, a steady spin, ease out to a stop.
 * The look target never leaves the board's centre, so the view never swings
 * back and forth.
 *
 * Presentation only: it never touches match state or the rng, and the turn
 * loop has not started while it plays. It runs on wall-clock time (like the
 * order ceremony that follows), so a slow frame rate cannot stretch it.
 */
import * as THREE from "three";
import type { BoardDef } from "./boardData";

export interface IntroBeat {
  /** Seconds into the flyover at which to show `text`. */
  at: number;
  text: string;
}

export interface IntroFlyover {
  /** Camera pose for now, or null once the flyover has finished. */
  pose(now: number): { pos: THREE.Vector3; look: THREE.Vector3 } | null;
  /** Jump to the end (a short blend into the overview). */
  skip(now: number): void;
  /** Banner lines and when they play. */
  beats: readonly IntroBeat[];
  /** Total length in seconds (unskipped). */
  duration: number;
}

const DURATION = 9;
const SKIP_BLEND = 0.8;
/** Full turns round the board. */
const TURNS = 1;
/** Fractions of the run spent speeding up and slowing down. */
const RAMP_IN = 0.14;
const RAMP_OUT = 0.32;

function smooth(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/**
 * Progress 0..1 along a trapezoid speed profile: speed ramps up over the
 * first RAMP_IN, holds, then ramps down to zero over the last RAMP_OUT. The
 * spin ends at rest, exactly where the overview camera sits.
 */
export function orbitProgress(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const a = RAMP_IN;
  const b = RAMP_OUT;
  const total = 1 - a / 2 - b / 2;
  let d: number;
  if (x < a) d = (x * x) / (2 * a);
  else if (x <= 1 - b) d = a / 2 + (x - a);
  else {
    const y = x - (1 - b);
    d = a / 2 + (1 - b - a) + y - (y * y) / (2 * b);
  }
  return Math.min(1, d / total);
}

/**
 * Build the flyover for `def`, ending exactly on (endPos, endLook) — the board
 * screen's overview camera, so the hand-off has no cut.
 */
export function createIntroFlyover(
  def: BoardDef,
  start: number,
  endPos: THREE.Vector3,
  endLook: THREE.Vector3
): IntroFlyover {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of def.spaces) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.y);
    maxZ = Math.max(maxZ, s.y);
  }
  const R = Math.max(maxX - minX, maxZ - minZ) / 2;
  const hill = def.terrain?.hills[0];

  // The spin circles the overview's look point and ends on the overview pose.
  const dx = endPos.x - endLook.x;
  const dz = endPos.z - endLook.z;
  const aEnd = Math.atan2(dz, dx);
  const dEnd = Math.hypot(dx, dz);
  const hEnd = endPos.y - endLook.y;
  // Start close and fairly low (a sweeping three-quarter look with the board
  // filling the frame), then spiral up and out into the overview. A near
  // top-down overview still gets a real circle to spin on.
  const dStart = Math.max(R * 1.7, Math.min(dEnd, R * 2.2));
  const hStart = Math.max(R * 0.75, Math.min(hEnd * 0.6, R * 1.1));

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const from = new THREE.Vector3();
  const fromLook = new THREE.Vector3();

  const beats: IntroBeat[] = [{ at: 0.3, text: `WELCOME TO ${def.name.toUpperCase()}!` }];
  if (hill) beats.push({ at: 3.2, text: "STARLIGHT RISE: THE HILLTOP LANE" });
  if (def.gate) beats.push({ at: 5.4, text: `THE ${def.gate.label.toUpperCase()} FLIPS EVERY ROUND!` });
  if (def.theme === "cruise") {
    beats.push({ at: 3.2, text: "ALL ABOARD THE S.S. SUPER STAR!" });
    beats.push({ at: 5.4, text: "THE SEA CHANGES EVERY ROUND!" });
  }

  /** Pose at spin progress `s` (0..1). */
  const at = (s: number): void => {
    const a = aEnd - Math.PI * 2 * TURNS * (1 - s);
    // Radius and height settle on the overview over the back half of the spin.
    const k = smooth(s * 1.25 - 0.25);
    const d = dStart + (dEnd - dStart) * k;
    const h = hStart + (hEnd - hStart) * k;
    pos.set(endLook.x + Math.cos(a) * d, endLook.y + h, endLook.z + Math.sin(a) * d);
    look.copy(endLook);
  };

  let skipAt = -1;

  return {
    beats,
    duration: DURATION,
    pose(now: number) {
      const t = (now - start) / 1000;
      if (skipAt >= 0) {
        const u = (now - skipAt) / 1000 / SKIP_BLEND;
        if (u >= 1) return null;
        const e = smooth(u);
        pos.copy(from).lerp(endPos, e);
        look.copy(fromLook).lerp(endLook, e);
        return { pos, look };
      }
      if (t >= DURATION) return null;
      at(orbitProgress(t / DURATION));
      return { pos, look };
    },
    skip(now: number) {
      if (skipAt >= 0) return;
      const cur = this.pose(now);
      if (!cur) return;
      from.copy(cur.pos);
      fromLook.copy(cur.look);
      skipAt = now;
    },
  };
}
