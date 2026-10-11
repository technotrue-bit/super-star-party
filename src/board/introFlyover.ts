/**
 * SUPER STAR PARTY — the match-start flyover. Before the turn-order ceremony
 * the camera sweeps the island the way a party-board intro does: a wide
 * establishing shot over the sea, a pass across the landmarks, a look at the
 * board's gimmick (the Funhouse Gate) and the hill, then it settles on the
 * party camera's overview. Tap, click, or any key skips it.
 *
 * Presentation only: it never touches match state or the rng, and the turn
 * loop has not started while it plays. It runs on wall-clock time (like the
 * order ceremony that follows), so a slow frame rate cannot stretch it.
 */
import * as THREE from "three";
import type { BoardDef } from "./boardData";
import { groundHeight } from "./boardData";

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

const DURATION = 7.2;
const SKIP_BLEND = 0.45;

function smooth(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
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
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const R = Math.max(maxX - minX, maxZ - minZ) / 2;
  const hill = def.terrain?.hills[0];
  const hillTop = hill ? hill.height : 0;
  const centre = new THREE.Vector3(cx, hillTop, cz);

  // Waypoints: [camera position, look target].
  const pts: THREE.Vector3[] = [];
  const looks: THREE.Vector3[] = [];
  const way = (p: THREE.Vector3, l: THREE.Vector3): void => {
    pts.push(p);
    looks.push(l);
  };
  // 1. Wide and high over the sea, south-east: the whole island in frame.
  way(new THREE.Vector3(cx + R * 2.2, R * 1.7, cz + R * 2.6), centre.clone());
  // 2. Low swing along the east coast, past the far landmarks.
  way(new THREE.Vector3(cx + R * 1.6, R * 0.55, cz - R * 0.6), new THREE.Vector3(cx + R * 0.4, 1.5, cz - R * 0.5));
  // 3. Over the hill (or the middle of a flat board), looking across it.
  way(new THREE.Vector3(cx + R * 0.2, hillTop + R * 0.55, cz - R * 0.95), new THREE.Vector3(cx, hillTop + 0.6, cz + R * 0.2));
  // 4. The gate, when the board has one: framed from inside the loop.
  if (def.gate) {
    const g = def.spaces[def.gate.from];
    const o = def.spaces[def.gate.open];
    const gx = (g.x * 2 + o.x) / 3;
    const gz = (g.y * 2 + o.y) / 3;
    const gy = groundHeight(def, gx, gz);
    const away = new THREE.Vector2(gx - cx, gz - cz).normalize();
    way(
      new THREE.Vector3(gx - away.x * 7, gy + 6.5, gz - away.y * 7),
      new THREE.Vector3(gx, gy + 1.2, gz)
    );
  }
  // 5. The overview the party camera uses.
  way(endPos.clone(), endLook.clone());

  const posCurve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const lookCurve = new THREE.CatmullRomCurve3(looks, false, "centripetal");
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const from = new THREE.Vector3();
  const fromLook = new THREE.Vector3();

  const beats: IntroBeat[] = [{ at: 0.2, text: `WELCOME TO ${def.name.toUpperCase()}!` }];
  if (hill) beats.push({ at: 2.9, text: "STARLIGHT RISE: THE HILLTOP LANE" });
  if (def.gate) beats.push({ at: 4.7, text: `THE ${def.gate.label.toUpperCase()} FLIPS EVERY ROUND!` });

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
      // Ease in and out of the whole path; the middle keeps moving.
      const u = smooth(t / DURATION) * 0.6 + (t / DURATION) * 0.4;
      posCurve.getPoint(u, pos);
      lookCurve.getPoint(u, look);
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
