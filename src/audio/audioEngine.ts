/**
 * SUPER STAR PARTY — Web Audio engine CONTRACT.
 * Wave-1 audio builder owns src/audio/** entirely and may rewrite internals,
 * but MUST keep this public API (screens, gameplay, critics all depend on it).
 *
 * Contract:
 *  - audio.ready          Promise that resolves once the AudioContext exists
 *  - audio.unlock()       create/resume context (call on first user gesture)
 *  - audio.master.gain    master volume (0..1)
 *  - audio.music.play(track, opts?)  start a music track (looping)
 *  - audio.music.stop(fade?)         fade out current track
 *  - audio.music.track()             name of currently playing track
 *  - audio.music.intensity(level)    dynamic layer: 0..1 (1 = max energy)
 *  - audio.sfx.play(name, opts?)     one-shot sound effect
 *  - audio.sfx.stopAll()
 *  - audio.levels()        {rms, peak} from the analyser (debug/critics)
 *  - audio.renderTrack(track, seconds) -> Promise<Blob>  offline WAV render
 *    (used by tools/render-music.mjs to bake tracks for the Captain to hear)
 *
 * Track names (registered in music registry):
 *  title, board, minigame_a, minigame_b, happening, grumpus,
 *  results, star_fanfare, minigame_intro, win, lose, shop
 *
 * SFX names (registered in sfx registry) — wave 1 defines the full set, at
 * minimum these must exist:
 *  ui.click, ui.back, dice.roll, dice.land, coin.gain, coin.lose,
 *  star.get, jump, hop, land, sad, cheer, boing, whoosh, pop,
 *  fanfare.win, fanfare.lose, minigame.go, minigame.count,
 *  grumpus.laugh, happening.magic, shop.buy, whistle, crowd.cheer, crowd.aah
 */
import { bus } from "../core/events";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;

function ensureContext(): AudioContext {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  master.connect(analyser);
  return ctx;
}

/** Call from the first pointer/key gesture. Safe to call repeatedly. */
export function unlock(): void {
  try {
    const c = ensureContext();
    if (c.state === "suspended") void c.resume();
  } catch {
    /* audio unavailable — game must keep running silently */
  }
}

export const audio = {
  ready: Promise.resolve(),
  unlock,

  master: {
    get gain(): number {
      return master?.gain.value ?? 1;
    },
    set gain(v: number) {
      if (master) master.gain.value = v;
    },
  },

  music: {
    play(_track: string, _opts?: { intensity?: number }): void {
      // Wave 1 replaces with the real sequencer.
    },
    stop(_fade = 0.4): void {},
    track(): string {
      return "silence";
    },
    intensity(_level: number): void {},
  },

  sfx: {
    play(_name: string, _opts?: { volume?: number; pitch?: number }): void {
      // Wave 1 replaces with real synth SFX.
    },
    stopAll(): void {},
  },

  /** Analyser levels — used by debug API + critics to prove audio is live. */
  levels(): { rms: number; peak: number } {
    if (!analyser) return { rms: 0, peak: 0 };
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    return { rms: Math.sqrt(sum / data.length), peak };
  },

  /** Offline render of a track to a WAV blob (for the Captain to hear). */
  async renderTrack(_track: string, _seconds = 20): Promise<Blob> {
    throw new Error("renderTrack: wave 1 must implement offline rendering");
  },
};

// Contract check: bus events for audio state changes.
bus.on("audio:track", (p) => {
  void p;
});
