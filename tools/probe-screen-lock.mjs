// Probe: taps, stick drags, pinch and double tap never scroll or zoom the page during a minigame.
// Prints PASS screen-lock or FAIL <what>; exit code 1 on fail.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const fails = [];
const fail = (what) => { fails.push(what); };

await page.goto("http://127.0.0.1:5177/?seed=7&audio=0&minigame=balloon_pop", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.evaluate(() => {
  window.__SSP__.seed(7);
  window.__SSP__.startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"]);
});
await page.waitForTimeout(700);
await page.evaluate(() => window.__SSP__.goto("minigame"));
await page.waitForFunction(() => window.__SSP__.state().screen === "minigame", null, { timeout: 20000 });
await page.waitForTimeout(500);

const touch = (type, pts) =>
  cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })),
  });
const wait = (ms) => page.waitForTimeout(ms);

async function check(label) {
  const v = await page.evaluate(() => ({
    sx: window.scrollX,
    sy: window.scrollY,
    scale: window.visualViewport.scale,
    top: window.visualViewport.offsetTop,
    left: window.visualViewport.offsetLeft,
  }));
  if (v.sx !== 0 || v.sy !== 0 || v.scale !== 1 || v.top !== 0 || v.left !== 0) {
    fail(`${label} moved the page ${JSON.stringify(v)}`);
  }
}

// 20 taps across the screen
for (let i = 0; i < 20; i++) {
  const x = 20 + ((i * 53) % 350);
  const y = 60 + ((i * 97) % 700);
  await touch("touchStart", [[x, y]]);
  await touch("touchEnd", []);
  await wait(40);
}
await check("taps");

// 1 s stick drag on the left stick
const stick = await page.evaluate(() => {
  const r = document.querySelector(".ssp-touch .ssp-stick")?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 78, y: 764 };
});
await touch("touchStart", [[stick.x, stick.y]]);
for (let i = 1; i <= 20; i++) {
  const a = (i / 20) * Math.PI * 2;
  await touch("touchMove", [[stick.x + Math.cos(a) * 40, stick.y - 60 + Math.sin(a) * 60]]);
  await wait(50);
}
await touch("touchEnd", []);
await check("stick drag");

// two-finger pinch (fingers moving apart)
await touch("touchStart", [[170, 400], [220, 400]]);
for (let i = 1; i <= 10; i++) {
  await touch("touchMove", [[170 - i * 12, 400 - i * 8], [220 + i * 12, 400 + i * 8]]);
  await wait(30);
}
await touch("touchEnd", []);
await check("pinch");

// double tap
for (let k = 0; k < 2; k++) {
  await touch("touchStart", [[195, 300]]);
  await touch("touchEnd", []);
  await wait(60);
}
await wait(200);
await check("double tap");

// The blockers themselves: cancelable synthetic events must come back defaultPrevented.
const blocked = await page.evaluate(() => {
  const fire = (ev) => { document.body.dispatchEvent(ev); return ev.defaultPrevented; };
  const mk = (id, x, y) => new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
  const touchmove = (touches) =>
    new TouchEvent("touchmove", { cancelable: true, bubbles: true, touches, targetTouches: touches, changedTouches: touches });
  return {
    gesturestart: fire(new Event("gesturestart", { cancelable: true, bubbles: true })),
    gesturechange: fire(new Event("gesturechange", { cancelable: true, bubbles: true })),
    dblclick: fire(new Event("dblclick", { cancelable: true, bubbles: true })),
    contextmenu: fire(new Event("contextmenu", { cancelable: true, bubbles: true })),
    twoFingerMove: fire(touchmove([mk(1, 100, 100), mk(2, 200, 200)])),
    oneFingerMove: fire(touchmove([mk(1, 100, 100)])),
  };
});
for (const k of ["gesturestart", "gesturechange", "dblclick", "contextmenu", "twoFingerMove"]) {
  if (blocked[k] !== true) fail(`${k} not prevented`);
}
if (blocked.oneFingerMove !== false) fail("oneFingerMove was prevented (one finger must stay free)");

const installed = await page.evaluate(() => window.__SSP__.screenLockInstalled?.());
if (installed !== true) fail("screenLockInstalled");

await browser.close();
if (fails.length) {
  console.log("FAIL " + fails.join("; "));
  process.exit(1);
}
console.log("PASS screen-lock");
