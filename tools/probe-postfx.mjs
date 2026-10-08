/**
 * probe-postfx.mjs — the postprocessing chunk stays unloaded until effects are on.
 *
 * Requires the dev server at http://localhost:5177 (or SSP_URL).
 * Run: node tools/probe-postfx.mjs
 *
 * Off: the page must not request postprocessing or postFxLazy.
 * High: that chunk comes back HTTP 200, the composer is RenderPass + one
 * EffectPass, and __SSP__.perf() reports fps.
 * Exits non-zero when any check fails.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? "http://localhost:5177";
const CHUNK = /postprocessing|postFxLazy/;

function fail(reasons, message) {
  reasons.push(message);
  console.error(`FAIL: ${message}`);
}

async function open(browser, fx) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  await page.goto(`${BASE}/?fx=${fx}&audio=0&screen=title`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
  return { page, hits, errors };
}

const reasons = [];
const browser = await chromium.launch();

try {
  console.log("1. effects Off");
  const off = await open(browser, "off");
  await off.page.waitForTimeout(2000);
  const offResources = await off.page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  const offAsked = [
    ...off.hits.map((hit) => hit.url),
    ...offResources.filter((url) => CHUNK.test(url)),
  ];
  const offState = await off.page.evaluate(() => {
    const api = window.__SSP__;
    return {
      quality: api.effectsQuality(),
      stateQuality: api.state().effectsQuality,
      passes: api.state().effectsPasses,
    };
  });
  console.log("   quality:", offState.quality, "| passes:", offState.passes, "| chunk requests:", offAsked.length);
  if (offState.quality !== "off" || offState.stateQuality !== "off") {
    fail(reasons, `Off page reported quality ${offState.quality} / ${offState.stateQuality}`);
  }
  if (offState.passes !== null) {
    fail(reasons, `Off page built a composer (${offState.passes} passes)`);
  }
  if (offAsked.length > 0) {
    fail(reasons, `Off page requested the effects chunk: ${offAsked.join(" ")}`);
  }
  if (off.errors.length > 0) {
    fail(reasons, `Off page console errors: ${off.errors.join(" | ")}`);
  }
  await off.page.close();

  console.log("2. effects High");
  const high = await open(browser, "high");
  try {
    await high.page.waitForFunction(
      () => window.__SSP__.state().effectsPasses === 2 && (window.__SSP__.perf()?.fps ?? 0) > 0,
      null,
      { timeout: 20000 },
    );
  } catch {
    fail(reasons, "High page did not reach 2 passes and a reported fps");
  }
  const highState = await high.page.evaluate(() => {
    const api = window.__SSP__;
    const perf = api.perf();
    return {
      quality: api.effectsQuality(),
      stateQuality: api.state().effectsQuality,
      passes: api.state().effectsPasses,
      fps: perf.fps,
      ms: perf.ms,
    };
  });
  const highResources = await high.page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  const loaded200 = high.hits.filter((hit) => CHUNK.test(hit.url) && hit.status === 200);
  console.log(
    `   quality: ${highState.quality} | passes: ${highState.passes} | fps: ${highState.fps} | frame ms: ${highState.ms}`,
  );
  console.log(`   chunk 200s: ${loaded200.length}`);
  for (const hit of high.hits) console.log(`   ${hit.status} ${hit.url}`);
  if (highState.quality !== "high" || highState.stateQuality !== "high") {
    fail(reasons, `High page reported quality ${highState.quality} / ${highState.stateQuality}`);
  }
  if (highState.passes !== 2) {
    fail(reasons, `High page pass count is ${highState.passes}, expected 2 (RenderPass + EffectPass)`);
  }
  if (!Number.isFinite(highState.fps) || highState.fps <= 0) {
    fail(reasons, `High page did not report fps (got ${highState.fps})`);
  }
  if (loaded200.length === 0) {
    const names = highResources.filter((url) => CHUNK.test(url));
    fail(reasons, `High page did not load the effects chunk with HTTP 200 (resource names: ${names.join(" ") || "none"})`);
  }
  if (high.errors.length > 0) {
    fail(reasons, `High page console errors: ${high.errors.join(" | ")}`);
  }

  const toggled = await high.page.evaluate(() => window.__SSP__.setEffectsQuality("off"));
  await high.page.waitForTimeout(200);
  const after = await high.page.evaluate(() => window.__SSP__.state().effectsPasses);
  if (toggled !== "off" || after !== null) {
    fail(reasons, `setEffectsQuality("off") left quality ${toggled} and passes ${after}`);
  }
  const restored = await high.page.evaluate(() => window.__SSP__.setEffectsQuality("high"));
  try {
    await high.page.waitForFunction(() => window.__SSP__.state().effectsPasses === 2, null, { timeout: 10000 });
  } catch {
    fail(reasons, `turning effects back on did not restore 2 passes (setEffectsQuality returned ${restored})`);
  }
  await high.page.waitForTimeout(300);
  if (high.errors.length > 0) {
    fail(reasons, `console errors after toggling effects: ${high.errors.join(" | ")}`);
  }
  await high.page.close();
} catch (err) {
  fail(reasons, err instanceof Error ? err.stack ?? err.message : String(err));
} finally {
  await browser.close();
}

if (reasons.length > 0) {
  console.error(`\nprobe-postfx: ${reasons.length} failure(s)`);
  process.exit(1);
}
console.log("\nprobe-postfx: pass");
process.exit(0);
