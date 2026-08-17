/**
 * SUPER STAR PARTY — DOM UI kit (wave 1). PUBLIC CONTRACT.
 * Screens and gameplay import { ui } from "../ui/kit". The ui object keeps
 * exactly these members (plus additions):
 *
 *   ui.button(opts)      -> {el, setLabel, setEnabled, setVisible, destroy}
 *   ui.banner(text, opts?)-> {el, destroy}
 *   ui.popup(opts)       -> {el, card, destroy}
 *   ui.toast(text, opts?)-> {el, destroy}
 *   ui.coinCounter(el, start, opts?) -> {set, add, tweenTo, value}
 *   ui.confettiBurst(x?, y?, opts?)  (void)
 *   ui.hud()             -> {el, update(players), showBanner(text), destroy}
 *   ui.clearScreen()     (void)
 *   ui.theme             palette passthrough
 *   ui.hex(c)            hex string -> number
 *   ui.playerAvatar(kind, color?) -> HTMLElement       [ADDED]
 *   ui.settingsPanel()   -> {el, destroy}              [ADDED]
 *
 * Style: bright candy palette from config/palette.ts, deep violet ink
 * borders + hard offset shadows, cream surfaces, Fredoka. Every interaction
 * plays a sound (ui.click by default) wrapped in try/catch so a stubbed
 * audio engine can never break the UI.
 */
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";

import { palette, hex } from "../config/palette";
import { runCleanups } from "./registry";
import { clearRoot } from "./root";
import { button } from "./button";
import type { ButtonOpts } from "./button";
import { banner } from "./banner";
import { toast } from "./toast";
import { popup } from "./popup";
import type { PopupOpts } from "./popup";
import { coinCounter } from "./counter";
import { confettiBurst } from "./confetti";
import { hud } from "./hud";
import { playerAvatar } from "./avatar";
import { settingsPanel } from "./settings";

export const ui = {
  theme: palette,
  hex,

  button,
  banner,
  toast,
  popup,
  coinCounter,
  confettiBurst,
  hud,
  playerAvatar,
  settingsPanel,

  /** Remove all transient UI (popups, banners, toasts, confetti, HUD). */
  clearScreen() {
    runCleanups();
    clearRoot();
  },
};

export type { ButtonOpts, PopupOpts };
