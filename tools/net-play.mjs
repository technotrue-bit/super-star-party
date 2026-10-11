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
// SSP_SEED / SSP_TURNS pick the match (default seed 7, 2 turns).
// SSP_EXPECT_STAR_MOVE=1 also requires a Grand Prize relocation (PR F); pair it with a
// seed/turn count where someone buys early, e.g. SSP_SEED=7 SSP_TURNS=5.
const SEED = process.env.SSP_SEED ?? "7";
const TURNS = process.env.SSP_TURNS ?? "2";
const EXPECT_STAR_MOVE = process.env.SSP_EXPECT_STAR_MOVE === "1";
const URL = `${BASE}/?audio=0&speed=8&partyAssist=1&turns=${TURNS}&seed=${SEED}`;
// SSP_BOARD=downtown|carnival goes on the HOST's URL only: the host picks the
// board and the guest must follow it through MatchSetup.board.
const BOARD_ARG = (process.env.SSP_BOARD ?? "").trim();
const HOST_URL = BOARD_ARG ? `${URL}&board=${BOARD_ARG}` : URL;
const EXPECT_BOARD = BOARD_ARG === "downtown" ? "downtown" : BOARD_ARG === "carnival" ? "fizzy-fairground" : BOARD_ARG ? null : "fizzy-fairground";
// SSP_OLD_CLIENT=0 skips the old-client refusal check (on by default).
const OLD_CLIENT = process.env.SSP_OLD_CLIENT !== "0";

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
      board: match.boardId ?? null,
      balloon: match.starBalloonPos ?? null,
      trail: window.__NP_TRAIL ? [...window.__NP_TRAIL] : null,
      prizeSpots: window.__SSP__?.board?.()?.prizeSpots ?? null,
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
  host.goto(HOST_URL, { waitUntil: "domcontentloaded" }),
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

let oldClientOk = true;
if (OLD_CLIENT) {
  console.log("3b. an old client (no join.boards) is refused");
  const old = await context.newPage();
  watch(old, [], "old");
  await old.goto(`${URL}&legacyJoin=1`, { waitUntil: "domcontentloaded" });
  await old.waitForSelector("[data-party='menu']", { timeout: 30000 });
  await clickParty(old, "menu", "WITH FRIENDS");
  await old.waitForSelector("[data-party='code']", { timeout: 15000 });
  await old.fill("[data-party='code']", code.trim());
  await clickParty(old, "join", "JOIN");
  let refused = null;
  try {
    await old.waitForFunction(() => !!window.__SSP__?.party?.()?.refused, null, { timeout: 15000 });
    refused = await old.evaluate(() => window.__SSP__.party().refused);
  } catch {}
  const shown = await old.evaluate(() => document.body.innerText.includes("Update the game"));
  await host.waitForTimeout(800);
  const humans = await host.locator("[data-party-humans]").getAttribute("data-party-humans");
  console.log(`   old client refused=${JSON.stringify(refused)} shown=${shown} host humans=${humans}`);
  oldClientOk = /update the game/i.test(refused ?? "") && shown && humans === "2";
  await old.close();
}

console.log("4. host starts");
await clickParty(host, "start", "START");
await host.waitForFunction(() => window.__SSP__?.state?.()?.screen === "board", null, { timeout: 20000 });
await guest.waitForFunction(() => window.__SSP__?.state?.()?.screen === "board", null, { timeout: 20000 });
console.log("   both on the board");
// PR F: record each tab's Grand Prize trail (distinct consecutive positions).
for (const pg of [host, guest]) {
  await pg.evaluate(() => {
    const trail = [];
    window.__NP_TRAIL = trail;
    const tick = () => {
      const m = window.__SSP__?.state?.()?.match;
      const b = m?.starBalloonPos;
      if (m?.players?.length && b != null && b >= 0 && trail[trail.length - 1] !== b) trail.push(b);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

console.log("5. play until a few checkpoints agree");
const deadline = Date.now() + (EXPECT_STAR_MOVE ? 300000 : 90000);
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
  const movedOk = !EXPECT_STAR_MOVE || ((hostBoard?.trail?.length ?? 0) >= 2 && JSON.stringify(hostBoard?.trail) === JSON.stringify(guestBoard?.trail));
  if (h >= 4 && h === g && choices > 0 && same && movedOk) break;
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
// PR F: both tabs saw the same balloon trail, starting on a prize spot.
const ht = hostBoard?.trail ?? [];
const gt = guestBoard?.trail ?? [];
const trailOk = ht.length >= 1 && JSON.stringify(ht) === JSON.stringify(gt) && (hostBoard?.prizeSpots ?? []).includes(ht[0]) && hostBoard?.balloon === guestBoard?.balloon;
const moveOk = !EXPECT_STAR_MOVE || ht.length >= 2;
console.log(`balloon trail host=${JSON.stringify(ht)} guest=${JSON.stringify(gt)} trailOk=${trailOk}${EXPECT_STAR_MOVE ? ` moved=${moveOk}` : ""}`);
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
  sameEconomy &&
  oldClientOk &&
  trailOk &&
  moveOk &&
  hostBoard?.board === guestBoard?.board &&
  (EXPECT_BOARD === null || hostBoard?.board === EXPECT_BOARD);
console.log(`board host=${hostBoard?.board} guest=${guestBoard?.board} expected=${EXPECT_BOARD ?? "any"} oldClientOk=${oldClientOk}`);

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
