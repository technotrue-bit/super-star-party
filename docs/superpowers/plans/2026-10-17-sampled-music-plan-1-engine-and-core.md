# Sampled Music, Plan 1: Engine and Core Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oscillator instruments of every played track with recorded samples (the `core` set), on an engine that later plans add board and minigame themes to.

**Architecture:** A pure `StepClock` takes over the sequencer's timing, adding bar-line tempo, transpose and lift changes, fills, pickups and an anchor. A sampler `NotePlayer` plays generated instrument tables, and falls back per note to the old synth voices. A loader fetches and decodes sample sets lazily. A director resolves `board`/`minigame_*` to themes. An offline Node pipeline turns pinned CC0 libraries into small Opus and AAC files under `public/music/`.

**Tech Stack:** TypeScript (strict), Vite 7, Web Audio, vitest 3.2.4 (node), Playwright (local checks), ffmpeg 6.1 (libopus, aac), git.

**Spec:** `docs/superpowers/specs/2026-10-17-sampled-music-design.md`. Read it first. This plan covers its build-order steps 1 and 2. Plan 2 covers the board themes and Plan 3 the minigame themes and the Drum Solo anchor (see the end).

## Global Constraints

- Allowed sample licenses: CC0-1.0, Unlicense, CC-BY-3.0. Plan 1 sources: VCSL, VSCO-2 CE, Virtuosity Drums, FreePats Bass Guitar YR (all CC0 1.0). No other sources, no fallbacks.
- Lossless upstream only; never the smpldsnds mirrors.
- Encodes: Opus in WebM, mono, 64 kbps; AAC-LC in M4A, mono, 80 kbps; 48 kHz; `-fflags +bitexact -map_metadata -1`.
- Roots every 3 semitones over the range tracks use (voice transposes and the lift's +1 included), so no note shifts more than 1.5 semitones (`maxShift` 1.5). Missing roots are derived offline from the nearest recorded note above with `aresample=resampler=soxr`.
- Max sample length: percussive and plucked 1.2 s, sustained 2.5 s. Velocity layers: 1, or 2 for piano and kits. Snare and hats: 2 round robins.
- Decoded caps: 24 MB per set, 44 MB for core + any board set and for core + any minigame set (frames x 4 bytes at 48 kHz). Download target (Opus): core about 1.5 MB, warn above 1.875 MB.
- `src/audio/**` never imports `core/rng`. Loading never blocks or delays the game. Problems use `console.warn`, never `console.error`.
- `director.ts`, `loader.ts`, `sampler.ts`, `clock.ts` are import-safe in node: no `window`, `location`, `document`, `fetch`, `localStorage` or `AudioContext` at module scope.
- `audio.music.track()` returns the requested id; `audio.music.theme()` returns the resolved one.
- Unit tests run in node under CI's Node 20.19: no `node:` imports and no `@types/node`; read files with `import.meta.glob`. `tools/samples/build.mjs` runs locally only (Node ≥ 22.6, `--experimental-strip-types`).
- Commits end with the session's attribution lines.

## Review Focus

1. **Music starts before `core` finishes loading.** It must play at once on stand-ins and switch to samples note by note, never waiting (Task 4 test `missing buffer resolves to the stand-in`; Task 9 probe with delayed `/music/` responses).
2. **The tab is hidden or a frame stalls for seconds.** There must be no burst of backlogged notes when it comes back (Task 2 test `no backlog after a 2 s gap`).
3. **Fast track changes before a set loads** (title, then board, then shop). Each file must be fetched once and nothing doubles (Task 5 test `concurrent load fetches each file once`).
4. **A sample file is missing on the server (404).** One warning, the stand-in, one retry the next time the set is requested, and no `console.error` (Task 5 test `failed file retried once then stand-in`; Task 9 probe with one routed 404).
5. **`?audio=0`.** No requests to `music/` at all, and `state().audio` still has every field (Task 9 probe `audio=0 makes no music requests`).

---

### Task 1: Branch base and track definitions

**Files:**
- Modify: `src/audio/music/tracks.ts` (types near lines 19-56, `parseTrack` lines 128-170, module-load validation line 1014)
- Create: `src/audio/music/tracks.test.ts`

**Interfaces:**
- Produces:
  - `type Layer = "base" | "perc2" | "counter" | "bright" | "lift"`
  - `TrackDef` gains `sets?: string[]; fill?: VoiceDef[]; pickup?: VoiceDef[]`
  - `trackSets(def: TrackDef): string[]`
  - `parseSection(def: TrackDef, which: "fill" | "pickup"): ParsedVoice[]` (every voice exactly 1 bar; `[]` when absent)

- [ ] **Step 1: Base the branch on the volume/pitch fixes**

Run: `git switch feat/sampled-music && git merge --no-edit origin/fix/audio-volume-pitch && npx vitest run`
Expected: merge succeeds; all test files pass, including `src/audio/audioEngine.test.ts` (8 tests).

- [ ] **Step 2: Write the failing tests** in `src/audio/music/tracks.test.ts`

```ts
it("every registered track parses", () => {
  for (const id of trackIds()) expect(() => parseTrack(TRACKS[id])).not.toThrow();
});
it("rejects a bar that does not sum to 16 steps", () => {
  expect(() => parseBar("C4:4 D4:4", 0)).toThrow(/sums to 8/);
});
it("trackSets defaults to core", () => {
  expect(trackSets(def({}))).toEqual(["core"]);
  expect(trackSets(def({ sets: ["core", "cruise"] }))).toEqual(["core", "cruise"]);
});
it("fill and pickup parse as one-bar sections outside voices", () => {
  const d = def({ fill: [{ style: "drums", pattern: ["K:4 S:4 K:4 S:4"] }] }); // voices have 2 bars
  expect(parseSection(d, "fill")).toHaveLength(1);
  expect(parseSection(d, "fill")[0].barCount).toBe(1);
  expect(parseSection(d, "pickup")).toEqual([]);
  expect(() => parseTrack(d)).not.toThrow();
  expect(() => parseSection(def({ fill: [{ style: "drums", pattern: ["K:16", "K:16"] }] }), "fill")).toThrow(/one bar/);
});
it("lift is a valid layer", () => {
  expect(parseTrack(def({ liftVoice: true })).some((v) => v.layer === "lift")).toBe(true);
});
```

`def(over)` is a local helper building a 2-bar, 120 BPM track with one `drums` voice. With `liftVoice` it adds a voice with `layer: "lift"`.

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/audio/music/tracks.test.ts`
Expected: FAIL, `trackSets` / `parseSection` are not exported.

- [ ] **Step 4: Implement the types, `trackSets` and `parseSection`**

Extract `parseTrack`'s per-voice loop into a local `parseVoices(defId, voices)`, and have `parseTrack` and `parseSection` share it. `parseSection` throws `track <id>: <which> must be one bar` when a voice has a bar count other than 1. The module-load validation loop also calls `parseSection(def, "fill")` and `parseSection(def, "pickup")`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/audio/music/tracks.ts src/audio/music/tracks.test.ts
git commit -m "Music: track sets, fill and pickup sections, lift layer"
```

### Task 2: StepClock

**Files:**
- Create: `src/audio/music/clock.ts`, `src/audio/music/clock.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PlannedStep { step: number; bar: number; t: number; stepDur: number; swingOffset: number; transpose: number; lift: boolean; fill: boolean; pickup: boolean }
export interface ClockChange { bpm?: number; transpose?: number; lift?: boolean; fill?: boolean }
export interface ClockAnchor { beat0: number; barSec: number; speed: number; gameNow: () => number; audioNow: () => number }
export interface StepClockOpts { bpm: number; swing: number; totalSteps: number; loop: boolean; t0: number; transpose?: number; lift?: boolean; hasFill?: boolean; pickupStartStep?: number }
export class StepClock {
  constructor(o: StepClockOpts);
  queueChange(c: ClockChange): void;
  setAnchor(a: ClockAnchor | null): void;
  plan(now: number, lookahead?: number): PlannedStep[]; // lookahead defaults to 0.12
  get ended(): boolean; get bpm(): number; get transpose(): number; get lift(): boolean;
  barTimes(): number[]; // last 8 main bar-line times, oldest first
}
```

Rules the tests pin:
- `stepDur = 60 / bpm / 4`; `swingOffset = (swing - 0.5) * 2 * stepDur`. `t` is the unswung grid time, and `scheduleStep` adds the swing for odd steps as today.
- `plan(now)` returns, in order and exactly once, every step with `t < now + lookahead`.
- A queued change applies at the first main bar line (`step % 16 === 0`) not yet returned.
- With `fill: true` and `hasFill`, that bar's steps carry `fill: true` at the old tempo, transpose and lift, and the change applies at the following bar line. The bar counter keeps advancing during the fill.
- `pickupStartStep = s` plays steps `s..15` of one pickup bar first (`pickup: true`, `bar: -1`), then main step 0.
- If `now` is more than 0.5 s past the previous `plan()` call, the next step is re-gridded to `now + 0.03`, with no backlog.
- When an anchor is set, before each main bar line `k` (counted from the first main bar), compute `target = audioNow() + (beat0 + k * barSec - gameNow()) / speed`. If it differs from the planned time by more than 0.005 s, the bar starts at `target`.

- [ ] **Step 1: Write the failing tests** in `src/audio/music/clock.test.ts`

Use a helper `collect(clock, from, to, dt = 0.025)` that calls `plan(now)` for each `now` and concatenates the steps. All clocks use `bpm: 120` (so a step is 0.125 s and a bar 2.0 s), `swing: 0.5` and `t0: 0` unless stated.

```ts
it("plans contiguous steps across a loop wrap", ...)      // totalSteps 32, loop: steps go 0..31,0..; each t = prev.t + 0.125; no duplicates
it("a non-looping clock ends after its last step", ...)   // totalSteps 16, loop false: exactly 16 steps, ended === true
it("tempo change lands on the first unplanned bar line", ...) // queue {bpm: 127.2} at now 1.30: steps t < 2.0 have stepDur 0.125; step at t 2.0 has stepDur 60/127.2/4
it("a change queued inside the lookahead waits a bar", ...)   // plan(1.95) first (bar line 2.0 already planned), then queue: change lands at the bar line after 2.0
it("fill plays one bar, then the change", ...)            // hasFill; queue {bpm:127.2, transpose:1, lift:true, fill:true} at 1.30: steps 16-31 fill true, transpose 0, lift false, stepDur 0.125; step 32 at t 4.0: fill false, transpose 1, lift true, stepDur 60/127.2/4
it("fill without a theme fill applies the change at once", ...) // hasFill false: change at t 2.0
it("no backlog after a 2 s gap", ...)                      // plan(1.0) then plan(3.5): every returned t >= 3.53 - 1e-9
it("pickup starts mid-bar so bar 0 lands on beat0", ...)   // pickupStartStep 8: 8 steps with pickup true, t 0..0.875; first main step t 1.0, bar 0
it("anchored bar lines follow the game clock after a stall", ...) // for speed of [1, 1.5, 2]: clock bpm 120*speed, pickupStartStep 8 at t0 0; gameNow = speed*(a) for a < 3, speed*(a - 0.2) for a >= 3, where a = audioNow(); anchor {beat0: 1.0, barSec: 2.0, speed}; every main bar line k satisfies |t - a_k| <= 0.005, where a_k = (1.0 + 2k)/speed, plus 0.2 once that is >= 3
it("barTimes keeps the last 8 bar lines", ...)
```

Write each test body to assert exactly the comment's values.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/audio/music/clock.test.ts`
Expected: FAIL, `StepClock` is not defined.

- [ ] **Step 3: Implement `StepClock`** in `src/audio/music/clock.ts` (pure: no imports from Web Audio, no timers).

- [ ] **Step 4: Run them**

Run: `npx vitest run src/audio/music/clock.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/music/clock.ts src/audio/music/clock.test.ts
git commit -m "Music: pure StepClock with bar-line changes, fills, pickups and anchor"
```

### Task 3: Sequencer on StepClock, lift layer, note routing

**Files:**
- Modify: `src/audio/music/sequencer.ts` (all of it: `scheduleStep`, `scheduleTrackInto`, `Sequencer`)
- Create: `src/audio/music/player.ts`, `src/audio/music/player.test.ts`

**Interfaces:**
- Consumes: `StepClock`, `PlannedStep`, `ClockChange` (Task 2); `parseSection`, `trackSets` (Task 1).
- Produces:

```ts
// player.ts
export interface NotePlayer {
  note(ctx: BaseAudioContext, out: AudioNode, t: number, style: string, freqs: number[], lenSec: number, vel: number, opts: VoiceOpts): void;
  drum(ctx: BaseAudioContext, out: AudioNode, t: number, style: string, token: string, vel: number): void;
}
export const synthPlayer: NotePlayer;            // VOICES[style] / drumHit, exactly today's behaviour
export function voiceRoute(style: string): "sampled" | "kit" | "synth"; // "s:kit.*" -> kit, other "s:*" -> sampled, else synth
// sequencer.ts
export type LayerName = "base" | "perc2" | "counter" | "bright" | "lift";
export function scheduleStep(ctx: BaseAudioContext, voices: ParsedVoice[], sections: { fill: ParsedVoice[]; pickup: ParsedVoice[] }, ps: PlannedStep, layers: LayerBus, player: NotePlayer): void;
export function scheduleTrackInto(ctx: BaseAudioContext, trackId: string, out: AudioNode, seconds: number, opts?: { lift?: boolean; player?: NotePlayer }): TrackDef;
export interface SequencerOpts { player?: NotePlayer; transpose?: number; lift?: boolean; bpm?: number }
export class Sequencer { constructor(ctx: AudioContext, out: GainNode, def: TrackDef, opts?: SequencerOpts); queueChange(c: ClockChange): void; get clock(): StepClock; /* start, stop, setIntensity, onEnded, trackId as today */ }
```

Behaviour:
- `scheduleStep` takes events from `pickup` bar 0 when `ps.pickup`, otherwise from main bar `ps.bar % barCount`. When `ps.fill`, drum voices (style `drums` or `s:kit.*`) take their events from `fill` instead. Note frequencies are transposed by `voice.transpose + ps.transpose` semitones. Drum events go to `player.drum(…, voice.style, token, vel)` and notes to `player.note(…, voice.style, …)`.
- `lift` gets a `LayerBus` gain that `layerTargets()` and `setIntensity()` never touch. When `ps.lift` differs from the previous step, set the gain with `setValueAtTime(ps.lift ? 1 : 0.0001, ps.t)`.
- `Sequencer.tick()` becomes `for (const ps of clock.plan(ctx.currentTime)) scheduleStep(...)`, then `finish()` when `clock.ended`. Remove the old resync code (now in `StepClock`).
- `scheduleTrackInto` drives a `StepClock` from 0 to `seconds`. Layer gains are 1 except `lift`, which is 1 only with `opts.lift`.

- [ ] **Step 1: Write the failing test** in `src/audio/music/player.test.ts`

```ts
it("routes styles", () => {
  expect(voiceRoute("s:marimba")).toBe("sampled");
  expect(voiceRoute("s:kit.core")).toBe("kit");
  expect(voiceRoute("pad")).toBe("synth");
  expect(voiceRoute("drums")).toBe("synth");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/audio/music/player.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `player.ts` and rework `sequencer.ts`** to the interfaces above. `audioEngine.ts` keeps compiling: pass no options, so `synthPlayer` is used.

- [ ] **Step 4: Verify nothing changed audibly**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all PASS.

Then, with `npm run dev` running in another shell: `node tools/render-music.mjs title shop`.
Expected: `tools/music/title.wav` and `shop.wav` written, non-silent, same length as before the change.

- [ ] **Step 5: Commit**

```bash
git add src/audio/music/sequencer.ts src/audio/music/player.ts src/audio/music/player.test.ts
git commit -m "Music: sequencer runs on StepClock; lift layer; pluggable note player"
```

### Task 4: Sampler

**Files:**
- Create: `src/audio/samples/types.ts`, `src/audio/samples/sampler.ts`, `src/audio/samples/sampler.test.ts`
- Create (placeholders, overwritten by Task 7): `src/audio/samples/instruments.gen.ts` (`export const SAMPLED: Record<string, SampledInstrument> = {};`), `src/audio/samples/zones.gen.ts` (`export const ZONES: Record<string, InstrumentZones> = {};`)

**Interfaces:**
- Consumes: `NotePlayer`, `synthPlayer` (Task 3); `VOICES`, `drumHit` (`instruments.ts`).
- Produces:

```ts
// types.ts
export type SetId = "core" | "fairground" | "cruise" | "downtown" | "mg-action" | "mg-puzzle" | "mg-rhythm";
export interface SampledInstrument { set: SetId; kind: "melodic" | "kit"; standIn: string; oneShot: boolean; release: number; gain: number; velUpper: number[]; maxShift: number; maxLen: number }
export interface Zone { root?: number; token?: string; layer: number; rr: number; tune: number; frames: number; file: string }
export interface InstrumentZones { source: string; zones: Zone[] }
export interface LoadedBuffer { buffer: AudioBuffer; start: number }
// sampler.ts
export function midiFromHz(hz: number): number;                        // Math.round(69 + 12 * log2(hz / 440))
export function layerFor(velUpper: number[], vel: number): number;     // first index with vel <= bound; last index if above all
export function pickZone(zones: Zone[], midi: number, layer: number, rrCounter: number): Zone | null; // nearest root; tie -> higher root; rr = counter % alternates
export function pickKitZone(zones: Zone[], token: string, layer: number, rrCounter: number): Zone | null;
export function rateFor(midi: number, zone: Zone): number;             // 2 ** ((midi - zone.root + zone.tune / 100) / 12)
export type Resolved = { kind: "sample"; instrument: string; zone: Zone; buf: LoadedBuffer } | { kind: "standIn"; standIn: string };
export function resolveNote(table: Record<string, SampledInstrument>, zones: Record<string, InstrumentZones>, style: string, midi: number, vel: number, rr: number, buffer: (inst: string, z: Zone) => LoadedBuffer | null): Resolved;
export function createSamplerPlayer(deps: { table: Record<string, SampledInstrument>; zones: () => Record<string, InstrumentZones>; buffer: (inst: string, z: Zone) => LoadedBuffer | null; onStandIn: () => void }): NotePlayer;
```

Player behaviour:
- `synth` routes go to `synthPlayer`. Sampled notes call `resolveNote` per frequency; a `standIn` result plays `VOICES[standIn]`, or `drumHit` for kits, and calls `onStandIn()`.
- A sample plays as an `AudioBufferSourceNode` from `buf.start` at `playbackRate = rateFor(...)`, through a gain of `instrument.gain * vel`.
- `oneShot` instruments play to `min(buffer length, maxLen)` whatever `lenSec` is. Sustained ones hold for `lenSec`, then fade over `release`.
- With `opts.slide`, `playbackRate` ramps exponentially to `rate * 2 ** (slide / 12)` by `t + lenSec`.
- Round robins use a counter per instrument.

- [ ] **Step 1: Write the failing tests** in `src/audio/samples/sampler.test.ts`

The fixture table has a melodic `piano` (`standIn: "pad"`, `velUpper: [0.6, 1]`, roots 57, 60, 63 on both layers) and a kit `kit.core` (tokens K, S with rr 0/1). The buffer function returns a stub `{ buffer: {} as AudioBuffer, start: 0 }`, or `null` for the missing case.

```ts
it("midiFromHz", () => { expect(midiFromHz(440)).toBe(69); expect(midiFromHz(261.6256)).toBe(60); });
it("layerFor", () => { expect(layerFor([0.6, 1], 0.5)).toBe(0); expect(layerFor([0.6, 1], 0.6)).toBe(0); expect(layerFor([0.6, 1], 0.75)).toBe(1); expect(layerFor([1], 0.2)).toBe(0); expect(layerFor([0.6, 1], 1.4)).toBe(1); });
it("pickZone takes the nearest root, higher on a tie", () => { expect(pickZone(zones57_60_63, 61, 0, 0)?.root).toBe(60); expect(pickZone(zones60_62, 61, 0, 0)?.root).toBe(62); });
it("pickZone cycles round robins", ...)  // two rr zones at root 60: counters 0, 1, 2 give rr 0, 1, 0
it("pickZone only uses the requested layer", ...)
it("pickKitZone by token", ...)          // token S, counters 0 and 1 give rr 0 then 1; unknown token gives null
it("rateFor applies tune", () => { expect(rateFor(64, { root: 63, tune: 0 } as Zone)).toBeCloseTo(2 ** (1 / 12)); expect(rateFor(64, { root: 63, tune: 50 } as Zone)).toBeCloseTo(2 ** (1.5 / 12)); });
it("missing buffer resolves to the stand-in", () => { expect(resolveNote(table, zones, "s:piano", 60, 0.8, 0, () => null)).toEqual({ kind: "standIn", standIn: "pad" }); });
it("unknown instrument resolves to the stand-in of nothing", ...) // "s:nope" gives { kind: "standIn", standIn: "" }; the player then plays nothing
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/audio/samples/sampler.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `types.ts`, `sampler.ts` and the two placeholder `.gen.ts` files.**

- [ ] **Step 4: Run them**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/samples
git commit -m "Music: sampler maths and note player with per-note synth stand-ins"
```

### Task 5: Loader

**Files:**
- Create: `src/audio/samples/loader.ts`, `src/audio/samples/loader.test.ts`
- Create: `src/audio/samples/probeClips.ts` (`export const PROBE_OPUS: string` and `PROBE_AAC: string`, base64 of 0.05 s of silence)

**Interfaces:**
- Consumes: `SetId`, `Zone`, `InstrumentZones`, `SampledInstrument`, `LoadedBuffer` (Task 4).
- Produces:

```ts
export type SetStatus = "idle" | "loading" | "ready" | "failed";
export type Format = "opus" | "aac" | "synth" | "off";
export interface LoaderDeps {
  fetchBytes(url: string): Promise<ArrayBuffer>;
  decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer>;
  zones(): Promise<Record<string, InstrumentZones>>;   // engine passes () => import("./zones.gen").then(m => m.ZONES)
  table: Record<string, SampledInstrument>;
  baseUrl: string;                                      // import.meta.env.BASE_URL
  warn(msg: string): void;
}
export function detectStart(samples: Float32Array, sampleRate: number, thresholdDb?: number): number; // seconds; default -50 dB; 0 if silent
export class SampleLoader {
  constructor(deps: LoaderDeps);
  chooseFormat(ctx: BaseAudioContext, probes: { opus: ArrayBuffer; aac: ArrayBuffer }, force?: "aac" | "synth"): Promise<Format>;
  get format(): Format;
  load(set: SetId, ctx: BaseAudioContext): Promise<void>;   // never rejects; concurrent calls share one in-flight load
  releaseDecoded(set: SetId): void;
  free(set: SetId): void;
  status(set: SetId): SetStatus;   // "failed" once any file in the set failed twice
  failed(): string[];              // instruments on stand-in for the session
  buffer(instrument: string, zone: Zone): LoadedBuffer | null;
}
```

URLs are `${baseUrl}music/${zone.file}.webm` (opus) or `.m4a` (aac). Under `synth` or `off`, `load` does nothing.

- [ ] **Step 1: Make the probe clips**

Run: `ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 0.05 -c:a libopus -b:a 24k -fflags +bitexact /tmp/p.webm && ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 0.05 -c:a aac -b:a 32k -fflags +bitexact /tmp/p.m4a`, then write their base64 into `probeClips.ts`. The two strings together are under 4 KB.

- [ ] **Step 2: Write the failing tests** in `src/audio/samples/loader.test.ts`

Fakes:
- `fetchBytes` counts calls per URL and can fail chosen URLs (as a 404 would).
- `decode` returns `{ sampleRate: 48000, length, duration, getChannelData: () => data }` and fails for bytes marked bad.
- The fixture set `core` has instrument `piano` with 3 zones.

```ts
it("chooses opus when the opus probe decodes", ...)
it("falls back to aac when opus fails", ...)
it("uses synth when both probes fail, with one warning", ...)
it("force aac skips the opus probe; force synth skips both", ...)
it("concurrent load fetches each file once", ...)          // two load("core") at once: 3 fetches; status loading, then ready
it("urls use the chosen format", ...)                       // music/core/piano/60.abc.webm, or .m4a under aac
it("failed file retried once then stand-in", ...)          // a file 404s: after load 1, failed() is [] and buffer() is null; after load 2 (one more fetch), failed() is ["piano"] and status "failed"; load 3 makes no fetch
it("releaseDecoded keeps bytes; load re-decodes without fetching", ...)
it("free drops bytes; load fetches again", ...)
it("load never rejects when zones() throws", ...)           // status "failed", one warn
it("detectStart finds the first sample above -50 dBFS", () => { /* 0.01 at index 480 @48k -> 0.01; same @44100 index 441 -> 0.01; all zeros -> 0 */ });
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/audio/samples/loader.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `loader.ts`.** It decodes each file once and stores `start = detectStart(buffer.getChannelData(0), buffer.sampleRate)`.

- [ ] **Step 5: Run them**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/samples/loader.ts src/audio/samples/loader.test.ts src/audio/samples/probeClips.ts
git commit -m "Music: sample loader with format probe, retry-once and set release"
```

### Task 6: Director and engine wiring

**Files:**
- Create: `src/audio/music/director.ts`, `src/audio/music/director.test.ts`
- Modify: `src/audio/audioEngine.ts` (`startTrack`, `music.play`, `music.stinger`, `music.track`, `music.tracks`, `renderTrack`, `ensureContext`/`unlock`), `src/core/debug.ts` (state `audio` block, about line 486; add `audioBars()` next to `audioLevels()`, about line 548), `src/audio/audioEngine.test.ts`

**Interfaces:**
- Consumes: `Sequencer`, `SequencerOpts`, `ClockChange` (Task 3); `createSamplerPlayer` (Task 4); `SampleLoader`, `Format`, `SetStatus` (Task 5); `SAMPLED` and the dynamic `zones.gen` import; `PROBE_OPUS`/`PROBE_AAC`; `trackSets` (Task 1).
- Produces:

```ts
// director.ts
export function resolveTheme(id: string, ctx: { board?: string; genre?: string }): string;
export const THEME_FALLBACK: Record<string, string>; // Plan 1 interim: { "board.cruise": "board.fairground", "board.downtown": "board.fairground", "mg.rhythm": "mg.puzzle" }
export function playableId(theme: string, tracks: Record<string, unknown>): string | null; // theme, else its fallback, else null
export function boardSet(boardId: string): SetId | null;       // fizzy-fairground -> fairground, cruise-ship -> cruise, downtown -> downtown
export interface SequencerControl { readonly theme: string | null; readonly baseBpm: number; queueChange(c: ClockChange): void }
export class Director {
  constructor(seq: () => SequencerControl | null);
  setBoard(id: string): void; get board(): string | undefined;
  lift(on: boolean): void; get lifted(): boolean;
  startOptions(theme: string, baseBpm: number): { bpm: number; transpose: number; lift: boolean }; // lifted board themes start lifted, no fill
}
// audioEngine additions
audio.music.play(track: string, opts?: { intensity?: number; genre?: string; music?: { bpm: number; beat0: number } }): void; // `music` is accepted and ignored until Plan 3
audio.music.theme(): string;
audio.music.lift(on: boolean): void;
audio.music.setBoard(id: string): void;
audio.music.tracks(): string[];          // trackIds() plus "board", "minigame_a", "minigame_b"
audio.renderTrack(track: string, seconds?: number, opts?: { lift?: boolean; board?: string; genre?: string }): Promise<Blob>;
audio.debug(): { theme: string; lift: boolean; bpm: number; transpose: number; samples: { format: Format; sets: Record<string, SetStatus>; failed: string[]; standInNotes: number }; anchor: null; bars: { audioNow: number; bars: number[] } };
```

Behaviour:
- **Director rules:**
  - Genres survival, race, timing, target, collect -> `mg.action`; puzzle, memory -> `mg.puzzle`; rhythm -> `mg.rhythm`. No genre: `minigame_a` -> `mg.action`, `minigame_b` -> `mg.puzzle`. Unknown or unset board -> `board.fairground`.
  - A theme counts as a board theme when its id starts with `board.`.
  - `lift(true)` while a board theme plays queues `{ bpm: base * 1.06, transpose: 1, lift: true, fill: true }`; `lift(false)` queues `{ bpm: base, transpose: 0, lift: false }`. Repeated calls with the same state do nothing.
- **Engine:**
  - `play` resolves through `resolveTheme` then `playableId` before the `TRACKS` lookup, and passes `startOptions` and the sampler player to `new Sequencer`. It also calls `loader.load` for every set in `trackSets(def)`, without awaiting.
  - `stinger` resolves the same way and never lifts.
  - `ensureContext` creates the loader (`fetchBytes` uses `fetch`, `decode` uses `ctx.decodeAudioData`, `warn` uses `console.warn`). `unlock` runs `chooseFormat` (`?samples=0` forces synth, `?audiofmt=aac` forces aac), then `load("core")`.
  - `setBoard` loads `boardSet(id)` and frees the previous board's set. Under `?audio=0` none of this runs and `debug()` returns defaults (`format: "off"`).
  - `renderTrack` resolves through the director, loads the track's sets into the offline context, and renders `lift` only with `opts.lift`. It creates its own loader on demand (format chosen by probing the offline context), so it works even under `?audio=0`. `tools/render-music.mjs` itself opens `?audio=1`.
- **Debug:** `state().audio` spreads `audio.debug()` minus `bars` into its existing fields; `__SSP__.audioBars()` returns `audio.debug().bars`.

- [ ] **Step 1: Write the failing tests**

`src/audio/music/director.test.ts`:

```ts
it.each([["fizzy-fairground", "board.fairground"], ["cruise-ship", "board.cruise"], ["downtown", "board.downtown"], ["nope", "board.fairground"], [undefined, "board.fairground"]])("board %s -> %s", (b, t) => expect(resolveTheme("board", { board: b })).toBe(t));
it.each([["survival", "mg.action"], ["race", "mg.action"], ["timing", "mg.action"], ["target", "mg.action"], ["collect", "mg.action"], ["puzzle", "mg.puzzle"], ["memory", "mg.puzzle"], ["rhythm", "mg.rhythm"]])("genre %s -> %s", (g, t) => { expect(resolveTheme("minigame_a", { genre: g })).toBe(t); expect(resolveTheme("minigame_b", { genre: g })).toBe(t); });
it("no genre falls back by alias", () => { expect(resolveTheme("minigame_a", {})).toBe("mg.action"); expect(resolveTheme("minigame_b", {})).toBe("mg.puzzle"); });
it("other ids pass through", () => { expect(resolveTheme("title", {})).toBe("title"); expect(resolveTheme("board.cruise", {})).toBe("board.cruise"); });
it("playableId uses the interim fallback", () => { expect(playableId("board.cruise", { "board.fairground": 1 })).toBe("board.fairground"); expect(playableId("nope", {})).toBeNull(); });
it("lift is idempotent and queues fill then change", ...)    // fake seq theme "board.fairground", baseBpm 132: lift(true) twice gives one queueChange({ bpm: 132*1.06, transpose: 1, lift: true, fill: true })
it("lift off queues the change without fill", ...)
it("lift during a non-board theme waits; the board theme starts lifted", ...) // seq theme "mg.action": no queueChange; startOptions("board.fairground", 132) gives { bpm: 139.92, transpose: 1, lift: true }
```

Append to `src/audio/audioEngine.test.ts`:

```ts
it("tracks() lists real ids plus the aliases", () => { expect(audio.music.tracks()).toEqual(expect.arrayContaining(["board", "minigame_a", "minigame_b", "title"])); });
it("debug() has defaults without an AudioContext", () => { expect(audio.debug().samples.format).toBe("off"); expect(audio.debug().anchor).toBeNull(); });
it("no file under src/audio imports core/rng", () => { /* import.meta.glob("../audio/**/*.ts", { query: "?raw", import: "default", eager: true }); no source matches /from\s+["'][./]*core\/rng["']/ */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/audio`
Expected: FAIL (`director.ts` missing; `debug` not a function).

- [ ] **Step 3: Implement `director.ts` and the engine and debug changes.**

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: PASS. The game still plays every track: with no samples yet every note uses its stand-in, which matches today's sound.

- [ ] **Step 5: Commit**

```bash
git add src/audio src/core/debug.ts
git commit -m "Music: director, lift API, loader and sampler wired into the engine; audio debug state"
```

### Task 7: Sample pipeline and the core set

**Files:**
- Create: `tools/samples/sources.json`, `tools/samples/instruments.json`, `tools/samples/build.mjs`, `tools/samples/build-state.json` (generated: per-zone input hashes)
- Generated and committed: `src/audio/samples/instruments.gen.ts`, `src/audio/samples/zones.gen.ts`, `public/music/core/**`, `public/music/CREDITS.txt`
- Modify: `.gitignore` (add `tools/samples/.cache/` and `tools/samples/.venv/`), `tsconfig.json` (`exclude` those two paths)
- Create: `src/audio/samples/tables.test.ts`

**Interfaces:**
- Consumes: the types in `types.ts` (Task 4); `TRACKS`, `parseTrack`, `parseSection`, `trackSets` (via `--ranges`).
- Produces: `SAMPLED` and `ZONES` entries for `kit.core`, `bass`, `piano`, `trumpet`, `trombone`, `glock`, all with `set: "core"`; files at `public/music/core/<instrument>/<root|token>[-v<layer>][-r<rr>].<hash8>.webm|.m4a`.

`sources.json` entries (spec schema): `{ id, kind: "git" | "archive", url, commit | sha256, sparse: string[], license, licenseFileSha256, title, author, creditLine }`. Plan 1 entries:
- `vcsl`: `https://github.com/sgossner/VCSL`, sparse = the glockenspiel folder.
- `vsco2ce`: `https://github.com/sgossner/VSCO-2-CE`, sparse = trumpet, tenor trombone, upright piano.
- `virtuosity`: `https://github.com/sfzinstruments/virtuosity_drums`, sparse = one mic position of the kit.
- `freepats-bass-yr`: archive, the SFZ+FLAC Bass Guitar YR archive from freepats.zenvoid.org.

Pin each git source to the commit `git ls-remote <url> HEAD` returns at the first build. Record each LICENSE file's sha256 at the first build after checking that it says CC0 1.0.

`instruments.json` per instrument (spec fields): `source`, `set`, `kind`, `files` (SFZ path), `range: [lo, hi]` (melodic), `tokens` (kits), `velUpper`, `rr`, `oneShot`, `maxLen`, `release`, `gain`, `standIn`.

Stand-ins: `kit.core` -> `drums`, `bass` -> `bassPizz`, `piano` -> `pad`, `trumpet` -> `brass`, `trombone` -> `trombone`, `glock` -> `glock`.

Kit tokens for `kit.core`: K kick, S snare (2 rr), H closed hat accented and h closed hat light (one hat sample, 2 rr, two velocity layers), O open hat, C crash, T tambourine, B shaker, W woodblock, L triangle, R snare rim, Q stick click, D low tom.

`build.mjs` CLI: `node --experimental-strip-types tools/samples/build.mjs [--ranges] [--set <id>] [--force]`
- `--ranges` imports `src/audio/music/tracks.ts` and prints, per `s:` instrument, the MIDI range the tracks need: note + voice transpose, plus 1 for `board.*` tracks.
- Otherwise it runs the spec's build steps 1-5 for the chosen sets. It:
  - reads roots and `tune` from SFZ `<region>` opcodes (`sample`, `pitch_keycenter`, `tune`, `lovel`, `hivel`, `seq_position`)
  - fails on caps, prints Opus and AAC sizes per set, and warns above download target x 1.25
  - skips zones whose input hash in `build-state.json` is unchanged, unless `--force`
- `CREDITS.txt` lists, per source: `creditLine`, title, author, URL at the pinned commit, license name and URL. CC BY sources also get `Changes: …` (none in Plan 1). It closes with a thank-you line per CC0 or Unlicense library.

- [ ] **Step 1: Write the failing tests** in `src/audio/samples/tables.test.ts`

```ts
const files = import.meta.glob("/public/music/**/*.{webm,m4a}", { query: "?url", import: "default", eager: true });
const sources = JSON.parse(Object.values(import.meta.glob("/tools/samples/sources.json", { query: "?raw", import: "default", eager: true }))[0] as string);
const credits = Object.values(import.meta.glob("/public/music/CREDITS.txt", { query: "?raw", import: "default", eager: true }))[0] as string;
it("SAMPLED and ZONES list the same instruments", ...)
it("every zone file exists in both formats", ...)            // for each zone: keys include `/public/music/${file}.webm` and `.m4a`
it("every instrument's source is allowed", ...)              // source in sources; license in ["CC0-1.0", "Unlicense", "CC-BY-3.0"]
it("credits name every source; CC BY entries carry title, author, url, license url and changes", ...)
it("decoded caps hold", ...)                                 // per set sum(frames)*4 <= 24*2**20; core + each board set and core + each mg set <= 44*2**20 (absent sets count 0)
it("core holds the six core instruments", () => { expect(Object.keys(SAMPLED).filter((k) => SAMPLED[k].set === "core").sort()).toEqual(["bass", "glock", "kit.core", "piano", "trombone", "trumpet"]); });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/audio/samples/tables.test.ts`
Expected: FAIL. The placeholder tables are empty, `sources.json` does not exist yet, and the glob resolves nothing.

- [ ] **Step 3: Write `sources.json`, `instruments.json` and `build.mjs`; update `.gitignore` and `tsconfig.json`.** Set each instrument's `range` from the `--ranges` output.

- [ ] **Step 4: Build the core set**

Run: `node --experimental-strip-types tools/samples/build.mjs --ranges && node --experimental-strip-types tools/samples/build.mjs --set core`
Expected:
- the printed ranges cover every `s:` instrument used by the re-voiced tracks (Task 8 changes the tracks; run `--ranges` again after Task 8 and rebuild if a range grows)
- a per-set report with core Opus size about 1.5 MB (no warning above 1.875 MB) and decoded size at most 24 MB
- every `.m4a` verified by ffmpeg decode, and exit code 0

- [ ] **Step 5: Run the tests**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/samples/sources.json tools/samples/instruments.json tools/samples/build.mjs tools/samples/build-state.json src/audio/samples/instruments.gen.ts src/audio/samples/zones.gen.ts src/audio/samples/tables.test.ts public/music .gitignore tsconfig.json
git commit -m "Music: sample pipeline and the core set (CC0: VCSL, VSCO-2 CE, Virtuosity Drums, FreePats)"
```

### Task 8: Re-voice the played tracks onto the core set

**Files:**
- Modify: `src/audio/music/tracks.ts` (styles of `title`, `shop`, `results`, `star_fanfare`, `win`, `lose`, `drumroll`, `drumroll_hit`; rename `board` -> `board.fairground`, `minigame_a` -> `mg.action`, `minigame_b` -> `mg.puzzle`; `TRACK_ORDER`), `tools/audio-selfcheck.mjs` (`REQUIRED_TRACKS`, line 44, and accept `s:` styles listed in `SAMPLED`), `tools/render-music.mjs` (default list = `trackIds()`; duration = bars x 240 / bpm capped at 120 s; `--lift` renders `board.*` lifted as `<id>-lift.wav`)
- Create: `src/audio/music/coverage.test.ts`

**Interfaces:**
- Consumes: `SAMPLED`, `ZONES`, `pickZone`, `pickKitZone`, `midiFromHz` (Tasks 4 and 7); `parseTrack`, `parseSection`, `trackSets` (Task 1).
- Produces: every played track uses only `s:` styles from `core`. The three renamed tracks carry their old patterns as interim content (Plans 2 and 3 replace them).

Mapping (spec table plus one interim row):

| Old style | New style |
|---|---|
| swingLead, hypeLead, staccatoLead, brass | `s:trumpet` |
| counterSoft, trombone | `s:trombone` |
| brassStab, stab | two voices: `s:trumpet` and `s:trombone`, same pattern |
| pad | `s:piano` |
| glock, sparkle, musicbox, blip, calliope (interim) | `s:glock` |
| every `bass*`, oompah | `s:bass` |
| drums | `s:kit.core` |

`happening`, `grumpus` and `minigame_intro` are not touched.

- [ ] **Step 1: Write the failing test** in `src/audio/music/coverage.test.ts`

```ts
it("every sampled style names an instrument in the track's sets", ...) // for every track, voice, fill and pickup with an s: style: SAMPLED[name] exists and SAMPLED[name].set is in trackSets(def)
it("every note is within maxShift of a zone", ...)    // for each note event: midi = midiFromHz(f) + voice.transpose (+1 if def.id starts with "board."); slides excluded; |pickZone(...).root - midi| <= SAMPLED[name].maxShift on every layer
it("every drum token used has a kit zone", ...)       // for s:kit.* voices: pickKitZone(zones, token, 0, 0) is not null
it("played tracks use no synth styles", ...)          // for each of title, shop, results, star_fanfare, win, lose, drumroll, drumroll_hit, board.fairground, mg.action, mg.puzzle: every voice style starts with "s:"
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/audio/music/coverage.test.ts`
Expected: FAIL on "played tracks use no synth styles".

- [ ] **Step 3: Re-voice and rename the tracks; update `audio-selfcheck.mjs` and `render-music.mjs`.** Run `build.mjs --ranges` again; if any range grew, rebuild core (Task 7 Step 4) and include the regenerated files in this commit.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npm run typecheck && npm run build && node --experimental-strip-types tools/audio-selfcheck.mjs`
Expected: PASS; selfcheck "ALL CHECKS PASSED".

- [ ] **Step 5: Listening checkpoint**

With `npm run dev` running, run `node tools/render-music.mjs title shop results win lose star_fanfare board.fairground mg.action mg.puzzle`. Encode each WAV to a 128 kbps MP3 in the scratchpad, send them to the player, and wait for their reaction before Task 9. The renders are not committed: `tools/music/` and `*.mp3` are ignored.

- [ ] **Step 6: Commit**

```bash
git add src/audio/music/tracks.ts src/audio/music/coverage.test.ts tools/audio-selfcheck.mjs tools/render-music.mjs public/music src/audio/samples
git commit -m "Music: played tracks re-voiced onto recorded core instruments"
```

### Task 9: Credits panel, CI assertion, browser checks

**Files:**
- Modify: `src/screens/titleScreen.ts` (`_showSettingsPanel`, add a CREDITS button before the close button, about line 597), `tools/smoke-play.mjs` (final assertion)
- Create: `tools/probe-music.mjs` (local only, not added to CI)

**Interfaces:**
- Consumes: `audio.debug()` / `state().audio` and `__SSP__.audioBars()` (Task 6); `public/music/CREDITS.txt` (Task 7).
- Produces:
  - **CREDITS button:** `ui.button({ label: "CREDITS", kind: "ghost", sound: "ui.click" })`. It opens an overlay with the fetched `CREDITS.txt` text, scrollable, with a close button in the panel's style.
  - **smoke-play:** fails unless `state().audio.samples.failed` is empty and `state().audio.samples.format === "opus"`.

- [ ] **Step 1: Write the probe** `tools/probe-music.mjs`

It follows the existing probes (`BASE` env, Chromium at `/opt/pw-browsers/chromium` if present, exit 1 on failure). Cases, each in a fresh page:
- `?audio=1`: within 5 s `samples.sets.core === "ready"`, `format === "opus"`, `levels.rms > 0.001`, and zero console errors.
- `?audio=1&screen=board`: `theme === "board.fairground"`.
- `?audio=1&samples=0`: `format === "synth"`, music still plays (`rms > 0.001`).
- `?audio=1&audiofmt=aac`: `format === "synth"` (Chromium has no AAC decoder), with exactly one console warning from the loader.
- `?audio=1` with `/music/` responses delayed 3 s by `page.route`: `rms > 0.001` within 1 s of unlock, and `standInNotes > 0`.
- `?audio=1` with one core file answered 404: no console errors; after the set is requested again (navigate title, then board, then title), `samples.failed` names that instrument.
- `?audio=0`: zero requests whose URL contains `/music/`, and `state().audio.samples.format === "off"`.
- Title, then SETTINGS, then CREDITS: the overlay text contains "VCSL", "VSCO", "Virtuosity" and "FreePats".

- [ ] **Step 2: Run it to see the credits case fail**

Run: `npm run dev` (other shell), then `node tools/probe-music.mjs`
Expected: every audio case passes and the CREDITS case fails (no button yet).

- [ ] **Step 3: Add the CREDITS button and overlay, and the smoke-play assertion.**

- [ ] **Step 4: Run the checks**

Run: `node tools/probe-music.mjs && node tools/smoke-play.mjs && npx vitest run && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit and push**

```bash
git add src/screens/titleScreen.ts tools/smoke-play.mjs tools/probe-music.mjs
git commit -m "Music: credits panel, smoke-play sample assertion, local music probe"
git push -u origin feat/sampled-music
```

---

## Plans 2 and 3 (written after Plan 1 lands)

- **Plan 2, board themes:**
  - sets `fairground`, `cruise` and `downtown` (sources: Karoryfer War Tuba, Weresax and Bear Sax; D. Smolken double bass; jSteelDrum; FreePats Ukulele, Accordion and Calliope; Greg Sullivan E-Pianos, with the CC BY credit; more VCSL and VSCO-2 CE)
  - three 32-bar themes with `lift` layers and fills
  - `setBoard`/`lift(false)` in `startMatch()` (`src/core/game.ts`), `lift(true)` on `turn:start` in `turnLoop.ts`, `setBoard` in `showcaseScreen.ts`
  - board-set release during minigames
  - the `board.*` interim fallbacks removed
- **Plan 3, minigame themes:**
  - sets `mg-action` and `mg-puzzle`
  - the three minigame themes and `mg.rhythm` with its pickup
  - `MinigameEntry.genre` and minigame-set loading at `setPendingMinigame()`, the ready screen, and `minigameScreen.enter()`
  - `genre` and `music` passed by `minigameScreen.ts`
  - the Drum Solo anchor (`clock()` from `_playT`, `StepClock.setAnchor`, `state().audio.anchor`)
  - the last interim fallback removed
  - the budget and loudness passes, and the iPhone check
