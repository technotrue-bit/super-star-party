/**
 * SUPER STAR PARTY — how-to-play screen (id 'howto').
 *
 * The rules, explained simply: the shared guide in src/ui/rulesGuide.ts
 * (also shown in the pause menu), with the real space pictures. A BACK
 * button returns to title.
 */
import { palette } from "../config/palette";
import { ui } from "../ui/kit";
import { screens } from "./screenManager";
import { audio } from "../audio/audioEngine";
import type { Screen } from "./screenManager";
import { buildRulesGuide } from "../ui/rulesGuide";

/* ------------------------------------------------------------------ */
/*  Scoped stylesheet                                                  */
/* ------------------------------------------------------------------ */

let stylesInjected = false;

function injectHowToStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-howto-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-howto-styles";
  style.textContent = `
    .ssp-howto-stage {
      position: fixed; inset: 0; z-index: 60;
      display: flex; flex-direction: column;
      align-items: center;
      padding: calc(14px + env(safe-area-inset-top, 0px)) clamp(10px, 3vw, 20px) calc(20px + env(safe-area-inset-bottom, 0px));
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      box-sizing: border-box;
    }
    .ssp-howto-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      max-width: 520px;
      margin-bottom: clamp(10px, 2.5vh, 18px);
    }
    .ssp-howto-title {
      font-size: clamp(20px, 5vw, 30px);
      font-weight: 700;
      color: ${palette.cream};
      text-shadow: 3px 3px 0 ${palette.ink};
      letter-spacing: 1px;
    }
    .ssp-howto-cards {
      display: flex;
      flex-direction: column;
      gap: clamp(10px, 2.5vh, 16px);
      width: 100%;
      max-width: 520px;
      margin-bottom: clamp(14px, 3vh, 24px);
    }
    .ssp-howto-card {
      background: ${palette.cream};
      border: 4px solid ${palette.ink};
      border-radius: 20px;
      padding: clamp(12px, 3vw, 18px) clamp(14px, 3.5vw, 20px);
      box-shadow: 0 5px 0 ${palette.ink};
      animation: sspHowToCardIn .35s cubic-bezier(.34,1.56,.64,1) both;
    }
    .ssp-howto-card:nth-child(1) { animation-delay: .04s; }
    .ssp-howto-card:nth-child(2) { animation-delay: .08s; }
    .ssp-howto-card:nth-child(3) { animation-delay: .12s; }
    .ssp-howto-card:nth-child(4) { animation-delay: .16s; }
    .ssp-howto-card:nth-child(5) { animation-delay: .20s; }
    .ssp-howto-card:nth-child(6) { animation-delay: .24s; }
    @keyframes sspHowToCardIn {
      from { opacity: 0; transform: translateY(18px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ssp-howto-card__head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .ssp-howto-card__icon {
      width: 36px; height: 36px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      border: 3px solid ${palette.ink};
      box-shadow: 0 3px 0 ${palette.ink};
      flex-shrink: 0;
    }
    .ssp-howto-card__ttl {
      font-size: clamp(16px, 4vw, 20px);
      font-weight: 700;
      color: ${palette.ink};
    }
    .ssp-howto-card__body {
      font-size: clamp(13px, 3.2vw, 15px);
      font-weight: 500;
      color: ${palette.inkSoft};
      line-height: 1.5;
    }
    .ssp-howto-card__body b { color: ${palette.ink}; }
    .ssp-howto-card__space {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }
    .ssp-howto-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      border: 2px solid ${palette.ink};
      font-size: clamp(11px, 2.8vw, 13px);
      font-weight: 600;
      color: ${palette.ink};
    }
    .ssp-howto-chip__dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      border: 2px solid ${palette.ink};
      flex-shrink: 0;
    }
    .ssp-howto-bottom {
      display: flex;
      justify-content: center;
      width: 100%;
      max-width: 520px;
      margin-top: auto;
      padding-bottom: 8px;
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Screen state                                                       */
/* ------------------------------------------------------------------ */

interface HowToState {
  _onKey?: (e: KeyboardEvent) => void;
  _card: (icon: string, color: string, title: string, body: string) => HTMLDivElement;
  _chip: (color: string, label: string) => HTMLSpanElement;
}

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

const howToImpl: HowToState & Screen = {
  id: "howto",

  enter() {
    injectHowToStyles();
    ui.clearScreen();

    const stage = document.createElement("div");
    stage.className = "ssp-howto-stage";

    // Top bar
    const topBar = document.createElement("div");
    topBar.className = "ssp-howto-top";

    const backBtn = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      onClick: () => {
        audio.sfx.play("ui.back");
        screens.goto("title");
      },
      ariaLabel: "Back to title",
    });

    const titleEl = document.createElement("div");
    titleEl.className = "ssp-howto-title";
    titleEl.textContent = "HOW TO PLAY";

    topBar.append(backBtn.el, titleEl);
    stage.appendChild(topBar);

    // The rules, explained simply (shared with the pause menu).
    const cards = document.createElement("div");
    cards.className = "ssp-howto-cards";
    cards.appendChild(buildRulesGuide());
    stage.appendChild(cards);

    // Bottom back button
    const bottomBar = document.createElement("div");
    bottomBar.className = "ssp-howto-bottom";
    const backBtnBig = ui.button({
      label: "◀ BACK TO TITLE",
      kind: "gold",
      size: "lg",
      sound: "ui.back",
      onClick: () => {
        audio.sfx.play("ui.back");
        screens.goto("title");
      },
      ariaLabel: "Back to title",
    });
    bottomBar.appendChild(backBtnBig.el);
    stage.appendChild(bottomBar);

    document.body.appendChild(stage);

    // Keyboard: Escape or Enter goes back
    this._onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        audio.sfx.play("ui.back");
        screens.goto("title");
      }
    };
    window.addEventListener("keydown", this._onKey);
  },

  /* ---- helpers ---- */
  _card(icon: string, color: string, title: string, body: string): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "ssp-howto-card";

    const head = document.createElement("div");
    head.className = "ssp-howto-card__head";

    const iconEl = document.createElement("div");
    iconEl.className = "ssp-howto-card__icon";
    iconEl.style.background = color;
    iconEl.textContent = icon;

    const ttl = document.createElement("div");
    ttl.className = "ssp-howto-card__ttl";
    ttl.textContent = title;

    head.append(iconEl, ttl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "ssp-howto-card__body";
    bodyEl.innerHTML = body;

    card.append(head, bodyEl);
    return card;
  },

  _chip(color: string, label: string): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.className = "ssp-howto-chip";
    const dot = document.createElement("span");
    dot.className = "ssp-howto-chip__dot";
    dot.style.background = color;
    const text = document.createElement("span");
    text.textContent = label;
    chip.append(dot, text);
    return chip;
  },

  exit() {
    if (this._onKey) {
      window.removeEventListener("keydown", this._onKey);
      this._onKey = undefined;
    }
    document.querySelectorAll(".ssp-howto-stage").forEach((el) => el.remove());
    ui.clearScreen();
  },

  update() {
    // Static screen — no per-frame animation.
  },

  render() {},
};

export const howToPlay = howToImpl as Screen;
