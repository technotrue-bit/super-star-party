/**
 * SUPER STAR PARTY — player avatar.
 * A cute 48px DOM avatar: colored circle with the character's initial,
 * subtle top-light gradient, ink ring and a little shine.
 * kind -> character color map; unknown kinds fall back deterministically.
 */
import { palette } from "../config/palette";
import { injectStyles } from "./styles";

const KIND_COLORS: Record<string, string> = {
  pip: palette.heroPip,
  bounce: palette.heroBounce,
  glimmer: palette.heroGlimmer,
  tusk: palette.heroTusk,
};

const FALLBACKS = [
  palette.heroPip,
  palette.heroBounce,
  palette.heroGlimmer,
  palette.heroTusk,
  palette.candy,
  palette.mint,
  palette.bubble,
  palette.berry,
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function playerAvatar(kind: string, color?: string): HTMLDivElement {
  injectStyles();
  const el = document.createElement("div");
  el.className = "ssp-avatar";
  el.setAttribute("aria-hidden", "true");

  const key = kind.trim().toLowerCase();
  const c =
    color ??
    KIND_COLORS[key] ??
    FALLBACKS[hashStr(key || "?") % FALLBACKS.length];

  el.style.background =
    `radial-gradient(circle at 32% 28%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 45%), ` +
    `linear-gradient(180deg, ${c} 0%, ${c} 100%)`;

  el.textContent = (kind.trim()[0] ?? "?").toUpperCase();
  return el;
}
