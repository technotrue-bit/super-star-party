/**
 * SUPER STAR PARTY — board menu ('boards'). Character select's NEXT lands
 * here when a party is being set up.
 *
 * One big framed overview picture of the board (boardSnapshot.ts), its name,
 * a one-line blurb and its space count, with ◀ ▶ at the frame's edges (or a
 * swipe, or a tab per board) to look at the others. RANDOM shows every board
 * behind a big "?". NEXT saves the board rule and lines the heroes up in
 * front of the board; BACK returns to character select.
 */
import { palette } from "../config/palette";
import { ui } from "../ui/kit";
import { audio } from "../audio/audioEngine";
import { BOARDS, boardIds, type BoardId, type BoardRule } from "../board/registry";
import { boardSnapshot, hasBoardSnapshot } from "../board/boardSnapshot";
import { readPersistedRules, setBoardRule } from "../minigames/packRules";
import { boardRuleBlurb, boardRuleLabel, mountTurnsStepper } from "../ui/boardPicker";
import { screens, type Screen } from "./screenManager";

const STYLE_ID = "ssp-boardmenu-styles";
const SWIPE_PX = 40;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-bm{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;gap:clamp(6px,1.6vh,12px);
      box-sizing:border-box;overflow:hidden;
      padding:calc(10px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px))
        calc(14px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px));
      background:
        repeating-linear-gradient(135deg, rgba(255,255,255,.035) 0 22px, transparent 22px 44px),
        radial-gradient(circle at 50% 0%, ${palette.candy} 0%, ${palette.berryDeep} 45%, ${palette.ink} 85%);
      font-family:Fredoka,'Comic Sans MS',sans-serif;color:${palette.cream}}
    .ssp-bm__top{width:100%;max-width:820px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto}
    .ssp-bm__title{font-size:clamp(22px,5.5vw,36px);font-weight:700;letter-spacing:1px;
      text-shadow:3px 3px 0 ${palette.ink},-2px -2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px 2px 0 ${palette.ink}}
    .ssp-bm__main{flex:1 1 auto;min-height:0;width:100%;max-width:820px;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:clamp(6px,1.6vh,12px)}
    .ssp-bm__stage{position:relative;width:100%;display:flex;align-items:center;justify-content:center;min-height:0;flex:0 1 auto}
    .ssp-bm__frame{position:relative;width:min(100%, 720px, calc((100dvh - 330px) * 1.6));aspect-ratio:16/10;min-width:200px;
      border:6px solid ${palette.ink};border-radius:22px;background:${palette.ink};overflow:hidden;touch-action:pan-y;
      box-shadow:0 0 0 6px ${palette.sun},0 0 0 11px ${palette.ink},0 14px 0 6px rgba(43,29,78,.55)}
    .ssp-bm__frame img,.ssp-bm__frame canvas{display:block;width:100%;height:100%;object-fit:cover}
    .ssp-bm__frame.is-pop{animation:sspBmPop .26s cubic-bezier(.34,1.56,.64,1)}
    @keyframes sspBmPop{from{transform:scale(.93)}to{transform:scale(1)}}
    .ssp-bm__wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;
      color:${palette.cream};background:radial-gradient(circle, ${palette.inkSoft}, ${palette.ink})}
    .ssp-bm__random{position:absolute;inset:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;background:${palette.ink}}
    .ssp-bm__random canvas{opacity:.45;filter:saturate(.7)}
    .ssp-bm__q{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(80px,22vw,180px);
      font-weight:700;color:${palette.sun};text-shadow:5px 6px 0 ${palette.ink};animation:sspBmQ 1.6s ease-in-out infinite}
    @keyframes sspBmQ{0%,100%{transform:scale(1) rotate(-6deg)}50%{transform:scale(1.08) rotate(6deg)}}
    .ssp-bm__tag{position:absolute;left:10px;top:10px;font-size:13px;font-weight:700;padding:4px 10px;border-radius:10px;
      background:${palette.ink};color:${palette.cream};letter-spacing:.5px;border:2px solid ${palette.cream}}
    .ssp-bm__arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:2}
    .ssp-bm__arrow--l{left:-6px}
    .ssp-bm__arrow--r{right:-6px}
    .ssp-bm__name{font-size:clamp(24px,6vw,38px);font-weight:700;text-align:center;line-height:1;color:${palette.sun};
      text-shadow:3px 3px 0 ${palette.ink},-2px -2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px 2px 0 ${palette.ink}}
    .ssp-bm__blurb{max-width:46ch;text-align:center;font-size:clamp(14px,3.5vw,17px);font-weight:600;line-height:1.25;min-height:2.5em}
    .ssp-bm__tabs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
    .ssp-bm-tab{font-family:inherit;font-size:14px;font-weight:700;min-height:36px;padding:0 14px;border-radius:999px;
      border:3px solid ${palette.ink};background:${palette.cream};color:${palette.ink};box-shadow:0 3px 0 ${palette.ink};
      cursor:pointer;touch-action:manipulation}
    .ssp-bm-tab:active{transform:translateY(2px);box-shadow:0 1px 0 ${palette.ink}}
    .ssp-bm-tab--on{background:${palette.sun};box-shadow:0 0 0 3px ${palette.candy},0 3px 0 3px ${palette.ink}}
    .ssp-bm__turns{flex-wrap:wrap}
    .ssp-bm__next{flex:0 0 auto;width:min(320px,86vw)}
    @media (orientation:landscape) and (max-height:560px){
      .ssp-bm__main{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:center;column-gap:16px}
      .ssp-bm__stage{grid-row:1 / span 4}
      .ssp-bm__frame{width:min(100%, calc((100dvh - 200px) * 1.6))}
      .ssp-bm__next.ssp-btn--lg{width:min(260px,40vw);min-height:46px;padding-top:6px;padding-bottom:6px;font-size:22px}
    }
  `;
  document.head.appendChild(s);
}

interface BoardMenuState {
  _root?: HTMLElement;
  _frame?: HTMLDivElement;
  _name?: HTMLDivElement;
  _blurb?: HTMLDivElement;
  _tabs?: HTMLButtonElement[];
  _buttons?: Array<ReturnType<typeof ui.button>>;
  _rules?: BoardRule[];
  _sel?: number;
  _timers?: number[];
  _onKey?: (e: KeyboardEvent) => void;
  _paint(pop: boolean): void;
  _step(dir: number): void;
  _choose(i: number): void;
  _next(): void;
  _back(): void;
}

function snapshotEl(id: BoardId): HTMLElement | null {
  const c = boardSnapshot(id);
  if (!c) return null;
  // A copy, so the cached canvas can sit in several places (the random wall).
  const pic = document.createElement("canvas");
  pic.width = c.width;
  pic.height = c.height;
  pic.getContext("2d")?.drawImage(c, 0, 0);
  pic.setAttribute("role", "img");
  pic.setAttribute("aria-label", `${BOARDS[id].name}, seen from above`);
  pic.dataset.sspBoardPic = id;
  return pic;
}

const boardMenuImpl: BoardMenuState & Screen = {
  id: "boards",

  enter() {
    injectStyles();
    ui.clearScreen();
    this._rules = [...boardIds(), "random"];
    this._sel = Math.max(0, this._rules.indexOf(readPersistedRules().board));
    this._timers = [];
    this._buttons = [];

    const root = document.createElement("div");
    root.className = "ssp-bm";
    root.dataset.sspScreen = "boards";

    const top = document.createElement("div");
    top.className = "ssp-bm__top";
    const back = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      onClick: () => this._back(),
      ariaLabel: "Back to character select",
    });
    const title = document.createElement("div");
    title.className = "ssp-bm__title";
    title.textContent = "PICK A BOARD!";
    top.append(back.el, title, document.createElement("span"));

    const main = document.createElement("div");
    main.className = "ssp-bm__main";

    const stage = document.createElement("div");
    stage.className = "ssp-bm__stage";
    const frame = document.createElement("div");
    frame.className = "ssp-bm__frame";
    const arrowL = ui.button({ label: "◀", kind: "ghost", size: "md", onClick: () => this._step(-1), ariaLabel: "Previous board" });
    const arrowR = ui.button({ label: "▶", kind: "ghost", size: "md", onClick: () => this._step(1), ariaLabel: "Next board" });
    arrowL.el.classList.add("ssp-bm__arrow", "ssp-bm__arrow--l");
    arrowR.el.classList.add("ssp-bm__arrow", "ssp-bm__arrow--r");
    stage.append(frame, arrowL.el, arrowR.el);

    // Swipe on the picture: |dx| > 40px steps one board.
    let downX: number | null = null;
    let downId = -1;
    frame.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
      downId = e.pointerId;
    });
    frame.addEventListener("pointerup", (e) => {
      if (downX === null || e.pointerId !== downId) return;
      const dx = e.clientX - downX;
      downX = null;
      if (Math.abs(dx) > SWIPE_PX) this._step(dx < 0 ? 1 : -1);
    });
    frame.addEventListener("pointercancel", () => {
      downX = null;
    });

    const name = document.createElement("div");
    name.className = "ssp-bm__name";
    const blurb = document.createElement("div");
    blurb.className = "ssp-bm__blurb";

    const tabs = document.createElement("div");
    tabs.className = "ssp-bm__tabs";
    this._tabs = this._rules.map((rule, i) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "ssp-bm-tab";
      t.textContent = boardRuleLabel(rule);
      t.dataset.sspBoard = rule;
      t.addEventListener("click", () => this._choose(i));
      tabs.appendChild(t);
      return t;
    });

    // How long the match runs (1..50 turns), saved like the board.
    const turns = mountTurnsStepper();
    turns.el.classList.add("ssp-bm__turns");

    main.append(stage, name, blurb, tabs, turns.el);

    const next = ui.button({
      label: "NEXT ▶",
      kind: "gold",
      size: "lg",
      sound: "pop",
      onClick: () => this._next(),
      ariaLabel: "Next: line up in front of the board",
    });
    next.el.classList.add("ssp-bm__next");

    root.append(top, main, next.el);
    document.body.appendChild(root);
    this._root = root;
    this._frame = frame;
    this._name = name;
    this._blurb = blurb;
    this._buttons = [back, arrowL, arrowR, next];

    // The picture on show is drawn now (the wipe still covers the screen);
    // the rest are drawn one at a time after it opens, so the arrows are instant.
    this._paint(false);
    const ids = boardIds();
    ids.forEach((id, i) => {
      this._timers!.push(
        window.setTimeout(() => {
          if (!this._root || hasBoardSnapshot(id)) return;
          boardSnapshot(id);
          if (this._rules?.[this._sel ?? 0] === "random") this._paint(false);
        }, 900 + i * 350)
      );
    });

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this._step(-1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        this._step(1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._next();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._back();
      }
    };
    window.addEventListener("keydown", this._onKey);
  },

  _paint(pop) {
    const frame = this._frame;
    const rules = this._rules;
    if (!frame || !rules) return;
    const rule = rules[this._sel ?? 0];
    frame.replaceChildren();
    frame.dataset.sspBoard = rule;
    if (rule === "random") {
      const wall = document.createElement("div");
      wall.className = "ssp-bm__random";
      for (const id of boardIds()) {
        if (!hasBoardSnapshot(id)) continue;
        const pic = snapshotEl(id);
        if (pic) wall.appendChild(pic);
      }
      const q = document.createElement("div");
      q.className = "ssp-bm__q";
      q.textContent = "?";
      frame.append(wall, q);
    } else {
      const pic = snapshotEl(rule);
      if (pic) frame.appendChild(pic);
      else {
        const wait = document.createElement("div");
        wait.className = "ssp-bm__wait";
        wait.textContent = BOARDS[rule].name;
        frame.appendChild(wait);
      }
      const tag = document.createElement("div");
      tag.className = "ssp-bm__tag";
      tag.textContent = `${BOARDS[rule].def.spaces.length} SPACES`;
      frame.appendChild(tag);
    }
    if (pop) {
      frame.classList.remove("is-pop");
      void frame.offsetWidth;
      frame.classList.add("is-pop");
    }
    if (this._name) this._name.textContent = rule === "random" ? "Random Board" : BOARDS[rule].name;
    if (this._blurb) this._blurb.textContent = boardRuleBlurb(rule);
    this._tabs?.forEach((t, i) => {
      const on = i === this._sel;
      t.classList.toggle("ssp-bm-tab--on", on);
      t.setAttribute("aria-pressed", String(on));
    });
  },

  _step(dir) {
    const n = this._rules?.length ?? 1;
    this._choose((((this._sel ?? 0) + dir) % n + n) % n);
  },

  _choose(i) {
    if (i === this._sel) return;
    this._sel = i;
    audio.sfx.play("pop");
    audio.sfx.play("whoosh");
    // Saved right away, like the old picker: the choice sticks for next time.
    setBoardRule(this._rules![i]);
    this._paint(true);
  },

  _next() {
    audio.sfx.play("fanfare.win");
    screens.goto("lineup");
  },

  _back() {
    audio.sfx.play("ui.back");
    screens.goto("select");
  },

  exit() {
    for (const t of this._timers ?? []) window.clearTimeout(t);
    this._timers = undefined;
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = undefined;
    for (const b of this._buttons ?? []) b.destroy();
    this._buttons = undefined;
    this._root?.remove();
    this._root = undefined;
    this._frame = undefined;
    this._name = undefined;
    this._blurb = undefined;
    this._tabs = undefined;
    ui.clearScreen();
  },

  update() {},
  render() {},
};

export const boardMenuScreen: Screen = boardMenuImpl;
