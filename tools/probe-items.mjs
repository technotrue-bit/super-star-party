/**
 * probe-items.mjs — each new bag item is acquired and used once, on seed 7.
 *
 *   node tools/probe-items.mjs
 *
 * Expects the game at SSP_URL (or SSP_BASE), default http://localhost:5177/. Exits non-zero on failure.
 * Two back-to-back seeded passes must report the same results.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SSP_URL ?? process.env.SSP_BASE ?? "http://localhost:5177";

const EXPECTED = [
  { key: "dash_mushroom", name: "Zip Mushroom", price: 5, kind: "dash", value: 3 },
  { key: "golden_dash", name: "Golden Zip Mushroom", price: 10, kind: "dash", value: 5 },
  { key: "poison_mushroom", name: "Sour Mushroom", price: 5, kind: "poison" },
  { key: "double_dice", name: "Double Dice", price: 8, kind: "dice" },
  { key: "warp_pipe", name: "Funhouse Hatch", price: 10, kind: "swappos" },
  { key: "dueling_glove", name: "Dueling Glove", price: 12, kind: "duel" },
  { key: "lucky_card", name: "Lucky Card", price: 8, kind: "lucky" },
  { key: "mecha_fly", name: "Cogfly", price: 12, kind: "steal" },
  { key: "swap_card", name: "Swap Card", price: 8, kind: "trade" },
  { key: "boo_bell", name: "Wisp Bell", price: 20, kind: "star" },
  { key: "genie_lamp", name: "Genie Lamp", price: 15, kind: "genie" },
  { key: "chomp_call", name: "Balloon Tug", price: 15, kind: "chomp" },
  { key: "bowser_suit", name: "Grumpus Coat", price: 25, kind: "bowser" },
];

const errors = [];
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));

const fail = (msg) => {
  console.log("FAIL:", msg);
  process.exitCode = 1;
};

await page.goto(`${BASE}/?audio=0&seed=7`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__SSP__?.state?.().screen === "title", null, { timeout: 20000 });

console.log("1. shop stock");
await page.evaluate(() => {
  const ssp = window.__SSP__;
  ssp.seed(7);
  ssp.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
await page.waitForFunction(() => {
  const s = window.__SSP__.state();
  return s.screen === "board" && !s.isWiping;
});
const shop = await page.evaluate((expected) => {
  const ssp = window.__SSP__;
  ssp.fundPlayer(0, 80);
  const { stock } = ssp.shopStock();
  const catalog = ssp.itemState().catalog;
  const spaces = Object.keys(stock);
  const space = Number(spaces[0]);
  ssp.openShop(0, space);
  const cards = [...document.querySelectorAll("[data-item]")].map((card) => {
    const key = card.getAttribute("data-item");
    const btn = card.querySelector("button");
    const spec = expected.find((e) => e.key === key);
    const cat = catalog.find((c) => c.key === key);
    return {
      key,
      name: card.querySelector(".ssp-shop__name")?.textContent ?? "",
      price: card.getAttribute("data-price") ?? "",
      wantName: spec?.name ?? cat?.name ?? null,
      wantPrice: String(spec?.price ?? cat?.price),
      buyH: btn ? btn.offsetHeight : 0,
    };
  });
  document.querySelector("[data-shop-close]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const catalogRows = expected.map((e) => {
    const c = catalog.find((x) => x.key === e.key);
    return { key: e.key, name: c?.name ?? null, price: c?.price ?? null };
  });
  return { space, want: stock[spaces[0]], cards, catalogRows };
}, EXPECTED);
console.log("   shop", JSON.stringify(shop));
for (const row of shop.catalogRows) {
  const spec = EXPECTED.find((e) => e.key === row.key);
  if (row.name === null) fail(`catalog missing ${row.key}`);
  if (row.name !== spec.name) fail(`${row.key} catalog name ${row.name}`);
  if (row.price !== spec.price) fail(`${row.key} catalog price ${row.price}`);
}
if (shop.want.length !== 3) fail(`shopStock has ${shop.want.length} keys for space ${shop.space}`);
if (shop.cards.length !== 3) fail(`shop shows ${shop.cards.length} cards, want 3`);
if (JSON.stringify(shop.cards.map((c) => c.key).sort()) !== JSON.stringify([...shop.want].sort())) {
  fail(`shop cards ${shop.cards.map((c) => c.key)} != stock ${shop.want}`);
}
for (const row of shop.cards) {
  if (row.name !== row.wantName) fail(`${row.key} shop name ${row.name}`);
  if (row.price !== row.wantPrice) fail(`${row.key} shop price ${row.price}`);
  if (row.buyH < 44) fail(`${row.key} buy button is ${row.buyH}px`);
}
await page.waitForSelector("[data-shop='true']", { state: "detached" });

console.log("2. acquire and use, twice");
const play = () => page.evaluate((expected) => {
  const ssp = window.__SSP__;
  const roster = ["pip", "bounce", "glimmer", "tusk"];
  const names = ["Pip", "Bounce", "Glimmer", "Tusk"];
  const boot = () => {
    ssp.seed(7);
    ssp.startMatch(roster, names);
    ssp.fundPlayer(0, 80);
    ssp.fundPlayer(1, 30);
  };
  const lines = [];
  const catalog = ssp.itemState().catalog;
  for (const spec of expected) {
    const card = catalog.find((c) => c.key === spec.key);
    boot();
    const pool = ssp.pityPool(0);
    const coinsBefore = ssp.state().match.players[0].coins;
    const bought = ssp.buyItem(0, spec.key);
    const held = ssp.itemState().players[0].items.includes(spec.key);
    const coinsAfterBuy = ssp.state().match.players[0].coins;
    if (spec.kind === "steal") ssp.grantItem(1, "zappy");
    if (spec.kind === "trade") {
      ssp.grantItem(0, "dash_mushroom");
      ssp.grantItem(1, "zappy");
    }
    if (spec.kind === "star") ssp.giveStars(1, 1);
    if (spec.kind === "bowser") ssp.giveStars(1, 2);
    if (spec.kind === "swappos") {
      ssp.placePlayer(0, 2);
      ssp.placePlayer(1, 9);
    }
    const balloonBefore = ssp.state().match.starBalloonPos;
    const spaceBefore = ssp.state().match.players[0].space;
    const coinsBeforeUse = ssp.state().match.players.map((p) => p.coins);
    const used = ssp.useHeldItem(0, spec.key, 1);
    const st = ssp.state();
    const items = ssp.itemState();
    const p0 = st.match.players[0];
    const p1 = st.match.players[1];
    const fx0 = items.players[0].itemFx;
    const fx1 = items.players[1].itemFx;
    lines.push({
      key: spec.key,
      catalogName: card?.name ?? null,
      catalogPrice: card?.price ?? null,
      inPity: pool.includes(spec.key),
      bought,
      held,
      spent: coinsBefore - coinsAfterBuy,
      usedOk: used.ok,
      label: used.label,
      message: used.message,
      moveTo: used.moveTo ?? null,
      landEffect: !!used.landEffect,
      chomp: !!used.chomp,
      extraDice: !!used.extraDice,
      rollBonus: fx0.rollBonus,
      penalty: fx1.rollPenalty,
      doubleDice: fx0.doubleDice,
      lucky: fx0.lucky,
      luckyBlue: fx0.luckyBlue,
      spaces: [p0.space, p1.space],
      spaceBefore,
      stars: [p0.stars, p1.stars],
      skip: fx1.skipTurn,
      balloon: st.match.starBalloonPos,
      balloonBefore,
      bag0: items.players[0].items.slice().sort(),
      bag1: items.players[1].items.slice().sort(),
      coinSum: coinsBeforeUse[0] + coinsBeforeUse[1],
      coinSumAfter: p0.coins + p1.coins,
      coinsMoved: p0.coins !== coinsBeforeUse[0] || p1.coins !== coinsBeforeUse[1],
      blue: spec.kind === "lucky" ? ssp.collectLuckyBlue(0) : 0,
      luckyAfterBlue: spec.kind === "lucky" ? ssp.itemState().players[0].itemFx.luckyBlue : false,
      takenLucky: spec.kind === "lucky" ? ssp.takeLuckyPlayers() : [],
      luckyCleared: spec.kind === "lucky" ? ssp.itemState().players[0].itemFx.lucky : false,
      stateItems: !!st.items,
    });
  }
  return lines;
}, EXPECTED);

const first = await play();
const second = await play();
console.log(JSON.stringify(first, null, 2));
if (JSON.stringify(first) !== JSON.stringify(second)) fail("two seed-7 item passes diverged");

for (const row of first) {
  const spec = EXPECTED.find((e) => e.key === row.key);
  if (!row.stateItems) fail(`${row.key} missing state().items`);
  if (row.catalogName !== spec.name) fail(`${row.key} catalog name ${row.catalogName}`);
  if (row.catalogPrice !== spec.price) fail(`${row.key} catalog price ${row.catalogPrice}`);
  if (!row.inPity) fail(`${row.key} was not in the Barker pool`);
  if (!row.bought || !row.held) fail(`${row.key} was not acquired (bought=${row.bought} held=${row.held})`);
  if (row.spent !== spec.price) fail(`${row.key} spent ${row.spent}`);
  if (!row.usedOk) fail(`${row.key} use failed: ${row.message}`);
  if (spec.kind === "dash") {
    if (row.rollBonus !== spec.value) fail(`${row.key} bonus ${row.rollBonus}`);
    if (row.bag0.includes(spec.key)) fail(`${row.key} still in the bag`);
  }
  if (spec.kind === "poison") {
    if (row.penalty !== 2) fail(`poison penalty ${row.penalty}`);
    if (row.bag0.includes(spec.key)) fail("poison still held");
  }
  if (spec.kind === "dice") {
    if (!row.extraDice || !row.doubleDice) fail("double dice did not arm a second die");
  }
  if (spec.kind === "swappos") {
    if (row.spaces[0] !== 9 || row.spaces[1] !== 2) fail(`warp spaces ${row.spaces}`);
  }
  if (spec.kind === "duel") {
    if (!row.message.includes("Duel!")) fail(`duel message ${row.message}`);
    if (!row.coinsMoved) fail("duel moved no coins");
    if (row.coinSum !== row.coinSumAfter) fail("duel minted or destroyed coins");
  }
  if (spec.kind === "lucky") {
    if (!row.lucky || !row.luckyBlue) fail("lucky flags were not set");
    if (row.blue !== 1) fail(`lucky blue paid ${row.blue}`);
    if (row.luckyAfterBlue) fail("lucky blue did not clear");
    if (!row.takenLucky.includes(0)) fail(`lucky roulette ids ${row.takenLucky}`);
    if (row.luckyCleared) fail("lucky flag survived the roulette take");
  }
  if (spec.kind === "steal") {
    if (!row.bag0.includes("zappy") || row.bag1.includes("zappy")) fail(`mecha bags ${row.bag0} / ${row.bag1}`);
  }
  if (spec.kind === "trade") {
    if (!row.bag0.includes("zappy") || row.bag0.includes("dash_mushroom")) fail(`swap give bag ${row.bag0}`);
    if (!row.bag1.includes("dash_mushroom") || row.bag1.includes("zappy")) fail(`swap take bag ${row.bag1}`);
  }
  if (spec.kind === "star") {
    if (row.stars[0] !== 1 || row.stars[1] !== 0) fail(`boo stars ${row.stars}`);
  }
  if (spec.kind === "genie") {
    if (row.moveTo !== row.balloonBefore || !row.landEffect) fail(`genie move ${row.moveTo} land ${row.landEffect}`);
    if (row.spaces[0] !== row.spaceBefore) fail("genie moved the token inside useItem");
  }
  if (spec.kind === "chomp") {
    if (!row.chomp || row.balloon !== row.spaceBefore) fail(`chomp balloon ${row.balloon} space ${row.spaceBefore}`);
    if (row.balloon === row.balloonBefore) fail("chomp left the balloon where it was");
  }
  if (spec.kind === "bowser") {
    if (row.stars[0] !== 2 || row.stars[1] !== 0) fail(`bowser stars ${row.stars}`);
    if (!row.skip) fail("bowser did not skip the rival's turn");
  }
}

if (errors.length) fail("console errors: " + JSON.stringify(errors.slice(0, 4)));
if (!process.exitCode) console.log("PASS: 13 new items acquired and used on seed 7, twice identically.");
await b.close();
