// BLIND CRITIC — RUN5: dense burst on a RED space to settle whether the sting renders.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const OUT = "tools/critic/frames/economy/orch-red";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const log = [], errors = [];
const push = (...a) => { const s = a.map(x=>(typeof x==="string"?x:JSON.stringify(x))).join(" "); log.push(s); console.log(s); };
page.on("console", m => { if (m.type()==="error") errors.push(m.text().slice(0,140)); });
page.on("pageerror", e => errors.push("PAGEERR:"+e.message.slice(0,140)));
let seq = 0;
const cap = async (n) => { seq++; const p = `${OUT}/r5-s${String(seq).padStart(3,"0")}-${n}.png`; await page.screenshot({path:p}).catch(()=>{}); push("SHOT "+p); };
const waitFor = async (pred, t=12000, iv=40) => { const t0=Date.now(); while(Date.now()-t0<t){ if(await pred()) return true; await page.waitForTimeout(iv);} return false; };
const state = async () => page.evaluate(() => { try { const s=window.__SSP__.state(); const m=s.match; return {screen:s.screen, phase:m.phase, turn:m.turn, current:m.currentPlayer, players:(m.players||[]).map(p=>({id:p.id,coins:p.coins,stars:p.stars,space:p.space}))}; } catch{return {screen:"err"};} });
const rollReady = async () => page.evaluate(() => { const w=document.querySelector(".ssp-roll-wrap"); if(!w) return false; const b=w.querySelector("button"); return !!(b&&b.offsetParent!==null&&!b.disabled); });

push("=== RUN5: dense red-space sting burst, seed 7 ===");
await page.goto("http://localhost:5177/?seed=7&audio=1&autoplay=0&speed=2", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SSP__, null, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const b=Array.from(document.querySelectorAll("button")).find(x=>(x.textContent||"").toLowerCase().includes("play")); if(b) b.click(); });
await waitFor(async () => (await state()).screen === "select", 8000);
await page.waitForTimeout(600);
await page.evaluate(() => { const c=Array.from(document.querySelectorAll(".ssp-sel-card")); if(c[1]) c[1].click(); else if(c[0]) c[0].click(); });
await page.waitForTimeout(400);
await page.evaluate(() => { const b=Array.from(document.querySelectorAll("button")).find(x=>(x.textContent||"").toLowerCase().includes("start")); if(b) b.click(); });
await waitFor(async () => (await state()).screen === "board", 9000);
await page.waitForTimeout(1200);
const pre = await state(); push("board pre:", JSON.stringify(pre));
await cap("red-pre-turn");

// Wait for turn 1 human dice
await waitFor(async () => { const s=await state(); return s.screen==="board" && s.phase==="dice" && s.current===0 && s.turn===1; }, 12000, 150);
await waitFor(rollReady, 5000);
page.evaluate(() => window.__SSP__.rollDice(6)); // force 6 -> land on space 6 (red)
await page.waitForTimeout(60);
await page.evaluate(() => { const w=document.querySelector(".ssp-roll-wrap"); const b=w&&w.querySelector("button"); if(b&&b.offsetParent!==null&&!b.disabled) b.click(); });
push("rolled 6 -> expect red space 6");

// dense burst the moment phase enters space-effect
await waitFor(() => (async()=>{ const s=await state(); return s.phase==="space-effect"; })(), 3000, 25);
await page.waitForTimeout(60); // let the browser paint the flash overlay
await cap("red-at-effect-start");
for (let i = 0; i < 16; i++) { await cap(`red-burst-${String(i+1).padStart(2,"0")}`); await page.waitForTimeout(35); }
push("post burst:", JSON.stringify(await state()));
fs.writeFileSync(`${OUT}/log5.txt`, log.join("\n"));
fs.writeFileSync(`${OUT}/summary5.json`, JSON.stringify({shots:seq, errors:errors.slice(0,10)}, null, 2));
push("DONE");
await browser.close();
process.exit(0);
