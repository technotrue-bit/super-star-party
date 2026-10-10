/**
 * probe-minigame-framing.mjs — every minigame framed on a phone.
 *
 * Requires a dev server (SSP_URL, default http://127.0.0.1:5177).
 * For each minigame (src/minigames/<id>/) and phone size, opens it with
 * __SSP__.openMinigame under autoplay and shoots four beats:
 *   1-vs    VS intro (title popped in)
 *   2-mid   mid-game
 *   3-win   results headline ("X WINS!")
 *   4-card  results rank card
 * and fails when
 *   - one flat colour (quantised to 4 bits per channel) covers more than
 *     35% of the frame (a void: clear colour, an occluder, an empty floor), or
 *   - a visible headline / banner / floating "+N" / rank card box leaves the
 *     viewport, or two of them overlap (one headline at a time, "+N" never
 *     over the headline or the card), or
 *   - the results beats never come (no headline, no rank card), or a page error.
 *
 * Env:
 *   SSP_BROWSER  chromium (default) | webkit | both
 *   SSP_GAMES    comma list (default: every folder in src/minigames)
 *   SSP_SIZES    comma list of WxH (default 390x844,430x932)
 *   SSP_SPEED    game speed URL param (default 1; >1 risks shooting the exit wipe)
 *   SSP_SHOTS    screenshot dir
 *
 * Run: node tools/probe-minigame-framing.mjs
 * Prints a per-game table. Exits non-zero when any check fails.
 */
import { chromium, webkit } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const SHOTS = process.env.SSP_SHOTS ?? "/opt/cursor/artifacts";
// Speed 1 by default: with dt capped per frame, a slow headless frame can
// only make game time run slower than the wall clock, never faster, so the
// wall-clock waits for the results beats can't overshoot into the exit wipe.
const SPEED = Math.max(1, Number(process.env.SSP_SPEED ?? 1));
const FLAT_MAX = 0.35;
const EDGE_TOL = 2; // px a glyph shadow may poke past the edge
const OVERLAP_MIN = 6; // px of overlap on both axes before two boxes count as overlapping
fs.mkdirSync(SHOTS, { recursive: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const mgDir = path.join(here, "..", "src", "minigames");
const allGames = fs
  .readdirSync(mgDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const GAMES = (process.env.SSP_GAMES ?? process.env.GAMES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const games = GAMES.length ? GAMES : allGames;
const sizes = (process.env.SSP_SIZES ?? "390x844,430x932").split(",").map((s) => {
  const [w, h] = s.trim().split("x").map(Number);
  return { w, h };
});
const browserName = (process.env.SSP_BROWSER ?? "chromium").toLowerCase();
const browsers = browserName === "both" ? ["chromium", "webkit"] : [browserName];

const rows = [];
let failed = 0;

/** Largest share of the frame taken by one 4-bit-per-channel colour. */
function flatShare(buf) {
  const png = PNG.sync.read(buf);
  const counts = new Map();
  const { data } = png;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    n++;
  }
  let best = 0;
  let bestKey = 0;
  for (const [k, c] of counts) {
    if (c > best) {
      best = c;
      bestKey = k;
    }
  }
  const hex = `#${((bestKey >> 8) & 15).toString(16)}${((bestKey >> 4) & 15).toString(16)}${(bestKey & 15).toString(16)}`;
  return { share: best / Math.max(1, n), colour: hex };
}

/** Visible text boxes the player must be able to read, measured in the page. */
async function textBoxes(page) {
  return page.evaluate(() => {
    const sel = "[data-ssp-headline], .ssp-fb-banner, .ssp-banner, [data-ssp-float], [data-ssp-results]";
    const shown = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
      }
      return true;
    };
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!(el instanceof HTMLElement) || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const kind = el.dataset.sspResults
        ? "card"
        : el.dataset.sspFloat
          ? "float"
          : "headline";
      out.push({
        kind,
        text: (el.textContent ?? "").trim().slice(0, 40),
        l: r.left,
        t: r.top,
        r: r.right,
        b: r.bottom,
      });
    }
    return out;
  });
}

function checkBoxes(boxes, w, h) {
  const issues = [];
  for (const b of boxes) {
    if (b.l < -EDGE_TOL || b.t < -EDGE_TOL || b.r > w + EDGE_TOL || b.b > h + EDGE_TOL) {
      issues.push(`off-screen ${b.kind} "${b.text}" [${Math.round(b.l)},${Math.round(b.t)},${Math.round(b.r)},${Math.round(b.b)}]`);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.kind === "card" && b.kind === "card") continue;
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > OVERLAP_MIN && oy > OVERLAP_MIN) issues.push(`overlap ${a.kind} "${a.text}" x ${b.kind} "${b.text}"`);
    }
  }
  return issues;
}

async function shoot(page, file, w, h, beat) {
  const buf = await page.screenshot({ path: file });
  const flat = flatShare(buf);
  const boxes = await textBoxes(page);
  const issues = checkBoxes(boxes, w, h);
  if (flat.share > FLAT_MAX) issues.push(`flat ${flat.colour} ${(flat.share * 100).toFixed(0)}%`);
  if (beat === "3-win" && !boxes.some((b) => b.kind === "headline" && /WINS?!/.test(b.text))) issues.push("no WINS! headline");
  if (beat === "4-card" && !boxes.some((b) => b.kind === "card")) issues.push("no rank card");
  return { flat: flat.share, issues };
}

async function runGame(browser, bname, id, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  const tag = `${id}-${w}x${h}-${bname}`;
  const row = { game: id, size: `${w}x${h}`, browser: bname, beats: {}, flat: 0, issues: [] };
  const beat = async (name) => {
    const res = await shoot(page, path.join(SHOTS, `framing-${tag}-${name}.png`), w, h, name);
    row.beats[name] = res.issues.length ? "FAIL" : "ok";
    row.flat = Math.max(row.flat, res.flat);
    for (const i of res.issues) row.issues.push(`${name}: ${i}`);
  };
  try {
    await page.goto(`${BASE}/?audio=0&seed=7&speed=${SPEED}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SSP__?.state?.()?.screen === "title", null, { timeout: 60000 });
    await page.evaluate(() => window.__SSP__.autoplay(true));
    await page.evaluate((g) => window.__SSP__.openMinigame(g), id);
    await page.waitForFunction(() => document.body.dataset.mgPhase === "vs-splash", null, { timeout: 60000, polling: 30 });
    // The title pops in over ~0.4 s of wall clock; the splash lasts 1.7 s of game time.
    await page.waitForTimeout(Math.min(650, Math.max(450, 1500 / SPEED)));
    await beat("1-vs");
    await page.waitForFunction(() => document.body.dataset.mgPhase === "play", null, { timeout: 60000, polling: 50 });
    await page.waitForTimeout(5000 / SPEED);
    await beat("2-mid");
    await page.waitForFunction(() => document.body.dataset.mgResults === "banner", null, { timeout: 120000, polling: 50 });
    await page.waitForTimeout(650); // headline transition (wall clock)
    await beat("3-win");
    await page.waitForFunction(() => document.body.dataset.mgResults === "card", null, { timeout: 30000, polling: 50 });
    // Card slide-up is 0.4 s of wall clock; the ceremony ends 1.1 s of game
    // time after the card, so stay well inside that at any SSP_SPEED.
    await page.waitForTimeout(Math.min(420, 1000 / SPEED));
    await beat("4-card");
  } catch (e) {
    row.issues.push(`timeout/error: ${String(e).split("\n")[0].slice(0, 140)} (phase=${await page.evaluate(() => document.body.dataset.mgPhase ?? "-").catch(() => "?")})`);
    await page.screenshot({ path: path.join(SHOTS, `framing-${tag}-x-fail.png`) }).catch(() => {});
  }
  if (errors.length) row.issues.push(`pageerror: ${errors[0]}`);
  await ctx.close();
  return row;
}

for (const bname of browsers) {
  const launcher = bname === "webkit" ? webkit : chromium;
  const browser = await launcher.launch();
  try {
    for (const { w, h } of sizes) {
      for (const id of games) {
        const row = await runGame(browser, bname, id, w, h);
        rows.push(row);
        const ok = row.issues.length === 0;
        if (!ok) failed++;
        console.log(`${ok ? "ok  " : "FAIL"} ${row.game} ${row.size} ${row.browser}${ok ? "" : `: ${row.issues.join(" | ")}`}`);
      }
    }
  } finally {
    await browser.close();
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(`${pad("game", 14)}${pad("size", 9)}${pad("browser", 10)}${pad("vs", 6)}${pad("mid", 6)}${pad("win", 6)}${pad("card", 6)}max flat`);
for (const r of rows) {
  console.log(
    `${pad(r.game, 14)}${pad(r.size, 9)}${pad(r.browser, 10)}${pad(r.beats["1-vs"] ?? "-", 6)}${pad(r.beats["2-mid"] ?? "-", 6)}${pad(r.beats["3-win"] ?? "-", 6)}${pad(r.beats["4-card"] ?? "-", 6)}${(r.flat * 100).toFixed(0)}%`
  );
}
console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${rows.length - failed}/${rows.length} game x size x browser runs clean (shots in ${SHOTS})`);
process.exit(failed === 0 ? 0 : 1);
