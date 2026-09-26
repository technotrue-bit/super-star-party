// Orchestrator: was the coin-HUD textContent intercept RESTORED after the payout tween?
// The reward juice replaces the element's textContent accessor with Object.defineProperty to
// drive a count-up, which blocks hud.update(). If that intercept outlives the tween, the coin
// readout freezes for the rest of the match. So: run a minigame to payout, let the tween settle,
// then compare the element's OWN descriptor against Node.prototype's. Own descriptor still
// present with a different setter == left intercepted == frozen HUD.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
await p.goto("http://localhost:5177/?seed=7&autoplay=1&audio=0&speed=1&minigame=balloon_pop");
await p.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await p.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.autoplay(true);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
await p.waitForTimeout(700);
await p.evaluate(() => window.__SSP__.goto("minigame"));

const snap = () => p.evaluate(() => {
  const el = document.querySelector('[aria-label="coins"]');
  const st = window.__SSP__.state();
  const coins = (st.match?.players ?? []).map((pl) => pl.coins);
  if (!el) return { hudExists: false, screen: st.screen, coins: coins.join(","), own: null, differs: null, text: null };
  const own = Object.getOwnPropertyDescriptor(el, "textContent");
  const proto = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  return {
    hudExists: true,
    screen: st.screen,
    coins: coins.join(","),
    text: el.textContent.trim(),
    own: !!own,
    differs: own ? !(own.set === proto.set && own.get === proto.get) : false,
  };
});

let paid = false;
for (let i = 0; i < 200 && !paid; i++) {
  await p.waitForTimeout(250);
  const s = await snap();
  if (s.coins && !/^10(,10)*$/.test(s.coins)) {
    paid = true;
    console.log(`payout seen: coins=${s.coins} screen=${s.screen} hud=${s.hudExists ? s.text : "none"}`);
    // the tween targets the BOARD hud chip, which only mounts once the wipe back to the board
    // runs — so wait for the board, then sample the descriptor over several seconds.
    let back = false;
    for (let j = 0; j < 90 && !back; j++) {
      await p.waitForTimeout(1000);
      const s2 = await snap();
      if (s2.screen === "board") back = true;
    }
    console.log("back on board:", back);
    for (let k = 0; k < 4; k++) {
      await p.waitForTimeout(1200);
      const after = await snap();
      console.log(`t+${((k + 1) * 1.2).toFixed(1)}s: hud=${after.text} coins=${after.coins} screen=${after.screen} ownDescriptor=${after.own} differs=${after.differs}`);
      if (k === 3) {
        console.log(after.differs === true ? "VERDICT: FROZEN HUD RISK — intercept survived the tween" : "VERDICT: restored (no lingering textContent intercept)");
      }
    }
  }
}
if (!paid) console.log("no payout observed");
console.log("ERRORS:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
