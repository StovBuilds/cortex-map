// End-to-end: build output served locally, each lab page driven by scripted
// ghost input (hands, head, pad) through the REAL recognizers + adapters in
// headless Chromium (SwiftShader WebGL). Checks every gesture lands and moves
// things the right way.
//
// Each block gets its own browser. Run them all, one process per block, with
// e2e/run.mjs (npm run e2e), which also retries a block once if Chromium
// itself dies (it can on a small box). Direct: node e2e/ghost.e2e.mjs --only cortex-hands,three-dpad
import { chromium } from "playwright";
import { preview, spawnGroup } from "./serve.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const only = arg("--only")?.split(",");
const blocks = [];
const block = (name, fn, args = []) => blocks.push({ name, fn, args });
const FAKE_MEDIA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

let server = null;
let base = process.env.LAB_BASE;
if (!base && !process.argv.includes("--list")) {
  const PORT = 4300 + (process.pid % 600); // its own port: a stray server left on a fixed one would be silently reused
  server = await preview(PORT); // torn down on any exit (serve.mjs)
  base = server.base;
}

const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
let browser = null;
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures.push(name); };

async function page(path) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + path);
  return { p, errors };
}

// ── cortex-map ────────────────────────────────────────────────────────────────
block("cortex-hands", async () => {
  const { p, errors } = await page("/");
  await p.waitForFunction(() => window.__lab?.map()?.getView(), null, { timeout: 30000 });
  // let the opening zoom-to-fit settle before taking the "start" framing
  await p.evaluate(async () => {
    const map = window.__lab.map();
    let last = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const c = map.getView().camera.position;
      const cur = [c.x, c.y, c.z];
      if (last && Math.hypot(...cur.map((v, k) => v - last[k])) < 0.5 && i > 4) return;
      last = cur;
    }
  });
  const result = await p.evaluate(async () => {
    const lab = window.__lab;
    const map = lab.map();
    const snap = () => {
      const v = map.getView();
      return { cam: { x: v.camera.position.x, y: v.camera.position.y, z: v.camera.position.z }, tgt: { x: v.target.x, y: v.target.y, z: v.target.z } };
    };
    // project a world point to surface px using the live camera
    const project = (w) => {
      const v = map.getView();
      const P = v.camera.position.clone().set(w.x, w.y, w.z).project(v.camera);
      const r = v.element.getBoundingClientRect();
      return { x: (P.x + 1) / 2 * r.width, y: (1 - P.y) / 2 * r.height };
    };
    const log = [];
    let before = null, probe = null;
    const target = lab.findTarget();
    lab.shell.controller.on((events) => {
      for (const e of events) {
        if (e.type === "hover" || e.type === "press") continue;
        const s = snap();
        const entry = { type: e.type, ...s };
        if (e.type === "select") entry.selected = !!document.querySelector(".cm-pane");
        if (e.type === "panstart" || e.type === "twostart") { before = s; probe = { x: s.tgt.x + 100, y: s.tgt.y, z: s.tgt.z }; entry.p0 = project(s.tgt); entry.r0 = project(probe); }
        if (e.type === "panend" || e.type === "twoend") { entry.p1 = project(before.tgt); entry.r1 = project(probe); entry.before = before; }
        log.push(entry);
      }
    });
    const start = snap();
    const hoverSeen = { v: false };
    const iv = setInterval(() => { if (document.body.innerText.includes("Cluster")) hoverSeen.v = true; }, 50);
    await lab.shell.playGhost();
    clearInterval(iv);
    // the reset flight (900 ms) + re-fit (800 ms) are wall-clock tweens; let them land
    let end = snap();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = snap();
      const moved = Math.hypot(s.cam.x - end.cam.x, s.cam.y - end.cam.y, s.cam.z - end.cam.z);
      end = s;
      if (i > 5 && moved < 0.5) break;
    }
    return { start, end, log, target, selectedAfterReset: !!document.querySelector(".cm-pane") };
  });
  const types = result.log.map((e) => e.type).filter((t) => t !== "pan" && t !== "transform");
  check("cortex: ghost found a node to target", !!result.target);
  check("cortex: event sequence", JSON.stringify(types) === JSON.stringify(["select", "panstart", "panend", "twostart", "twoend", "reset"]), types.join(","));
  const sel = result.log.find((e) => e.type === "select");
  const panStart = result.log.find((e) => e.type === "panstart");
  const panEnd = { ...result.log.find((e) => e.type === "panend"), p0: panStart.p0 };
  // hand moved +0.27 x, -0.10 y of a 1440x900 surface ≈ (+389px, -90px)
  const pdx = panEnd.p1.x - panEnd.p0.x, pdy = panEnd.p1.y - panEnd.p0.y;
  check("cortex: drag moves the map WITH the hand (right)", pdx > 200, `dx=${pdx.toFixed(0)}px`);
  check("cortex: drag moves the map WITH the hand (up)", pdy < -20, `dy=${pdy.toFixed(0)}px`);
  const twoStart = result.log.find((e) => e.type === "twostart");
  const twoEnd = { ...result.log.find((e) => e.type === "twoend"), p0: twoStart.p0, r0: twoStart.r0 };
  const d0 = Math.hypot(twoEnd.before.cam.x - twoEnd.before.tgt.x, twoEnd.before.cam.y - twoEnd.before.tgt.y, twoEnd.before.cam.z - twoEnd.before.tgt.z);
  const d1 = Math.hypot(twoEnd.cam.x - twoEnd.tgt.x, twoEnd.cam.y - twoEnd.tgt.y, twoEnd.cam.z - twoEnd.tgt.z);
  check("cortex: spreading hands zooms in", d1 < d0 * 0.7, `distance ${d0.toFixed(0)} → ${d1.toFixed(0)}`);
  // clockwise twist: a point right of the target should swing DOWN the screen
  const rdy = (twoEnd.r1.y - twoEnd.p1.y) - (twoEnd.r0.y - twoEnd.p0.y);
  check("cortex: clockwise twist turns the table clockwise", rdy > 5, `probe swung ${rdy.toFixed(0)}px down`);
  check("cortex: pinch on a node selects it", sel?.selected === true || result.log.some((e) => e.type === "select"));
  const back = Math.hypot(result.end.cam.x - result.start.cam.x, result.end.cam.y - result.start.cam.y, result.end.cam.z - result.start.cam.z);
  check("cortex: open palm resets the view", back < 60, `${back.toFixed(1)} units from start; start ${JSON.stringify(result.start.cam)} end ${JSON.stringify(result.end.cam)}`);
  check("cortex: reset clears the selection", !result.selectedAfterReset);
  check("cortex: no page errors", errors.length === 0, errors.join(" | "));
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/cortex.png` });
  await p.close();
});

// ── DOM board ─────────────────────────────────────────────────────────────────
block("board-hands", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const board = document.querySelector(".board");
    const states = [];
    window.__lab.shell.controller.on((ev) => { for (const e of ev) if (e.type !== "hover" && e.type !== "press") states.push({ t: e.type, tf: board.style.transform, picked: document.querySelectorAll("[data-picked]").length }); });
    await window.__lab.shell.playGhost();
    await new Promise((r) => setTimeout(r, 700));
    return { states, final: board.style.transform, picked: document.querySelectorAll("[data-picked]").length };
  });
  const sel = r.states.find((s) => s.t === "select");
  check("board: pinch clicks the card under the hand", sel?.picked === 1);
  const pe = r.states.find((s) => s.t === "panend");
  check("board: drag translates the board", /translate\((\d{3}|[5-9]\d)\.?\d*px/.test(pe?.tf ?? ""), pe?.tf);
  const te = r.states.find((s) => s.t === "twoend");
  const m = /rotate\(([-\d.e]+)rad\) scale\(([-\d.e]+)\)/.exec(te?.tf ?? "");
  check("board: two hands zoom + rotate", m && +m[1] > 0.3 && +m[2] > 1.4, te?.tf);
  check("board: reset returns to identity", /translate\(0px, 0px\) perspective\(1400px\) rotateX\(0rad\) rotate\(0rad\) scale\(1\)/.test(r.final), r.final);
  check("board: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── bare three.js ─────────────────────────────────────────────────────────────
block("three-hands", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const lab = window.__lab;
    const pos = () => lab.camera.position.toArray();
    const start = pos();
    let picked = null, mid = null;
    lab.shell.controller.on((ev) => { for (const e of ev) { if (e.type === "select") setTimeout(() => { picked = lab.picked(); }, 0); if (e.type === "twoend") mid = pos(); } });
    await lab.shell.playGhost();
    await new Promise((r) => setTimeout(r, 1500));
    return { start, mid, end: pos(), picked };
  });
  check("three: pinch picks the shape under the hand", !!r.picked, r.picked ?? "none");
  const moved = Math.hypot(...r.mid.map((v, i) => v - r.start[i]));
  check("three: gestures move the camera", moved > 50, `${moved.toFixed(0)} units`);
  const back = Math.hypot(...r.end.map((v, i) => v - r.start[i]));
  check("three: reset returns the camera", back < 2, `${back.toFixed(2)} units`);
  check("three: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── head + controller ghosts: cortex-map and the three.js scene ──────────────
for (const path of ["/", "/three.html"]) {
  for (const which of ["head", "pad"]) block(`${path === "/" ? "cortex" : "three"}-${which}`, async () => {
    const name = `${path === "/" ? "cortex" : "three"} ${which === "head" ? "head" : "controller"}`;
    const { p, errors } = await page(path);
    await p.waitForFunction(() => window.__lab && (window.__lab.map ? window.__lab.map()?.getView() : true), null, { timeout: 30000 });
    await p.waitForTimeout(path === "/" ? 6000 : 500); // let cortex's opening fit settle
    const r = await p.evaluate(async (which) => {
      const lab = window.__lab;
      const view = () => lab.map ? lab.map().getView() : { camera: lab.camera, target: lab.target };
      const pose = () => {
        const v = view();
        const o = { x: v.camera.position.x - v.target.x, y: v.camera.position.y - v.target.y, z: v.camera.position.z - v.target.z };
        const h = Math.hypot(o.x, o.z);
        return { az: Math.atan2(o.x, o.z), el: Math.atan2(o.y, h), dist: Math.hypot(o.x, o.y, o.z), cam: [v.camera.position.x, v.camera.position.y, v.camera.position.z], tgt: [v.target.x, v.target.y, v.target.z] };
      };
      const start = pose();
      const c = which === "head" ? lab.shell.head : lab.shell.pad;
      let maxAz = 0, maxEl = -9, minEl = 9, minDist = Infinity, maxSlide = 0;
      const types = [];
      c.on((ev) => {
        const s = pose();
        let dAz = s.az - start.az; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
        maxAz = Math.max(maxAz, Math.abs(dAz));
        maxEl = Math.max(maxEl, s.el); minEl = Math.min(minEl, s.el);
        minDist = Math.min(minDist, s.dist);
        maxSlide = Math.max(maxSlide, Math.hypot(...s.tgt.map((v, i) => v - start.tgt[i])));
        for (const e of ev) if (e.type !== "hover" && e.type !== "orbit" && e.type !== "pan" && e.type !== "press") types.push(e.type);
      });
      await (which === "head" ? lab.shell.playHeadGhost() : lab.shell.playPadGhost());
      let end = pose();
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const s = pose();
        const moved = Math.hypot(...s.cam.map((v, k) => v - end.cam[k]));
        end = s;
        if (i > 4 && moved < 0.3) break;
      }
      return { start, end, maxAz, maxEl, minEl, minDist, maxSlide, types };
    }, which);
    const deg = (x) => `${(x * 180 / Math.PI).toFixed(0)}°`;
    check(`${name}: turning swings the view round`, r.maxAz > 0.3, `up to ${deg(r.maxAz)}`);
    check(`${name}: looking up flies over the top`, r.maxEl > r.start.el + 0.25, `elevation ${deg(r.start.el)} → ${deg(r.maxEl)}`);
    check(`${name}: looking down drops underneath`, r.minEl < r.maxEl - 0.3, `low point ${deg(r.minEl)}`);
    check(`${name}: zooms in`, r.minDist < r.start.dist * 0.85, `${r.start.dist.toFixed(0)} → ${r.minDist.toFixed(0)}`);
    check(`${name}: slides the map`, r.maxSlide > 5, `${r.maxSlide.toFixed(0)} units`);
    const want = which === "head" ? ["select", "panstart", "panend", "reset"] : ["select", "reset"];
    check(`${name}: events`, JSON.stringify(r.types) === JSON.stringify(want), r.types.join(","));
    const back = Math.hypot(...r.end.cam.map((v, i) => v - r.start.cam[i]));
    check(`${name}: reset returns the view`, back < (path === "/" ? 60 : 2), `${back.toFixed(1)} units`);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
    if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/${name.replace(" ", "-")}.png` });
    await p.close();
  });
}

// ── board: head steering tilts and turns a plain DOM element ─────────────────
// custom gestures: record a shape through the panel, bind it, hold it, it fires; it survives a reload
block("board-poses", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  await p.locator("[data-sheet=poses] summary").click();
  await p.fill("[data-ref=pose-name]", "rock");
  await p.click("[data-pose=record]");
  const rec = await p.evaluate(async () => {
    await window.__lab.shell.playPoseGhost("horns", 5200);
    await new Promise((r) => setTimeout(r, 300));
    return { names: window.__lab.shell.poses.library.names(), n: window.__lab.shell.poses.library.count("rock"), status: document.querySelector("[data-ref=status]").textContent };
  });
  check("poses: records a shape from the hand", rec.names.includes("rock") && rec.n >= 12, `${rec.n} frames; ${rec.status}`);
  await p.selectOption("[data-sheet=poses] li[data-pose=rock] select", "reset");
  const fire = async () => p.evaluate(async () => {
    const board = document.querySelector(".board");
    const s = window.__lab.shell;
    s.adapter.handle({ type: "pan", dx: 0.2, dy: 0.05, at: { x: 0.5, y: 0.5 } });
    const moved = board.style.transform;
    const seen = [];
    const off = s.controller.on((ev) => { for (const e of ev) if (e.type === "pose" || e.type === "reset") seen.push(e.type === "pose" ? `pose:${e.name}` : "reset"); });
    // other shapes first: none of them is "rock"
    for (const pose of ["fist", "point", "relaxed", "draw"]) await s.playPoseGhost(pose, 900);
    const before = [...seen];
    await s.playPoseGhost("horns", 1200);
    await new Promise((r) => setTimeout(r, 700));
    off();
    return { moved, before, seen, final: board.style.transform, status: document.querySelector("[data-ref=status]").textContent };
  });
  let r = await fire();
  check("poses: other shapes don't trigger it", r.before.length === 0, r.before.join(",") || "none");
  check("poses: holding it fires once", r.seen.filter((x) => x === "pose:rock").length === 1, r.seen.join(","));
  check("poses: its action runs (reset)", /translate\(0px, 0px\)/.test(r.final) && !/translate\(0px, 0px\)/.test(r.moved), `${r.moved} → ${r.final}`);
  await p.reload();
  await p.waitForFunction(() => window.__lab);
  r = await fire();
  check("poses: remembered after a reload", r.seen.includes("pose:rock") && /translate\(0px, 0px\)/.test(r.final), r.status);
  // a shape that's already in use gets a warning
  await p.locator("[data-sheet=poses] summary").click();
  await p.fill("[data-ref=pose-name]", "my fist");
  await p.click("[data-pose=record]");
  const warn = await p.evaluate(async () => {
    const said = [];
    const st = document.querySelector("[data-ref=status]");
    const mo = new MutationObserver(() => said.push(st.textContent));
    mo.observe(st, { childList: true, characterData: true, subtree: true });
    await window.__lab.shell.playPoseGhost("fist", 5200);
    await new Promise((r) => setTimeout(r, 300));
    mo.disconnect();
    return { said: said.find((x) => /my fist/.test(x) && /learnt/.test(x)) ?? said.join(" / "), row: document.querySelector("[data-sheet=poses] li[data-pose='my fist']")?.className ?? "" };
  });
  check("poses: warns when a shape looks like one in use", /looks a lot like/.test(warn.said) && /gl-clash/.test(warn.row), warn.said);
  check("poses: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// accessibility mode: point and hold selects (no pinch), it says what it's on, no glide
block("board-access", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  // the same hold without accessible mode does nothing
  const at = await p.evaluate(() => {
    const s = document.querySelector(".board-surface").getBoundingClientRect();
    const c = document.querySelectorAll(".card")[7].getBoundingClientRect();
    return { x: (c.left + c.width / 2 - s.left) / s.width, y: (c.top + c.height / 2 - s.top) / s.height, label: document.querySelectorAll(".card")[7].textContent.trim() };
  });
  const before = await p.evaluate(async (at) => {
    await window.__lab.shell.playPoseGhost("point", 2200, at, 0.15);
    return document.querySelectorAll("[data-picked]").length;
  }, at);
  check("access: off, pointing and holding doesn't click", before === 0, `${before} picked`);
  await p.locator("[data-sheet=access] summary").click();
  await p.locator("input[data-k=access]").check();
  const r = await p.evaluate(async (at) => {
    const s = window.__lab.shell;
    let maxRing = 0;
    const off = s.controller.on(() => { maxRing = Math.max(maxRing, s.controller.dwell.progress); });
    await s.playPoseGhost("point", 2200, at, 0.15);
    off();
    const live = document.querySelector("[data-gesture-announcer]");
    return { picked: [...document.querySelectorAll("[data-picked]")].map((x) => x.textContent.trim()), maxRing, said: s.controller.feedback.announce.log, live: live?.getAttribute("aria-live"), scale: s.controller.overlay.scale, deadzone: s.controller.recognizer.o.dragDeadzone };
  }, at);
  check("access: pointing and holding clicks it", r.picked.length === 1 && r.picked[0].includes(at.label), r.picked.join(",") || "nothing");
  check("access: the ring fills first", r.maxRing > 0.6, r.maxRing.toFixed(2));
  check("access: it says what you're on, then what you did", r.said.some((x) => x.includes(at.label)) && r.said.some((x) => /^Selected/.test(x)) && r.live === "polite", r.said.join(" | "));
  check("access: bigger cursor, steadier drag", r.scale > 1.4 && r.deadzone >= 0.05, `scale ${r.scale}, deadzone ${r.deadzone}`);
  // no glide: a flicked drag stops dead
  const glide = await p.evaluate(async () => {
    const s = window.__lab.shell, board = document.querySelector(".board");
    s.adapter.handle({ type: "panstart", at: { x: 0.5, y: 0.5 } });
    for (let i = 0; i < 6; i++) { s.adapter.handle({ type: "pan", dx: 0.03, dy: 0, at: { x: 0.5, y: 0.5 } }); await new Promise((r) => setTimeout(r, 16)); }
    s.adapter.handle({ type: "panend" });
    const a = board.style.transform;
    await new Promise((r) => setTimeout(r, 500));
    return { a, b: board.style.transform };
  });
  check("access: no glide after letting go", glide.a === glide.b, `${glide.a} → ${glide.b}`);
  check("access: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// polish: the cheat card, panel presets, the first-run guide, the light meter
block("board-polish", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  // cheat card: ? opens it; nothing on → every input; Esc closes
  await p.keyboard.press("?");
  const card = await p.evaluate(() => ({ open: window.__lab.shell.cheat.isOpen(), heads: [...document.querySelectorAll(".gl-cheat h3")].map((h) => h.textContent.trim()), moves: document.querySelectorAll(".gl-cheat li").length }));
  check("cheat: ? opens every move", card.open && card.heads.length === 4 && card.moves > 25, `${card.heads.join(", ")} · ${card.moves} moves`);
  await p.keyboard.press("Escape");
  check("cheat: Esc closes it", !(await p.evaluate(() => window.__lab.shell.cheat.isOpen())));
  // with the controller on, only the controller's moves
  await p.click("[data-act=pad]");
  await p.click("[data-act=cheat]");
  const onlyPad = await p.evaluate(() => [...document.querySelectorAll(".gl-cheat h3")].map((h) => h.textContent.trim()));
  check("cheat: shows only what's switched on", onlyPad.length === 1 && /^Controller/.test(onlyPad[0]) && /on$/.test(onlyPad[0]), onlyPad.join(", "));
  await p.mouse.click(5, 5); // the backdrop
  check("cheat: a click outside closes it", !(await p.evaluate(() => window.__lab.shell.cheat.isOpen())));
  await p.click("[data-act=pad]");
  // typing ? in a field doesn't open it
  await p.locator("[data-sheet=share] summary").click();
  await p.locator("[data-ref=share-name]").fill("a?b");
  check("cheat: ? typed in a field is just a ?", !(await p.evaluate(() => window.__lab.shell.cheat.isOpen())));
  await p.locator("[data-sheet=share] summary").click();

  // presets
  const vis = () => p.evaluate(() => Object.fromEntries(["moves", "yours", "together", "access", "advanced"].map((g) => [g, !!document.querySelector(`[data-group=${g}]`).offsetParent])));
  await p.click("[data-preset=simple]");
  const simple = await vis();
  const sSet = await p.evaluate(() => ({ ...window.__lab.shell.settings }));
  check("presets: Simple hides the extras and the glide", simple.moves && simple.access && !simple.yours && !simple.together && !simple.advanced && !sSet.momentum && sSet.preset === "simple", JSON.stringify(simple));
  await p.click("[data-preset=access]");
  const aSet = await p.evaluate(() => ({ access: window.__lab.shell.settings.access, dwell: window.__lab.shell.controller.dwell.o.ms, open: document.querySelector("[data-sheet=access]").open, box: document.querySelector("input[data-k=access]").checked }));
  check("presets: Easy access turns accessible mode on", aSet.access && aSet.dwell > 0 && aSet.open && aSet.box, JSON.stringify(aSet));
  await p.click("[data-preset=everything]");
  const every = await vis();
  const eSet = await p.evaluate(() => ({ ...window.__lab.shell.settings }));
  check("presets: Everything shows it all", Object.values(every).every(Boolean) && !eSet.access && eSet.momentum, JSON.stringify(every));
  await p.reload();
  await p.waitForFunction(() => window.__lab);
  check("presets: remembered after a reload", await p.evaluate(() => document.querySelector("[data-preset=everything]").getAttribute("aria-checked") === "true"));

  // the guide: point, pinch, palm (the ghost does all three)
  const g = await p.evaluate(async () => {
    const s = window.__lab.shell;
    s.guide.show();
    const shown = document.querySelector(".gl-guide").textContent;
    await s.playGhost();
    const step = s.guide.step();
    const done = document.querySelectorAll(".gl-guide li.gl-done").length;
    await new Promise((r) => setTimeout(r, 4500));
    return { shown, step, done, visible: s.guide.visible(), remembered: s.guide.done() };
  });
  check("guide: starts at step 1", /1 of 3/.test(g.shown) && /Point at something/.test(g.shown), g.shown.slice(0, 60));
  check("guide: ticks off point, pinch, palm", g.step === 3 && g.done === 3, `step ${g.step}, ${g.done} ticked`);
  check("guide: gets out of the way, and remembers", !g.visible && g.remembered);

  // the light meter: black is dark, white is bright
  const light = await p.evaluate(async () => {
    const read = async (col) => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 48;
      const x = c.getContext("2d"); x.fillStyle = col; x.fillRect(0, 0, 64, 48);
      const v = document.createElement("video"); v.muted = true; v.srcObject = c.captureStream(10);
      await v.play();
      for (let i = 0; i < 20 && v.readyState < 2; i++) { x.fillRect(0, 0, 64, 48); await new Promise((r) => setTimeout(r, 100)); }
      x.fillRect(0, 0, 64, 48); await new Promise((r) => setTimeout(r, 200));
      return window.__lab.shell.measureLight(v);
    };
    return { dark: await read("#050505"), bright: await read("#f0f0f0") };
  });
  check("light: reads a dark picture as dark, a bright one as bright", light.dark !== null && light.dark < 0.1 && light.bright > 0.85, JSON.stringify(light));
  check("polish: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// polish with a (fake) camera: the guide shows the first time Hands goes on; nothing in view → the battery hint
block("board-idle", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  await p.click("[data-act=cam]");
  await p.waitForFunction(() => window.__lab.shell.controller.running, null, { timeout: 90000 });
  const guided = await p.waitForFunction(() => window.__lab.shell.guide.visible(), null, { timeout: 90000 }).then(() => true, () => false);
  check("guide: shows the first time Hands goes on", guided);
  const r = await p.evaluate(async () => {
    const s = window.__lab.shell, hint = document.querySelector("[data-ref=hint]");
    for (let i = 0; i < 40 && !(s.controller.tracker.idle && !hint.hidden); i++) await new Promise((r) => setTimeout(r, 500));
    return { idle: s.controller.tracker.idle, hint: hint.hidden ? "" : hint.textContent, status: document.querySelector("[data-ref=status]").textContent };
  });
  check("idle: nothing in view → slows down and says so", r.idle && /checking less often/.test(r.hint), `${r.hint || "no hint"} · ${r.status}`);
  await p.click("[data-act=cam]");
  await p.waitForTimeout(1500);
  check("idle: the hint goes when the camera's off", await p.evaluate(() => document.querySelector("[data-ref=hint]").hidden));
  await p.reload();
  await p.waitForFunction(() => window.__lab);
  await p.evaluate(() => window.__lab.shell.guide.hide());
  await p.evaluate(() => localStorage.setItem("gesture-lab:guided", "1"));
  await p.click("[data-act=cam]");
  await p.waitForFunction(() => window.__lab.shell.controller.running, null, { timeout: 90000 });
  check("guide: not again once it's been seen", !(await p.evaluate(() => window.__lab.shell.guide.visible())));
  await p.click("[data-act=cam]");
  check("idle: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
}, FAKE_MEDIA);

// record & replay: record the ghost's landmarks, replay them through the panel, same gestures; save + load round trip
block("board-record", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  const live = await p.evaluate(async () => {
    const s = window.__lab.shell, kinds = [];
    const off = s.controller.on((ev) => { for (const e of ev) if (!["hover", "press", "pan", "transform"].includes(e.type)) kinds.push(e.type); });
    s.recording.recorder.start({ hands: s.controller }, "board");
    await s.playGhost();
    const r = s.recording.recorder.stop();
    off();
    s.recording.load(r);
    document.querySelectorAll("[data-picked]").forEach((x) => x.removeAttribute("data-picked"));
    return { kinds, frames: r.hands.length, ms: r.ms, video: JSON.stringify(r).includes("data:") };
  });
  check("record: captures landmark frames only", live.frames > 100 && !live.video, `${live.frames} frames, ${(live.ms / 1000).toFixed(1)} s`);
  await p.locator("[data-sheet=record] summary").click();
  await p.click("[data-rec=play]");
  const replayed = await p.evaluate(async () => {
    const s = window.__lab.shell, kinds = [];
    const off = s.controller.on((ev) => { for (const e of ev) if (!["hover", "press", "pan", "transform"].includes(e.type)) kinds.push(e.type); });
    await new Promise((r) => { const iv = setInterval(() => { if (/Replay finished/.test(document.querySelector("[data-ref=status]").textContent)) { clearInterval(iv); r(); } }, 100); });
    off();
    return { kinds, picked: document.querySelectorAll("[data-picked]").length, tf: document.querySelector(".board").style.transform };
  });
  check("replay: the same gestures, through the real recogniser", JSON.stringify(replayed.kinds) === JSON.stringify(live.kinds), `${replayed.kinds.join(",")} vs ${live.kinds.join(",")}`);
  check("replay: and they act (a card picked, view reset)", replayed.picked === 1 && /translate\(0px, 0px\)/.test(replayed.tf), `${replayed.picked} picked`);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-rec=save]")]);
  const path = await dl.path();
  await p.evaluate(() => window.__lab.shell.recording.load({ v: 1, kind: "cortex-gesture-recording", recordedAt: "", ms: 0 }));
  await p.setInputFiles("[data-rec=file]", path);
  await p.waitForFunction(() => /Loaded/.test(document.querySelector("[data-ref=status]").textContent));
  const loaded = await p.evaluate(() => window.__lab.shell.recording.last().hands?.length ?? 0);
  check("record: save and load round-trip", loaded === live.frames, `${loaded} frames back (${dl.suggestedFilename()})`);
  check("record: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// together + phone: the real worker (wrangler dev, local) serving the pages and the relay
async function withWorker(fn) {
  const port = 8100 + (process.pid % 800);
  const wd = spawnGroup("bunx", ["wrangler@4.151.0", "dev", "--port", String(port), "--ip", "127.0.0.1", "--show-interactive-dev-session=false"], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" } });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 150; i++) { try { if ((await fetch(url + "/dom.html")).status < 500) break; } catch { /* starting */ } await sleep(200); }
    await fn(url);
  } finally { wd.stop(); }
}

block("together-phone", async () => {
  await withWorker(async (url) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const open = async (path) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(path.startsWith("http") ? path : url + path); return p; };
    const a = await open("/dom.html");
    await a.waitForFunction(() => window.__lab);
    await a.locator("[data-sheet=share] summary").click();
    await a.fill("[data-ref=share-name]", "Ada");
    await a.locator("[data-ref=share-name]").dispatchEvent("change");
    await a.click("[data-share=start]");
    await a.waitForFunction(() => window.__lab.shell.share.relay()?.status === "open");
    const link = await a.inputValue("[data-ref=share-link]");
    const b = await (async () => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(link.replace(/^https?:\/\/[^/]+/, url)); return p; })();
    await b.waitForFunction(() => window.__lab?.shell.share.relay()?.status === "open");
    await a.waitForFunction(() => /Here with you/.test(document.querySelector("[data-ref=share-peers]").textContent));
    check("together: a shared link joins the same room", await b.evaluate(() => window.__lab.shell.share.room()) === link.split("#room=")[1], link.split("#")[1]);
    // Ada's ghost hands drive Bea's board too
    await a.evaluate(() => window.__lab.shell.playGhost());
    await b.waitForTimeout(800);
    const seen = await b.evaluate(() => ({ remotes: window.__lab.shell.share.remotes().length, picked: document.querySelectorAll("[data-picked]").length, tf: document.querySelector(".board").style.transform }));
    check("together: their hands arrive and act here (pick, drag, zoom, reset)", seen.remotes === 1 && seen.picked === 1 && /translate\(0px, 0px\)/.test(seen.tf), JSON.stringify(seen));
    // the phone remote, opened from Ada's code
    const phoneLink = await a.inputValue("[data-ref=phone-link]");
    const ph = await open(phoneLink.replace(/^https?:\/\/[^/]+/, url));
    await ph.waitForFunction(() => /screen/.test(document.querySelector("[data-ref=status]").textContent));
    const phStatus = await ph.textContent("[data-ref=status]");
    check("phone: pairs with the screen that showed the code", /Ada/.test(phStatus), phStatus);
    // aim at the middle card: the phone cursor starts in the middle; nudge, then tap
    const pickedBefore = await a.evaluate(() => [...document.querySelectorAll("[data-picked]")].map((x) => x.textContent.trim()));
    const pad = await ph.locator("[data-ref=pad]").boundingBox();
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
    await ph.mouse.move(cx, cy); await ph.mouse.down(); await ph.mouse.move(cx + 4, cy + 30, { steps: 6 }); await ph.mouse.up();
    await ph.mouse.move(cx, cy); await ph.mouse.down(); await ph.mouse.up();
    await a.waitForTimeout(500);
    const tapped = await a.evaluate(() => ({ cursor: !!document.querySelector(".gl-phone-cursor"), picked: [...document.querySelectorAll("[data-picked]")].map((x) => x.textContent.trim()) }));
    const on = await ph.textContent("[data-ref=on]");
    check("phone: moving shows its cursor and says what it's on", tapped.cursor && /^On: /.test(on), on);
    const toggled = [...tapped.picked.filter((x) => !pickedBefore.includes(x)), ...pickedBefore.filter((x) => !tapped.picked.includes(x))];
    check("phone: a tap selects what its cursor is on", toggled.length === 1 && on.includes(toggled[0]), `${toggled.join(", ")} / ${on}`);
    // two fingers: pinch out (pointer events with two ids)
    await ph.evaluate(({ cx, cy }) => {
      const pad = document.querySelector("[data-ref=pad]");
      const ev = (type, id, x, y) => pad.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 11 }));
      ev("pointerdown", 11, cx - 30, cy); ev("pointerdown", 12, cx + 30, cy);
      for (let i = 1; i <= 10; i++) { ev("pointermove", 11, cx - 30 - i * 8, cy); ev("pointermove", 12, cx + 30 + i * 8, cy); }
      ev("pointerup", 11, cx - 110, cy); ev("pointerup", 12, cx + 110, cy);
    }, { cx, cy });
    await a.waitForTimeout(500);
    const tf = await a.evaluate(() => document.querySelector(".board").style.transform);
    const sc = +(/scale\(([\d.]+)\)/.exec(tf)?.[1] ?? 1);
    check("phone: two fingers pinched apart zoom in", sc > 1.5, tf);
    await ph.click("[data-act=reset]");
    await a.waitForTimeout(800);
    check("phone: reset resets", /translate\(0px, 0px\).*scale\(1\)/.test(await a.evaluate(() => document.querySelector(".board").style.transform)));
    // Bea leaves: Ada's room says so
    await b.close();
    await a.waitForFunction(() => /Nobody else/.test(document.querySelector("[data-ref=share-peers]").textContent), null, { timeout: 10000 }).catch(() => {});
    check("together: leaving is noticed", /Nobody else/.test(await a.textContent("[data-ref=share-peers]")), await a.textContent("[data-ref=share-peers]"));
    check("together: no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  });
});


block("board-head", async () => {
  const { p, errors } = await page("/dom.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const board = document.querySelector(".board");
    const seen = [];
    window.__lab.shell.head.on(() => seen.push(board.style.transform));
    await window.__lab.shell.playHeadGhost();
    return { seen, final: board.style.transform };
  });
  const tilts = r.seen.map((t) => +(/rotateX\(([-\d.e]+)rad\)/.exec(t)?.[1] ?? 0));
  check("board head: looking up tilts the board back", Math.max(...tilts) > 0.2, `max ${Math.max(...tilts).toFixed(2)} rad`);
  check("board head: brows reset it", /translate\(0px, 0px\) perspective\(1400px\) rotateX\(0rad\) rotate\(0rad\) scale\(1\)/.test(r.final), r.final);
  check("board head: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── look-to-select: rest the head with a shape under the crosshair ───────────
block("three-dwell", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const lab = window.__lab, head = lab.shell.head;
    // centre shape 7 under the crosshair
    const m = lab.shapes[6];
    const off = lab.camera.position.clone().sub(lab.target);
    lab.target.copy(m.position);
    lab.camera.position.copy(m.position).add(off);
    lab.camera.lookAt(lab.target);
    head.feedback.sound.enabled = true;
    head.feedback.sound.tickGapMs = 0;
    head.recenter();
    const face = { yaw: 0, pitch: 0, roll: 0, distance: 50, jawOpen: 0.04, browUp: 0.1 };
    const t0 = performance.now();
    const seen = { lockedLabel: null, maxProgress: 0, selectAt: null };
    for (let t = 0; t < 2600; t += 33) {
      head.feed({ t: t0 + t, face });
      seen.maxProgress = Math.max(seen.maxProgress, head.dwell.progress);
      if (head.feedback.target && !seen.lockedLabel) seen.lockedLabel = head.feedback.target.label;
      if (!seen.selectAt && lab.picked()) seen.selectAt = t;
      await new Promise((r) => setTimeout(r, 2));
    }
    const picked = lab.picked();
    // stay put: it must not select again; look away and back: it may
    lab.shell.head.feed({ t: t0 + 2700, face: null });
    return { want: m.name, picked, ...seen, sounds: [...head.feedback.sound.log] };
  });
  check("three dwell: crosshair locks on the shape", r.lockedLabel === r.want, `${r.lockedLabel}`);
  check("three dwell: ring fills", r.maxProgress > 0.5, r.maxProgress.toFixed(2));
  check("three dwell: holding still selects it", r.picked === r.want && r.selectAt >= 1500, `${r.picked} at ${r.selectAt} ms`);
  check("three dwell: tick on lock, chirp on select", JSON.stringify(r.sounds) === JSON.stringify(["target", "select"]), r.sounds.join(","));
  check("three dwell: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── d-pad hops ────────────────────────────────────────────────────────────────
const press = (btn) => `(() => { const pad = window.__lab.shell.pad; const b = (on) => Array.from({ length: 17 }, (_, i) => (i === on ? 1 : 0));
  const t = performance.now(); pad.feed({ t, pad: { axes: [0, 0, 0, 0], buttons: b(${btn}) } }); pad.feed({ t: t + 50, pad: { axes: [0, 0, 0, 0], buttons: b(-1) } }); })()`;

block("three-dpad", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  const hops = [];
  for (const [btn, dir] of [[15, "right"], [15, "right"], [12, "up"], [14, "left"]]) {
    const before = await p.evaluate(() => {
      const lab = window.__lab, r = document.querySelector(".three-surface").getBoundingClientRect();
      return Object.fromEntries(lab.shapes.map((m) => { const v = m.position.clone().project(lab.camera); return [m.name, { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height }]; }));
    });
    const from = await p.evaluate(() => window.__lab.picked());
    await p.evaluate(press(btn));
    const to = await p.evaluate(() => window.__lab.picked());
    const a = from ? before[from] : { x: 720, y: 450 }, b = before[to];
    const ok = !!to && to !== from && (dir === "right" ? b.x > a.x : dir === "left" ? b.x < a.x : b.y < a.y);
    hops.push({ dir, from, to, ok });
  }
  check("three dpad: each press hops to a shape that way", hops.every((h) => h.ok), hops.map((h) => `${h.dir}: ${h.from ?? "centre"} → ${h.to}`).join("; "));
  check("three dpad: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

block("cortex-dpad", async () => {
  const { p, errors } = await page("/");
  await p.waitForFunction(() => window.__lab?.map()?.getView(), null, { timeout: 30000 });
  await p.waitForTimeout(6000);
  const r = await p.evaluate(async () => {
    const map = window.__lab.map();
    const out = [];
    const b = (on) => Array.from({ length: 17 }, (_, i) => (i === on ? 1 : 0));
    const press = (btn) => { const pad = window.__lab.shell.pad; const t = performance.now(); pad.feed({ t, pad: { axes: [0, 0, 0, 0], buttons: b(btn) } }); pad.feed({ t: t + 50, pad: { axes: [0, 0, 0, 0], buttons: b(-1) } }); };
    for (const btn of [15, 13, 14, 12]) {
      const from = map.selectedId();
      press(btn);
      await new Promise((r) => setTimeout(r, 1800)); // the fly-to
      const to = map.selectedId();
      out.push({ btn, from, to, linked: from ? map.neighbours(from).includes(to) : !!to, pane: !!document.querySelector(".cm-pane") });
    }
    return out;
  });
  const hopped = r.filter((h) => h.to && h.to !== h.from);
  check("cortex dpad: first press picks a node", !!r[0].to && r[0].pane, JSON.stringify(r[0]));
  check("cortex dpad: later presses hop along links", hopped.length >= 3 && r.slice(1).every((h) => h.to === h.from || h.linked), r.map((h) => `${h.from}→${h.to}${h.linked ? "" : " (NOT linked)"}`).join("; "));
  check("cortex dpad: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── hands + head together, one camera (Chromium's fake webcam) ───────────────
block("camera-share", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  await p.click("[data-act=cam]");
  await p.waitForFunction(() => window.__lab.shell.controller.running, null, { timeout: 90000 });
  await p.click("[data-act=head]");
  await p.waitForFunction(() => window.__lab.shell.head.running, null, { timeout: 90000 });
  // count processed frames (headless SwiftShader manages well under 1 fps per model on a small box)
  const both = await p.evaluate(async () => {
    const s = window.__lab.shell;
    let hands = 0, head = 0;
    const off = [s.controller.on(() => hands++), s.head.on(() => head++)];
    for (let i = 0; i < 60 && (hands < 2 || head < 2); i++) await new Promise((r) => setTimeout(r, 1000));
    off.forEach((f) => f());
    return { opened: window.__lab.cameraStats.opened, same: s.controller.tracker.video.srcObject === s.head.tracker.video.srcObject, hands, head };
  });
  check("camera share: one camera for hands + head", both.opened === 1 && both.same, `getUserMedia ×${both.opened}`);
  check("camera share: both trackers running", both.hands >= 2 && both.head >= 2, `frames: hands ${both.hands}, head ${both.head}`);
  await p.click("[data-act=cam]");
  await p.waitForTimeout(500);
  const headOnly = await p.evaluate(() => { const v = window.__lab.shell.head.tracker.video.srcObject; return v && v.getTracks().every((t) => t.readyState === "live"); });
  check("camera share: hands off leaves head's camera live", headOnly === true);
  await p.click("[data-act=head]");
  await p.waitForTimeout(500);
  const off = await p.evaluate(() => window.__lab.cameraStats.live());
  check("camera share: camera off when both are off", off === false);
  check("camera share: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
}, FAKE_MEDIA);

// ── flick + window mode on the three.js scene ────────────────────────────────
block("three-feel", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const lab = window.__lab, a = lab.shell.adapter;
    const pos = () => lab.camera.position.toArray();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const az = () => Math.atan2(lab.camera.position.x - lab.target.x, lab.camera.position.z - lab.target.z);
    // a flicked twist: two hands turning fast, let go while still turning
    a.handle({ type: "twostart", at: { x: 0.5, y: 0.5 } });
    for (let i = 0; i < 8; i++) { a.handle({ type: "transform", scale: 1, rotate: 0.04, dx: 0, dy: 0, at: { x: 0.5, y: 0.5 } }); await wait(16); }
    const az0 = az();
    a.handle({ type: "twoend" });
    await wait(500);
    const az1 = az();
    a.handle({ type: "press", at: { x: 0.5, y: 0.5 } });
    await wait(50);
    const az2 = az();
    await wait(400);
    const az3 = az();
    // window mode: the head moves right, the eye follows; back to centre returns it
    const head = lab.shell.head;
    head.recognizer.o.mode = "window";
    head.recenter();
    const start = pos();
    const face = (x, y) => ({ yaw: 0, pitch: 0, roll: 0, distance: 50, jawOpen: 0.04, browUp: 0.1, x, y });
    const t0 = performance.now();
    let t = 0;
    for (; t < 800; t += 33) head.feed({ t: t0 + t, face: face(0, 0) });
    for (; t < 1600; t += 33) head.feed({ t: t0 + t, face: face(8, 0) });
    const shifted = pos();
    // the camera's own right, before the shift
    for (; t < 2600; t += 33) head.feed({ t: t0 + t, face: face(0, 0) });
    const back = pos();
    head.recognizer.o.mode = "steer";
    return { spun: az1 - az0, caughtDrift: Math.abs(az3 - az2), start, shifted, back };
  });
  check("three feel: a flicked twist keeps spinning", Math.abs(r.spun) > 0.15, `${(r.spun * 180 / Math.PI).toFixed(0)}° after letting go`);
  check("three feel: a pinch catches the spin", r.caughtDrift < 0.002, `${r.caughtDrift.toFixed(4)} rad`);
  const moved = Math.hypot(...r.shifted.map((v, i) => v - r.start[i]));
  const ret = Math.hypot(...r.back.map((v, i) => v - r.start[i]));
  check("three feel: window mode moves the eye with the head", moved > 60, `${moved.toFixed(0)} units`);
  check("three feel: centring the head puts it back", ret < 3, `${ret.toFixed(2)} units`);
  check("three feel: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

// ── map tricks on cortex-map: pull out, pull apart, loop, path ───────────────
block("cortex-map-tricks", async () => {
  const { p, errors } = await page("/");
  await p.waitForFunction(() => window.__lab?.map()?.getView(), null, { timeout: 30000 });
  await p.waitForTimeout(6000);
  const r = await p.evaluate(async () => {
    const lab = window.__lab, map = lab.map();
    const spots = lab.mapSpots();
    const n = spots ? map.node(spots.nodeId) : null;
    const seen = { node: n?.id, label: n?.label, cluster: n?.cluster, linked: !!spots?.linked, cards: 0, cardTitle: null, maxSpread: 1, spots: [], kinds: [] };
    lab.shell.controller.on((ev) => {
      for (const e of ev) {
        if (e.type === "panstart" && e.held && !seen.under) { const el = map.getView().element.getBoundingClientRect(); seen.under = map.nodeAt(e.at.x * el.width, e.at.y * el.height, 44)?.label ?? null; }
        if (e.type === "dial") seen.minTime = Math.min(seen.minTime ?? Infinity, map.time() ?? Infinity);
        if (!["hover", "press", "draw", "pan", "transform", "dial"].includes(e.type)) seen.kinds.push(e.type + (e.held ? "(held)" : "") + (e.type === "drawend" ? (e.closed ? "(loop)" : "(line)") : ""));
        if (e.type === "panend") { const c = document.querySelectorAll(".cg-card"); seen.cards = c.length; seen.cardTitle = c[0]?.querySelector("h4")?.textContent ?? null; }
        if (e.type === "transform" && seen.cluster) seen.maxSpread = Math.max(seen.maxSpread, map.spreadOf(seen.cluster));
        if (e.type === "drawend") seen.spots.push(lab.spot());
      }
    });
    await lab.shell.playMapGhost();
    await new Promise((r) => setTimeout(r, 1500));
    seen.spreadAfterReset = seen.cluster ? map.spreadOf(seen.cluster) : null;
    seen.cardsAfter = document.querySelectorAll(".cg-card").length;
    seen.timeAfter = map.time();
    return seen;
  });
  check("map tricks: gestures recognised", JSON.stringify(r.kinds) === JSON.stringify(["panstart(held)", "panend", "drawend(line)", "drawend(loop)", "twostart(held)", "twoend", "dialstart", "dialend", "reset"]), r.kinds.join(","));
  check("map tricks: a fist turned back goes back in time; reset returns to now", Number.isFinite(r.minTime) && r.timeAfter === null, `min ${r.minTime ? new Date(r.minTime).toISOString().slice(0, 10) : r.minTime}, after reset ${r.timeAfter}`);
  check("map tricks: pinch-hold-drag pulls the node under the pinch out as a card", r.cards === 1 && !!r.under && r.cardTitle === r.under, `${r.cards} card: ${r.cardTitle} (under the pinch: ${r.under})`);
  check("map tricks: both hands held + spread pulls its cluster apart", r.maxSpread > 1.4, `${r.cluster} ×${r.maxSpread.toFixed(2)}`);
  const loop = r.spots[r.linked ? 1 : 0];
  check("map tricks: a loop lights up the nodes inside, the node among them", loop?.mode === "set" && loop.ids.includes(r.node) && loop.ids.length >= 2, loop ? `${loop.ids.length} nodes` : "none");
  const path = r.linked ? r.spots[0] : null;
  check("map tricks: a line to a linked node lights the chain", !r.linked || (path?.mode === "path" && path.ids[0] === r.node && path.ids.length === 2), path ? path.ids.join(" → ") : `linked=${r.linked}`);
  check("map tricks: reset puts the cluster back; the pinned card stays", r.spreadAfterReset === 1 && r.cardsAfter === 1, `spread ${r.spreadAfterReset}, cards ${r.cardsAfter}`);
  check("map tricks: no page errors", errors.length === 0, errors.join(" | "));
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/map-tricks.png` });
  await p.close();
});

// the history dial: a fist turned like a knob scrubs back through time on the map, zooms elsewhere
block("cortex-dial", async () => {
  const { p, errors } = await page("/");
  await p.waitForFunction(() => window.__lab?.map()?.getView(), null, { timeout: 30000 });
  await p.waitForTimeout(4000);
  const r = await p.evaluate(async () => {
    const lab = window.__lab, map = lab.map(), s = lab.shell;
    s.controller.feedback.sound.enabled = true;
    const span = map.timeSpan();
    const pill = () => document.querySelector(".cm-time")?.textContent ?? null;
    const out = { span, kinds: [] };
    s.controller.on((ev) => { for (const e of ev) if (e.type.startsWith("dial")) out.kinds.push(e.type); });
    // anticlockwise: back in time
    await s.playDialGhost(-0.9);
    out.back = map.time();
    out.pill = pill();
    // ghosted = nodes last seen after the cursor
    out.ticks = s.controller.feedback.sound.log.filter((x) => x === "tick").length;
    await new Promise((r) => setTimeout(r, 400));
    await s.playDialGhost(1.6);
    out.forward = map.time();
    out.pillAfter = pill();
    return out;
  });
  check("dial: a fist turned is a dial", JSON.stringify(r.kinds.filter((k) => k !== "dial")) === JSON.stringify(["dialstart", "dialend", "dialstart", "dialend"]), r.kinds.filter((k) => k !== "dial").join(","));
  const frac = r.back != null && r.span ? (r.back - r.span.min) / (r.span.max - r.span.min) : null;
  check("dial: turned back, the map goes back in time", frac != null && frac < 0.85, frac != null ? `${(frac * 100).toFixed(0)}% along the span` : `time ${r.back}`);
  const m = /(\d+) of (\d+)/.exec(r.pill ?? "");
  check("dial: it says when, and later nodes drop away", /As of/.test(r.pill ?? "") && m && +m[1] < +m[2], r.pill ?? "no pill");
  check("dial: it clicks as it turns", r.ticks >= 3, `${r.ticks} clicks`);
  check("dial: turned forward past the newest, it's now again", r.forward === null && r.pillAfter === null, `time ${r.forward}, pill ${r.pillAfter}`);
  check("dial: no page errors", errors.length === 0, errors.join(" | "));
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/dial.png` });
  await p.close();
});

block("three-dial", async () => {
  const { p, errors } = await page("/three.html");
  await p.waitForFunction(() => window.__lab);
  const r = await p.evaluate(async () => {
    const lab = window.__lab;
    const dist = () => lab.camera.position.distanceTo(lab.target);
    const d0 = dist();
    await lab.shell.playDialGhost(0.9); // clockwise: zoom in
    const d1 = dist();
    await lab.shell.playDialGhost(-0.9);
    return { d0, d1, d2: dist() };
  });
  check("three dial: clockwise zooms in, anticlockwise back out", r.d1 < r.d0 * 0.8 && r.d2 > r.d1 * 1.2, `${r.d0.toFixed(0)} → ${r.d1.toFixed(0)} → ${r.d2.toFixed(0)}`);
  check("three dial: no page errors", errors.length === 0, errors.join(" | "));
  await p.close();
});

if (process.argv.includes("--list")) { console.log(blocks.map((b) => b.name).join("\n")); process.exit(0); }
for (const b of blocks) {
  if (only && !only.includes(b.name)) continue;
  browser = await chromium.launch({ args: [...GL, ...b.args] });
  try { await b.fn(); } finally { await browser.close().catch(() => {}); }
}
server?.stop();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
process.exit(failures.length ? 1 : 0);
