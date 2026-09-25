// tools/render-music.mjs — bake every music track to WAV for the Captain to
// listen. Runs the REAL audio engine in a browser page (OfflineAudioContext),
// downloads each render as 16-bit PCM WAV into tools/music/.
// Usage: node tools/render-music.mjs [track ...]   (default: all tracks)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const wanted = process.argv.slice(2);
const tracks = wanted.length
  ? wanted
  : ["title", "board", "minigame_intro", "minigame_a", "minigame_b", "happening", "grumpus", "shop", "results", "star_fanfare", "win", "lose"];

const outDir = "tools/music";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
await page.goto("http://localhost:5177/?screen=title&audio=1", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// Load the real engine in-page and unlock a context.
const ready = await page.evaluate(async () => {
  try {
    const { audio } = await import("/src/audio/audioEngine.ts");
    audio.unlock();
    return { ok: true, tracks: audio.music.tracks ? audio.music.tracks() : [] };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
});
console.log("ENGINE:", JSON.stringify(ready));
if (!ready.ok) {
  console.log("audio engine not importable — is the audio builder's code landed yet?");
  await browser.close();
  process.exit(1);
}

for (const track of tracks) {
  const result = await page.evaluate(
    async (name) => {
      try {
        const { audio } = await import("/src/audio/audioEngine.ts");
        const seconds = ["title","board","minigame_a","minigame_b","results"].includes(name) ? 24 : 8;
        const blob = await audio.renderTrack(name, seconds);
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return { ok: true, b64: btoa(bin), size: bytes.length, seconds };
      } catch (e) {
        return { ok: false, err: String(e).slice(0, 300) };
      }
    },
    track
  );
  if (result.ok) {
    const file = path.join(outDir, `${track}.wav`);
    fs.writeFileSync(file, Buffer.from(result.b64, "base64"));
    console.log(`OK ${track}.wav  ${(result.size / 1024).toFixed(0)} KB  (${result.seconds}s)`);
  } else {
    console.log(`FAIL ${track}: ${result.err}`);
  }
}
await browser.close();
console.log("RENDER_DONE ->", outDir);
