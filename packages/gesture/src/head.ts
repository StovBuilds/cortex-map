// Head control: your head is a joystick. Turn it and the view turns; tip it
// back and you rise over the top; tip it down and you drop under; lean in to
// zoom. Open your mouth to grab: while it's open your head drags the view
// instead of steering it ("holding it in your teeth"). A quick open-and-close
// selects whatever is under the reticle; eyebrows up and held resets.
//
// Pure data in, events out, like the hand recognizer: FaceFrames can come from
// the webcam (FaceTracker), a recording, or a synthetic test sequence.

import { OneEuro } from "./oneEuro";
import type { GestureEvent, Point } from "./types";

/** One face reading. Angles in radians, relative to the camera. */
export interface FaceReading {
  /** + = the person turned to their own right. */
  yaw: number;
  /** + = the person tipped their head back (looking up). */
  pitch: number;
  roll: number;
  /** Distance to the camera, any unit (MediaPipe gives cm-ish). Smaller = closer. */
  distance: number;
  /** Head position across / up (any unit, cm-ish from MediaPipe; + = the person's own right, up). Window mode needs these. */
  x?: number;
  y?: number;
  /** 0..1 blendshape scores. */
  jawOpen: number;
  browUp: number;
}

export interface FaceFrame { t: number; face: FaceReading | null }

export interface HeadOptions {
  /**
   * "steer": your head is a joystick (turn = turn the view). "window": the
   * screen is a window into the scene; move your head to look round things.
   * The mouth, eyebrows and look-to-select work the same in both.
   */
  mode: "steer" | "window";
  /** Window mode: head movement (same unit as FaceReading.x) for a full ±1 shift. */
  windowRange: number;
  /** Ignore head angles smaller than this off neutral (radians). */
  deadzone: { yaw: number; pitch: number; lean: number };
  /** Angle (off neutral) that gives full speed. Lean is a fraction of the neutral distance. */
  fullAt: { yaw: number; pitch: number; lean: number };
  /** Full-speed rates, per second (radians, radians, log zoom). */
  rate: { yaw: number; pitch: number; zoom: number };
  /** Response curve exponent past the deadzone: >1 = fine control near centre. */
  curve: number;
  /** Mouth-grab drag: surface fraction per radian of head movement. */
  grabGain: number;
  /** jawOpen hysteresis. */
  mouthOn: number;
  mouthOff: number;
  /** A mouth open shorter than this with little movement is a select. */
  tapMaxMs: number;
  /** Head movement (radians) that turns a mouth-open into a grab. */
  grabDeadzone: number;
  /** Steering is paused this long after the mouth closes (closing it moves the head). */
  settleMs: number;
  /** Eyebrow rise over your resting level that counts as "up" (resting levels vary a lot by face). */
  browOn: number;
  browHoldMs: number;
  resetCooldownMs: number;
  /** How long to average the resting pose when a face first appears. */
  calibrateMs: number;
  /** Lost face for longer than this ends any grab. */
  lostMs: number;
  /** How often to re-send hover at the reticle (the view moves under it). */
  hoverEveryMs: number;
  /** Flip directions if they feel backwards. */
  invertYaw: boolean;
  invertPitch: boolean;
  /** Where the reticle sits (surface coords). */
  reticle: Point;
  filter: { minCutoff: number; beta: number; dCutoff: number };
}

export const HEAD_DEFAULTS: HeadOptions = {
  mode: "steer",
  windowRange: 12,
  deadzone: { yaw: 0.1, pitch: 0.09, lean: 0.07 },
  fullAt: { yaw: 0.42, pitch: 0.32, lean: 0.25 },
  rate: { yaw: 1.5, pitch: 1.1, zoom: 1.3 },
  curve: 1.5,
  grabGain: 1.6,
  mouthOn: 0.38,
  mouthOff: 0.22,
  tapMaxMs: 450,
  grabDeadzone: 0.035,
  settleMs: 350,
  browOn: 0.28,
  browHoldMs: 700,
  resetCooldownMs: 1500,
  calibrateMs: 600,
  lostMs: 300,
  hoverEveryMs: 100,
  invertYaw: false,
  invertPitch: false,
  reticle: { x: 0.5, y: 0.5 },
  filter: { minCutoff: 1.2, beta: 2, dCutoff: 1 },
};

export interface HeadState {
  present: boolean;
  calibrating: boolean;
  /** Head angles off neutral (radians), smoothed. */
  yaw: number;
  pitch: number;
  /** Lean off neutral, fraction of the resting distance (+ = closer). */
  lean: number;
  /** Steering output, -1..1 after deadzone + curve. */
  steer: { yaw: number; pitch: number; zoom: number };
  jaw: number;
  /** Eyebrow rise over the resting level. */
  brow: number;
  mouthOpen: boolean;
  mode: "idle" | "steer" | "pressing" | "grab";
  /** 0..1 progress of an eyebrow reset hold. */
  browHold: number;
  reticle: Point;
}

const shape = (v: number, dead: number, full: number, curve: number) => {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  const k = Math.min(1, (a - dead) / Math.max(1e-6, full - dead));
  return Math.sign(v) * Math.pow(k, curve);
};

export class HeadRecognizer {
  readonly o: HeadOptions;
  private fy: OneEuro; private fp: OneEuro; private fd: OneEuro;
  private neutral: { yaw: number; pitch: number; distance: number; brow: number; x: number; y: number } | null = null;
  private calib: { t0: number; n: number; yaw: number; pitch: number; distance: number; brow: number; x: number; y: number } | null = null;
  private fx: OneEuro; private fyy: OneEuro;
  private viewSent = false;
  private lastT = 0;
  private lastSeen = -Infinity;
  private s: HeadState;
  private press: { t: number; yaw: number; pitch: number; grabbing: boolean } | null = null;
  private settleUntil = 0;
  private browSince = 0;
  private cooldownUntil = 0;
  private lastHover = -Infinity;
  private prev = { yaw: 0, pitch: 0 };

  constructor(o: Partial<HeadOptions> = {}) {
    this.o = { ...HEAD_DEFAULTS, ...o, deadzone: { ...HEAD_DEFAULTS.deadzone, ...o.deadzone }, fullAt: { ...HEAD_DEFAULTS.fullAt, ...o.fullAt }, rate: { ...HEAD_DEFAULTS.rate, ...o.rate }, filter: { ...HEAD_DEFAULTS.filter, ...o.filter } };
    this.fy = new OneEuro(this.o.filter); this.fp = new OneEuro(this.o.filter); this.fd = new OneEuro(this.o.filter);
    this.fx = new OneEuro(this.o.filter); this.fyy = new OneEuro(this.o.filter);
    this.s = this.blank();
  }

  private blank(): HeadState {
    return { present: false, calibrating: false, yaw: 0, pitch: 0, lean: 0, steer: { yaw: 0, pitch: 0, zoom: 0 }, jaw: 0, brow: 0, mouthOpen: false, mode: "idle", browHold: 0, reticle: this.o.reticle };
  }

  /** Take the current pose as the new resting pose (next frames re-measure it). */
  recenter() { this.neutral = null; this.calib = null; }

  state(): HeadState { return { ...this.s, steer: { ...this.s.steer } }; }

  update(f: FaceFrame): GestureEvent[] {
    const ev: GestureEvent[] = [];
    const dt = this.lastT ? Math.min(0.1, Math.max(0, (f.t - this.lastT) / 1000)) : 0;
    this.lastT = f.t;
    const face = f.face;

    if (!face) {
      if (this.s.present && f.t - this.lastSeen > this.o.lostMs) ev.push(...this.clear());
      return ev;
    }
    this.lastSeen = f.t;
    if (!this.s.present) {
      this.s.present = true;
      this.fy.reset(); this.fp.reset(); this.fd.reset(); this.fx.reset(); this.fyy.reset();
    }

    const iy = this.o.invertYaw ? -1 : 1, ip = this.o.invertPitch ? -1 : 1;
    const yawRaw = this.fy.filter(face.yaw * iy, f.t);
    const pitchRaw = this.fp.filter(face.pitch * ip, f.t);
    const dist = this.fd.filter(face.distance, f.t);
    const hx = this.fx.filter(face.x ?? 0, f.t), hy = this.fyy.filter(face.y ?? 0, f.t);
    this.s.jaw = face.jawOpen;
    this.s.brow = face.browUp;

    // learn the resting pose: whatever the head does for the first moment
    if (!this.neutral) {
      if (!this.calib) this.calib = { t0: f.t, n: 0, yaw: 0, pitch: 0, distance: 0, brow: 0, x: 0, y: 0 };
      const c = this.calib;
      c.n++; c.yaw += yawRaw; c.pitch += pitchRaw; c.distance += dist; c.brow += face.browUp; c.x += hx; c.y += hy;
      this.s.calibrating = true;
      if (f.t - c.t0 < this.o.calibrateMs) return ev;
      this.neutral = { yaw: c.yaw / c.n, pitch: c.pitch / c.n, distance: c.distance / c.n, brow: c.brow / c.n, x: c.x / c.n, y: c.y / c.n };
      this.calib = null;
      this.s.calibrating = false;
      this.prev = { yaw: 0, pitch: 0 };
    }
    const n = this.neutral;
    const yaw = yawRaw - n.yaw, pitch = pitchRaw - n.pitch;
    const lean = n.distance ? (n.distance - dist) / Math.abs(n.distance) : 0;
    this.s.yaw = yaw; this.s.pitch = pitch; this.s.lean = lean;
    this.s.brow = face.browUp - n.brow;
    const dYaw = yaw - this.prev.yaw, dPitch = pitch - this.prev.pitch;
    this.prev = { yaw, pitch };

    // hover whatever is under the reticle, refreshed as the view moves under it
    if (f.t - this.lastHover >= this.o.hoverEveryMs) { this.lastHover = f.t; ev.push({ type: "hover", at: this.o.reticle }); }

    // eyebrows up, held: reset
    if (face.browUp - n.brow >= this.o.browOn && f.t >= this.cooldownUntil && !this.press) {
      if (!this.browSince) this.browSince = f.t;
      this.s.browHold = Math.min(1, (f.t - this.browSince) / this.o.browHoldMs);
      if (this.s.browHold >= 1) {
        ev.push({ type: "reset" });
        this.browSince = 0; this.s.browHold = 0;
        this.cooldownUntil = f.t + this.o.resetCooldownMs;
      }
    } else { this.browSince = 0; this.s.browHold = 0; }

    // the mouth: hysteresis, then tap (select) vs hold-and-move (grab)
    const open = this.s.mouthOpen ? face.jawOpen > this.o.mouthOff : face.jawOpen >= this.o.mouthOn;
    if (open && !this.s.mouthOpen) {
      this.press = { t: f.t, yaw, pitch, grabbing: false };
      ev.push({ type: "press", at: this.o.reticle });
    } else if (!open && this.s.mouthOpen && this.press) {
      if (this.press.grabbing) ev.push({ type: "panend" });
      else if (f.t - this.press.t <= this.o.tapMaxMs) ev.push({ type: "select", at: this.o.reticle });
      this.press = null;
      this.settleUntil = f.t + this.o.settleMs;
    }
    this.s.mouthOpen = open;

    this.s.steer = { yaw: 0, pitch: 0, zoom: 0 };
    if (this.press) {
      const p = this.press;
      if (!p.grabbing) {
        const moved = Math.hypot(yaw - p.yaw, pitch - p.pitch);
        if (moved > this.o.grabDeadzone || f.t - p.t > this.o.tapMaxMs) {
          p.grabbing = true;
          // held open without moving: pick up what's in the crosshair
          ev.push(moved > this.o.grabDeadzone ? { type: "panstart", at: this.o.reticle } : { type: "panstart", at: this.o.reticle, held: true });
        }
      }
      if (p.grabbing && (dYaw || dPitch)) {
        // turn right → the view slides right with you; tip back → it rises
        const g = this.o.grabGain;
        ev.push({ type: "pan", dx: dYaw * g, dy: -dPitch * g, at: this.o.reticle });
      }
      this.s.mode = p.grabbing ? "grab" : "pressing";
      return ev;
    }

    const o = this.o;
    if (o.mode === "window") {
      // the eye moves; the scene stays put behind the glass
      const r = o.windowRange || 1;
      const lim = (v: number) => Math.max(-1.5, Math.min(1.5, v));
      ev.push({ type: "view", x: lim((hx - n.x) / r), y: lim((hy - n.y) / r), z: lim(lean / Math.max(0.05, o.fullAt.lean)) });
      this.viewSent = true;
      this.s.mode = "idle";
      return ev;
    }
    if (this.viewSent) { ev.push({ type: "view", x: 0, y: 0, z: 0 }); this.viewSent = false; }
    if (f.t < this.settleUntil) { this.s.mode = "idle"; return ev; }
    const steer = {
      yaw: shape(yaw, o.deadzone.yaw, o.fullAt.yaw, o.curve),
      pitch: shape(pitch, o.deadzone.pitch, o.fullAt.pitch, o.curve),
      zoom: shape(lean, o.deadzone.lean, o.fullAt.lean, o.curve),
    };
    this.s.steer = steer;
    this.s.mode = steer.yaw || steer.pitch || steer.zoom ? "steer" : "idle";
    if (dt && this.s.mode === "steer") {
      ev.push({ type: "orbit", yaw: steer.yaw * o.rate.yaw * dt, pitch: steer.pitch * o.rate.pitch * dt, zoom: steer.zoom * o.rate.zoom * dt, dx: 0, dy: 0 });
    }
    return ev;
  }

  /** End anything in progress (face lost, control switched off). */
  clear(): GestureEvent[] {
    const ev: GestureEvent[] = [];
    if (this.press?.grabbing) ev.push({ type: "panend" });
    if (this.viewSent) { ev.push({ type: "view", x: 0, y: 0, z: 0 }); this.viewSent = false; }
    if (this.s.present) ev.push({ type: "hover", at: null });
    this.press = null;
    this.browSince = 0;
    this.lastT = 0;
    this.s = this.blank();
    return ev;
  }
}

