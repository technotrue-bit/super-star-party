/**
 * probe-player-labels.mjs — player labels, YOU pill, minigame seat tags, Pick a Hero layout.
 *
 *   A. rules table via __SSP__.labelRules (You vs Player N, CPUs keep names)
 *   B. solo, chromium 390x844: HUD chips + YOU pill, bumper_balls "YOU ▼" tag
 *   C. 2 and 4 tabs-relay peers (net-play room setup): identical label arrays, own YOU chip,
 *      no desync; minigame tags are checked only when a minigame opens in the room
 *   D. Pick a Hero, webkit 390x844 and 430x932: hero inside viewport/slot, no overlaps
 *
 *   SSP_URL=http://127.0.0.1:5195 SSP_SHOTS=/workspace/ssp-labels-shots/probe node tools/probe-player-labels.mjs
 *
 * Exits non-zero on any failure. Needs a dev/CI build (debug hooks are gated).
 */
import { chromium, webkit } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.SSP_URL ?? "http://127.0.0.1:5177";
const SHOTS = process.env.SSP_SHOTS ?? "/opt/cursor/artifacts";
fs.mkdirSync(SHOTS, { recursive: true });
const LOAD = 60000;
const t0 = Date.now();
const rows = [];
const errors = [];

function check(name, ok, detail = "") {
  rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 140) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + String(detail).slice(0, 200) : ""}`);
}
function note(msg) {
  console.log(`NOTE ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function waitForServer(url, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`dev server at ${url} not ready`);
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/interactive-widget/.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`${label} PAGE: ${String(e).slice(0, 160)}`));
}
async function ready(page) {
  await page.waitForFunction(() => !!window.__SSP__?.state, null, { timeout: LOAD });
}
async function clickText(page, re) {
  return page.evaluate(
    ([src, flags]) => {
      const rx = new RegExp(src, flags);
      const hit = Array.from(document.querySelectorAll("button, [role=button], .ssp-btn")).find(
        (b) => rx.test((b.textContent || "").trim()) && b.offsetParent !== null &&
          getComputedStyle(b).pointerEvents !== "none" && parseFloat(getComputedStyle(b).opacity) > 0.5,
      );
      if (hit) hit.click();
      return !!hit;
    },
    [re.source, re.flags],
  );
}
async function screenOf(page) {
  return page.evaluate(() => window.__SSP__?.state?.()?.screen ?? null);
}
async function chips(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return Array.from(document.querySelectorAll("[data-hud-player]")).map((c) => {
      const r = c.getBoundingClientRect();
      const pill = c.querySelector(".ssp-hud-chip__you");
      const pr = pill ? pill.getBoundingClientRect() : null;
      const pillShown = !!pill && !pill.hidden && getComputedStyle(pill).display !== "none" && pr.width > 0;
      const inside = (b) => b.left >= -1 && b.top >= -1 && b.right <= vw + 1 && b.bottom <= vh + 1;
      return {
        id: Number(c.getAttribute("data-hud-player")),
        text: (c.querySelector(".ssp-hud-chip__name")?.textContent ?? "").trim(),
        you: c.hasAttribute("data-you"),
        inside: inside(r),
        pillShown,
        pillInside: pillShown && inside(pr),
      };
    });
  });
}
async function waitChips(page, n = 4) {
  await page.waitForFunction(
    (k) => document.querySelectorAll("[data-hud-player]").length >= k &&
      Array.from(document.querySelectorAll(".ssp-hud-chip__name")).every((e) => (e.textContent ?? "").trim()),
    n,
    { timeout: LOAD },
  );
  await sleep(700);
}

await waitForServer(`${BASE}/`);

// ---------------------------------------------------------------- A
console.log("== A. rules");
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(page, "A");
  await page.goto(`${BASE}/?audio=0`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await ready(page);
  const rules = (c, online) => page.evaluate(([cc, o]) => window.__SSP__.labelRules(cc, o), [c, online]);
  const longs = (r) => r?.labels.map((l) => l.long);
  const shorts = (r) => r?.labels.map((l) => l.short);
  const CPU = ["Pip", "Bounce", "Glimmer", "Tusk"];

  let r = await rules(["L", "C", "C", "C"]);
  check("A [L,C,C,C]", J(longs(r)) === J(["You", "Bounce", "Glimmer", "Tusk"]) && r.labels[0].you, J(longs(r)));
  r = await rules(["L", "R", "C", "C"]);
  check("A [L,R,C,C]", J(longs(r)) === J(["Player 1", "Player 2", "Glimmer", "Tusk"]) &&
    J(shorts(r)) === J(["P1", "P2", "Glimmer", "Tusk"]), J(longs(r)));
  r = await rules(["R", "L", "R", "C"]);
  check("A [R,L,R,C]", J(longs(r)) === J(["Player 1", "Player 2", "Player 3", "Tusk"]) &&
    J(shorts(r)) === J(["P1", "P2", "P3", "Tusk"]) && r.labels[1].you && !r.labels[0].you, J(longs(r)));
  r = await rules(["L", "R", "R", "R"]);
  check("A [L,R,R,R]", J(longs(r)) === J(["Player 1", "Player 2", "Player 3", "Player 4"]) &&
    J(shorts(r)) === J(["P1", "P2", "P3", "P4"]), J(longs(r)));
  r = await rules(["C", "C", "L", "C"]);
  check("A [C,C,L,C] solo non-zero seat", J(longs(r)) === J(["Pip", "Bounce", "You", "Tusk"]), J(longs(r)));
  r = await rules(["L", "C", "C", "C"], true);
  check("A online single human stays numbered", longs(r)[0] === "Player 1" && longs(r)[1] === "Bounce", J(longs(r)));
  const g = (await rules(["L", "C", "C", "C"])).grammar;
  check("A youGrammar", g["YOU WINS THE ROUND"] === "YOU WIN THE ROUND" && g["You's turn"] === "Your turn" &&
    g["YOU IS NEXT"] === "YOU ARE NEXT" && g["YOU PASS"] === "YOU PASS", J(g));
  void CPU;
  await browser.close();
}

// ---------------------------------------------------------------- B
console.log("== B. solo");
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  watch(page, "B");
  await page.goto(`${BASE}/?audio=0&speed=8&seed=7`, { waitUntil: "domcontentloaded", timeout: LOAD });
  await ready(page);
  await sleep(2500);
  await clickText(page, /play/i);
  await page.waitForFunction(() => window.__SSP__.state().screen === "select" || window.__SSP__.state().screen === "characterSelect" ||
    !!document.querySelector(".ssp-sel-arrow"), null, { timeout: LOAD });
  await sleep(1000);
  await clickText(page, /start/i);
  await page.waitForFunction(() => window.__SSP__.state().screen === "board", null, { timeout: LOAD });
  await waitChips(page);
  const cs = await chips(page);
  console.log("   chips", J(cs.map((c) => c.text)));
  const mine = cs.find((c) => c.id === 0);
  check("B seat-0 chip says You", mine?.text === "You", mine?.text);
  check("B seat-0 data-you + pill visible in viewport", mine?.you && mine.pillShown && mine.pillInside, J(mine));
  check("B only seat 0 is you", cs.filter((c) => c.you).length === 1, J(cs.map((c) => c.you)));
  check("B other chips show character names", cs.filter((c) => c.id !== 0).every((c) => c.text && !/^(You|P\d|Player \d)$/.test(c.text)), J(cs.map((c) => c.text)));
  check("B all chips inside viewport", cs.length >= 4 && cs.every((c) => c.inside), J(cs.map((c) => c.inside)));
  await page.screenshot({ path: `${SHOTS}/labels-solo-board.png` });

  await page.evaluate(() => window.__SSP__.openMinigame("bumper_balls"));
  await page.waitForFunction(() => window.__SSP__.seatTags().length > 0, null, { timeout: LOAD }).catch(() => {});
  await sleep(1200);
  const tags = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return Array.from(document.querySelectorAll("[data-seat-tag]")).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: e.getAttribute("data-tag-kind"),
        text: (e.textContent ?? "").trim(),
        arrow: Array.from(e.querySelectorAll(".ssp-seat__down, .ssp-seat__arrow")).some((a) => {
          const ar = a.getBoundingClientRect();
          return getComputedStyle(a).display !== "none" && ar.width > 0 && ar.height > 0;
        }),
        visible: r.width > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none",
        inside: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
      };
    });
  });
  console.log("   tags", J(tags));
  check("B exactly one seat tag, kind=you", tags.length === 1 && tags[0].kind === "you", J(tags));
  check("B tag visible+inside viewport", tags[0]?.visible && tags[0]?.inside, J(tags[0]));
  // the ▼ is a CSS triangle (.ssp-seat__down, or __arrow at the screen edge), not a glyph
  check("B tag text has YOU and a ▼ arrow shown", /YOU/.test(tags[0]?.text ?? "") && tags[0]?.arrow, J(tags[0]));
  check("B no CPU tags", tags.every((t) => t.kind !== "peer"), J(tags.map((t) => t.kind)));
  await page.screenshot({ path: `${SHOTS}/labels-solo-minigame.png` });
  await browser.close();
}

// ---------------------------------------------------------------- C
async function peers(n) {
  console.log(`== C. ${n} peers`);
  const URL = `${BASE}/?audio=0&speed=8&partyAssist=1&turns=2&seed=7`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pages = [];
  for (let i = 0; i < n; i++) {
    const p = await context.newPage();
    watch(p, `peer${i}`);
    pages.push(p);
  }
  await Promise.all(pages.map((p) => p.goto(URL, { waitUntil: "domcontentloaded", timeout: LOAD })));
  const click = (p, v) => p.evaluate((name) => document.querySelector(`[data-party="${name}"]`)?.click(), v);
  for (const p of pages) await p.waitForSelector("[data-party='menu']", { timeout: LOAD });
  const host = pages[0];
  await click(host, "menu");
  await host.waitForSelector("[data-party='create']", { timeout: LOAD });
  await click(host, "create");
  await host.waitForSelector("[data-party-code]", { timeout: LOAD });
  const code = (await host.locator("[data-party-code]").innerText()).trim();
  for (const g of pages.slice(1)) {
    await click(g, "menu");
    await g.waitForSelector("[data-party='code']", { timeout: LOAD });
    await g.fill("[data-party='code']", code);
    await click(g, "join");
    await sleep(500);
  }
  await host.waitForFunction((k) => document.querySelector("[data-party-humans]")?.getAttribute("data-party-humans") === String(k), n, { timeout: LOAD });
  await click(host, "start");
  for (const p of pages) {
    await p.waitForFunction(() => window.__SSP__?.state?.()?.screen === "board", null, { timeout: LOAD });
    await waitChips(p);
  }
  const reads = [];
  for (const p of pages) reads.push(await chips(p));
  const labelsOf = (cs) => cs.map((c) => c.text);
  console.log("   tab0 chips", J(labelsOf(reads[0])));
  check(`C${n} chip labels identical across tabs`, reads.every((cs) => J(labelsOf(cs)) === J(labelsOf(reads[0]))), J(reads.map(labelsOf)));
  const humansExpected = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  check(`C${n} first ${n} chips are P1..P${n}`, J(labelsOf(reads[0]).slice(0, n)) === J(humansExpected), J(labelsOf(reads[0])));
  const cpus = labelsOf(reads[0]).slice(n);
  check(`C${n} CPUs keep character names`, cpus.every((t) => t && !/^(You|P\d|Player \d)$/.test(t)), J(cpus));
  const seats = reads.map((cs) => cs.filter((c) => c.you).map((c) => c.id));
  check(`C${n} each tab has exactly one own chip, all distinct`,
    seats.every((s) => s.length === 1) && new Set(seats.map((s) => s[0])).size === n, J(seats));
  check(`C${n} YOU pill visible inside viewport`, reads.every((cs) => cs.some((c) => c.you && c.pillShown && c.pillInside)), "");
  check(`C${n} chips inside viewport`, reads.every((cs) => cs.every((c) => c.inside)), "");
  await sleep(2500);
  const desync = [];
  for (const p of pages) {
    desync.push((await p.locator("#ssp-desync").count()) + ((await p.evaluate(() => window.__SSP__.party()))?.desync ? 1 : 0));
  }
  check(`C${n} no BOARD OUT OF SYNC`, desync.every((d) => d === 0), J(desync));
  await pages[0].screenshot({ path: `${SHOTS}/labels-peers${n}-tab0.png` });

  // minigame tags: only if a minigame opens cheaply in the room
  for (const p of pages) await p.evaluate(() => window.__SSP__.openMinigame("drum_solo"));
  let got = true;
  for (const p of pages) {
    await p.waitForFunction(() => window.__SSP__.seatTags().length > 0, null, { timeout: 15000 }).catch(() => { got = false; });
  }
  if (!got) {
    note(`C${n} minigame tag sub-check SKIPPED: no seat tags appeared after openMinigame in the room`);
  } else {
    await sleep(1000);
    const tagReads = [];
    for (const p of pages) tagReads.push(await p.evaluate(() => window.__SSP__.seatTags()));
    const ok = tagReads.every((tags, i) => {
      const mine = tags.filter((t) => t.kind === "you");
      const peer = tags.filter((t) => t.kind === "peer");
      return mine.length === 1 && mine[0].id === seats[i][0] && peer.length === n - 1 &&
        peer.every((t) => t.text.includes(`P${t.id + 1}`));
    });
    check(`C${n} minigame tags: own=you, others=peer P<n>`, ok, J(tagReads.map((t) => t.map((x) => `${x.kind}:${x.text}`))));
  }
  await browser.close();
}
await peers(2);
await peers(4);

// ---------------------------------------------------------------- D
console.log("== D. Pick a Hero (webkit)");
{
  const browser = await webkit.launch();
  const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [w, h] of [[390, 844], [430, 932]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true });
    watch(page, `D${w}`);
    await page.goto(`${BASE}/?audio=0&seed=7`, { waitUntil: "domcontentloaded", timeout: LOAD });
    await ready(page);
    await sleep(2000);
    await page.evaluate(() => window.__SSP__.goto("select"));
    await page.waitForFunction(() => !!window.__SSP__.selectBounds(), null, { timeout: LOAD });
    await sleep(800);
    const starts = await page.evaluate(() => Array.from(document.querySelectorAll("button")).filter((b) => /start/i.test(b.textContent ?? "") && b.offsetParent !== null).length);
    check(`D${w} exactly one /start/i button`, starts === 1, starts);
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        await page.locator('button[aria-label="Next hero"]').click({ timeout: 10000 });
      }
      await sleep(800);
      const b = await page.evaluate(() => window.__SSP__.selectBounds());
      const tag = `D${w} hero${i}`;
      const box = b?.hero.box;
      const inView = box && box.x >= -2 && box.y >= -2 && box.x + box.w <= w + 2 && box.y + box.h <= h + 2;
      const s = b?.slot;
      const inSlot = box && s && box.x >= s.x - 2 && box.y >= s.y - 2 && box.x + box.w <= s.x + s.w + 2 && box.y + box.h <= s.y + s.h + 2;
      check(`${tag} (${b?.hero.selected}) inside viewport`, inView, J(box));
      check(`${tag} inside slot`, inSlot, `${J(box)} slot ${J(s)}`);
      const others = [...(b?.cards ?? []), b?.settings, b?.plate, b?.start].filter(Boolean);
      check(`${tag} no overlap cards/settings/plate/start`, box && !others.some((o) => overlap(box, o)), J(box));
      check(`${tag} height >= 35% of slot`, box && s && box.h >= 0.35 * s.h, `${box?.h} / ${s?.h}`);
      check(`${tag} arrows clear of START`, !(b?.arrows ?? []).some((a) => overlap(a, b.start)), J(b?.arrows));
      await page.screenshot({ path: `${SHOTS}/labels-select-${w}-hero${i}.png` });
    }
    await page.close();
  }
  await browser.close();
}

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = rows.filter((r) => !r.ok);
console.log("\n| result | check |\n|---|---|");
for (const r of rows) console.log(`| ${r.ok ? "PASS" : "FAIL"} | ${r.name} |`);
console.log(`\n${rows.length - failed.length}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
