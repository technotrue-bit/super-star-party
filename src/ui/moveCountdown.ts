/**
 * SUPER STAR PARTY — move countdown.
 * Big number over the mover's head: hops still to walk. Display only: no rng,
 * no timers, no game state. The board screen feeds it a projected screen point.
 */
import { palette } from "../config/palette";

const STYLE_ID = "ssp-move-count-style";
const REST = "translate(-50%,-100%)";

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  const o = palette.ink;
  s.textContent = `
.ssp-move-count { position:fixed; left:0; top:0; z-index:62; transform:${REST}; pointer-events:none;
  font:700 46px/1 Fredoka, 'Comic Sans MS', sans-serif; color:${palette.white};
  text-shadow:0 2px 0 ${o}, 2px 0 0 ${o}, -2px 0 0 ${o}, 0 -2px 0 ${o}, 2px 2px 0 ${o}, -2px 2px 0 ${o}, 2px -2px 0 ${o}, -2px -2px 0 ${o}, 0 4px 0 ${o}; }
.ssp-move-count[hidden] { display:none; }
.ssp-move-count--last { color:${palette.sun}; }
body:has(.ssp-shop) .ssp-move-count { visibility:hidden !important; }
`;
  document.head.appendChild(s);
}

export interface MoveCountdown {
  update(v: { left: number; x: number; y: number } | null): void;
  readonly value: number | null;
  rect(): DOMRect | null;
  destroy(): void;
}

export function createMoveCountdown(): MoveCountdown {
  injectStyle();
  const el = document.createElement("div");
  el.className = "ssp-move-count";
  el.setAttribute("aria-hidden", "true");
  el.hidden = true;
  document.body.appendChild(el);
  let value: number | null = null;

  return {
    update(v) {
      if (!v) {
        if (value !== null) {
          value = null;
          el.hidden = true;
        }
        return;
      }
      el.style.left = `${v.x.toFixed(1)}px`;
      el.style.top = `${v.y.toFixed(1)}px`;
      if (v.left !== value) {
        value = v.left;
        el.hidden = false;
        el.textContent = String(v.left);
        el.classList.toggle("ssp-move-count--last", v.left === 1);
        try {
          el.animate([{ transform: `${REST} scale(1.45)` }, { transform: `${REST} scale(1)` }], {
            duration: 220,
            easing: "cubic-bezier(.34,1.56,.64,1)",
          });
        } catch {
          /* noop */
        }
      }
    },
    get value() {
      return value;
    },
    rect() {
      return value === null ? null : el.getBoundingClientRect();
    },
    destroy() {
      el.remove();
    },
  };
}
