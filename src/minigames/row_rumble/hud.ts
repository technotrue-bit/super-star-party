/**
 * ROW ROW RUMBLE — the paddling HUD (display only; no rng, no sim writes).
 *
 *   - a CADENCE gauge between the two pad buttons: a bar from 0 to 0.8 s since your
 *     last press with the 0.25 to 0.7 s stroke window shaded, the sweet spot marked, a
 *     playhead that runs along it, lamps for which side comes next, and a word for the
 *     last press (PERFECT / GOOD / TOO FAST / SAME SIDE ...).
 *   - a RIVER MAP down the right edge: a flag at the top and a dot per canoe.
 *
 * Everything is `pointer-events: none` so it never eats a touch meant for the pad.
 */
import { palette } from "../../config/palette";
import { GAP_IDEAL, GAP_MAX, GAP_MIN, PERFECT_BAND, type PressResult, type Side } from "./rules";

const BAR_SPAN = 0.8;

const CSS = `
.rr-cad {
  position: fixed; left: 50%; transform: translateX(-50%); z-index: 70; pointer-events: none;
  bottom: calc(34px + env(safe-area-inset-bottom, 0px));
  width: clamp(96px, calc(100vw - 268px), 190px);
  font-family: Fredoka, system-ui, sans-serif; user-select: none; text-align: center;
}
@media (hover: hover) and (pointer: fine) { .rr-cad { bottom: 84px; } }
.rr-cad__say {
  height: 24px; line-height: 24px; font-size: 19px; font-weight: 700; letter-spacing: 0.04em;
  color: ${palette.cream}; text-shadow: 0 2px 0 ${palette.ink}, 0 0 6px ${palette.ink};
  white-space: nowrap; opacity: 0;
}
.rr-cad__bar {
  position: relative; height: 16px; border-radius: 999px; overflow: hidden;
  background: rgba(43,29,78,0.62); border: 3px solid ${palette.cream}; box-shadow: 0 3px 0 ${palette.ink};
}
.rr-cad__zone { position: absolute; top: 0; bottom: 0; background: ${palette.mint}; opacity: 0.55; }
.rr-cad__sweet { position: absolute; top: 0; bottom: 0; background: ${palette.sun}; opacity: 0.95; }
.rr-cad__head { position: absolute; top: -2px; bottom: -2px; width: 4px; margin-left: -2px; border-radius: 2px; background: ${palette.white}; box-shadow: 0 0 0 2px ${palette.ink}; }
.rr-cad__sides { display: flex; justify-content: space-between; margin-top: 7px; padding: 0 2px; }
.rr-cad__lamp {
  min-width: 34px; padding: 1px 6px; border-radius: 999px; font-size: 13px; font-weight: 700; line-height: 18px;
  color: ${palette.cream}; background: rgba(43,29,78,0.62); border: 3px solid ${palette.cream};
  transition: transform 90ms ease-out, background 90ms;
}
.rr-cad__lamp--next { background: ${palette.sun}; color: ${palette.ink}; transform: scale(1.18); }
.rr-cad__lamp--bad { background: ${palette.lava}; color: ${palette.cream}; transform: scale(1.18); }
.rr-map {
  position: fixed; right: calc(8px + env(safe-area-inset-right, 0px)); top: 118px; z-index: 70; pointer-events: none;
  width: 26px; height: min(34vh, 260px); font-family: Fredoka, system-ui, sans-serif;
}
.rr-map__track {
  position: absolute; left: 10px; top: 14px; bottom: 6px; width: 6px; border-radius: 3px;
  background: rgba(43,29,78,0.6); box-shadow: 0 0 0 2px ${palette.cream};
}
.rr-map__flag { position: absolute; left: 0; top: -2px; width: 26px; text-align: center; font-size: 16px; line-height: 16px; text-shadow: 0 1px 0 ${palette.ink}; }
.rr-map__dot {
  position: absolute; left: 4px; width: 18px; height: 18px; margin-bottom: -9px; border-radius: 50%;
  border: 3px solid ${palette.ink}; box-shadow: 0 0 0 2px ${palette.cream};
}
.rr-map__dot--you::after {
  content: ""; position: absolute; inset: -9px; border-radius: 50%; border: 3px solid ${palette.sun};
}
`;

export interface RaceHud {
  /** Show the verdict on a press by the human. */
  press(r: PressResult): void;
  /** Tell it which side comes next and the time since the human's last press (seconds). */
  tick(nextSide: Side | null, since: number): void;
  /** Race progress of each canoe, 0..1. */
  progress(p0: number, p1: number): void;
  destroy(): void;
}

const SAY: Record<string, { text: string; color: string }> = {
  perfect: { text: "PERFECT!", color: palette.sun },
  good: { text: "GOOD!", color: palette.mint },
  ok: { text: "OK", color: palette.cream },
  start: { text: "GO!", color: palette.cream },
  late: { text: "TOO SLOW", color: palette.bubble },
  rushed: { text: "TOO FAST!", color: palette.lava },
  same: { text: "SAME SIDE!", color: palette.lava },
};

export function mountRaceHud(opts: { colors: [string, string]; labels: { a: string; b: string }; flag: string }): RaceHud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const pct = (sec: number): string => `${(sec / BAR_SPAN) * 100}%`;
  const cad = document.createElement("div");
  cad.className = "rr-cad";
  cad.setAttribute("aria-hidden", "true");
  cad.innerHTML = `
    <div class="rr-cad__say"></div>
    <div class="rr-cad__bar">
      <i class="rr-cad__zone" style="left:${pct(GAP_MIN)};width:${pct(GAP_MAX - GAP_MIN)}"></i>
      <i class="rr-cad__sweet" style="left:${pct(GAP_IDEAL - PERFECT_BAND)};width:${pct(PERFECT_BAND * 2)}"></i>
      <i class="rr-cad__head" style="left:0%"></i>
    </div>
    <div class="rr-cad__sides"><b class="rr-cad__lamp" data-side="a">${opts.labels.a}</b><b class="rr-cad__lamp" data-side="b">${opts.labels.b}</b></div>`;
  document.body.appendChild(cad);
  const say = cad.querySelector(".rr-cad__say") as HTMLElement;
  const head = cad.querySelector(".rr-cad__head") as HTMLElement;
  const lamps = {
    a: cad.querySelector('[data-side="a"]') as HTMLElement,
    b: cad.querySelector('[data-side="b"]') as HTMLElement,
  };
  let lastNext: Side | null | undefined;
  let bad: Side | null = null;
  let badUntil = 0;

  const map = document.createElement("div");
  map.className = "rr-map";
  map.setAttribute("aria-hidden", "true");
  map.innerHTML = `<div class="rr-map__flag">${opts.flag}</div><div class="rr-map__track"></div>`;
  const dots = opts.colors.map((c, i) => {
    const d = document.createElement("i");
    d.className = `rr-map__dot${i === 0 ? " rr-map__dot--you" : ""}`;
    d.style.background = c;
    map.appendChild(d);
    return d;
  });
  document.body.appendChild(map);

  let sayAnim: Animation | null = null;
  const lampClass = (side: Side, next: Side | null): void => {
    const el = lamps[side];
    const isBad = bad === side && performance.now() < badUntil;
    el.classList.toggle("rr-cad__lamp--bad", isBad);
    el.classList.toggle("rr-cad__lamp--next", !isBad && next === side);
  };

  return {
    press(r) {
      const key = r.kind === "stroke" ? (r.grade ?? "ok") : r.kind === "start" ? (r.late ? "late" : "start") : r.kind;
      const s = SAY[key];
      say.textContent = s.text;
      say.style.color = s.color;
      sayAnim?.cancel();
      if (typeof say.animate === "function") {
        sayAnim = say.animate(
          [
            { opacity: 1, transform: "scale(1.35)" },
            { opacity: 1, transform: "scale(1)", offset: 0.2 },
            { opacity: 1, transform: "scale(1)", offset: 0.65 },
            { opacity: 0, transform: "scale(0.95)" },
          ],
          { duration: 900, easing: "ease-out", fill: "forwards" },
        );
      } else {
        say.style.opacity = "1";
      }
      if (r.kind === "same") {
        bad = r.side;
        badUntil = performance.now() + 450;
      }
    },
    tick(nextSide, since) {
      head.style.left = pct(Math.min(BAR_SPAN, Math.max(0, since)));
      if (nextSide !== lastNext || bad) {
        lastNext = nextSide;
        lampClass("a", nextSide);
        lampClass("b", nextSide);
      }
    },
    progress(p0, p1) {
      const h = map.clientHeight || 1;
      const track = h - 20;
      [p0, p1].forEach((p, i) => {
        dots[i].style.bottom = `${6 + Math.max(0, Math.min(1, p)) * track}px`;
      });
    },
    destroy() {
      sayAnim?.cancel();
      cad.remove();
      map.remove();
      style.remove();
    },
  };
}
