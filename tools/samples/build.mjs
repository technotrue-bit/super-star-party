// SUPER STAR PARTY — offline sample pipeline. Run by hand, never in CI.
//
//   node --experimental-strip-types tools/samples/build.mjs [--ranges] [--set <id>]... [--force]
//
// --ranges  reports, per played track, the notes its instruments' built zones do not cover (note +
//           voice transpose, +1 on board.* tracks for the lift; a note is covered when its nearest
//           root is within maxShift) and drum tokens with no zone. Voices still on synth styles
//           count through each instrument's `replaces` list. Task 8 re-voices what it lists.
// otherwise builds the chosen sets (every set in instruments.json when no --set is given):
//   1. fetches each source into tools/samples/.cache/ at its pinned commit or checksum
//   2. per kept zone: downmix to mono, shift a derived root, resample to 48 kHz, trim to 2 ms before
//      the attack, cut to the max length with a fade
//   3. matches loudness across an instrument's zones (per-token levels on kits)
//   4. encodes Opus/WebM and AAC/M4A and checks both decode at the expected length; a zone whose
//      inputs are unchanged since the last build (build-state.json) is skipped unless --force
//   5. writes public/music/<set>/<instrument>/<root|token>[-v<layer>][-r<rr>].<hash8>.webm|.m4a,
//      src/audio/samples/instruments.gen.ts, zones.gen.ts and public/music/CREDITS.txt, prints the
//      sizes and fails when a decoded-size cap is broken
//   6. pitch check: measures the fundamental of every melodic zone's Opus file (tools/samples/
//      pitch.mjs), prints its deviation from the zone's root with its tune applied, and warns when
//      a zone is more than 10 cents off, or sits an octave or two off its root.
//
// tools/samples/sources.json, one entry per library:
//   { id, kind: "git" | "archive", url, commit | sha256, mappingRef?, mappingCommit?, sparse?,
//     licenseFile?, license, licenseFileSha256, title, author, creditLine }
//   A git source is pinned to `commit`; at the first build a missing commit is taken from
//   `git ls-remote <url> HEAD`, a missing mappingCommit from `mappingRef`, and a missing
//   licenseFileSha256 is recorded once the license file reads as the declared license.
//   `mappingCommit` is where the SFZ files live when upstream keeps them on another branch; every
//   sample a recipe uses must be the same blob at both commits. `sparse` lists the folders (or
//   files) the source may be read from; the build checks out only the files its recipes use.
// tools/samples/instruments.json, one recipe per instrument:
//   { source, set, kind: "melodic" | "kit", replaces, standIn, oneShot, maxLen, release, gain,
//     velUpper, melodic: files (SFZ), range? [lo, hi], vel (SFZ velocity read per layer), rr,
//     rootOffset? (semitones added to every SFZ keycenter, for a library whose files sound away
//     from them), tune? { <zone key>: cents } (added to the zone's tune, from the pitch check);
//     kit: sfzRoot (folder sample paths start from), tokens: { <token>: { files, key?, vel, rr?,
//     source?, level? (dB), maxLen? (at most the kit's) } } }
//   Roots, `range` and zone keys are the pitches the files sound at, rootOffset included.
//   A melodic instrument's zones span its recorded compass: a root every 3 semitones between the
//   lowest and highest recordings, plus at most one root derived within 3 semitones beyond each end.
//   `range` narrows that to the notes it lists. A kit token's `vel` entry may be a list (one SFZ
//   velocity per round robin). A token with fewer `vel` entries than the kit has layers reuses its
//   last zone for the layers above.
//
// The SFZ reader takes keys at face value: it fails on note_offset, octave_offset and transpose
// opcodes, and on more than one <control> header with a default_path, rather than misread them.
//
// Needs git, curl, ffmpeg/ffprobe (libopus, aac, soxr) and, for .7z archives, python3 (py7zr is
// installed into tools/samples/.venv).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measurePitch } from "./pitch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HERE = join(ROOT, "tools", "samples");
const CACHE = join(HERE, ".cache");
const VENV = join(HERE, ".venv");
const OUT = join(ROOT, "public", "music");
const GEN = join(ROOT, "src", "audio", "samples");
const SOURCES_PATH = join(HERE, "sources.json");
const INSTRUMENTS_PATH = join(HERE, "instruments.json");
const STATE_PATH = join(HERE, "build-state.json");

/** Bump when the processing below changes, so every zone re-encodes once. */
const PIPELINE_VERSION = 1;
const SR = 48000;
const ENCODERS = {
  webm: ["-c:a", "libopus", "-b:a", "64k", "-f", "webm"],
  m4a: ["-c:a", "aac", "-b:a", "80k", "-f", "mp4"],
};
const BITEXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1"];
/** A decoded file may run this many frames past `frames` (codec padding the loader trims). */
const DECODE_SLACK = 1024;
/** Silence kept before the attack, in seconds. */
const PRE_ATTACK = 0.002;
/** The attack is the first sample within this many dB of the zone's peak. */
const ATTACK_DB = -36;
/** A tail quieter than this, in dB below the peak, is cut. */
const TAIL_DB = -50;
/** Fade at a max-length cut, and at a natural end, in seconds. */
const CUT_FADE = 0.08;
const END_FADE = 0.005;
/** Loudness each zone is matched to: its loudest 100 ms window's RMS, in dBFS. */
const TARGET_RMS_DB = -18;
/** No zone peaks above this after matching, in dBFS. */
const PEAK_CEILING_DB = -1;
const MELODIC_MAX_SHIFT = 1.5;
/** The pitch check warns about a zone further off its root than this, in cents. */
const PITCH_TOLERANCE = 10;
/** ...and names it an octave error within this many cents of 12 or 24 semitones off. */
const OCTAVE_NEAR = 50;
/** Farthest a derived root may sit beyond the lowest or highest recording, in semitones. */
const END_REACH = 3;
const MB = 2 ** 20;
const SET_CAP = 24 * MB;
const PAIR_CAP = 44 * MB;
const SET_IDS = ["core", "fairground", "cruise", "downtown", "mg-action", "mg-puzzle", "mg-rhythm"];
const BOARD_SETS = ["fairground", "cruise", "downtown"];
const MINIGAME_SETS = ["mg-action", "mg-puzzle", "mg-rhythm"];
/** Opus download target per set, in bytes; the build warns above 1.25x. */
const DOWNLOAD_TARGET = {
  core: 1.5e6, fairground: 1.5e6, cruise: 1.5e6, downtown: 1.5e6, "mg-action": 1e6, "mg-puzzle": 1e6, "mg-rhythm": 0,
};
const LICENSES = {
  "CC0-1.0": {
    name: "Creative Commons CC0 1.0 Universal (public domain dedication)",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    text: /CC0 1\.0 Universal/,
  },
  Unlicense: {
    name: "The Unlicense (public domain dedication)",
    url: "https://unlicense.org/",
    text: /free and unencumbered software released into the public domain/,
  },
  "CC-BY-3.0": {
    name: "Creative Commons Attribution 3.0 Unported",
    url: "https://creativecommons.org/licenses/by/3.0/",
    text: /Attribution 3\.0/,
  },
};
const SOURCE_KEY_ORDER = [
  "id", "kind", "url", "commit", "mappingRef", "mappingCommit", "sha256", "sparse", "licenseFile", "license",
  "licenseFileSha256", "title", "author", "creditLine", "changes",
];
/** Tracks the game plays; happening, grumpus and minigame_intro are never played. */
const PLAYED_TRACKS = [
  "title", "shop", "results", "star_fanfare", "win", "lose", "drumroll", "drumroll_hit",
  "board.fairground", "mg.action", "mg.puzzle",
];

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const tsUrl = (rel) => pathToFileURL(join(ROOT, "src", "audio", rel)).href;
const fmtMB = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const fmtMiB = (bytes) => `${(bytes / MB).toFixed(2)} MiB`;
const dbToGain = (db) => 10 ** (db / 20);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

class BuildError extends Error {}
function fail(msg) {
  throw new BuildError(msg);
}

/** Writes `text` unless the file already holds it, so a no-change build touches nothing. */
function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"], ...opts });
  } catch (e) {
    const err = e.stderr?.toString().trim().split("\n").slice(-6).join("\n") ?? String(e);
    fail(`${cmd} ${args.slice(0, 8).join(" ")} … failed:\n${err}`);
  }
}
const git = (dir, args, opts) => run("git", args, { cwd: dir, ...opts }).toString();

function parseArgs(argv) {
  const out = { ranges: false, force: false, sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ranges") out.ranges = true;
    else if (a === "--force") out.force = true;
    else if (a === "--set") out.sets.push(argv[++i]);
    else fail(`unknown argument ${a}`);
  }
  for (const s of out.sets) if (!SET_IDS.includes(s)) fail(`--set ${s}: not one of ${SET_IDS.join(", ")}`);
  return out;
}

/* ------------------------------------------------------------------ */
/*  --ranges                                                           */
/* ------------------------------------------------------------------ */

/** The instruments a voice style plays on: `s:<name>` names one; a synth style maps through `replaces`. */
function instrumentsFor(style, instruments) {
  if (style.startsWith("s:")) return [style.slice(2)];
  return Object.keys(instruments).filter((name) => (instruments[name].replaces ?? []).includes(style));
}

/** Nearest MIDI note to a frequency, as the sampler reads every note (chords included). */
function midiFromHz(hz) {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

/** The velocity layer for `vel`, as the sampler picks it. */
function layerFor(velUpper, vel) {
  const i = velUpper.findIndex((u) => vel <= u);
  return i < 0 ? velUpper.length - 1 : i;
}

/** Notes as ranges: [40, 41, 42, 45] reads "40-42 45". */
function spans(notes) {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(" ");
}

/**
 * Reports the notes of the played tracks that the built zones do not cover: the nearest root on the
 * note's layer is more than maxShift away (the sampler's rule; slides excluded, as in Task 8's coverage
 * test).
 */
async function printRanges(instruments) {
  const { TRACKS, parseTrack, parseSection } = await import(tsUrl("music/tracks.ts"));
  const { SAMPLED } = await import(tsUrl("samples/instruments.gen.ts"));
  const { ZONES } = await import(tsUrl("samples/zones.gen.ts"));
  const covered = (name, midi, layer) => {
    const roots = (ZONES[name]?.zones ?? []).filter((z) => z.layer === layer && z.root !== undefined).map((z) => z.root);
    return roots.some((r) => Math.abs(r - midi) <= SAMPLED[name].maxShift);
  };
  console.log("Zones cover (MIDI, within maxShift of a root):");
  for (const [name, inst] of Object.entries(SAMPLED)) {
    if (inst.kind === "kit") {
      console.log(`  ${name.padEnd(10)} tokens ${[...new Set(ZONES[name].zones.map((z) => z.token))].join(" ")}`);
      continue;
    }
    const layers = inst.velUpper.map((_, layer) => spans([...Array(128).keys()].filter((m) => covered(name, m, layer))));
    console.log(`  ${name.padEnd(10)} ${layers.join(" | ")}`);
  }
  console.log("\nPlayed notes outside them (note + voice transpose, +1 on board.* for the lift; slides excluded):");
  let outside = 0;
  const unmapped = new Set();
  for (const id of PLAYED_TRACKS) {
    const def = TRACKS[id];
    if (!def) fail(`--ranges: played track ${id} is not in TRACKS`);
    const lifts = id.startsWith("board.") ? [0, 1] : [0];
    const voices = [...parseTrack(def), ...parseSection(def, "fill"), ...parseSection(def, "pickup")];
    for (const v of voices) {
      const names = instrumentsFor(v.style, instruments);
      if (names.length === 0) unmapped.add(`${v.style} (${id})`);
      for (const name of names) {
        const inst = SAMPLED[name];
        if (!inst) {
          console.log(`  ${id.padEnd(17)} ${v.style} -> ${name}: not built`);
          continue;
        }
        const missed = [];
        for (const bar of v.bars) {
          for (const ev of bar) {
            const layer = layerFor(inst.velUpper, Math.min(1, ev.vel * v.gain));
            if (ev.kind === "drum" && inst.kind === "kit") {
              if (!ZONES[name].zones.some((z) => z.token === ev.token && z.layer === layer)) missed.push(ev.token);
            } else if (ev.kind === "note" && inst.kind === "melodic" && !ev.slide) {
              for (const f of ev.freqs) {
                const midi = midiFromHz(f) + v.transpose;
                for (const lift of lifts) if (!covered(name, midi + lift, layer)) missed.push(midi + lift);
              }
            }
          }
        }
        if (missed.length === 0) continue;
        outside += missed.length;
        const where = `${v.style}${v.layer !== "base" ? ` (${v.layer}${v.transpose ? `, ${v.transpose > 0 ? "+" : ""}${v.transpose}` : ""})` : v.transpose ? ` (${v.transpose})` : ""}`;
        const what = inst.kind === "kit" ? `tokens ${[...new Set(missed)].join(" ")}` : `notes ${spans(missed)}`;
        console.log(`  ${id.padEnd(17)} ${where.padEnd(26)} -> ${name.padEnd(9)} ${missed.length} event${missed.length === 1 ? "" : "s"}, ${what}`);
      }
    }
  }
  if (outside === 0) console.log("  none");
  for (const u of unmapped) console.log(`  no sampled instrument replaces ${u}`);
}

/* ------------------------------------------------------------------ */
/*  validation                                                         */
/* ------------------------------------------------------------------ */

async function validate(instruments, sources) {
  const { VOICES } = await import(tsUrl("music/instruments.ts"));
  const { DRUM_TOKENS } = await import(tsUrl("music/tracks.ts"));
  const byId = new Map(sources.map((s) => [s.id, s]));
  const checkSource = (where, id) => {
    const s = byId.get(id);
    if (!s) fail(`${where}: source "${id}" is not in sources.json`);
    if (!LICENSES[s.license]) fail(`${where}: source "${id}" has license ${s.license}, not one of ${Object.keys(LICENSES).join(", ")}`);
  };
  for (const s of sources) {
    for (const k of ["id", "kind", "url", "license", "title", "author", "creditLine"]) {
      if (!s[k]) fail(`sources.json: ${s.id ?? "?"} has no ${k}`);
    }
    if (s.kind !== "git" && s.kind !== "archive") fail(`sources.json: ${s.id} kind must be git or archive`);
    if (s.license === "CC-BY-3.0" && !s.changes) fail(`sources.json: ${s.id} is CC BY and needs "changes"`);
  }
  for (const [name, inst] of Object.entries(instruments)) {
    const where = `instruments.json ${name}`;
    if (!SET_IDS.includes(inst.set)) fail(`${where}: set ${inst.set} is not one of ${SET_IDS.join(", ")}`);
    checkSource(where, inst.source);
    if (!Array.isArray(inst.velUpper) || inst.velUpper.length === 0) fail(`${where}: velUpper must be a non-empty list`);
    for (let i = 1; i < inst.velUpper.length; i++) {
      if (!(inst.velUpper[i] > inst.velUpper[i - 1])) fail(`${where}: velUpper must ascend`);
    }
    for (const k of ["oneShot", "maxLen", "release", "gain"]) if (inst[k] === undefined) fail(`${where}: no ${k}`);
    if (inst.kind === "kit") {
      if (inst.standIn !== "drums") fail(`${where}: a kit's standIn must be "drums", not "${inst.standIn}"`);
      if (inst.oneShot !== true) fail(`${where}: kits must be oneShot (the player schedules kit hits with no length)`);
      if (!inst.tokens || Object.keys(inst.tokens).length === 0) fail(`${where}: a kit needs tokens`);
      if (inst.rootOffset !== undefined || inst.tune !== undefined) fail(`${where}: rootOffset and tune are for melodic instruments`);
      for (const [tok, t] of Object.entries(inst.tokens)) {
        if (!DRUM_TOKENS.has(tok)) fail(`${where}: ${tok} is not a drum token`);
        if (t.source) checkSource(`${where} ${tok}`, t.source);
        if (!t.files || !Array.isArray(t.vel) || t.vel.length === 0) fail(`${where} ${tok}: needs files and vel`);
        if (t.vel.length > inst.velUpper.length) fail(`${where} ${tok}: more vel entries than layers`);
      }
    } else if (inst.kind === "melodic") {
      if (!Object.hasOwn(VOICES, inst.standIn) || inst.standIn === "drums") {
        fail(`${where}: standIn "${inst.standIn}" is not a melodic voice in VOICES`);
      }
      if (inst.range !== undefined) {
        const [lo, hi] = inst.range;
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) fail(`${where}: range must be [lo, hi]`);
      }
      if (!Array.isArray(inst.vel) || inst.vel.length !== inst.velUpper.length) fail(`${where}: one vel per layer`);
      if (!inst.files) fail(`${where}: no files`);
      if (inst.rootOffset !== undefined && !Number.isInteger(inst.rootOffset)) fail(`${where}: rootOffset must be a whole number of semitones`);
      if (inst.tune !== undefined) {
        if (typeof inst.tune !== "object" || Array.isArray(inst.tune)) fail(`${where}: tune must be { <zone key>: cents }`);
        for (const [key, cents] of Object.entries(inst.tune)) {
          if (!Number.isFinite(cents)) fail(`${where}: tune for ${key} must be a number of cents`);
        }
      }
    } else {
      fail(`${where}: kind must be melodic or kit`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  sources                                                            */
/* ------------------------------------------------------------------ */

function orderKeys(entry) {
  const out = {};
  for (const k of SOURCE_KEY_ORDER) if (entry[k] !== undefined) out[k] = entry[k];
  for (const k of Object.keys(entry)) if (!(k in out)) out[k] = entry[k];
  return out;
}

/** Glob characters in a sparse-checkout pattern are escaped so each pattern names one path. */
const sparsePattern = (path) => `/${path.replace(/[\\*?[\]!#]/g, (c) => `\\${c}`)}`;

function lsRemote(url, ref) {
  const line = run("git", ["ls-remote", url, ref]).toString().trim().split("\n")[0] ?? "";
  const sha = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) fail(`git ls-remote ${url} ${ref} returned nothing`);
  return sha;
}

/** Checks a license file against the pinned hash, recording the hash at the first build. Returns true when it recorded. */
function checkLicense(src, text) {
  const hash = sha256(text);
  if (src.licenseFileSha256) {
    if (hash !== src.licenseFileSha256) {
      fail(`${src.id}: ${src.licenseFile ?? "LICENSE"} sha256 ${hash} does not match licenseFileSha256 ${src.licenseFileSha256}`);
    }
    return false;
  }
  if (!LICENSES[src.license].text.test(text.toString())) {
    fail(`${src.id}: ${src.licenseFile ?? "LICENSE"} does not read as ${src.license}; check it by hand`);
  }
  src.licenseFileSha256 = hash;
  console.log(`  ${src.id}: license file reads as ${src.license}; recorded sha256 ${hash}`);
  return true;
}

/** A git library at its pinned commit, with only the files the recipes use checked out. */
class GitSource {
  constructor(src) {
    this.src = src;
    this.dir = join(CACHE, src.id);
  }

  /** Clones (blobless, sparse) and pins. Returns true when sources.json gained a pin. */
  prepare() {
    const { src } = this;
    let pinned = false;
    if (!existsSync(join(this.dir, ".git"))) {
      mkdirSync(CACHE, { recursive: true });
      console.log(`  ${src.id}: cloning ${src.url} (blobless, sparse)`);
      run("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--sparse", src.url, this.dir]);
      git(this.dir, ["config", "gc.auto", "0"]);
    }
    if (!src.commit) {
      src.commit = lsRemote(src.url, "HEAD");
      console.log(`  ${src.id}: pinned to HEAD ${src.commit}`);
      pinned = true;
    }
    if (src.mappingRef && !src.mappingCommit) {
      src.mappingCommit = lsRemote(src.url, `refs/heads/${src.mappingRef}`);
      console.log(`  ${src.id}: SFZ mapping pinned to ${src.mappingRef} ${src.mappingCommit}`);
      pinned = true;
    }
    for (const rev of [src.commit, src.mappingCommit].filter(Boolean)) this.ensureCommit(rev);
    return pinned;
  }

  ensureCommit(rev) {
    try {
      run("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: this.dir });
    } catch {
      git(this.dir, ["fetch", "--quiet", "--filter=blob:none", "--no-tags", "origin", rev]);
    }
  }

  allowed(path) {
    return path === this.licensePath() || (this.src.sparse ?? []).some((s) => (s.endsWith("/") ? path.startsWith(s) : path === s));
  }

  licensePath() {
    return this.src.licenseFile ?? "LICENSE";
  }

  /** An SFZ (or other text) file, read from the mapping commit without checking it out. */
  readText(path) {
    if (!this.allowed(path)) fail(`${this.src.id}: ${path} is outside its sparse paths`);
    return git(this.dir, ["show", `${this.src.mappingCommit ?? this.src.commit}:${path}`]);
  }

  /** Checks out exactly `paths` (plus the license file) at the pinned commit and verifies the license. */
  checkout(paths) {
    const { src } = this;
    for (const p of paths) if (!this.allowed(p)) fail(`${src.id}: ${p} is outside its sparse paths`);
    if (src.mappingCommit && paths.length > 0) {
      const revs = paths.flatMap((p) => [`${src.commit}:${p}`, `${src.mappingCommit}:${p}`]);
      const ids = git(this.dir, ["rev-parse", ...revs]).trim().split("\n");
      for (let i = 0; i < paths.length; i++) {
        if (ids[2 * i] !== ids[2 * i + 1]) fail(`${src.id}: ${paths[i]} differs between the commit and the SFZ mapping commit`);
      }
    }
    const patterns = [this.licensePath(), ...paths].sort().map(sparsePattern);
    let current = [];
    try {
      current = git(this.dir, ["sparse-checkout", "list"]).trim().split("\n").filter(Boolean).sort();
    } catch {
      // not sparse yet
    }
    if (current.join("\n") !== [...patterns].sort().join("\n")) {
      git(this.dir, ["sparse-checkout", "set", "--no-cone", "--stdin"], { input: `${patterns.join("\n")}\n` });
    }
    // --force also fills a worktree cloned with --no-checkout, whose HEAD may already be the commit.
    git(this.dir, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", src.commit]);
    for (const p of [this.licensePath(), ...paths]) if (!existsSync(join(this.dir, p))) fail(`${src.id}: ${p} missing after checkout`);
    return checkLicense(src, readFileSync(join(this.dir, this.licensePath())));
  }

  file(path) {
    return join(this.dir, path);
  }
}

/** A downloaded archive checked against its sha256 and unpacked once. */
class ArchiveSource {
  constructor(src) {
    this.src = src;
    this.downloads = join(CACHE, `${src.id}-download`);
    this.dir = join(CACHE, src.id);
    this.archive = join(this.downloads, decodeURIComponent(src.url.split("/").pop()));
  }

  prepare() {
    const { src } = this;
    let pinned = false;
    if (!existsSync(this.archive)) {
      mkdirSync(this.downloads, { recursive: true });
      console.log(`  ${src.id}: downloading ${src.url}`);
      run("curl", ["-fsSL", "--retry", "2", "-o", this.archive, src.url]);
    }
    const hash = sha256(readFileSync(this.archive));
    if (!src.sha256) {
      src.sha256 = hash;
      console.log(`  ${src.id}: pinned archive sha256 ${hash}`);
      pinned = true;
    } else if (hash !== src.sha256) {
      fail(`${src.id}: ${this.archive} sha256 ${hash} does not match ${src.sha256}`);
    }
    const marker = join(this.dir, `.unpacked-${hash}`);
    if (!existsSync(marker)) {
      rmSync(this.dir, { recursive: true, force: true });
      mkdirSync(this.dir, { recursive: true });
      this.unpack();
      writeFileSync(marker, "");
    }
    return pinned;
  }

  unpack() {
    const a = this.archive;
    if (a.endsWith(".7z")) {
      const py = join(VENV, "bin", "python");
      if (!existsSync(py)) run("python3", ["-m", "venv", VENV]);
      try {
        run(py, ["-I", "-c", "import py7zr"]);
      } catch {
        console.log("  installing py7zr into tools/samples/.venv");
        run(join(VENV, "bin", "pip"), ["install", "--quiet", "py7zr==1.1.4"]);
      }
      const script = "import sys, py7zr\nwith py7zr.SevenZipFile(sys.argv[1]) as z: z.extractall(path=sys.argv[2])";
      run(py, ["-I", "-c", script, a, this.dir]);
    } else if (a.endsWith(".zip")) {
      run("unzip", ["-q", a, "-d", this.dir]);
    } else {
      run("tar", ["-xf", a, "-C", this.dir]);
    }
  }

  readText(path) {
    return readFileSync(this.file(path), "utf8");
  }

  checkout(paths) {
    for (const p of paths) if (!existsSync(this.file(p))) fail(`${this.src.id}: ${p} is not in the archive`);
    return checkLicense(this.src, readFileSync(this.file(this.src.licenseFile ?? "LICENSE")));
  }

  file(path) {
    return join(this.dir, path);
  }
}

/* ------------------------------------------------------------------ */
/*  SFZ                                                                */
/* ------------------------------------------------------------------ */

const NOTE_SEMIS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** An SFZ key: a MIDI number or a note name (c4 = 60). */
function sfzKey(value) {
  if (/^-?\d+$/.test(value)) return Number(value);
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(value);
  if (!m) fail(`SFZ: bad key "${value}"`);
  return (Number(m[3]) + 1) * 12 + NOTE_SEMIS[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

/** Inlines #include (relative to the top SFZ's folder) and applies #define; strips comments. */
function preprocessSfz(text, readInclude, defines, depth = 0) {
  if (depth > 8) fail("SFZ: #include nested too deep");
  const out = [];
  for (let line of text.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/)) {
    const c = line.indexOf("//");
    if (c >= 0) line = line.slice(0, c);
    for (const [name, value] of [...defines].sort((a, b) => b[0].length - a[0].length)) line = line.split(name).join(value);
    const def = /^\s*#define\s+(\$\w+)\s+(.+?)\s*$/.exec(line);
    if (def) {
      defines.set(def[1], def[2]);
      continue;
    }
    const inc = /^\s*#include\s+"([^"]+)"/.exec(line);
    if (inc) {
      out.push(preprocessSfz(readInclude(inc[1]), readInclude, defines, depth + 1));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Opcodes that move key numbers or playback pitch, which this reader does not apply: it fails on them. */
const UNSUPPORTED_SFZ = /^(note_offset|octave_offset|transpose\w*)$/;

/**
 * Every region of an SFZ with its inherited opcodes, normalised. Sample paths are relative to
 * `sampleDir`. `file` names the SFZ in errors.
 */
function parseSfz(text, readInclude, sampleDir, file) {
  const src = preprocessSfz(text, readInclude, new Map());
  const tokens = [...src.matchAll(/<(\w+)>|([A-Za-z0-9_]+)=/g)];
  const scopes = { control: {}, global: {}, master: {}, group: {}, region: null };
  let target = null;
  const raw = [];
  // Each <control> header's default_path applies to the regions after it; this reader keeps one for all.
  let controls = 0;
  const pathControls = new Set();
  const closeRegion = () => {
    if (scopes.region) raw.push({ ...scopes.global, ...scopes.master, ...scopes.group, ...scopes.region });
    scopes.region = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t[1]) {
      const header = t[1];
      if (header === "region") {
        closeRegion();
        scopes.region = {};
        target = scopes.region;
      } else {
        closeRegion();
        if (header === "control") (controls += 1), (target = scopes.control);
        else if (header === "global") (scopes.global = {}), (scopes.master = {}), (scopes.group = {}), (target = scopes.global);
        else if (header === "master") (scopes.master = {}), (scopes.group = {}), (target = scopes.master);
        else if (header === "group") (scopes.group = {}), (target = scopes.group);
        else target = {}; // <curve>, <effect>, <midi>: not used here
      }
      continue;
    }
    const end = i + 1 < tokens.length ? tokens[i + 1].index : src.length;
    const value = src.slice(t.index + t[0].length, end).trim();
    if (UNSUPPORTED_SFZ.test(t[2])) fail(`SFZ ${file}: ${t[2]}=${value} moves keys or pitch, which this build does not apply`);
    if (target === scopes.control && t[2] === "default_path") pathControls.add(controls);
    if (target) target[t[2]] = value;
  }
  closeRegion();
  if (pathControls.size > 1) fail(`SFZ ${file}: ${pathControls.size} <control> headers set a default_path; this build applies one to every region`);

  const defaultPath = (scopes.control.default_path ?? "").replaceAll("\\", "/");
  const num = (v, d) => (v === undefined ? d : Number(v));
  return raw
    .filter((op) => op.sample && (op.trigger ?? "attack") === "attack")
    .map((op) => {
      const key = op.key !== undefined ? sfzKey(op.key) : undefined;
      const center = op.pitch_keycenter !== undefined ? sfzKey(op.pitch_keycenter) : key ?? 60;
      return {
        sample: posix.normalize(posix.join(sampleDir, defaultPath, op.sample.replaceAll("\\", "/"))),
        lokey: op.lokey !== undefined ? sfzKey(op.lokey) : key ?? 0,
        hikey: op.hikey !== undefined ? sfzKey(op.hikey) : key ?? 127,
        root: center,
        tune: num(op.tune, 0),
        lovel: num(op.lovel, 0),
        hivel: num(op.hivel, 127),
        xfin: [num(op.xfin_lovel, 0), num(op.xfin_hivel, 0)],
        xfout: [num(op.xfout_lovel, 127), num(op.xfout_hivel, 127)],
        seqLength: num(op.seq_length, 1),
        seqPosition: num(op.seq_position, 1),
        lorand: num(op.lorand, 0),
      };
    });
}

/** How much a region sounds at velocity `v` (0 outside lovel..hivel, crossfades in between). */
function velWeight(r, v) {
  if (v < r.lovel || v > r.hivel) return 0;
  const [inLo, inHi] = r.xfin;
  const [outLo, outHi] = r.xfout;
  const fadeIn = inHi > inLo ? Math.min(1, Math.max(0, (v - inLo) / (inHi - inLo))) : 1;
  const fadeOut = outHi > outLo ? Math.min(1, Math.max(0, (outHi - v) / (outHi - outLo))) : 1;
  return fadeIn * fadeOut;
}

/**
 * The one region that plays at velocity `v` for round robin `rr` (0-based) among `regions`. Round
 * robins are seq positions, or random groups (lorand/hirand) in lorand order.
 */
function pickRegion(regions, v, rr, what) {
  let cands = regions.filter((r) => velWeight(r, v) > 0);
  // A mapping file read on its own may lack the seq_length its parent group sets: count positions too.
  const seqs = Math.max(...cands.map((r) => Math.max(r.seqLength, r.seqPosition)));
  const rands = [...new Set(cands.map((r) => r.lorand))].sort((a, b) => a - b);
  if (seqs > 1) {
    if (rr >= seqs) fail(`${what}: only ${seqs} round robins at velocity ${v}`);
    cands = cands.filter((r) => r.seqPosition === rr + 1);
  } else if (rands.length > 1) {
    if (rr >= rands.length) fail(`${what}: only ${rands.length} round robins at velocity ${v}`);
    cands = cands.filter((r) => r.lorand === rands[rr]);
  } else if (rr > 0) {
    fail(`${what}: no round robins at velocity ${v} (give one velocity per round robin)`);
  }
  if (cands.length === 0) fail(`${what}: no region at velocity ${v}`);
  const best = Math.max(...cands.map((r) => velWeight(r, v)));
  const top = cands.filter((r) => velWeight(r, v) === best);
  if (top.length > 1) fail(`${what}: ${top.length} regions tie at velocity ${v}`);
  return top[0];
}

/* ------------------------------------------------------------------ */
/*  zone plans                                                         */
/* ------------------------------------------------------------------ */

/** Reads an instrument's SFZ (and its includes) from its source. */
function readRegions(handle, sfzPath, sfzRoot) {
  const base = sfzRoot ?? posix.dirname(sfzPath);
  const text = handle.readText(sfzPath);
  return parseSfz(text, (inc) => handle.readText(posix.normalize(posix.join(base, inc))), base, sfzPath);
}

/**
 * Roots for an instrument whose recordings sit at `recorded`, so every note of [lo, hi] lies within
 * 1 semitone of one (maxShift 1.5). Roots may sit from END_REACH below the lowest recording to
 * END_REACH above the highest, and [lo, hi] defaults to all they can cover. Among covers with the
 * fewest roots it takes the one that shifts least. A root is the recorded note where one exists,
 * otherwise it is derived from the nearest recording above (shifted down), or from the highest
 * recording (shifted up) for the one root allowed past the top.
 */
function keptRoots(recorded, range, what) {
  const rec = [...new Set(recorded)].sort((a, b) => a - b);
  const bottom = rec[0];
  const top = rec[rec.length - 1];
  const [minRoot, maxRoot] = [bottom - END_REACH, top + END_REACH];
  const [lo, hi] = range ?? [minRoot - 1, maxRoot + 1];
  if (lo < minRoot - 1 || hi > maxRoot + 1) {
    fail(`${what}: range ${lo}-${hi} runs past what the recordings (${bottom}-${top}) can cover, ${minRoot - 1}-${maxRoot + 1}`);
  }
  const from = (r) => (rec.includes(r) ? r : rec.find((x) => x > r) ?? top);
  const better = (a, b) => a.count - b.count || a.shift - b.shift;
  const memo = new Map();
  // Cheapest cover of [n, hi]: a root at n+1, n or n-1 covers n, and the rest starts two above it.
  const cover = (n) => {
    if (n > hi) return { count: 0, shift: 0, roots: [] };
    if (memo.has(n)) return memo.get(n);
    let best = null;
    for (const root of [n + 1, n, n - 1]) {
      if (root < minRoot || root > maxRoot) continue;
      const rest = cover(root + 2);
      if (!rest) continue;
      const src = from(root);
      const c = { count: rest.count + 1, shift: rest.shift + Math.abs(root - src), roots: [{ root, from: src }, ...rest.roots] };
      if (!best || better(c, best) < 0) best = c;
    }
    memo.set(n, best);
    return best;
  };
  const roots = cover(lo).roots;
  if (roots.filter((r) => r.root > top).length > 1 || roots.filter((r) => r.root < bottom).length > 1) {
    fail(`${what}: more than one root past an end of the recordings`);
  }
  return roots;
}

/** The zones an instrument's recipe asks for: which sample, how far to shift it, and its table entry. */
function planInstrument(name, inst, handles) {
  const layers = inst.velUpper.length;
  const zones = [];
  const tag = (layer, rr, rrCount) => `${layers > 1 ? `-v${layer}` : ""}${rrCount > 1 ? `-r${rr}` : ""}`;
  if (inst.kind === "melodic") {
    const handle = handles.get(inst.source);
    // From here on a root is the pitch the file sounds at.
    const offset = inst.rootOffset ?? 0;
    const regions = readRegions(handle, inst.files, inst.sfzRoot).map((r) => ({ ...r, root: r.root + offset }));
    const rrCount = inst.rr ?? 1;
    for (let layer = 0; layer < layers; layer++) {
      const v = inst.vel[layer];
      const recorded = regions.filter((r) => velWeight(r, v) > 0).map((r) => r.root);
      if (recorded.length === 0) fail(`${name}: no regions at velocity ${v}`);
      for (const { root, from } of keptRoots(recorded, inst.range, `${name} layer ${layer}`)) {
        for (let rr = 0; rr < rrCount; rr++) {
          const region = pickRegion(regions.filter((r) => r.root === from), v, rr, `${name} root ${from}`);
          const key = `${root}${tag(layer, rr, rrCount)}`;
          zones.push({
            key,
            entry: { root, layer, rr, tune: region.tune + (inst.tune?.[key] ?? 0) },
            source: inst.source,
            sample: region.sample,
            shift: root - from,
            levelDb: 0,
            maxLen: inst.maxLen,
          });
        }
      }
    }
    for (const key of Object.keys(inst.tune ?? {})) {
      if (!zones.some((z) => z.key === key)) fail(`${name}: tune names zone ${key}, which the build does not make`);
    }
  } else {
    for (const [token, t] of Object.entries(inst.tokens)) {
      const source = t.source ?? inst.source;
      const handle = handles.get(source);
      const sfzRoot = t.sfzRoot ?? (source === inst.source ? inst.sfzRoot : undefined);
      let regions = readRegions(handle, t.files, sfzRoot);
      if (t.key !== undefined) regions = regions.filter((r) => r.lokey <= t.key && t.key <= r.hikey);
      const rrCount = t.rr ?? 1;
      const used = new Set();
      for (let layer = 0; layer < layers; layer++) {
        const vel = t.vel[Math.min(layer, t.vel.length - 1)];
        for (let rr = 0; rr < rrCount; rr++) {
          const v = Array.isArray(vel) ? vel[rr] : vel;
          const region = pickRegion(regions, v, Array.isArray(vel) ? 0 : rr, `${name} ${token}`);
          const reuse = layer >= t.vel.length;
          if (!reuse && used.has(region.sample)) fail(`${name} ${token}: ${region.sample} picked twice`);
          used.add(region.sample);
          const ownLayer = Math.min(layer, t.vel.length - 1);
          zones.push({
            key: `${token}${tag(ownLayer, rr, rrCount)}`,
            entry: { token, layer, rr, tune: 0 },
            source,
            sample: region.sample,
            shift: 0,
            levelDb: t.level ?? 0,
            maxLen: Math.min(t.maxLen ?? inst.maxLen, inst.maxLen),
          });
        }
      }
    }
  }
  return zones;
}

/* ------------------------------------------------------------------ */
/*  audio                                                              */
/* ------------------------------------------------------------------ */

function probe(file) {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", file]);
  const s = JSON.parse(out.toString()).streams?.[0];
  if (!s) fail(`${file}: no audio stream`);
  return { rate: Number(s.sample_rate), channels: Number(s.channels) };
}

/** Decodes to mono 48 kHz float, shifted by `shift` semitones (soxr). */
function decodeSource(file, shift) {
  const { rate, channels } = probe(file);
  const filters = [];
  if (channels > 1) {
    const w = (1 / channels).toFixed(6);
    filters.push(`pan=mono|c0=${Array.from({ length: channels }, (_, i) => `${w}*c${i}`).join("+")}`);
  }
  // Relabelling the rate shifts pitch and length together; soxr then resamples to 48 kHz.
  if (shift !== 0) filters.push(`asetrate=${Math.round(rate * 2 ** (shift / 12))}`);
  filters.push(`aresample=${SR}:resampler=soxr`);
  const buf = run("ffmpeg", ["-v", "error", "-i", file, "-af", filters.join(","), "-ac", "1", "-f", "f32le", "-acodec", "pcm_f32le", "-"]);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** RMS of the loudest 100 ms window. */
function loudness(x) {
  const win = Math.min(x.length, Math.round(0.1 * SR));
  let acc = 0;
  for (let i = 0; i < win; i++) acc += x[i] * x[i];
  let best = acc;
  for (let i = win; i < x.length; i++) {
    acc += x[i] * x[i] - x[i - win] * x[i - win];
    if (acc > best) best = acc;
  }
  return Math.sqrt(Math.max(best, 0) / win);
}

/** Trim, cut, fade and loudness-match one zone. Returns the samples and whether the peak ceiling held it down. */
function shapeZone(x, maxLen, levelDb) {
  const peak = peakOf(x);
  if (peak === 0) fail("silent sample");
  let attack = 0;
  while (attack < x.length && Math.abs(x[attack]) < peak * dbToGain(ATTACK_DB)) attack++;
  let last = x.length - 1;
  while (last > attack && Math.abs(x[last]) < peak * dbToGain(TAIL_DB)) last--;
  const start = Math.max(0, attack - Math.round(PRE_ATTACK * SR));
  const natural = last + 1 - start;
  const cap = Math.round(maxLen * SR);
  const len = Math.min(natural, cap);
  const y = x.slice(start, start + len);
  const fade = Math.min(len, Math.round((natural > cap ? CUT_FADE : END_FADE) * SR));
  for (let i = 0; i < fade; i++) y[len - fade + i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / fade);
  let scale = dbToGain(TARGET_RMS_DB + levelDb) / loudness(y);
  const ceiling = dbToGain(PEAK_CEILING_DB) / peakOf(y);
  const limited = ceiling < scale;
  if (limited) scale = ceiling;
  for (let i = 0; i < y.length; i++) y[i] *= scale;
  return { pcm: y, limited, cut: natural > cap };
}

/** An encoded file decoded to mono 48 kHz float. */
function decodePcm(file) {
  const buf = run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-acodec", "pcm_f32le", "-"]);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

/** Frames ffmpeg decodes from an encoded file. */
function decodedFrames(file) {
  return decodePcm(file).length;
}

function encode(pcm, outBase) {
  const input = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (const [ext, codec] of Object.entries(ENCODERS)) {
    const out = `${outBase}.${ext}`;
    mkdirSync(dirname(out), { recursive: true });
    run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", "pipe:0", ...codec, ...BITEXACT, out], { input });
    const got = decodedFrames(out);
    if (got < pcm.length - DECODE_SLACK || got > pcm.length + DECODE_SLACK) {
      fail(`${out}: decodes to ${got} frames, expected about ${pcm.length}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  outputs                                                            */
/* ------------------------------------------------------------------ */

const tsKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
/** A value as a one-line TypeScript literal: `{ a: 1, b: [2, 3] }`. */
function tsValue(v) {
  if (Array.isArray(v)) return `[${v.map(tsValue).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${tsKey(k)}: ${tsValue(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

function instrumentsTs(table) {
  const lines = [
    "/** Generated by tools/samples/build.mjs from tools/samples/instruments.json. Do not edit by hand. */",
    "",
    'import type { SampledInstrument } from "./types";',
    "",
    "export const SAMPLED: Record<string, SampledInstrument> = {",
  ];
  for (const [name, inst] of Object.entries(table)) lines.push(`  ${tsKey(name)}: ${tsValue(inst)},`);
  lines.push("};", "");
  return lines.join("\n");
}

function zonesTs(zones) {
  const lines = [
    "/** Generated by tools/samples/build.mjs: every zone of every built instrument. Do not edit by hand. */",
    "",
    'import type { InstrumentZones } from "./types";',
    "",
    "export const ZONES: Record<string, InstrumentZones> = {",
  ];
  for (const [name, { source, zones: list }] of Object.entries(zones)) {
    lines.push(`  ${tsKey(name)}: {`, `    source: ${JSON.stringify(source)},`, "    zones: [");
    for (const z of list) lines.push(`      ${tsValue(z)},`);
    lines.push("    ],", "  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

function creditsText(sources) {
  const where = (s) => {
    if (s.kind === "archive") return `${s.url} (sha256 ${s.sha256})`;
    const mapping = s.mappingCommit ? `, SFZ mapping at commit ${s.mappingCommit}` : "";
    return `${s.url} (commit ${s.commit}${mapping})`;
  };
  const out = [
    "SUPER STAR PARTY: music sample credits",
    "",
    "The music plays recorded instruments from these sample libraries. Thank you to everyone who made them.",
  ];
  for (const s of sources) {
    const lic = LICENSES[s.license];
    const lines = [`${s.creditLine}: "${s.title}" by ${s.author}, from ${where(s)}.`, `Licensed under ${lic.name}, ${lic.url}.`];
    if (s.license === "CC-BY-3.0") lines.push(`Changes: ${s.changes} No endorsement by the author is implied.`);
    out.push("", ...lines);
  }
  const thanks = sources.filter((s) => s.license === "CC0-1.0" || s.license === "Unlicense");
  if (thanks.length > 0) {
    out.push("");
    for (const s of thanks) out.push(`Thank you to the makers of "${s.title}" for giving it to the public domain.`);
  }
  return `${out.join("\n")}\n`;
}

/** build-state.json with one zone per line, so a rebuild's diff names the zones it changed. */
function stateJson(all) {
  const lines = ["{", `  "pipeline": ${PIPELINE_VERSION},`, '  "instruments": {'];
  const names = Object.keys(all);
  names.forEach((name, i) => {
    lines.push(`    ${JSON.stringify(name)}: {`, `      "source": ${JSON.stringify(all[name].source)},`, '      "zones": [');
    all[name].zones.forEach((z, j) => lines.push(`        ${JSON.stringify(z)}${j < all[name].zones.length - 1 ? "," : ""}`));
    lines.push("      ]", `    }${i < names.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

/** Deletes files under public/music/<set>/ that no zone references (old hashes, dropped zones). */
function removeStale(sets, keep) {
  let removed = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
      } else if (!keep.has(p)) {
        rmSync(p);
        removed++;
      }
    }
  };
  for (const set of sets) walk(join(OUT, set));
  return removed;
}

/* ------------------------------------------------------------------ */
/*  build                                                              */
/* ------------------------------------------------------------------ */

async function build(args, instruments, sources) {
  await validate(instruments, sources);
  const sets = args.sets.length > 0 ? args.sets : [...new Set(Object.values(instruments).map((i) => i.set))];
  const chosen = Object.entries(instruments).filter(([, inst]) => sets.includes(inst.set));
  const byId = new Map(sources.map((s) => [s.id, s]));

  // 1. fetch
  console.log(`Sets: ${sets.join(", ")}`);
  const needed = new Set();
  for (const [, inst] of chosen) {
    needed.add(inst.source);
    for (const t of Object.values(inst.tokens ?? {})) if (t.source) needed.add(t.source);
  }
  const handles = new Map();
  let sourcesChanged = false;
  for (const id of needed) {
    const src = byId.get(id);
    const handle = src.kind === "git" ? new GitSource(src) : new ArchiveSource(src);
    sourcesChanged = handle.prepare() || sourcesChanged;
    handles.set(id, handle);
  }
  const saveSources = () => writeIfChanged(SOURCES_PATH, `${JSON.stringify(sources.map(orderKeys), null, 2)}\n`);
  if (sourcesChanged) saveSources();

  // 2. plan zones from the SFZ mappings, then check out exactly the samples they use
  const plans = new Map(chosen.map(([name, inst]) => [name, planInstrument(name, inst, handles)]));
  for (const [id, handle] of handles) {
    const paths = new Set();
    for (const zones of plans.values()) for (const z of zones) if (z.source === id) paths.add(z.sample);
    sourcesChanged = handle.checkout([...paths].sort()) || sourcesChanged;
  }
  if (sourcesChanged) saveSources();

  // 3-4. shape and encode each zone, skipping those whose inputs are unchanged
  const state = existsSync(STATE_PATH) ? readJson(STATE_PATH) : { instruments: {} };
  const prior = state.instruments ?? {};
  const next = {};
  const keep = new Set();
  let encoded = 0;
  let skipped = 0;
  for (const [name, inst] of chosen) {
    const zones = [];
    const seen = new Map();
    const oldZones = new Map((prior[name]?.zones ?? []).map((z) => [z.key, z]));
    for (const z of plans.get(name)) {
      const file = handles.get(z.source).file(z.sample);
      const settings = {
        pipeline: PIPELINE_VERSION,
        sample: sha256(readFileSync(file)),
        shift: z.shift,
        maxLen: z.maxLen,
        levelDb: z.levelDb,
        consts: [SR, PRE_ATTACK, ATTACK_DB, TAIL_DB, CUT_FADE, END_FADE, TARGET_RMS_DB, PEAK_CEILING_DB],
        encoders: [ENCODERS, BITEXACT],
      };
      const input = sha256(JSON.stringify(settings));
      let built = seen.get(z.key);
      if (!built) {
        const old = oldZones.get(z.key);
        const base = old && join(OUT, old.file);
        if (!args.force && old?.input === input && existsSync(`${base}.webm`) && existsSync(`${base}.m4a`)) {
          built = { file: old.file, frames: old.frames, input, limited: old.limited, cut: old.cut };
          skipped++;
        } else {
          const shaped = shapeZone(decodeSource(file, z.shift), z.maxLen, z.levelDb);
          const hash = sha256(Buffer.concat([Buffer.from(shaped.pcm.buffer), Buffer.from(JSON.stringify(settings.encoders))])).slice(0, 8);
          const rel = `${inst.set}/${name}/${z.key}.${hash}`;
          encode(shaped.pcm, join(OUT, rel));
          built = { file: rel, frames: shaped.pcm.length, input, limited: shaped.limited, cut: shaped.cut };
          encoded++;
        }
        seen.set(z.key, built);
        keep.add(join(OUT, `${built.file}.webm`)).add(join(OUT, `${built.file}.m4a`));
      }
      zones.push({
        key: z.key,
        ...z.entry,
        frames: built.frames,
        file: built.file,
        sample: `${z.source}:${z.sample}`,
        ...(z.shift !== 0 ? { derivedFrom: z.entry.root - z.shift, shift: z.shift } : {}),
        input: built.input,
        ...(built.limited ? { limited: true } : {}),
        ...(built.cut ? { cut: true } : {}),
      });
    }
    const lower = new Map();
    for (const z of zones) {
      const k = z.file.toLowerCase();
      if (lower.has(k) && lower.get(k) !== z.file) fail(`${name}: ${z.file} and ${lower.get(k)} differ only in case`);
      lower.set(k, z.file);
    }
    next[name] = { source: inst.source, zones };
  }

  // keep every other set's zones as last built; drop instruments no longer in instruments.json
  const all = {};
  for (const name of Object.keys(instruments).sort()) {
    const z = next[name] ?? prior[name];
    if (z) all[name] = z;
    else console.warn(`  warning: ${name} has never been built; it stays out of the tables`);
  }

  // 5. sizes and caps
  const setOf = (name) => instruments[name].set;
  const decoded = Object.fromEntries(SET_IDS.map((s) => [s, 0]));
  for (const [name, { zones }] of Object.entries(all)) decoded[setOf(name)] += sum(zones.map((z) => z.frames)) * 4;
  const errors = [];
  for (const s of SET_IDS) if (decoded[s] > SET_CAP) errors.push(`${s} decodes to ${fmtMiB(decoded[s])}, over ${fmtMiB(SET_CAP)}`);
  for (const s of [...BOARD_SETS, ...MINIGAME_SETS]) {
    if (decoded.core + decoded[s] > PAIR_CAP) errors.push(`core + ${s} decode to ${fmtMiB(decoded.core + decoded[s])}, over ${fmtMiB(PAIR_CAP)}`);
  }

  // The state keeps the encoded zones even when a cap fails, so the next build skips them; stale
  // files go only once the tables that reference them are rewritten.
  writeIfChanged(STATE_PATH, stateJson(all));
  printReport(all, instruments, decoded, sets);
  pitchCheck(all, instruments, sets);
  console.log(`\nZones: ${encoded} encoded, ${skipped} unchanged`);
  if (errors.length > 0) fail(`decoded-size caps broken:\n  ${errors.join("\n  ")}`);
  const removed = removeStale(sets, keep);
  if (removed > 0) console.log(`Removed ${removed} stale files`);

  const table = {};
  const zonesOut = {};
  for (const name of Object.keys(all)) {
    const r = instruments[name];
    table[name] = {
      set: r.set,
      kind: r.kind,
      standIn: r.standIn,
      oneShot: r.oneShot,
      release: r.release,
      gain: r.gain,
      velUpper: r.velUpper,
      maxShift: r.kind === "kit" ? 0 : MELODIC_MAX_SHIFT,
      maxLen: r.maxLen,
    };
    zonesOut[name] = {
      source: all[name].source,
      zones: all[name].zones.map(({ root, token, layer, rr, tune, frames, file }) =>
        root !== undefined ? { root, layer, rr, tune, frames, file } : { token, layer, rr, tune, frames, file },
      ),
    };
  }
  const wrote = [
    writeIfChanged(join(GEN, "instruments.gen.ts"), instrumentsTs(table)) && "instruments.gen.ts",
    writeIfChanged(join(GEN, "zones.gen.ts"), zonesTs(zonesOut)) && "zones.gen.ts",
    writeIfChanged(join(OUT, "CREDITS.txt"), creditsText(sources)) && "CREDITS.txt",
  ].filter(Boolean);
  console.log(wrote.length > 0 ? `Wrote ${wrote.join(", ")}` : "Generated files unchanged");
}

function printReport(all, instruments, decoded, sets) {
  const size = (file) => {
    const p = join(OUT, file);
    return existsSync(p) ? statSync(p).size : 0;
  };
  console.log("\nInstruments");
  for (const [name, { zones }] of Object.entries(all)) {
    const inst = instruments[name];
    if (!sets.includes(inst.set)) continue;
    const files = [...new Set(zones.map((z) => z.file))];
    const opus = sum(files.map((f) => size(`${f}.webm`)));
    const what =
      inst.kind === "kit"
        ? `tokens ${[...new Set(zones.map((z) => z.token))].join(" ")}`
        : `roots ${[...new Set(zones.map((z) => (z.shift ? `${z.root}${z.shift > 0 ? "^" : "*"}` : `${z.root}`)))].join(" ")}`;
    const frames = sum(zones.map((z) => z.frames));
    console.log(
      `  ${name.padEnd(9)} ${inst.set.padEnd(6)} ${String(zones.length).padStart(3)} zones  ${inst.velUpper.length} layer(s)  ` +
        `opus ${fmtMB(opus)}  decoded ${fmtMiB(frames * 4)}  ${what}`,
    );
  }
  console.log("  (* derived from the recording above it, ^ derived from the highest recording)");
  console.log("\nSets             opus        aac         decoded");
  for (const s of SET_IDS) {
    const files = Object.entries(all)
      .filter(([name]) => instruments[name].set === s)
      .flatMap(([, { zones }]) => zones.map((z) => z.file));
    if (files.length === 0) continue;
    const unique = [...new Set(files)];
    const opus = sum(unique.map((f) => size(`${f}.webm`)));
    const aac = sum(unique.map((f) => size(`${f}.m4a`)));
    const warn = DOWNLOAD_TARGET[s] > 0 && opus > DOWNLOAD_TARGET[s] * 1.25 ? `   WARNING: over the ${fmtMB(DOWNLOAD_TARGET[s])} target by more than 25%` : "";
    console.log(`  ${s.padEnd(14)} ${fmtMB(opus).padEnd(11)} ${fmtMB(aac).padEnd(11)} ${fmtMiB(decoded[s])} (cap ${fmtMiB(SET_CAP)})${warn}`);
  }
}

/**
 * Measures the fundamental of every melodic zone of the built sets from its Opus file and prints
 * its deviation from the zone's root, with the zone's tune applied (what the sampler plays at the
 * root). Warns beyond PITCH_TOLERANCE cents, and names a zone an octave or two off its root.
 */
function pitchCheck(all, instruments, sets) {
  console.log(`\nPitch check (each zone's Opus file against its root, tune applied; warns beyond ${PITCH_TOLERANCE} cents)`);
  const signed = (c) => `${c >= 0 ? "+" : ""}${c.toFixed(1)}`;
  for (const [name, { zones }] of Object.entries(all)) {
    const inst = instruments[name];
    if (inst.kind !== "melodic" || !sets.includes(inst.set)) continue;
    let worst = 0;
    for (const z of zones) {
      const { midi, harmonic, edge } = measurePitch(decodePcm(join(OUT, `${z.file}.webm`)), SR, z.root - z.tune / 100);
      const off = (midi - z.root) * 100 + z.tune;
      if (Math.abs(off) > Math.abs(worst)) worst = off;
      const from = z.shift ? ` (from ${z.derivedFrom}, ${z.shift > 0 ? "+" : ""}${z.shift})` : "";
      const how = `harmonic ${harmonic}${edge ? ", fine search at its edge: to 5 cents" : ""}`;
      console.log(
        `  ${name.padEnd(9)} ${z.key.padEnd(9)} sounds ${midi.toFixed(2)}${from}, tune ${signed(z.tune)} c: ${signed(off)} c  [${how}]`,
      );
      if (Math.abs(off) <= PITCH_TOLERANCE) continue;
      const octaves = [12, 24].find((n) => Math.abs(Math.abs(off) - n * 100) <= OCTAVE_NEAR);
      const why = octaves ? `, ${octaves === 12 ? "an octave" : "two octaves"} ${off > 0 ? "above" : "below"} its root: check the SFZ keycenters (rootOffset)` : "";
      console.warn(`  warning: ${name} zone ${z.key} is ${signed(off)} cents off its root${why}`);
    }
    console.log(`  ${name.padEnd(9)} worst ${signed(worst)} c`);
  }
}

/* ------------------------------------------------------------------ */
/*  main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const instruments = readJson(INSTRUMENTS_PATH);
  if (args.ranges) return printRanges(instruments);
  await build(args, instruments, readJson(SOURCES_PATH));
}

main().catch((e) => {
  console.error(e instanceof BuildError ? `build failed: ${e.message}` : e);
  process.exit(1);
});
