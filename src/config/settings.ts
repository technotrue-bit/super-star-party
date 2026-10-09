/**
 * SUPER STAR PARTY — tuning numbers. No magic numbers in gameplay code.
 * Wave agents may ADD keys; never rename/remove keys other agents use.
 */

/** Post look. Off does not load the postprocessing chunk. */
export const effectsQualityChoices = ["off", "low", "high"] as const;
export type EffectsQuality = (typeof effectsQualityChoices)[number];

/** Same key the pause menu writes. `?fx=` overrides it for one session. */
export const EFFECTS_QUALITY_STORAGE_KEY = "ssp.effectsQuality";

export function isEffectsQuality(value: string | null | undefined): value is EffectsQuality {
  return value === "off" || value === "low" || value === "high";
}

/**
 * High on a desktop pointer with DPR above 1.
 * Low on a phone, a coarse pointer, a narrow window, or a low-DPR display.
 * Off is only a manual choice.
 */
export function defaultEffectsQuality(): EffectsQuality {
  if (typeof window === "undefined") return "low";
  const dpr = window.devicePixelRatio || 1;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrow = window.matchMedia?.("(max-width: 820px)").matches ?? false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const mobile = coarse || narrow || /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  if (mobile || dpr <= 1) return "low";
  return "high";
}

/**
 * Lively board (landing reactions + ambient scenery). On by default.
 * `?lively=0` turns every lively addition off for this page load, which is
 * how the isolation probe compares a plain board against a lively one.
 */
export function livelyEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return new URLSearchParams(window.location.search).get("lively") !== "0";
}

/** `?speed=` playback multiplier (main.ts scales the frame dt by it). */
export function playSpeed(): number {
  if (typeof window === "undefined") return 1;
  const s = Number(new URLSearchParams(window.location.search).get("speed") ?? "1");
  return Number.isFinite(s) && s > 0 ? s : 1;
}

let reducedMotionQuery: MediaQueryList | null = null;
/** The same `prefers-reduced-motion: reduce` query the UI styles honour. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotionQuery.matches;
}

export const settings = {
  // ---- engine ----
  maxDelta: 1 / 20, // clamp frame delta (s)
  targetFps: 60,
  maxDpr: 2,

  // ---- match ----
  totalTurns: 10, // rounds of dice-roll + minigame
  players: 4,
  starCost: 10, // coins per star from the Grand Prize Balloon
  starBundleMax: 5, // most stars one visit to the balloon can ask for
  blueCoin: 3, // coins gained on blue space
  redCoin: 3, // coins lost on red space
  minigameWinCoins: 10, // base minigame winner payout, before pack bonus and the host multiplier
  minigameCoinMultiplier: 1, // host scale (1, 2, 3, or 4); live value is persisted in localStorage
  stampJackpot: 30, // coins when a player completes the 3-stamp set
  squeezeCoins: 2, // Carnival Squeeze: coins for each player on a shared landing space
  pityLastTurns: 5, // Fizzy Barker visits last place while this many turns remain
  bonusStars: 2, // end-of-match bonus stars (minigame star + coin star)

  // ---- movement ----
  moveSpeed: 9, // tiles per second while hopping
  hopHeight: 0.7, // hop apex (world units)
  hopDuration: 0.34, // seconds per tile hop
  landSquash: 0.25, // squash amount on landing
  diceSuspense: 1.1, // seconds of dice suspense before the face lands

  // ---- board ----
  tileSpacing: 2.6, // world units between space centers
  tileRadius: 1.05,
  cameraFitPadding: 1.25,
  // Board presentation tuning (owned by the board builder).
  board: {
    diskHeight: 0.12, // space disk thickness / raise above ground
    pathWidth: 1.5, // sandy path strip width
    groundSize: 64, // grass checkerboard size (world units) — wide enough that
    // the far grass corners project OUTSIDE the frame sides from the party
    // camera, so no sky wedge leaks into the top strip
    groundTile: 2, // grass checker tile size (world units)
    starBobSpeed: 1.5, // rad/s golden star bob
    starBobAmp: 0.16, // star bob amplitude (world units)
    starSpinSpeed: 1.1, // rad/s golden star spin
    ferrisSpin: 0.32, // rad/s ferris wheel rotation
    pennantSway: 1.2, // rad/s tent pennant sway
    // Tent tuning. Tents live on the grass strips that stay inside the
    // PORTRAIT frame: the portrait camera's narrow horizontal fov clips the
    // loop corners (the old 2.9u-out corner spots were off-screen entirely),
    // and the HUD chip row covers the top ~115px, so all three tents sit on
    // the south grass in a shallow A-row — visible and unobstructed in both
    // aspects.
    tentScale: 1.1, // tent body/cone/pennant scale multiplier
    tentStripeCount: 4, // candy stripes around the tent (fewer = wider = reads at phone size)
    tentOutlineBody: 1.1, // ink outline shell scale on the tent body
    tentOutlineCone: 1.13, // ink outline shell scale on the tent cone
    tentSpots: [
      // world x/z positions; colors pair red/cream, sun/cream, mint/cream.
      // Red (the landmark the critic counts) sits front-center: it stays
      // on-screen even during the SW dice-camera punch; sun takes the west
      // slot, mint the east.
      { x: -1.5, z: 14.6 }, // tentRed — south grass, front-center
      { x: -8.0, z: 13.5 }, // sun — south grass, left
      { x: 4.0, z: 13.0 }, // mint — south grass, right
    ],
    tentBalloonInset: 1.8, // balloon cluster offset from each tent back toward the loop
    fountainPulse: 2.0, // rad/s fountain sparkle pulse
    balloonSway: 0.7, // rad/s balloon cluster sway
    highlightRise: 0.5, // highlight ring max rise (world units)
    highlightPulse: 2.2, // highlight ring pulse rate (cycles/s)
    boundsPad: 0.8, // camera-fit padding beyond the space radius
  },

  // ---- lively board (cosmetic only; `?lively=0` turns it off) ----
  lively: {
    hopDip: 0.08, // disk dip depth when a player pushes off / lands mid-move (world units)
    hopDipTime: 0.22, // seconds per dip
    landSquash: 0.42, // landing squash: y scale starts at 1 - this, springs back elastically
    landSquashTime: 0.7, // seconds for the squash to settle
    ringTime: 0.55, // rim-colour ring expand + fade (s)
    ringGrow: 0.85, // extra ring scale at the end of the fade
    particles: 48, // pooled instanced particles (allocated once)
    burst: 12, // particles per landing
    gravity: 11, // particle gravity (world units/s^2)
    buntingSpacing: 0.7, // pennant width along a bunting strand (world units)
    buntingSag: 1.4, // bunting droop at mid-span (world units)
    buntingBow: 1.0, // bunting bow away from the loop at mid-span (clears the disks, misses the tents)
    carouselSpin: 0.55, // rad/s carousel turn
    cloudDrift: 0.9, // world units/s cloud drift
    birdLap: 0.16, // rad/s bird flock lap around the board
    searchSweep: 0.45, // rad/s searchlight sweep
    // Camera shots (lively/shots.ts). Durations are board seconds, so speed=N
    // already plays them N times faster; above shotMaxSpeed they are skipped.
    // Off under prefers-reduced-motion.
    shots: true,
    shotMaxSpeed: 6,
    shotQueue: 2, // queued shots waiting behind the active one (oldest dropped)
    shotMaxWait: 1.2, // board seconds a queued shot may wait while the camera is free
    shotMaxAge: 5, // board seconds from trigger to start, however long a hold/punch lasted
    shotCancelTime: 0.25, // fade back to the follow camera when a punch or hold cuts in
    // Crowd (lively/crowd.ts): two bleachers of Fizzlings beside the tents.
    crowd: true,
    crowdPerBleacher: 16,
    crowdStagger: 0.28, // max per-spectator reaction delay (s)
    crowdCheerTime: 1.3, // hop cheer length (s)
    crowdLeanTime: 1.1, // lean-in "ooh" length (s)
    crowdSlumpTime: 1.6, // slump "aah" length (s)
    // Day -> dusk -> night (lively/timeOfDay.ts, lively/night.ts). The target
    // look depends on match.turn only; the board eases toward it.
    nightTween: 1.6, // seconds (time constant) to ease into a new turn's light
    fireworks: true, // lazy fireworks chunk in the last five turns
    fireworkShells: 5, // concurrent shells
    fireworkSparks: 50, // sparks per shell (shells * sparks <= 256)
  },

  // ---- match-screen party camera ----
  // Distance = fit * distMul where fit = max(board bounds + 2*sceneryPad).
  // Elevation = camera's view angle above the ground plane. The camera
  // shoots from the NORTH in landscape so the ferris wheel (bottom-right
  // corner, tall + wheel faces +/-z) lands in the near foreground, big and
  // face-on, while the grass fills the frame (whole-frame ink <12%, top
  // strip <10%, no bottom band). Portrait keeps the classic south party
  // angle (its narrow horizontal FOV can't fit the corner landmarks anyway;
  // the loop + grass fill the frame instead).
  matchCamera: {
    sceneryPad: 5.2, // tents ~2.9u, ferris ~4.2u beyond the space loop
    distMulPortrait: 1.19, // ~46u out
    elevPortrait: 1.3963, // ~80deg — far ground line sits near the frame top
    lookXPortrait: 2.5, // slight bias toward the ferris side
    lookZPortrait: 2.5, // look a touch closer: far edge stays high
    distMulLandscape: 0.88, // ~34u out
    elevLandscape: 0.995, // ~57deg
    camXLandscape: 0.0, // east-of-axis offset (0 now: the wide ground already
    //   keeps the far grass edge out of the frame sides)
    lookXLandscape: 2.5, // bias toward the ferris corner (+x) — wheel in frame
    lookZLandscape: -3.0, // north camera: look closer = far ground line high
  },

  // ---- minigames ----
  minigameCountdown: 2.8, // "3-2-1-GO" length (s)
  minigameTimeLimit: 30, // default time limit (s)
  minigameWinPose: 1.6, // winner celebration on stage (s)

  // ---- audio ----
  musicVolume: 0.5,
  sfxVolume: 0.9,
  masterVolume: 1.0,
  crowdVolume: 0.35,
  audioLookaheadMs: 120, // scheduler looks this far ahead (s)
  audioTickMs: 25, // scheduler timer period (ms)
  sfxMinGapMs: 30, // per-name one-shot throttle (ms)
  crowdMurmurLevel: 0.5, // murmur pad level before crowdVolume

  // ---- ui ----
  bannerTime: 1.8, // big banner text hold (s)
  coinTweenTime: 0.5,
  popupTime: 1.6, // space-result popup hold (s)

  // ---- post ----
  // One EffectPass on Low and High (FXAA + vignette; High also blooms).
  // Bloom's mip chain starts at half resolution inside that pass.
  // Off skips the library. Live choice: defaultEffectsQuality(), then
  // localStorage, then ?fx=. Gameplay does not read these numbers.
  effects: {
    bloomThreshold: 0.9, // only the hottest highlights (stars, coin glints)
    bloomSmoothing: 0.08,
    bloomIntensity: 0.4,
    bloomRadius: 0.4,
    bloomLevels: 4, // mip count; each level is half the one above
    vignetteOffset: 0.35,
    vignetteDarknessLow: 0.26,
    vignetteDarknessHigh: 0.4,
    fxaaSamplesLow: 8,
    fxaaSamplesHigh: 12,
  },
} as const;
