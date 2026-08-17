/**
 * SUPER STAR PARTY — tuning numbers. No magic numbers in gameplay code.
 * Wave agents may ADD keys; never rename/remove keys other agents use.
 */
export const settings = {
  // ---- engine ----
  maxDelta: 1 / 20, // clamp frame delta (s)
  targetFps: 60,
  maxDpr: 2,

  // ---- match ----
  totalTurns: 10, // rounds of dice-roll + minigame
  players: 4,
  starCost: 20, // coins to buy a star
  blueCoin: 3, // coins gained on blue space
  redCoin: 3, // coins lost on red space
  minigameWinCoins: 10, // minigame winner payout
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

  // ---- minigames ----
  minigameCountdown: 2.8, // "3-2-1-GO" length (s)
  minigameTimeLimit: 30, // default time limit (s)
  minigameWinPose: 1.6, // winner celebration on stage (s)

  // ---- audio ----
  musicVolume: 0.5,
  sfxVolume: 0.9,
  masterVolume: 1.0,
  crowdVolume: 0.35,

  // ---- ui ----
  bannerTime: 1.8, // big banner text hold (s)
  coinTweenTime: 0.5,
  popupTime: 1.6, // space-result popup hold (s)
} as const;
