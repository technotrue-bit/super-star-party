/**
 * probe-payout.mjs — team and free-for-all minigame coin payouts.
 *
 *   node tools/probe-payout.mjs
 *
 * Expects the game at http://localhost:5177/.
 *
 * Seeded Push of War:
 *   seed 4 — trio win (solo is player 1). Players 0, 2, and 3 each get the pot.
 *   seed 2 — solo win (player 0). Only player 0 gets the pot.
 * Forced settlements (same function the results screen uses):
 *   3v1, 1v3, 2v2, and 4-player free-for-all, including the pack/host scale.
 * Losers must stay at their starting coins and win count.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_BASE ?? "http://localhost:5177";
const NAMES = ["Pip", "Bounce", "Glimmer", "Tusk"];
const KINDS = ["pip", "bounce", "glimmer", "tusk"];

const fail = (msg) => {
  console.log("FAIL:", msg);
  process.exitCode = 1;
};

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 180));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 180)));

async function boot() {
  await page.goto(`${BASE}/?audio=0&speed=2`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__SSP__.setMinigameCoinMultiplier(1);
    window.__SSP__.setMinigamePacks(["midway", "sideshow", "bigtop"]);
    window.__SSP__.setHumanPack("midway");
  });
}

function assertSettlement(label, players, paid, winners, award) {
  const winnerSet = new Set(winners);
  console.log(`   ${label}`, JSON.stringify({ paid, coins: players.map((p) => p.coins), wins: players.map((p) => p.wins) }));
  if (paid.length !== winners.length) {
    fail(`${label}: paid ${paid.map((p) => p.playerId).join(",")} wanted ${winners.join(",")}`);
  }
  for (const id of winners) {
    const row = paid.find((p) => p.playerId === id);
    const player = players.find((p) => p.id === id);
    if (!row) fail(`${label}: winner ${id} was not paid`);
    else if (row.coins !== award) fail(`${label}: winner ${id} got ${row.coins}, wanted ${award}`);
    if (!player) fail(`${label}: missing player ${id}`);
    else {
      if (player.coins !== 10 + award) fail(`${label}: player ${id} coins ${player.coins}, wanted ${10 + award}`);
      if (player.wins !== 1) fail(`${label}: player ${id} wins ${player.wins}, wanted 1`);
    }
  }
  for (const player of players) {
    if (winnerSet.has(player.id)) continue;
    if (player.coins !== 10) fail(`${label}: loser ${player.id} coins ${player.coins}, wanted 10`);
    if (player.wins !== 0) fail(`${label}: loser ${player.id} wins ${player.wins}, wanted 0`);
    if (paid.some((p) => p.playerId === player.id)) fail(`${label}: loser ${player.id} was paid`);
  }
}

console.log("1. forced settlements (3v1, 1v3, 2v2, free-for-all)");
await boot();
const forced = await page.evaluate(({ kinds, names }) => {
  const ssp = window.__SSP__;
  if (typeof ssp.settleMinigamePayout !== "function") {
    return { error: "settleMinigamePayout missing" };
  }
  const start = (mult) => {
    ssp.setMinigameCoinMultiplier(mult);
    ssp.setMinigamePacks(["bigtop"]);
    ssp.setHumanPack("bigtop");
    ssp.seed(11);
    ssp.startMatch(kinds, names);
  };
  const snap = () => ssp.state().match.players.map((p) => ({ id: p.id, coins: p.coins, wins: p.minigameWins }));
  start(1);
  const award = ssp.minigameRewardPreview("bigtop");
  const trio = ssp.settleMinigamePayout([0, 2, 3, 1], [0, 2, 3], "bigtop");
  const trioPlayers = snap();
  start(1);
  const solo = ssp.settleMinigamePayout([1, 0, 2, 3], [1], "bigtop");
  const soloPlayers = snap();
  start(1);
  const pair = ssp.settleMinigamePayout([0, 2, 1, 3], [0, 2], "bigtop");
  const pairPlayers = snap();
  start(1);
  const ffa = ssp.settleMinigamePayout([2, 0, 1, 3], undefined, "bigtop");
  const ffaPlayers = snap();
  start(1);
  const dup = ssp.settleMinigamePayout([0, 1, 2, 3], [0, 0, 2], "bigtop");
  start(4);
  const scaled = ssp.minigameRewardPreview("bigtop");
  const scaledPair = ssp.settleMinigamePayout([1, 3, 0, 2], [1, 3], "bigtop");
  const scaledPlayers = snap();
  return { award, trio, trioPlayers, solo, soloPlayers, pair, pairPlayers, ffa, ffaPlayers, dup, scaled, scaledPair, scaledPlayers };
}, { kinds: KINDS, names: NAMES });

if (forced.error) fail(forced.error);
else {
  console.log("   base award", forced.award, "scaled award", forced.scaled);
  if (forced.award !== 40) fail("x1 four-owner award expected 40, got " + forced.award);
  if (forced.scaled !== 160) fail("x4 four-owner award expected 160, got " + forced.scaled);
  assertSettlement("3v1", forced.trioPlayers, forced.trio, [0, 2, 3], 40);
  assertSettlement("1v3", forced.soloPlayers, forced.solo, [1], 40);
  assertSettlement("2v2", forced.pairPlayers, forced.pair, [0, 2], 40);
  assertSettlement("ffa", forced.ffaPlayers, forced.ffa, [2], 40);
  if (forced.dup.length !== 2 || forced.dup.some((p) => p.playerId !== 0 && p.playerId !== 2)) {
    fail("duplicate coin winners paid " + JSON.stringify(forced.dup));
  }
  assertSettlement("2v2 x4", forced.scaledPlayers, forced.scaledPair, [1, 3], 160);
}

async function playPushOfWar(seed) {
  await page.goto(`${BASE}/?seed=${seed}&audio=0&speed=2&minigame=push_of_war`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__SSP__?.state, null, { timeout: 20000 });
  const before = await page.evaluate(({ seed, kinds, names }) => {
    const ssp = window.__SSP__;
    ssp.setMinigameCoinMultiplier(1);
    ssp.seed(Number(seed));
    ssp.autoplay(true);
    ssp.startMatch(kinds, names);
    const players = ssp.state().match.players.map((p) => ({ id: p.id, coins: p.coins, wins: p.minigameWins }));
    return { players, award: ssp.minigameRewardPreview() };
  }, { seed, kinds: KINDS, names: NAMES });

  let launched = false;
  for (let i = 0; i < 25 && !launched; i++) {
    await page.evaluate(() => window.__SSP__.goto("minigame"));
    await page.waitForTimeout(200);
    launched = await page.evaluate(() => window.__SSP__.state().screen === "minigame");
  }
  if (!launched) {
    fail(`seed ${seed}: minigame never opened`);
    return null;
  }
  // The pre-screen sits on top of the minigame screen. Click through it.
  const started = await page.waitForFunction(() => {
    const btn = document.querySelector("#mg-start-btn");
    if (btn) btn.click();
    return !document.querySelector("#mg-start-btn") && !!window.__POW__;
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!started) {
    fail(`seed ${seed}: push of war never started`);
    return null;
  }

  const outcome = await page.waitForFunction(() => {
    const pow = window.__POW__;
    if (!pow?.endPath || !pow.ranking) return null;
    const players = window.__SSP__.state().match.players;
    if (players.every((p) => p.coins === 10 && p.minigameWins === 0)) return null;
    const card = document.querySelector("[data-ssp-results]");
    return {
      solo: pow.solo,
      endPath: pow.endPath,
      ranking: pow.ranking,
      players: players.map((p) => ({ id: p.id, coins: p.coins, wins: p.minigameWins })),
      paid: card
        ? [...card.querySelectorAll("[data-ssp-paid]")].map((el) => ({
            id: Number(el.dataset.sspPlayer),
            coins: Number(el.dataset.sspPaid),
          }))
        : [],
    };
  }, null, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => null);

  return { before, outcome };
}

function assertLive(seed, expected) {
  return async () => {
    console.log(`2. push of war seed ${seed} (${expected.endPath})`);
    const run = await playPushOfWar(seed);
    if (!run?.outcome) {
      fail(`seed ${seed}: no payout observed`);
      return;
    }
    const { before, outcome } = run;
    console.log("   pow", JSON.stringify({ solo: outcome.solo, endPath: outcome.endPath, ranking: outcome.ranking }));
    console.log("   coins", JSON.stringify(outcome.players));
    console.log("   card", JSON.stringify(outcome.paid));
    if (before.award !== 10) fail(`seed ${seed}: base award ${before.award}, wanted 10`);
    if (outcome.endPath !== expected.endPath) fail(`seed ${seed}: endPath ${outcome.endPath}, wanted ${expected.endPath}`);
    if (outcome.solo !== expected.solo) fail(`seed ${seed}: solo ${outcome.solo}, wanted ${expected.solo}`);
    if (JSON.stringify(outcome.ranking) !== JSON.stringify(expected.ranking)) {
      fail(`seed ${seed}: ranking ${outcome.ranking}, wanted ${expected.ranking}`);
    }
    const award = before.award;
    for (const player of outcome.players) {
      const start = before.players.find((p) => p.id === player.id);
      const delta = player.coins - start.coins;
      const won = expected.winners.includes(player.id);
      if (won) {
        if (delta !== award) fail(`seed ${seed}: winner ${player.id} delta ${delta}, wanted ${award}`);
        if (player.wins !== start.wins + 1) fail(`seed ${seed}: winner ${player.id} wins ${player.wins}`);
      } else {
        if (delta !== 0) fail(`seed ${seed}: loser ${player.id} delta ${delta}, wanted 0`);
        if (player.wins !== start.wins) fail(`seed ${seed}: loser ${player.id} wins changed to ${player.wins}`);
      }
    }
    if (outcome.paid.length !== expected.winners.length) {
      fail(`seed ${seed}: results card paid ${outcome.paid.length} rows, wanted ${expected.winners.length}`);
    }
    for (const id of expected.winners) {
      const row = outcome.paid.find((p) => p.id === id);
      if (!row) fail(`seed ${seed}: results card missed player ${id}`);
      else if (row.coins !== award) fail(`seed ${seed}: card shows +${row.coins} for ${id}, wanted ${award}`);
    }
    for (const row of outcome.paid) {
      if (!expected.winners.includes(row.id)) fail(`seed ${seed}: card paid loser ${row.id}`);
    }
  };
}

await assertLive(4, { endPath: "trio-win", solo: 1, ranking: [0, 2, 3, 1], winners: [0, 2, 3] })();
await assertLive(2, { endPath: "solo-win", solo: 0, ranking: [0, 1, 2, 3], winners: [0] })();

if (errors.length) {
  console.log("console:", [...new Set(errors)].slice(0, 6));
  fail("page errors: " + errors.length);
}

console.log(process.exitCode ? "PROBE FAILED" : "PROBE OK");
await browser.close();
process.exit(process.exitCode ?? 0);
