/**
 * Phone controls for every minigame.
 * A left thumb stick steers; a right button fires the confirm action.
 * The button wears the game's verb (DASH, PUSH, JUMP). A dead verb is hidden.
 * Desktop shows a key hint instead of the thumb controls.
 * Parent this to #app (positioned) so it sits in the visible phone area,
 * not under the Safari toolbar.
 */
import { palette } from "../config/palette";
import type { MinigameInput, MinigamePad } from "../minigames/framework";
import { DEFAULT_HOLD_MAX } from "../minigames/padKeys";

/** A swipe must travel this share of the screen height ... */
export const SWIPE_MIN_TRAVEL = 0.06;
/** ... within this many milliseconds. */
export const SWIPE_WINDOW_MS = 400;
/** Full swipe power at this many screen heights per second. */
export const SWIPE_FULL_SPEED = 3;
/** Fading swipe trail lifetime, ms. */
const SWIPE_TRAIL_MS = 320;
/** Chalk fades this long after the finger lifts, ms. */
const CHALK_FADE_MS = 1600;
/** A finger closer than this to the dial hub gives no angle (px). */
const DIAL_DEAD_ZONE = 14;

/** The pad calls the touch UI makes. The minigame screen routes them to MinigameInput. */
export type PadSink = Pick<MinigameInput, "hold" | "swipe" | "button" | "dial" | "draw">;

export interface TouchPad {
  show(): void;
  hide(): void;
  destroy(): void;
  /**
   * Verb null hides TAP. steer false hides MOVE. keys is the desktop hint.
   * repeat: holding TAP fires again every 140ms (off by default: one press,
   * one action). grid: the stick steps a cursor (one step, then a slow
   * repeat while held) instead of streaming a direction every frame.
   * pad swaps the TAP button for that control: hold (a charge-ring button),
   * swipe and draw (a full-screen layer), twin (two buttons labeled by
   * padLabels) or dial (a wheel). holdMax is the hold pad's cap in seconds.
   * The MOVE stick stays only when steer is true.
   */
  configure(opts: {
    verb: string | null;
    steer: boolean;
    keys: string;
    repeat?: boolean;
    grid?: boolean;
    touchVerb?: boolean;
    pad?: MinigamePad;
    padLabels?: { a: string; b: string };
    holdMax?: number;
  }): void;
  /** 1 = just fired, 0 = ready. Drives the cooldown ring. */
  setCooldown(ratio: number): void;
  pulse(): void;
  deny(): void;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected || document.getElementById("ssp-touch-styles")) {
    stylesInjected = true;
    return;
  }
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "ssp-touch-styles";
  style.textContent = `
    .ssp-touch {
      position: absolute; inset: 0; z-index: 92;
      pointer-events: none; display: none;
    }
    .ssp-touch--on { display: block; }
    .ssp-stick, .ssp-act {
      position: absolute; pointer-events: auto;
      touch-action: none; user-select: none; -webkit-user-select: none;
    }
    .ssp-stick {
      left: calc(14px + env(safe-area-inset-left, 0px));
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      width: 128px; height: 128px; border-radius: 50%;
      background: rgba(43,29,78,0.38);
      border: 4px solid ${palette.cream};
      box-shadow: 0 5px 0 ${palette.ink};
    }
    .ssp-stick__knob {
      position: absolute; left: 50%; top: 50%;
      width: 58px; height: 58px; margin: -29px 0 0 -29px;
      border-radius: 50%;
      background: ${palette.sun};
      border: 4px solid ${palette.ink};
      box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-stick__label, .ssp-act__label {
      position: absolute; left: 50%; top: -22px;
      transform: translateX(-50%);
      font-family: Fredoka, sans-serif;
      font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
      color: ${palette.cream};
      text-shadow: 0 2px 0 ${palette.ink};
      pointer-events: none; white-space: nowrap;
    }
    .ssp-act {
      right: calc(18px + env(safe-area-inset-right, 0px));
      bottom: calc(28px + env(safe-area-inset-bottom, 0px));
      width: 88px; height: 88px; border-radius: 50%;
      background: ${palette.candy};
      border: 4px solid ${palette.ink};
      box-shadow: 0 5px 0 ${palette.ink};
      color: ${palette.cream};
      font-family: Fredoka, sans-serif;
      font-size: 16px; font-weight: 700; letter-spacing: 0.04em;
      display: flex; align-items: center; justify-content: center;
    }
    .ssp-act .ssp-act__label {
      position: static; transform: none;
      font-size: 16px; letter-spacing: 0.04em;
    }
    .ssp-act__ring {
      position: absolute; inset: -7px;
      width: calc(100% + 14px); height: calc(100% + 14px);
      transform: rotate(-90deg);
      pointer-events: none;
      opacity: 0;
    }
    .ssp-act__ring circle {
      fill: none;
      stroke: ${palette.cream};
      stroke-width: 3.5;
      stroke-linecap: round;
    }
    .ssp-act:active, .ssp-act--down {
      transform: translateY(3px);
      box-shadow: 0 2px 0 ${palette.ink};
    }
    .ssp-act--pulse { animation: sspActPulse .22s ease-out; }
    @keyframes sspActPulse {
      0% { transform: scale(1); }
      40% { transform: scale(1.12); }
      100% { transform: scale(1); }
    }
    .ssp-act--deny { animation: sspActDeny .2s ease-out; }
    @keyframes sspActDeny {
      0% { transform: translateX(0); filter: saturate(1); }
      25% { transform: translateX(-4px); filter: saturate(0.35); }
      50% { transform: translateX(4px); filter: saturate(0.35); }
      100% { transform: translateX(0); filter: saturate(1); }
    }
    .ssp-hold, .ssp-twin, .ssp-dial, .ssp-swipe, .ssp-draw {
      position: absolute; pointer-events: auto; display: none; box-sizing: border-box;
      touch-action: none; user-select: none; -webkit-user-select: none;
      -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
    }
    .ssp-swipe, .ssp-draw { inset: 0; }
    .ssp-swipe canvas, .ssp-draw canvas {
      position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
    }
    .ssp-hold, .ssp-twin {
      border-radius: 50%; padding: 0;
      background: ${palette.candy};
      border: 4px solid ${palette.ink};
      box-shadow: 0 5px 0 ${palette.ink};
      color: ${palette.cream};
      font-family: Fredoka, sans-serif;
      font-weight: 700; letter-spacing: 0.04em;
      align-items: center; justify-content: center;
    }
    .ssp-hold {
      right: calc(14px + env(safe-area-inset-right, 0px));
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      width: 120px; height: 120px; font-size: 20px;
    }
    .ssp-hold__label, .ssp-twin__label { pointer-events: none; text-shadow: 0 2px 0 ${palette.ink}; }
    .ssp-hold__ring {
      position: absolute; inset: -9px;
      width: calc(100% + 18px); height: calc(100% + 18px);
      transform: rotate(-90deg); pointer-events: none;
    }
    .ssp-hold__ring circle { fill: none; stroke-width: 3.5; stroke-linecap: round; }
    .ssp-hold__track { stroke: rgba(43,29,78,0.35); }
    .ssp-hold__fill { stroke: ${palette.sun}; }
    .ssp-twin {
      bottom: calc(26px + env(safe-area-inset-bottom, 0px));
      width: 110px; height: 110px; font-size: 18px;
    }
    .ssp-twin--a { left: calc(14px + env(safe-area-inset-left, 0px)); }
    .ssp-twin--a.ssp-twin--shift { left: calc(150px + env(safe-area-inset-left, 0px)); }
    .ssp-twin--b { right: calc(14px + env(safe-area-inset-right, 0px)); background: ${palette.bubble}; color: ${palette.ink}; }
    .ssp-twin--b .ssp-twin__label { text-shadow: none; }
    .ssp-hold.ssp-pad--down, .ssp-twin.ssp-pad--down {
      transform: translateY(3px);
      box-shadow: 0 2px 0 ${palette.ink};
    }
    .ssp-dial {
      right: calc(12px + env(safe-area-inset-right, 0px));
      bottom: calc(22px + env(safe-area-inset-bottom, 0px));
      width: 170px; height: 170px; border-radius: 50%;
      background: rgba(43,29,78,0.38);
      border: 4px solid ${palette.cream};
      box-shadow: 0 5px 0 ${palette.ink};
    }
    .ssp-dial__wheel {
      position: absolute; inset: 8px; border-radius: 50%;
      background: repeating-conic-gradient(rgba(255,255,255,0.22) 0deg 3deg, transparent 3deg 22.5deg);
      pointer-events: none;
    }
    .ssp-dial__nub {
      position: absolute; left: 50%; top: 4px;
      width: 30px; height: 30px; margin-left: -15px; border-radius: 50%;
      background: ${palette.sun};
      border: 4px solid ${palette.ink};
      box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-dial__hub {
      position: absolute; left: 50%; top: 50%;
      width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      background: ${palette.cream}; border: 4px solid ${palette.ink};
      pointer-events: none;
    }
    .ssp-dial__label {
      position: absolute; left: 50%; top: -24px; transform: translateX(-50%);
      font-family: Fredoka, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
      color: ${palette.cream}; text-shadow: 0 2px 0 ${palette.ink};
      pointer-events: none; white-space: nowrap;
    }
    .ssp-keys {
      position: absolute; left: 50%;
      bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      pointer-events: none;
      font-family: Fredoka, sans-serif;
      font-size: 16px; font-weight: 700; letter-spacing: 0.04em;
      color: ${palette.cream};
      background: ${palette.ink};
      border: 3px solid ${palette.cream};
      border-radius: 999px;
      padding: 8px 16px;
      box-shadow: 0 4px 0 ${palette.ink};
      white-space: nowrap;
    }
    .ssp-keys--deny { animation: sspActDeny .2s ease-out; }
  `;
  document.head.appendChild(style);
}

/** Map a stick vector (screen +x right, +y down) to one cardinal action. */
export function steerAction(dx: number, dy: number): "up" | "down" | "left" | "right" | null {
  if (Math.hypot(dx, dy) < 0.28) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

/** Phones and the touch playtest get thumb controls. A mouse gets the key hint. */
export function prefersTouchControls(): boolean {
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * One element, one finger. The element keeps the id of the pointer that
 * pressed it and ignores every other pointer, so a second finger elsewhere
 * (or on the same element) never starts, moves, or ends this gesture.
 * `end` gets the event, or null when the gesture is cancelled from code.
 */
interface PointerBinding {
  /** Cancel the active gesture, if any, as `end(null, true)`. */
  cancel(): void;
  active(): boolean;
}

function bindPointer(
  el: HTMLElement,
  h: {
    down(e: PointerEvent): void;
    move?(e: PointerEvent): void;
    end(e: PointerEvent | null, cancelled: boolean): void;
  },
): PointerBinding {
  let id: number | null = null;
  el.addEventListener("pointerdown", (e) => {
    if (id !== null) return;
    id = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    e.preventDefault();
    e.stopPropagation();
    h.down(e);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault();
    e.stopPropagation();
    h.move?.(e);
  });
  const finish = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = null;
    e.stopPropagation();
    h.end(e, e.type === "pointercancel");
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
  return {
    cancel(): void {
      if (id === null) return;
      id = null;
      h.end(null, true);
    },
    active: () => id !== null,
  };
}

/** Wrap an angle difference into (-PI, PI]. */
function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}
interface TrailStroke {
  pts: TrailPoint[];
  /** When the finger lifted, or null while it is down. */
  end: number | null;
}

/**
 * A canvas that paints finger trails. Points are stored 0..1 of the layer,
 * so a rotated phone repaints them in the right place. "swipe" paints a
 * tapering streak that fades along its length; "chalk" paints a dusty line
 * that stays while the finger is down and fades after it lifts. It runs its
 * own animation frame only while something is visible.
 */
function createTrail(layer: HTMLElement, mode: "swipe" | "chalk") {
  const canvas = document.createElement("canvas");
  layer.appendChild(canvas);
  const g = canvas.getContext("2d");
  let strokes: TrailStroke[] = [];
  let raf = 0;
  const lifeMs = mode === "swipe" ? SWIPE_TRAIL_MS : CHALK_FADE_MS;

  const fit = (): { w: number; h: number } => {
    const r = layer.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  };

  const paint = (): void => {
    raf = 0;
    const now = performance.now();
    const { w, h } = fit();
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const scale = w / Math.max(1, layer.getBoundingClientRect().width);
    g.lineCap = "round";
    g.lineJoin = "round";
    strokes = strokes.filter((s) => {
      if (mode === "swipe") {
        s.pts = s.pts.filter((p) => now - p.t < lifeMs);
        return s.pts.length > 0 || s.end === null;
      }
      return s.end === null || now - s.end < lifeMs;
    });
    for (const s of strokes) {
      if (mode === "swipe") {
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1];
          const b = s.pts[i];
          const life = 1 - (now - b.t) / lifeMs;
          g.strokeStyle = palette.cream;
          g.globalAlpha = Math.max(0, life) * 0.9;
          g.lineWidth = (3 + 9 * life) * scale;
          g.beginPath();
          g.moveTo(a.x * w, a.y * h);
          g.lineTo(b.x * w, b.y * h);
          g.stroke();
        }
      } else {
        const fade = s.end === null ? 1 : Math.max(0, 1 - (now - s.end) / lifeMs);
        if (s.pts.length === 0) continue;
        const trace = (): void => {
          g.beginPath();
          g.moveTo(s.pts[0].x * w, s.pts[0].y * h);
          for (let i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i].x * w, s.pts[i].y * h);
          if (s.pts.length === 1) g.lineTo(s.pts[0].x * w + 0.1, s.pts[0].y * h);
          g.stroke();
        };
        // Soft dust under a brighter core: chalk, without any random numbers.
        g.strokeStyle = palette.cream;
        g.globalAlpha = 0.28 * fade;
        g.lineWidth = 14 * scale;
        trace();
        g.globalAlpha = 0.85 * fade;
        g.lineWidth = 5 * scale;
        g.setLineDash([22 * scale, 3 * scale]);
        trace();
        g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
    if (strokes.length > 0) raf = window.requestAnimationFrame(paint);
  };
  const kick = (): void => {
    if (!raf) raf = window.requestAnimationFrame(paint);
  };

  return {
    begin(x: number, y: number): void {
      strokes.push({ pts: [{ x, y, t: performance.now() }], end: null });
      kick();
    },
    add(x: number, y: number): void {
      const s = strokes[strokes.length - 1];
      if (s && s.end === null) s.pts.push({ x, y, t: performance.now() });
      kick();
    },
    end(): void {
      const s = strokes[strokes.length - 1];
      if (s && s.end === null) s.end = performance.now();
      kick();
    },
    clear(): void {
      strokes = [];
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      g?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

export function createTouchPad(opts: {
  onSteer: (action: "up" | "down" | "left" | "right") => void;
  /** Analog stick, screen +x right and +y down, magnitude about 0..1. */
  onStick?: (x: number, y: number) => void;
  onAction: () => void;
  /** Where the hold, swipe, twin, dial and draw pads send their calls. */
  onPad?: PadSink;
}): TouchPad {
  injectStyles();
  const host = document.getElementById("app") ?? document.body;
  const root = document.createElement("div");
  root.className = "ssp-touch";

  const stick = document.createElement("div");
  stick.className = "ssp-stick";
  stick.setAttribute("aria-label", "Move");
  const label = document.createElement("div");
  label.className = "ssp-stick__label";
  label.textContent = "MOVE";
  const knob = document.createElement("div");
  knob.className = "ssp-stick__knob";
  stick.append(label, knob);

  const act = document.createElement("button");
  act.type = "button";
  act.className = "ssp-act";
  act.setAttribute("aria-label", "Action");
  const actLabel = document.createElement("div");
  actLabel.className = "ssp-act__label";
  actLabel.textContent = "TAP";
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "ssp-act__ring");
  ring.setAttribute("viewBox", "0 0 36 36");
  ring.setAttribute("data-tap-ring", "");
  const ringCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringCircle.setAttribute("cx", "18");
  ringCircle.setAttribute("cy", "18");
  ringCircle.setAttribute("r", "15.5");
  ringCircle.setAttribute("pathLength", "100");
  ringCircle.setAttribute("stroke-dasharray", "100");
  ringCircle.setAttribute("stroke-dashoffset", "0");
  ring.appendChild(ringCircle);
  act.append(actLabel, ring);

  const keys = document.createElement("div");
  keys.className = "ssp-keys";
  keys.setAttribute("data-mg-keys", "");
  keys.style.display = "none";

  // ---- control pads: hold, swipe, twin, dial, draw ----
  // The full-screen layers come first in the DOM, so the stick and buttons
  // sit above them: a finger that lands on a button never reaches a layer.
  const swipeLayer = document.createElement("div");
  swipeLayer.className = "ssp-swipe";
  swipeLayer.setAttribute("aria-label", "Swipe");
  const swipeTrail = createTrail(swipeLayer, "swipe");
  const drawLayer = document.createElement("div");
  drawLayer.className = "ssp-draw";
  drawLayer.setAttribute("aria-label", "Draw");
  const drawTrail = createTrail(drawLayer, "chalk");

  const holdBtn = document.createElement("button");
  holdBtn.type = "button";
  holdBtn.className = "ssp-hold";
  holdBtn.setAttribute("aria-label", "Hold");
  const holdLabel = document.createElement("span");
  holdLabel.className = "ssp-hold__label";
  holdLabel.textContent = "HOLD";
  const holdRing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  holdRing.setAttribute("class", "ssp-hold__ring");
  holdRing.setAttribute("viewBox", "0 0 36 36");
  const ringCircle2 = (cls: string): SVGCircleElement => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "18");
    c.setAttribute("cy", "18");
    c.setAttribute("r", "16");
    c.setAttribute("pathLength", "100");
    c.setAttribute("stroke-dasharray", "100");
    return c;
  };
  const holdTrack = ringCircle2("ssp-hold__track");
  holdTrack.setAttribute("stroke-dashoffset", "0");
  const holdFill = ringCircle2("ssp-hold__fill");
  holdFill.setAttribute("stroke-dashoffset", "100");
  holdRing.append(holdTrack, holdFill);
  holdBtn.append(holdLabel, holdRing);

  const makeTwin = (which: "a" | "b"): { el: HTMLButtonElement; label: HTMLSpanElement } => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ssp-twin ssp-twin--${which}`;
    el.setAttribute("aria-label", which.toUpperCase());
    const label = document.createElement("span");
    label.className = "ssp-twin__label";
    label.textContent = which.toUpperCase();
    el.appendChild(label);
    return { el, label };
  };
  const twinA = makeTwin("a");
  const twinB = makeTwin("b");

  const dial = document.createElement("div");
  dial.className = "ssp-dial";
  dial.setAttribute("aria-label", "Dial");
  const dialWheel = document.createElement("div");
  dialWheel.className = "ssp-dial__wheel";
  const dialNub = document.createElement("div");
  dialNub.className = "ssp-dial__nub";
  dialWheel.appendChild(dialNub);
  const dialHub = document.createElement("div");
  dialHub.className = "ssp-dial__hub";
  const dialLabel = document.createElement("div");
  dialLabel.className = "ssp-dial__label";
  dialLabel.textContent = "TURN";
  dial.append(dialWheel, dialHub, dialLabel);

  root.append(swipeLayer, drawLayer, stick, act, holdBtn, twinA.el, twinB.el, dial, keys);
  host.appendChild(root);

  let stickId: number | null = null;
  let nx = 0;
  let ny = 0;
  let raf = 0;
  let actionId: number | null = null;
  let actionTimer = 0;
  let verbText: string | null = "TAP";
  let steerOn = true;
  let repeatOn = false;
  let gridOn = false;
  let touchVerb = true;
  // Grid stepping: the direction last sent and when it may repeat.
  let gridLast: "up" | "down" | "left" | "right" | null = null;
  let gridNextAt = 0;

  const placeKnob = (dx: number, dy: number): void => {
    const max = 36;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(max, len);
    knob.style.transform = `translate(${(dx / len) * cl}px, ${(dy / len) * cl}px)`;
    nx = (dx / len) * (cl / max);
    ny = (dy / len) * (cl / max);
  };

  const tick = (): void => {
    raf = 0;
    if (stickId === null) return;
    const action = steerAction(nx, ny);
    if (gridOn) {
      // One step on a new direction, then a held repeat (0.34s, then every 0.17s).
      const now = performance.now();
      if (action !== gridLast) {
        gridLast = action;
        if (action) {
          opts.onSteer(action);
          gridNextAt = now + 340;
        }
      } else if (action && now >= gridNextAt) {
        opts.onSteer(action);
        gridNextAt = now + 170;
      }
    } else if (action) {
      opts.onSteer(action);
    }
    opts.onStick?.(nx, ny);
    raf = window.requestAnimationFrame(tick);
  };

  const onStickDown = (e: PointerEvent): void => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    const r = stick.getBoundingClientRect();
    placeKnob(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (!raf) raf = window.requestAnimationFrame(tick);
  };
  const onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    e.stopPropagation();
    const r = stick.getBoundingClientRect();
    placeKnob(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };
  const releaseStick = (): void => {
    stickId = null;
    nx = 0;
    ny = 0;
    gridLast = null;
    knob.style.transform = "";
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    opts.onStick?.(0, 0);
  };
  const onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    releaseStick();
    e.stopPropagation();
  };

  const stopAction = (): void => {
    actionId = null;
    act.classList.remove("ssp-act--down");
    if (actionTimer) window.clearInterval(actionTimer);
    actionTimer = 0;
  };
  const onActDown = (e: PointerEvent): void => {
    if (actionId !== null) return;
    actionId = e.pointerId;
    act.setPointerCapture(e.pointerId);
    act.classList.add("ssp-act--down");
    e.preventDefault();
    e.stopPropagation();
    opts.onAction();
    if (repeatOn) actionTimer = window.setInterval(() => opts.onAction(), 140);
  };
  const onActUp = (e: PointerEvent): void => {
    if (e.pointerId !== actionId) return;
    stopAction();
    e.stopPropagation();
  };

  stick.addEventListener("pointerdown", onStickDown);
  stick.addEventListener("pointermove", onStickMove);
  stick.addEventListener("pointerup", onStickUp);
  stick.addEventListener("pointercancel", onStickUp);
  act.addEventListener("pointerdown", onActDown);
  act.addEventListener("pointerup", onActUp);
  act.addEventListener("pointercancel", onActUp);

  // ---- pad gestures ----
  let padKind: MinigamePad | null = null;
  let holdCap = DEFAULT_HOLD_MAX;
  const sink = (): PadSink => opts.onPad ?? {};

  // hold: press to charge, release to act. The ring fills over holdCap.
  let holdAt: number | null = null;
  let holdRaf = 0;
  const paintHold = (): void => {
    holdRaf = 0;
    if (holdAt === null) {
      holdFill.setAttribute("stroke-dashoffset", "100");
      return;
    }
    const frac = Math.min(1, Math.max(0, (performance.now() - holdAt) / 1000 / holdCap));
    holdFill.setAttribute("stroke-dashoffset", String((1 - frac) * 100));
    holdRaf = window.requestAnimationFrame(paintHold);
  };
  const holdBinding = bindPointer(holdBtn, {
    down(e) {
      holdAt = e.timeStamp;
      holdBtn.classList.add("ssp-pad--down");
      sink().hold?.(true, 0);
      if (!holdRaf) holdRaf = window.requestAnimationFrame(paintHold);
    },
    end(e) {
      const at = e ? e.timeStamp : performance.now();
      const heldSec = holdAt === null ? 0 : Math.min(holdCap, Math.max(0, (at - holdAt) / 1000));
      holdAt = null;
      holdBtn.classList.remove("ssp-pad--down");
      if (holdRaf) window.cancelAnimationFrame(holdRaf);
      holdRaf = 0;
      holdFill.setAttribute("stroke-dashoffset", "100");
      sink().hold?.(false, heldSec);
    },
  });

  // twin: two buttons, each with its own finger.
  const bindTwin = (t: { el: HTMLButtonElement }, which: "a" | "b"): PointerBinding =>
    bindPointer(t.el, {
      down() {
        t.el.classList.add("ssp-pad--down");
        sink().button?.(which, true);
      },
      end() {
        t.el.classList.remove("ssp-pad--down");
        sink().button?.(which, false);
      },
    });
  const twinABinding = bindTwin(twinA, "a");
  const twinBBinding = bindTwin(twinB, "b");

  // dial: the angle a finger moves around the hub, summed and sent once a frame.
  let dialPrev = 0;
  let dialPending = 0;
  let dialRot = 0;
  let dialRaf = 0;
  const dialAngle = (e: PointerEvent): number | null => {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return Math.hypot(dx, dy) < DIAL_DEAD_ZONE ? null : Math.atan2(dy, dx);
  };
  const flushDial = (): void => {
    dialRaf = 0;
    if (dialPending !== 0) {
      const d = dialPending;
      dialPending = 0;
      dialRot += d;
      dialWheel.style.transform = `rotate(${dialRot}rad)`;
      sink().dial?.(d);
    }
  };
  const dialBinding = bindPointer(dial, {
    down(e) {
      dialPrev = dialAngle(e) ?? NaN;
      dialPending = 0;
    },
    move(e) {
      const a = dialAngle(e);
      if (a === null) return;
      if (!Number.isNaN(dialPrev)) dialPending += wrapAngle(a - dialPrev);
      dialPrev = a;
      if (!dialRaf) dialRaf = window.requestAnimationFrame(flushDial);
    },
    end() {
      if (dialRaf) window.cancelAnimationFrame(dialRaf);
      flushDial();
    },
  });

  // swipe: the last 400 ms of the gesture, judged on release.
  let swipeSamples: { x: number; y: number; t: number }[] = [];
  const layerNorm = (layer: HTMLElement, e: PointerEvent): { x: number; y: number } => {
    const r = layer.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };
  const swipeBinding = bindPointer(swipeLayer, {
    down(e) {
      swipeSamples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      const n = layerNorm(swipeLayer, e);
      swipeTrail.begin(n.x, n.y);
    },
    move(e) {
      swipeSamples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      const n = layerNorm(swipeLayer, e);
      swipeTrail.add(n.x, n.y);
    },
    end(e, cancelled) {
      swipeTrail.end();
      const samples = swipeSamples;
      swipeSamples = [];
      if (cancelled || !e) return;
      samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      const last = samples[samples.length - 1];
      const first = samples.find((p) => last.t - p.t <= SWIPE_WINDOW_MS) ?? last;
      const rect = swipeLayer.getBoundingClientRect();
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const dist = Math.hypot(dx, dy);
      if (dist < SWIPE_MIN_TRAVEL * Math.max(1, rect.height)) return;
      const sec = Math.max(0.016, (last.t - first.t) / 1000);
      const power = Math.min(1, Math.max(0, dist / Math.max(1, rect.height) / sec / SWIPE_FULL_SPEED));
      sink().swipe?.(dx / dist, dy / dist, power);
    },
  });

  // draw: one finger, a chalk trail, and the stroke as start / move / end.
  let drawLast = { x: 0.5, y: 0.5 };
  const drawBinding = bindPointer(drawLayer, {
    down(e) {
      drawLast = layerNorm(drawLayer, e);
      drawTrail.begin(drawLast.x, drawLast.y);
      sink().draw?.("start", drawLast.x, drawLast.y);
    },
    move(e) {
      drawLast = layerNorm(drawLayer, e);
      drawTrail.add(drawLast.x, drawLast.y);
      sink().draw?.("move", drawLast.x, drawLast.y);
    },
    end(e) {
      // A cancel from code has no event: close the stroke where the finger last was.
      if (e) drawLast = layerNorm(drawLayer, e);
      drawTrail.end();
      sink().draw?.("end", drawLast.x, drawLast.y);
    },
  });

  const bindings = [holdBinding, twinABinding, twinBBinding, dialBinding, swipeBinding, drawBinding];
  /** End every pad gesture in progress (the round ended, or the pad changed). */
  const releasePads = (): void => {
    for (const b of bindings) b.cancel();
  };

  const applyLayout = (): void => {
    const touch = prefersTouchControls();
    const showAct = touch && !!verbText && touchVerb && !padKind;
    const showStick = touch && steerOn;
    act.style.display = showAct ? "flex" : "none";
    act.setAttribute("aria-hidden", showAct ? "false" : "true");
    stick.style.display = showStick ? "block" : "none";
    stick.setAttribute("aria-hidden", showStick ? "false" : "true");
    const flex = (el: HTMLElement, on: boolean): void => {
      el.style.display = on ? "flex" : "none";
      el.setAttribute("aria-hidden", on ? "false" : "true");
    };
    flex(holdBtn, touch && padKind === "hold");
    flex(twinA.el, touch && padKind === "twin");
    flex(twinB.el, touch && padKind === "twin");
    twinA.el.classList.toggle("ssp-twin--shift", showStick);
    dial.style.display = touch && padKind === "dial" ? "block" : "none";
    swipeLayer.style.display = touch && padKind === "swipe" ? "block" : "none";
    drawLayer.style.display = touch && padKind === "draw" ? "block" : "none";
    const hint = keys.textContent ?? "";
    const showKeys = !touch && hint.length > 0;
    keys.style.display = showKeys ? "block" : "none";
  };

  return {
    show(): void {
      root.classList.add("ssp-touch--on");
      applyLayout();
    },
    hide(): void {
      root.classList.remove("ssp-touch--on");
      releaseStick();
      stopAction();
      releasePads();
    },
    destroy(): void {
      this.hide();
      swipeTrail.clear();
      drawTrail.clear();
      root.remove();
    },
    configure(next): void {
      verbText = next.verb;
      steerOn = next.steer;
      repeatOn = next.repeat === true;
      gridOn = next.grid === true;
      touchVerb = next.touchVerb !== false;
      const nextPad = next.pad ?? null;
      if (nextPad !== padKind) releasePads();
      padKind = nextPad;
      holdCap = Math.max(0.1, next.holdMax ?? DEFAULT_HOLD_MAX);
      holdLabel.textContent = next.verb || "HOLD";
      holdBtn.setAttribute("aria-label", next.verb || "Hold");
      twinA.label.textContent = next.padLabels?.a ?? "A";
      twinB.label.textContent = next.padLabels?.b ?? "B";
      twinA.el.setAttribute("aria-label", next.padLabels?.a ?? "A");
      twinB.el.setAttribute("aria-label", next.padLabels?.b ?? "B");
      const word = next.verb ?? "";
      actLabel.textContent = word;
      act.setAttribute("aria-label", word || "Action");
      if (word) act.dataset.tapVerb = word;
      else delete act.dataset.tapVerb;
      keys.textContent = next.keys;
      applyLayout();
    },
    setCooldown(ratio: number): void {
      const clamped = Math.min(1, Math.max(0, ratio));
      ringCircle.setAttribute("stroke-dashoffset", String((1 - clamped) * 100));
      ring.style.opacity = clamped > 0.02 ? "1" : "0";
    },
    pulse(): void {
      // Clear both feedback classes, reflow, then add one so it restarts.
      act.classList.remove("ssp-act--pulse", "ssp-act--deny");
      keys.classList.remove("ssp-keys--deny");
      void act.offsetWidth;
      if (act.style.display !== "none") act.classList.add("ssp-act--pulse");
    },
    deny(): void {
      act.classList.remove("ssp-act--pulse", "ssp-act--deny");
      keys.classList.remove("ssp-keys--deny");
      void act.offsetWidth;
      void keys.offsetWidth;
      if (act.style.display !== "none") act.classList.add("ssp-act--deny");
      else keys.classList.add("ssp-keys--deny");
    },
  };
}
