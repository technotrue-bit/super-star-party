/**
 * probe-minigame-howto.mjs — the START card explains the minigame.
 *
 * Every registered game must have a how-to. Before START MINI GAME, that
 * text is on screen for a contact game (Bumper Balls) and two games you
 * play by tapping (Memory Match, Balloon Pop). The start button stays the
 * same control smoke already clicks.
 *
 * It also checks the practice beat of the hidden control_lab game for each
 * control pad (hold, swipe, twin, dial, draw): the prompt on screen names the
 * control, and doing the keyboard action once ends the beat (the lesson is
 * learned) and moves on to GO. A round that is never touched stays in practice.
 *
 * Foreground: node tools/probe-minigame-howto.mjs [id ...]
 *   no id         every START card case, then the control_lab practice beat per pad
 *   control_lab   only the control_lab practice beats (add a pad name to pick one)
 *   <game id>     only that START card case
 * Prints PASS or FAIL <what>; exit code 1 on any fail.
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

/** The practice prompt each control pad shows, and the keyboard action that learns it. */
const PADS = {
  hold: {
    prompt: "HOLD to charge, LET GO to throw",
    act: async (page) => {
      await page.keyboard.down("Space");
      await page.waitForTimeout(350);
      await page.keyboard.up("Space");
    },
  },
  swipe: {
    prompt: "SWIPE to flick",
    act: async (page) => {
      await page.keyboard.down("ArrowUp");
      await page.keyboard.down("Space");
      await page.waitForTimeout(350);
      await page.keyboard.up("Space");
      await page.keyboard.up("ArrowUp");
    },
  },
  twin: {
    prompt: "Tap A and B",
    act: async (page) => {
      await page.keyboard.press("z");
      await page.waitForTimeout(80);
      await page.keyboard.press("x");
    },
  },
  dial: {
    prompt: "Spin the WHEEL",
    act: async (page) => {
      await page.keyboard.down("e");
      await page.waitForTimeout(800);
      await page.keyboard.up("e");
    },
  },
  draw: {
    prompt: "DRAW a path",
    act: async (page) => {
      await page.keyboard.down("Space");
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(500);
      await page.keyboard.up("ArrowRight");
      await page.keyboard.up("Space");
    },
  },
};

// Which cases to run. No argument runs everything.
const asked = process.argv.slice(2);
const wantCard = (id) => asked.length === 0 || asked.includes(id);
const padArgs = asked.filter((a) => a in PADS);
const labPads = asked.length === 0 || asked.includes("control_lab")
  ? (padArgs.length ? padArgs : Object.keys(PADS))
  : padArgs;

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

for (const spec of CASES.filter((c) => wantCard(c.id))) {
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

/** Wait up to ms for a probe to be true, polling the page. */
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// The practice beat of the control lab, one run per pad.
for (const pad of labPads) {
  const spec = PADS[pad];
  await page.goto(
    `http://127.0.0.1:5177/?seed=7&audio=0&minigame=control_lab&pad=${pad}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.seed(7);
    window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__SSP__.goto("minigame"));
  await page.waitForSelector("#mg-start-btn", { timeout: 10000 });
  await page.click("#mg-start-btn");
  const phase = () => page.evaluate(() => window.__SSP__.mgProbe().phase);
  // The VS splash skips on a key once its grace delay passes.
  const reached = await until(async () => {
    // Skip the splash with a key sent from inside the page, in the same step that
    // checks the phase: a real key press could land in the practice beat and be
    // mistaken for the lesson.
    return page.evaluate(() => {
      const ph = window.__SSP__.mgProbe().phase;
      if (ph === "vs-splash") window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      return ph === "practice";
    });
  }, 30000);
  if (!reached) {
    fail(`prompt: control_lab ${pad} never reached the practice beat (phase "${await phase()}")`);
    continue;
  }
  // A prompt tells the player what to do before they do it.
  await page.waitForSelector("[data-mg-practice]", { timeout: 2000 });
  const text = await page.evaluate(() => (document.querySelector("[data-mg-practice]")?.textContent || "").replace(/\s+/g, " ").trim());
  console.log(`control_lab ${pad}: "${text}"`);
  if (!text.includes(spec.prompt)) fail(`prompt: control_lab ${pad} practice reads "${text}", wanted "${spec.prompt}"`);
  await page.screenshot({ path: `${OUT}/control_lab_${pad}_practice.png` });

  // Untouched, the beat is still going a moment later.
  await page.waitForTimeout(600);
  if ((await phase()) !== "practice") fail(`advance: control_lab ${pad} left practice with no action`);

  await spec.act(page);
  const learned = await until(() => page.evaluate(() => document.querySelector("[data-mg-practice]")?.dataset.mgPracticeDone === "1" || window.__SSP__.mgProbe().phase !== "practice"), 3000);
  if (!learned) fail(`advance: control_lab ${pad} practice did not notice the action`);
  const moved = await until(async () => (await phase()) !== "practice", 6000);
  if (!moved) fail(`advance: control_lab ${pad} stayed in practice after the action`);
  // The game must not have seen any practice input.
  const seen = await page.evaluate(() => window.__SSP__.mgProbe().inputs.slice());
  if (seen.length) fail(`leak: control_lab ${pad} practice reached the game: ${JSON.stringify(seen)}`);
}

console.log(errors.length ? `console errors: ${errors.slice(0, 4).join(" | ")}` : "console errors: none");
if (errors.length) fail("page errors");
console.log(failed ? "\nVERDICT: how-to card needs attention" : "\nVERDICT: how-to is on the start card for contact and non-contact games");
console.log(failed ? "FAIL" : "PASS");
await browser.close();
process.exitCode = failed ? 1 : 0;
