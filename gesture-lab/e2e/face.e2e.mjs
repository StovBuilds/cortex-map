// Real MediaPipe, real faces: plays a video of face photos through the actual
// Face Landmarker (self-hosted WASM + model) in headless Chromium and prints
// what it reads per segment: head yaw / pitch (degrees, + = the person's own
// right / up), mouth and eyebrows. Checks the direction conventions the head
// control depends on.
// Run: FACES_VIDEO=/path/faces.webm SEGMENTS=right,left,... node gesture-lab/e2e/face.e2e.mjs
import { chromium } from "playwright";
import { preview } from "./serve.mjs";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4186;
const server = await preview(PORT); // torn down on any exit (serve.mjs)
const base = server.base;

const segs = (process.env.SEGMENTS ?? "").split(",");
const SEG_S = Number(process.env.SEG_SECONDS ?? 1.5);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.route("**/e2e/faces.webm", (r) => r.fulfill({ body: readFileSync(process.env.FACES_VIDEO), contentType: "video/webm" }));
await p.goto(base + "/dom.html");
await p.waitForFunction(() => window.__lab);
const frames = await p.evaluate(async (n) => {
  const tr = window.__lab.shell.head.tracker;
  const out = [];
  await tr.startOnVideo("/e2e/faces.webm", (f) => out.push({ vt: tr.video.currentTime, face: f.face }));
  const t0 = performance.now();
  while (performance.now() - t0 < 120000) {
    await new Promise((r) => setTimeout(r, 1000));
    if (out.length > 40 && new Set(out.filter((x) => x.face).map((x) => Math.floor(x.vt / 1.5))).size >= n) break;
  }
  tr.stop();
  return out;
}, segs.length);
await browser.close();
server.stop();

const deg = (r) => (r * 180 / Math.PI).toFixed(0).padStart(4);
const res = {};
console.log(`frames: ${frames.length}${errors.length ? `  page errors: ${errors.join(" | ")}` : ""}`);
segs.forEach((name, i) => {
  const f = frames.filter((x) => x.vt >= i * SEG_S + 0.3 && x.vt < (i + 1) * SEG_S - 0.1);
  const faces = f.filter((x) => x.face).map((x) => x.face);
  if (!faces.length) { console.log(`${name.padEnd(12)} no face (${f.length} frames)`); return; }
  const avg = (k) => faces.reduce((s, x) => s + x[k], 0) / faces.length;
  res[name] = { yaw: avg("yaw"), pitch: avg("pitch"), jaw: avg("jawOpen"), brow: avg("browUp"), dist: avg("distance") };
  const r = res[name];
  console.log(`${name.padEnd(12)} n=${String(faces.length).padStart(3)} yaw ${deg(r.yaw)}°  pitch ${deg(r.pitch)}°  mouth ${r.jaw.toFixed(2)}  brows ${r.brow.toFixed(2)}  dist ${r.dist.toFixed(1)}`);
});
const ok = [];
const check = (name, pass) => { ok.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}`); };
if (process.env.EXPECT) {
  // EXPECT=right:+,left:-,... : the sign of yaw each segment should read
  for (const kv of process.env.EXPECT.split(",")) {
    const [seg, want] = kv.split(":");
    const r = res[seg];
    if (want === "+" || want === "-") check(`${seg}: yaw reads ${want === "+" ? "their right" : "their left"}`, !!r && Math.sign(r.yaw) === (want === "+" ? 1 : -1) && Math.abs(r.yaw) > 0.1);
    if (want === "mouth") check(`${seg}: mouth reads open`, !!r && r.jaw > 0.38);
    if (want === "brows") check(`${seg}: eyebrows read up`, !!r && r.brow > 0.55);
  }
}
process.exit(ok.includes(false) ? 1 : 0);
