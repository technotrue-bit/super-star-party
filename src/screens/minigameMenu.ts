/**
 * SUPER STAR PARTY — minigame menu (free play).
 *
 * A picture card for every minigame, grouped by pack. Each card shows a
 * frame of the game in action (public/minigames/<id>-thumb.webp, recorded
 * by tools/capture-minigame-clips.mjs), its name and format. Tap a card to
 * open the ready screen. BACK returns to the character select.
 */
import { palette } from "../config/palette";
import { ui } from "../ui/kit";
import { audio } from "../audio/audioEngine";
import { screens, type Screen } from "./screenManager";
import { loadMinigame } from "../minigames/framework";
import { packDef, type MinigamePackId } from "../minigames/packRules";
import {
  freeplayCatalog,
  freeplayMinigame,
  minigameMediaUrl,
  pickFreeplayMinigame,
  prettyMinigameId,
} from "../game/freeplay";

const STYLE_ID = "ssp-mgmenu-styles";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-mgm{position:fixed;inset:0;z-index:20;overflow-y:auto;-webkit-overflow-scrolling:touch;
      background:radial-gradient(circle at 50% 0%, ${palette.berry} 0%, ${palette.ink} 70%);
      padding:calc(12px + env(safe-area-inset-top,0px)) 14px calc(24px + env(safe-area-inset-bottom,0px));
      box-sizing:border-box;font-family:Fredoka,sans-serif;color:${palette.cream}}
    .ssp-mgm__top{display:flex;align-items:center;justify-content:space-between;gap:10px;max-width:760px;margin:0 auto 6px}
    .ssp-mgm__title{font-size:26px;font-weight:700;letter-spacing:1px;text-shadow:3px 3px 0 ${palette.ink}}
    .ssp-mgm__sub{max-width:760px;margin:0 auto 10px;font-size:14px;opacity:.85}
    .ssp-mgm__pack{max-width:760px;margin:14px auto 8px;font-size:16px;font-weight:700;color:${palette.sun};
      text-shadow:2px 2px 0 ${palette.ink};letter-spacing:.5px}
    .ssp-mgm__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-width:760px;margin:0 auto}
    @media (min-width:620px){.ssp-mgm__grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    .ssp-mgm__card{font-family:inherit;text-align:left;padding:0;border:4px solid ${palette.ink};border-radius:16px;overflow:hidden;
      background:${palette.cream};color:${palette.ink};box-shadow:0 5px 0 ${palette.ink};cursor:pointer;
      transition:transform .12s cubic-bezier(.34,1.56,.64,1);touch-action:manipulation;display:flex;flex-direction:column}
    .ssp-mgm__card:active{transform:scale(.96) translateY(2px);box-shadow:0 2px 0 ${palette.ink}}
    .ssp-mgm__card:focus-visible,.ssp-mgm__card.is-focus{outline:4px solid ${palette.sun};outline-offset:2px}
    .ssp-mgm__pic{position:relative;aspect-ratio:16/10;background:${palette.inkSoft};border-bottom:4px solid ${palette.ink}}
    .ssp-mgm__pic img{width:100%;height:100%;object-fit:cover;display:block}
    .ssp-mgm__fmt{position:absolute;left:6px;top:6px;font-size:11px;font-weight:700;padding:3px 7px;border-radius:8px;
      background:${palette.ink};color:${palette.cream};letter-spacing:.5px}
    .ssp-mgm__name{font-size:16px;font-weight:700;line-height:1.1;padding:8px 10px 9px}
  `;
  document.head.appendChild(s);
}

const FORMAT_LABEL: Record<string, string> = { ffa: "4-PLAYER", "1v3": "1 VS 3", "2v2": "2 VS 2" };

interface MenuState {
  _root?: HTMLElement;
  _back?: ReturnType<typeof ui.button>;
  _cards?: HTMLButtonElement[];
  _focus?: number;
  _onKey?: (e: KeyboardEvent) => void;
}

const minigameMenuImpl: MenuState & Screen = {
  id: "minigames",

  enter() {
    injectStyles();
    ui.clearScreen();
    const root = document.createElement("div");
    root.className = "ssp-mgm";
    root.dataset.sspScreen = "minigames";

    const top = document.createElement("div");
    top.className = "ssp-mgm__top";
    const title = document.createElement("div");
    title.className = "ssp-mgm__title";
    title.textContent = "MINIGAMES";
    const back = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      onClick: () => screens.goto("select"),
      ariaLabel: "Back to character select",
    });
    top.append(back.el, title, document.createElement("span"));
    const sub = document.createElement("div");
    sub.className = "ssp-mgm__sub";
    sub.textContent = "Pick a minigame to play.";
    root.append(top, sub);

    const cards: HTMLButtonElement[] = [];
    const names = new Map<string, HTMLElement>();
    const fmts = new Map<string, HTMLElement>();
    let lastPack = "";
    let grid: HTMLElement | null = null;
    for (const { id, pack } of freeplayCatalog()) {
      if (pack !== lastPack) {
        lastPack = pack;
        const head = document.createElement("div");
        head.className = "ssp-mgm__pack";
        head.textContent = packDef(pack as MinigamePackId).name;
        grid = document.createElement("div");
        grid.className = "ssp-mgm__grid";
        root.append(head, grid);
      }
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ssp-mgm__card";
      card.dataset.mgId = id;
      const pic = document.createElement("div");
      pic.className = "ssp-mgm__pic";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = minigameMediaUrl(id, "thumb");
      img.onerror = () => img.remove();
      const fmt = document.createElement("span");
      fmt.className = "ssp-mgm__fmt";
      fmt.hidden = true;
      pic.append(img, fmt);
      const name = document.createElement("div");
      name.className = "ssp-mgm__name";
      name.textContent = prettyMinigameId(id);
      card.append(pic, name);
      card.setAttribute("aria-label", `Play ${prettyMinigameId(id)}`);
      card.addEventListener("click", () => this._choose(id));
      grid?.appendChild(card);
      cards.push(card);
      names.set(id, name);
      fmts.set(id, fmt);
      // Real name and format once the module loads (cached after first time).
      void loadMinigame(id).then((mg) => {
        if (!mg) return;
        name.textContent = mg.name;
        card.setAttribute("aria-label", `Play ${mg.name}`);
        const f = mg.rules?.format;
        if (f) {
          fmt.textContent = FORMAT_LABEL[f] ?? f.toUpperCase();
          fmt.hidden = false;
        }
      });
    }
    document.body.appendChild(root);
    this._root = root;
    this._back = back;
    this._cards = cards;

    // Come back to the card you just played.
    const last = freeplayMinigame();
    this._focus = Math.max(0, cards.findIndex((c) => c.dataset.mgId === last));
    if (last) cards[this._focus]?.scrollIntoView({ block: "center" });

    this._onKey = (e: KeyboardEvent) => {
      const n = cards.length;
      if (!n) return;
      const cols = window.innerWidth >= 620 ? 3 : 2;
      let f = this._focus ?? 0;
      if (e.key === "ArrowRight") f = (f + 1) % n;
      else if (e.key === "ArrowLeft") f = (f - 1 + n) % n;
      else if (e.key === "ArrowDown") f = Math.min(n - 1, f + cols);
      else if (e.key === "ArrowUp") f = Math.max(0, f - cols);
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const id = cards[f]?.dataset.mgId;
        if (id) this._choose(id);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        screens.goto("select");
        return;
      } else return;
      e.preventDefault();
      cards[this._focus ?? 0]?.classList.remove("is-focus");
      this._focus = f;
      cards[f]?.classList.add("is-focus");
      cards[f]?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", this._onKey);
  },

  _choose(this: MenuState, id: string) {
    audio.sfx.play("pop");
    pickFreeplayMinigame(id);
    screens.goto("mgready");
  },

  exit() {
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = undefined;
    this._back?.destroy();
    this._root?.remove();
    this._root = undefined;
    this._cards = undefined;
    ui.clearScreen();
  },

  update() {},
  render() {},
} as MenuState & Screen & { _choose(id: string): void };

export const minigameMenuScreen: Screen = minigameMenuImpl;
