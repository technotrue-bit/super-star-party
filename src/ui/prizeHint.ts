/**
 * SUPER STAR PARTY — Grand Prize Balloon distance hint.
 * Pill under the corner cards: how many spaces to the balloon. Display only.
 */
import { palette } from "../config/palette";

const STYLE_ID = "ssp-prize-hint-style";
const PRIZE = "Grand Prize Balloon";

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.ssp-prize-hint { position:fixed; top:calc(env(safe-area-inset-top, 0px) + 84px); left:50%; transform:translateX(-50%);
  max-width:calc(100vw - 148px); box-sizing:border-box; z-index:60; pointer-events:none;
  display:flex; align-items:center; gap:6px; padding:4px 12px; border-radius:999px;
  background:${palette.ink}d9; border:2px solid ${palette.cream}; color:${palette.cream};
  font:700 13px/1.2 Fredoka, 'Comic Sans MS', sans-serif; text-align:center; text-wrap:balance; }
.ssp-prize-hint[hidden] { display:none; }
.ssp-prize-hint__text { overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
/* The LAST 5 marquee sits at y 122: keep the hint to one line above it. */
body:has(.ssp-last5) .ssp-prize-hint { font-size:12px; padding-top:3px; padding-bottom:3px; }
body:has(.ssp-last5) .ssp-prize-hint__text { display:block; white-space:nowrap; text-overflow:ellipsis; }
body:has(.ssp-shop) .ssp-prize-hint { visibility:hidden !important; }
`;
  document.head.appendChild(s);
}

export interface PrizeHint {
  update(dist: number | null): void;
  text(): string | null;
  rect(): DOMRect | null;
  destroy(): void;
}

function words(dist: number): string {
  if (dist === 0) return `On the ${PRIZE}!`;
  return `${dist} ${dist === 1 ? "space" : "spaces"} to the ${PRIZE}`;
}

export function createPrizeHint(): PrizeHint {
  injectStyle();
  const el = document.createElement("div");
  el.className = "ssp-prize-hint";
  el.setAttribute("role", "status");
  el.hidden = true;
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "\u{1F388}";
  const label = document.createElement("span");
  label.className = "ssp-prize-hint__text";
  el.append(icon, label);
  document.body.appendChild(el);
  let shown: string | null = null;

  return {
    update(dist) {
      const next = dist === null ? null : words(dist);
      if (next === shown) return;
      shown = next;
      el.hidden = next === null;
      if (next !== null) label.textContent = next;
    },
    text() {
      return shown;
    },
    rect() {
      return shown === null ? null : el.getBoundingClientRect();
    },
    destroy() {
      el.remove();
    },
  };
}
