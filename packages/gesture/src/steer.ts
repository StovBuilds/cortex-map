// Head and gamepad controllers: a source (webcam face tracker / Gamepad API
// poll) → its recognizer → an adapter, plus a small HUD (reticle + a gauge of
// what it's reading). Each is independent of the hand controller, so any mix
// of hands, head, pad and mouse can drive the same adapter at once.

import { HeadRecognizer, type FaceFrame, type HeadOptions, type HeadState } from "./head";
import { FaceTracker, type FaceTrackerOptions } from "./faceTracker";
import { GamepadRecognizer, type PadFrame, type PadOptions, type PadState } from "./gamepad";
import { Dwell, type DwellOptions } from "./dwell";
import { Feedback } from "./feedback";
import type { GestureAdapter, GestureEvent, Target } from "./types";

const C = { line: "rgba(150,210,255,0.45)", hot: "#7fd6ff", grab: "#ffc062", reset: "#7dffb0", lock: "#e9f6ff", dim: "rgba(150,210,255,0.18)" };

/** What the reticle shows besides its colour: a lock on a target, and look-to-select progress. */
interface ReticleExtras { target?: Target | null; dwell?: number }

/** Reticle + gauge canvas. Pointer-events none; sits over the surface. */
class SteerHud {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label = "";
  constructor(private surface: HTMLElement, private corner: "left" | "right") {
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "2147482999" } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }
  flash(label: string) { this.label = label; window.setTimeout(() => { if (this.label === label) this.label = ""; }, 700); }
  begin(): { c: CanvasRenderingContext2D; W: number; H: number; reticle: (p: { x: number; y: number }, col: string, grab: boolean, x?: ReticleExtras) => void; gauge: { x: number; y: number } } {
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const r = this.surface.getBoundingClientRect();
    const reticle = (p: { x: number; y: number }, col: string, grab: boolean, extra: ReticleExtras = {}) => {
      const x = r.left + p.x * r.width, y = r.top + p.y * r.height;
      if (extra.target) {
        // locked on: corner brackets close in round the crosshair, the name below
        c.strokeStyle = C.lock; c.lineWidth = 2;
        const k = 22, l = 7;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.beginPath(); c.moveTo(x + sx * k, y + sy * (k - l)); c.lineTo(x + sx * k, y + sy * k); c.lineTo(x + sx * (k - l), y + sy * k); c.stroke();
        }
        if (extra.target.label && !this.label) text(c, extra.target.label, x, y + 44, C.lock);
      }
      if (extra.dwell) {
        c.strokeStyle = C.lock; c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + extra.dwell * Math.PI * 2); c.stroke();
      }
      c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, grab ? 10 : 14, 0, Math.PI * 2); c.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(x + dx * 18, y + dy * 18); c.lineTo(x + dx * 26, y + dy * 26); c.stroke(); }
      if (grab) { c.globalAlpha = 0.35; c.fillStyle = col; c.fill(); c.globalAlpha = 1; }
      if (this.label) text(c, this.label, x, y - 34, col);
    };
    // bottom centre, side by side: page corners usually hold the app's own panels
    const gauge = { x: this.corner === "left" ? W / 2 - 160 : W / 2 + 10, y: H - 30 - 120 };
    return { c, W, H, reticle, gauge };
  }
  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  dispose() { this.canvas.remove(); }
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, col: string, align: CanvasTextAlign = "center") {
  c.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  c.textAlign = align;
  c.fillStyle = "rgba(0,0,0,0.55)";
  const w = c.measureText(s).width + 10;
  const x0 = align === "center" ? x - w / 2 : align === "left" ? x - 5 : x - w + 5;
  c.fillRect(x0, y - 11, w, 16);
  c.fillStyle = col;
  c.fillText(s, x, y + 1);
}

function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  c.fillStyle = "rgba(4,8,16,0.72)";
  c.strokeStyle = C.dim; c.lineWidth = 1;
  c.beginPath(); c.roundRect(x, y, w, h, 8); c.fill(); c.stroke();
  c.font = "600 10px ui-sans-serif, system-ui, sans-serif"; c.textAlign = "left"; c.fillStyle = C.hot;
  c.fillText(title, x + 8, y + 14);
}

function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, v: number, mark: number | null, col: string, label: string) {
  c.fillStyle = C.dim; c.fillRect(x, y, w, 5);
  c.fillStyle = col; c.fillRect(x, y, w * Math.max(0, Math.min(1, v)), 5);
  if (mark != null) { c.fillStyle = "#fff"; c.fillRect(x + w * mark - 1, y - 2, 2, 9); }
  c.font = "10px ui-sans-serif, system-ui, sans-serif"; c.textAlign = "left"; c.fillStyle = "rgba(226,236,250,0.75)";
  c.fillText(label, x, y - 3);
}

type Listener<S> = (events: GestureEvent[], state: S) => void;

abstract class SteerBase<S> {
  protected listeners = new Set<Listener<S>>();
  protected hud: SteerHud | null;
  protected active = false;
  /** Target tracking + sounds. `feedback.sound.enabled` switches the sounds. */
  readonly feedback: Feedback;
  constructor(protected surface: HTMLElement, protected adapter: GestureAdapter, hud: boolean, corner: "left" | "right", sound: boolean) {
    this.hud = hud ? new SteerHud(surface, corner) : null;
    this.feedback = new Feedback(adapter, sound);
  }
  get running() { return this.active; }
  on(l: Listener<S>) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  protected dispatch(events: GestureEvent[], state: () => S) {
    for (const e of events) this.adapter.handle(e);
    this.feedback.after(events);
    // events the controller adds once the frame's own have landed (look-to-select)
    const more = this.after();
    for (const e of more) this.adapter.handle(e);
    this.feedback.after(more);
    const all = [...events, ...more];
    for (const e of all) {
      if (e.type === "select") this.hud?.flash(e.at.x < 0 ? "clear" : "select");
      if (e.type === "reset") this.hud?.flash("reset");
      if (e.type === "step") this.hud?.flash("hop");
    }
    const s = state();
    this.draw(s);
    for (const l of this.listeners) l(all, s);
  }
  protected after(): GestureEvent[] { return []; }
  protected abstract draw(s: S): void;
}

export interface HeadControllerOptions {
  surface: HTMLElement;
  adapter: GestureAdapter;
  hud?: boolean;
  head?: Partial<HeadOptions>;
  tracker?: FaceTrackerOptions;
  /** Look-to-select: hold the crosshair on something, head still. `{ ms: 0 }` turns it off. Needs an adapter that reports targets. */
  dwell?: Partial<DwellOptions>;
  /** Feedback sounds (off by default). */
  sound?: boolean;
}

export class HeadController extends SteerBase<HeadState> {
  readonly recognizer: HeadRecognizer;
  readonly tracker: FaceTracker;
  readonly dwell: Dwell;
  constructor(o: HeadControllerOptions) {
    super(o.surface, o.adapter, o.hud !== false, "left", !!o.sound);
    this.recognizer = new HeadRecognizer(o.head);
    this.tracker = new FaceTracker(o.tracker);
    this.dwell = new Dwell(o.dwell);
  }
  async start() { this.active = true; await this.tracker.start((f) => this.feed(f)); }
  async startOnVideo(src: string) { this.active = true; await this.tracker.startOnVideo(src, (f) => this.feed(f)); }
  private t = 0;
  private taps = new Set<(f: FaceFrame) => void>();
  /** Every frame as it arrives (to record it). Returns an unsubscribe. */
  onFrame(fn: (f: FaceFrame) => void) { this.taps.add(fn); return () => { this.taps.delete(fn); }; }
  feed(f: FaceFrame) { for (const fn of this.taps) fn(f); this.t = f.t; this.dispatch(this.recognizer.update(f), () => this.recognizer.state()); }
  protected after(): GestureEvent[] {
    const s = this.recognizer.state();
    // only while the head is resting: steering, a mouth press or a lost face pause it
    const busy = !s.present || s.calibrating || s.mode !== "idle" || s.mouthOpen || s.browHold > 0;
    return this.dwell.update(this.t, this.feedback.target, busy) ? [{ type: "select", at: s.reticle }] : [];
  }
  recenter() { this.recognizer.recenter(); }
  stop() {
    this.active = false;
    this.tracker.stop();
    for (const e of this.recognizer.clear()) this.adapter.handle(e);
    this.dwell.reset();
    this.feedback.clear();
    this.hud?.clear();
  }
  dispose() { this.stop(); this.tracker.dispose(); this.hud?.dispose(); this.listeners.clear(); }

  protected draw(s: HeadState) {
    if (!this.hud) return;
    const { c, reticle, gauge } = this.hud.begin();
    if (!s.present) {
      if (!this.active) return;
      panel(c, gauge.x, gauge.y, 150, 120, "HEAD");
      text(c, "look at the camera", gauge.x + 75, gauge.y + 64, C.line);
      return;
    }
    const col = s.mode === "grab" || s.mode === "pressing" ? C.grab : C.hot;
    reticle(s.reticle, col, s.mode === "grab", { target: this.feedback.target, dwell: this.dwell.progress });
    panel(c, gauge.x, gauge.y, 150, 120, s.calibrating ? "HEAD · hold still…" : `HEAD · ${s.mode === "grab" ? "grabbing" : s.mode}`);
    // the joystick: where your head points, with the deadzone box
    const o = this.recognizer.o;
    const bx = gauge.x + 10, by = gauge.y + 22, bw = 80, bh = 80;
    const sx = (v: number) => bx + bw / 2 + (v / o.fullAt.yaw) * (bw / 2);
    const sy = (v: number) => by + bh / 2 - (v / o.fullAt.pitch) * (bh / 2);
    c.strokeStyle = C.dim; c.strokeRect(bx, by, bw, bh);
    c.strokeStyle = C.line;
    c.strokeRect(sx(-o.deadzone.yaw), sy(o.deadzone.pitch), sx(o.deadzone.yaw) - sx(-o.deadzone.yaw), sy(-o.deadzone.pitch) - sy(o.deadzone.pitch));
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const dx = clamp(sx(s.yaw), bx, bx + bw), dy = clamp(sy(s.pitch), by, by + bh);
    c.fillStyle = col; c.beginPath(); c.arc(dx, dy, 5, 0, Math.PI * 2); c.fill();
    const gx = bx + bw + 10, gw = 40;
    bar(c, gx, by + 10, gw, s.jaw, o.mouthOn, s.mouthOpen ? C.grab : C.line, "mouth");
    bar(c, gx, by + 34, gw, s.brow, o.browOn, s.browHold ? C.reset : C.line, "brows");
    bar(c, gx, by + 58, gw, 0.5 + s.lean * 2, null, s.steer.zoom ? C.hot : C.line, "lean");
    if (s.browHold) {
      const r = this.surface.getBoundingClientRect();
      const x = r.left + s.reticle.x * r.width, y = r.top + s.reticle.y * r.height;
      c.strokeStyle = C.reset; c.lineWidth = 4;
      c.beginPath(); c.arc(x, y, 32, -Math.PI / 2, -Math.PI / 2 + s.browHold * Math.PI * 2); c.stroke();
      text(c, "hold to reset", x, y + 50, C.reset);
    }
  }
}

export interface GamepadControllerOptions {
  surface: HTMLElement;
  adapter: GestureAdapter;
  hud?: boolean;
  pad?: Partial<PadOptions>;
  /** Rumble on select / reset / hop, where the pad supports it. */
  rumble?: boolean;
  /** Feedback sounds (off by default). */
  sound?: boolean;
}

type Rumbler = { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> };

export class GamepadController extends SteerBase<PadState> {
  readonly recognizer: GamepadRecognizer;
  private raf = 0;
  private padName = "";
  constructor(private o: GamepadControllerOptions) {
    super(o.surface, o.adapter, o.hud !== false, "right", !!o.sound);
    this.recognizer = new GamepadRecognizer(o.pad);
  }
  get name() { return this.padName; }

  /** Start polling. Browsers only reveal a pad after a button is pressed on it. */
  start() {
    if (this.active) return;
    this.active = true;
    const tick = () => {
      if (!this.active) return;
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected) ?? null;
      this.padName = gp?.id ?? "";
      this.feed({ t: performance.now(), pad: gp ? { axes: gp.axes, buttons: gp.buttons.map((b) => b.value || (b.pressed ? 1 : 0)) } : null }, gp);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private taps = new Set<(f: PadFrame) => void>();
  /** Every frame as it arrives (to record it). Returns an unsubscribe. */
  onFrame(fn: (f: PadFrame) => void) { this.taps.add(fn); return () => { this.taps.delete(fn); }; }
  feed(f: PadFrame, gp?: Gamepad | null) {
    for (const fn of this.taps) fn(f);
    const events = this.recognizer.update(f);
    if (this.o.rumble !== false && gp && events.some((e) => e.type === "select" || e.type === "reset" || e.type === "step")) {
      (gp as unknown as { vibrationActuator?: Rumbler }).vibrationActuator?.playEffect?.("dual-rumble", { duration: 70, strongMagnitude: 0.25, weakMagnitude: 0.6 })?.catch(() => {});
    }
    this.dispatch(events, () => this.recognizer.state());
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    for (const e of this.recognizer.clear()) this.adapter.handle(e);
    this.feedback.clear();
    this.hud?.clear();
  }
  dispose() { this.stop(); this.hud?.dispose(); this.listeners.clear(); }

  protected draw(s: PadState) {
    if (!this.hud) return;
    const { c, reticle, gauge } = this.hud.begin();
    if (!s.connected) {
      if (!this.active) return;
      panel(c, gauge.x, gauge.y, 150, 120, "CONTROLLER");
      text(c, "press any button", gauge.x + 75, gauge.y + 64, C.line);
      return;
    }
    reticle(s.reticle, s.active ? C.hot : C.line, false, { target: this.feedback.target });
    panel(c, gauge.x, gauge.y, 150, 120, "CONTROLLER");
    const stick = (cx: number, cy: number, p: { x: number; y: number }, label: string) => {
      c.strokeStyle = C.dim; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 26, 0, Math.PI * 2); c.stroke();
      c.fillStyle = p.x || p.y ? C.hot : C.line; c.beginPath(); c.arc(cx + p.x * 26, cy + p.y * 26, 6, 0, Math.PI * 2); c.fill();
      c.font = "10px ui-sans-serif, system-ui, sans-serif"; c.textAlign = "center"; c.fillStyle = "rgba(226,236,250,0.75)"; c.fillText(label, cx, cy + 40);
    };
    stick(gauge.x + 40, gauge.y + 56, s.left, "fly");
    stick(gauge.x + 110, gauge.y + 56, s.right, "look");
    const zx = gauge.x + 75;
    c.fillStyle = C.dim; c.fillRect(zx - 2, gauge.y + 30, 4, 50);
    c.fillStyle = s.zoom ? C.grab : C.line;
    c.fillRect(zx - 2, gauge.y + 55 - Math.max(-1, Math.min(1, s.zoom)) * 25, 4, 4);
  }
}
