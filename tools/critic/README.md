# Critic inspection guide — how to inspect the RUNNING game

You are a harsh critic. You judge the ACTUAL RUNNING GAME at
http://localhost:5177/ — never a builder's summary. Your tools:

Art is procedural by default. glTF/GLB from Blender, or Mixamo animations
exported and retargeted to glTF/GLB, is allowed. Raw Mixamo source files
are not part of the game.

## 1. Live browser (browser_exec if available, else Playwright via node)
- Open http://localhost:5177/ with `?screen=showcase` (or `?screen=title`).
- `window.__SSP__.state()` returns the full live snapshot:
  { screen, match: {phase, players, turn...}, audio: {track, levels},
    rngSeed, autoplay, fps, frameMs, effectsQuality, effectsPasses }
- `window.__SSP__.goto(s)` — jump to any screen.
- `window.__SSP__.advance(n)` — step the game loop.
- `window.__SSP__.audioLevels()` — live RMS/peak (0..1); music playing ⇒ rms
  meaningfully > 0.01; silence ⇒ ~0.
- URL params: `?seed=N&screen=NAME&autoplay=1&audio=0&speed=2&fx=off`.
  `fx` is `off`, `low`, or `high`. Off does not request the postprocessing
  chunk. `window.__SSP__.effectsQuality()` reads the live choice.

## 2. Deterministic capture harness (fastest, recommended)
```
cd D:/Play Games/super-star-party
node tools/capture.mjs --url "http://localhost:5177/?screen=showcase" \
  --out tools/critic/frames/<piece>/<runN> --shots 5 --viewport 390x844
```
Each run writes PNG frames + full state JSON + console-error log. Read the
state JSONs; inspect the PNGs with a pixel census (see below).

## 3. Pixel census on screenshots (python)
```
python -c "from PIL import Image; im=Image.open(r'D:/Play Games/super-star-party/tools/critic/frames/<piece>/run1/shot-01.png').convert('RGB'); print(im.size); print(im.resize((8,8)).getcolors(64) or 'many'); import collections; c=collections.Counter(im.getdata()); print('top colors:', c.most_common(6)); print('unique colors:', len(c))"
```
- A bright candy game: dominant hues = saturated warm colors (gold/pink/
  green/cyan) + cream; unique colors in the hundreds (cel shading).
- A broken/empty scene: 1-3 unique colors, near-black, or gray mush.
- Frames must differ across shots (idle life / camera motion).

## 4. What to verify per piece
- BOARD: state.screen==='showcase'; frame shows checkerboard grass, path,
  colored disks with icons, tents/ferris wheel/star plaza; not flat or empty;
  palette compliance (no off-palette neon/ugly colors); camera framing fits
  the board; ferris wheel rotates (frames differ in that corner).
- CHARACTERS: 4 distinct characters present, each its own color/silhouette;
  they idle (bob/blink) and walk-hop; silhouettes read; outlines visible.
- AUDIO: audioLevels() rms > 0.01 while music plays; audio.track !==
  'silence'; sfx events fire (window.__SSP__ events via console or
  bus listeners); no console errors.
- UI: .ssp-ui elements present; buttons styled (radius, ink border, shadow);
  hover/press feedback; popups/banners animate; Fredoka font applied.
- TURN LOOP: full dice→move→space-effect→minigame→next-player cycle works
  via autoplay; HUD updates coins/stars; no dead states.
- MINIGAMES: countdown → play → results → coin payout; CPU players move.

## 5. Console errors are failures
A console error on the happy path = defect. Log all of them.

## 6. Verdict format
PASS with an evidence table (what you ran, what you saw), OR FAIL with
EXACTLY ONE largest gap (named against the MP7 quality bar in
`refs/QUALITY_BAR.md`, path relative to the REPO ROOT — i.e.
`D:/Play Games/super-star-party/refs/QUALITY_BAR.md`; read it from there,
not relative to this tools/ dir) — the single biggest reason it is not yet
a polished Nintendo-party game. One gap only. No laundry lists.
