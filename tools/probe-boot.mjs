// tools/probe-boot.mjs — boot probe: canvas, debug API, console errors.
// Run: node tools/probe-boot.mjs [url]
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:5177/?screen=showcase";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const ssp = window.__SSP__;
  return {
    hasSSP: !!ssp,
    screen: ssp?.state().screen,
    screens: ssp?.state().screens,
    matchPhase: ssp?.state().match?.phase,
    audioTrack: ssp?.state().audio?.track,
    canvasCount: document.querySelectorAll("canvas").length,
    canvasW: document.querySelector("canvas")?.width ?? 0,
    canvasH: document.querySelector("canvas")?.height ?? 0,
    uiRoot: !!document.querySelector(".ssp-ui"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});

console.log(JSON.stringify(probe, null, 2));
console.log("CONSOLE_ERRORS:", errors.length ? errors : "none");
await page.screenshot({ path: "tools/critic/frames/boot.png" });
await browser.close();
console.log("BOOT_PROBE_DONE");
