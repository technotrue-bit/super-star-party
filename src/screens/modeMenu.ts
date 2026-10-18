/**
 * SUPER STAR PARTY — mode menu ('mode'). Title PLAY lands here.
 *
 * Two big picture cards: PARTY (the full board game) and MINIGAMES (free
 * play). Both go on to character select; PARTY then picks a board and lines
 * the heroes up in front of it, MINIGAMES opens the minigame menu. BACK
 * returns to the title. Arrows move, Enter picks, Escape goes back.
 */
import { palette } from "../config/palette";
import { ui } from "../ui/kit";
import { audio } from "../audio/audioEngine";
import { setFreeplay } from "../game/freeplay";
import { setPartySetup } from "../game/partySetup";
import { screens, type Screen } from "./screenManager";

const STYLE_ID = "ssp-mode-styles";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-mode{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;
      overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;box-sizing:border-box;
      padding:calc(12px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px))
        calc(20px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));
      background:
        radial-gradient(circle at 20% 15%, rgba(255,210,63,.22) 0 9%, transparent 10%),
        radial-gradient(circle at 85% 80%, rgba(63,214,255,.20) 0 12%, transparent 13%),
        radial-gradient(circle at 50% 0%, ${palette.berry} 0%, ${palette.ink} 72%);
      font-family:Fredoka,'Comic Sans MS',sans-serif;color:${palette.cream}}
    .ssp-mode__top{width:100%;max-width:820px;display:flex;align-items:center;justify-content:space-between;gap:10px}
    .ssp-mode__title{font-size:clamp(24px,6vw,40px);font-weight:700;letter-spacing:1px;text-align:center;
      text-shadow:3px 3px 0 ${palette.ink},-2px -2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px 2px 0 ${palette.ink}}
    .ssp-mode__cards{flex:1 0 auto;width:100%;max-width:820px;display:flex;flex-direction:column;justify-content:safe center;
      gap:clamp(14px,3vh,24px);padding:clamp(12px,3vh,28px) 0}
    @media (orientation:landscape){.ssp-mode__cards{flex-direction:row;align-items:stretch}}
    .ssp-mode-card{font-family:inherit;flex:1 1 0;min-height:clamp(150px,30vh,300px);position:relative;overflow:hidden;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px 16px;
      border:5px solid ${palette.ink};border-radius:28px;box-shadow:0 8px 0 ${palette.ink};cursor:pointer;
      color:${palette.ink};text-align:center;touch-action:manipulation;
      transition:transform .14s cubic-bezier(.34,1.56,.64,1),box-shadow .14s ease-out}
    .ssp-mode-card--party{background:linear-gradient(160deg,${palette.sun} 0%,${palette.sunDeep} 100%)}
    .ssp-mode-card--games{background:linear-gradient(160deg,${palette.bubble} 0%,${palette.bubbleDeep} 100%)}
    .ssp-mode-card:hover{transform:scale(1.03)}
    .ssp-mode-card:active{transform:scale(.97) translateY(4px);box-shadow:0 3px 0 ${palette.ink}}
    .ssp-mode-card.is-sel{transform:scale(1.05);box-shadow:0 8px 0 ${palette.ink},0 0 0 5px ${palette.cream},0 0 28px rgba(255,210,63,.7)}
    .ssp-mode-card__icon{font-size:clamp(44px,11vw,84px);line-height:1;filter:drop-shadow(3px 4px 0 rgba(43,29,78,.55));
      animation:sspModeBob 2.2s ease-in-out infinite}
    .ssp-mode-card--games .ssp-mode-card__icon{animation-delay:-1.1s}
    .ssp-mode-card__name{font-size:clamp(28px,7vw,48px);font-weight:700;letter-spacing:2px;color:${palette.cream};
      text-shadow:3px 3px 0 ${palette.ink},-2px -2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px 2px 0 ${palette.ink}}
    .ssp-mode-card__blurb{font-size:clamp(14px,3.6vw,18px);font-weight:600;max-width:30ch;line-height:1.2}
    .ssp-mode-card::before{content:"";position:absolute;inset:-40%;pointer-events:none;
      background:repeating-conic-gradient(from 0deg, rgba(255,255,255,.16) 0 10deg, transparent 10deg 20deg);
      animation:sspModeSpin 26s linear infinite}
    .ssp-mode-card > *{position:relative}
    @keyframes sspModeBob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-8px) rotate(4deg)}}
    @keyframes sspModeSpin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.ssp-mode-card__icon,.ssp-mode-card::before{animation:none}}
  `;
  document.head.appendChild(s);
}

interface ModeState {
  _root?: HTMLElement;
  _back?: ReturnType<typeof ui.button>;
  _cards?: HTMLButtonElement[];
  _sel?: number;
  _onKey?: (e: KeyboardEvent) => void;
  _highlight(): void;
  _pick(mode: "party" | "minigames"): void;
}

/** Remembered for the session, so BACK from character select lands on the card you chose. */
let lastMode = 0;

function card(kind: "party" | "games", icon: string, name: string, blurb: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `ssp-mode-card ssp-mode-card--${kind}`;
  b.dataset.sspMode = kind === "party" ? "party" : "minigames";
  const i = document.createElement("div");
  i.className = "ssp-mode-card__icon";
  i.textContent = icon;
  i.setAttribute("aria-hidden", "true");
  const n = document.createElement("div");
  n.className = "ssp-mode-card__name";
  n.textContent = name;
  const t = document.createElement("div");
  t.className = "ssp-mode-card__blurb";
  t.textContent = blurb;
  b.append(i, n, t);
  b.setAttribute("aria-label", `${name}: ${blurb}`);
  return b;
}

const modeImpl: ModeState & Screen = {
  id: "mode",

  enter() {
    injectStyles();
    ui.clearScreen();
    // Nothing is chosen until a card is tapped.
    setFreeplay(false);
    setPartySetup(null);

    const root = document.createElement("div");
    root.className = "ssp-mode";
    root.dataset.sspScreen = "mode";

    const top = document.createElement("div");
    top.className = "ssp-mode__top";
    const back = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      onClick: () => screens.goto("title"),
      ariaLabel: "Back to the title",
    });
    const title = document.createElement("div");
    title.className = "ssp-mode__title";
    title.textContent = "HOW DO YOU WANT TO PLAY?";
    top.append(back.el, title, document.createElement("span"));

    const cards = document.createElement("div");
    cards.className = "ssp-mode__cards";
    const party = card("party", "🎲", "PARTY", "Race around a board for stars. 10 turns, a minigame every round.");
    const games = card("games", "🎮", "MINIGAMES", "Skip the board and play any minigame you like.");
    party.addEventListener("click", () => this._pick("party"));
    games.addEventListener("click", () => this._pick("minigames"));
    party.addEventListener("pointerenter", () => {
      this._sel = 0;
      this._highlight();
    });
    games.addEventListener("pointerenter", () => {
      this._sel = 1;
      this._highlight();
    });
    cards.append(party, games);

    root.append(top, cards);
    document.body.appendChild(root);
    this._root = root;
    this._back = back;
    this._cards = [party, games];
    this._sel = lastMode;
    this._highlight();

    this._onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        this._sel = 1 - (this._sel ?? 0);
        this._highlight();
        audio.sfx.play("pop");
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._pick(this._sel === 1 ? "minigames" : "party");
      } else if (e.key === "Escape") {
        e.preventDefault();
        audio.sfx.play("ui.back");
        screens.goto("title");
      }
    };
    window.addEventListener("keydown", this._onKey);
  },

  _highlight() {
    this._cards?.forEach((c, i) => c.classList.toggle("is-sel", i === this._sel));
  },

  _pick(mode) {
    lastMode = mode === "party" ? 0 : 1;
    setFreeplay(mode === "minigames");
    audio.sfx.play(mode === "party" ? "fanfare.win" : "pop");
    if (mode === "party") {
      ui.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.4, { sound: null, count: 60 });
    }
    screens.goto("select");
  },

  exit() {
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = undefined;
    this._back?.destroy();
    this._back = undefined;
    this._root?.remove();
    this._root = undefined;
    this._cards = undefined;
    ui.clearScreen();
  },

  update() {},
  render() {},
};

export const modeMenuScreen: Screen = modeImpl;
