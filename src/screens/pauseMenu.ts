/**
 * SUPER STAR PARTY — MP7-style pause overlay for the board screen.
 *
 * A living pause panel: a dimmed + blurred backdrop, a bright candy panel
 * with an ink outline and a chunky Fredoka "PAUSED" title, staggered
 * pop-in, and four real menu items:
 *
 *   RESUME         — closes the overlay; the match continues exactly where
 *                    it was (the board is frozen while open, see below).
 *   SETTINGS       — inline sub-panel with live MUSIC + SFX sliders (via
 *                    setMusicGain/setSfxGain, persisted to the SAME
 *                    localStorage keys the title uses) and a 1x/1.5x/2x
 *                    game-speed selector (persisted; applies next match), and
 *                    an EFFECTS toggle (Off / Low / High, persisted, applies
 *                    immediately). Off does not load the postprocessing chunk.
 *   HOW TO PLAY    — compact rules card INSIDE the panel (leaving the board
 *                    would destroy the match, so the rules come to you).
 *   QUIT TO TITLE  — confirm step ("Quit this match? All progress is lost.")
 *                    with YES/NO; YES returns to the title and ends the match.
 *
 * The overlay never touches the turn loop's own timing. The board screen
 * gates its per-frame update() on the overlay's open flag — so while open,
 * the loop, the board idle animation, the characters and the party camera
 * all FREEZE, and they resume seamlessly with no visual jump. Seeded
 * determinism runs that never open the overlay are byte-identical.
 *
 * localStorage keys are imported from the title screen so settings are
 * consistent everywhere.
 */
import { palette } from "../config/palette";
import { effectsQualityChoices, type EffectsQuality } from "../config/settings";
import { ui } from "../ui/kit";
import { audio } from "../audio/audioEngine";
import { getMusicGain, setMusicGain, getSfxGain, setSfxGain } from "../ui/sound";
import { mountPackPicker } from "../ui/packPicker";
import { getEffectsQuality, setEffectsQuality } from "../render/postFx";

/* ------------------------------------------------------------------ */
/*  localStorage keys (MUST match src/screens/titleScreen.ts)          */
/* ------------------------------------------------------------------ */

const LS_MUSIC = "ssp.musicVolume";
const LS_SFX = "ssp.sfxVolume";
const LS_SPEED = "ssp.speed";

/* ------------------------------------------------------------------ */
/*  Scoped stylesheet (injected once)                                  */
/* ------------------------------------------------------------------ */

let pauseStylesInjected = false;

function injectPauseStyles(): void {
  if (pauseStylesInjected) return;
  pauseStylesInjected = true;
  if (document.getElementById("ssp-pause-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-pause-styles";
  style.textContent = `
    .ssp-pause-overlay {
      position: fixed; inset: 0; z-index: 210;
      background: rgba(43, 29, 78, 0.72);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      opacity: 0; pointer-events: none; visibility: hidden;
      transition: opacity 160ms ease-out;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
    }
    .ssp-pause-overlay--open {
      opacity: 1; pointer-events: auto; visibility: visible;
    }
    .ssp-pause-panel {
      background: linear-gradient(180deg, ${palette.white} 0%, ${palette.cream} 55%, ${palette.creamShadow} 100%);
      border: 6px solid ${palette.ink};
      border-radius: 30px;
      box-shadow: 0 10px 0 ${palette.ink};
      width: min(400px, 92vw);
      max-height: 86vh; overflow-y: auto;
      padding: clamp(18px, 4vw, 28px);
      display: flex; flex-direction: column;
      gap: clamp(12px, 2.5vh, 18px);
      transform: scale(.78) rotate(-2deg);
      transition: transform 240ms cubic-bezier(.34,1.56,.64,1);
    }
    .ssp-pause-overlay--open .ssp-pause-panel {
      transform: scale(1) rotate(0deg);
    }
    .ssp-pause-title {
      font-size: clamp(30px, 8vw, 46px);
      font-weight: 700;
      color: ${palette.ink};
      text-align: center;
      letter-spacing: 3px;
      text-shadow: 3px 3px 0 ${palette.sun}, -2px -2px 0 ${palette.sun};
      margin: 0;
      line-height: 1;
    }
    .ssp-pause-items {
      display: flex; flex-direction: column; gap: clamp(8px, 2vh, 12px);
    }
    .ssp-pause-item {
      width: 100%;
      opacity: 0; transform: translateX(-16px);
      animation: sspPauseItemIn 280ms cubic-bezier(.34,1.56,.64,1) forwards;
    }
    .ssp-pause-item:nth-child(1) { animation-delay: .06s; }
    .ssp-pause-item:nth-child(2) { animation-delay: .12s; }
    .ssp-pause-item:nth-child(3) { animation-delay: .18s; }
    .ssp-pause-item:nth-child(4) { animation-delay: .24s; }
    @keyframes sspPauseItemIn {
      to { opacity: 1; transform: translateX(0); }
    }
    .ssp-pause-sub {
      display: flex; flex-direction: column; gap: 10px;
      animation: sspPauseSubIn 220ms ease-out;
    }
    @keyframes sspPauseSubIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .ssp-pause-sub__title {
      font-size: 22px; font-weight: 700; color: ${palette.ink};
      text-align: center; margin: 0;
    }
    .ssp-pause-slider-row { display: flex; flex-direction: column; gap: 4px; }
    .ssp-pause-slider-row > div {
      display: flex; justify-content: space-between;
      font-size: 14px; font-weight: 600; color: ${palette.ink};
    }
    .ssp-pause-pct { color: ${palette.candy}; font-variant-numeric: tabular-nums; }
    .ssp-pause-slider {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 32px; background: transparent;
      touch-action: manipulation; cursor: pointer; margin: 0;
    }
    .ssp-pause-slider::-webkit-slider-runnable-track {
      height: 10px; border-radius: 999px;
      background: ${palette.creamShadow}; border: 2px solid ${palette.ink};
    }
    .ssp-pause-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 24px; height: 24px; border-radius: 50%; margin-top: -5px;
      background: linear-gradient(180deg, ${palette.candy} 0%, ${palette.candyDeep} 100%);
      border: 3px solid ${palette.ink}; box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-pause-slider--music::-webkit-slider-thumb {
      background: linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%);
    }
    .ssp-pause-slider::-moz-range-track {
      height: 10px; border-radius: 999px;
      background: ${palette.creamShadow}; border: 2px solid ${palette.ink};
    }
    .ssp-pause-slider::-moz-range-thumb {
      width: 24px; height: 24px; border-radius: 50%;
      background: linear-gradient(180deg, ${palette.candy} 0%, ${palette.candyDeep} 100%);
      border: 3px solid ${palette.ink}; box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-pause-speed {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 600; color: ${palette.ink};
    }
    .ssp-pause-speedbtns { display: flex; gap: 6px; flex-wrap: wrap; }
    .ssp-pause-speedbtn {
      font-family: inherit; font-weight: 700; font-size: 13px;
      padding: 5px 14px; border-radius: 999px;
      border: 3px solid ${palette.ink}; background: ${palette.white};
      color: ${palette.ink}; cursor: pointer;
      transition: transform .12s cubic-bezier(.34,1.56,.64,1), background .12s;
      box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-pause-speedbtn--sel { background: ${palette.sun}; transform: scale(1.06); }
    .ssp-pause-note {
      font-size: 12px; font-weight: 600; color: ${palette.inkSoft};
      text-align: center; margin: 0; line-height: 1.4;
    }
    .ssp-pause-rules {
      display: flex; flex-direction: column; gap: 10px;
      text-align: left; font-size: 14px; font-weight: 500; color: ${palette.inkSoft};
      line-height: 1.5;
    }
    .ssp-pause-rules h4 {
      font-size: 16px; font-weight: 700; color: ${palette.ink};
      margin: 4px 0 0;
    }
    .ssp-pause-rules ul { margin: 0; padding-left: 18px; }
    .ssp-pause-rules li { margin-bottom: 4px; }
    .ssp-pause-rules b { color: ${palette.ink}; }
    .ssp-pause-chiprow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .ssp-pause-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 999px;
      border: 2px solid ${palette.ink}; font-size: 12px; font-weight: 600;
      color: ${palette.ink};
    }
    .ssp-pause-chip__dot {
      width: 11px; height: 11px; border-radius: 50%;
      border: 1.5px solid ${palette.ink}; flex-shrink: 0;
    }
    .ssp-pause-confirm {
      text-align: center; font-size: 16px; font-weight: 600;
      color: ${palette.ink}; line-height: 1.5;
      animation: sspPauseSubIn 220ms ease-out;
    }
    .ssp-pause-confirm__btns { display: flex; gap: 12px; justify-content: center; }
    @media (prefers-reduced-motion: reduce) {
      .ssp-pause-overlay, .ssp-pause-panel, .ssp-pause-item, .ssp-pause-sub, .ssp-pause-confirm {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  View types                                                         */
/* ------------------------------------------------------------------ */

type PauseView = "menu" | "settings" | "rules" | "quit";

/* ------------------------------------------------------------------ */
/*  Public handle                                                      */
/* ------------------------------------------------------------------ */

export interface PauseOverlayHandle {
  /** The overlay scrim element (for screenshots / DOM inspection). */
  el: HTMLDivElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Remove the scrim from the DOM. Call once when the host screen exits. */
  destroy(): void;
}

export interface PauseOverlayOpts {
  /** Called when the user picks RESUME (or otherwise dismisses). */
  onResume: () => void;
  /** Called when the user confirms QUIT (after the confirm step). */
  onQuit: () => void;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createPauseOverlay(opts: PauseOverlayOpts): PauseOverlayHandle {
  injectPauseStyles();

  let open = false;
  let view: PauseView = "menu";
  const onResume = opts.onResume;
  const onQuit = opts.onQuit;

  // ---- scrim ----
  const scrim = document.createElement("div");
  scrim.className = "ssp-pause-overlay";
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", "Paused");

  // Click the scrim (outside the panel) to resume — MP7-friendly.
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim && view === "menu") {
      audio.sfx.play("ui.back");
      onResume();
    }
  });

  // ---- panel ----
  const panel = document.createElement("div");
  panel.className = "ssp-pause-panel";
  scrim.appendChild(panel);

  document.body.appendChild(scrim);

  /* ---- view renderers ---- */

  const clearPanel = (): void => {
    panel.innerHTML = "";
  };

  const title = (text: string): HTMLHeadingElement => {
    const h = document.createElement("h2");
    h.className = "ssp-pause-title";
    h.textContent = text;
    return h;
  };

  const backBtn = (label: string, target: PauseView): void => {
    const back = ui.button({
      label,
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      ariaLabel: "Back",
      onClick: () => {
        audio.sfx.play("ui.back");
        showView(target);
      },
    });
    back.el.style.width = "140px";
    back.el.style.alignSelf = "center";
    panel.appendChild(back.el);
  };

  const showMenu = (): void => {
    view = "menu";
    clearPanel();
    panel.appendChild(title("PAUSED"));

    const items = document.createElement("div");
    items.className = "ssp-pause-items";

    const resumeBtn = ui.button({
      label: "▶  RESUME",
      kind: "gold",
      size: "lg",
      sound: "pop",
      ariaLabel: "Resume the match",
      onClick: () => {
        audio.sfx.play("pop");
        onResume();
      },
    });
    resumeBtn.el.classList.add("ssp-pause-item");

    const settingsBtn = ui.button({
      label: "⚙  SETTINGS",
      kind: "primary",
      size: "lg",
      sound: "pop",
      ariaLabel: "Settings",
      onClick: () => {
        audio.sfx.play("pop");
        showSettings();
      },
    });
    settingsBtn.el.classList.add("ssp-pause-item");

    const howBtn = ui.button({
      label: "📖  HOW TO PLAY",
      kind: "primary",
      size: "lg",
      sound: "pop",
      ariaLabel: "How to play",
      onClick: () => {
        audio.sfx.play("pop");
        showRules();
      },
    });
    howBtn.el.classList.add("ssp-pause-item");

    const quitBtn = ui.button({
      label: "🚪  QUIT TO TITLE",
      kind: "danger",
      size: "lg",
      sound: "pop",
      ariaLabel: "Quit to title",
      onClick: () => {
        audio.sfx.play("pop");
        showQuit();
      },
    });
    quitBtn.el.classList.add("ssp-pause-item");

    for (const el of [resumeBtn.el, settingsBtn.el, howBtn.el, quitBtn.el]) {
      el.style.width = "100%";
      items.appendChild(el);
    }
    panel.appendChild(items);
  };

  const showSettings = (): void => {
    view = "settings";
    clearPanel();
    panel.appendChild(title("⚙ SETTINGS"));

    const sub = document.createElement("div");
    sub.className = "ssp-pause-sub";

    // Music slider
    sub.appendChild(
      sliderRow("🎵 MUSIC VOLUME", getMusicGain(), "", (v: number) => {
        localStorage.setItem(LS_MUSIC, String(v));
        setMusicGain(v);
      })
    );

    // SFX slider
    sub.appendChild(
      sliderRow("🔊 SFX VOLUME", getSfxGain(), "", (v: number) => {
        localStorage.setItem(LS_SFX, String(v));
        setSfxGain(v);
      })
    );

    // Speed selector
    const speedRow = document.createElement("div");
    speedRow.className = "ssp-pause-speed";
    const speedLabel = document.createElement("span");
    speedLabel.textContent = "⏱ GAME SPEED";
    speedRow.appendChild(speedLabel);

    const btns = document.createElement("div");
    btns.className = "ssp-pause-speedbtns";
    const savedSpeed = parseFloat(localStorage.getItem(LS_SPEED) ?? "1");
    const opts2: Array<{ label: string; val: number }> = [
      { label: "1×", val: 1 },
      { label: "1.5×", val: 1.5 },
      { label: "2×", val: 2 },
    ];
    const speedBtnEls: HTMLButtonElement[] = [];
    for (const o of opts2) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ssp-pause-speedbtn";
      b.textContent = o.label;
      if (o.val === savedSpeed) b.classList.add("ssp-pause-speedbtn--sel");
      b.addEventListener("click", () => {
        audio.sfx.play("pop");
        localStorage.setItem(LS_SPEED, String(o.val));
        for (const el of speedBtnEls) el.classList.remove("ssp-pause-speedbtn--sel");
        b.classList.add("ssp-pause-speedbtn--sel");
      });
      speedBtnEls.push(b);
      btns.appendChild(b);
    }
    speedRow.appendChild(btns);
    sub.appendChild(speedRow);

    const fxRow = document.createElement("div");
    fxRow.className = "ssp-pause-speed";
    const fxLabel = document.createElement("span");
    fxLabel.textContent = "✨ EFFECTS";
    fxRow.appendChild(fxLabel);
    const fxBtns = document.createElement("div");
    fxBtns.className = "ssp-pause-speedbtns";
    const fxBtnEls: HTMLButtonElement[] = [];
    const paintFx = (current: EffectsQuality): void => {
      for (const el of fxBtnEls) {
        const on = el.dataset.fx === current;
        el.classList.toggle("ssp-pause-speedbtn--sel", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
    };
    for (const choice of effectsQualityChoices) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ssp-pause-speedbtn";
      b.dataset.fx = choice;
      b.textContent = choice.toUpperCase();
      b.setAttribute("aria-label", `Effects ${choice}`);
      b.addEventListener("click", () => {
        audio.sfx.play("pop");
        paintFx(setEffectsQuality(choice, true));
      });
      fxBtnEls.push(b);
      fxBtns.appendChild(b);
    }
    paintFx(getEffectsQuality());
    fxRow.appendChild(fxBtns);
    sub.appendChild(fxRow);

    sub.appendChild(mountPackPicker().el);

    const note = document.createElement("p");
    note.className = "ssp-pause-note";
    note.textContent = "Game speed applies at the start of the next match. Effects apply right away: Off is the lightest, High adds a soft glow.";
    sub.appendChild(note);

    panel.appendChild(sub);
    backBtn("◀ BACK", "menu");
  };

  const showRules = (): void => {
    view = "rules";
    clearPanel();
    panel.appendChild(title("HOW TO PLAY"));

    const rules = document.createElement("div");
    rules.className = "ssp-pause-rules";

    const goal = document.createElement("h4");
    goal.textContent = "🎯 THE GOAL";
    rules.appendChild(goal);
    const goalP = document.createElement("p");
    goalP.style.margin = "0";
    goalP.innerHTML =
      "Race around the <b>Fizzy Fairground</b> — a 28-space carnival loop. Collect <b>coins</b>, buy <b>stars</b>, and play <b>minigames</b>. After 10 rounds, bonus stars go to the player with the most minigame wins AND the player with the most coins. Most total stars wins!";
    rules.appendChild(goalP);

    const spaces = document.createElement("h4");
    spaces.textContent = "🎲 SPACE COLORS";
    rules.appendChild(spaces);
    const chipData: Array<[string, string]> = [
      [palette.mint, "Blue — +3 coins"],
      [palette.lava, "Red — −3 coins"],
      [palette.berry, "Purple — Happening!"],
      [palette.sun, "Prize Balloon — 10 coins a star, up to 5"],
      [palette.bubble, "Cyan — Gumball Shop"],
      [palette.lavaDeep, "Crimson — Grumpus!"],
      [palette.heroPip, "Gold ticket — Stamp"],
      [palette.candy, "Balloon — pay 5 or 10, calls a minigame"],
    ];
    for (const [color, label] of chipData) {
      const chip = document.createElement("span");
      chip.className = "ssp-pause-chip";
      const dot = document.createElement("span");
      dot.className = "ssp-pause-chip__dot";
      dot.style.background = color;
      chip.appendChild(dot);
      const t = document.createElement("span");
      t.textContent = label;
      chip.appendChild(t);
      rules.appendChild(chip);
    }

    const stars = document.createElement("h4");
    stars.textContent = "⭐ COINS & STARS";
    rules.appendChild(stars);
    const starsP = document.createElement("p");
    starsP.style.margin = "0";
    starsP.innerHTML =
      "Everyone starts with <b>10 coins</b>. Pass or land on the <b>Grand Prize Balloon</b> to buy up to <b>5 stars</b> at <b>10 coins</b> each. Unpaid stars in a bundle are discarded, then the balloon pops and moves. End your move on a space someone else is standing on and everyone there gets a <b>group hug: +2 coins</b>. Stars decide the winner!";
    rules.appendChild(starsP);

    const mini = document.createElement("h4");
    mini.textContent = "🎮 MINIGAMES";
    rules.appendChild(mini);
    const miniP = document.createElement("p");
    miniP.style.margin = "0";
    miniP.innerHTML =
      "Pop a <b>Minigame Balloon</b> (pay 5 or 10) and everyone plays a minigame after the round. No pop, the round just rolls on. Winner earns <b>+10 coins</b>. All three stamps pays the <b>30-coin Carnival Jackpot</b>.";
    rules.appendChild(miniP);

    const items = document.createElement("h4");
    items.textContent = "🍄 ITEMS";
    rules.appendChild(items);
    const itemsP = document.createElement("p");
    itemsP.style.margin = "0";
    itemsP.innerHTML =
      "Pass or land on the <b>Gumball Shop</b> (🛒) to buy. The stall sells a Zip Mushroom, a Golden Zip Mushroom, a Sour Mushroom, double dice, a Funhouse Hatch, a dueling glove, the <b>Lucky Card</b> (triple roulette odds and +1 on your next blue), Cogfly, a swap card, Wisp Bell, a genie lamp, Balloon Tug, and a Grumpus Coat, plus the mushroom, warp whistle, zappy, and orbs. Tap an item before you roll; the Sour Mushroom is used after a rival rolls. In the <b>last 5 turns</b>, Fizzy Barker gives the last-place player one free bag item at the start of their turn.";
    rules.appendChild(itemsP);

    panel.appendChild(rules);
    backBtn("◀ BACK", "menu");
  };

  const showQuit = (): void => {
    view = "quit";
    clearPanel();
    panel.appendChild(title("QUIT?"));

    const confirm = document.createElement("div");
    confirm.className = "ssp-pause-confirm";

    const msg = document.createElement("p");
    msg.style.margin = "0 0 14px";
    msg.textContent = "Quit this match? All progress is lost.";
    confirm.appendChild(msg);

    const btns = document.createElement("div");
    btns.className = "ssp-pause-confirm__btns";

    const noBtn = ui.button({
      label: "NO, STAY",
      kind: "gold",
      size: "md",
      sound: "pop",
      ariaLabel: "Cancel quit",
      onClick: () => {
        audio.sfx.play("ui.back");
        showMenu();
      },
    });
    noBtn.el.style.width = "130px";

    const yesBtn = ui.button({
      label: "YES, QUIT",
      kind: "danger",
      size: "md",
      sound: "pop",
      ariaLabel: "Confirm quit to title",
      onClick: () => {
        audio.sfx.play("fanfare.lose");
        // Small delay so the player hears the "uh-oh" before the wipe.
        window.setTimeout(() => onQuit(), 180);
      },
    });
    yesBtn.el.style.width = "130px";

    btns.append(noBtn.el, yesBtn.el);
    confirm.appendChild(btns);
    panel.appendChild(confirm);
  };

  const showView = (v: PauseView): void => {
    switch (v) {
      case "menu":
        showMenu();
        break;
      case "settings":
        showSettings();
        break;
      case "rules":
        showRules();
        break;
      case "quit":
        showQuit();
        break;
    }
  };

  /* ---- slider row helper (mirrors the title screen's slider) ---- */

  function sliderRow(
    label: string,
    initial: number,
    _unused: string,
    apply: (v: number) => void
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "ssp-pause-slider-row";

    const labelRow = document.createElement("div");
    const lab = document.createElement("span");
    lab.textContent = label;
    const pct = document.createElement("span");
    pct.className = "ssp-pause-pct";
    pct.textContent = `${Math.round(initial * 100)}%`;
    labelRow.append(lab, pct);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(initial);
    const cls = label.includes("MUSIC") ? "ssp-pause-slider ssp-pause-slider--music" : "ssp-pause-slider";
    input.className = cls;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      pct.textContent = `${Math.round(v * 100)}%`;
      apply(v);
    });

    row.append(labelRow, input);
    return row;
  }

  /* ---- lifecycle ---- */

  showMenu();

  return {
    el: scrim,
    open() {
      if (open) return;
      open = true;
      // Re-render the menu so the staggered pop-in replays every open.
      showMenu();
      void scrim.offsetHeight;
      scrim.classList.add("ssp-pause-overlay--open");
    },
    close() {
      if (!open) return;
      open = false;
      scrim.classList.remove("ssp-pause-overlay--open");
    },
    isOpen() {
      return open;
    },
    destroy() {
      // Remove scrim + panel from the DOM and detach their listeners. The
      // scrim node clones cleanly because the handler closures only touch
      // local state — no external subscriptions to unregister.
      scrim.remove();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Pause button helper                                                */
/* ------------------------------------------------------------------ */

export interface PauseButtonHandle {
  el: HTMLButtonElement;
  destroy(): void;
}

/**
 * A small, round, MP7-style pause button. The board screen pins it to a
 * top corner. onClick fires onOpen (so the board screen can freeze + open).
 */
export function makePauseButton(onOpen: () => void): PauseButtonHandle {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ssp-pause-fab";
  el.textContent = "⏸";
  el.setAttribute("aria-label", "Pause");
  el.addEventListener("click", () => {
    audio.sfx.play("ui.click");
    onOpen();
  });
  return {
    el,
    destroy() {
      el.remove();
    },
  };
}
