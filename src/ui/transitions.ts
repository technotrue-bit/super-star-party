/**
 * SUPER STAR PARTY — MP7-style transition layer (Wave 5).
 *
 * Full-screen wipes driven by the screen manager on every goto() so that
 * no screen change ever hard-cuts or fades. Three deterministic wipes
 * (curtain / starburst / spin) cycle in a FIXED ORDER — no Math.random(),
 * no gameplay-rng use. The cycle is a simple incrementing counter so
 * behaviour is fully reproducible.
 *
 * Lifecycle per wipe:
 *   1. Overlay mounts (z-index 1000, pointer-events:auto — blocks input).
 *   2. "Cover" phase (~220ms): panels / star / spin sweep IN and fully
 *      cover the outgoing screen.
 *   3. Midpoint callback fires → screen manager swaps screens underneath.
 *   4. "Uncover" phase (~220ms): the same elements sweep OUT, revealing
 *      the incoming screen.
 *   5. Overlay unmounts — pointer-events restored, input unblocked.
 *
 * Re-entrancy is guarded by the screen manager (a second goto mid-wipe
 * is deferred, last-wins). All pointer-events are restored on completion
 * AND on error (try/finally + a hard cleanup timeout).
 */
import { palette } from "../config/palette";

export type WipeKind = "curtain" | "starburst" | "spin";

// Fixed rotation — deterministic, no Math.random, no gameplay rng.
const WIPE_ORDER: WipeKind[] = ["curtain", "starburst", "spin"];
let wipeCounter = 0;

export function nextWipeKind(): WipeKind {
  const k = WIPE_ORDER[wipeCounter % WIPE_ORDER.length];
  wipeCounter++;
  return k;
}

/** Test/QA: peek at the next wipe kind without advancing the counter. */
export function peekWipeKind(): WipeKind {
  return WIPE_ORDER[wipeCounter % WIPE_ORDER.length];
}

/** Test/QA: reset the rotation (e.g. to make a probe deterministic). */
export function resetWipeRotation(): void {
  wipeCounter = 0;
}

/* ------------------------------------------------------------------ */
/*  Scoped stylesheet (injected once)                                  */
/* ------------------------------------------------------------------ */

let stylesInjected = false;

function injectTransitionStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-transition-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-transition-styles";
  style.textContent = `
    /* ---- shared wipe overlay ---- */
    .ssp-wipe {
      position: fixed;
      inset: 0;
      z-index: 1000;
      pointer-events: auto;
      overflow: hidden;
      will-change: contents;
    }

    /* ============ CURTAIN ============ */
    .ssp-wipe--curtain { display: flex; }
    .ssp-wipe--curtain::before,
    .ssp-wipe--curtain::after {
      content: "";
      position: absolute;
      top: 0;
      width: 51%;
      height: 100%;
      transition: transform 220ms cubic-bezier(.55,0,.45,1);
    }
    .ssp-wipe--curtain::before {
      left: 0;
      transform: translateX(-100%);
      background: repeating-linear-gradient(90deg,
        ${palette.candy} 0, ${palette.candy} 24px,
        ${palette.sun} 24px, ${palette.sun} 48px);
      box-shadow: inset -3px 0 0 ${palette.ink};
    }
    .ssp-wipe--curtain::after {
      right: 0;
      transform: translateX(100%);
      background: repeating-linear-gradient(90deg,
        ${palette.sun} 0, ${palette.sun} 24px,
        ${palette.candy} 24px, ${palette.candy} 48px);
      box-shadow: inset 3px 0 0 ${palette.ink};
    }
    .ssp-wipe--curtain.ssp-wipe--covering::before { transform: translateX(0); }
    .ssp-wipe--curtain.ssp-wipe--covering::after  { transform: translateX(0); }

    /* ============ STARBURST ============ */
    .ssp-wipe--starburst { display: flex; align-items: center; justify-content: center; }
    .ssp-wipe--starburst::before {
      content: "";
      position: absolute;
      width: 200vmax; height: 200vmax;
      background: ${palette.sun};
      border-radius: 6px;
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%,
                         50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
      transform: scale(0) rotate(0deg);
      transition: transform 220ms cubic-bezier(.55,0,.45,1);
    }
    .ssp-wipe--starburst.ssp-wipe--covering::before {
      transform: scale(1) rotate(225deg);
    }

    /* ============ SPIN ============ */
    .ssp-wipe--spin { display: flex; align-items: center; justify-content: center; }
    .ssp-wipe--spin::before {
      content: "";
      position: absolute;
      width: 200vmax; height: 200vmax;
      border-radius: 50%;
      background: ${palette.berry};
      transform: scale(0) rotate(0deg);
      transition: transform 220ms cubic-bezier(.55,0,.45,1);
    }
    .ssp-wipe--spin::after {
      content: "★";
      position: absolute;
      font-size: 60vmin;
      line-height: 1;
      color: ${palette.sun};
      text-shadow: 0 0 20px rgba(255,210,63,.8);
      transform: scale(0) rotate(0deg);
      transition: transform 220ms cubic-bezier(.55,0,.45,1);
      pointer-events: none;
    }
    .ssp-wipe--spin.ssp-wipe--covering::before { transform: scale(1) rotate(360deg); }
    .ssp-wipe--spin.ssp-wipe--covering::after  { transform: scale(.4) rotate(-180deg); }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface PlayWipeOptions {
  /** Force a specific wipe; defaults to the next in the fixed rotation. */
  kind?: WipeKind;
  /** Called when the screen is fully covered — swap screens here. */
  onCover: () => void;
  /** Called when the overlay is removed and input is fully restored. */
  onDone?: () => void;
}

const PHASE_MS = 220;
const PHASE_BUFFER = 40; // small buffer so the visual covers fully before swap
const SAFETY_MULTIPLIER = 4; // hard cleanup if something stalls

/**
 * Play a full-screen MP7-style wipe. Mounts an overlay, sweeps it in,
 * calls onCover() at the midpoint (screen is fully hidden), sweeps it
 * back out, then removes the overlay and restores pointer-events.
 *
 * Guarantees:
 *  - The overlay is ALWAYS removed (success, thrown error, or safety timeout).
 *  - pointer-events on the body are never left blocked.
 *  - No Math.random / Date.now / gameplay rng is consumed.
 */
export function playWipe(opts: PlayWipeOptions): void {
  const kind = opts.kind ?? nextWipeKind();

  injectTransitionStyles();

  const overlay = document.createElement("div");
  overlay.className = `ssp-wipe ssp-wipe--${kind}`;
  overlay.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);

  // Force reflow so the initial "hidden" paint lands before we transition.
  void overlay.offsetHeight;

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.clearTimeout(safetyTimer);
    if (overlay.isConnected) overlay.remove();
    try {
      opts.onDone?.();
    } catch (err) {
      console.warn("[wipe] onDone threw", err);
    }
  };
  // Hard safety: if anything stalls, guarantee cleanup.
  const safetyTimer = window.setTimeout(cleanup, (PHASE_MS + PHASE_BUFFER) * SAFETY_MULTIPLIER);

  // Phase 1 — cover.
  overlay.classList.add("ssp-wipe--covering");

  window.setTimeout(() => {
    try {
      opts.onCover();
    } catch (err) {
      console.warn("[wipe] onCover threw — cleaning up", err);
    }

    // Phase 2 — uncover.
    overlay.classList.remove("ssp-wipe--covering");

    window.setTimeout(() => {
      cleanup();
    }, PHASE_MS + PHASE_BUFFER);
  }, PHASE_MS + PHASE_BUFFER);
}
