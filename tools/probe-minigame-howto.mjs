/**
 * probe-minigame-howto.mjs — the START card explains the minigame.
 *
 * Every registered game must have a how-to. Before START MINI GAME, that
 * text is on screen for a contact game (Bumper Balls) and two games you
 * play by tapping (Memory Match, Balloon Pop). The start button stays the
 * same control smoke already clicks.
 *
 * Foreground: node tools/probe-minigame-howto.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "tools/critic/frames/howto";
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { id: "bumper_balls", kind: "contact" },
  { id: "memory_match", kind: "non-contact" },
  { id: "balloon_pop", kind: "non-contact" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 180));
});

let failed = false;
function fail(msg) {
  failed = true;
  console.log("FAIL:", msg);
}

await page.goto("http://127.0.0.1:5177/?seed=7&audio=0&speed=8", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const cat = window.__SSP__?.state?.()?.minigameRules?.catalog ?? [];
  return cat.length >= 9 && cat.every((row) => (row.description || "").trim().length > 20);
}, null, { timeout: 20000 });

const catalog = await page.evaluate(() => window.__SSP__.state().minigameRules.catalog);
console.log(`catalog: ${catalog.length} minigames`);
for (const row of catalog) {
  const text = (row.description || "").trim();
  console.log(`  ${row.id}: ${text}`);
  if (!/tap|drag|hold/i.test(text)) fail(`${row.id} how-to does not say how to play`);
  if (!/win/i.test(text)) fail(`${row.id} how-to does not say how to win`);
}

for (const spec of CASES) {
  const row = catalog.find((c) => c.id === spec.id);
  if (!row) {
    fail(`missing catalog row ${spec.id}`);
    continue;
  }
  await page.goto(
    `http://127.0.0.1:5177/?seed=7&audio=0&speed=8&minigame=${spec.id}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction((id) => {
    const row = (window.__SSP__?.state?.()?.minigameRules?.catalog ?? []).find((c) => c.id === id);
    return !!row && (row.description || "").trim().length > 20;
  }, spec.id, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForSelector("#mg-start-btn", { timeout: 10000 });
  await page.waitForSelector("[data-mg-howto]", { timeout: 2000 });

  const seen = await page.evaluate(() => {
    const how = document.querySelector("[data-mg-howto]");
    const btn = document.querySelector("#mg-start-btn");
    const card = how?.parentElement ?? null;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const visible = (el, host) => {
      if (!el || !host) return false;
      const r = el.getBoundingClientRect();
      const c = host.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (r.width < 8 || r.height < 8) return false;
      return r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.top >= 0 && r.bottom <= window.innerHeight;
    };
    return {
      text: (how?.textContent || "").replace(/\s+/g, " ").trim(),
      button: (btn?.textContent || "").replace(/\s+/g, " ").trim(),
      howVisible: visible(how, card),
      btnVisible: visible(btn, card),
      howBox: box(how),
      btnBox: box(btn),
    };
  });

  console.log(`${spec.kind} ${spec.id}: visible how=${seen.howVisible} start=${seen.btnVisible} boxes ${JSON.stringify({ how: seen.howBox, btn: seen.btnBox })}`);
  console.log(`  "${seen.text}"`);
  if (seen.text !== row.description.trim()) fail(`${spec.id} card text is not the registered how-to`);
  if (!seen.howVisible) fail(`${spec.id} how-to is not visible on the start card`);
  if (!seen.btnVisible) fail(`${spec.id} START MINI GAME is not visible`);
  if (seen.button !== "START MINI GAME") fail(`${spec.id} start button reads "${seen.button}"`);
  if (seen.howBox && seen.btnBox && seen.howBox.bottom > seen.btnBox.top + 2) {
    fail(`${spec.id} how-to covers the start button`);
  }
  await page.screenshot({ path: `${OUT}/${spec.id}.png` });
}

console.log(errors.length ? `console errors: ${errors.slice(0, 4).join(" | ")}` : "console errors: none");
if (errors.length) fail("page errors");
console.log(failed ? "\nVERDICT: how-to card needs attention" : "\nVERDICT: how-to is on the start card for contact and non-contact games");
await browser.close();
process.exitCode = failed ? 1 : 0;
