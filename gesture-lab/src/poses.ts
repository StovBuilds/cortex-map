// Custom gestures: record a hand shape, name it, pick what it does. The
// library and the bindings live in this browser only.

import { PoseLibrary, type GestureController, type Point } from "cortex-gesture";

export const POSE_ACTIONS = {
  select: "click here",
  reset: "reset view",
  voice: "voice on/off",
  sound: "sounds on/off",
  flick: "flick on/off",
  none: "nothing",
} as const;
export type PoseAction = keyof typeof POSE_ACTIONS;

const KEY = "gesture-lab:poses";
/** Recording stops at this many frames, or RECORD_MS after the first hand frame, whichever comes first; it gives up if no hand shows for WAIT_MS. */
const RECORD_FRAMES = 40;
const RECORD_MS = 3500;
const WAIT_MS = 6000;
const COUNTDOWN_MS = 1500;

interface Saved { library: unknown; bindings: Record<string, PoseAction> }

function load(): Saved {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object") return { library: s.library, bindings: s.bindings && typeof s.bindings === "object" ? s.bindings : {} };
  } catch { /* private mode */ }
  return { library: null, bindings: {} };
}

export interface PosesUI {
  library: PoseLibrary;
  bindings: Record<string, PoseAction>;
  record(name: string): Promise<string>;
  remove(name: string): void;
  bind(name: string, action: PoseAction): void;
}

export function mountPoses(o: {
  sheet: HTMLElement;
  controller: GestureController;
  say: (s: string) => void;
  run: (action: PoseAction, at: Point, name: string) => void;
}): PosesUI {
  const saved = load();
  const library = new PoseLibrary({ videoAspect: o.controller.recognizer.o.videoAspect });
  library.load(saved.library);
  const bindings: Record<string, PoseAction> = {};
  for (const n of library.names()) bindings[n] = (saved.bindings[n] in POSE_ACTIONS ? saved.bindings[n] : "select") as PoseAction;
  const save = () => { try { window.localStorage.setItem(KEY, JSON.stringify({ library: library.toJSON(), bindings })); } catch { /* private mode */ } };
  const arm = (quiet?: string) => o.controller.recognizer.setPoses(library.names().length ? library : null, { quiet });
  arm();

  o.sheet.innerHTML = `<summary>Your gestures</summary>
    <p class="gl-tip">Teach it a hand shape of your own (rock horns, a "call me", three fingers) and choose what it does. Hold the shape still for a moment and it fires once.</p>
    <ul class="gl-poses" data-ref="poses"></ul>
    <div class="gl-row gl-record">
      <input data-ref="pose-name" type="text" maxlength="24" placeholder="Name, e.g. rock" autocomplete="off" spellcheck="false" aria-label="Gesture name">
      <button class="gl-btn gl-small" data-pose="record">Record</button>
    </div>
    <p class="gl-tip">Turn Hands on, press Record, then hold the shape up to the camera and move it about a little. Shapes too close to a pinch, a point, a V or an open palm won't take: those already mean something.</p>`;
  const list = o.sheet.querySelector<HTMLUListElement>("[data-ref=poses]")!;
  const nameIn = o.sheet.querySelector<HTMLInputElement>("[data-ref=pose-name]")!;
  const recBtn = o.sheet.querySelector<HTMLButtonElement>("[data-pose=record]")!;

  const render = () => {
    const names = library.names();
    list.innerHTML = names.length ? "" : `<li class="gl-empty">None yet.</li>`;
    for (const n of names) {
      const li = document.createElement("li");
      li.dataset.pose = n;
      const b = document.createElement("b"); b.textContent = n;
      if (library.clash(n) > 0.3) {
        b.textContent = `⚠ ${n}`;
        b.title = "Looks a lot like a shape already in use (fist, pinch, point, V, open palm): it may fire by accident or not at all.";
        li.classList.add("gl-clash");
      }
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `What “${n}” does`);
      for (const [k, label] of Object.entries(POSE_ACTIONS)) { const opt = new Option(label, k); sel.add(opt); }
      sel.value = bindings[n] ?? "select";
      sel.addEventListener("change", () => ui.bind(n, sel.value as PoseAction));
      const x = document.createElement("button");
      x.className = "gl-btn gl-small"; x.textContent = "✕"; x.setAttribute("aria-label", `Forget “${n}”`);
      x.addEventListener("click", () => ui.remove(n));
      li.append(b, sel, x);
      list.appendChild(li);
    }
  };

  let recording = false;
  const ui: PosesUI = {
    library,
    bindings,
    bind(name, action) { bindings[name] = action; save(); },
    remove(name) { library.remove(name); delete bindings[name]; save(); arm(); render(); },
    async record(raw) {
      const name = raw.trim().slice(0, 24) || `gesture ${library.names().length + 1}`;
      if (recording) return "busy";
      recording = true;
      recBtn.disabled = true;
      // don't fire the old poses (or this one, half-learnt) while recording
      o.controller.recognizer.setPoses(null);
      try {
        o.say(`Gestures: get ready to show “${name}”…`);
        await new Promise((r) => setTimeout(r, COUNTDOWN_MS));
        o.say(`Gestures: recording “${name}”: hold it up, move it a little`);
        const before = library.count(name);
        let done: () => void = () => {};
        const enough = new Promise<void>((r) => { done = r; });
        let cap = window.setTimeout(() => done(), WAIT_MS);
        let started = false;
        const off = o.controller.on((_e, st) => {
          const h = st.hands[0];
          if (h?.landmarks.length !== 21 || h.pinched) return;
          library.add(name, h.landmarks);
          // the clock starts when the hand shows up
          if (!started) { started = true; window.clearTimeout(cap); cap = window.setTimeout(() => done(), RECORD_MS); }
          if (library.count(name) - before >= RECORD_FRAMES) done();
        });
        await enough;
        window.clearTimeout(cap);
        off();
        const got = library.count(name) - before;
        if (got < 8) {
          if (!before) library.remove(name);
          o.say(`Gestures: didn't see a hand. ${o.controller.running ? "Hold it up in view" : "Turn Hands on first"}, then try again.`);
          return "no-hand";
        }
        bindings[name] ??= "select";
        save();
        render();
        const clash = library.clash(name);
        o.say(clash > 0.3
          ? `Gestures: learnt “${name}”, but it looks a lot like a shape that's already in use. Try something more distinct.`
          : `Gestures: learnt “${name}” (${got} frames). Pick what it does below.`);
        return clash > 0.3 ? "clash" : "ok";
      } finally {
        recording = false;
        recBtn.disabled = false;
        // the hand is still holding the shape it just showed: don't fire it until it changes
        arm(name);
      }
    },
  };

  recBtn.addEventListener("click", () => { void ui.record(nameIn.value).then((r) => { if (r === "ok" || r === "clash") nameIn.value = ""; }); });
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") recBtn.click(); });

  o.controller.on((events) => {
    for (const e of events) {
      if (e.type !== "pose") continue;
      const action = bindings[e.name] ?? "select";
      o.run(action, e.at, e.name);
      o.say(`Gestures: “${e.name}” → ${POSE_ACTIONS[action]}`);
    }
  });

  render();
  return ui;
}
