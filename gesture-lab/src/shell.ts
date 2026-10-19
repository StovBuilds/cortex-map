// The control panel every lab page shares: three independent inputs (hands,
// head, game controller) that can each be switched on alone or together, the
// ghost demos, the cheat-sheets, a camera preview, and the feel knobs. The
// mouse keeps working throughout.

import { DEFAULT_OPTIONS as DEFAULT_RECOGNIZER, GamepadController, measureLight, GestureController, HEAD_DEFAULTS, HeadController, PAD_DEFAULTS, type GestureAdapter, type Point, type SynthPose } from "cortex-gesture";
import { mountPoses, POSE_ACTIONS, type PoseAction } from "./poses";
import { mountRecord } from "./record";
import { mountShare } from "./share";
import { dialGhostScript, ghostScript, mapGhostScript, poseGhostScript, playGhost, playHeadGhost, playPadGhost, type MapSpots } from "./ghost";
import { DEFAULTS, PRESETS, loadSettings, saveSettings, type Settings } from "./settings";
import { mountGuide } from "./guide";
import { mountCheat } from "./cheat";

export interface ShellOptions {
  surface: HTMLElement;
  makeAdapter: (s: Settings) => GestureAdapter;
  /** A good spot for the ghost demo to hover + select (surface coords). */
  findTarget?: () => Point | null;
  /** Pages with map tricks (cortex): where the map-tricks ghost should do them. */
  mapSpots?: () => MapSpots | null;
  page: "cortex" | "board" | "three";
}

const PAGES = [
  { id: "cortex", href: "./", label: "cortex-map" },
  { id: "board", href: "./dom.html", label: "board (DOM)" },
  { id: "three", href: "./three.html", label: "three.js scene" },
];

export function mountShell(o: ShellOptions) {
  const settings = loadSettings();
  // accessibility mode turns the glide off whatever the flick setting says (no motion you didn't make)
  const make = () => o.makeAdapter({ ...settings, momentum: settings.momentum && !settings.access });
  let adapter = make();
  const proxy: GestureAdapter = { handle: (e) => adapter.handle(e), detach: () => adapter.detach?.(), target: () => adapter.target?.() ?? null };
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const controller = new GestureController({
    surface: o.surface,
    adapter: proxy,
    tracker: { wasmBase: `${base}/mediapipe/wasm`, modelUrl: `${base}/mediapipe/hand_landmarker.task` },
  });
  const head = new HeadController({
    surface: o.surface,
    adapter: proxy,
    tracker: { wasmBase: `${base}/mediapipe/wasm`, modelUrl: `${base}/mediapipe/face_landmarker.task` },
  });
  const pad = new GamepadController({ surface: o.surface, adapter: proxy });
  const applyFeel = () => {
    const r = controller.recognizer.o;
    r.cursorFilter.minCutoff = settings.smoothing;
    r.cursorFilter.beta = settings.response;
    r.pinchOn = settings.pinch;
    r.pinchOff = settings.pinch + 0.15;
    // accessibility: a much steadier cursor (tremor), a bigger drag deadzone, point-and-hold select, a bigger cursor, read-outs
    const A = settings.access;
    if (A) { r.cursorFilter.minCutoff = Math.min(settings.smoothing, 0.45); r.cursorFilter.beta = Math.min(settings.response, 4); }
    r.dragDeadzone = A ? 0.05 : DEFAULT_RECOGNIZER.dragDeadzone;
    r.pinchFrames = A ? 3 : DEFAULT_RECOGNIZER.pinchFrames;
    controller.dwell.o.ms = A ? 1200 : 0;
    if (controller.overlay) controller.overlay.scale = A ? 1.6 : 1;
    for (const c of [controller, head, pad]) { c.feedback.announce.enabled = A; c.feedback.announce.o.speak = A && settings.speak; }
    const h = head.recognizer.o;
    h.rate = { yaw: HEAD_DEFAULTS.rate.yaw * settings.headSpeed, pitch: HEAD_DEFAULTS.rate.pitch * settings.headSpeed, zoom: HEAD_DEFAULTS.rate.zoom * settings.headSpeed };
    h.invertYaw = settings.invertYaw;
    h.invertPitch = settings.invertPitch;
    head.dwell.o.ms = settings.dwell ? settings.dwellMs : 0;
    h.mode = settings.headMode;
    for (const c of [controller, head, pad]) c.feedback.sound.enabled = settings.sound;
    const g = pad.recognizer.o;
    g.rate = { pan: PAD_DEFAULTS.rate.pan * settings.padSpeed, yaw: PAD_DEFAULTS.rate.yaw * settings.padSpeed, pitch: PAD_DEFAULTS.rate.pitch * settings.padSpeed, zoom: PAD_DEFAULTS.rate.zoom * settings.padSpeed };
    g.invertY = settings.invertY;
  };
  applyFeel();

  const el = document.createElement("aside");
  el.className = "gl-panel";
  el.innerHTML = `
    <div class="gl-head">
      <strong>HANDS · HEAD · CONTROLLER</strong>
      <span class="gl-head-btns">
        <button class="gl-x gl-help" data-act="cheat" aria-label="Every move (press ?)" title="Every move (?)">?</button>
        <button class="gl-x" data-act="fold" aria-label="Fold panel">–</button>
      </span>
    </div>
    <div class="gl-body">
      <div class="gl-inputs">
        <button class="gl-btn gl-toggle" data-act="cam" aria-pressed="false"><b>Hands</b><small>webcam</small></button>
        <button class="gl-btn gl-toggle" data-act="head" aria-pressed="false"><b>Head</b><small>webcam</small></button>
        <button class="gl-btn gl-toggle" data-act="pad" aria-pressed="false"><b>Controller</b><small>gamepad</small></button>
      </div>
      <div class="gl-row gl-presets" role="radiogroup" aria-label="Panel">
        ${PRESETS.map((p) => `<button class="gl-btn gl-small" role="radio" data-preset="${p.id}" title="${p.hint}">${p.label}</button>`).join("")}
      </div>
      <div class="gl-status" data-ref="status">All off. The mouse still works, and any mix can run at once.</div>
      <p class="gl-hint" data-ref="hint" aria-live="polite" hidden></p>
      <div class="gl-row gl-ghosts"><span>Ghost demo:</span>
        <button class="gl-btn gl-small" data-act="ghost">hands</button>
        <button class="gl-btn gl-small" data-act="ghost-head">head</button>
        <button class="gl-btn gl-small" data-act="ghost-pad">controller</button>
        ${o.mapSpots ? `<button class="gl-btn gl-small" data-act="ghost-map">map tricks</button>` : ""}
      </div>
      <p class="gl-privacy">Your video never leaves this device: tracking runs in the browser, nothing is uploaded or recorded.</p>
      <video class="gl-preview" data-ref="preview" muted playsinline></video>
      <div class="gl-group" data-group="moves"><h3>Moves</h3>
      <details class="gl-sheet" data-sheet="hands" open><summary>Hands</summary>
      <ul class="gl-moves">
        <li><b>Point</b> hover a node: its card appears</li>
        <li><b>Pinch, let go</b> select (pinch it again: fly there)</li>
        <li><b>Pinch and move</b> grab the map and drag</li>
        <li><b>Pinch with both hands</b> spread to zoom, twist to turn</li>
        <li><b>Let go mid-move</b> it glides / spins on; pinch to catch it</li>
        <li><b>Pinch a node, hold still, then drag</b> pull it out as a card</li>
        <li><b>Both hands in a cluster, hold, then spread</b> pull the cluster apart</li>
        <li><b>Index + middle finger (a V), draw a loop</b> light up everything inside</li>
        <li><b>Draw with the V from one node to another</b> light up how they connect</li>
        <li><b>Make a fist, turn it like a knob</b> ${o.page === "cortex" ? "back through time: the map as it was (turn back the other way for now)" : "zoom (on the map it scrubs through time)"}</li>
        <li><b>Open palm, hold still</b> reset the view</li>
        <li><b>Your own shapes</b> teach it one under "Your gestures"</li>
      </ul>
      <p class="gl-tip">Sit about an arm's length back, hand at chest height, palm towards the camera. Good light helps more than anything.</p>
      <button class="gl-btn gl-small" data-act="guide">Show me the basics</button>
      </details>
      <details class="gl-sheet" data-sheet="head"><summary>Head</summary>
      <div class="gl-row gl-modes" role="radiogroup" aria-label="Head mode">
        <button class="gl-btn gl-small" data-act="mode-steer" role="radio">Steer</button>
        <button class="gl-btn gl-small" data-act="mode-window" role="radio">Window</button>
      </div>
      <p class="gl-tip" data-ref="window-tip" hidden>Window: the screen is a window into the scene. Move your head (not turn it) side to side and up and down to look round things; lean in to look closer. Mouth, eyebrows and look-to-select work as below.</p>
      <ul class="gl-moves">
        <li><b>Turn left / right</b> the view turns with you</li>
        <li><b>Tip your head back</b> fly up over the top</li>
        <li><b>Tip it down</b> drop down underneath</li>
        <li><b>Lean in / back</b> zoom in / out</li>
        <li><b>Mouth open, move your head</b> grab and drag</li>
        <li><b>Hold the crosshair on a node</b> select it (the ring fills)</li>
        <li><b>Quick mouth open</b> select what's in the crosshair (again: fly there)</li>
        <li><b>Mouth open on a node, hold still, then move</b> pull it out as a card</li>
        <li><b>Eyebrows up, hold</b> reset the view</li>
      </ul>
      <p class="gl-tip">Look straight at the screen when it starts: it learns your resting pose in the first half-second. Small turns go slow, bigger turns go faster. Backwards? Flip it under "Tune the feel".</p>
      <button class="gl-btn gl-small" data-act="recenter">Recentre (learn my resting pose again)</button>
      </details>
      <details class="gl-sheet" data-sheet="pad"><summary>Controller</summary>
      <ul class="gl-moves">
        <li><b>Left stick</b> fly across the map</li>
        <li><b>Right stick</b> turn left / right, up = over the top, down = underneath</li>
        <li><b>RT / LT</b> zoom in / out (LB / RB too)</li>
        <li><b>A / ✕</b> select what's in the crosshair (again: fly there)</li>
        <li><b>B / ○</b> clear the selection</li>
        <li><b>D-pad</b> hop to the linked node that way</li>
        <li><b>Y / △ or Start</b> reset the view</li>
      </ul>
      <p class="gl-tip">Xbox, PlayStation and most Bluetooth or USB pads work. Plug it in or pair it, then press any button so the browser can see it.</p>
      </details>
      </div>
      <div class="gl-group" data-group="yours"><h3>Make it yours</h3>
      <details class="gl-sheet" data-sheet="poses"></details>
      <details class="gl-sheet" data-sheet="record"></details>
      </div>
      <div class="gl-group" data-group="together"><h3>With others</h3>
      <details class="gl-sheet" data-sheet="share"></details>
      </div>
      <div class="gl-group" data-group="access"><h3>Accessibility</h3>
      <details class="gl-sheet" data-sheet="access"><summary>Accessibility</summary>
      <label class="gl-check"><input type="checkbox" data-k="access"> <b>Accessible mode</b></label>
      <ul class="gl-moves">
        <li><b>Point and hold still</b> on something to select it: no pinch needed (the ring fills)</li>
        <li><b>A much steadier cursor</b> that ignores small shakes, and a bigger cursor</li>
        <li><b>Bigger targets</b> on the map, and pinches need a firmer close</li>
        <li><b>No glide</b>: nothing moves unless you move it</li>
        <li><b>Says what you're on</b> and what you did, to your screen reader</li>
      </ul>
      <label class="gl-check"><input type="checkbox" data-k="speak"> Read it aloud too (without a screen reader)</label>
      <p class="gl-tip">Head and controller both work on their own, so any one of them can stand in for hands. Every button here works from the keyboard (Tab, then Enter).</p>
      </details>
      </div>
      <div class="gl-group" data-group="advanced"><h3>Advanced</h3>
      <details class="gl-tune">
        <summary>Tune the feel</summary>
        ${knob("smoothing", "Steadiness", 0.3, 3, 0.1, "steadier ←→ snappier")}
        ${knob("response", "Fast-move catch-up", 0, 30, 1, "")}
        ${knob("pinch", "Pinch trigger gap", 0.18, 0.45, 0.01, "tight ←→ easy")}
        ${knob("panGain", "Drag speed", 0.4, 2.5, 0.05, "")}
        ${knob("zoomGain", "Zoom speed", 0.5, 3, 0.05, "")}
        ${knob("headSpeed", "Head steering speed", 0.3, 2.5, 0.05, "")}
        <label class="gl-check"><input type="checkbox" data-k="invertYaw"> Head: flip left / right</label>
        <label class="gl-check"><input type="checkbox" data-k="invertPitch"> Head: flip up / down</label>
        <label class="gl-check"><input type="checkbox" data-k="dwell"> Head: look at a node to select it</label>
        ${knob("dwellMs", "Look-to-select time (ms)", 500, 2500, 100, "")}
        ${knob("padSpeed", "Controller speed", 0.3, 2.5, 0.05, "")}
        <label class="gl-check"><input type="checkbox" data-k="invertY"> Controller: invert look up / down</label>
        <label class="gl-check"><input type="checkbox" data-k="sound"> Sounds (each cluster has its own note)</label>
        <label class="gl-check"><input type="checkbox" data-k="momentum"> Flick to glide / spin</label>
        <label class="gl-check"><input type="checkbox" data-k="preview"> Camera preview</label>
        <button class="gl-btn gl-small" data-act="defaults">Defaults</button>
      </details>
      </div>
      <nav class="gl-nav">Try it on: ${PAGES.map((p) => p.id === o.page ? `<span>${p.label}</span>` : `<a href="${p.href}">${p.label}</a>`).join(" · ")}</nav>
    </div>`;
  document.body.appendChild(el);

  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const status = $<HTMLDivElement>("[data-ref=status]");
  const preview = $<HTMLVideoElement>("[data-ref=preview]");
  const camBtn = $<HTMLButtonElement>("[data-act=cam]");
  const headBtn = $<HTMLButtonElement>("[data-act=head]");
  const padBtn = $<HTMLButtonElement>("[data-act=pad]");
  const camOn = () => controller.running || head.running;
  const sheet = (k: string) => el.querySelector<HTMLDetailsElement>(`[data-sheet=${k}]`)!;
  const mark = (b: HTMLButtonElement, on: boolean) => { b.setAttribute("aria-pressed", String(on)); b.classList.toggle("gl-on", on); };
  const showPreview = () => {
    const src = (controller.running ? controller.tracker.video : head.running ? head.tracker.video : null)?.srcObject ?? null;
    if (preview.srcObject !== src) { preview.srcObject = src; if (src) preview.play().catch(() => {}); }
  };
  const idleText = () => {
    const on = [controller.running && "hands", head.running && "head", pad.running && "controller"].filter(Boolean);
    return on.length ? `On: ${on.join(" + ")}` : "All off. The mouse still works, and any mix can run at once.";
  };

  const syncKnobs = () => {
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[data-k], select[data-k]").forEach((i) => {
      const k = i.dataset.k as keyof Settings;
      if (i instanceof HTMLInputElement && i.type === "checkbox") i.checked = !!settings[k];
      else if (document.activeElement !== i) { i.value = String(settings[k]); const out = i.parentElement?.querySelector("output"); if (out) out.textContent = String(settings[k]); }
    });
    preview.style.display = settings.preview && camOn() ? "block" : "none";
    for (const m of ["steer", "window"] as const) {
      const b = el.querySelector<HTMLButtonElement>(`[data-act=mode-${m}]`)!;
      b.setAttribute("aria-checked", String(settings.headMode === m));
      b.classList.toggle("gl-on", settings.headMode === m);
    }
    el.querySelector<HTMLElement>("[data-ref=window-tip]")!.hidden = settings.headMode !== "window";
    el.dataset.panel = settings.preset;
    el.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => {
      const on = b.dataset.preset === settings.preset;
      b.setAttribute("aria-checked", String(on));
      b.classList.toggle("gl-on", on);
    });
  };
  syncKnobs();
  el.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement;
    const k = i.dataset.k as keyof Settings | undefined;
    if (!k) return;
    (settings as unknown as Record<string, unknown>)[k] = i.type === "checkbox" ? i.checked : Number(i.value);
    if (k === "access") settings.preset = settings.access ? "access" : settings.preset === "access" ? "everything" : settings.preset;
    saveSettings(settings);
    applyFeel();
    if (k === "panGain" || k === "zoomGain" || k === "momentum" || k === "access") { adapter.detach?.(); adapter = make(); }
    syncKnobs();
  });

  let hint = "";
  let lastHands = 0;
  head.on((events, st) => {
    for (const e of events) {
      if (e.type === "select") status.textContent = "Head: selected";
      if (e.type === "reset") status.textContent = "Head: view reset";
      if (e.type === "panstart") status.textContent = "Head: grabbing";
    }
    if (!head.running) return;
    const word = !st.present ? "look at the camera" : st.calibrating ? "hold still a moment…" : null;
    if (word && status.dataset.head !== word) { status.dataset.head = word; status.textContent = `Head: ${word}`; }
    if (!word && status.dataset.head) { status.dataset.head = ""; status.textContent = `Head: tracking${head.tracker.fps ? ` · ${Math.round(head.tracker.fps)} fps` : ""}`; }
  });
  let padSeen = "";
  pad.on((events, st) => {
    for (const e of events) {
      if (e.type === "select") status.textContent = e.at.x < 0 ? "Controller: selection cleared" : "Controller: selected";
      if (e.type === "reset") status.textContent = "Controller: view reset";
    }
    if (!pad.running) return;
    const name = st.connected ? pad.name || "controller" : "";
    if (name !== padSeen) { padSeen = name; status.textContent = name ? `Controller: ${name.replace(/\s*\(.*$/, "").slice(0, 40)}` : "Controller: press any button on it"; }
  });
  let wasBusy = false;
  controller.on((events, state) => {
    const busy = state.mode !== "idle" || state.hands.some((h) => h.pinched || h.role !== "idle");
    // the hand went out of view in the middle of something: say so (it's the usual "why did it stop")
    if (wasBusy && !state.hands.length && controller.running) hint = "lost your hand mid-move: keep it in view";
    wasBusy = busy && state.hands.length > 0;
    for (const e of events) {
      if (e.type === "select") hint = "selected";
      if (e.type === "reset") hint = "view reset";
      if (e.type === "panstart") hint = "grabbing";
      if (e.type === "twostart") hint = "zoom / turn";
    }
    if (!controller.running) return;
    const n = state.hands.length;
    if (n !== lastHands || hint) {
      lastHands = n;
      const fps = controller.tracker.fps ? ` · ${Math.round(controller.tracker.fps)} fps` : "";
      status.textContent = (n ? `Hands: tracking ${n}` : "Hands: no hand seen, raise one") + fps + (hint ? ` · ${hint}` : "");
      hint = "";
    }
  });

  const poses = mountPoses({
    sheet: sheet("poses"),
    controller,
    say: (s) => { status.textContent = s; },
    run: (action: PoseAction, at) => {
      if (action === "reset") proxy.handle({ type: "reset" });
      else if (action === "select") proxy.handle({ type: "select", at });
      else if (action === "sound" || action === "flick") {
        const k = action === "sound" ? "sound" : "momentum";
        settings[k] = !settings[k];
        saveSettings(settings); applyFeel(); syncKnobs();
        if (k === "momentum") { adapter.detach?.(); adapter = make(); }
      }
    },
  });

  const recording = mountRecord({ sheet: sheet("record"), page: o.page, controller, head, pad, say: (s) => { status.textContent = s; } });

  const share = mountShare({ sheet: sheet("share"), surface: o.surface, page: o.page, controller, adapter: proxy, say: (s) => { status.textContent = s; } });

  const guide = mountGuide({ controller, access: () => settings.access, say: (s) => { status.textContent = s; } });
  const cheat = mountCheat({
    panel: el,
    on: () => ({ hands: controller.running, head: head.running, pad: pad.running }),
    custom: () => Object.entries(poses.bindings).filter(([, a]) => a !== "none").map(([n, a]) => [n, POSE_ACTIONS[a]]),
  });

  // the "why isn't it working" hints: too dark, or nobody in view (and so checking less often)
  const hintEl = $<HTMLElement>("[data-ref=hint]");
  let dark = false;
  const showHint = (s: string) => { if (hintEl.textContent !== s) hintEl.textContent = s; hintEl.hidden = !s; };
  window.setInterval(() => {
    if (!camOn()) { dark = false; showHint(""); return; }
    const L = measureLight(controller.running ? controller.tracker.video : head.tracker.video);
    if (L !== null) dark = dark ? L < 0.22 : L < 0.16;
    const idle = controller.running ? controller.tracker.idle && !(head.running && !head.tracker.idle) : head.tracker.idle;
    showHint(dark ? "It's quite dark, so tracking may struggle. A lamp in front of you (not behind) helps most."
      : idle ? `Nothing in view, so it's checking less often to save battery. ${controller.running ? "Raise a hand" : "Look at the camera"} any time.`
      : "");
  }, 1000);

  let ghostAbort: AbortController | null = null;
  el.addEventListener("click", async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "fold") { el.classList.toggle("gl-folded"); return; }
    if (act === "cheat") { cheat.toggle(); return; }
    if (act === "guide") { guide.show(); if (!controller.running) status.textContent = "Turn Hands on to try the basics (or watch the hands ghost demo)."; return; }
    const preset = (e.target as HTMLElement).closest<HTMLElement>("[data-preset]")?.dataset.preset as Settings["preset"] | undefined;
    if (preset) {
      const p = PRESETS.find((x) => x.id === preset)!;
      Object.assign(settings, p.set, { preset });
      saveSettings(settings); applyFeel();
      adapter.detach?.(); adapter = make();
      if (preset === "access") sheet("access").open = true;
      syncKnobs();
      status.textContent = `Panel: ${p.label}. ${p.hint}`;
      return;
    }
    if (act === "defaults") { Object.assign(settings, DEFAULTS); saveSettings(settings); applyFeel(); adapter = make(); syncKnobs(); return; }
    if (act === "mode-steer" || act === "mode-window") {
      settings.headMode = act === "mode-steer" ? "steer" : "window";
      saveSettings(settings); applyFeel(); syncKnobs();
      head.recenter();
      if (head.running) status.textContent = `Head: ${settings.headMode === "window" ? "window mode: hold still a moment…" : "steering: hold still a moment…"}`;
      return;
    }
    if (act === "recenter") { head.recenter(); status.textContent = "Head: hold still a moment…"; return; }
    if (act === "pad") {
      if (pad.running) { pad.stop(); mark(padBtn, false); status.textContent = idleText(); return; }
      pad.start(); mark(padBtn, true); sheet("pad").open = true;
      status.textContent = "Controller: press any button on it";
      return;
    }
    if (act === "cam" || act === "head") {
      const c = act === "cam" ? controller : head;
      const btn = act === "cam" ? camBtn : headBtn;
      if (c.running) {
        c.stop();
        mark(btn, false);
        status.textContent = idleText();
        showPreview();
        syncKnobs();
        return;
      }
      btn.disabled = true;
      sheet(act === "cam" ? "hands" : "head").open = true;
      status.textContent = act === "cam" ? "Loading the hand model (about 8 MB, once)…" : "Loading the face model (about 4 MB, once)…";
      try {
        await c.start();
        mark(btn, true);
        status.textContent = act === "cam" ? "Hands: raise a hand" : "Head: look at the camera";
        if (act === "cam" && !guide.done()) guide.show();
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        status.textContent = /denied|NotAllowed/i.test(m) ? "Camera permission was refused. Allow it in the address bar and try again." : `Couldn't start: ${m}`;
        c.stop();
        mark(btn, false);
      } finally {
        btn.disabled = false;
        showPreview();
        syncKnobs();
      }
    }
    if (act?.startsWith("ghost")) {
      if (ghostAbort) { ghostAbort.abort(); return; }
      const which = act === "ghost" || act === "ghost-map" ? "hands" : act === "ghost-head" ? "head" : "pad";
      const busy = which === "hands" ? controller.running : which === "head" ? head.running : pad.running;
      if (busy) { status.textContent = `Switch ${which === "pad" ? "the controller" : which} off to watch its ghost demo.`; return; }
      ghostAbort = new AbortController();
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button")!;
      const label = btn.textContent;
      btn.textContent = "stop";
      sheet(which === "hands" ? "hands" : which).open = true;
      if (act === "ghost-map") {
        status.textContent = "Ghost hands: pull a node out, draw to a linked node, loop round it, pull its cluster apart, turn back time, reset";
        const spots = o.mapSpots?.();
        const r = o.surface.getBoundingClientRect();
        if (spots) await playGhost(controller, mapGhostScript(spots, r.width / Math.max(1, r.height)), ghostAbort.signal);
      } else if (which === "hands") {
        status.textContent = "Ghost hands: point, select, drag, zoom + turn, reset";
        const r = o.surface.getBoundingClientRect();
        await playGhost(controller, ghostScript(o.findTarget?.() ?? null, r.width / Math.max(1, r.height)), ghostAbort.signal);
      } else if (which === "head") {
        status.textContent = "Ghost head: turn, up over the top, down, lean in, mouth tap, mouth grab, brows reset";
        await playHeadGhost(head, ghostAbort.signal);
      } else {
        status.textContent = "Ghost controller: look, fly over, slide, zoom, A select, Y reset";
        await playPadGhost(pad, ghostAbort.signal);
      }
      ghostAbort = null;
      btn.textContent = label;
      status.textContent = idleText();
    }
  });

  return {
    controller, head, pad, settings, adapter: proxy, poses, recording, share, guide, cheat, measureLight,
    /** One hand holding a shape for `ms` (to record or try a custom gesture without a camera). */
    /** A fist turned like a knob, radians (+ = clockwise on screen). */
    playDialGhost: (turn: number, at?: Point) => playGhost(controller, dialGhostScript(turn, at)),
    playPoseGhost: (pose: SynthPose, ms = 1800, at?: Point, wobble = 1) => playGhost(controller, poseGhostScript(pose, ms, at, wobble)),
    playGhost: () => playGhost(controller, ghostScript(o.findTarget?.() ?? null, o.surface.clientWidth / Math.max(1, o.surface.clientHeight))),
    playHeadGhost: () => playHeadGhost(head),
    playPadGhost: () => playPadGhost(pad),
    playMapGhost: async () => { const sp = o.mapSpots?.(); const r = o.surface.getBoundingClientRect(); if (sp) await playGhost(controller, mapGhostScript(sp, r.width / Math.max(1, r.height))); return sp; },
  };
}

function knob(k: keyof Settings, label: string, min: number, max: number, step: number, hint: string) {
  return `<label class="gl-knob"><span>${label} <output></output></span>
    <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}">
    ${hint ? `<small>${hint}</small>` : ""}</label>`;
}
