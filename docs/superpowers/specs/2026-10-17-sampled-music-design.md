# Sampled Music — Design

Date: 2026-10-17. Status: approved in chat, section by section (structure, music, samples, failures, testing).

## Intent

What the player asked for:
- The music sounds cheap and the instruments sound weird. Make them **premium**: real recorded instruments (option A: multisampled instruments played by our own sequencer).
- **Each board gets its own theme** that fits it.
- **Each type of minigame gets its own theme.**
- The music **reacts to the game**. Of the reactions offered, only the **final-turns lift** was chosen.
- Board themes as suggested: Fairground = carnival band, Cruise Ship = calypso, Downtown = funky big-band jazz. Minigames by type: action = fast and driving, puzzle/memory = quirky, rhythm = drum-led funk.

Assumptions (not said by the player, correct me):
- "Each type of minigame" means the three groups above, not one theme per genre field value (8 values today).
- Tracks the player did not ask about (title, shop, happening, Grumpus, results, fanfares, drumrolls, lose, minigame intro) keep their melodies and move onto the new instruments, so the game has one sound.
- Phase-based board intensity and the existing stingers stay as they are.
- `refs/QUALITY_BAR.md` says procedural audio is the default. The player chose samples for music, so this design is an approved exception for music instruments. SFX stay synthesized (the Openverse files on `feat/openverse-sfx` are not part of this work).

## Success criteria

1. Each board plays its own theme; each minigame type plays its own theme; all instruments are recorded samples (with the synth stand-in only while a sample is loading or after a load failure).
2. Board themes run 32 bars (about a minute) before repeating; minigame themes run 16 bars.
3. In the last 5 turns the board theme is up one semitone, about 6% faster, with an extra layer, switching on a bar line after a one-bar fill.
4. Drum Solo's music and its 120 BPM chart line up within 10 ms (today they drift: 118 vs 120 BPM).
5. Download stays small and lazy: core set about 1 MB, about 1-1.5 MB per board, about 0.5-1 MB per minigame type. Decoded memory stays under 24 MB per set and 48 MB in use at once.
6. Every sample is CC0, public domain, or CC-BY, and every CC-BY source is credited in game.
7. Nothing waits on loading. Seeded matches play identically with music on, off, loaded, or failed.
8. CI stays green: typecheck, build, unit tests, all probes.

## Facts this design relies on

- Engine: `src/audio/audioEngine.ts` (API, buses, stingers, duck, `renderTrack`), `music/sequencer.ts` (16th-note lookahead scheduler, swing, layers `base/perc2/counter/bright`), `music/instruments.ts` (`VoiceFn(ctx, out, t, freqs, lenSec, vel, opts)` registry `VOICES`, `drumHit` tokens K S H h O C T B W L R Q D), `music/tracks.ts` (pattern grammar, 14 tracks, all 8 bars or shorter).
- Game calls: `audio.music.play("board" | "shop" | "title" | "results" | "win" | "minigame_a" | "minigame_b", {intensity})`, `audio.music.stinger(...)`, `audio.music.intensity(...)` in `turnLoop.ts`, `titleScreen.ts`, `minigameScreen.ts`, `minigameReady.ts`, `matchFinale.ts`, `showcaseScreen.ts`, `push_of_war`, `quick_draw`.
- `minigameScreen.ts` picks `minigame_a` for genres survival, race, timing, target, collect (13 games) and `minigame_b` for puzzle, memory, rhythm (3 games).
- Boards: `BoardId = "fizzy-fairground" | "downtown" | "cruise-ship"`, `activeBoardId()` in `src/board/registry.ts`, bound to `match.boardId` by `game.ts`.
- Last 5 turns: `turn >= match.totalTurns - 4`, evaluated on the `turn:start` bus event (`src/board/lively/shots.ts`, `timeOfDay.ts isLast5`).
- Drum Solo: chart at 120 BPM (`BEAT = 0.5`), currently over `minigame_b` at 118 BPM.
- Static assets live in `public/` and are addressed as `${import.meta.env.BASE_URL}<path>` (`src/game/freeplay.ts`); Vite `base: "./"`; deploy is Vercel.
- CI probes run with `?audio=0` except `smoke-play.mjs` (`?audio=1`, no audio assertions). No CI check reads track names. `tools/render-music.mjs` and `tools/verify-audio.mjs` (manual tools) use track ids and `renderTrack`.
- `ffmpeg` 6.1 with libopus and aac is available where the sample build runs; the source libraries are reachable by git.

## Structure

Keep the sequencer, the pattern grammar, the intensity layers, the stinger and duck paths, and the public API. Add:

1. **Sampler voice** (`src/audio/samples/sampler.ts`). A `VoiceFn` like the synth voices. For each note it picks the zone with the nearest root note (ties: lower root) and the nearest velocity layer, plays an `AudioBufferSourceNode` from the sample's detected start offset with `playbackRate = 2^((note - root) / 12)`, applies the note's length with a short release (20-60 ms per instrument), and alternates round robins where an instrument has them. Tracks name sampled instruments with an `s:` prefix (`style: "s:marimba"`); the pattern grammar does not change. Drum voices map tokens to kit pieces (`K` kick, `S` snare, `H`/`h` closed hat accented/light, `O` open hat, `C` crash, `T` tambourine, `B` shaker, `W` woodblock, `L` glock bell, `R` rim, `Q` count tick, `D` low tom) per kit.
2. **Sample loader** (`src/audio/samples/loader.ts`). Reads `public/music/manifest.json`, chooses the format once per session by test-decoding a tiny embedded Opus/WebM clip (fallback AAC/M4A, then synth only), fetches and decodes sets on demand into any `BaseAudioContext`, detects each sample's real start (first sample above -50 dBFS) to cancel encoder padding, caches decoded buffers per set, and frees a set on request. Loading order: `core` at first audio unlock; the board's set when the match board is known (during the intro flyover); a minigame type's set on the minigame ready screen. Loading never blocks.
3. **Music director** (`src/audio/music/director.ts`). Resolves a requested track to a theme:
   - `"board"` resolves to `board.fairground`, `board.cruise`, or `board.downtown` from the board set by `audio.music.setBoard(id)` (called where `game.ts` binds `match.boardId`; unknown ids use the fairground).
   - `"minigame_a"` / `"minigame_b"` resolve by the `genre` passed in `play()` options: survival, race, timing, target, collect -> `mg.action`; puzzle, memory -> `mg.puzzle`; rhythm -> `mg.rhythm`. No genre: `minigame_a` -> `mg.action`, `minigame_b` -> `mg.puzzle`.
   - Every other id plays as itself.
   - `audio.music.track()` keeps returning the requested id (`"board"`, `"minigame_a"`, ...). A new `audio.music.theme()` and `state().audio.theme` report the resolved theme.
4. **Final-turns lift** (`audio.music.lift(on: boolean)`). `turnLoop.ts` calls `lift(true)` on `turn:start` when `turn >= match.totalTurns - 4` (the same rule as the last-5 camera shot) and `lift(false)` when a match starts. The director remembers it and applies it whenever a board theme plays. Lifted = transpose +1 semitone, tempo x1.06, `lift` layer at full gain. The sequencer gets `setTempo(bpm)` and `setTranspose(semis)` that take effect at the next bar line, and a theme may define a one-bar `fill` pattern the sequencer plays in the bar before a lift. Stingers are not lifted.
5. **Rhythm anchor.** A minigame may declare `music?: { bpm: number; beat0: number }` (`beat0` = seconds after GO of the chart's first beat). `minigameScreen.ts` passes it to `play()`, and the sequencer starts the theme so bar lines fall on that grid. If the theme's samples arrive late, it joins at the next bar line of the same grid. Drum Solo declares `{ bpm: 120, beat0: <its lead-in> }`. The anchor only holds at game speed 1; at debug speeds the theme plays unanchored.
6. **Offline sample pipeline** (`tools/samples/`, run by hand, never in CI): `sources.json`, `instruments.json`, `build.mjs` (git + ffmpeg). Outputs go to `public/music/` and are committed.

## The music

### Themes

| Theme | Feel | Instruments (source) |
|---|---|---|
| `board.fairground` | Carnival band, swing, about 132 BPM | Calliope lead (FreePats Synth Lead Calliope, doubled by VCSL glockenspiel), trumpet and trombone (VSCO-2 CE), oom-pah tuba (Karoryfer War Tuba staccato), xylophone (VCSL), accordion colour (FreePats Button Accordion), marching snare, bass drum, cymbals |
| `board.cruise` | Calypso, light groove, about 112 BPM | Steel pan lead (jSteelDrum), ukulele strum and chuck (FreePats Ukulele), marimba (VCSL), bass guitar (FreePats Bass Guitar YR), shakers, congas, claves (VCSL), flute on the bright layer (VSCO-2 CE) |
| `board.downtown` | Funky big-band jazz, swing, about 124 BPM | Wurlitzer EP200 (Greg Sullivan E-Pianos), alto sax (Karoryfer Weresax), tenor sax (VCSL), baritone sax (Karoryfer Bear Sax), trumpet and trombone hits (VSCO-2 CE), upright bass pizzicato (D. Smolken double bass), jazz kit |
| `mg.action` | Fast and driving, about 145 BPM | Drums, bass guitar, layered brass stabs (VSCO-2 CE trumpet + trombone + horn staccato), xylophone lead (VCSL), drawbar organ (FreePats setBfree organ) |
| `mg.puzzle` | Quirky, about 108 BPM | Pizzicato strings (VSCO-2 CE), clarinet and bassoon (VSCO-2 CE), marimba (VCSL), celesta (stamperadam Celeste Samples, CC0), woodblock and temple blocks (VCSL) |
| `mg.rhythm` | Drum-led funk, exactly 120 BPM | Funk kit kept sparse where the chart plays, bass guitar, Wurlitzer comping |

- Board themes: 32 bars in A, A', B, A'' form, layers `base`, `perc2`, `counter`, `bright`, plus `lift` and a one-bar `fill`.
- Minigame themes: 16 bars, the same four intensity layers.
- Kits for the drum voices come from the CC0 sources (VCSL percussion; Karoryfer Virtuosity Drums for the jazz and funk kits). The exact kit per theme is fixed in `instruments.json`.

### Existing tracks

`title`, `shop`, `happening`, `grumpus`, `results`, `star_fanfare`, `minigame_intro`, `win`, `lose`, `drumroll`, `drumroll_hit` keep their patterns and swap each synth style for the nearest sampled instrument from the core set (or a set already loaded with them). Their ids, loop flags and stinger use do not change.

### Sets and budgets

| Set | Holds | Download target |
|---|---|---|
| `core` | Drum kit, bass, piano, brass, glockenspiel: everything the existing tracks need | about 1 MB |
| `fairground`, `cruise`, `downtown` | That board theme's instruments not in core | about 1-1.5 MB each |
| `mg-action`, `mg-puzzle`, `mg-rhythm` | That minigame theme's instruments not in core | about 0.5-1 MB each |

The build fails if any set's estimated decoded size (sum of sample frames x 4 bytes at 48 kHz) exceeds 24 MB, and warns if a download target is exceeded by more than 25%.

## Samples

### Sources

All recorded in `tools/samples/sources.json` with URL, pinned commit or release, license, and credit line.

| Source | License | Used for |
|---|---|---|
| VCSL (Versilian Community Sample Library) | CC0 1.0 | Mallets, glockenspiel, tenor sax, hand percussion, woodblock, temple blocks |
| VSCO-2 Community Edition | CC0 1.0 | Trumpet, trombone, horn, flute, clarinet, bassoon, pizzicato strings |
| Karoryfer War Tuba, Weresax, Bear Sax, Virtuosity Drums | CC0 1.0 | Tuba, alto and baritone sax, kits |
| D. Smolken double bass (sfzinstruments) | CC0 1.0 | Upright bass |
| FreePats Ukulele, Button Accordion HN, Bass Guitar YR, Synth Lead Calliope, setBfree drawbar organ | CC0 1.0 | Those instruments |
| jSteelDrum (Jeff Learman) | The Unlicense | Steel pan |
| stamperadam "Celeste Samples" (Freesound pack 6166) | CC0 1.0 | Celesta |
| Greg Sullivan E-Pianos (Wurlitzer EP200) | CC BY 3.0 | Electric piano (credit required) |

Rejected and not to be used: Musyng Kite, FatBoy, Timbres of Heaven, Arachno, SGM, Sonatina, Philharmonia, Salamander Drumkit (BY-SA), WebAudioFont's player (GPL), the FreePats General MIDI set (GPL), the Splendid Grand piano (public-domain claim unconfirmed). FluidR3_GM (MIT) and GeneralUser GS are fallbacks only, not planned sources.

### Recipes and processing

`tools/samples/instruments.json`, per instrument: source files, kept root notes (every 3 semitones over the range the themes use, so no note shifts more than 1.5 semitones), velocity layers (1; 2 for Wurlitzer, piano, and drums), round robins (2 for snare and hats), max length (percussive and plucked 1.2 s, sustained 2.5 s), release time, and gain.

`build.mjs`:
1. Clone or fetch each source at its pinned ref into `tools/samples/.cache/` (gitignored).
2. For each kept note: downmix to mono, trim to 2 ms before the attack, cut to the max length with a natural fade, resample to 48 kHz.
3. Match loudness across an instrument's notes and record a per-instrument gain so instruments sit at predictable levels.
4. Encode Opus in WebM (mono, 64 kbps) and AAC-LC in M4A (mono, 80 kbps).
5. Write `public/music/<set>/<instrument>/<midi>[-v<layer>][-r<rr>].webm|.m4a`, `public/music/manifest.json`, and `public/music/CREDITS.txt`, and print download size and estimated decoded size per set.

No loop points: party arrangements rarely hold a note past the cap, and themes are written within it.

### Manifest

```json
{
  "version": 1,
  "sets": {
    "core": {
      "instruments": {
        "marimba": {
          "gain": 0.8,
          "release": 0.05,
          "zones": [{ "root": 60, "vel": 0, "rr": 0, "file": "core/marimba/60" }]
        }
      }
    }
  },
  "velocityLayers": { "marimba": [1.0] }
}
```

`file` has no extension; the loader adds `.webm` or `.m4a`. Velocity layer thresholds per instrument split the 0..1 note velocity.

### Credits

`public/music/CREDITS.txt` is generated from `sources.json`: the CC BY 3.0 credit for Greg Sullivan's Wurlitzer, plus thanks to every CC0 and public-domain library. The title screen settings panel gets a CREDITS button that shows it.

## Failures and edge cases

- `?audio=0` or no `AudioContext`: the loader never fetches; every call no-ops as today.
- Format: Opus/WebM test decode fails -> AAC/M4A; both fail -> synth stand-ins only. One console warning.
- A sample not loaded yet: that note plays on the instrument's synth stand-in (each sampled instrument names one in `instruments.json`), switching per note, never mid-note.
- A failed file: one retry the next time its set is requested, then the instrument stays on its stand-in for the session.
- Memory: board set kept for the match; minigame sets freed on leaving the minigame; per-set decoded cap enforced at build time.
- Lift: remembered across board theme restarts after minigames and stingers; reset on match start; short matches lift early by the same rule as the camera shot.
- Rhythm anchor: late samples join on the next bar line of the chart's grid; unanchored at debug speeds.
- Offline render: `renderTrack` loads the needed sets into the `OfflineAudioContext` before rendering.
- Online play: music is local; nothing is sent; no determinism impact (loading uses `fetch`, never `rng`, and gameplay never reads audio state).

## Testing

Unit (vitest, in CI):
- Sampler: nearest-zone and velocity-layer choice, playback-rate math, and a sweep of every note in every track proving no shift exceeds 1.5 semitones.
- Manifest: every `s:` instrument a track uses exists in a set the track loads; every listed file exists in both formats; every source appears in `CREDITS.txt` and CC-BY ones are marked; decoded-size estimates within caps.
- Director: board ids and genres map to the right themes, defaults for unknown values, `track()` returns the requested id.
- Lift: on by the last-5 rule, survives `play("board")` restarts, resets on match start.
- Sequencer: `setTempo`/`setTranspose` apply exactly on the next bar line against a fake clock, with no dropped or doubled steps; the fill plays in the bar before.
- Tracks: every new track parses and every bar sums to 16 steps (extends the existing self-check).

Browser (Playwright, run locally during the work):
- Each board with `?audio=1`: its theme loads, samples decode, no console errors, `audioLevels()` live, `state().audio.theme` correct.
- `?audiofmt=aac` and `?samples=0` (new debug flags) both play.
- Jump to the last 5 turns: `lift` on, tempo changed.
- Drum Solo: chart beat 0 and the theme's bar line within 10 ms.

Listening: at each milestone, render each new theme with `tools/render-music.mjs` and send the files to the player; measure loudness against the quality bar's -14 LUFS target and check music sits under SFX.

CI must stay green; the main bundle grows only by the loader and sampler code.

## Build order

The work builds on `fix/audio-volume-pitch` (music and SFX volume controls); merge it first or branch from it.

1. Engine: sampler voice, loader, manifest types, synth stand-ins, sequencer tempo/transpose at bar lines, fill, director, `lift()`, rhythm anchor, debug flags. Proven with a two-instrument test set.
2. Pipeline: `sources.json`, `instruments.json`, `build.mjs`; produce the `core` set; re-voice the existing tracks onto it.
3. `board.fairground` and its set; lift wired in `turnLoop.ts`.
4. `board.cruise` and `board.downtown` and their sets.
5. `mg.action`, `mg.puzzle`, `mg.rhythm` and their sets; Drum Solo anchor.
6. Credits panel, budget checks, loudness pass, listening review.

## Out of scope

Close-race tension layer, new event stingers, minigame final-seconds urgency, one theme per genre value, loop points, a real recorded calliope or band organ (none exists under a usable license), kazoo, re-composing the non-theme tracks, wiring the Openverse SFX files, and synthesized SFX changes.
