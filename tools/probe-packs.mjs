/**
 * probe-packs.mjs — pack picker persistence, exclusion, and coin multiplier.
 *
 *   node tools/probe-packs.mjs
 *
 * Expects the game at http://localhost:5177/.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.SSP_BASE ?? "http://localhost:5177";
const OUT = "tools/critic/frames/packs";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));

const fail = (msg) => {
  console.log("FAIL:", msg);
  console.log("console:", errors.slice(0, 6));
  process.exitCode = 1;
};

await page.goto(`${BASE}/?audio=0`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__SSP__ && window.__SSP__.state().minigameRules.count >= 9, null, { timeout: 20000 });

console.log("1. settings picker");
await page.evaluate(() => {
  localStorage.removeItem("ssp.minigamePacks");
  localStorage.removeItem("ssp.humanPack");
  localStorage.removeItem("ssp.minigameCoinMultiplier");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__SSP__?.state?.().screen === "title");
await page.getByRole("button", { name: /settings/i }).click();
await page.waitForSelector("[data-ssp-pack-picker]");
await page.screenshot({ path: `${OUT}/01-settings.png` });

const sideshow = page.locator('[data-ssp-role="rotation"][data-ssp-pack="sideshow"]');
await sideshow.click();
await page.locator('[data-ssp-role="multiplier"][data-ssp-mult="3"]').click();
const afterClick = await page.evaluate(() => window.__SSP__.state().minigameRules);
console.log("   after click", JSON.stringify(afterClick));
if (afterClick.enabledPacks.includes("sideshow")) fail("sideshow still enabled after toggle");
if (afterClick.coinMultiplier !== 3) fail("multiplier did not become 3");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__SSP__?.state?.().minigameRules);
const afterReload = await page.evaluate(() => ({
  rules: window.__SSP__.state().minigameRules,
  packs: localStorage.getItem("ssp.minigamePacks"),
  mult: localStorage.getItem("ssp.minigameCoinMultiplier"),
}));
console.log("   after reload", JSON.stringify(afterReload));
if (afterReload.rules.enabledPacks.includes("sideshow")) fail("sideshow came back after reload");
if (afterReload.rules.coinMultiplier !== 3) fail("multiplier did not persist");
if (!String(afterReload.packs).includes("midway") || String(afterReload.packs).includes("sideshow")) {
  fail("localStorage packs wrong: " + afterReload.packs);
}

console.log("2. character select layout");
await page.getByRole("button", { name: /^play/i }).click();
await page.waitForFunction(() => window.__SSP__.state().screen === "select");
await page.waitForSelector("[data-ssp-pack-picker]");
const startBox = await page.getByRole("button", { name: /start/i }).boundingBox();
console.log("   START box", JSON.stringify(startBox));
await page.screenshot({ path: `${OUT}/02-select-390.png` });
if (!startBox || startBox.y + startBox.height > 844 || startBox.y < 0) fail("START is off the 390x844 screen");

await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(300);
const startWide = await page.getByRole("button", { name: /start/i }).boundingBox();
await page.screenshot({ path: `${OUT}/03-select-430.png` });
console.log("   START wide", JSON.stringify(startWide));
if (!startWide || startWide.y + startWide.height > 932) fail("START is off the 430x932 screen");

console.log("3. seeded exclusion");
await page.setViewportSize({ width: 390, height: 844 });
const exclusion = await page.evaluate(() => {
  const ssp = window.__SSP__;
  ssp.setMinigamePacks(["midway", "bigtop"]);
  ssp.setHumanPack("midway");
  ssp.seed(7);
  ssp.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  const st = ssp.state();
  const picks = ssp.sampleMinigames(48);
  const banned = ["drum_solo", "pipe_puzzle", "memory_match"];
  return {
    packs: st.match.players.map((p) => p.pack),
    catalog: st.minigameRules.catalog,
    picks,
    bannedHit: picks.filter((p) => banned.includes(p.id) || p.pack === "sideshow"),
  };
});
console.log("   player packs", JSON.stringify(exclusion.packs));
console.log("   picks", exclusion.picks.map((p) => p.id).join(", "));
const catalogPack = Object.fromEntries(exclusion.catalog.map((c) => [c.id, c.pack]));
const expectPack = {
  bumper_balls: "midway",
  coin_cannon: "midway",
  push_of_war: "midway",
  drum_solo: "sideshow",
  pipe_puzzle: "sideshow",
  memory_match: "sideshow",
  cake_dash: "bigtop",
  balloon_pop: "bigtop",
  coin_grab: "bigtop",
};
for (const [id, pack] of Object.entries(expectPack)) {
  if (catalogPack[id] !== pack) fail(`${id} catalog pack is ${catalogPack[id]} wanted ${pack}`);
}
if (exclusion.picks.length < 12) fail("sample returned too few minigames");
if (exclusion.bannedHit.length) fail("excluded pack appeared: " + JSON.stringify(exclusion.bannedHit));
if (exclusion.packs.some((p) => p === "sideshow")) fail("a player was dealt the excluded pack");
const seen = new Set(exclusion.picks.map((p) => p.pack));
if (!seen.has("midway") || !seen.has("bigtop")) fail("enabled packs missing from sample: " + [...seen].join(","));

console.log("4. multiplier scales the pot");
const pay = await page.evaluate(() => {
  const ssp = window.__SSP__;
  ssp.setMinigamePacks(["bigtop"]);
  ssp.setMinigameCoinMultiplier(1);
  ssp.seed(7);
  ssp.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  const owners = ssp.state().match.players.map((p) => p.pack);
  const at1 = ssp.grantMinigamePayout(0, "bigtop");
  ssp.setMinigameCoinMultiplier(4);
  const at4 = ssp.grantMinigamePayout(0, "bigtop");
  const preview = ssp.minigameRewardPreview("bigtop");
  return { owners, at1, at4, preview };
});
console.log("   payout", JSON.stringify(pay));
if (!pay.owners.every((p) => p === "bigtop")) fail("expected every player on bigtop");
if (pay.at1 !== 40) fail("x1 payout expected 40 (10 x 4 owners), got " + pay.at1);
if (pay.at4 !== 160) fail("x4 payout expected 160, got " + pay.at4);
if (pay.preview !== 160) fail("preview did not match x4 payout");

console.log("5. preview line on a real minigame");
await page.goto(`${BASE}/?seed=7&audio=0&speed=8`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__SSP__?.state?.().screen === "title");
await page.evaluate(() => {
  window.__SSP__.setMinigamePacks(["midway"]);
  window.__SSP__.setMinigameCoinMultiplier(4);
  window.__SSP__.setHumanPack("midway");
});
await page.getByRole("button", { name: /^play/i }).click();
await page.waitForFunction(() => window.__SSP__.state().screen === "select");
await page.getByRole("button", { name: /start/i }).click();
await page.waitForFunction(() => window.__SSP__.state().screen === "board", null, { timeout: 15000 });
await page.evaluate(() => window.__SSP__.autoplay(true));
let preview = null;
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  preview = await page.evaluate(() => {
    const btn = document.querySelector("#mg-start-btn");
    if (!btn) return null;
    const card = btn.parentElement;
    return card ? card.innerText : null;
  });
  if (preview) break;
  await page.waitForTimeout(250);
}
console.log("   preview:", preview ? preview.replace(/\s+/g, " ").slice(0, 220) : "(none)");
if (!preview) fail("never reached a minigame preview");
else if (!preview.includes("Winner takes 160 coins")) fail("preview did not show the scaled payout");
else {
  await page.screenshot({ path: `${OUT}/04-preview.png` });
  await page.locator("#mg-start-btn").click();
}

fs.writeFileSync(`${OUT}/console-errors.txt`, errors.join("\n") || "(none)");
console.log(process.exitCode ? "PROBE FAILED" : "PROBE OK", "errors", errors.length);
await b.close();
