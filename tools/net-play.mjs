/**
 * Two localhost tabs, one board.
 *
 * Shares a browser context so BroadcastChannel can carry the room.
 * Party assist publishes each human choice; the other tab applies it.
 * A matching checkpoint hash means the board did not diverge.
 *
 *   npm run dev
 *   node tools/net-play.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? "http://localhost:5177";
const URL = `${BASE}/?audio=0&speed=8&partyAssist=1&turns=2&seed=7`;

async function waitForServer(url, ms = 60000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err?.cause?.code ?? err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server at ${url} was not ready (${last})`);
}

async function clickParty(page, value, label) {
  const clicked = await page.evaluate((name) => {
    const hit = document.querySelector(`[data-party="${name}"]`);
    if (!hit) return null;
    hit.click();
    return hit.textContent?.trim() ?? name;
  }, value);
  if (!clicked) throw new Error(`no [data-party="${value}"] for ${label}`);
  console.log(`  clicked ${clicked} (${label})`);
}

function watch(page, errors, label) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${label}: ${msg.text().slice(0, 240)}`);
  });
  page.on("pageerror", (err) => errors.push(`${label} PAGE: ${String(err).slice(0, 240)}`));
}

async function party(page) {
  return page.evaluate(() => window.__SSP__?.party?.() ?? null);
}

async function board(page) {
  return page.evaluate(() => {
    const match = window.__SSP__?.state?.()?.match ?? {};
    const players = match.players ?? [];
    return {
      screen: window.__SSP__?.state?.()?.screen ?? null,
      turn: match.turn ?? null,
      total: match.totalTurns ?? null,
      phase: match.phase ?? null,
      coins: players.map((p) => p.coins),
      stars: players.map((p) => p.stars),
      spaces: players.map((p) => p.space),
      controllers: players.map((p) => p.controller),
    };
  });
}

const errors = [];
await waitForServer(`${BASE}/`);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const host = await context.newPage();
const guest = await context.newPage();
watch(host, errors, "host");
watch(guest, errors, "guest");

console.log("1. boot both tabs");
await Promise.all([
  host.goto(URL, { waitUntil: "domcontentloaded" }),
  guest.goto(URL, { waitUntil: "domcontentloaded" }),
]);
await host.waitForSelector("[data-party='menu']", { timeout: 30000 });
await guest.waitForSelector("[data-party='menu']", { timeout: 30000 });

console.log("2. host creates a room");
await clickParty(host, "menu", "WITH FRIENDS");
await host.waitForSelector("[data-party='create']", { timeout: 15000 });
await clickParty(host, "create", "CREATE");
await host.waitForSelector("[data-party-code]", { timeout: 10000 });
const code = await host.locator("[data-party-code]").innerText();
console.log("   code", code);
if (!/^[A-Z]{4}$/.test(code.trim())) throw new Error(`bad room code: ${code}`);

console.log("3. guest joins");
await clickParty(guest, "menu", "WITH FRIENDS");
await guest.waitForSelector("[data-party='code']", { timeout: 15000 });
await guest.fill("[data-party='code']", code.trim());
await clickParty(guest, "join", "JOIN");
await host.waitForFunction(() => {
  const n = document.querySelector("[data-party-humans]")?.getAttribute("data-party-humans");
  return n === "2";
}, null, { timeout: 15000 });
console.log("   humans", await host.locator("[data-party-humans]").innerText());

console.log("4. host starts");
await clickParty(host, "start", "START");
await host.waitForFunction(() => window.__SSP__?.state?.()?.screen === "board", null, { timeout: 20000 });
await guest.waitForFunction(() => window.__SSP__?.state?.()?.screen === "board", null, { timeout: 20000 });
console.log("   both on the board");

console.log("5. play until a few checkpoints agree");
const deadline = Date.now() + 90000;
let hostParty = null;
let guestParty = null;
let hostBoard = null;
let guestBoard = null;
while (Date.now() < deadline) {
  hostParty = await party(host);
  guestParty = await party(guest);
  hostBoard = await board(host);
  guestBoard = await board(guest);
  if (hostParty?.desync || guestParty?.desync) break;
  const h = hostParty?.checkpoints ?? 0;
  const g = guestParty?.checkpoints ?? 0;
  const choices = (hostParty?.sent ?? 0) + (hostParty?.recv ?? 0) + (guestParty?.sent ?? 0) + (guestParty?.recv ?? 0);
  const same =
    JSON.stringify(hostBoard?.coins) === JSON.stringify(guestBoard?.coins) &&
    JSON.stringify(hostBoard?.stars) === JSON.stringify(guestBoard?.stars) &&
    JSON.stringify(hostBoard?.spaces) === JSON.stringify(guestBoard?.spaces);
  if (h >= 4 && h === g && choices > 0 && same) break;
  await new Promise((r) => setTimeout(r, 400));
}

console.log("host party", JSON.stringify(hostParty));
console.log("guest party", JSON.stringify(guestParty));
console.log("host board", JSON.stringify(hostBoard));
console.log("guest board", JSON.stringify(guestBoard));
const desyncEl = await host.locator("#ssp-desync").count();
const guestDesync = await guest.locator("#ssp-desync").count();
console.log("desync banners", desyncEl, guestDesync);
console.log("console errors", errors.length ? errors.slice(0, 6) : "none");

const sameEconomy =
  JSON.stringify(hostBoard?.coins) === JSON.stringify(guestBoard?.coins) &&
  JSON.stringify(hostBoard?.stars) === JSON.stringify(guestBoard?.stars) &&
  JSON.stringify(hostBoard?.spaces) === JSON.stringify(guestBoard?.spaces);
const choices =
  (hostParty?.sent ?? 0) + (hostParty?.recv ?? 0) + (guestParty?.sent ?? 0) + (guestParty?.recv ?? 0);
let dropController = null;
let passed =
  errors.length === 0 &&
  !hostParty?.desync &&
  !guestParty?.desync &&
  desyncEl === 0 &&
  guestDesync === 0 &&
  (hostParty?.checkpoints ?? 0) >= 4 &&
  hostParty?.checkpoints === guestParty?.checkpoints &&
  hostBoard?.total === guestBoard?.total &&
  hostBoard?.total === 2 &&
  choices > 0 &&
  sameEconomy;

if (passed) {
  await guest.evaluate(() => window.__SSP__?.partyDrop?.());
  await host.waitForFunction(() => {
    const players = window.__SSP__?.state?.()?.match?.players ?? [];
    return players[1]?.controller === "cpu";
  }, null, { timeout: 8000 });
  dropController = await host.evaluate(() => window.__SSP__?.state?.()?.match?.players?.[1]?.controller ?? null);
  console.log("guest dropped, host sees seat 1 as", dropController);
  if (dropController !== "cpu") passed = false;
}

console.log(passed
  ? "\nVERDICT: two tabs joined, synced board choices, and agreed on checkpoint hashes."
  : "\nVERDICT: the two-tab room did not stay in sync.");
await browser.close();
process.exitCode = passed ? 0 : 1;
