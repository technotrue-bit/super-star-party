# Sampled Music — Design

Date: 2026-10-17. Status: the design was approved in chat section by section (structure, music, samples, failures, testing). This document adds the detail an adversarial review asked for and awaits the player's review. The Facts and Build order sections were not discussed in chat.

## Intent

What the player asked for:
- The music sounds cheap and the instruments sound weird. Make them **premium**: recorded instruments (option A: multisampled instruments played by our own sequencer).
- **Each board gets its own theme** that fits it.
- **Each type of minigame gets its own theme.**
- The music **reacts to the game**. Of the reactions offered, only the **final-turns lift** was chosen.
- Board themes: Fairground = carnival band; Cruise Ship = calypso with a light bossa groove; Downtown = funky big-band jazz. Minigames by type: action = fast and driving; puzzle and memory = quirky, with pizzicato and woodwinds; rhythm = drum-led funk.

Assumptions (not said by the player, correct me):
- "Each type of minigame" means the three groups above, not one theme per genre value (8 values today).
- Tracks the player did not ask about keep their melodies and move onto the new instruments, so the game has one sound. `happening`, `grumpus` and `minigame_intro` are never played by any call site today, so they are left as they are.
- Phase-based board intensity and the existing stingers stay as they are.
- `refs/QUALITY_BAR.md` says procedural audio is the default. The player chose samples for music, so this is an approved exception for music instruments. SFX stay synthesized; the Openverse files on `feat/openverse-sfx` are not part of this work.
- Two instruments have no real recording under a usable license, so they are **samples of synthesizers**: the Fairground calliope (FreePats Synth Lead Calliope) and the action theme's drawbar organ (FreePats setBfree emulation). Every other instrument is a recording of a real instrument.

## Success criteria

1. Each board plays its own theme and each minigame type plays its own theme, on sampled instruments (synth stand-ins play only while a sample is loading or after it failed).
2. Board themes run 32 bars (about a minute) before repeating; action and puzzle themes run 16 bars; the rhythm theme covers Drum Solo's song.
3. In the last 5 turns the board theme is up one semitone, 6% faster, with an extra layer, starting on a bar line right after a one-bar drum fill.
4. During Drum Solo every bar line of the music falls within 10 ms of the chart's grid, including after a 200 ms frame stall and at every game speed (today the music runs at 118 BPM against a 120 BPM chart).
5. Download stays small and lazy (Opus sizes): core about 1.5 MB, about 1-1.5 MB per board, about 0.5-1 MB per minigame type. Decoded audio stays at or under 24 MB per set and 44 MB resident at any time.
6. Every sample comes from a CC0, Unlicense, or CC BY source, and every CC BY source is credited in the game.
7. Nothing waits on loading. Seeded matches play identically with music on, off, loaded, or failed.
8. CI stays green: typecheck, build, unit tests, all probes.

## Facts this design relies on

- Engine: `src/audio/audioEngine.ts` (API, buses, stingers, duck, `renderTrack`), `music/sequencer.ts` (16th-note lookahead scheduler: 25 ms timer, 120 ms lookahead, swing, layers `base/perc2/counter/bright`, hidden-tab resync), `music/instruments.ts` (`VoiceFn(ctx, out, t, freqs, lenSec, vel, opts)` registry `VOICES`; every drum event goes to `drumHit()` with tokens K S H h O C T B W L R Q D), `music/tracks.ts` (pattern grammar; `parseTrack` requires every voice to have the same bar count).
- Played tracks: `title`, `board`, `shop`, `results`, `win`, `minigame_a`, `minigame_b` via `audio.music.play()`; `star_fanfare`, `lose`, `drumroll`, `drumroll_hit` via `audio.music.stinger()`.
- `minigameScreen.ts` (`_beginPlay`, about line 1894) picks `minigame_a` for genres survival, race, timing, target, collect (13 games) and `minigame_b` for puzzle, memory, rhythm (3 games), and passes no genre. `MinigameEntry` in `src/minigames/registry.ts` has no genre; it lives on the lazily loaded module.
- Boards: `BoardId = "fizzy-fairground" | "downtown" | "cruise-ship"`. `startMatch()` in `src/core/game.ts` assigns `match.boardId` (about line 301); `bindActiveBoard` (line 278) only registers a getter at load.
- `createTurnLoop().start()` runs at match start and again on every return from a minigame (`boardScreenPlaceholder.ts` about line 1013), so it is not a match-start hook.
- Last 5 turns: `isLast5(turn, totalTurns)` = `turn >= totalTurns - 4` in `src/board/lively/timeOfDay.ts` (pure; imports only the palette). `turn:start` fires once per player turn (`turnLoop.ts` lines 705 and 715).
- Before a match minigame the turn loop calls `setPendingMinigame()` then shows its START card (`turnLoop.ts` about 2723). The free-play ready screen is `minigameReady.ts`. The online host, `?minigame=` and `launchMinigame` skip pre-screens.
- Drum Solo: `BEAT = 0.5` s, `LEAD_BEATS = 2`, 16 chart beats, `SONG_END = 9.0` s, round ends at 9.6 s. It is timed by `ctx.time` (`_playT`, the sum of frame `dt`, clamped to 1/20 s and multiplied by game speed). It plays a `minigame.count` metronome SFX each beat.
- GAME SPEED 1x/1.5x/2x is a player setting (title settings and pause menu), applied as `?speed=`.
- `state().audio` has `track`, `duck`, `levels`, `master`. `__SSP__.setTurns(n)` exists.
- Static assets live in `public/` and are addressed as `${import.meta.env.BASE_URL}<path>`; Vite `base: "./"`; deploy is Vercel.
- CI runs `node tools/...` probes with `?audio=0` except `smoke-play.mjs` (`?audio=1`, speed 8, fails on any console error). Unit tests run with vitest in node (no Web Audio, no `window`, no `@types/node`; tests read files with `import.meta.glob`). `tools/audio-selfcheck.mjs` is not run by CI. CI's Chromium cannot decode AAC.
- `ffmpeg` 6.1 with libopus and aac is available where the sample build runs. Most sources are reachable by git; FreePats banks are archives on freepats.zenvoid.org.

## Structure

Keep the sequencer's scheduling model, the pattern grammar, the intensity layers, the stinger and duck paths, and the public API. Add:

### 1. Sampler voice (`src/audio/samples/sampler.ts`)

- Tracks name sampled instruments with an `s:` prefix (`style: "s:marimba"`); kits use `s:kit.<name>` (`style: "s:kit.march"`).
- `scheduleStep` routes a note whose style starts with `s:` to the sampler, and a drum event to the sampler kit when its voice style starts with `s:kit.`. Everything else goes to `VOICES` and `drumHit()` as today.
- Pure, exported, and unit-tested: `midiFromHz(hz)`, `pickZone(zones, midi, layer, rr)` (nearest root; on a tie the **higher** root, so the sample is pitched down), `layerFor(velUpper, vel)`, `rateFor(midi, zone)` = `2^((midi - zone.root + zone.tune / 100) / 12)`.
- **Velocity layers:** each instrument has `velUpper`, ascending upper bounds (for example `[0.6, 1]`); a note uses the first layer whose bound is at least its velocity. This is the only selection rule.
- **Round robins:** a per-instrument counter cycles through a zone's alternates.
- **Note length:** `oneShot` instruments (drums, mallets, steel pan, pizzicato, ukulele, plucked bass) play the whole sample up to the instrument's max length, whatever the written note length. Sustained instruments play for the written length plus the instrument's release (20-60 ms fade).
- **Slide:** a note with `slide` ramps `playbackRate` exponentially to the target over the note's length, so the `lose` trombone falls survive.
- Playback starts at the zone's detected start offset (see the loader).

### 2. Instrument tables (generated, committed)

`tools/samples/build.mjs` generates two TypeScript modules from `tools/samples/instruments.json`:
- `src/audio/samples/instruments.gen.ts`, bundled with the engine: `SAMPLED: Record<string, { set; kind: "melodic" | "kit"; standIn; oneShot; release; gain; velUpper; maxShift }>`. `standIn` is a `VOICES` key, or `"drums"` for kits (`drumHit()` plays the missing piece). This lets a note pick its stand-in before any samples load, with `?samples=0`, and after a failure.
- `src/audio/samples/zones.gen.ts`, dynamically imported by the loader (its own chunk): per instrument `{ source, zones: [{ root (or token for kits), layer, rr, tune, frames, file }] }`. `frames` is the length at 48 kHz; `file` is a content-hashed path without extension (`cruise/marimba/60.3fa9c1`).

There is no runtime `manifest.json`.

### 3. Sample loader (`src/audio/samples/loader.ts`)

- **Format:** once per session, test-decode an embedded tiny Opus/WebM clip, then an embedded tiny AAC/M4A clip; use the first that decodes; if neither, stay on stand-ins. `?audiofmt=aac` skips the Opus test; `?samples=0` skips both.
- **Sets:** `load(set)` fetches and decodes every file of a set into a given `BaseAudioContext`, caches the buffers, and reports `idle | loading | ready | failed` per set. `releaseDecoded(set)` drops the decoded buffers but keeps the fetched bytes, and `load()` re-decodes from them. `free(set)` drops both.
- **Start detection:** after decoding, `detectStart(samples, sampleRate)` (pure) finds the first sample above -50 dBFS, which cancels encoder padding in any format.
- **Failures:** every fetch and decode rejection is caught. A failed file is retried once the next time its set is requested, then that instrument stays on its stand-in for the session. Problems are reported with `console.warn` only, never `console.error`.
- **When sets load:**
  - `core`: at the first audio unlock.
  - Board set: when `audio.music.setBoard(id)` is called at match start, whether or not the intro flyover plays. A board change frees the previous board's set. Free play skips the board set.
  - Minigame set: as soon as the next minigame is known. That is `setPendingMinigame()` in a match (before the START card), entering the free-play ready screen, and `minigameScreen.enter()` as a fallback for paths without a pre-screen. The type comes from a new static `genre` field on `MinigameEntry` (a unit test asserts it matches the module's `genre`).
  - Entering a minigame releases the board set's decoded buffers; leaving it frees the minigame set and re-decodes the board set. Notes play on stand-ins until a buffer is back.
- Loading never blocks or delays the game. It uses `fetch`, never `rng`, and gameplay never reads audio state.

### 4. Music director (`src/audio/music/director.ts`)

- `resolveTheme(id, ctx: { board?: BoardId; genre?: MinigameGenre })` is pure and exported:
  - `"board"` -> `board.fairground` / `board.cruise` / `board.downtown` by board (unknown or unset: `board.fairground`).
  - `"minigame_a"` / `"minigame_b"` -> by genre: survival, race, timing, target, collect -> `mg.action`; puzzle, memory -> `mg.puzzle`; rhythm -> `mg.rhythm`. No genre: `minigame_a` -> `mg.action`, `minigame_b` -> `mg.puzzle`.
  - Theme ids and every other id resolve to themselves.
- `play()`, `stinger()` and `renderTrack()` resolve through the director **before** the `TRACKS` lookup. `board`, `minigame_a` and `minigame_b` are removed from `TRACKS`; the six theme ids are added. `audio.music.track()` keeps returning the requested id; the new `audio.music.theme()` returns the resolved one. `audio.music.tracks()` lists real track ids plus the three aliases.
- `play()` options gain `genre?: MinigameGenre` and `music?: { bpm: number; beat0: number }`. `minigameScreen.ts` calls `audio.music.play(track, { intensity: 1, genre: mg.genre, music: mg.music })`.
- `audio.music.setBoard(id)` is called by `startMatch()` in `src/core/game.ts` right after `match.boardId` is assigned, and by `showcaseScreen.ts` (`"fizzy-fairground"`) before it plays `board`.
- Every `TrackDef` declares `sets: string[]`: existing tracks `["core"]`; board themes `["core", "<board>"]`; minigame themes `["core", "mg-<type>"]`.
- `director.ts`, `loader.ts`, `sampler.ts` and `clock.ts` are safe to import in node: module scope never touches `window`, `location`, `document`, `fetch`, `localStorage` or `AudioContext`. URL flags are read lazily behind `typeof window !== "undefined"`, as `audioEngine.ts` does.

### 5. Sequencer timing (`src/audio/music/clock.ts`)

- Timing moves into a pure `StepClock` with no Web Audio and no timers. It is created with `{ bpm, swing, totalSteps, loop, t0, anchor? }` and has `queueChange({ bpm?, transpose?, lift?, fill? })`, `setAnchor(fn)`, and `plan(until): PlannedStep[]`. A `PlannedStep` is `{ step, bar, t, stepDur, transpose, fill, lift }`.
- `plan(until)` returns every step with `t < until`, in order, each exactly once. `Sequencer.tick()` only calls `plan(ctx.currentTime + 0.12)` and hands each step to `scheduleStep`. The existing hidden-tab resync moves into `StepClock`.
- **Changes land on bar lines:** a queued change applies at the first bar line (`step % 16 === 0`) that `plan()` has not returned yet (bar N).
  - With `fill` set, and the theme having a `fill`, bar N plays the fill's voices in place of the theme's drum voices. The other voices play bar N as normal, and the bar counter still advances, so the 32-bar form does not shift. Tempo, transpose and lift then change at bar N+1.
  - Without a fill they change at bar N.
- `TrackDef` gains `fill?: VoiceDef[]` (one bar each, parsed separately, so `parseTrack`'s equal-bar rule is unchanged) and `pickup?: VoiceDef[]` (one bar, used by anchored starts).
- `Layer`/`LayerName` gain `"lift"`, and `LayerBus` gains a `lift` gain. `lift` is not in `layerTargets()`, and `setIntensity()` never touches it. Its gain is set with `setValueAtTime` at the change bar line: 1 when lifted, 0.0001 when not.

### 6. Final-turns lift

- `audio.music.lift(on)` is idempotent: a call that does not change the state does nothing.
- `startMatch()` calls `lift(false)`. `turnLoop.ts` calls `lift(true)` on `turn:start` when `isLast5(turn, match.totalTurns)`, the same rule as the last-5 camera shot, so short matches lift early by the same rule.
- When lift turns on while a board theme plays, the director calls `queueChange({ bpm: base * 1.06, transpose: +1, lift: true, fill: true })`.
- A board theme that starts while lifted (after a minigame or stinger) starts lifted from bar 1 with no fill. `lift(false)` applies at the next unscheduled bar line with no fill.
- Lift applies to board themes only; stingers and other tracks are never lifted.

### 7. Rhythm anchor

- A minigame may declare `music?: { bpm: number; beat0: number }`, where `beat0` is the minigame clock time (`ctx.time`) of the chart's first downbeat. Drum Solo declares `{ bpm: 120, beat0: LEAD_BEATS * BEAT }` (1.0 s).
- GO means the `_beginPlay` frame (`ctx.time` = 0). `minigameScreen.ts` passes `music` and a `clock()` that returns `_playT` extrapolated to now: `_playT + (performance.now() - lastFrameMs) / 1000 * speed`.
- The theme's tempo is `bpm * speed`. Bar lines belong at game times `beat0 + k * 240 / bpm`. Before scheduling each bar line, `StepClock` converts that time to audio time: `ctx.currentTime + (barGameTime - clock()) / speed`. If the result differs from its own next bar time by more than 5 ms, it starts that bar at the converted time. Steps inside a bar are never stretched or dropped. Music reads the game clock; gameplay never reads audio.
- The anchored theme starts at GO, partway through its one-bar `pickup`, at the step GO falls on, so bar 1 begins exactly at `beat0`. Missing samples use stand-ins; there is no late join.
- Drum Solo keeps its `minigame.count` metronome SFX, so its feel does not depend on music. `mg.rhythm` plays no percussion on quarter-note beats, so music and metronome never flam.

### 8. Offline sample pipeline (`tools/samples/`, run by hand, never in CI)

`sources.json`, `instruments.json`, `build.mjs` (git, tar, unzip, ffmpeg; `py7zr` installed by the script into `tools/samples/.venv` only if a source is a `.7z`). Outputs go to `public/music/` and the two generated modules, all committed. See Samples.

### 9. Debug hooks

- `state().audio` adds `theme`, `lift`, `bpm` (effective), `transpose`, `samples: { format: "opus" | "aac" | "synth" | "off"; sets: Record<string, "idle" | "loading" | "ready" | "failed">; failed: string[]; standInNotes: number }`, and `anchor: { goAudio; beat0; bpm } | null`. All fields exist, with defaults, under `?audio=0`.
- `__SSP__.audioBars()` returns `{ audioNow, bars }`: the AudioContext times of the last 8 scheduled bar lines, and for an anchored theme the grid time each bar was mapped to.
- New URL flags: `?audiofmt=aac` and `?samples=0`.

## The music

### Themes

| Theme | Feel | Instruments (set) |
|---|---|---|
| `board.fairground` | Carnival band, swing, about 132 BPM | Calliope lead (FreePats Synth Lead Calliope, doubled by glockenspiel), trumpet and trombone (core), oom-pah tuba (Karoryfer War Tuba staccato), xylophone (VCSL), accordion colour (FreePats Button Accordion), `kit.march` |
| `board.cruise` | Calypso with a light bossa groove, about 112 BPM | Steel pan lead (jSteelDrum), ukulele strum and chuck (FreePats Ukulele), marimba (VCSL), bass guitar (core), flute (VSCO-2 CE), `kit.hand` (shakers, claves, cabasa from VCSL; congas and bongos from Virtuosity Drums) |
| `board.downtown` | Funky big-band jazz, swing, about 124 BPM | Wurlitzer EP200 (Greg Sullivan E-Pianos), alto sax (Karoryfer Weresax), tenor sax (VCSL), baritone sax (Karoryfer Bear Sax), trumpet and trombone hits (core), upright bass pizzicato (D. Smolken double bass), `kit.core` |
| `mg.action` | Fast and driving, about 145 BPM | `kit.core`, bass guitar (core), brass stabs (core trumpet and trombone with VSCO-2 CE F horn), drawbar organ lead (FreePats setBfree) doubled by trumpet |
| `mg.puzzle` | Quirky, about 108 BPM | Pizzicato strings, clarinet, bassoon (VSCO-2 CE), vibraphone (VCSL), woodblock (VCSL) |
| `mg.rhythm` | Drum-led funk, 120 BPM anchored | `kit.core` on offbeats and fills only, bass guitar and piano comping (core) |

- **Board themes:** 32 bars in A, A', B, A'' form. Layers: `base`, `perc2`, `counter`, `bright`, `lift`, plus a one-bar `fill` (required). Board intensity never exceeds 0.65, where `bright` is about -25 dB, so nothing essential goes on `bright`.
- **`lift` layer** (board themes only): a new countermelody, separate from `counter`, on an instrument already in that board's set, plus a crash on the downbeat of every 4-bar phrase. It plays only while lifted and ignores intensity.
- **`mg.action` and `mg.puzzle`:** 16 bars, the same four intensity layers.
- **`mg.rhythm`:** a one-bar `pickup` (2 beats sound before `beat0`), then 4 bars matching the chart, then a one-bar tag that ends with the round. Non-looping.

### Existing tracks

`title`, `shop`, `results`, `star_fanfare`, `win`, `lose`, `drumroll`, `drumroll_hit` keep their patterns and use core instruments only:

| Synth style | Sampled instrument |
|---|---|
| swingLead, hypeLead, staccatoLead, brass | trumpet |
| counterSoft, trombone | trombone (slides kept) |
| brassStab, stab | trumpet + trombone (two voices) |
| pad | piano |
| glock, sparkle, musicbox, blip | glockenspiel |
| every `bass*` style, oompah | bass guitar |
| drums | `kit.core` |

Their ids, loop flags and stinger use do not change.

### Sets and budgets

An instrument lives in exactly one set. Any instrument used by more than one set's tracks goes in `core`.

| Set | Holds | Download target (Opus) |
|---|---|---|
| `core` | `kit.core`, bass guitar, piano (VSCO-2 CE upright), trumpet, trombone (VSCO-2 CE), glockenspiel (VCSL) | about 1.5 MB |
| `fairground` | calliope, tuba, xylophone, accordion, `kit.march` | about 1-1.5 MB |
| `cruise` | steel pan, ukulele, marimba, flute, `kit.hand` | about 1-1.5 MB |
| `downtown` | Wurlitzer, three saxes, upright bass | about 1-1.5 MB |
| `mg-action` | drawbar organ, F horn | about 0.5-1 MB |
| `mg-puzzle` | pizzicato strings, clarinet, bassoon, vibraphone, woodblock | about 0.5-1 MB |
| `mg-rhythm` | nothing beyond core (an empty set is allowed) | 0 |

The build computes each set's decoded size (sum of `frames` x 4 bytes) and fails if any set exceeds 24 MB, or if core + any board set, or core + any minigame set, exceeds 44 MB (48 MB minus headroom for WebKit's late release of decoded audio). It warns when a download target is exceeded by more than 25%. **The caps win over the recipe.** An instrument that pushes a set over gets a shorter max length, one velocity layer, or a narrower range. Expected trims: downtown saxes at 2.0 s, and the Wurlitzer's second layer only across its comping range.

## Samples

### Sources

`tools/samples/sources.json` entries: `{ id, kind: "git" | "archive", url, commit (git) or sha256 (archive), sparse: [paths] (git), license, licenseFileSha256, title, author, creditLine }`.

| Source | License | Used for |
|---|---|---|
| VCSL (sgossner/VCSL) | CC0 1.0 | Glockenspiel, xylophone, marimba, vibraphone, tenor sax, woodblock, shakers, claves, cabasa |
| VSCO-2 Community Edition (sgossner/VSCO-2-CE) | CC0 1.0 | Trumpet, trombone, F horn, flute, clarinet, bassoon, pizzicato strings, upright piano |
| Karoryfer War Tuba, Weresax, Bear Sax (sfzinstruments) | CC0 1.0 | Tuba, alto sax, baritone sax |
| Virtuosity Drums (sfzinstruments/virtuosity_drums) | CC0 1.0 | `kit.core`, `kit.march`, congas and bongos |
| D. Smolken double bass (sfzinstruments) | CC0 1.0 | Upright bass |
| FreePats Ukulele, Button Accordion HN, Bass Guitar YR, Synth Lead Calliope, Drawbar Organ Emulation | CC0 1.0 | Those instruments |
| jSteelDrum (Jeff Learman, sfzinstruments) | The Unlicense | Steel pan (recorded range MIDI 60-83; themes keep the lead inside it, lift included) |
| Greg Sullivan E-Pianos (sfzinstruments/GregSullivan.E-Pianos) | CC BY 3.0 | Wurlitzer EP200 (credit required) |

- Always use the lossless upstream, never the lossy smpldsnds mirrors.
- Git sources are fetched with `git clone --filter=blob:none --sparse` plus `git sparse-checkout set <paths>` at the pinned commit. Archives are fetched by URL and checked against their sha256.
- The build fails if a source's LICENSE file does not match `licenseFileSha256`.
- No other sources and no fallbacks. Adding one requires a license check and a change to this spec.

**Rejected, not to be used:**
- Licenses ruled out:
  - Musyng Kite, FatBoy, Timbres of Heaven, Arachno, SGM.
  - Sonatina, Philharmonia, Salamander Drumkit (CC BY-SA).
  - WebAudioFont's player (GPL), the FreePats General MIDI set (GPL), jRhodes3d (CC BY-NC).
  - Ethan Winer's SoundFonts (custom grant).
- Not confirmed: the Splendid Grand piano (public-domain claim), smpldsnds drum-machines and mellotron, the Kastendieck steel drum, Musical Artifacts SF2s, tonejs-instruments.
- FluidR3_GM and GeneralUser GS are not used.

### Recipes and processing

`tools/samples/instruments.json`, per instrument:
- **Source and set:** `source`, `set`, `kind`, source file paths.
- **Roots:** read from the source's SFZ mapping (`pitch_keycenter`, `tune`), never from file names, because libraries number octaves differently.
- **Kept roots:** every 3 semitones over the range the themes use, including voice transposes and the lift's +1, so no note shifts more than 1.5 semitones. A root is the source's recorded note where one exists. Where neighbouring recorded notes are more than 3 semitones apart, the build derives the missing root offline from the nearest recorded note above (shifting down), with ffmpeg `aresample=resampler=soxr`, and marks the zone `derivedFrom`.
- **Velocity layers and round robins:** `velUpper` sets the layers (1 layer; 2 for the Wurlitzer, piano and kits). Snare and hats get 2 round robins.
- **Length and playback:** `oneShot`, max length (percussive and plucked 1.2 s, sustained 2.5 s, adjusted to fit the caps), release, gain, `standIn`.
- **Kits:** a token map (K S H h O C T B W L R Q D to kit pieces).

`build.mjs`:
1. Fetch each source into `tools/samples/.cache/` (gitignored, and excluded from `tsconfig.json`).
2. For each kept zone: downmix to mono, trim to 2 ms before the attack, cut to the max length with a fade, resample to 48 kHz, apply derived-root shifts.
3. Match loudness across an instrument's zones; per-instrument gain lives in the table.
4. Encode Opus in WebM (mono, 64 kbps) and AAC-LC in M4A (mono, 80 kbps) with `-fflags +bitexact -map_metadata -1`. Verify every output decodes with ffmpeg at the expected length. Skip any zone whose source file, recipe and encoder settings are unchanged (hash recorded in the generated table), so rebuilds do not churn git.
5. Write `public/music/<set>/<instrument>/<root>[-v<layer>][-r<rr>].<hash>.webm|.m4a`, `instruments.gen.ts`, `zones.gen.ts` and `public/music/CREDITS.txt`. Print download size per format and decoded size per set, and enforce the caps.

No loop points: party arrangements rarely hold a note past the cap, and themes are written within it.

`.gitignore` gains `tools/samples/.cache/` and `tools/samples/.venv/`. The repo already ignores `*.mp3` and `*.wav`; `.webm` and `.m4a` are not ignored.

### Credits

- `public/music/CREDITS.txt` is generated from `sources.json`.
- Each CC BY entry contains title, author, source URL with pinned commit, license name and URL, and the changes made. The Wurlitzer entry reads as follows, with `<sha>` filled in by the build from `sources.json`: "Electric piano: "Wurlitzer EP200 Electric Piano" by Greg Sullivan, SFZ mapping from https://github.com/sfzinstruments/GregSullivan.E-Pianos (commit <sha>). Licensed under Creative Commons Attribution 3.0 Unported, https://creativecommons.org/licenses/by/3.0/. Changes: selected notes and velocity layers, trimmed and faded, downmixed to mono, resampled to 48 kHz, loudness-matched, encoded to Opus and AAC. No endorsement by the author is implied."
- Every CC0 and Unlicense library gets a thank-you line.
- The title screen settings panel gets a CREDITS button that shows the file.

## Failures and edge cases

- `?audio=0` or no `AudioContext`: the loader never fetches; every call no-ops as today; `state().audio` still has every field.
- Format: Opus test fails -> AAC test; both fail -> stand-ins only. One `console.warn`.
- A sample not loaded yet, or released during a minigame: the note plays on its stand-in, switching per note, never mid-note.
- A failed file: one retry the next time its set is requested, then stand-in for the session.
- Memory: caps enforced at build time; the board set's decoded buffers are released during minigames; minigame sets are freed on leaving; the board set is freed when the board changes or the match ends.
- Lift: idempotent; remembered across board theme restarts; reset at match start.
- Rhythm anchor: holds at every game speed; corrected at each bar line against the game clock (frame stalls, `?fixedstep=1`, hidden tab).
- Offline render: `renderTrack(track, seconds, opts?: { lift?; board?; genre? })` resolves through the director, loads the track's `sets` into the `OfflineAudioContext` (even under `?audio=0`), and renders `lift` only when `opts.lift` is set. `tools/render-music.mjs` defaults to the six themes plus the re-voiced tracks, with duration = bars x 240 / bpm (capped at 120 s), and renders each board theme twice: normal and lifted.
- Online play: music is local; nothing is sent.

## Testing

### Unit tests (vitest, in CI; files read with `import.meta.glob`)

- **Sampler:** `pickZone` nearest root and higher-root tie, `layerFor`, `rateFor` with `tune`, and `midiFromHz`.
  - A sweep over every note of every track checks each note (written note plus voice transpose plus the lift's +1 on board themes, slides excluded) against its zone, with a shift no greater than the instrument's `maxShift` (1.5).
- **Instrument tables:**
  - every `s:` style in a track names an instrument in the union of that track's `sets`
  - every zone's file exists in both formats (`import.meta.glob(..., { query: "?url" })`, so binaries are not loaded)
  - every instrument's source is in `sources.json` with a license in {CC0-1.0, Unlicense, CC-BY-3.0}
  - every CC BY entry in `CREDITS.txt` has title, author, URL, license URL and changes
  - each set's sum of `frames` x 4 is at most 24 MB, and core + any board set and core + any minigame set are at most 44 MB
  - `SAMPLED` and `zones.gen.ts` list the same instruments
- **Director:** `resolveTheme` for every board id and genre, plus defaults. `MinigameEntry.genre` equals each module's `genre`.
- **Lift:** idempotence; queued once when turned on mid-theme; a theme started while lifted starts lifted with no fill; reset clears it. Tested through the director with a fake sequencer.
- **StepClock** (pure, clock is a number): `plan()` in 25 ms increments across 40 bars, with changes queued mid-bar and less than 120 ms before a bar line. Checks:
  - steps are contiguous, none missing or doubled
  - changes land on the first unplanned bar line
  - the fill bar replaces only drum voices, and the bar counter advances through it
  - with an anchor, every bar line maps within 5 ms of the grid after a simulated 200 ms stall and at speeds 1, 1.5 and 2
- **Loader** (fake `fetch` and decode): format chain, retry once then stand-in, `releaseDecoded` then re-decode, `free`, `detectStart`.
- **Tracks:** every track parses and every bar sums to 16 steps. This moves from `tools/audio-selfcheck.mjs` into vitest, because CI does not run the selfcheck.
- **Determinism guard:** no file under `src/audio/` imports `core/rng`.

### CI probe change

`smoke-play.mjs` gains one assertion at the end: `state().audio.samples.failed` is empty and `state().audio.samples.format === "opus"`.

### Browser checks (Playwright, run locally during the work)

- Each board with `?audio=1`: theme loads, `samples.sets` ready, no console errors, `audioLevels()` live, `theme` correct.
- `?audiofmt=aac` in Chromium (no AAC decoder): falls back to stand-ins with one warning, which proves the fallback path.
- Last 5 turns: `?audio=1&autoplay=1`, `__SSP__.setTurns(match.turn + 3)`, wait for the next `turn:start` plus 2 bars, then `lift === true` and `bpm` is about base x 1.06.
- Drum Solo at speeds 1 and 2: `audioBars()` bar lines within 10 ms of their grid times, including after a forced 200 ms main-thread stall; `theme === "mg.rhythm"`.
- Twin run with `?audio=1`: two seeded autoplay matches produce identical state hashes.

### Checks outside CI

- The AAC path cannot run in CI's Chromium. `build.mjs` verifies every `.m4a` decodes with ffmpeg, and the player checks the game on an iPhone in Safari at the listening review.
- Listening: at each milestone, render each new theme (board themes normal and lifted) with `tools/render-music.mjs` and send the files to the player; measure loudness against the quality bar's -14 LUFS target and check music sits under SFX.

CI must stay green. The main bundle grows only by the loader, sampler, director, clock and `instruments.gen.ts` (small); theme pattern text stays in `tracks.ts`.

## Build order

The work builds on `fix/audio-volume-pitch` (music and SFX volume controls, `audioEngine.test.ts`); merge it first or branch from it.

1. Engine: `StepClock`, sampler, loader, generated-table types, stand-ins, drum routing, director, `lift()`, rhythm anchor, debug hooks, flags. Proven with a two-instrument test set.
2. Pipeline: `sources.json`, `instruments.json`, `build.mjs`; the `core` set; the existing tracks re-voiced onto it; credits panel.
3. `board.fairground` and its set; `setBoard` and lift wired in `src/core/game.ts` and `turnLoop.ts`.
4. `board.cruise` and `board.downtown` and their sets.
5. `mg.action`, `mg.puzzle`, `mg.rhythm` and their sets; `MinigameEntry.genre`; minigame set loading; Drum Solo anchor.
6. Budget pass, loudness pass, listening review, iPhone check.

## Out of scope

Close-race tension layer, new event stingers, minigame final-seconds urgency, one theme per genre value, loop points, a real recorded calliope or band organ, kazoo, celesta, temple blocks, re-composing the non-theme tracks, the three unused tracks, wiring the Openverse SFX files, and changes to synthesized SFX.
