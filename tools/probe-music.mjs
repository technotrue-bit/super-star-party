/**
 * probe-music.mjs — does the sampled music work in a real browser?
 *
 * Eight cases, each in a fresh browser context:
 *   1. ?audio=1                   core set ready as Opus, music audible, no console errors
 *   2. ?audio=1&screen=board      the board plays its theme
 *   3. ?audio=1&samples=0         every note on a synth stand-in, music still audible
 *   4. ?audio=1&audiofmt=aac      Chromium has no AAC decoder: synth, one [audio] warning
 *   5. /music/ answered 3 s late  music is audible within 1 s on stand-ins
 *   6. one core file answered 404 no console errors; named in failed once the set is requested again
 *   7. ?audio=0                   no sample request at all, format "off"
 *   8. title > SETTINGS > CREDITS the overlay shows the sample credits, and closes
 *
 * Local only (needs `npm run dev` on port 5177); it is not part of CI.
 *   node tools/probe-music.mjs
 *   SSP_URL=http://127.0.0.1:5181 node tools/probe-music.mjs
 * CHROMIUM_PATH points Playwright at a Chromium binary (default /opt/pw-browsers/chromium when present).
 * Exit code 1 when any case fails.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = (process.env.SSP_URL ?? "http://127.0.0.1:5177").replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sample files, not Vite's module URLs (the dev server serves /src/audio/music/tracks.ts and the like). */
const isSampleUrl = (url) => {
  const { pathname } = new URL(url);
  return pathname.includes("/music/") && !pathname.includes("/src/");
};

async function waitForServer(ms = 60000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err?.cause?.code ?? err);
    }
    await sleep(1000);
  }
  throw new Error(`dev server at ${BASE} was not ready after ${ms} ms (${last})`);
}

// The autoplay flag lets the AudioContext run headless; a key press is the user gesture that unlocks it.
const browser = await chromium.launch({
  ...(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});

/**
 * A fresh page with its console, page errors and sample requests recorded.
 * `route` (optional) is a Playwright route handler applied to every request.
 */
async function openPage(route) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const log = { errors: [], warnings: [], sampleRequests: [] };
  page.on("console", (m) => {
    // `url` is the failed resource for the browser's own network errors.
    if (m.type() === "error") log.errors.push({ text: m.text(), url: m.location().url });
    if (m.type() === "warning") log.warnings.push(m.text());
  });
  page.on("pageerror", (e) => log.errors.push({ text: `PAGEERROR: ${String(e).slice(0, 200)}`, url: "" }));
  page.on("request", (req) => {
    if (isSampleUrl(req.url())) log.sampleRequests.push(req.url());
  });
  if (route) await page.route(() => true, route);
  return { page, log, close: () => context.close() };
}

/** Opens `?query` and waits until `screen` is on show, with the debug API there. */
async function boot(page, query, screen = "title") {
  await page.goto(`${BASE}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SSP__?.state, null, { timeout: 20000 });
  const shown = await poll(page, (s) => s.screen === screen, 20000);
  if (!shown.ok) throw new Error(`screen "${screen}" never showed (last: ${shown.last?.screen})`);
}

/** The first gesture: unlocks audio and starts the title music. */
const gesture = (page) => page.keyboard.press("Shift");

const snapshot = (page) =>
  page.evaluate(() => {
    const s = window.__SSP__?.state?.();
    return s ? { screen: s.screen, audio: s.audio } : null;
  });

/** Polls the debug state until `pred` holds or `ms` pass; always returns the last state seen. */
async function poll(page, pred, ms, step = 50) {
  const until = Date.now() + ms;
  for (;;) {
    const last = await snapshot(page);
    if (last && pred(last)) return { ok: true, last };
    if (Date.now() >= until) return { ok: false, last };
    await sleep(step);
  }
}

const AUDIBLE = 0.001;
const audible = (s) => s.audio.levels.rms > AUDIBLE;

/** Everything is on one line of output, so a failure shows the numbers it failed on. */
const samplesOf = (last) => JSON.stringify(last?.audio?.samples);

const cases = [];
const testCase = (name, run) => cases.push({ name, run });

/* ------------------------------------------------------------------ */

testCase("?audio=1: core ready as Opus, audible, no console errors", async (t) => {
  const { page, log, close } = await openPage();
  try {
    await boot(page, "audio=1");
    await gesture(page);
    const ready = await poll(page, (s) => s.audio.samples.sets.core === "ready", 5000);
    t.expect(ready.ok, `sets.core not "ready" within 5 s: ${samplesOf(ready.last)}`);
    t.expect(ready.last.audio.samples.format === "opus", `format is ${ready.last.audio.samples.format}, not opus`);
    const loud = await poll(page, audible, 3000);
    t.expect(loud.ok, `levels.rms never above ${AUDIBLE} (last ${loud.last?.audio.levels.rms})`);
    t.expect(log.errors.length === 0, `console errors: ${JSON.stringify(log.errors)}`);
    t.note(`format ${ready.last.audio.samples.format}, sets ${JSON.stringify(ready.last.audio.samples.sets)}, rms ${loud.last.audio.levels.rms.toFixed(4)}`);
  } finally {
    await close();
  }
});

testCase("?audio=1&screen=board: the board theme plays", async (t) => {
  const { page, close } = await openPage();
  try {
    await boot(page, "audio=1&screen=board", "board");
    await gesture(page);
    const themed = await poll(page, (s) => s.audio.theme === "board.fairground", 8000);
    t.expect(themed.ok, `theme is "${themed.last?.audio.theme}", not "board.fairground"`);
    t.note(`theme ${themed.last?.audio.theme}`);
  } finally {
    await close();
  }
});

testCase("?audio=1&samples=0: synth stand-ins, still audible", async (t) => {
  const { page, close } = await openPage();
  try {
    await boot(page, "audio=1&samples=0");
    await gesture(page);
    const synth = await poll(page, (s) => s.audio.samples.format === "synth", 5000);
    t.expect(synth.ok, `format is "${synth.last?.audio.samples.format}", not "synth"`);
    const loud = await poll(page, audible, 3000);
    t.expect(loud.ok, `levels.rms never above ${AUDIBLE} (last ${loud.last?.audio.levels.rms})`);
    t.note(`format ${synth.last?.audio.samples.format}, rms ${loud.last?.audio.levels.rms.toFixed(4)}`);
  } finally {
    await close();
  }
});

testCase("?audio=1&audiofmt=aac: synth, exactly one [audio] warning", async (t) => {
  const { page, log, close } = await openPage();
  try {
    await boot(page, "audio=1&audiofmt=aac");
    await gesture(page);
    const synth = await poll(page, (s) => s.audio.samples.format === "synth", 5000);
    t.expect(synth.ok, `format is "${synth.last?.audio.samples.format}", not "synth" (Chromium has no AAC decoder)`);
    await sleep(1500); // a second warning would land by now
    const warned = log.warnings.filter((w) => w.startsWith("[audio]"));
    t.expect(warned.length === 1, `${warned.length} [audio] warnings, wanted 1: ${JSON.stringify(warned)}`);
    t.expect(warned.every((w) => /decoded neither/.test(w)), `the warning is not the "decoded neither" one: ${JSON.stringify(warned)}`);
    t.note(`format ${synth.last?.audio.samples.format}; warning: ${warned[0]?.slice(0, 70)}...`);
  } finally {
    await close();
  }
});

testCase("/music/ answered 3 s late: audible within 1 s, on stand-ins", async (t) => {
  const { page, close } = await openPage(async (route) => {
    if (!isSampleUrl(route.request().url())) return route.continue();
    await sleep(3000);
    await route.continue().catch(() => {}); // the page may be gone by then
  });
  try {
    await boot(page, "audio=1");
    await gesture(page);
    const loud = await poll(page, audible, 1000);
    t.expect(loud.ok, `levels.rms never above ${AUDIBLE} within 1 s of the unlock`);
    const last = loud.last ?? (await snapshot(page));
    t.expect(last.audio.samples.sets.core !== "ready", `sets.core was already ready, so nothing was delayed: ${samplesOf(last)}`);
    t.expect(last.audio.samples.standInNotes > 0, `standInNotes is ${last.audio.samples.standInNotes}, wanted > 0`);
    t.note(`rms ${last.audio.levels.rms.toFixed(4)}, core ${last.audio.samples.sets.core}, standInNotes ${last.audio.samples.standInNotes}`);
  } finally {
    await close();
  }
});

testCase("one core file answered 404: no console errors; failed once the set is requested again", async (t) => {
  // Which file: the trumpet's first zone, from the generated zone tables.
  const INSTRUMENT = "trumpet";
  const zoneTables = fs.readFileSync("src/audio/samples/zones.gen.ts", "utf8");
  const file = zoneTables.match(new RegExp(`^  ${INSTRUMENT}: \\{[\\s\\S]*?file: "([^"]+)"`, "m"))?.[1];
  t.expect(!!file, `no zones for "${INSTRUMENT}" in src/audio/samples/zones.gen.ts`);
  if (!file) return;

  let hits = 0;
  const missing = `${BASE}/music/${file}.webm`;
  const { page, log, close } = await openPage(async (route) => {
    if (route.request().url() !== missing) return route.continue();
    hits++;
    await route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  try {
    // The loader tries a file once more only when its set is asked for again: a first
    // failure leaves the set "idle" and failed empty, and only the second one names the
    // instrument. Music asks for core whenever a track starts, and the board's starts a
    // few seconds after the board screen opens.
    await boot(page, "audio=1");
    const firstTry = await poll(page, (s) => hits >= 1 && s.audio.samples.sets.core === "idle", 15000);
    t.expect(firstTry.ok, `the first load never settled with the file missing (hits ${hits}): ${samplesOf(firstTry.last)}`);
    t.expect(firstTry.last.audio.samples.failed.length === 0, `failed is ${JSON.stringify(firstTry.last.audio.samples.failed)} after one failure, wanted []`);
    t.expect(firstTry.last.audio.samples.format === "opus", `format is ${firstTry.last.audio.samples.format}, not opus`);

    await page.evaluate(() => window.__SSP__.goto("board"));
    const second = await poll(page, (s) => s.audio.theme === "board.fairground" && s.audio.samples.failed.includes(INSTRUMENT), 15000);
    t.expect(second.ok, `failed does not name "${INSTRUMENT}" once the board music asked for core again: ${JSON.stringify(second.last?.audio.samples)}, theme ${second.last?.audio.theme}`);

    await page.evaluate(() => window.__SSP__.goto("title"));
    const home = await poll(page, (s) => s.screen === "title", 10000);
    t.expect(home.ok, "the title never showed again");

    // Chromium logs the 404 itself as a console error. That is its network log, not an app error.
    const appErrors = log.errors.filter((e) => !(e.url === missing && /Failed to load resource.*404/.test(e.text)));
    t.expect(appErrors.length === 0, `console errors: ${JSON.stringify(appErrors)}`);
    t.expect(hits === 2, `the missing file was requested ${hits}x, wanted 2 (the first try and one retry)`);
    t.note(`${file}.webm requested ${hits}x; failed ${JSON.stringify(second.last?.audio.samples.failed)}`);
  } finally {
    await close();
  }
});

testCase("?audio=0: no sample request, format off", async (t) => {
  const { page, log, close } = await openPage();
  try {
    await boot(page, "audio=0");
    await gesture(page);
    await sleep(2000);
    const s = await snapshot(page);
    t.expect(log.sampleRequests.length === 0, `${log.sampleRequests.length} /music/ requests: ${JSON.stringify(log.sampleRequests.slice(0, 3))}`);
    t.expect(s.audio.samples.format === "off", `format is "${s.audio.samples.format}", not "off"`);
    t.note(`format ${s.audio.samples.format}, ${log.sampleRequests.length} /music/ requests`);
  } finally {
    await close();
  }
});

testCase("title > SETTINGS > CREDITS: the credits show, and close", async (t) => {
  const { page, log, close } = await openPage();
  try {
    await boot(page, "audio=0");
    const press = async (label) => {
      const hit = await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll("button")).filter(
          (b) => (b.textContent || "").trim().toUpperCase().endsWith(text) && b.offsetParent !== null,
        );
        const last = buttons[buttons.length - 1]; // the topmost overlay's
        last?.click();
        return !!last;
      }, label);
      t.expect(hit, `no "${label}" button`);
      return hit;
    };
    const bodyText = () => page.evaluate(() => document.body.innerText);

    if (!(await press("SETTINGS"))) return;
    await page.waitForFunction(() => /MUSIC VOLUME/.test(document.body.innerText), null, { timeout: 5000 });
    if (!(await press("CREDITS"))) return;

    const shown = await page
      .waitForFunction(() => /VCSL/.test(document.body.innerText), null, { timeout: 5000 })
      .then(() => true, () => false);
    const text = await bodyText();
    t.expect(shown, "the credits text never appeared");
    for (const name of ["VCSL", "VSCO", "Virtuosity"]) t.expect(text.includes(name), `the credits do not mention ${name}`);
    t.expect(!text.includes("FreePats"), "the credits still mention FreePats (removed from the sources)");

    await press("CLOSE"); // the credits' own
    await sleep(300);
    const after = await bodyText();
    t.expect(!after.includes("VCSL"), "the credits stayed open after CLOSE");
    t.expect(/MUSIC VOLUME/.test(after), "CLOSE took the settings panel with it");
    t.expect(log.errors.length === 0, `console errors: ${JSON.stringify(log.errors)}`);
    t.note(`credits ${shown ? "shown" : "missing"}, closed ${!after.includes("VCSL")}`);
  } finally {
    await close();
  }
});

/* ------------------------------------------------------------------ */

await waitForServer();
let failed = 0;
for (const { name, run } of cases) {
  const failures = [];
  let note = "";
  const t = {
    expect: (cond, message) => {
      if (!cond) failures.push(message);
    },
    note: (text) => {
      note = text;
    },
  };
  try {
    await run(t);
  } catch (err) {
    failures.push(`threw: ${String(err?.message ?? err).split("\n")[0]}`);
  }
  if (failures.length === 0) {
    console.log(`PASS  ${name}${note ? `\n        ${note}` : ""}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`);
    for (const f of failures) console.log(`        ${f}`);
  }
}
await browser.close();
console.log(failed === 0 ? `\nALL ${cases.length} CASES PASS` : `\n${failed} of ${cases.length} CASES FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
