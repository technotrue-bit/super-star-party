/**
 * SUPER STAR PARTY — crowd ambience.
 *
 * A filtered-noise "murmur" pad runs whenever audio is alive (the party is
 * never silent), plus triggered reactions wired to the game event bus:
 *   star:buy        -> big cheer swell
 *   minigame:end    -> cheer (or sympathetic aah)
 *   happening:event -> ooh
 *
 * Everything routes through the crowd bus (crowdGain, default 0.35 =
 * settings.crowdVolume) so reactions share the crowd's volume control.
 */

import { bus } from "../../core/events";
import { settings } from "../../config/settings";
import { getNoiseBuffer } from "./instruments";

export interface CrowdHandle {
  stop(): void;
}

/** Start the murmur pad into `out`. Returns a handle to stop it. */
export function startCrowdMurmur(ctx: BaseAudioContext, out: GainNode): CrowdHandle {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 480;
  filter.Q.value = 0.6;

  // slow "room tone" breathing
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.11;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.05;
  const breatheTarget = ctx.createGain();
  breatheTarget.gain.value = settings.crowdMurmurLevel;

  const filterSway = ctx.createOscillator();
  filterSway.frequency.value = 0.07;
  const swayGain = ctx.createGain();
  swayGain.gain.value = 140;

  src.connect(filter);
  filter.connect(breatheTarget);
  breatheTarget.connect(out);
  breath.connect(breathGain);
  breathGain.connect(breatheTarget.gain);
  filterSway.connect(swayGain);
  swayGain.connect(filter.frequency);

  src.start(0);
  breath.start(0);
  filterSway.start(0);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const now = ctx.currentTime;
        breatheTarget.gain.cancelScheduledValues(now);
        breatheTarget.gain.setValueAtTime(breatheTarget.gain.value, now);
        breatheTarget.gain.linearRampToValueAtTime(0.0001, now + 0.3);
        src.stop(now + 0.4);
      } catch {
        /* context gone */
      }
    },
  };
}

/** Subscribe to game events. `playReaction(name, volume)` plays a crowd sfx. */
export function wireCrowdReactions(playReaction: (name: string, volume: number) => void): void {
  bus.on("star:buy", () => {
    playReaction("crowd.cheer", 1);
  });

  bus.on("minigame:end", (p) => {
    if (p.winner >= 0) playReaction("crowd.cheer", 0.85);
    else playReaction("crowd.aah", 0.9);
  });

  bus.on("happening:event", () => {
    playReaction("crowd.ooh", 0.8);
  });

  // Coins are the party's heartbeat: small positive swells.
  bus.on("coins:change", (p) => {
    if (p.delta > 0) playReaction("crowd.ooh", 0.35);
  });
}
