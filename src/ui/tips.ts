/**
 * SUPER STAR PARTY — beginner tips, shown once each, right when they matter.
 *
 * The first time YOU (the local player) meet something, a small card slides
 * in under the scoreboard with one or two plain lines: your first roll, each
 * kind of space, the shop, the Grand Prize Balloon, a Hidden Block, a fork, a
 * group hug, your first item, throwing an orb, the last 5 rounds. It never
 * blocks play, hides itself after a few seconds (or on a tap), and each tip
 * shows once per device (localStorage). Tips are off under autoplay.
 *
 * Presentation only: listens to bus events, never touches match state.
 */
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { bus } from "../core/events";
import { match } from "../core/game";
import { isAutoplay } from "../core/debug";

export type TipId =
  | "first-turn"
  | "land-blue"
  | "land-red"
  | "land-green"
  | "land-grumpus"
  | "land-shop"
  | "land-stamp"
  | "land-minigame_balloon"
  | "hidden-block"
  | "group-hug"
  | "fork"
  | "star-offer"
  | "item-bar"
  | "orb-aim"
  | "last5"
  | "minigame"
  | "pad-hold"
  | "pad-swipe"
  | "pad-twin"
  | "pad-dial"
  | "pad-draw";

interface Tip {
  icon: string;
  title: string;
  text: string;
}

function tipText(id: TipId): Tip {
  const S = settings;
  switch (id) {
    case "first-turn":
      return { icon: "🎲", title: "Your turn!", text: "Tap ROLL to hit the dice block and move. Got an item? Tap it before you roll." };
    case "land-blue":
      return { icon: "🔵", title: "Blue space", text: `+${S.blueCoin} coins! Now and then a Hidden Block pops out of a blue space.` };
    case "land-red":
      return { icon: "🔴", title: "Red space", text: `Ouch, −${S.redCoin} coins. Red spaces take coins away.` };
    case "land-green":
      return { icon: "❓", title: "? space", text: "A surprise event! It could help you, move you, or shake things up." };
    case "land-grumpus":
      return { icon: "😠", title: "Grumpus space", text: "Grumpus makes mischief. Best to avoid these!" };
    case "land-shop":
      return { icon: "🛒", title: "The Shop", text: "Buy items with coins. Each card says what the item does. Passing a shop works too." };
    case "land-stamp":
      return { icon: "🎟️", title: "Stamp", text: `You got a stamp! Collect all 3 kinds for ${S.stampJackpot} coins. Passing counts.` };
    case "land-minigame_balloon":
      return { icon: "🎈", title: "Minigame Balloon", text: "You popped it (it costs a few coins). Everyone plays a minigame when the round ends!" };
    case "hidden-block":
      return { icon: "❔", title: "Hidden Block!", text: "A secret block appeared. It can hold a star, an item, coins, or a coin block you tap fast." };
    case "group-hug":
      return { icon: "🤗", title: "Group hug!", text: `Stopping where someone else stands gives everyone there +${S.squeezeCoins} coins.` };
    case "fork":
      return { icon: "🔀", title: "Pick a path", text: "The road splits here. Choose a lane. Tap 🔍 first if you want to look at the board." };
    case "star-offer":
      return { icon: "⭐", title: "Buy stars here!", text: `Stars cost ${S.starCost} coins each. Stars win the game, so buy as many as you can afford.` };
    case "item-bar":
      return { icon: "🍄", title: "You have an item", text: "Items show up above ROLL. Tap one before you roll to use it (one per turn)." };
    case "orb-aim":
      return { icon: "🟡", title: "Throwing an orb", text: `Pick a glowing space up to ${S.orbThrowRange} steps away. Whoever stops there gets the trap.` };
    case "last5":
      return { icon: "⏰", title: "Last 5 rounds!", text: "Time is running out. Grab stars now! Last place gets a free item each turn." };
    case "minigame":
      return { icon: "🎮", title: "Minigame time!", text: "Read the card, try the controls during PRACTICE, then go! 1st, 2nd and 3rd all win coins." };
    case "pad-hold":
      return { icon: "👇", title: "HOLD to charge", text: "Press and hold the big button to fill the ring, then LET GO to throw. Keyboard: hold Space." };
    case "pad-swipe":
      return { icon: "👆", title: "SWIPE to flick", text: "Flick your finger across the screen. A faster swipe is a harder throw. Keyboard: an arrow aims, hold Space for power, let go." };
    case "pad-twin":
      return { icon: "🔘", title: "Two buttons", text: "Tap the two buttons, one under each thumb. Keyboard: Z and X." };
    case "pad-dial":
      return { icon: "🎡", title: "Spin the WHEEL", text: "Drag your thumb around the wheel. Keep it turning! Keyboard: Q and E." };
    case "pad-draw":
      return { icon: "✏️", title: "DRAW a path", text: "Drag your finger to draw. Lift to finish. Keyboard: drag the mouse, or hold Space and use the arrows." };
  }
}

const LS_SEEN = "ssp.tipsSeen";
const LS_OFF = "ssp.tipsOff";
const SHOW_MS = 7000;

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_SEEN);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(LS_SEEN, JSON.stringify([...seen]));
  } catch {
    /* private mode: tips just show again next time */
  }
}

/** Beginner tips on or off (on by default). */
export function tipsEnabled(): boolean {
  try {
    return localStorage.getItem(LS_OFF) !== "1";
  } catch {
    return true;
  }
}

export function setTipsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(LS_OFF);
    else localStorage.setItem(LS_OFF, "1");
  } catch {
    /* ignore */
  }
}

/** Forget which tips were seen, so they all show again. */
export function resetTips(): void {
  try {
    localStorage.removeItem(LS_SEEN);
  } catch {
    /* ignore */
  }
}

const STYLE_ID = "ssp-tips-styles";
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  // The card sits under the banner band (--ssp-fb-banner-top, two lines of
  // .ssp-fb-banner text), so "TURN 1" and friends are never covered.
  s.textContent = `
    .ssp-tip{position:fixed;left:50%;
      top:calc(var(--ssp-fb-banner-top, calc(env(safe-area-inset-top,0px) + 140px)) + 2.24 * clamp(24px, 5.5vw, 40px) + 12px);
      transform:translate(-50%,-14px);opacity:0;
      z-index:84;width:min(92vw,360px);box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;
      background:${palette.cream};color:${palette.ink};border:4px solid ${palette.ink};border-radius:16px;
      box-shadow:0 5px 0 ${palette.ink};padding:9px 12px;font-family:Fredoka,sans-serif;cursor:pointer;
      transition:opacity .22s ease-out,transform .28s cubic-bezier(.34,1.56,.64,1)}
    .ssp-tip--show{opacity:1;transform:translate(-50%,0)}
    .ssp-tip__icon{font-size:24px;line-height:1;flex:none;margin-top:2px}
    .ssp-tip__body{flex:1 1 auto;min-width:0}
    .ssp-tip__label{font-size:11px;font-weight:700;letter-spacing:.8px;color:${palette.candyDeep}}
    .ssp-tip__title{font-size:16px;font-weight:700;line-height:1.15}
    .ssp-tip__text{font-size:14px;font-weight:500;line-height:1.3;margin-top:2px}
    .ssp-tip__x{flex:none;font-size:16px;font-weight:700;color:${palette.inkSoft};padding:0 2px}
    body.ssp-maplook-on .ssp-tip{visibility:hidden}
  `;
  document.head.appendChild(s);
}

/** The local seat (this device's player), or -1 with none. */
function localSeat(): number {
  return match.players.findIndex((p) => p.controller === "local");
}

export interface TipsHandle {
  /** Show a tip now (if it is new and tips are on). */
  show(id: TipId): void;
  dispose(): void;
}

/**
 * Listen for the moments that deserve a tip. The board screen installs this
 * on enter and disposes it on exit.
 */
export function installTips(): TipsHandle {
  injectStyles();
  const seen = readSeen();
  const queue: TipId[] = [];
  let showing: HTMLElement | null = null;
  let hideTimer: number | null = null;
  let disposed = false;

  const hide = (): void => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
    const el = showing;
    showing = null;
    if (el) {
      el.classList.remove("ssp-tip--show");
      window.setTimeout(() => el.remove(), 260);
    }
    window.setTimeout(next, 320);
  };

  const next = (): void => {
    if (disposed || showing) return;
    const id = queue.shift();
    if (!id) return;
    const tip = tipText(id);
    const el = document.createElement("div");
    el.className = "ssp-tip";
    el.dataset.sspTip = id;
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="ssp-tip__icon" aria-hidden="true"></div><div class="ssp-tip__body"><div class="ssp-tip__label">TIP</div><div class="ssp-tip__title"></div><div class="ssp-tip__text"></div></div><div class="ssp-tip__x" aria-label="Close tip">✕</div>`;
    (el.querySelector(".ssp-tip__icon") as HTMLElement).textContent = tip.icon;
    (el.querySelector(".ssp-tip__title") as HTMLElement).textContent = tip.title;
    (el.querySelector(".ssp-tip__text") as HTMLElement).textContent = tip.text;
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      hide();
    });
    document.body.appendChild(el);
    showing = el;
    requestAnimationFrame(() => el.classList.add("ssp-tip--show"));
    hideTimer = window.setTimeout(hide, SHOW_MS);
  };

  const show = (id: TipId): void => {
    if (disposed || !tipsEnabled() || isAutoplay()) return;
    if (seen.has(id) || queue.includes(id)) return;
    seen.add(id);
    writeSeen(seen);
    if (queue.length >= 3) return; // never pile up a backlog
    queue.push(id);
    next();
  };

  const mine = (pid: number): boolean => pid === localSeat() && pid >= 0;
  const offs = [
    bus.on("turn:start", ({ player, turn }) => {
      if (mine(player)) show("first-turn");
      if (match.totalTurns > 0 && turn >= match.totalTurns - 4) show("last5");
    }),
    bus.on("player:land", ({ player, type }) => {
      if (!mine(player)) return;
      const id = `land-${type}` as TipId;
      if (
        id === "land-blue" ||
        id === "land-red" ||
        id === "land-green" ||
        id === "land-grumpus" ||
        id === "land-shop" ||
        id === "land-stamp" ||
        id === "land-minigame_balloon"
      ) {
        show(id);
      }
    }),
    bus.on("hidden:block", ({ player }) => {
      if (mine(player)) show("hidden-block");
    }),
    bus.on("squeeze:hug", ({ players }) => {
      if (players.some(mine)) show("group-hug");
    }),
    bus.on("tip:moment", ({ id, player }) => {
      if (mine(player)) show(id as TipId);
    }),
  ];

  return {
    show,
    dispose() {
      disposed = true;
      for (const off of offs) off();
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      showing?.remove();
      showing = null;
      queue.length = 0;
    },
  };
}
