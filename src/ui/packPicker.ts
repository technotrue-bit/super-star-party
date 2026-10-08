/**
 * SUPER STAR PARTY — host minigame-pack picker.
 *
 * Three rows, same controls on the title, the pause menu, and character
 * select, all writing the same localStorage keys:
 *   - which carnival packs stay in the roulette (at least one stays on)
 *   - which pack the human owns
 *   - the coin-reward multiplier (×1, ×2, ×3, ×4)
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
      ? `Win pays ${base} coins, then the pack bonus. Off packs never deal.`
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
