// Real MediaPipe, real hands: plays a video of hand photos through the actual
// tracker (self-hosted WASM + model, VIDEO mode) in headless Chromium and
// reports what the recognizer reads for each segment.
// Run: HANDS_VIDEO=/path/hands.webm SEGMENTS=pointing_up,woman_hands,... node gesture-lab/e2e/tracker.e2e.mjs
import { chromium } from "playwright";
import { preview } from "./serve.mjs";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4185;
const server = await preview(PORT); // torn down on any exit (serve.mjs)
const base = server.base;

const segs = (process.env.SEGMENTS ?? "").split(",");
const SEG_S = Number(process.env.SEG_SECONDS ?? 1.5);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.route("**/e2e/hands.webm", (r) => r.fulfill({ body: readFileSync(process.env.HANDS_VIDEO), contentType: "video/webm" }));
await p.goto(base + "/dom.html");
await p.waitForFunction(() => window.__lab);
const frames = await p.evaluate(async (total) => {
  const c = window.__lab.shell.controller;
  const out = [];
  c.on((_ev, st) => out.push({ vt: c.tracker.video.currentTime, hands: st.hands.map((h) => h.pose) }));
  // the model loads + runs on CPU here (slow); the video loops, so keep
  // collecting until every segment has been seen a few times, or 90 s
  await c.startOnVideo("/e2e/hands.webm");
  const t0 = performance.now();
  while (performance.now() - t0 < 90000) {
    await new Promise((r) => setTimeout(r, 1000));
    const seen = new Set(out.map((x) => Math.floor(x.vt / (total / 5))));
    if (out.length > 60 && seen.size >= 5) break;
  }
  c.stop();
  return out;
}, segs.length * SEG_S);
await browser.close();
server.stop();

console.log(`frames tracked: ${frames.length}${errors.length ? `  page errors: ${errors.join(" | ")}` : ""}`);
segs.forEach((name, i) => {
  const f = frames.filter((x) => x.vt >= i * SEG_S + 0.4 && x.vt < (i + 1) * SEG_S - 0.1);
  const tally = {};
  for (const x of f) { const k = x.hands.length ? x.hands.join("+") : "no hand"; tally[k] = (tally[k] ?? 0) + 1; }
  console.log(`${name.padEnd(14)} ${JSON.stringify(tally)}`);
});
