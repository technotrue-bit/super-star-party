/**
 * SUPER STAR PARTY — SFX registry. Every named sound, all synthesized.
 * One-shots, 0.05-0.8s (fanfares/reactions longer by design).
 *
 * play() opts: { volume: 0..2 multiplier, pitch: semitone offset }.
 * Route: 'sfx' sounds go through the sfx bus; 'crowd' sounds (cheers,
 * aahs, oohs) go through the crowd bus so crowdVolume controls them.
 */

import type { StopFn } from "./synth";
import { tone, noise, arp, kaching } from "./synth";

export interface SfxPlayOpts {
  volume?: number;
  pitch?: number; // semitones
}

export interface SfxDef {
  build: (ctx: BaseAudioContext, out: AudioNode, t: number, o: { vol: number; pitch: number }) => StopFn;
  gap?: number; // min ms between plays of this name (default 30)
  route?: "sfx" | "crowd";
}

function semitone(pitch: number): number {
  return Math.pow(2, pitch / 12);
}

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */

const uiClick: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 950 * p, 0.06, {
        type: "sine",
        vol: o.vol * 0.4,
        slideTo: 620 * p,
        slideTime: 0.05,
        decay: 0.05,
      }),
    );
    stops.push(noise(ctx, out, t, 0.025, { type: "highpass", freq: 3500, vol: o.vol * 0.08 }));
    return () => stops.forEach((s) => s());
  },
};

const uiBack: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 520 * p, 0.09, {
        type: "sine",
        vol: o.vol * 0.36,
        slideTo: 330 * p,
        slideTime: 0.08,
        decay: 0.08,
      }),
    );
    stops.push(noise(ctx, out, t, 0.03, { type: "highpass", freq: 2800, vol: o.vol * 0.06 }));
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Dice                                                               */
/* ------------------------------------------------------------------ */

const diceRoll: SfxDef = {
  gap: 350,
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    // rattling ticks with rising pitch, plus a gritty rattle bed
    for (let i = 0; i < 7; i++) {
      const tt = t + i * 0.062;
      stops.push(
        tone(ctx, out, tt, (880 + i * 110) * p, 0.035, {
          type: "square",
          vol: o.vol * (0.2 - i * 0.012),
          decay: 0.03,
        }),
      );
    }
    stops.push(
      noise(ctx, out, t, 0.42, {
        type: "bandpass",
        freq: 2600,
        q: 0.8,
        vol: o.vol * 0.16,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

const diceLand: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      noise(ctx, out, t, 0.1, { type: "lowpass", freq: 320, vol: o.vol * 0.55 }),
    );
    stops.push(
      tone(ctx, out, t, 135 * p, 0.14, {
        type: "sine",
        vol: o.vol * 0.5,
        slideTo: 52 * p,
        slideTime: 0.1,
        decay: 0.12,
      }),
    );
    stops.push(
      tone(ctx, out, t + 0.005, 210 * p, 0.06, { type: "triangle", vol: o.vol * 0.2, decay: 0.05 }),
    );
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Coins & stars                                                      */
/* ------------------------------------------------------------------ */

const coinGain: SfxDef = {
  build: (ctx, out, t, o) => {
    const p = semitone(o.pitch);
    return kaching(ctx, out, t, 1318.5 * p, o.vol);
  },
};

const coinLose: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 987.8 * p, 0.18, {
        type: "sine",
        vol: o.vol * 0.45,
        decay: 0.12,
        partials: [{ mult: 2, amp: 0.25 }],
      }),
    );
    stops.push(
      tone(ctx, out, t + 0.12, 659.3 * p, 0.3, {
        type: "sine",
        vol: o.vol * 0.4,
        decay: 0.22,
        partials: [{ mult: 2, amp: 0.2 }],
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

const starGet: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    const notes: Array<[number, number]> = [523.25, 659.25, 784, 1046.5, 1318.5].map((f) => [f * p, 0.3]);
    stops.push(
      arp(ctx, out, t, notes, {
        type: "sine",
        vol: o.vol * 0.5,
        gap: 0.055,
      }),
    );
    // sparkle shimmer
    stops.push(
      noise(ctx, out, t + 0.05, 0.5, { type: "highpass", freq: 5500, vol: o.vol * 0.14 }),
    );
    // final chord
    const chordAt = t + 0.36;
    for (const f of [523.25, 659.25, 784, 1046.5]) {
      stops.push(
        tone(ctx, out, chordAt, f * p, 0.7, {
          type: "sine",
          vol: o.vol * 0.32,
          decay: 0.4,
          partials: [{ mult: 2, amp: 0.2 }],
        }),
      );
    }
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Movement                                                           */
/* ------------------------------------------------------------------ */

const jump: SfxDef = {
  build: (ctx, out, t, o) => {
    const p = semitone(o.pitch);
    return tone(ctx, out, t, 260 * p, 0.17, {
      type: "sine",
      vol: o.vol * 0.42,
      slideTo: 720 * p,
      slideTime: 0.15,
      decay: 0.14,
      partials: [{ mult: 2, amp: 0.15 }],
    });
  },
};

const hop: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 320 * p, 0.11, {
        type: "sine",
        vol: o.vol * 0.36,
        slideTo: 590 * p,
        slideTime: 0.09,
        decay: 0.09,
      }),
    );
    stops.push(noise(ctx, out, t, 0.05, { type: "highpass", freq: 3000, vol: o.vol * 0.07 }));
    return () => stops.forEach((s) => s());
  },
};

const land: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    stops.push(noise(ctx, out, t, 0.07, { type: "lowpass", freq: 260, vol: o.vol * 0.4 }));
    stops.push(tone(ctx, out, t, 105, 0.06, { type: "sine", vol: o.vol * 0.25, decay: 0.05 }));
    return () => stops.forEach((s) => s());
  },
};

/** Blue landing: soft thud plus a bright two-note coin chirp. */
const landBlue: SfxDef = {
  gap: 120,
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(noise(ctx, out, t, 0.06, { type: "lowpass", freq: 300, vol: o.vol * 0.3 }));
    stops.push(tone(ctx, out, t + 0.02, 1318.5 * p, 0.09, { type: "square", vol: o.vol * 0.09, decay: 0.06 }));
    stops.push(
      tone(ctx, out, t + 0.08, 1975.5 * p, 0.22, {
        type: "sine",
        vol: o.vol * 0.24,
        decay: 0.16,
        partials: [{ mult: 2, amp: 0.18 }],
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

/** Red landing: heavy thud and a sagging wobble. */
const landRed: SfxDef = {
  gap: 120,
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(noise(ctx, out, t, 0.12, { type: "lowpass", freq: 220, vol: o.vol * 0.45 }));
    stops.push(
      tone(ctx, out, t, 240 * p, 0.32, {
        type: "triangle",
        vol: o.vol * 0.3,
        slideTo: 120 * p,
        slideTime: 0.28,
        decay: 0.24,
        vibRate: 9,
        vibDepth: 40,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

/** Green landing: light thud and a rising sparkle arpeggio. */
const landGreen: SfxDef = {
  gap: 120,
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(noise(ctx, out, t, 0.05, { type: "lowpass", freq: 320, vol: o.vol * 0.25 }));
    const notes: Array<[number, number]> = [1046.5, 1318.5, 1568, 2093].map((f) => [f * p, 0.14]);
    stops.push(arp(ctx, out, t + 0.03, notes, { type: "sine", vol: o.vol * 0.2, gap: 0.04 }));
    stops.push(noise(ctx, out, t + 0.05, 0.25, { type: "highpass", freq: 6000, vol: o.vol * 0.08 }));
    return () => stops.forEach((s) => s());
  },
};

const boing: SfxDef = {
  build: (ctx, out, t, o) => {
    const p = semitone(o.pitch);
    const stops: StopFn[] = [];
    stops.push(
      tone(ctx, out, t, 430 * p, 0.3, {
        type: "sine",
        vol: o.vol * 0.42,
        decay: 0.26,
        vibRate: 11,
        vibDepth: 55,
        partials: [{ mult: 2, amp: 0.1 }],
      }),
    );
    // rubbery pitch dip
    stops.push(
      tone(ctx, out, t, 430 * p, 0.3, {
        type: "sine",
        vol: o.vol * 0.3,
        slideTo: 170 * p,
        slideTime: 0.09,
        decay: 0.26,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

const whoosh: SfxDef = {
  build: (ctx, out, t, o) => {
    return noise(ctx, out, t, 0.32, {
      type: "bandpass",
      freq: 500,
      sweepTo: 4500,
      q: 0.8,
      vol: o.vol * 0.4,
      attack: 0.04,
    });
  },
};

/** Inhale, then a crack — the Grand Prize Balloon popping and catching its breath. */
const balloonGasp: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      noise(ctx, out, t, 0.2, {
        type: "bandpass",
        freq: 380,
        sweepTo: 1700,
        q: 1.5,
        vol: o.vol * 0.32,
        attack: 0.05,
      }),
    );
    stops.push(
      tone(ctx, out, t, 260 * p, 0.16, {
        type: "sine",
        vol: o.vol * 0.2,
        slideTo: 540 * p,
        slideTime: 0.14,
        decay: 0.12,
      }),
    );
    const popAt = t + 0.18;
    stops.push(
      tone(ctx, out, popAt, 640 * p, 0.06, {
        type: "sine",
        vol: o.vol * 0.48,
        slideTo: 120 * p,
        slideTime: 0.04,
        decay: 0.04,
      }),
    );
    stops.push(noise(ctx, out, popAt, 0.07, { type: "highpass", freq: 1600, vol: o.vol * 0.3 }));
    return () => stops.forEach((s) => s());
  },
};

const pop: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 720 * p, 0.05, {
        type: "sine",
        vol: o.vol * 0.4,
        slideTo: 980 * p,
        slideTime: 0.04,
        decay: 0.04,
      }),
    );
    stops.push(noise(ctx, out, t, 0.03, { type: "bandpass", freq: 2400, q: 1.5, vol: o.vol * 0.14 }));
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Emotion / reactions                                                */
/* ------------------------------------------------------------------ */

const sad: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    for (let i = 0; i < 2; i++) {
      const f = (293.7 - i * 26) * p; // D4 -> C4-ish, descending
      stops.push(
        tone(ctx, out, t + i * 0.24, f, 0.32, {
          type: "sawtooth",
          vol: o.vol * 0.3,
          decay: 0.26,
          slideTo: f * 0.93,
          slideTime: 0.2,
          vibRate: 5,
          vibDepth: 10,
        }),
      );
    }
    return () => stops.forEach((s) => s());
  },
};

const cheer: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    for (const [i, f] of [523.25, 659.25, 784].entries()) {
      stops.push(
        tone(ctx, out, t + i * 0.07, f * p, 0.14, {
          type: "square",
          vol: o.vol * 0.3,
          decay: 0.1,
          partials: [{ mult: 2, amp: 0.2 }],
        }),
      );
    }
    return () => stops.forEach((s) => s());
  },
};

const whistle: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 1174.7 * p, 0.15, {
        type: "sine",
        vol: o.vol * 0.42,
        decay: 0.1,
        vibRate: 7,
        vibDepth: 8,
      }),
    );
    stops.push(
      tone(ctx, out, t + 0.14, 1568 * p, 0.4, {
        type: "sine",
        vol: o.vol * 0.42,
        decay: 0.3,
        vibRate: 7,
        vibDepth: 8,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Fanfares & minigame                                                */
/* ------------------------------------------------------------------ */

const fanfareWin: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    const notes: Array<[number, number]> = [523.25, 659.25, 784, 1046.5, 1318.5, 1568, 2093].map((f) => [f * p, 0.4]);
    stops.push(
      arp(ctx, out, t, notes, {
        type: "sawtooth",
        vol: o.vol * 0.3,
        gap: 0.1,
      }),
    );
    const chordAt = t + 0.78;
    for (const f of [523.25, 659.25, 784, 1046.5]) {
      stops.push(
        tone(ctx, out, chordAt, f * p, 1.1, {
          type: "sawtooth",
          vol: o.vol * 0.3,
          decay: 0.7,
          partials: [{ mult: 1.01, amp: 0.6 }],
        }),
      );
      stops.push(
        tone(ctx, out, chordAt, f * p, 1.1, {
          type: "triangle",
          vol: o.vol * 0.25,
          decay: 0.7,
        }),
      );
    }
    return () => stops.forEach((s) => s());
  },
};

const fanfareLose: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 392 * p, 0.34, {
        type: "sawtooth",
        vol: o.vol * 0.32,
        decay: 0.28,
        slideTo: 370 * p,
        slideTime: 0.2,
        vibRate: 5,
        vibDepth: 8,
      }),
    );
    stops.push(
      tone(ctx, out, t + 0.3, 329.6 * p, 0.55, {
        type: "sawtooth",
        vol: o.vol * 0.3,
        decay: 0.45,
        slideTo: 300 * p,
        slideTime: 0.35,
        vibRate: 5,
        vibDepth: 8,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

const minigameGo: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    for (const f of [523.25, 659.25, 784, 1046.5]) {
      stops.push(
        tone(ctx, out, t, f * p, 0.42, {
          type: "sawtooth",
          vol: o.vol * 0.3,
          decay: 0.32,
          partials: [{ mult: 1.012, amp: 0.6 }],
        }),
      );
      stops.push(
        tone(ctx, out, t, f * p, 0.42, { type: "triangle", vol: o.vol * 0.25, decay: 0.32 }),
      );
    }
    stops.push(noise(ctx, out, t, 0.16, { type: "highpass", freq: 2400, vol: o.vol * 0.2 }));
    return () => stops.forEach((s) => s());
  },
};

const minigameCount: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 1250 * p, 0.03, {
        type: "square",
        vol: o.vol * 0.28,
        decay: 0.025,
      }),
    );
    stops.push(noise(ctx, out, t, 0.02, { type: "bandpass", freq: 2500, q: 2, vol: o.vol * 0.12 }));
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Characters & happenings                                            */
/* ------------------------------------------------------------------ */

const grumpusLaugh: SfxDef = {
  gap: 400,
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    const ho = [146.8, 130.8, 116.5]; // D3, C3, Bb2 descending "ho ho ho"
    for (let i = 0; i < 3; i++) {
      stops.push(
        tone(ctx, out, t + i * 0.34, ho[i] * p, 0.36, {
          type: "sawtooth",
          vol: o.vol * 0.4,
          decay: 0.3,
          vibRate: 9,
          vibDepth: 30,
          partials: [{ mult: 1.5, amp: 0.3 }],
        }),
      );
    }
    return () => stops.forEach((s) => s());
  },
};

const happeningMagic: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    const notes: Array<[number, number]> = [880, 1046.5, 1318.5, 1760, 2093].map((f) => [f * p, 0.35]);
    stops.push(
      arp(ctx, out, t, notes, {
        type: "sine",
        vol: o.vol * 0.4,
        gap: 0.045,
      }),
    );
    stops.push(noise(ctx, out, t + 0.03, 0.5, { type: "highpass", freq: 6000, vol: o.vol * 0.12 }));
    return () => stops.forEach((s) => s());
  },
};

const shopBuy: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(kaching(ctx, out, t, 1318.5 * p, o.vol * 0.9));
    stops.push(
      tone(ctx, out, t + 0.18, 760 * p, 0.06, {
        type: "sine",
        vol: o.vol * 0.35,
        slideTo: 1020 * p,
        slideTime: 0.05,
        decay: 0.05,
      }),
    );
    stops.push(noise(ctx, out, t + 0.18, 0.035, { type: "bandpass", freq: 2500, q: 1.5, vol: o.vol * 0.1 }));
    return () => stops.forEach((s) => s());
  },
};

/* ------------------------------------------------------------------ */
/*  Crowd (route: crowd bus)                                           */
/* ------------------------------------------------------------------ */

const crowdCheer: SfxDef = {
  gap: 450,
  route: "crowd",
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    // big swell: noise band moving up through the midrange
    stops.push(
      noise(ctx, out, t, 1.5, {
        type: "bandpass",
        freq: 550,
        sweepTo: 2500,
        q: 0.7,
        vol: o.vol * 0.5,
        attack: 0.28,
      }),
    );
    stops.push(
      noise(ctx, out, t + 0.05, 1.2, {
        type: "lowpass",
        freq: 900,
        vol: o.vol * 0.22,
        attack: 0.3,
      }),
    );
    // sparkle layer on top
    stops.push(
      noise(ctx, out, t + 0.25, 0.9, { type: "highpass", freq: 5200, vol: o.vol * 0.08, attack: 0.15 }),
    );
    return () => stops.forEach((s) => s());
  },
};

const crowdAah: SfxDef = {
  gap: 450,
  route: "crowd",
  build: (ctx, out, t, o) => {
    // soft falling "aaah": lowpassed noise swell that droops
    const stops: StopFn[] = [];
    stops.push(
      noise(ctx, out, t, 0.95, {
        type: "lowpass",
        freq: 1400,
        sweepTo: 600,
        q: 0.6,
        vol: o.vol * 0.34,
        attack: 0.22,
      }),
    );
    stops.push(
      tone(ctx, out, t + 0.15, 440, 0.7, {
        type: "sine",
        vol: o.vol * 0.06,
        decay: 0.55,
        slideTo: 392,
        slideTime: 0.5,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

/** Two voices lean together, then a warm chord — the Carnival Squeeze hug. */
const hug: SfxDef = {
  build: (ctx, out, t, o) => {
    const stops: StopFn[] = [];
    const p = semitone(o.pitch);
    stops.push(
      tone(ctx, out, t, 392 * p, 0.22, {
        type: "sine",
        vol: o.vol * 0.28,
        slideTo: 330 * p,
        slideTime: 0.16,
        decay: 0.16,
      }),
    );
    stops.push(
      tone(ctx, out, t, 262 * p, 0.22, {
        type: "sine",
        vol: o.vol * 0.28,
        slideTo: 330 * p,
        slideTime: 0.16,
        decay: 0.16,
      }),
    );
    for (const freq of [262, 330, 392, 523]) {
      stops.push(
        tone(ctx, out, t + 0.12, freq * p, 0.55, {
          type: "triangle",
          vol: o.vol * 0.16,
          attack: 0.04,
          decay: 0.4,
        }),
      );
    }
    stops.push(
      noise(ctx, out, t + 0.08, 0.45, {
        type: "bandpass",
        freq: 500,
        sweepTo: 900,
        q: 1.1,
        vol: o.vol * 0.12,
        attack: 0.08,
      }),
    );
    return () => stops.forEach((s) => s());
  },
};

const crowdOoh: SfxDef = {
  gap: 300,
  route: "crowd",
  build: (ctx, out, t, o) => {
    // rising "ooh": bandpass swell up then down
    return noise(ctx, out, t, 0.8, {
      type: "bandpass",
      freq: 500,
      sweepTo: 1500,
      q: 1.2,
      vol: o.vol * 0.3,
      attack: 0.18,
    });
  },
};

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const SFX: Record<string, SfxDef> = {
  "ui.click": uiClick,
  "ui.back": uiBack,
  "dice.roll": diceRoll,
  "dice.land": diceLand,
  "coin.gain": coinGain,
  "coin.lose": coinLose,
  "star.get": starGet,
  jump,
  hop,
  land,
  "land.blue": landBlue,
  "land.red": landRed,
  "land.green": landGreen,
  sad,
  cheer,
  boing,
  whoosh,
  pop,
  hug,
  "balloon.gasp": balloonGasp,
  "fanfare.win": fanfareWin,
  "fanfare.lose": fanfareLose,
  "minigame.go": minigameGo,
  "minigame.count": minigameCount,
  "grumpus.laugh": grumpusLaugh,
  "happening.magic": happeningMagic,
  "shop.buy": shopBuy,
  whistle,
  "crowd.cheer": crowdCheer,
  "crowd.aah": crowdAah,
  "crowd.ooh": crowdOoh,
};

export const SFX_ORDER = Object.keys(SFX);

export function sfxIds(): string[] {
  return SFX_ORDER;
}
