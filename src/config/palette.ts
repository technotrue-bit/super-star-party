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
  grassMid: "#6BCB49", // lawn rings between the checker tones (minigame floor)
  path: "#FFE9B8", // sandy path
  pathEdge: "#E8C987",
  tentRed: "#FF5A6E",
  tentCream: "#FFF3D6",
  wood: "#C98A4B",
  woodDark: "#A96B33",
  metal: "#9FB4C7",
  // Space disks follow the party-board convention: blue gives, red takes,
  // green is a happening. The rim tone is the darker partner of each.
  // Green leans teal and red leans crimson so neither melts into the lime
  // lawn or the orange/pink specials (stamp, balloon).
  spaceBlue: "#3D8BFF",
  spaceBlueDeep: "#2361D6",
  spaceRed: "#F2384A",
  spaceRedDeep: "#B81E3A",
  spaceGreen: "#14C28C",
  spaceGreenDeep: "#0B8564",
  // Diorama: the island the fairground sits on, the sea around it, the sky.
  skyTop: "#4FB8FF", // zenith on a clear day
  skyHorizon: "#D9F4FF", // pale haze where sky meets sea
  sea: "#2FA8E8",
  seaDeep: "#1C78C2",
  foam: "#F4FCFF",
  cliffDirt: "#C47A45",
  cliffDirtDark: "#8E5230",
  cliffStone: "#9A8C9E",
  leaf: "#4CC24A",
  leafDeep: "#2E9A3E",
  leafPine: "#1F8A5A",
  bark: "#8A5634",
  rock: "#B9B2C6",
  sand: "#FFE3A3",

  // ---- time of day (lively board: day -> golden dusk -> night) ----
  // Day is the boot look (ink background, white hemi over ink ground, white key).
  duskSky: "#E8734F", // coral sunset background + fog
  duskSkyTop: "#6E4FC8", // violet zenith over the coral horizon
  duskHemi: "#FF8A2E", // golden-hour sky light (low green: the grass turns olive-gold)
  duskGround: "#7A3A5A", // plum-rose bounce light
  duskKey: "#FF6A12", // low orange sun
  nightSky: "#160F3A", // deep night background + fog
  nightSkyTop: "#0B0726", // near-black zenith above the night haze
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
  heroMallow: "#A98BF5", // Mallow — lavender hippo
  heroRumble: "#F2605A", // Rumble — coral dino
  heroJack: "#FF8A1F", // Jack — floating pumpkin
  heroWisp: "#EEF0FF", // Wisp — chibi ghost
  pumpkinStem: "#4E8B3A", // Jack's stem + leaf

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
