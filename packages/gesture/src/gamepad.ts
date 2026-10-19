// Gamepad control, standard layout (Xbox / PlayStation / most pads in a browser):
//
//   left stick     fly: slide across the map
//   right stick    look: turn left / right, rise over the top / drop under
//   RT / LT        zoom in / out (analog)       LB / RB  zoom in / out (digital)
//   A / ✕          select what's under the reticle (again: fly to it)
//   B / ○          clear the selection
//   Y / △, Start   reset the view
//   d-pad          hop to the linked node that way (where the content has links)
//
// Pure data in, events out: PadFrame comes from the Gamepad API (GamepadSource)
// or a test. Button indices follow the W3C "standard" mapping.

import type { GestureEvent, Point } from "./types";

export interface PadFrame {
  t: number;
  /** null = no pad connected. */
  pad: { axes: readonly number[]; buttons: readonly number[] } | null;
}

export interface PadOptions {
  /** Radial stick deadzone (0..1); the rest is rescaled to 0..1. */
  deadzone: number;
  /** Response curve exponent: >1 = fine control near centre. */
  curve: number;
  /** Full-tilt rates per second: pan (surface fractions), yaw / pitch (radians), zoom (log). */
  rate: { pan: number; yaw: number; pitch: number; zoom: number };
  /** Push the right stick up to rise over the top (false = flight-sim style). */
  invertY: boolean;
  /** Trigger value counted as "pressed". */
  trigger: number;
  hoverEveryMs: number;
  reticle: Point;
}

export const PAD_DEFAULTS: PadOptions = {
  deadzone: 0.16,
  curve: 1.7,
  rate: { pan: 0.9, yaw: 2.2, pitch: 1.5, zoom: 1.6 },
  invertY: false,
  trigger: 0.08,
  hoverEveryMs: 100,
  reticle: { x: 0.5, y: 0.5 },
};

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
/** A point off every surface: a select there clears the selection. */
export const NOWHERE: Point = { x: -10, y: -10 };

export interface PadState {
  connected: boolean;
  left: Point;
  right: Point;
  zoom: number;
  active: boolean;
  reticle: Point;
}

const stick = (x: number, y: number, dead: number, curve: number): Point => {
  const m = Math.hypot(x, y);
  if (m <= dead) return { x: 0, y: 0 };
  const k = Math.pow(Math.min(1, (m - dead) / (1 - dead)), curve) / m;
  return { x: x * k, y: y * k };
};

export class GamepadRecognizer {
  readonly o: PadOptions;
  private lastT = 0;
  private held: number[] = [];
  private lastHover = -Infinity;
  private s: PadState;

  constructor(o: Partial<PadOptions> = {}) {
    this.o = { ...PAD_DEFAULTS, ...o, rate: { ...PAD_DEFAULTS.rate, ...o.rate } };
    this.s = this.blank();
  }

  private blank(): PadState { return { connected: false, left: { x: 0, y: 0 }, right: { x: 0, y: 0 }, zoom: 0, active: false, reticle: this.o.reticle }; }

  state(): PadState { return { ...this.s }; }

  update(f: PadFrame): GestureEvent[] {
    const ev: GestureEvent[] = [];
    if (!f.pad) { if (this.s.connected) ev.push(...this.clear()); return ev; }
    const dt = this.lastT ? Math.min(0.1, Math.max(0, (f.t - this.lastT) / 1000)) : 0;
    this.lastT = f.t;
    const { axes, buttons } = f.pad;
    const b = (i: number) => buttons[i] ?? 0;
    const pressed = (i: number) => b(i) > 0.5 && !((this.held[i] ?? 0) > 0.5);
    const o = this.o;

    if (!this.s.connected) this.s.connected = true;
    const L = stick(axes[0] ?? 0, axes[1] ?? 0, o.deadzone, o.curve);
    const R = stick(axes[2] ?? 0, axes[3] ?? 0, o.deadzone, o.curve);
    const trig = (v: number) => (v > o.trigger ? (v - o.trigger) / (1 - o.trigger) : 0);
    const zoom = trig(b(PAD.RT)) - trig(b(PAD.LT)) + (b(PAD.RB) > 0.5 ? 1 : 0) - (b(PAD.LB) > 0.5 ? 1 : 0);
    this.s.left = L; this.s.right = R; this.s.zoom = zoom;
    this.s.active = !!(L.x || L.y || R.x || R.y || zoom);

    if (f.t - this.lastHover >= o.hoverEveryMs) { this.lastHover = f.t; ev.push({ type: "hover", at: o.reticle }); }

    if (dt && this.s.active) {
      const iy = o.invertY ? -1 : 1;
      ev.push({
        type: "orbit",
        // stick right: you fly right, so the map slides left under you
        dx: -L.x * o.rate.pan * dt,
        dy: -L.y * o.rate.pan * dt,
        yaw: R.x * o.rate.yaw * dt,
        // stick up (axis -1) rises over the top
        pitch: -R.y * iy * o.rate.pitch * dt,
        zoom: Math.max(-1, Math.min(1, zoom)) * o.rate.zoom * dt,
      });
    }

    if (pressed(PAD.A)) ev.push({ type: "select", at: o.reticle });
    if (pressed(PAD.B)) ev.push({ type: "select", at: NOWHERE });
    if (pressed(PAD.Y) || pressed(PAD.START)) ev.push({ type: "reset" });
    if (pressed(PAD.UP)) ev.push({ type: "step", dx: 0, dy: -1 });
    if (pressed(PAD.DOWN)) ev.push({ type: "step", dx: 0, dy: 1 });
    if (pressed(PAD.LEFT)) ev.push({ type: "step", dx: -1, dy: 0 });
    if (pressed(PAD.RIGHT)) ev.push({ type: "step", dx: 1, dy: 0 });
    this.held = buttons.slice();
    return ev;
  }

  clear(): GestureEvent[] {
    const ev: GestureEvent[] = this.s.connected ? [{ type: "hover", at: null }] : [];
    this.s = this.blank();
    this.lastT = 0;
    this.held = [];
    return ev;
  }
}
