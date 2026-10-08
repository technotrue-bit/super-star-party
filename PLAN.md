# SUPER STAR PARTY — Master Plan & Piece Decomposition

Mobile party-board game, Three.js, Mario Party 7 quality bar. Procedural art,
animation, and audio are the default. glTF/GLB is allowed (Blender models, or
Mixamo animations exported and retargeted). Do not commit raw Mixamo source
files — only the exported glTF/GLB. Orchestrated by Hermes (the Captain's agent) with
builder/critic subagent waves. Live progress: `/progress.html`.

## Rendering

Vanilla Three.js. Dense static meshes can build a three-mesh-bvh tree, loaded
only when a mesh is dense enough. The post look is pmndrs `postprocessing`
(MIT): one `EffectPass` plus the `RenderPass`. Low is FXAA and a light
vignette. High adds a half-resolution bloom on the brightest stars and coins.
There is no tone map, so the cel colors stay as they are, and no SSAO, SSR,
or depth of field. Quality is Off / Low / High (`?fx=`, the pause menu, and
`window.__SSP__.effectsQuality()`). Off does not load the library. Phones and
low-DPR displays default to Low; a desktop pointer with DPR above 1 defaults
to High. The choice is visual only. Gameplay, the rng, and the dice do not
read it.

## The game (scope)

4 characters race around **Fizzy Fairground** (a carnival board) collecting
coins, buying stars (20 coins), triggering happenings, shopping for items, and
surviving Grumpus — with a minigame after every turn. 10 turns, then bonus
stars and a winner celebration.

- **Board**: ~28 spaces — 12 blue (+3 coins), 6 red (−3), 4 green happenings,
  2 star, 2 shop, 2 grumpus, plus a shortcut path.
- **Dice**: personality dice per character (standard 1–6, swingy, steady).
- **Items**: Mushroom (roll twice), Midway Whistle (teleport ahead), Zappy
  (steal 5 coins from the nearest rival).
- **Happenings**: 8+ green-space events (wind ride, coin shower, swap spots,
  star dance, etc.) + Grumpus events (gamble wheel).
- **Minigames** (8): Bumper Balls (survival), Cake Dash (race), Coin Cannon
  (aim/timing), Memory Match (pairs), Drum Solo (rhythm), Balloon Pop
  (target), Coin Grab (collect arena), Pipe Puzzle (rotate-to-route).
  Winner takes 10 coins. CPU players play credibly in all of them.
- **Ending**: 2 bonus stars (Mini Star = most minigame wins, Coin Star =
  most coins) → podium results, confetti, fanfare, crown on the winner.
- **Mobile-first**: touch + keyboard, portrait and landscape, big readable UI.

## Quality bar

`refs/QUALITY_BAR.md` — MP7 anchors for colors, juice, music, sfx, playstyle,
win-feel. EVERY piece is judged against it by fresh harsh critics inspecting
the RUNNING game (browser state + screenshots + pixel census + audio levels),
never builder summaries. On a loss the critic names exactly ONE largest gap,
verbatim back to the builder. No fixed round cap — loop until wowed.

## Piece decomposition (smallest judgeable units)

| # | Piece | Owner files | Wave |
|---|-------|-------------|------|
| 0 | Core engine (rng, events, match state, debug API, boot, screens) | `src/core/**`, `src/config/**`, `src/main.ts`, `src/screens/screenManager.ts`, `src/screens/showcaseScreen.ts` | 0 (orchestrator) |
| 1 | Board: Fizzy Fairground | `src/board/**` | 1 |
| 2 | Characters (4 + anims + dice) | `src/characters/**` | 1 |
| 3 | Audio: music + SFX engine | `src/audio/**` | 1 |
| 4 | UI kit (buttons, popups, HUD) | `src/ui/**` | 1 |
| 5 | Turn loop + board screen (dice, movement, HUD, phases) | `src/game/turnLoop.ts`, `src/screens/boardScreen.ts` | 2 |
| 6 | Economy (coins, stars, bonus stars, results) | `src/game/economy.ts` | 2 |
| 7 | Happenings (green + grumpus events) | `src/game/happenings.ts` | 2 |
| 8 | Items (shop, inventory, use) | `src/game/items.ts`, `src/screens/shopScreen.ts` | 2 |
| 9 | Minigame framework (registry, countdown, results, CPU AI base) | `src/minigames/framework.ts`, `src/minigames/registry.ts`, `src/screens/minigameScreen.ts` | 3 |
| 10-17 | Minigames ×8 (each own folder) | `src/minigames/<name>/**` | 3 |
| 18 | Screens: title, character select, results, pause | `src/screens/titleScreen.ts` (replace), `characterSelectScreen.ts`, `resultsScreen.ts`, `pauseScreen.ts` | 4 |
| 19 | Juice pass: particles, camera shake, hit-stop, transitions | `src/juice/**` | 4 |
| 20 | Whole-game coherence pass | repo-wide, orchestrator-routed | 5 |

## Wave plan

- **W0** (orchestrator): scaffold, core engine, harness, progress page. DONE.
- **W1**: 4 parallel builders (board, characters, audio, ui-kit) → 4 fresh
  critics on the RUNNING showcase → one-gap loops until wow.
- **W2**: turn-loop + economy + happenings + items (parallel, disjoint files)
  → critics play real turns via debug API → loops.
- **W3**: minigame framework first, then 8 minigames in two parallel batches
  (4+4) with per-minigame critics → loops.
- **W4**: screens + juice (parallel) → critics on full flow title→win → loops.
- **W5**: ONE fresh coherence agent plays the whole game, smooths seams, then
  final whole-game critic gauntlet + side-by-side blind MP7 comparison.
- Between major waves: whole-game integration checks (build + boot + smoke).

## Contract rules for every builder/critic

1. TypeScript strict; `npm run typecheck` and `npm run build` MUST pass.
2. Determinism: all gameplay randomness via `src/core/rng.ts`; never
   Math.random in gameplay. `window.__SSP__` debug API always live.
3. Palette from `src/config/palette.ts`; tuning from `src/config/settings.ts`.
4. Own ONLY your listed files; siblings' files are do-not-touch. No commits —
   orchestrator commits with explicit paths.
5. Native `C:/`-style paths in scripts; ASCII-only prints.
6. If a terminal command is approval-blocked: skip, note, continue; file
   writes are the deliverable. `npm run typecheck`, `npm run build`,
   `npx vite build` are the standard verify commands.
7. Verify your own work by RUNNING it (typecheck + boot + debug API probe)
   and report real output, not intent.
8. Critics: inspect the RUNNING game at http://localhost:5177/ (browser
   state via `window.__SSP__.state()`, screenshots + pixel census, console
   errors, audio levels). NEVER accept a builder's summary as evidence.
9. Every verdict: PASS with evidence, or FAIL with exactly ONE largest gap.

## Debug API quick reference

`window.__SSP__` → `state()` `goto(s)` `advance(n)` `autoplay(b)` `rollDice(f)`
`seed(n)` `reset()` `audioLevels()` `perf()` `startMatch(kinds)`
`effectsQuality()` `setEffectsQuality(q)`
`state().effectsQuality` is `"off"`, `"low"`, or `"high"`.
URLs: `?seed=7&screen=showcase&autoplay=1&audio=0&speed=2&fx=off`
