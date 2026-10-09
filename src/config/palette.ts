/**
 * SUPER STAR PARTY — palette. SINGLE SOURCE OF TRUTH for colors.
 * Bright, mischievous party-game vibes: saturated candy colors, deep ink,
 * warm cream. Any off-palette color in the game is a defect.
 * Rules: components import named colors from here; never inline hex.
 */
export const palette = {
  // ---- ink & paper ----
  ink: "#2B1D4E", // deep violet-navy: text, outlines, shadow
  inkSoft: "#4A3A78", // secondary text
  cream: "#FFF6E5", // warm paper background
  creamShadow: "#F0DDBE", // cream pressed state

  // ---- candy primaries ----
  sun: "#FFD23F", // gold: coins, stars, highlights
  sunDeep: "#F5A623", // darker gold: gradients, pressed
  candy: "#FF4F9A", // hot pink: primary accents, buttons
  candyDeep: "#E02F7E", // pressed candy
  berry: "#7B3FF2", // violet: secondary accents
  berryDeep: "#5E2BC9",
  mint: "#2EE6A8", // green: gains, yes, alive
  mintDeep: "#17B886",
  bubble: "#3FD6FF", // cyan: info, water, magic
  bubbleDeep: "#1FA8D8",
  lava: "#FF5A3C", // red-orange: danger, Grumpus, loses
  lavaDeep: "#D93A1F",

  // ---- board-world colors (Fizzy Fairground) ----
  grassA: "#7ED957", // checker light
  grassB: "#5BBE3E", // checker dark
  path: "#FFE9B8", // sandy path
  pathEdge: "#E8C987",
  tentRed: "#FF5A6E",
  tentCream: "#FFF3D6",
  wood: "#C98A4B",
  woodDark: "#A96B33",
  metal: "#9FB4C7",

  // ---- time of day (lively board: day -> golden dusk -> night) ----
  // Day is the boot look (ink background, white hemi over ink ground, white key).
  duskSky: "#E8734F", // coral sunset background + fog
  duskHemi: "#FF8A2E", // golden-hour sky light (low green: the grass turns olive-gold)
  duskGround: "#7A3A5A", // plum-rose bounce light
  duskKey: "#FF6A12", // low orange sun
  nightSky: "#160F3A", // deep night background + fog
  nightHemi: "#5848E8", // blue-violet sky light (low green: the checker turns teal/indigo)
  nightGround: "#1A0F45", // deep indigo bounce light
  nightKey: "#6E6AF0", // violet moonlight
  lampWarm: "#FFB547", // lamp halo + string-light bulbs after dusk
  lampHot: "#FFF2C2", // lamp core at night

  // ---- characters ----
  heroPip: "#FFB62E", // Pip — orange star kid
  heroBounce: "#3FA9F5", // Bounce — blue spring rabbit
  heroGlimmer: "#2EE6A8", // Glimmer — green imp
  heroTusk: "#F07FE0", // Tusk — pink elephant

  // ---- misc ----
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(43, 29, 78, 0.62)", // modal scrim
} as const;

export type PaletteColor = keyof typeof palette;

/** Outline color used by cel-shaded models. */
export const OUTLINE = palette.ink;

/** Quick access for three.js materials. */
export function hex(c: string): number {
  return parseInt(c.replace("#", ""), 16);
}
