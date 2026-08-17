// SUPER STAR PARTY — audio self-check (pure node, no browser).
// Imports the REAL track-data + instrument modules (Node >= 22.6 with
// --experimental-strip-types; tracks.ts and instruments.ts are DOM-free
// erasable TS) and statically validates the SFX registry keys.
//
// Run:  node --experimental-strip-types tools/audio-selfcheck.mjs
// Exit code 0 = all checks pass. Prints an ASCII report.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsUrl = (rel) => pathToFileURL(join(root, "src", "audio", rel)).href;
let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

console.log("SUPER STAR PARTY audio self-check");
console.log("=================================");

/* ------------------------------------------------------------------ */
/* 1. Track data via real module import                                */
/* ------------------------------------------------------------------ */
let T = null;
try {
  T = await import(tsUrl("music/tracks.ts"));
  ok("imported src/audio/music/tracks.ts (real parse, all bars validated at load)");
} catch (e) {
  bad(`could not import tracks.ts: ${e.message}`);
}

let VOICES = null;
try {
  VOICES = (await import(tsUrl("music/instruments.ts"))).VOICES;
  ok("imported src/audio/music/instruments.ts (voice styles)");
} catch (e) {
  bad(`could not import instruments.ts: ${e.message}`);
}

const REQUIRED_TRACKS = [
  "title", "board", "minigame_a", "minigame_b", "happening", "grumpus",
  "shop", "results", "star_fanfare", "minigame_intro", "win", "lose",
];

if (T) {
  const ids = T.trackIds();
  for (const id of REQUIRED_TRACKS) {
    if (!ids.includes(id)) bad(`track '${id}' missing from registry`);
  }
  ok(`track registry: ${ids.length} tracks (${ids.join(", ")})`);

  let totalEvents = 0;
  let totalBars = 0;
  console.log("");
  console.log("track               bpm  swing  bars  loop   len(s)  voices  events");
  for (const id of ids) {
    const def = T.TRACKS[id];
    const parsed = T.parseTrack(def);
    const bars = parsed[0].barCount;
    const events = parsed.reduce(
      (n, v) => n + v.bars.reduce((m, b) => m + b.filter((e) => e.kind !== "rest").length, 0),
      0,
    );
    totalEvents += events;
    totalBars += bars;
    const lenS = def.loop ? "inf" : ((bars * 4 * 60) / def.bpm).toFixed(2);
    const styles = [...new Set(parsed.map((v) => v.style))].join(",");
    const extra = parsed.filter((v) => v.layer !== "base").length;
    console.log(
      `${id.padEnd(20)} ${String(def.bpm).padStart(4)}  ${def.swing.toFixed(2)}  ${String(bars).padStart(4)}  ${def.loop ? "yes " : "no  "}  ${String(lenS).padStart(6)}  ${String(parsed.length).padStart(6)}  ${String(events).padStart(6)}  [${styles}]${extra ? ` +${extra} layer voices` : ""}`,
    );

    // MIDI range sanity
    for (const v of parsed) {
      for (const b of v.bars) {
        for (const e of b) {
          if (e.kind === "note" && e.freqs.length > 0) {
            const midi = Math.round(69 + 12 * Math.log2(e.freqs[0] / 440));
            if (midi < 21 || midi > 108) {
              bad(`${id}: note ${e.token} out of MIDI range (${midi})`);
            }
          }
        }
      }
    }

    // voice styles exist
    if (VOICES) {
      for (const v of parsed) {
        if (v.style !== "drums" && !VOICES[v.style]) {
          bad(`${id}: unknown instrument style '${v.style}'`);
        }
      }
    }
  }
  console.log(`  total: ${totalBars} bars, ${totalEvents} scheduled events across ${ids.length} tracks`);
  console.log("");

  // swing sanity
  for (const id of ids) {
    const s = T.TRACKS[id].swing;
    if (s < 0.5 || s > 0.75) bad(`${id}: swing ${s} outside 0.5..0.75`);
  }
  ok("swing values within 0.5..0.75");
}

/* ------------------------------------------------------------------ */
/* 2. SFX registry (static scan of sounds.ts)                          */
/* ------------------------------------------------------------------ */
console.log("");
let sfxKeys = [];
try {
  const src = readFileSync(join(root, "src", "audio", "sfx", "sounds.ts"), "utf8");
  const objStart = src.indexOf("export const SFX:");
  const obj = src.slice(objStart, src.indexOf("};", objStart) + 2);
  // top-level registry entries: exactly-2-space indented `"name": x,` or `name,`
  const re = /^  (?:"([a-z][a-z0-9.]*)"|([a-z][a-z0-9.]*))(?::|,)/gm;
  let m;
  while ((m = re.exec(obj)) !== null) sfxKeys.push(m[1] ?? m[2]);
  ok(`sfx registry parsed statically: ${sfxKeys.length} sounds`);
} catch (e) {
  bad(`could not scan sounds.ts: ${e.message}`);
}

const REQUIRED_SFX = [
  "ui.click", "ui.back", "dice.roll", "dice.land", "coin.gain", "coin.lose",
  "star.get", "jump", "hop", "land", "sad", "cheer", "boing", "whoosh", "pop",
  "fanfare.win", "fanfare.lose", "minigame.go", "minigame.count",
  "grumpus.laugh", "happening.magic", "shop.buy", "whistle",
  "crowd.cheer", "crowd.aah",
];
for (const name of REQUIRED_SFX) {
  if (!sfxKeys.includes(name)) bad(`required sfx '${name}' missing`);
}
ok(`all ${REQUIRED_SFX.length} contract-required sfx present (+${sfxKeys.length - REQUIRED_SFX.length} extra: ${sfxKeys.filter((k) => !REQUIRED_SFX.includes(k)).join(", ")})`);
console.log(`  sfx list: ${sfxKeys.join(", ")}`);

/* ------------------------------------------------------------------ */
/* 3. Chord table sanity                                               */
/* ------------------------------------------------------------------ */
console.log("");
if (T) {
  for (const [name, midis] of Object.entries(T.CHORDS)) {
    for (const midi of midis) {
      if (midi < 21 || midi > 96) bad(`chord ${name}: midi ${midi} out of range`);
    }
  }
  ok(`chord table: ${Object.keys(T.CHORDS).join(", ")}`);
}

console.log("");
if (failures === 0) {
  console.log("RESULT: ALL CHECKS PASSED");
  process.exit(0);
} else {
  console.log(`RESULT: ${failures} FAILURE(S)`);
  process.exit(1);
}
