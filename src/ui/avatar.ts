/**
 * SUPER STAR PARTY — player avatar.
 * A cute 48px DOM avatar: colored circle with the hero's face (a portrait
 * rendered from the 3D model, characters/portrait.ts), subtle top-light
 * gradient, ink ring and a little shine. Without a portrait (an unknown kind,
 * or no WebGL) it shows the character's initial instead.
 * kind -> character color map; unknown kinds fall back deterministically.
 */
import { palette } from "../config/palette";
import { characterPortrait } from "../characters/portrait";
import { injectStyles } from "./styles";

const KIND_COLORS: Record<string, string> = {
  pip: palette.heroPip,
  bounce: palette.heroBounce,
  glimmer: palette.heroGlimmer,
  tusk: palette.heroTusk,
  mallow: palette.heroMallow,
  rumble: palette.heroRumble,
  jack: palette.heroJack,
  wisp: palette.heroWisp,
  rattle: palette.heroRattle,
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

  const glow =
    `radial-gradient(circle at 32% 28%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 45%), ` +
    `linear-gradient(180deg, ${c} 0%, ${c} 100%)`;
  const face = KIND_COLORS[key] ? characterPortrait(key) : null;
  if (face) {
    // The hero's face on top of their color.
    el.classList.add("ssp-avatar--face");
    el.style.background = `url("${face}") center / 100% 100% no-repeat, ${glow}`;
    el.dataset.sspFace = key;
  } else {
    el.style.background = glow;
    el.textContent = (kind.trim()[0] ?? "?").toUpperCase();
  }
  return el;
}
