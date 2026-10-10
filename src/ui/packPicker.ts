/**
 * SUPER STAR PARTY — host minigame-pack picker.
 *
 * Same rules on the title, the pause menu, and character select, all
 * writing the same localStorage keys:
 *   - which carnival packs stay in the roulette (at least one stays on)
 *   - which pack the human owns
 *   - the coin-reward multiplier (×1, ×2, ×3, ×4)
 * Title and pause use the three-row mountPackPicker(); character select
 * uses the compact mountMatchSettings() card.
 */
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { audio } from "../audio/audioEngine";
import {
  COIN_MULTIPLIERS,
  MINIGAME_PACKS,
  getEnabledPacks,
  getHumanPack,
  getMinigameCoinMultiplier,
  setEnabledPacks,
  setHumanPack,
  setMinigameCoinMultiplier,
} from "../minigames/packRules";

import { mountBoardPicker } from "./boardPicker";

let stylesInjected = false;

function injectPackStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-pack-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-pack-styles";
  style.textContent = `
    .ssp-pack-picker {
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
    }
    .ssp-pack-picker--card {
      background: ${palette.cream};
      border: 4px solid ${palette.ink};
      border-radius: 18px;
      box-shadow: 4px 4px 0 ${palette.ink};
      padding: 10px 10px 12px;
    }
    .ssp-pack-picker__label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.6px;
      color: ${palette.ink};
    }
    .ssp-pack-picker__row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .ssp-pack-btn {
      font-family: inherit;
      font-weight: 700;
      font-size: 13px;
      line-height: 1.1;
      min-height: 48px;
      padding: 8px 8px;
      border-radius: 14px;
      border: 3px solid ${palette.ink};
      background: ${palette.white};
      color: ${palette.ink};
      box-shadow: 3px 3px 0 ${palette.ink};
      cursor: pointer;
      flex: 1 1 0;
      min-width: 0;
    }
    .ssp-pack-btn:active {
      transform: translateY(2px);
      box-shadow: 1px 1px 0 ${palette.ink};
    }
    .ssp-pack-btn--on {
      background: ${palette.sun};
    }
    .ssp-pack-btn--off {
      background: ${palette.creamShadow};
      color: ${palette.inkSoft};
    }
    .ssp-pack-btn--yours {
      background: ${palette.candy};
      color: ${palette.white};
    }
    .ssp-pack-picker__note {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
      color: ${palette.inkSoft};
    }

    /* ---- character select: one "Match settings" card ---- */
    .ssp-ms {
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      box-sizing: border-box;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
      color: ${palette.ink};
      background: ${palette.cream};
      border: 4px solid ${palette.ink};
      border-radius: 18px;
      box-shadow: 4px 4px 0 ${palette.ink};
      padding: 5px 10px 7px;
    }
    .ssp-ms__title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-align: center;
      color: ${palette.inkSoft};
    }
    .ssp-ms__label {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.1;
    }
    .ssp-ms__tiles {
      display: flex;
      gap: 6px;
    }
    .ssp-ms-tile {
      font-family: inherit;
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 4px 4px 5px;
      border-radius: 14px;
      border: 3px solid ${palette.ink};
      background: ${palette.white};
      color: ${palette.ink};
      box-shadow: 3px 3px 0 ${palette.ink};
      cursor: pointer;
    }
    .ssp-ms-tile:active { transform: translateY(2px); box-shadow: 1px 1px 0 ${palette.ink}; }
    .ssp-ms-tile__name { font-size: 14px; font-weight: 700; line-height: 1.1; letter-spacing: .3px; }
    .ssp-ms-tile__blurb { font-size: 11px; font-weight: 600; line-height: 1.2; opacity: .85; text-align: center; }
    .ssp-ms-tile--yours {
      background: ${palette.candy};
      color: ${palette.white};
      box-shadow: 0 0 0 3px ${palette.sun}, 3px 3px 0 3px ${palette.ink};
    }
    .ssp-ms-tile--out { background: ${palette.creamShadow}; color: ${palette.inkSoft}; }
    .ssp-ms__rot {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
      font-size: 12px;
      font-weight: 600;
      color: ${palette.inkSoft};
    }
    .ssp-ms-chip {
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      min-height: 30px;
      padding: 0 9px;
      border-radius: 15px;
      border: 2px solid ${palette.ink};
      background: ${palette.sun};
      color: ${palette.ink};
      cursor: pointer;
    }
    .ssp-ms-chip::before { content: "✓ "; }
    .ssp-ms-chip--off { background: ${palette.creamShadow}; color: ${palette.inkSoft}; text-decoration: line-through; }
    .ssp-ms-chip--off::before { content: ""; }
    .ssp-ms__coins {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ssp-ms__coins .ssp-ms__label { flex: 0 0 auto; margin-right: 2px; }
    .ssp-ms-mult {
      font-family: inherit;
      flex: 1 1 0;
      min-width: 0;
      min-height: 38px;
      font-size: 15px;
      font-weight: 700;
      border-radius: 12px;
      border: 3px solid ${palette.ink};
      background: ${palette.white};
      color: ${palette.ink};
      box-shadow: 2px 2px 0 ${palette.ink};
      cursor: pointer;
    }
    .ssp-ms-mult--on { background: ${palette.sun}; box-shadow: 0 0 0 2px ${palette.candy}, 2px 2px 0 2px ${palette.ink}; }
    .ssp-ms__note {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      color: ${palette.inkSoft};
    }
  `;
  document.head.appendChild(style);
}

function clickSound(): void {
  try {
    audio.sfx.play("pop");
  } catch {
    /* audio stub */
  }
}

export interface PackPickerHandle {
  el: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * `card` draws the cream ticket (character select, over the 3D stage).
 * Leave it off inside a panel that is already a card.
 */
export function mountPackPicker(opts?: { card?: boolean }): PackPickerHandle {
  injectPackStyles();
  const root = document.createElement("div");
  root.className = `ssp-pack-picker${opts?.card ? " ssp-pack-picker--card" : ""}`;
  root.dataset.sspPackPicker = "1";

  const paint = (): void => {
    root.replaceChildren();
    const enabled = getEnabledPacks();
    const human = getHumanPack();
    const mult = getMinigameCoinMultiplier();

    root.appendChild(block("PACKS IN ROTATION", MINIGAME_PACKS.map((pack) => {
      const on = enabled.includes(pack.id);
      return button({
        label: pack.short,
        pressed: on,
        on: on,
        yours: false,
        aria: `${pack.name}${on ? ", in rotation" : ", out of rotation"}`,
        attrs: { "data-ssp-role": "rotation", "data-ssp-pack": pack.id },
        onClick: () => {
          clickSound();
          if (on && enabled.length === 1) return;
          const next = on ? enabled.filter((id) => id !== pack.id) : [...enabled, pack.id];
          setEnabledPacks(next);
          paint();
        },
      });
    })));

    root.appendChild(block("YOUR PACK", enabled.map((id) => {
      const pack = MINIGAME_PACKS.find((p) => p.id === id)!;
      const yours = id === human;
      return button({
        label: pack.short,
        pressed: yours,
        on: true,
        yours,
        aria: `${pack.name}${yours ? ", your pack" : ""}`,
        attrs: { "data-ssp-role": "human", "data-ssp-pack": id },
        onClick: () => {
          clickSound();
          setHumanPack(id);
          paint();
        },
      });
    })));

    root.appendChild(block("COIN REWARD", COIN_MULTIPLIERS.map((n) => {
      const on = n === mult;
      return button({
        label: `×${n}`,
        pressed: on,
        on,
        yours: false,
        aria: `Minigame coins times ${n}`,
        attrs: { "data-ssp-role": "multiplier", "data-ssp-mult": String(n) },
        onClick: () => {
          clickSound();
          setMinigameCoinMultiplier(n);
          paint();
        },
      });
    })));

    const note = document.createElement("p");
    note.className = "ssp-pack-picker__note";
    const base = settings.minigameWinCoins * mult;
    note.textContent = opts?.card
      ? `Win pays ${base} coins, then the pack bonus.`
      : `A win pays ${base} coins before the pack bonus. One owner of the dealt pack doubles that. Two, three, or four owners pay ×2, ×3, or ×4. A pack you switch off never comes up.`;
    root.appendChild(note);
  };

  paint();
  return {
    el: root,
    refresh: paint,
    destroy() {
      root.remove();
    },
  };
}

/**
 * Character select's single "Match settings" card. Minigame mix is the
 * human's pack (single-select, one-line blurb each); the rotation is a
 * small chip note under it; coin bonus is the host multiplier. Keeps the
 * same data-ssp-* hooks as mountPackPicker() for the probes.
 */
export function mountMatchSettings(): PackPickerHandle {
  injectPackStyles();
  const root = document.createElement("div");
  root.className = "ssp-ms";
  root.dataset.sspPackPicker = "1";

  const paint = (): void => {
    root.replaceChildren();
    const enabled = getEnabledPacks();
    const human = getHumanPack();
    const mult = getMinigameCoinMultiplier();

    const title = document.createElement("div");
    title.className = "ssp-ms__title";
    title.textContent = "MATCH SETTINGS";

    const mixLabel = document.createElement("div");
    mixLabel.className = "ssp-ms__label";
    mixLabel.textContent = "Minigame mix";

    const tiles = document.createElement("div");
    tiles.className = "ssp-ms__tiles";
    for (const pack of MINIGAME_PACKS) {
      const yours = pack.id === human;
      const inRotation = enabled.includes(pack.id);
      const t = document.createElement("button");
      t.type = "button";
      t.className = `ssp-ms-tile${yours ? " ssp-ms-tile--yours" : inRotation ? "" : " ssp-ms-tile--out"}`;
      t.setAttribute("aria-pressed", String(yours));
      t.setAttribute("aria-label", `${pack.name}: ${pack.blurb}${yours ? " Your pick." : ""}`);
      t.setAttribute("data-ssp-role", "human");
      t.setAttribute("data-ssp-pack", pack.id);
      const name = document.createElement("span");
      name.className = "ssp-ms-tile__name";
      name.textContent = pack.short;
      const blurb = document.createElement("span");
      blurb.className = "ssp-ms-tile__blurb";
      blurb.textContent = pack.blurb;
      t.append(name, blurb);
      onTap(t, () => {
        // Your pack must be dealable, so picking an off pack turns it back on.
        if (!inRotation) setEnabledPacks([...enabled, pack.id]);
        setHumanPack(pack.id);
        paint();
      });
      tiles.appendChild(t);
    }

    const rot = document.createElement("div");
    rot.className = "ssp-ms__rot";
    const rotLabel = document.createElement("span");
    rotLabel.textContent = "In rotation:";
    rot.appendChild(rotLabel);
    for (const pack of MINIGAME_PACKS) {
      const on = enabled.includes(pack.id);
      const c = document.createElement("button");
      c.type = "button";
      c.className = `ssp-ms-chip${on ? "" : " ssp-ms-chip--off"}`;
      c.textContent = pack.short;
      c.setAttribute("aria-pressed", String(on));
      c.setAttribute("aria-label", `${pack.name}${on ? ", in rotation" : ", out of rotation"}`);
      c.setAttribute("data-ssp-role", "rotation");
      c.setAttribute("data-ssp-pack", pack.id);
      onTap(c, () => {
        if (on && enabled.length === 1) return;
        setEnabledPacks(on ? enabled.filter((id) => id !== pack.id) : [...enabled, pack.id]);
        paint();
      });
      rot.appendChild(c);
    }

    const coins = document.createElement("div");
    coins.className = "ssp-ms__coins";
    const coinLabel = document.createElement("div");
    coinLabel.className = "ssp-ms__label";
    coinLabel.textContent = "Coin bonus";
    coins.appendChild(coinLabel);
    for (const n of COIN_MULTIPLIERS) {
      const on = n === mult;
      const m = document.createElement("button");
      m.type = "button";
      m.className = `ssp-ms-mult${on ? " ssp-ms-mult--on" : ""}`;
      m.textContent = `×${n}`;
      m.setAttribute("aria-pressed", String(on));
      m.setAttribute("aria-label", `Coin bonus times ${n}`);
      m.setAttribute("data-ssp-role", "multiplier");
      m.setAttribute("data-ssp-mult", String(n));
      onTap(m, () => {
        setMinigameCoinMultiplier(n);
        paint();
      });
      coins.appendChild(m);
    }

    const note = document.createElement("p");
    note.className = "ssp-ms__note";
    note.textContent = `Winners earn ${settings.minigameWinCoins} coins × bonus`;

    const boards = mountBoardPicker({ compact: true });
    root.append(title, boards.el, mixLabel, tiles, rot, coins, note);
  };

  paint();
  return {
    el: root,
    refresh: paint,
    destroy() {
      root.remove();
    },
  };
}

function onTap(el: HTMLElement, fn: () => void): void {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clickSound();
    fn();
  });
}

function block(label: string, buttons: HTMLButtonElement[]): HTMLElement {
  const wrap = document.createElement("div");
  const lab = document.createElement("div");
  lab.className = "ssp-pack-picker__label";
  lab.textContent = label;
  const row = document.createElement("div");
  row.className = "ssp-pack-picker__row";
  for (const b of buttons) row.appendChild(b);
  wrap.append(lab, row);
  return wrap;
}

function button(opts: {
  label: string;
  pressed: boolean;
  on: boolean;
  yours: boolean;
  aria: string;
  attrs: Record<string, string>;
  onClick: () => void;
}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ssp-pack-btn";
  if (opts.yours) b.classList.add("ssp-pack-btn--yours");
  else if (opts.on) b.classList.add("ssp-pack-btn--on");
  else b.classList.add("ssp-pack-btn--off");
  b.textContent = opts.label;
  b.setAttribute("aria-pressed", String(opts.pressed));
  b.setAttribute("aria-label", opts.aria);
  for (const [k, v] of Object.entries(opts.attrs)) b.setAttribute(k, v);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  return b;
}
