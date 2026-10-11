/**
 * SUPER STAR PARTY — party camera shots (lively board, slice 2).
 *
 * The board screen's camera block hands its follow position and look target
 * to applyCameraShots() every frame. Two layers ride on top of the follow:
 *
 * 1. Lively shots: a one-at-a-time queue of curved swoops (an orbit arc
 *    around the subject that dips in or climbs, blended over the follow
 *    camera and eased back). Triggered by bus events: star:buy,
 *    star:balloon_moved, happening:event, stamp:jackpot, squeeze:hug, and the
 *    first turn:start of the last five turns (once a match). All six are
 *    real event names in core/events.ts; nothing needed remapping.
 * 2. The dice/ceremony punch (`_punch`), applied last so it always wins.
 *    While a punch runs, or while ceremony.holdCamera holds the camera, no
 *    shot starts and an active one fades out over shotCancelTime.
 *
 * Shots never gate the turn loop: they are stepped from the render update
 * only, the turn loop never calls, awaits, or reads anything here, and every
 * shot has a fixed board-time length. Queued shots go stale (shotMaxWait /
 * shotMaxAge) and the queue drops its oldest entry when full.
 *
 * With `?lively=0`, `settings.lively.shots` off, or `?speed=` above
 * shotMaxSpeed, nothing is subscribed and only the punch runs (same math as
 * before). Under prefers-reduced-motion no shot plays. No per-frame
 * allocations.
 */
import * as THREE from "three";
import { bus } from "../../core/events";
import { match } from "../../core/game";
import { settings, livelyEnabled, playSpeed, prefersReducedMotion } from "../../config/settings";

/** Shape of the board screen's `_punch` (dice roll / ceremony focus). */
export interface CameraPunch {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  t: number;
}

/** What a shot needs from the board: the world position of a space. */
export interface ShotBoard {
  spaceWorldPos(i: number): THREE.Vector3;
}

export type ShotKind = "star" | "balloon" | "happening" | "jackpot" | "hug" | "last5";
export const SHOT_KINDS: readonly ShotKind[] = ["star", "balloon", "happening", "jackpot", "hug", "last5"];

interface ShotStyle {
  /** Board seconds; each fits inside the beat it plays in. */
  dur: number;
  /** Orbit swing around the subject (rad). */
  swing: number;
  /** Fraction of the horizontal distance closed at mid-shot (<0 backs off). */
  close: number;
  /** Height multiplier at mid-shot (<1 dips, >1 climbs). */
  rise: number;
  /** Look target height above the subject. */
  lookY: number;
}

const STYLES: Record<ShotKind, ShotStyle> = {
  // Star buy: the ceremony holds the camera, so this plays right after it, on the buyer.
  star: { dur: 1.6, swing: 0.55, close: 0.55, rise: 0.75, lookY: 1.2 },
  // Balloon: sweep over to where the Grand Prize Balloon re-inflated.
  balloon: { dur: 1.5, swing: -0.7, close: 0.6, rise: 0.85, lookY: 1.6 },
  // Happening: inside the ~2.8 s happening stinger.
  happening: { dur: 2.2, swing: 0.8, close: 0.5, rise: 0.7, lookY: 1.0 },
  jackpot: { dur: 1.6, swing: -0.5, close: 0.55, rise: 0.75, lookY: 1.2 },
  hug: { dur: 1.4, swing: 0.45, close: 0.5, rise: 0.7, lookY: 1.0 },
  // Last five turns: a climbing, backing-off arc around whatever the camera
  // was framing, inside the TURN banner beat (~1.7 s before the dice).
  last5: { dur: 1.6, swing: 0.9, close: -0.12, rise: 1.3, lookY: 0 },
};

/** Debug counters for probes. Never read by gameplay. */
const stats = {
  requested: 0,
  fired: 0,
  completed: 0,
  cancelled: 0,
  dropped: 0,
  stale: 0,
  skipped: 0,
  byKind: Object.fromEntries(SHOT_KINDS.map((k) => [k, 0])) as Record<ShotKind, number>,
};

interface QueuedShot {
  kind: ShotKind;
  /** Space index the shot frames, or -1 for the follow camera's look target. */
  space: number;
  /** Board seconds since the trigger. */
  age: number;
  /** Board seconds spent waiting while the camera was free. */
  wait: number;
}

const L = settings.lively;
const QUEUE_MAX = Math.max(1, L.shotQueue);

// Fixed-size queue, kept in order at queue[0..qLen); entries are reused.
const queue: QueuedShot[] = Array.from({ length: QUEUE_MAX }, () => ({ kind: "star" as ShotKind, space: 0, age: 0, wait: 0 }));
let qLen = 0;

// Active shot.
let active = false;
let activeKind: ShotKind = "star";
let u = 0; // board seconds into the shot
let fade = 1; // 1 normally; ramps to 0 when a punch or hold cancels the shot
let cancelling = false;
const subject = new THREE.Vector3();
let az0 = 0;
let dist0 = 0;
let height0 = 0;

let wired = false;
let last5Done = false;

const scratch = new THREE.Vector3();
const lookTo = new THREE.Vector3();

/** Lively shots for this page load: lively on, shots on, not too fast. */
const shotsAllowed = livelyEnabled() && L.shots && playSpeed() <= L.shotMaxSpeed;

function playerSpace(pid: number): number {
  return match.players[pid]?.space ?? -1;
}

/** Remove queue[k], keeping order. */
function removeAt(k: number): QueuedShot {
  const out = queue[k];
  for (let j = k; j < qLen - 1; j++) queue[j] = queue[j + 1];
  queue[qLen - 1] = out;
  qLen--;
  return out;
}

function request(kind: ShotKind, space: number): void {
  stats.requested++;
  if (prefersReducedMotion()) {
    stats.skipped++;
    return;
  }
  // Coalesce: a second trigger for a shot already waiting just retargets it.
  for (let k = 0; k < qLen; k++) {
    if (queue[k].kind === kind) {
      queue[k].space = space;
      return;
    }
  }
  if (qLen === QUEUE_MAX) {
    removeAt(0);
    stats.dropped++;
  }
  const q = queue[qLen++];
  q.kind = kind;
  q.space = space;
  q.age = 0;
  q.wait = 0;
}

/** Remove every waiting shot of `kind` (the active shot is left alone). */
function dropKind(kind: ShotKind): void {
  for (let k = qLen - 1; k >= 0; k--) {
    if (queue[k].kind === kind) removeAt(k);
  }
}

function clearShots(): void {
  qLen = 0;
  active = false;
}

function wire(): void {
  if (wired) return;
  wired = true;
  bus.on("star:buy", ({ player }) => request("star", playerSpace(player)));
  // A bought balloon is revealed after the ceremony (star:reveal); the pan
  // replaces the pending buyer shot so it starts when the hold releases.
  bus.on("star:balloon_moved", ({ to, cause }) => {
    if (cause !== "buy") request("balloon", to);
  });
  bus.on("star:reveal", ({ to }) => {
    dropKind("star");
    request("balloon", to);
  });
  bus.on("happening:event", ({ player }) => request("happening", playerSpace(player)));
  bus.on("stamp:jackpot", ({ player }) => request("jackpot", playerSpace(player)));
  bus.on("squeeze:hug", ({ space }) => request("hug", space));
  // match:start fires on every board entry (after each minigame too), so the
  // once-a-match latch re-arms on any turn before the last five instead.
  bus.on("turn:start", ({ turn }) => {
    if (match.totalTurns <= 0) return;
    if (turn < match.totalTurns - 4) {
      last5Done = false;
      return;
    }
    if (last5Done) return;
    last5Done = true;
    request("last5", -1);
  });
  // Leaving the board (minigame, results) drops everything in flight.
  bus.on("screen:change", ({ from }) => {
    if (from === "board") clearShots();
  });
}

function start(q: QueuedShot, board: ShotBoard, followPos: THREE.Vector3, followLook: THREE.Vector3): void {
  activeKind = q.kind;
  if (q.space < 0) subject.copy(followLook).setY(0);
  else subject.copy(board.spaceWorldPos(q.space));
  scratch.subVectors(followPos, subject);
  az0 = Math.atan2(scratch.x, scratch.z);
  dist0 = Math.hypot(scratch.x, scratch.z);
  height0 = scratch.y;
  u = 0;
  fade = 1;
  cancelling = false;
  active = true;
  stats.fired++;
  stats.byKind[activeKind]++;
}

function smooth(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/**
 * Step the lively shot (if any) over the follow camera, then the punch.
 * `pos`/`look` hold the follow camera on entry and the final camera on exit.
 * Returns the punch to keep (null once it has finished).
 */
export function applyCameraShots(
  dt: number,
  pos: THREE.Vector3,
  look: THREE.Vector3,
  punch: CameraPunch | null,
  held: boolean,
  board: ShotBoard | null | undefined
): CameraPunch | null {
  if (shotsAllowed) {
    wire();
    // Reduced motion switched on mid-match: drop everything, no fade.
    if (prefersReducedMotion()) clearShots();
    else stepShots(dt, pos, look, punch !== null || held, board ?? null);
  }
  return stepPunch(dt, pos, look, punch);
}

function stepShots(dt: number, pos: THREE.Vector3, look: THREE.Vector3, blocked: boolean, board: ShotBoard | null): void {
  // Age the queue; stale entries go. A hold or punch pauses the wait clock
  // (so a balloon shot can follow the star ceremony) but not the age cap.
  for (let k = 0; k < qLen; ) {
    const q = queue[k];
    q.age += dt;
    if (!blocked) q.wait += dt;
    if (q.age > L.shotMaxAge || q.wait > L.shotMaxWait) {
      removeAt(k);
      stats.stale++;
      continue;
    }
    k++;
  }

  if (active && blocked && !cancelling) {
    cancelling = true;
    stats.cancelled++;
  }
  if (!active && !blocked && qLen > 0 && board) {
    const q = removeAt(0);
    if (q.space < 0 && q.kind !== "last5") stats.stale++; // player left the match
    else start(q, board, pos, look);
  }
  if (!active) return;

  const s = STYLES[activeKind];
  u += dt;
  if (cancelling) fade -= dt / L.shotCancelTime;
  const x = u / s.dur;
  if (x >= 1 || fade <= 0) {
    active = false;
    if (!cancelling) stats.completed++;
    return;
  }

  // Blend weight: ease in over the first 22%, out over the last 30%.
  const w = smooth(x / 0.22) * (1 - smooth((x - 0.7) / 0.3)) * fade;
  // Orbit arc: the azimuth swings across the shot while the camera closes in
  // (or backs off) and dips (or climbs), so the path is a smooth curve.
  const e = smooth(x);
  const bump = Math.sin(Math.PI * e);
  const az = az0 + s.swing * e;
  const d = dist0 * (1 - s.close * bump);
  const y = height0 * (1 + (s.rise - 1) * bump);
  scratch.set(subject.x + Math.sin(az) * d, subject.y + y, subject.z + Math.cos(az) * d);
  lookTo.set(subject.x, subject.y + s.lookY, subject.z);
  pos.lerp(scratch, w);
  look.lerp(lookTo, w);
}

/** The board screen's original dice/ceremony punch, unchanged. */
function stepPunch(dt: number, pos: THREE.Vector3, look: THREE.Vector3, p: CameraPunch | null): CameraPunch | null {
  if (!p) return null;
  p.t += dt;
  let k: number;
  if (p.t < 0.45) {
    const q = p.t / 0.45;
    k = 1 - Math.pow(1 - q, 3);
  } else if (p.t < 1.55) {
    k = 1;
  } else {
    const q = Math.min(1, (p.t - 1.55) / 0.45);
    k = 1 - (1 - Math.pow(1 - q, 3));
  }
  pos.lerpVectors(pos, p.pos, k);
  look.lerpVectors(look, p.look, k);
  return p.t > 2.05 ? null : p;
}

/** Probe view of the shot queue. */
export function livelyShotsDebug(): {
  enabled: boolean;
  wired: boolean;
  active: ShotKind | null;
  queued: number;
  requested: number;
  fired: number;
  completed: number;
  cancelled: number;
  dropped: number;
  stale: number;
  skipped: number;
  byKind: Record<ShotKind, number>;
} {
  return {
    enabled: shotsAllowed,
    wired,
    active: active ? activeKind : null,
    queued: qLen,
    requested: stats.requested,
    fired: stats.fired,
    completed: stats.completed,
    cancelled: stats.cancelled,
    dropped: stats.dropped,
    stale: stats.stale,
    skipped: stats.skipped,
    byKind: { ...stats.byKind },
  };
}
