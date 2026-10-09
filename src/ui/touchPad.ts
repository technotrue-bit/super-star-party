/**
 * Phone controls for every minigame.
 * A left thumb stick steers; a right button fires the confirm action.
 * The button wears the game's verb (DASH, PUSH, JUMP). A dead verb is hidden.
 * Desktop shows a key hint instead of the thumb controls.
 * Parent this to #app (positioned) so it sits in the visible phone area,
 * not under the Safari toolbar.
 */
import { palette } from "../config/palette";

export interface TouchPad {
  show(): void;
  hide(): void;
  destroy(): void;
  /** Verb null hides TAP. steer false hides MOVE. keys is the desktop hint. */
  configure(opts: { verb: string | null; steer: boolean; keys: string }): void;
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

export function createTouchPad(opts: {
  onSteer: (action: "up" | "down" | "left" | "right") => void;
  /** Analog stick, screen +x right and +y down, magnitude about 0..1. */
  onStick?: (x: number, y: number) => void;
  onAction: () => void;
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

  root.append(stick, act, keys);
  host.appendChild(root);

  let stickId: number | null = null;
  let nx = 0;
  let ny = 0;
  let raf = 0;
  let actionId: number | null = null;
  let actionTimer = 0;
  let verbText: string | null = "TAP";
  let steerOn = true;

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
    if (action) opts.onSteer(action);
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
    actionTimer = window.setInterval(() => opts.onAction(), 140);
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

  const applyLayout = (): void => {
    const touch = prefersTouchControls();
    const showAct = touch && !!verbText;
    const showStick = touch && steerOn;
    act.style.display = showAct ? "flex" : "none";
    act.setAttribute("aria-hidden", showAct ? "false" : "true");
    stick.style.display = showStick ? "block" : "none";
    stick.setAttribute("aria-hidden", showStick ? "false" : "true");
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
    },
    destroy(): void {
      this.hide();
      root.remove();
    },
    configure(next): void {
      verbText = next.verb;
      steerOn = next.steer;
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
