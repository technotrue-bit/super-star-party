/**
 * probe-rapier.mjs — Rapier stays unloaded until a contact minigame.
 *
 * Requires the dev server at http://localhost:5177 (or SSP_URL).
 * Run: node tools/probe-rapier.mjs
 *
 * Title and a non-contact minigame (Memory Match) must not request the
 * rapier chunk. Bumper Balls must load it with HTTP 200, report contact
 * bodies, and a two-ball scenario must actually collide and separate.
 * Exits non-zero when any check fails.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? "http://localhost:5177";
const CHUNK = /rapier/i;

function fail(reasons, message) {
  reasons.push(message);
  console.error(`FAIL: ${message}`);
}

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const hits = [];
  page.on("response", (res) => {
    const url = res.url();
    if (CHUNK.test(url)) hits.push({ url, status: res.status() });
  });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 240)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 240));
  });
  await page.goto(`${BASE}/?fx=off&audio=0&screen=title&seed=7`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
  return { page, hits, errors };
}

async function urls(page) {
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  return resources.filter((url) => CHUNK.test(url));
}

async function waitScreen(page, screen) {
  await page.waitForFunction(
    (name) => {
      const api = window.__SSP__;
      const st = api?.state?.();
      return st && st.screen === name && !st.isWiping;
    },
    screen,
    { timeout: 20000 },
  );
}

const reasons = [];
const browser = await chromium.launch();

try {
  console.log("1. title (outside every minigame)");
  const page = await open(browser);
  await page.page.waitForTimeout(1500);
  const titleAsked = [...page.hits.map((hit) => hit.url), ...(await urls(page.page))];
  const titleRapier = await page.page.evaluate(() => window.__SSP__.rapier?.());
  console.log("   rapier():", titleRapier, "| chunk requests:", titleAsked.length);
  if (titleAsked.length > 0) {
    fail(reasons, `title requested the rapier chunk: ${titleAsked.join(" ")}`);
  }
  if (!titleRapier || titleRapier.loaded !== false || titleRapier.contactBodies !== 0) {
    fail(reasons, `title rapier status was ${JSON.stringify(titleRapier)}`);
  }
  if (page.errors.length > 0) {
    fail(reasons, `title console errors: ${page.errors.join(" | ")}`);
  }

  console.log("2. Memory Match (non-contact)");
  await page.page.evaluate(() => window.__SSP__.openMinigame("memory_match"));
  try {
    await waitScreen(page.page, "minigame");
  } catch {
    fail(reasons, "Memory Match did not open");
  }
  await page.page.waitForTimeout(1500);
  const memoryAsked = [...page.hits.map((hit) => hit.url), ...(await urls(page.page))];
  const memoryState = await page.page.evaluate(() => ({
    screen: window.__SSP__.state().screen,
    rapier: window.__SSP__.rapier?.(),
  }));
  console.log("   screen:", memoryState.screen, "| rapier():", memoryState.rapier, "| chunk requests:", memoryAsked.length);
  if (memoryState.screen !== "minigame") {
    fail(reasons, `Memory Match left the screen on ${memoryState.screen}`);
  }
  if (memoryAsked.length > 0) {
    fail(reasons, `Memory Match requested the rapier chunk: ${memoryAsked.join(" ")}`);
  }
  if (memoryState.rapier?.loaded) {
    fail(reasons, "Memory Match loaded Rapier");
  }
  if (page.errors.length > 0) {
    fail(reasons, `Memory Match console errors: ${page.errors.join(" | ")}`);
  }

  console.log("3. Bumper Balls (contact)");
  await page.page.evaluate(() => window.__SSP__.goto("board"));
  try {
    await waitScreen(page.page, "board");
  } catch {
    fail(reasons, "leaving Memory Match did not reach the board");
  }
  await page.page.evaluate(() => window.__SSP__.openMinigame("bumper_balls"));
  try {
    await page.page.waitForFunction(
      () => {
        const api = window.__SSP__;
        const rapier = api.rapier?.();
        const st = api.state?.();
        return st?.screen === "minigame" && !st.isWiping && rapier?.loaded === true && rapier.contactBodies > 0;
      },
      null,
      { timeout: 20000 },
    );
  } catch {
    const snap = await page.page.evaluate(() => ({
      screen: window.__SSP__.state().screen,
      wiping: window.__SSP__.state().isWiping,
      rapier: window.__SSP__.rapier?.(),
    }));
    fail(reasons, `Bumper Balls did not load Rapier with contact bodies: ${JSON.stringify(snap)}`);
  }
  const scenario = await page.page.evaluate(async () => window.__SSP__.runContactScenario());
  const bumper = await page.page.evaluate(() => window.__SSP__.rapier());
  const loaded200 = page.hits.filter((hit) => CHUNK.test(hit.url) && hit.status === 200);
  console.log("   rapier():", bumper);
  console.log("   scenario:", scenario);
  console.log(`   chunk 200s: ${loaded200.length}`);
  for (const hit of page.hits) console.log(`   ${hit.status} ${hit.url}`);
  if (loaded200.length === 0) {
    const names = await urls(page.page);
    fail(reasons, `Bumper Balls did not load the rapier chunk with HTTP 200 (resource names: ${names.join(" ") || "none"})`);
  }
  if (!scenario?.contacted || !scenario?.separated || !(scenario.minGap > -0.2)) {
    fail(reasons, `contact scenario failed: ${JSON.stringify(scenario)}`);
  }
  if (!(bumper.contactBodies > 0)) {
    fail(reasons, `Bumper Balls reported ${bumper.contactBodies} contact bodies`);
  }
  if (page.errors.length > 0) {
    fail(reasons, `Bumper Balls console errors: ${page.errors.join(" | ")}`);
  }

  console.log("4. leave the minigame");
  await page.page.evaluate(() => window.__SSP__.goto("board"));
  try {
    await waitScreen(page.page, "board");
  } catch {
    fail(reasons, "exiting Bumper Balls did not reach the board");
  }
  await page.page.waitForTimeout(400);
  const after = await page.page.evaluate(() => window.__SSP__.rapier());
  console.log("   rapier():", after);
  if (after.contactBodies !== 0) {
    fail(reasons, `contact bodies survived the minigame (${after.contactBodies})`);
  }
  if (page.errors.length > 0) {
    fail(reasons, `console errors after exit: ${page.errors.join(" | ")}`);
  }
  await page.page.close();
} catch (err) {
  fail(reasons, err instanceof Error ? err.stack ?? err.message : String(err));
} finally {
  await browser.close();
}

if (reasons.length > 0) {
  console.error(`\nprobe-rapier: ${reasons.length} failure(s)`);
  process.exit(1);
}
console.log("\nprobe-rapier: pass");
process.exit(0);
