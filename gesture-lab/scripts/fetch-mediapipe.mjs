// Self-host MediaPipe: copy the WASM runtime out of node_modules and fetch the
// hand + face models once, so the page loads nothing from Google or a CDN at runtime.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const out = new URL("../public/mediapipe/", import.meta.url).pathname;
mkdirSync(join(out, "wasm"), { recursive: true });
const pkg = dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision"));
for (const f of readdirSync(join(pkg, "wasm"))) copyFileSync(join(pkg, "wasm", f), join(out, "wasm", f));

const MODELS = {
  "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};
for (const [name, url] of Object.entries(MODELS)) {
  const file = join(out, name);
  if (existsSync(file)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} fetch ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
console.log("mediapipe assets ready in public/mediapipe/");
