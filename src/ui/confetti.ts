/**
 * SUPER STAR PARTY — confetti burst.
 * 60-120 small rounded rects launched from a point, spinning while they
 * fall, fading at the end. Animated with WAAPI (element.animate) so it
 * stays GPU-friendly; pieces and the layer auto-remove.
 */
import { palette } from "../config/palette";
import { injectStyles } from "./styles";
import { root } from "./root";
import { sfx } from "./sound";

export interface ConfettiOpts {
  count?: number;
  colors?: string[];
  sound?: string | null;
}

const DEFAULT_COLORS = [
  palette.sun,
  palette.candy,
  palette.mint,
  palette.bubble,
  palette.berry,
  palette.lava,
];

export function confettiBurst(x?: number, y?: number, opts?: ConfettiOpts): void {
  injectStyles();
  const count = Math.min(120, Math.max(60, Math.round(opts?.count ?? 90)));
  const colors = opts?.colors ?? DEFAULT_COLORS;
  const cx = x ?? window.innerWidth / 2;
  const cy = y ?? window.innerHeight * 0.4;

  const layer = document.createElement("div");
  layer.className = "ssp-confetti";
  root().appendChild(layer);

  sfx(opts?.sound === undefined ? null : opts.sound);

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "ssp-confetti__piece";
    const w = 6 + Math.random() * 7;
    const h = 6 + Math.random() * 7;
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = colors[i % colors.length];
    p.style.borderRadius = Math.random() < 0.3 ? "50%" : "3px";
    layer.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 240;
    const vx = Math.cos(angle) * dist;
    const vy = Math.sin(angle) * dist - 240; // upward bias
    const rot = (Math.random() - 0.5) * 1080;
    const dur = 950 + Math.random() * 700;

    try {
      p.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${vx}px, ${vy + 300}px) rotate(${rot}deg)`, opacity: 1, offset: 0.72 },
          { transform: `translate(${vx * 1.12}px, ${vy + 430}px) rotate(${rot * 1.15}deg)`, opacity: 0 },
        ],
        { duration: dur, easing: "cubic-bezier(.2,.55,.35,1)", fill: "both" }
      ).onfinish = () => p.remove();
    } catch {
      window.setTimeout(() => p.remove(), dur);
    }
  }

  window.setTimeout(() => layer.remove(), 1900);
}
