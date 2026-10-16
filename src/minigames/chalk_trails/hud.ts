/**
 * CHALK TRAILS — your prompt (display only; no rng, no sim writes).
 *
 * One pill by the bottom edge: DRAW A PATH! while your snail stands idle, RAIN IN n as
 * the next rain closes in (it turns red in the last three seconds), RAIN! while the
 * band sweeps. A thin bar under it fills towards the rain.
 *
 * Everything is `pointer-events: none` so it never eats a stroke.
 */
import { palette } from "../../config/palette";
import { RAIN_EVERY } from "./rules";

const CSS = `
.ct-hint {
  position: fixed; z-index: 70; pointer-events: none; user-select: none;
  left: 50%; transform: translateX(-50%); bottom: calc(22px + env(safe-area-inset-bottom, 0px));
  width: 210px; font-family: Fredoka, system-ui, sans-serif; text-align: center;
}
@media (hover: hover) and (pointer: fine) {
  .ct-hint { bottom: 84px; }
}
.ct-hint__say {
  display: inline-block; padding: 4px 16px; border-radius: 999px; font-size: 20px; font-weight: 700; letter-spacing: 0.05em;
  color: ${palette.ink}; background: ${palette.cream}; border: 3px solid ${palette.ink}; box-shadow: 0 3px 0 ${palette.ink};
  white-space: nowrap;
}
.ct-hint[data-mode="draw"] .ct-hint__say { background: ${palette.sun}; animation: ct-pulse 0.5s ease-in-out infinite alternate; }
.ct-hint[data-mode="soon"] .ct-hint__say { background: ${palette.lava}; color: ${palette.cream}; animation: ct-pulse 0.3s ease-in-out infinite alternate; }
.ct-hint[data-mode="rain"] .ct-hint__say { background: ${palette.bubble}; }
.ct-hint[data-mode="dry"] { opacity: 0; }
.ct-hint__bar {
  margin: 8px auto 0; width: 150px; height: 8px; border-radius: 999px; overflow: hidden;
  border: 2px solid ${palette.cream}; box-shadow: 0 2px 0 ${palette.ink}; background: ${palette.ink};
}
.ct-hint__fill { display: block; height: 100%; width: 0; background: ${palette.bubble}; }
.ct-hint[data-mode="soon"] .ct-hint__fill { background: ${palette.lava}; }
@keyframes ct-pulse { from { transform: scale(1); } to { transform: scale(1.1); } }
`;

export type HintMode = "ok" | "draw" | "soon" | "rain" | "dry";

export interface ChalkHud {
  /** `mode` picks the look, `rainIn` is seconds to the next rain (Infinity when none is left). */
  update(mode: HintMode, rainIn: number): void;
  destroy(): void;
}

export function mountChalkHud(): ChalkHud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.className = "ct-hint";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-mode", "ok");
  el.innerHTML = `<span class="ct-hint__say">DRAW A PATH!</span><div class="ct-hint__bar"><i class="ct-hint__fill"></i></div>`;
  document.body.appendChild(el);
  const say = el.querySelector(".ct-hint__say") as HTMLElement;
  const fill = el.querySelector(".ct-hint__fill") as HTMLElement;
  let lastMode = "";
  let lastSay = "";
  let lastFill = -1;
  return {
    update(mode, rainIn) {
      if (mode !== lastMode) {
        lastMode = mode;
        el.setAttribute("data-mode", mode);
      }
      const word =
        mode === "draw" ? "DRAW A PATH!" : mode === "rain" ? "RAIN!" : Number.isFinite(rainIn) ? `RAIN IN ${Math.ceil(rainIn)}` : "NO MORE RAIN";
      if (word !== lastSay) {
        lastSay = word;
        say.textContent = word;
      }
      const f = Number.isFinite(rainIn) ? Math.round(Math.min(1, Math.max(0, 1 - rainIn / RAIN_EVERY)) * 100) : 0;
      if (f !== lastFill) {
        lastFill = f;
        fill.style.width = `${f}%`;
      }
    },
    destroy() {
      el.remove();
      style.remove();
    },
  };
}
