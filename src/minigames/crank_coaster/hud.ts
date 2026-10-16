/**
 * CRANK COASTER — your crank gauge (display only; no rng, no sim writes).
 *
 *   - a HEAT bar over the wheel: cool (blue), warm (amber from half), hot (red from 80%);
 *     the fill follows the crank's heat, the word above it says what to do about it.
 *   - a SPEED strip under it: how fast you are turning right now, with the 2.2 turns/s
 *     red line marked, so you can learn to ride just under it.
 *
 * Everything is `pointer-events: none` so it never eats a touch meant for the wheel.
 */
import { palette } from "../../config/palette";
import { HEAT_HOT, HEAT_TURNS, HEAT_WARM } from "./rules";

/** The speed strip runs from 0 to this many turns per second. */
export const STRIP_MAX = 3.2;

const CSS = `
.cc-gauge {
  position: fixed; z-index: 70; pointer-events: none; user-select: none;
  left: calc(12px + env(safe-area-inset-left, 0px)); bottom: calc(26px + env(safe-area-inset-bottom, 0px));
  width: 172px; font-family: Fredoka, system-ui, sans-serif;
}
@media (hover: hover) and (pointer: fine) {
  .cc-gauge { bottom: 84px; width: 210px; }
}
.cc-gauge__say {
  height: 24px; line-height: 24px; text-align: center; font-size: 17px; font-weight: 700; letter-spacing: 0.05em;
  color: ${palette.cream}; text-shadow: 0 2px 0 ${palette.ink}, 0 0 6px ${palette.ink}; white-space: nowrap;
}
.cc-gauge__heat {
  position: relative; height: 20px; border-radius: 999px; overflow: hidden;
  border: 3px solid ${palette.cream}; box-shadow: 0 3px 0 ${palette.ink};
  background: linear-gradient(90deg, ${palette.bubble} 0%, ${palette.bubble} ${HEAT_WARM * 100}%, ${palette.sun} ${HEAT_WARM * 100}%, ${palette.sun} ${HEAT_HOT * 100}%, ${palette.lava} ${HEAT_HOT * 100}%, ${palette.lava} 100%);
}
.cc-gauge__mask {
  position: absolute; top: 0; bottom: 0; right: 0; width: 100%; background: rgba(43,29,78,0.66);
  transform-origin: right center;
}
.cc-gauge__tick { position: absolute; top: 0; bottom: 0; width: 2px; background: ${palette.ink}; }
.cc-gauge__strip {
  position: relative; height: 10px; margin-top: 8px; border-radius: 999px;
  border: 2px solid ${palette.cream}; box-shadow: 0 2px 0 ${palette.ink};
  background: linear-gradient(90deg, ${palette.mint} 0%, ${palette.mint} ${(HEAT_TURNS / STRIP_MAX) * 100}%, ${palette.lava} ${(HEAT_TURNS / STRIP_MAX) * 100}%, ${palette.lava} 100%);
  opacity: 0.92;
}
.cc-gauge__pip {
  position: absolute; top: -5px; width: 8px; height: 16px; margin-left: -4px; border-radius: 3px;
  background: ${palette.white}; box-shadow: 0 0 0 2px ${palette.ink};
}
.cc-gauge__cap { display: flex; justify-content: space-between; margin-top: 3px; padding: 0 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: ${palette.cream}; text-shadow: 0 1px 0 ${palette.ink}; }
.cc-gauge[data-band="1"] .cc-gauge__say { color: ${palette.sun}; }
.cc-gauge[data-band="2"] .cc-gauge__say { color: ${palette.lava}; animation: cc-pulse 0.28s ease-in-out infinite alternate; }
.cc-gauge[data-band="3"] .cc-gauge__say { color: ${palette.lava}; animation: cc-pulse 0.16s ease-in-out infinite alternate; }
.cc-gauge[data-band="3"] .cc-gauge__heat { animation: cc-jolt 0.12s linear infinite; }
@keyframes cc-pulse { from { transform: scale(1); } to { transform: scale(1.18); } }
@keyframes cc-jolt { 0% { transform: translateX(-2px); } 50% { transform: translateX(2px); } 100% { transform: translateX(-2px); } }
`;

const SAY = ["CRANK IT!", "WARMING UP", "EASE OFF!", "JAMMED!"] as const;

export interface CrankHud {
  /** heat 0..1, band 0..3 (cool, warm, hot, jammed), speed in turns/s, jam seconds left, climb 0..1. */
  update(heat: number, band: number, turns: number, jam: number, climb: number): void;
  destroy(): void;
}

export function mountCrankHud(): CrankHud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.className = "cc-gauge";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-band", "0");
  el.innerHTML = `
    <div class="cc-gauge__say">${SAY[0]}</div>
    <div class="cc-gauge__heat"><i class="cc-gauge__mask"></i>
      <i class="cc-gauge__tick" style="left:${HEAT_WARM * 100}%"></i><i class="cc-gauge__tick" style="left:${HEAT_HOT * 100}%"></i></div>
    <div class="cc-gauge__strip"><i class="cc-gauge__pip" style="left:0%"></i></div>
    <div class="cc-gauge__cap"><span>SLOW</span><span>TURNS/S</span><span>FAST</span></div>`;
  document.body.appendChild(el);
  const say = el.querySelector(".cc-gauge__say") as HTMLElement;
  const mask = el.querySelector(".cc-gauge__mask") as HTMLElement;
  const pip = el.querySelector(".cc-gauge__pip") as HTMLElement;

  let lastBand = -1;
  let lastHeat = -1;
  let lastPip = -1;
  let lastSay = "";
  return {
    update(heat, band, turns, jam, climb) {
      const h = Math.round(Math.min(1, Math.max(0, heat)) * 100);
      if (h !== lastHeat) {
        lastHeat = h;
        mask.style.width = `${100 - h}%`;
      }
      const p = Math.round(Math.min(1, Math.max(0, turns / STRIP_MAX)) * 100);
      if (p !== lastPip) {
        lastPip = p;
        pip.style.left = `${p}%`;
      }
      if (band !== lastBand) {
        lastBand = band;
        el.setAttribute("data-band", String(band));
      }
      // Before the first turn, ask for one; jammed shows the countdown.
      const word = band === 3 ? `JAMMED ${Math.max(0, jam).toFixed(1)}` : climb <= 0 && band === 0 ? "TURN THE WHEEL" : SAY[band];
      if (word !== lastSay) {
        lastSay = word;
        say.textContent = word;
      }
    },
    destroy() {
      el.remove();
      style.remove();
    },
  };
}
