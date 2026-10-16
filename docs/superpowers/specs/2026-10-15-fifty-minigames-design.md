# Fifty New Minigames — Design

Date: 2026-10-15. Status: approved in chat (full quality, built in waves; new controls chosen; screen lock added).

## Intent

What the player asked for:
- 50 new minigames, each unique: **new controls, new ways to win, new worlds**.
- **Full quality (option A)** for every game, built in waves.
- New control styles: **hold-and-release, swipe/flick, two buttons, rotate/dial**, and **drag/draw**. Phone tilt stays out (desktop and some phones cannot use it).
- **The screen is locked during play.** Tapping or moving the stick must never move the page or jolt the camera.

Assumptions (not said by the player, correct me):
- A game is "full quality" when it matches Cork Quick-Draw: its own environment, CPU players at Relaxed/Normal/Challenge, a practice beat, START card text, a menu picture and clip, and a deterministic seeded round.
- Games are dealt by the existing roulette like today. 1v1 duels stay menu-only, as `quick_draw` is.
- Online play keeps today's model: each phone runs the round locally and the host publishes the official result (`OfficialMinigame`). New controls need no network messages.

## Success criteria

1. All 50 games are playable from the MINIGAMES menu and on the board, on a phone (touch) and on a keyboard.
2. Every game's controls differ from the game before it in its wave, and no two games share the same pairing of control and win condition.
3. During any game, taps, stick moves, swipes, dial turns, and drawing never scroll or zoom the page and never shake the camera.
4. A seeded round at each CPU level gives the same result every time (same `ctx.rng` draws).
5. CI stays green: typecheck, build, the existing probes, and the new screen-lock and per-game probes.

## Screen lock

Two layers, both required:

1. **Page lock** (`src/ui/screenLock.ts`, installed once at boot): blocks pinch and double-tap zoom, iOS `gesturestart`, multi-finger scroll, and context-menu long-press, and resets any `visualViewport` scroll back to 0. `index.html` already sets `touch-action: none`, `overscroll-behavior: none` and `position: fixed` on the body. The lock enforces this from script too, because Safari ignores parts of it.
2. **Camera lock** (minigame rule): a minigame camera is placed by `frameMinigame()` and **does not move because of input**. No camera shake anywhere. Hits and pops use flashes, particles, and squash on the objects instead. A race that must travel may move its camera along the course with the shared smooth follow (`followCamera()`, critically damped, settle 0.6s). It follows the **course progress of the leader**, never a raw stick value, and never oscillates.

Existing games that break the camera lock get fixed in Plan 1: Balloon Pop (pop shake), Push of War (push shake), Coin Cannon (shake), and Cake Dash (shake and the snap-to-human camera).

## New controls

Each control is a `pad` value on the `Minigame`. The framework draws the phone UI, maps the keyboard, runs a practice beat that teaches it, and calls the matching optional method on `MinigameInput`. Games read only those calls, so CPU seats and humans go through the same game code.

| pad | Phone | Keyboard | MinigameInput call |
|---|---|---|---|
| `hold` | One big button with a charge ring. Hold to charge, release to act. | Hold Space, release | `hold(down: boolean, heldSec: number)`. `heldSec` is 0 on down and capped at `holdMax` (default 1.5s) on release. |
| `swipe` | The whole play area is a swipe zone with a fading trail. No buttons. | Arrows set direction; hold Space for power, release to fire | `swipe(dx, dy, power)`. `dx, dy` is a unit vector in screen space (+y down); `power` is 0..1 (screen speed ÷ 3 screens/s, clamped). |
| `twin` | Two big buttons, left and right, labeled by the game (for example PADDLE L / PADDLE R) | Z or ← = A, X or → = B | `button(which: "a" \| "b", down: boolean)` |
| `dial` | A wheel on the right. Turning a finger around it turns the dial. | Q/E or ←/→ turn at 1.5 turns/s | `dial(deltaRad: number)` each frame. Clockwise is positive. |
| `draw` | Draw on the play area with one finger. The path is shown as chalk. | Mouse drag; or arrows move a cursor and Space held draws | `draw(phase: "start" \| "move" \| "end", x, y)`. Normalized 0..1 screen coordinates, at most one `move` per 1/60s. |

A `pad` game may also set `steer: true` to keep the MOVE stick on the left (for example `swipe` with movement in Snowball Siege). `tap`/`steer` games are unchanged.

CPU players use `src/minigames/cpuControls.ts`. It provides seeded, skill-scaled helpers per control (charge time to hit a target, swipe aim error, dial rate, path waypoints). Skill comes from `cpuSkill()`, and the helpers draw from `ctx.rng` the same number of times at every level.

## Definition of done (every game)

- A module at `src/minigames/<id>/index.ts`, with its environment in `environment.ts` when the scene is large. Registered in `MINIGAME_MODULES`, `PACK_OF_MINIGAME`, and `DUEL_MINIGAMES` if it is 1v1.
- `howTo`, `goal`, `rules` (format, length, win, touch, keys), and `pad` or `tap`/`steer` filled in.
- 30–60 s rounds. Calls `ctx.finish(ranking, coinWinners?)` exactly once.
- CPU at three levels via `cpuSkill()` / `cpuControls`. All randomness comes from `ctx.rng`.
- A fixed camera (or `followCamera` for travel races). No shake.
- A menu picture `public/minigames/<id>.webp`, a thumbnail `<id>-thumb.webp`, and a clip, made with `tools/capture-minigame-clips.mjs`.
- `tools/probe-mg-<id>.mjs` passes. It checks that the round ends with a full ranking, the results are the same on two runs with the same seed, there are no page errors, and the camera does not move from input (or moves within follow limits).

## Roster (50 games, 10 waves of 5)

Format: ffa = free-for-all, 1v3, 2v2, 1v1. Pack: midway / sideshow / bigtop. Genres reuse today's set.

| # | id | Name | Controls | Way to win | World | Format | Genre | Pack |
|---|---|---|---|---|---|---|---|---|
| **Wave 1: one game per new control** |
| 1 | slingshot_summit | Slingshot Summit | hold | Most points landing acorns on swaying treetop targets | Treetop canopy village | ffa | target | midway |
| 2 | pie_flick | Pie Flick | swipe | Most pies slid down the counter into the right customer's hands | Retro roadside diner | ffa | target | sideshow |
| 3 | row_rumble | Row Row Rumble | twin | First canoe to the finish; alternate paddles, same-side strokes turn you | Jungle river rapids | 2v2 | race | bigtop |
| 4 | crank_coaster | Crank Coaster | dial | First cart to the top of the lift hill; cranking too fast jams the chain | Abandoned gold mine | ffa | race | midway |
| 5 | chalk_trails | Chalk Trails | draw | Most gems collected by your snail along the path you draw before rain washes it away | Sidewalk park after school | ffa | collect | sideshow |
| **Wave 2** |
| 6 | bubble_bath | Bubble Bath Blast | hold | Trap the most rubber ducks; bigger bubbles drift slower | Giant bubble bathtub | ffa | collect | bigtop |
| 7 | snowball_siege | Snowball Siege | swipe + stick | Last team with a standing snow fort | Arctic snowfield | 2v2 | survival | midway |
| 8 | robo_rumble | Robo Rumble | twin (punch/block) | Knock the other robot's head off first | Scrapyard ring | 1v1 | survival | sideshow |
| 9 | pottery_spin | Pottery Spin | dial + tap | Closest vase to the target silhouette | Artisan clay studio | ffa | timing | bigtop |
| 10 | sky_writers | Sky Writers | draw | Most accurate traced shape in smoke | Above the clouds at sunset | ffa | puzzle | midway |
| **Wave 3** |
| 11 | lantern_launch | Lantern Launch | hold | Lantern stops closest to the target height, best of 3 | Night festival lake | ffa | timing | sideshow |
| 12 | kitty_curling | Kitty Curling | swipe + twin (sweep) | Team cushion closest to the button after 4 ends | Ice palace | 2v2 | target | bigtop |
| 13 | seesaw_scramble | Seesaw Scramble | twin (lean L/R) | Solo keeps the tower standing 40 s; three droppers try to topple it | Circus big ring | 1v3 | survival | midway |
| 14 | safe_crackers | Safe Crackers | dial | First to open the vault by stopping on each click | Bank vault heist | ffa | memory | sideshow |
| 15 | mirror_maze | Mirror Maze | draw (place mirrors) | First laser to light your crystal | Space station lab | ffa | puzzle | bigtop |
| **Wave 4** |
| 16 | cannon_cove | Cannon Cove | hold + stick aim | Last pirate ship afloat | Tropical cove | ffa | survival | midway |
| 17 | paper_planes | Paper Plane Derby | swipe launch + stick glide | Farthest flight through rings | Schoolyard rooftops | ffa | race | sideshow |
| 18 | tandem_trouble | Tandem Trouble | twin (pedal rhythm with partner) | First tandem across the countryside | Countryside lanes | 2v2 | rhythm | bigtop |
| 19 | twister_tag | Twister Tag | dial (spin up) + stick | Push others off the mesa; last spinning | Desert mesa | ffa | survival | midway |
| 20 | ink_islands | Ink Islands | draw (paint) | Most canvas covered in your color | Giant museum canvas | ffa | collect | sideshow |
| **Wave 5** |
| 21 | bungee_bounce | Bungee Bounce | hold (dive timing) | Most coins grabbed at the low point without a splash | Red-rock canyon | ffa | timing | bigtop |
| 22 | fly_swatter | Fly Swatter | swipe | Most flies swatted; swatting a ladybug costs points | Summer picnic table | ffa | target | midway |
| 23 | hot_potato | Hot Potato Juggle | twin (left/right hand toss) | Not holding the potato when it pops | Volcano kitchen | ffa | survival | sideshow |
| 24 | ferris_fix | Ferris Wheel Fix | dial | Most riders loaded by lining cars up with the platform | Fizzy Fairground | 2v2 | timing | bigtop |
| 25 | rail_riders | Rail Riders | draw (lay track live) | Most passengers picked up without derailing | Toy-room floor | ffa | collect | midway |
| **Wave 6** |
| 26 | pinball_pals | Pinball Pals | twin (flippers) | Fewest balls let into your goal | Neon arcade cabinet | ffa | survival | sideshow |
| 27 | kite_fight | Kite Fight | dial (reel) + stick | Last kite flying; crossing strings cuts | Windy hilltop | ffa | survival | bigtop |
| 28 | wind_archers | Wind Archers | hold (draw bow) + stick | Highest total over 5 arrows with gusts | Medieval tournament field | ffa | target | midway |
| 29 | sushi_slide | Sushi Slide | swipe | Team that serves the most matching orders | Conveyor sushi bar | 2v2 | collect | sideshow |
| 30 | glow_garden | Glow Garden | draw (vines) | Most flowers bloomed by linking fireflies | Enchanted forest at night | ffa | puzzle | bigtop |
| **Wave 7** |
| 31 | bean_bag_bonanza | Bean Bag Bonanza | swipe (arc toss) | First team to exactly 21 | Backyard barbecue | 2v2 | target | midway |
| 32 | space_dock | Space Dock | twin (left/right thrusters) | Softest docking, fastest time breaks ties | Low orbit station | ffa | timing | sideshow |
| 33 | cotton_candy | Cotton Candy Spin | dial | Biggest cone before it collapses | Big-top concession | ffa | timing | bigtop |
| 34 | avalanche_escape | Avalanche Escape | draw (solo carves chutes) vs stick (runners) | Runners reach the lodge, or the solo catches them all | Snowy peak | 1v3 | survival | midway |
| 35 | pogo_peaks | Pogo Peaks | hold (jump height) | Last one standing on the crumbling pillars | Floating sky islands | ffa | survival | sideshow |
| **Wave 8** |
| 36 | dj_scratch | DJ Scratch | dial (scratch patterns) | Best rhythm accuracy | Rooftop night party | ffa | rhythm | bigtop |
| 37 | hover_hockey | Hover Hockey | stick + swipe (shoot) | Most goals in 60 s | Neon hover rink | 2v2 | target | midway |
| 38 | rocket_relay | Rocket Relay | twin (stage separation timing) | Highest altitude | Seaside launchpad | ffa | timing | sideshow |
| 39 | bridge_builders | Bridge Builders | draw (planks) | Critter crosses using the fewest planks | Canyon gap | ffa | puzzle | bigtop |
| 40 | tightrope_trot | Tightrope Trot | hold (step) + twin (lean) | Farthest along the wire | Big-top high wire | ffa | survival | midway |
| **Wave 9** |
| 41 | reel_frenzy | Reel Frenzy | dial (reel) + hold (tension) | Heaviest total catch | Misty mountain lake | ffa | collect | sideshow |
| 42 | dodgeball_duel | Dodgeball Duel | swipe (throw) + twin (dodge) | First to 3 hits | School gym | 1v1 | target | bigtop |
| 43 | ghost_lantern | Ghost Lantern | 1 ghost: stick; 3 hunters: hold (flash beam) | Hunters reveal the ghost 3 times, or the ghost survives | Haunted manor | 1v3 | survival | midway |
| 44 | lily_leap | Lily Leap | swipe (hop distance) | First frog across the pond | Lily-pad swamp | ffa | race | sideshow |
| 45 | domino_dash | Domino Dash | draw (domino line) | Your chain rings the bell first | Wooden toy workshop | 1v1 | puzzle | bigtop |
| **Wave 10** |
| 46 | volcano_volley | Volcano Volley | twin (bump/spike) | First team to 7 points | Volcano beach | 2v2 | timing | midway |
| 47 | pancake_flip | Pancake Flip | swipe (flick up) | Most pancakes stacked on the plate | Breakfast diner griddle | ffa | timing | sideshow |
| 48 | clock_climb | Clock Tower Climb | dial (turn gears) | First to the bell; avoid the hands | Inside a giant clock tower | ffa | race | bigtop |
| 49 | meteor_miners | Meteor Miners | hold (drill charge) + stick | Team with the most gem value | Drifting asteroid | 2v2 | collect | midway |
| 50 | star_parade | Star Parade | All five controls, one station each | Most stars over five stations | Super Star stage | ffa | collect | sideshow |

## Build order

- **Plan 1:** screen lock, camera lock fixes, the five new controls (UI, keyboard, practice, CPU helpers), and Wave 1.
- **Plans 2–10:** one plan per wave, each using Plan 1's template. A wave ships when all five probes pass and CI is green.

## Out of scope

Phone tilt controls, new network messages, new board spaces, and changes to minigame payouts (they stay 10/6/3/0).
