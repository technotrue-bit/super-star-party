/**
 * SUPER STAR PARTY — keyboard (and mouse) mapping for the control pads.
 *
 * The minigame screen builds one of these for a game that sets `pad` and
 * feeds it key presses, window blur, and a per-frame tick. It turns them
 * into the pad calls on `MinigameInput` (hold, swipe, button, dial, draw).
 *
 *   hold   Space down / up. A blur ends the hold, so it never charges forever.
 *   swipe  an arrow (or WASD) picks the direction, Space held is the power
 *          (held seconds / 1 s, clamped 0..1), release throws it.
 *   twin   Z or Left = A, X or Right = B.
 *   dial   Q or Left turns back, E or Right turns forward, 1.5 turns/s of
 *          real time, sent every frame.
 *   draw   mouse drag, or Space is the pen and the arrows move a cursor
 *          (strokes are drawn while Space is held).
 *
 * Time here is the real clock (a hand on a key does not run on game time).
 * A key event carries its own timestamp, so a slow frame between the press
 * and the code that sees it does not lengthen a hold.
 * It never draws from any rng and never touches game state.
 */
import type { MinigameInput, MinigamePad } from "./framework";

/** Keyboard dial speed, in full turns per second. */
export const DIAL_TURNS_PER_SEC = 1.5;
/** A swipe on the keyboard reaches full power after this many seconds of Space. */
export const SWIPE_FULL_HOLD = 1.0;
/** Draw `move` events are capped at this many per second. */
export const DRAW_MAX_MOVES_PER_SEC = 60;
/** Keyboard draw cursor speed, in screens per second. */
const CURSOR_SPEED = 0.6;
/** The longest frame gap the dial counts as turning time, in seconds. */
const MAX_TICK_SEC = 0.5;

type PadCalls = Pick<MinigameInput, "hold" | "swipe" | "button" | "dial" | "draw">;

export interface PadKeys {
  /** True when the pad took the key (the screen then stops the browser default). */
  keyDown(key: string, repeat: boolean, at?: number): boolean;
  keyUp(key: string, at?: number): boolean;
  /** The window lost focus or the round left play: end everything held. */
  release(): void;
  /** Once per frame while playing. */
  tick(dt: number): void;
  /** Mouse stroke for the draw pad. x and y are normalized 0..1. */
  stroke(phase: "start" | "move" | "end", x: number, y: number): void;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Arrow and WASD keys as a screen-space step (+x right, +y down). */
function dirOf(key: string): { x: number; y: number } | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return { x: 0, y: -1 };
    case "ArrowDown":
    case "s":
    case "S":
      return { x: 0, y: 1 };
    case "ArrowLeft":
    case "a":
    case "A":
      return { x: -1, y: 0 };
    case "ArrowRight":
    case "d":
    case "D":
      return { x: 1, y: 0 };
    default:
      return null;
  }
}

export function createPadKeys(
  pad: MinigamePad,
  input: () => PadCalls | undefined,
  now: () => number = () => performance.now(),
): PadKeys {
  /** Space (or Enter) is down since this time, else null. */
  let spaceAt: number | null = null;
  const heldDirs = new Set<string>();
  let aim = { x: 0, y: -1 };
  const twinDown = { a: false, b: false };
  /** Dial direction keys held: -1 back, +1 forward. */
  const dialKeys = new Set<-1 | 1>();
  let cursor = { x: 0.5, y: 0.5 };
  let penDown = false;
  let lastMoveAt = -Infinity;
  let lastTickAt: number | null = null;
  /** The dial has been counted up to this time while a turn key is held. */
  let dialSince: number | null = null;

  const norm = (key: string): string => (key === "Enter" ? " " : key.length === 1 ? key.toLowerCase() : key);

  const recomputeAim = (): void => {
    let x = 0;
    let y = 0;
    for (const k of heldDirs) {
      const d = dirOf(k);
      if (d) {
        x += d.x;
        y += d.y;
      }
    }
    const len = Math.hypot(x, y);
    if (len > 0) aim = { x: x / len, y: y / len };
  };

  const emitMove = (x: number, y: number): void => {
    const t = now();
    if (t - lastMoveAt < 1000 / DRAW_MAX_MOVES_PER_SEC) return;
    lastMoveAt = t;
    input()?.draw?.("move", x, y);
  };

  const spaceDown = (at: number): void => {
    if (spaceAt !== null) return;
    spaceAt = at;
    if (pad === "hold") input()?.hold?.(true, 0);
    else if (pad === "draw") {
      penDown = true;
      input()?.draw?.("start", cursor.x, cursor.y);
    }
  };

  const spaceUp = (at: number): void => {
    if (spaceAt === null) return;
    const heldSec = Math.max(0, (at - spaceAt) / 1000);
    spaceAt = null;
    if (pad === "hold") input()?.hold?.(false, heldSec);
    else if (pad === "swipe") input()?.swipe?.(aim.x, aim.y, clamp01(heldSec / SWIPE_FULL_HOLD));
    else if (pad === "draw" && penDown) {
      penDown = false;
      input()?.draw?.("end", cursor.x, cursor.y);
    }
  };

  const setTwin = (which: "a" | "b", down: boolean): void => {
    if (twinDown[which] === down) return;
    twinDown[which] = down;
    input()?.button?.(which, down);
  };

  const dialDir = (): number => {
    let d = 0;
    for (const k of dialKeys) d += k;
    return d;
  };

  /**
   * Send the turn accrued since the last count, up to `at`. Called every
   * frame and on every dial key edge, so the total turned is the time the
   * key was held at 1.5 turns/s however slow the frames. A long stall is
   * clamped so it cannot spin in one jump.
   */
  const flushDial = (at: number): void => {
    if (dialSince === null) return;
    const d = dialDir();
    const sec = Math.min(MAX_TICK_SEC, (at - dialSince) / 1000);
    if (sec <= 0) return;
    dialSince = at;
    if (d !== 0) input()?.dial?.(d * DIAL_TURNS_PER_SEC * Math.PI * 2 * sec);
  };

  /** Map a key to the dial or twin side it drives, for the current pad. */
  const sideOf = (key: string): 1 | -1 | null => {
    if (pad === "twin") {
      if (key === "z" || key === "ArrowLeft") return -1;
      if (key === "x" || key === "ArrowRight") return 1;
    } else if (pad === "dial") {
      if (key === "q" || key === "ArrowLeft") return -1;
      if (key === "e" || key === "ArrowRight") return 1;
    }
    return null;
  };

  return {
    keyDown(raw, repeat, at = now()) {
      const key = norm(raw);
      if (key === " ") {
        if (pad === "twin" || pad === "dial") return false;
        if (!repeat) spaceDown(at);
        return true;
      }
      if (pad === "swipe" || pad === "draw") {
        if (!dirOf(key)) return false;
        if (!repeat) {
          heldDirs.add(key);
          recomputeAim();
        }
        return true;
      }
      const side = sideOf(key);
      if (side === null) return false;
      if (pad === "twin") {
        if (!repeat) setTwin(side < 0 ? "a" : "b", true);
      } else if (!repeat) {
        flushDial(at);
        dialKeys.add(side);
        if (dialSince === null) dialSince = at;
      }
      return true;
    },

    keyUp(raw, at = now()) {
      const key = norm(raw);
      if (key === " ") {
        if (pad === "twin" || pad === "dial") return false;
        spaceUp(at);
        return true;
      }
      if (pad === "swipe" || pad === "draw") {
        if (!dirOf(key)) return false;
        heldDirs.delete(key);
        recomputeAim();
        return true;
      }
      const side = sideOf(key);
      if (side === null) return false;
      if (pad === "twin") setTwin(side < 0 ? "a" : "b", false);
      else {
        flushDial(at);
        dialKeys.delete(side);
        if (dialKeys.size === 0) dialSince = null;
      }
      return true;
    },

    release() {
      if (pad === "swipe") spaceAt = null; // a lost window cancels the throw
      else spaceUp(now());
      if (pad === "draw" && penDown) {
        penDown = false;
        input()?.draw?.("end", cursor.x, cursor.y);
      }
      if (pad === "twin") {
        setTwin("a", false);
        setTwin("b", false);
      }
      dialKeys.clear();
      dialSince = null;
      heldDirs.clear();
      spaceAt = null;
      lastTickAt = null;
    },

    tick(dt) {
      const t = now();
      const real = lastTickAt === null ? dt : Math.min(MAX_TICK_SEC, (t - lastTickAt) / 1000);
      lastTickAt = t;
      if (pad === "dial") flushDial(t);
      else if (pad === "draw") {
        let x = 0;
        let y = 0;
        for (const k of heldDirs) {
          const d = dirOf(k);
          if (d) {
            x += d.x;
            y += d.y;
          }
        }
        if (x !== 0 || y !== 0) {
          const len = Math.hypot(x, y);
          cursor = {
            x: clamp01(cursor.x + (x / len) * CURSOR_SPEED * real),
            y: clamp01(cursor.y + (y / len) * CURSOR_SPEED * real),
          };
          if (penDown) emitMove(cursor.x, cursor.y);
        }
      }
    },

    stroke(phase, x, y) {
      if (pad !== "draw") return;
      cursor = { x: clamp01(x), y: clamp01(y) };
      if (phase === "start") {
        penDown = true;
        lastMoveAt = -Infinity;
        input()?.draw?.("start", x, y);
      } else if (phase === "move") {
        if (penDown) emitMove(x, y);
      } else if (penDown) {
        penDown = false;
        input()?.draw?.("end", x, y);
      }
    },
  };
}
