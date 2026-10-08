# QUALITY BAR — Mario Party 7 as the named reference

Every piece of SUPER STAR PARTY is judged against the actual feel of Mario
Party 7 (GameCube, 2005, Hudson Soft). The bar is not "a fun game" — it is
"does this feel like a polished Nintendo-party game". Critics compare blind
and side-by-side (our running game vs. remembered MP7 feel) and name the
single biggest gap when we lose.

## Assets

Procedural meshes, textures, animation, and audio are the default. glTF/GLB
is allowed: models authored in Blender, and Mixamo animations exported and
retargeted into glTF/GLB. Commit the exported glTF/GLB only. Raw Mixamo
source files do not belong in the repo.

## 1. Colors & look
- Bright, saturated candy palette on cream/warm neutrals; deep violet-ink
  outlines and shadows give everything a printed-cartoon weight.
- Cel shading: hard 2–3 band lighting, no muddy gradients, no photoreal PBR.
- Every surface reads instantly: grass checkerboard, sandy path, red/white
  carnival tents, gold star iconography.
- UI chrome: chunky rounded buttons, thick ink borders, hard drop shadows
  (offset solid, not blur), comic-bold type. Zero default-browser look.

## 2. Juice (the feel of every action)
- Dice roll: drumroll anticipation → zoom punch → slam landing with shake +
  bounce. Never a flat number pop.
- Coins: sparkle burst + cha-ching + counter tween. Coins are the party's
  heartbeat — every gain/loss is a moment.
- Star: fanfare, fireworks, character dance, camera pull, "STAR!" banner.
  Buying a star is the emotional peak of a turn.
- Movement: hop-hop-hop with squash-and-stretch, landing bounce, facing
  direction, small dust puffs.
- Screen transitions: curtain/starburst wipes, not fades.
- Hit-stop, camera shake, and confetti on wins, fails, and big moments.
- Nothing waits silently: idle animations, crowd ambience, character banter.

## 3. Sounds & music (broadcast-quality; procedural synthesis is the default)
- Music: catchy melodic hooks (party swing, ~120–140 BPM), bass-led, layered
  drums, key-change lift on big moments, crowd cheer layers. Tracks: title,
  board, minigame A/B, happening, grumpus, shop, results, win fanfare.
- Music responds: intensity layers, stingers on star/minigame-win.
- SFX: crunchy cartoon synthesis — coin cha-ching, dice rattle, boings,
  pops, whistle, crowd ooh/aah, Grumpus laugh, win fanfare. Every UI click
  has a sound. No silent interactions, no robotic anything.
- Measured: mixes mastered to ~−14 LUFS loudness target; music never
  drowns SFX; audio levels() prove it's live.

## 4. Mechanics & playstyle
- Rules transparent: spaces explain themselves on landing (icon + label).
- Dramatic randomness: dice suspense, chance events, comeback potential.
- CPU players are credible personalities (not braindead, not psychic):
  they win sometimes, celebrate, sulk.
- Pacing: a full turn takes ~20–30 s; no dead air, no long waits.
- Simple generous inputs: tap/swipe/keyboard, forgiving timing, big targets.
- Rubber-band fairness: a losing player always has a path back (happening
  luck, grumpus stealing from the leader).

## 5. Win feel
- Results podium: rankings with confetti rain, fanfare, winner dance,
  crown, "WINNER!" banner, characters react (cheer/sulk).
- Bonus stars announced with ceremony ("The Mini Star goes to...").
- Post-match: replay invitation, music resolves, nothing hangs.

## 6. Mobile
- Portrait and landscape both playable; touch targets ≥ 48px; safe-area
  aware; 60 fps on a phone-class GPU; no text smaller than readable at arm's
  length. Landscape is the primary board view; portrait reframes the camera.

## Verdicts
PASS = "this would ship in a Nintendo party game." FAIL = exactly ONE
largest gap, named with the metric it fails, relayed verbatim to the builder.
