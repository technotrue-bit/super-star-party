/**
 * SUPER STAR PARTY — the shared minigame scoreboard (display only).
 *
 * One strip across the top of every minigame: a chip per player (colour dot,
 * name, score, a small tag such as OUT or SOLO) with YOUR chip in gold, plus
 * an optional countdown pill. Games feed it through ctx.hud; the screen keeps
 * the last values for the results card and for a forced finish.
 *
 * Nothing is drawn until a game calls score() or timer(), so a game that
 * never uses it shows nothing. No rng, no match writes.
 */
import { palette } from "../config/palette";
import type { MinigameHud } from "./framework";

export interface ScoreHudPlayer {
  id: number;
  name: string;
  color: string;
  you: boolean;
}

export interface ScoreHud extends MinigameHud {
  /** Last value per player id (undefined if the game never scored it). */
  scores(): Map<number, number | string>;
  /** The unit word, "" when unset. */
  unitText(): string;
  /** True once anything was drawn (the goal pill moves under the strip). */
  active(): boolean;
  hide(): void;
  destroy(): void;
}

let styled = false;
function injectStyles(): void {
  if (styled || document.getElementById("ssp-mg-hud-styles")) {
    styled = true;
    return;
  }
  styled = true;
  const st = document.createElement("style");
  st.id = "ssp-mg-hud-styles";
  st.textContent = `
.ssp-mg-hud {
  position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px));
  transform: translateX(-50%); z-index: 80; pointer-events: none;
  display: none; flex-direction: column; align-items: center; gap: 6px;
  width: max-content; max-width: 98vw;
  font-family: Fredoka, system-ui, sans-serif; user-select: none;
}
.ssp-mg-hud--on { display: flex; }
.ssp-mg-hud__row { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; max-width: 98vw; }
.ssp-mg-hud__chip {
  position: relative; display: flex; align-items: center; gap: 5px;
  background: ${palette.cream}; color: ${palette.ink};
  border: 3px solid ${palette.ink}; border-radius: 999px;
  padding: 3px 9px 3px 6px; box-shadow: 0 3px 0 ${palette.ink};
  font-weight: 700; font-size: 13px; line-height: 1.1; white-space: nowrap;
  transition: transform 120ms ease-out;
}
.ssp-mg-hud__chip--you { background: ${palette.sun}; }
.ssp-mg-hud__chip--out { opacity: 0.55; filter: grayscale(0.7); }
.ssp-mg-hud__chip--bump { transform: scale(1.14); }
.ssp-mg-hud__dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid ${palette.ink}; flex: 0 0 auto; }
.ssp-mg-hud__name { max-width: 64px; overflow: hidden; text-overflow: ellipsis; }
.ssp-mg-hud__score { font-size: 16px; min-width: 14px; text-align: right; }
.ssp-mg-hud__tag {
  position: absolute; top: -9px; right: -4px; padding: 0 5px; border-radius: 999px;
  background: ${palette.ink}; color: ${palette.cream}; font-size: 10px; line-height: 15px;
  letter-spacing: 0.04em;
}
.ssp-mg-hud__time {
  display: none; align-items: center; gap: 6px;
  background: ${palette.ink}; color: ${palette.cream};
  border: 3px solid ${palette.cream}; border-radius: 999px; padding: 2px 10px 2px 4px;
  box-shadow: 0 3px 0 ${palette.ink}; font-weight: 700; font-size: 16px;
}
.ssp-mg-hud__time--on { display: flex; }
.ssp-mg-hud__time--low { background: ${palette.lava}; }
.ssp-mg-hud__bar { width: 92px; height: 10px; border-radius: 999px; background: rgba(255,255,255,0.22); overflow: hidden; }
.ssp-mg-hud__fill { height: 100%; width: 100%; background: ${palette.mint}; border-radius: 999px; }
@media (max-width: 430px) {
  .ssp-mg-hud__row { gap: 3px; flex-wrap: nowrap; }
  .ssp-mg-hud__chip { padding: 2px 6px 2px 4px; font-size: 11px; gap: 3px; border-width: 2px; }
  .ssp-mg-hud__name { max-width: 40px; }
  .ssp-mg-hud__score { font-size: 14px; }
  .ssp-mg-hud__dot { width: 10px; height: 10px; }
}
body.ssp-mg-hud-on .ssp-mg-goal { top: calc(86px + env(safe-area-inset-top, 0px)); }
`;
  document.head.appendChild(st);
}

export function createScoreHud(players: ScoreHudPlayer[]): ScoreHud {
  injectStyles();
  const root = document.createElement("div");
  root.className = "ssp-mg-hud";
  root.dataset.mgHud = "";
  const row = document.createElement("div");
  row.className = "ssp-mg-hud__row";
  const time = document.createElement("div");
  time.className = "ssp-mg-hud__time";
  const bar = document.createElement("div");
  bar.className = "ssp-mg-hud__bar";
  const fill = document.createElement("div");
  fill.className = "ssp-mg-hud__fill";
  bar.appendChild(fill);
  const secs = document.createElement("span");
  time.append(bar, secs);
  root.append(row, time);
  document.body.appendChild(root);

  const values = new Map<number, number | string>();
  const chips = new Map<number, { chip: HTMLDivElement; score: HTMLSpanElement; tag: HTMLSpanElement }>();
  let unit = "";
  let on = false;

  for (const p of players) {
    const chip = document.createElement("div");
    chip.className = "ssp-mg-hud__chip" + (p.you ? " ssp-mg-hud__chip--you" : "");
    chip.dataset.pid = String(p.id);
    const dot = document.createElement("span");
    dot.className = "ssp-mg-hud__dot";
    dot.style.background = p.color;
    const name = document.createElement("span");
    name.className = "ssp-mg-hud__name";
    name.textContent = p.you ? "YOU" : p.name;
    const score = document.createElement("span");
    score.className = "ssp-mg-hud__score";
    score.textContent = "";
    const tag = document.createElement("span");
    tag.className = "ssp-mg-hud__tag";
    tag.style.display = "none";
    chip.append(dot, name, score, tag);
    row.appendChild(chip);
    chips.set(p.id, { chip, score, tag });
  }

  const show = (): void => {
    if (on) return;
    on = true;
    root.classList.add("ssp-mg-hud--on");
    document.body.classList.add("ssp-mg-hud-on");
  };

  return {
    score(id, value) {
      show();
      const c = chips.get(id);
      const prev = values.get(id);
      values.set(id, value);
      if (!c) return;
      const text = String(value);
      if (c.score.textContent === text) return;
      c.score.textContent = text;
      // A little bump when a number goes up.
      if (typeof value === "number" && typeof prev === "number" && value > prev) {
        c.chip.classList.remove("ssp-mg-hud__chip--bump");
        void c.chip.offsetWidth;
        c.chip.classList.add("ssp-mg-hud__chip--bump");
        window.setTimeout(() => c.chip.classList.remove("ssp-mg-hud__chip--bump"), 130);
      }
    },
    tag(id, text) {
      show();
      const c = chips.get(id);
      if (!c) return;
      c.tag.textContent = text ?? "";
      c.tag.style.display = text ? "block" : "none";
      c.chip.classList.toggle("ssp-mg-hud__chip--out", text === "OUT");
    },
    timer(remaining, total) {
      if (remaining === null) {
        time.classList.remove("ssp-mg-hud__time--on");
        return;
      }
      show();
      time.classList.add("ssp-mg-hud__time--on");
      const left = Math.max(0, remaining);
      const s = String(Math.ceil(left));
      if (secs.textContent !== s) secs.textContent = s;
      const frac = total && total > 0 ? Math.min(1, left / total) : 1;
      fill.style.width = `${(frac * 100).toFixed(1)}%`;
      time.classList.toggle("ssp-mg-hud__time--low", left <= 5);
    },
    unit(text) {
      unit = text;
    },
    scores: () => values,
    unitText: () => unit,
    active: () => on,
    hide() {
      root.style.visibility = "hidden";
    },
    destroy() {
      root.remove();
      document.body.classList.remove("ssp-mg-hud-on");
    },
  };
}
