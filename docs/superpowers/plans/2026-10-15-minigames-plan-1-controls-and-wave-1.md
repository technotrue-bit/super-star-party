# Fifty Minigames, Plan 1: Screen Lock, New Controls, Wave 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the screen during minigames, add five new control styles (hold, swipe, twin, dial, draw) to the minigame framework, and ship the first five games, one per new control.

**Architecture:** The page lock is a boot-time module. The camera lock is a framework rule: no shake, plus one smooth follow helper for travel races. New controls are declared by a `pad` field on `Minigame`. The minigame screen turns touch and keyboard into new optional `MinigameInput` calls, the touch pad draws one UI per pad, and CPU seats use seeded helpers in `cpuControls.ts`. A hidden `control_lab` minigame records input calls so probes can test the controls before any real game uses them.

**Tech Stack:** TypeScript, Three.js 0.182, Vite 7, Playwright probes (`tools/*.mjs`), Vitest (added here for pure-function unit tests).

**Spec:** `docs/superpowers/specs/2026-10-15-fifty-minigames-design.md`

## Global Constraints

- Gameplay randomness only from `ctx.rng` (`() => number`). CPU helpers draw the same number of times at every CPU level.
- CPU strength only via `cpuSkill()` (Relaxed 0.7, Normal 1, Challenge 1.3).
- No camera shake in any minigame. Cameras come from `frameMinigame()`. Travel races use `followCamera()`, which follows course progress, never raw input.
- During play, taps, stick moves, swipes, dial turns, and drawing never scroll or zoom the page.
- Rounds last 30–60 s. `ctx.finish(ranking, coinWinners?)` is called exactly once. Payouts stay 10/6/3/0.
- Each new game: `howTo`, `goal`, and `rules` filled in; registered in `MINIGAME_MODULES` and `PACK_OF_MINIGAME`; a menu picture, thumbnail, and clip in `public/minigames/`.
- No new network messages. Online play keeps local rounds plus `OfficialMinigame`.
- Swipe `power` = screen speed ÷ 3 screens/s, clamped 0..1. `holdMax` default 1.5 s. Keyboard dial rate is 1.5 turns/s. Draw `move` events are capped at 60/s.
- Probes run against the dev server at `http://127.0.0.1:5177` with a 390×844 viewport.

## Review Focus

1. **A second finger during a hold or a dial turn** (a thumb on the stick while the other holds): the hold must not end, and the stick keeps working. Test in Task 4.
2. **A swipe that starts on a touch-pad button** must not fire a swipe, and a tap on the button must not count as a swipe. Test in Task 4.
3. **The window loses focus mid-hold** (Space down, then alt-tab, so no keyup arrives): the hold must end with `down=false` instead of charging forever. Test in Task 3.
4. **A rotated or resized phone mid-round:** the dial and swipe zones must still map to the new layout, and the camera reframes without a jolt. Test in Task 4.
5. **CPU seats at Relaxed vs Challenge with the same seed** must draw the same number of rng values, so online peers and replays agree. Test in Task 6.

---

### Task 1: Page screen lock

**Files:**
- Create: `src/ui/screenLock.ts`
- Modify: `src/main.ts` (call `installScreenLock()` once at boot)
- Test: `tools/probe-screen-lock.mjs`

**Interfaces:**
- Produces: `installScreenLock(): void`. It is idempotent and blocks `gesturestart`, `gesturechange`, `dblclick`, multi-touch `touchmove` (`touches.length > 1`), and `contextmenu`, all with `{ passive: false }` + `preventDefault`. On `visualViewport` scroll/resize, if `window.scrollX/Y !== 0`, it calls `window.scrollTo(0, 0)`.

- [ ] **Step 1: Write the failing probe.** `tools/probe-screen-lock.mjs` uses a Playwright context with `hasTouch: true`, `isMobile: true`, viewport 390×844. It opens `?seed=7&audio=0&minigame=balloon_pop`, calls `__SSP__.startMatch(...)` and `__SSP__.goto("minigame")`, and waits for `state().screen === "minigame"`. It then sends 20 taps across the screen, a 1-second stick drag on `.ssp-touch` (the left stick), a CDP two-finger pinch (`Input.dispatchTouchEvent` with two points moving apart), and a double tap. After each, it asserts `scrollX === 0 && scrollY === 0 && visualViewport.scale === 1 && visualViewport.offsetTop === 0`. It also asserts `__SSP__.screenLockInstalled() === true`. It prints `PASS screen-lock` or `FAIL <what>` and sets exit code 1 on fail.
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-screen-lock.mjs`. Expected: `FAIL screenLockInstalled` (the hook doesn't exist yet).
- [ ] **Step 3: Implement `installScreenLock()`** in `src/ui/screenLock.ts`, call it in `src/main.ts` before the first screen, and add `screenLockInstalled(): boolean` to the `SSPDebug` API in `src/core/debug.ts`.
- [ ] **Step 4: Run it and see it pass.** Run `node tools/probe-screen-lock.mjs`. Expected: `PASS screen-lock`.
- [ ] **Step 5: Commit.** `git add src/ui/screenLock.ts src/main.ts src/core/debug.ts tools/probe-screen-lock.mjs && git commit -m "Lock the page: no pinch, double-tap zoom or scroll during play"`

### Task 2: Camera lock, minigame probe hook, follow camera

**Files:**
- Create: `src/minigames/followCamera.ts`
- Modify: `src/minigames/balloon_pop/index.ts` (remove `shake`, lines ~177, 650–702, 875, 999–1006), `src/minigames/coin_cannon/index.ts` (remove `shake`, ~169, 714, 886–890, 958), `src/minigames/push_of_war/index.ts` (remove `shakeT/shakeMag`, ~122–123, 479–483, 579), `src/minigames/cake_dash/index.ts` (remove `shakeT`, ~430, 586, 756, 770, 842–846; replace the snap-to-human camera at ~829 with `followCamera`)
- Modify: `src/screens/minigameScreen.ts`, `src/core/debug.ts` (probe hook)
- Test: `tools/probe-camera-lock.mjs`

**Interfaces:**
- Produces: `createFollowCamera(cam: THREE.PerspectiveCamera, opts: { offset: THREE.Vector3; settle?: number }): { update(dt: number, target: THREE.Vector3): void }`. It is critically damped; `settle` defaults to 0.6 s; it looks at `target`. No rng.
- Produces: `__SSP__.mgProbe(): { phase: string; id: string | null; cam: [number, number, number]; ranking: number[] | null; inputs: string[] }`. `ranking` is set when `ctx.finish` runs. `inputs` is filled only by `control_lab` (Task 3).

- [ ] **Step 1: Write the failing probe.** `tools/probe-camera-lock.mjs <id>` (default list: `balloon_pop coin_cannon push_of_war memory_match drum_solo pipe_puzzle quick_draw cake_dash`). For each id: start the minigame, wait for `mgProbe().phase === "play"`, then record `mgProbe().cam` every 50 ms for 6 s while mashing Space and holding an arrow key. For each game except `cake_dash`, assert the largest distance between any two samples is `< 0.001`. For `cake_dash`, assert no per-sample step is over `0.35` world units and the camera never reverses along the course axis by more than `0.05`. Prints `PASS camera <id>` or `FAIL camera <id> maxStep=…`.
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-camera-lock.mjs balloon_pop`. Expected: `FAIL` (`mgProbe` is undefined).
- [ ] **Step 3: Add `mgProbe`** to `SSPDebug` in `src/core/debug.ts`, backed by a small exported state object in `minigameScreen.ts` (phase, id, ranking on finish, live camera position).
- [ ] **Step 4: Run it again.** Expected: `FAIL camera balloon_pop maxStep=…` (the shake is still there).
- [ ] **Step 5: Remove the shake** from balloon_pop, coin_cannon, and push_of_war. Each juice moment keeps its particles and flash; the camera stays on `camBase`.
- [ ] **Step 6: Implement `createFollowCamera`** and use it in cake_dash, following the race leader's course position instead of the human.
- [ ] **Step 7: Run the full list.** Run `node tools/probe-camera-lock.mjs`. Expected: `PASS camera` for all 8.
- [ ] **Step 8: Check the replay.** Run `SSP_SEED=7 SSP_TURNS=30 SSP_GOLDEN=tools/golden/carnival-seed7.json SSP_BOARD=carnival node tools/board-golden.mjs`. Expected: `PASS`. Removing shake must not change any rng draw.
- [ ] **Step 9: Commit.** `git add src/minigames src/screens/minigameScreen.ts src/core/debug.ts tools/probe-camera-lock.mjs && git commit -m "Lock minigame cameras: no shake, smooth follow for Cake Dash"`

### Task 3: Control contract, keyboard mapping, control lab

**Files:**
- Modify: `src/minigames/framework.ts` (types), `src/screens/minigameScreen.ts` (keyboard to new calls), `src/minigames/registry.ts` (`hidden` entries skip the menu and roulette), `src/screens/minigameMenu.ts`
- Create: `src/minigames/control_lab/index.ts` (hidden; records every input call into `mgProbe().inputs`)
- Modify: `src/minigames/index.ts` (append the lab loader)
- Test: `tools/probe-controls-keys.mjs`

**Interfaces:**
- Produces in `framework.ts`:
  - `export type MinigamePad = "hold" | "swipe" | "twin" | "dial" | "draw";`
  - On `Minigame`: `pad?: MinigamePad; padLabels?: { a: string; b: string }; holdMax?: number;`
  - On `MinigameInput`: `hold?(down: boolean, heldSec: number): void; swipe?(dx: number, dy: number, power: number): void; button?(which: "a" | "b", down: boolean): void; dial?(deltaRad: number): void; draw?(phase: "start" | "move" | "end", x: number, y: number): void;`
- Produces on `MinigameEntry`: `hidden?: boolean` (copied from `Minigame.hidden?: boolean`).
- `control_lab`: `pad` is taken from the URL `?pad=` (default `hold`). Every call is pushed as a string, e.g. `"hold:1:0.00"`, `"hold:0:0.80"`, `"swipe:0.00:-1.00:0.50"`, `"button:a:1"`, `"dial:+"`, `"draw:start"`. It finishes after 30 s with ranking `[0,1,2,3]`.

- [ ] **Step 1: Write the failing probe.** `tools/probe-controls-keys.mjs` opens `?minigame=control_lab&pad=<p>` for each pad (desktop viewport) and checks:
  - hold: Space down 800 ms then up gives inputs `["hold:1:0.00", "hold:0:0.80"]` (±0.1). A second run presses Space, fires a `blur` event on the window, and expects a `hold:0:…` entry.
  - swipe: press ArrowUp, hold Space 500 ms, release; expect one `swipe:0.00:-1.00:<p>` with 0 < p ≤ 1.
  - twin: Z down/up then X down/up gives `["button:a:1","button:a:0","button:b:1","button:b:0"]`.
  - dial: E held 1 s gives the sum of `dial` deltas ≈ +1.5 × 2π (±10%); Q gives negative.
  - draw: mouse down, move 10 steps, up gives `draw:start`, ≥5 `draw:move`, `draw:end`.
  It also checks `control_lab` is absent from the MINIGAMES menu (`.ssp-mgmenu [data-id="control_lab"]` is null).
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-controls-keys.mjs`. Expected: `FAIL` (`control_lab` is unknown).
- [ ] **Step 3: Add the types**, the `hidden` filter (menu list, `dealableOnline`/roulette), and the lab module.
- [ ] **Step 4: Map the keyboard** in `minigameScreen.ts` when `pad` is set. hold uses Space down/up plus a window `blur` ending the hold. swipe uses an arrow for direction plus Space hold for power (power = held / 1.0 s, clamped). twin uses Z/← = a and X/→ = b. dial uses Q/← and E/→ at 1.5 turns/s, sent each frame. draw uses mouse drag, or arrows to move a cursor while Space is held. In `pad` mode the old `key()` and `stick()` calls only happen when `steer: true`.
- [ ] **Step 5: Run it and see it pass.** Run `node tools/probe-controls-keys.mjs`. Expected: `PASS` for all five pads.
- [ ] **Step 6: Run the typecheck.** Run `npm run typecheck`. Expected: no errors.
- [ ] **Step 7: Commit.** `git commit -am "Minigame controls: hold, swipe, twin, dial, draw (keyboard) + hidden control lab"` (also add the new files).

### Task 4: Phone UI for each pad

**Files:**
- Modify: `src/ui/touchPad.ts` (`configure` gains `pad`, `padLabels`, `holdMax`; new DOM per pad)
- Modify: `src/screens/minigameScreen.ts` (pass the pad config; route touch-pad events to `MinigameInput`)
- Test: `tools/probe-controls-touch.mjs`

**Interfaces:**
- Consumes: `MinigamePad`, the `MinigameInput` methods (Task 3).
- Produces: `TouchPad.configure(opts: { verb; steer; keys; repeat?; grid?; touchVerb?; pad?: MinigamePad; padLabels?: { a: string; b: string }; holdMax?: number })`.
  - hold: one 120 px button bottom-right with an SVG charge ring that fills over `holdMax`.
  - twin: two 110 px buttons bottom-left and bottom-right; the stick hides unless `steer`.
  - dial: a 170 px wheel bottom-right; the angle delta of the touching pointer around the wheel center goes to `dial()`.
  - swipe: no button; a full-screen layer under the HUD; a gesture becomes a swipe when it travels ≥ 6% of the screen height within 400 ms, with a fading trail.
  - draw: a full-screen layer that sends `draw()` and paints a chalk trail.
  Every element tracks its own `pointerId`, so a second finger never ends another control's gesture.

- [ ] **Step 1: Write the failing probe.** `tools/probe-controls-touch.mjs` uses `hasTouch`/`isMobile` at 390×844 and CDP `Input.dispatchTouchEvent` on `control_lab` for each pad. It asserts the same input strings as Task 3, plus these Review Focus cases:
  - hold, with a second finger: touch 1 holds the button, touch 2 drags the stick (with `steer=1`), then touch 2 lifts. Only one `hold:1` is logged and no `hold:0` arrives before touch 1 lifts.
  - swipe started on a pad button: with `pad=swipe&steer=1`, a swipe starting on the stick logs no `swipe`.
  - rotate: set the viewport to 844×390 mid-round, then dial again. The deltas still sum to the correct direction, and `mgProbe().cam` changes once (reframe) and then stays fixed.
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-controls-touch.mjs`. Expected: `FAIL hold` (no ring button yet).
- [ ] **Step 3: Implement the five pad layouts** in `touchPad.ts`, with styles in its injected sheet and `touch-action: none` on every layer.
- [ ] **Step 4: Run it and see it pass.** Run `node tools/probe-controls-touch.mjs`. Expected: `PASS` for all pads and the three Review Focus cases.
- [ ] **Step 5: Re-run the page lock.** Run `node tools/probe-screen-lock.mjs`. Expected: `PASS screen-lock`.
- [ ] **Step 6: Commit.** `git commit -am "Phone controls for hold, swipe, twin, dial and draw"`

### Task 5: Practice beat and START card for each pad

**Files:**
- Modify: `src/screens/minigameScreen.ts` (the practice teaching per pad: a demo hand animation and a prompt), `src/ui/rulesGuide.ts` (one line per control in MINIGAMES), `src/ui/tips.ts` (a one-time tip per new control)
- Test: `tools/probe-minigame-howto.mjs` (extend)

**Interfaces:**
- Produces: the practice prompts. hold → "HOLD to charge, LET GO to throw". swipe → "SWIPE to flick". twin → "Tap {a} and {b}". dial → "Spin the WHEEL". draw → "DRAW a path". A practice beat completes when the player does the action once (the same rule as today's practice TAP).

- [ ] **Step 1: Extend the probe.** In `tools/probe-minigame-howto.mjs`, for `control_lab` with each `pad`, assert that the practice prompt text matches the list above and that doing the keyboard action once advances to the countdown.
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-minigame-howto.mjs control_lab`. Expected: `FAIL prompt`.
- [ ] **Step 3: Implement the prompts**, the practice completion per pad, the rules-guide lines, and the tips.
- [ ] **Step 4: Run it and see it pass.** Run `node tools/probe-minigame-howto.mjs control_lab`. Expected: `PASS`.
- [ ] **Step 5: Commit.** `git commit -am "Teach each new control in the practice beat"`

### Task 6: CPU control helpers (with Vitest)

**Files:**
- Modify: `package.json` (devDependency `vitest@3.2.4`)
- Create: `src/minigames/cpuControls.ts`, `src/minigames/cpuControls.test.ts`

**Interfaces:**
- Produces (all pure; `rng` is `() => number`; `skill` comes from `cpuSkill()`):
  - `cpuChargeTime(target: number, holdMax: number, skill: number, rng: () => number): number`. Seconds to hold; error sd = `0.12 * holdMax / skill`. Exactly 1 rng draw.
  - `cpuSwipe(aimX: number, aimY: number, power: number, skill: number, rng: () => number): { dx: number; dy: number; power: number }`. Angle error sd `0.18 / skill` rad, power error sd `0.1 / skill`. Exactly 2 draws.
  - `cpuDialRate(ideal: number, skill: number, rng: () => number): number`. rad/s around `ideal * min(1.15, 0.75 + 0.25 * skill)`. Exactly 1 draw.
  - `cpuTwinPeriod(ideal: number, skill: number, rng: () => number): number`. Seconds between alternating presses; jitter sd `0.08 / skill`. Exactly 1 draw.
  - `cpuDrawPath(points: Array<[number, number]>, skill: number, rng: () => number): Array<[number, number]>`. Adds a per-point wobble sd `0.02 / skill`. Exactly `points.length` draws.
  - Normal draws come from a Box–Muller pair built from the counted draws above. The extra draw needed for the pair is counted in each function's draw total.

- [ ] **Step 1: Write the failing tests** in `cpuControls.test.ts`, using a counting seeded rng (mulberry32 from `src/core/rng.ts`):
  - `draw counts match at every skill`: each helper at skill 0.7, 1, and 1.3 consumes the same count, as listed above.
  - `challenge is closer than relaxed`: over 2,000 seeded trials, the mean |error| of `cpuChargeTime` at 1.3 is less than at 1.0, which is less than at 0.7. The same holds for `cpuSwipe` angle error.
  - `same seed, same output`: two runs with the same seed are deep-equal.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/minigames/cpuControls.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `cpuControls.ts`.**
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit.** `git add package.json package-lock.json src/minigames/cpuControls.ts src/minigames/cpuControls.test.ts && git commit -m "Seeded, skill-scaled CPU helpers for the new controls"`

### Tasks 7–11: Wave 1 games

Each game task has the same shape. Only the facts below differ.

**Files (per game `<id>`):**
- Create: `src/minigames/<id>/index.ts` (exports `load<Pascal>(): Minigame`), `src/minigames/<id>/environment.ts`
- Modify: `src/minigames/index.ts` (append the loader under `// ---- Fifty: Wave 1 ----`), `src/minigames/packRules.ts` (`PACK_OF_MINIGAME`)
- Create: `public/minigames/<id>.webp`, `<id>-thumb.webp`, plus a clip via `node tools/capture-minigame-clips.mjs <id>`
- Test: `tools/probe-mg-<id>.mjs`

**Interfaces:**
- Consumes: `pad` and the `MinigameInput` methods (Task 3), `cpuControls` (Task 6), `frameMinigame` (existing), `createFollowCamera` (Task 2, travel races only), `cpuSkill()`, and `ctx.hud`, `ctx.finish`, `ctx.rng`.

**Steps (per game):**
- [ ] **Step 1: Write the failing probe** `tools/probe-mg-<id>.mjs`. It runs the game twice with `?seed=7&autoplay=1&audio=0&minigame=<id>` and asserts:
  - `mgProbe().ranking` has all 4 ids (all 2 for a duel), and it is the same on both runs.
  - The round lasts 30–60 s of game time.
  - There are no page errors.
  - The camera check from Task 2 passes (fixed, or the follow limits for races).
  - With the CPU level set to Relaxed and then Challenge (set `localStorage["ssp.cpuLevel"]` before load, as `src/config/cpuLevel.ts` reads it), the round still ends with a full ranking. Run the game once at each level: the Challenge winner's score must be at least the Relaxed winner's score.
- [ ] **Step 2: Run it and see it fail.** Run `node tools/probe-mg-<id>.mjs`. Expected: `FAIL unknown minigame`.
- [ ] **Step 3: Build the game.** Implement the rules, environment, CPU, HUD, `howTo`, `goal`, and `rules` from the facts below.
- [ ] **Step 4: Run it and see it pass.** Run `node tools/probe-mg-<id>.mjs`. Expected: `PASS`.
- [ ] **Step 5: Capture the menu art.** Run `node tools/capture-minigame-clips.mjs <id>` and check that the three files exist in `public/minigames/`.
- [ ] **Step 6: Commit.** `git add src/minigames/<id> src/minigames/index.ts src/minigames/packRules.ts public/minigames/<id>* tools/probe-mg-<id>.mjs && git commit -m "<Name>: new minigame (<pad>)"`

#### Task 7: Slingshot Summit (`slingshot_summit`)
- pad `hold`, `holdMax` 1.2 s, steer `true` (aim left/right). Format ffa, genre target, pack midway, 45 s.
- Rules: each player has a slingshot on their own branch. Hold to pull back; the pull time sets the distance. Three swaying targets per lane (rings worth 1/3/5). An acorn landing in a ring scores that ring's value. Most points wins. Ties are broken by the most 5s.
- CPU: picks a ring (5 when skill ≥ 1, else a weighted pick), computes `cpuChargeTime(targetCharge, 1.2, skill, rng)`, and fires every `1.4 / skill` s.
- World: treetop canopy village with rope bridges, lanterns, and leaf particles.
- howTo: "Hold to pull your slingshot, let go to fire. Land acorns in the rings." goal: "Most points in 45 seconds."

#### Task 8: Pie Flick (`pie_flick`)
- pad `swipe`, steer `false`. Format ffa, genre target, pack sideshow, 50 s.
- Rules: four counters, one per player, each with three stools where customers sit holding an order color. Swipe up the counter; the swipe angle picks the stool and the power sets the distance. A pie stopping in front of the right customer scores 1. One that slides off the end scores 0, and a pie at the wrong stool is −1. Most served wins.
- CPU: chooses a stool, then `cpuSwipe(aimToStool, powerForStool, skill, rng)` every `1.6 / skill` s.
- World: 1950s roadside diner: checkered floor, neon sign, jukebox, steam from the pie case.
- howTo: "Swipe pies up the counter. Aim for the customer whose order matches." goal: "Serve the most pies."

#### Task 9: Row Row Rumble (`row_rumble`)
- pad `twin`, padLabels `{ a: "LEFT", b: "RIGHT" }`. Format 2v2, genre race, pack bigtop, ~40 s. Uses `createFollowCamera` following the leading canoe's river progress.
- Rules: two canoes, two paddlers each. Each player alternates LEFT/RIGHT. A correct alternation within 0.25–0.7 s gives a stroke; the same side twice yaws the canoe toward rocks (a collision slows it for 1 s). Team speed is the sum of both paddlers' stroke rates. The first canoe past the flag wins. `coinWinners` is the winning team.
- CPU: alternates at `cpuTwinPeriod(0.42, skill, rng)`; when yaw > 10°, it strokes the correcting side twice.
- World: jungle river rapids with waterfalls, vines, parrots, and spray particles. The camera follows down-river with no shake.
- howTo: "Tap LEFT and RIGHT in turn to paddle. Same side twice turns the canoe." goal: "Your canoe crosses the finish first."

#### Task 10: Crank Coaster (`crank_coaster`)
- pad `dial`. Format ffa, genre race, pack midway, ≤ 45 s (ends when the first cart tops the hill, or at 45 s by height).
- Rules: each cart rises with total crank angle. Cranking faster than 2.2 turns/s builds heat; at full heat the chain jams for 1.5 s. Ranking is by height at the end.
- CPU: cranks at `cpuDialRate(2.0 * 2π, skill, rng)` rad/s and eases off when heat > 80%.
- World: abandoned gold mine with timber trestles, lanterns, glinting ore, and a heat gauge on each crank.
- howTo: "Spin the wheel to crank your cart up. Too fast and the chain jams!" goal: "First cart to the top."

#### Task 11: Chalk Trails (`chalk_trails`)
- pad `draw`. Format ffa, genre collect, pack sideshow, 45 s.
- Rules: each player owns a snail and one corner quadrant. The player draws a path; the snail follows the latest path at a fixed speed, collecting gems. Every 10 s a rain band sweeps across and erases all chalk, and snails stop until a new path is drawn. Gems respawn by seeded rng. Most gems wins.
- CPU: plans a nearest-gem tour of up to 4 gems and draws it with `cpuDrawPath(points, skill, rng)`; redraws after each rain.
- World: a sidewalk park after school with hopscotch squares, chalk buckets, and a passing rain cloud with puddles.
- howTo: "Draw a path with your finger. Your snail follows it to the gems." goal: "Collect the most gems before the rain."

### Task 12: CI and release wiring

**Files:**
- Modify: `.github/workflows/check.yml`. After "Dev server", add steps for `npx vitest run`, `node tools/probe-screen-lock.mjs`, `node tools/probe-controls-keys.mjs`, and `node tools/probe-camera-lock.mjs`. Per-game probes run nightly, not per PR, to keep the PR job under its 60-minute limit.
- Modify: `RULES_ALIGNMENT.md` if it lists the minigame roster (add the five games).

- [ ] **Step 1: Run every new probe locally** against the dev server. Expected: all `PASS`.
- [ ] **Step 2: Run `npm run build`.** Expected: success.
- [ ] **Step 3: Commit and push.** `git commit -am "CI: screen lock, controls and camera probes; Vitest" && git push -u origin <branch>`. Then watch the `check` run and fix anything red before calling Plan 1 done.
