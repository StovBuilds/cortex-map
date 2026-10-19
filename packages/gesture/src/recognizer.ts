// Landmarks in, gesture events out. Pure and clock-driven (it only ever reads
// the frame timestamps), so recorded or synthetic sequences replay exactly.
//
// The gestures:
//   pinch + release quickly, without moving  → select (at where you pinched)
//   pinch + move                             → pan (grab the surface)
//   pinch with both hands                    → transform (zoom / rotate / pan)
//   pinch held still, then move              → pan with held: pick a thing up
//   both hands pinched + held still, then move → transform with held: pull apart
//   index + middle finger out, move          → draw a stroke (a loop selects inside it)
//   open palm held still                     → reset
//   any other hand pose                      → hover (a cursor)
//
// The feel is in the guards: One Euro smoothing on the cursor, hysteresis and
// a frame count on the pinch, a deadzone before a pinch becomes a drag, the
// position from just before the pinch closed for selects (closing the fingers
// drags the cursor), a hand that left a two-hand gesture has to let go before
// it can grab again, and a palm reset that needs a still, held hand.

import { OneEuro, type OneEuroOptions } from "./oneEuro";
import type { PoseLibrary } from "./poses";
import type {
  FrameInput, GestureEvent, HandInput, HandState, Landmark, Point, Pose, RecognizerState,
} from "./types";

export interface RecognizerOptions {
  /** Video frame width / height (pinch and pose maths are done undistorted). */
  videoAspect: number;
  /** Target surface width / height (two-hand angles and distances). */
  surfaceAspect: number;
  /** Selfie view: move your hand right, the cursor goes right. */
  mirror: boolean;
  /** The part of the (mirrored) camera frame that maps onto the whole surface. You can't reach the frame's edges comfortably. */
  activeArea: { x0: number; x1: number; y0: number; y1: number };
  /** Thumb-index gap ÷ palm size below which a pinch closes… */
  pinchOn: number;
  /** …and above which it opens again (hysteresis: no flicker in between). */
  pinchOff: number;
  /** Index fingertip distance from the wrist (÷ palm size) below which the hand is a fist, not a pinch. */
  pinchMinReach: number;
  /** Consecutive frames a pinch change must hold before it counts. */
  pinchFrames: number;
  /** A pinch released within this many ms, without dragging, is a select. */
  tapMaxMs: number;
  /** Cursor travel (surface units) before a pinch becomes a drag. */
  dragDeadzone: number;
  /** A pinch (one hand or both) held this still this long becomes a "held" grab. */
  holdMs: number;
  /** Air drawing: the pose may flicker away this long without ending the stroke. */
  drawGraceMs: number;
  /** …and must be held this long before a stroke starts (no accidental scribbles). */
  drawArmMs: number;
  /** Angle between index and middle finger (radians) for the drawing V. */
  drawSpread: number;
  /** A stroke whose end comes back within this (surface units) of its start, after travelling at least drawLoopMin, is a loop. */
  drawCloseDist: number;
  drawLoopMin: number;
  /** Two-hand deadzones before a transform starts: scale ratio, radians, surface units. */
  twoDeadzone: { scale: number; rotate: number; move: number };
  /** How long an open palm must be held still to reset. */
  palmHoldMs: number;
  /** Cursor speed (surface units / s) above which a palm doesn't count as held. */
  palmMaxSpeed: number;
  /** A hand that just appeared can't reset for this long (hands come into view open). */
  entryGraceMs: number;
  /** Minimum gap between resets. */
  resetCooldownMs: number;
  /** Selects use the cursor from this long before the pinch closed. */
  lookbackMs: number;
  /** A hand missing for longer than this is gone (shorter gaps are dropped frames). */
  lostMs: number;
  /** The dial: a fist (thumb tucked) held this long arms it… */
  dialArmMs: number;
  /** …and it starts once the fist has turned this far (radians). */
  dialDeadzone: number;
  /** A custom pose must be held this long before it fires (once per hold). */
  poseHoldMs: number;
  cursorFilter: OneEuroOptions;
}

export const DEFAULT_OPTIONS: RecognizerOptions = {
  videoAspect: 4 / 3,
  surfaceAspect: 16 / 9,
  mirror: true,
  activeArea: { x0: 0.14, x1: 0.86, y0: 0.12, y1: 0.8 },
  pinchOn: 0.3,
  pinchOff: 0.45,
  pinchMinReach: 1.05,
  pinchFrames: 2,
  tapMaxMs: 450,
  dragDeadzone: 0.022,
  holdMs: 520,
  drawGraceMs: 160,
  drawArmMs: 200,
  drawSpread: 0.28,
  drawCloseDist: 0.09,
  drawLoopMin: 0.35,
  twoDeadzone: { scale: 0.05, rotate: 0.08, move: 0.03 },
  palmHoldMs: 600,
  palmMaxSpeed: 0.45,
  entryGraceMs: 350,
  resetCooldownMs: 1500,
  lookbackMs: 120,
  lostMs: 180,
  poseHoldMs: 380,
  dialArmMs: 250,
  dialDeadzone: 0.14,
  cursorFilter: { minCutoff: 1.1, beta: 9, dCutoff: 1 },
};

// MediaPipe hand landmark indices
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9, MIDDLE_TIP = 12;
const FINGERS: [pip: number, tip: number][] = [[6, 8], [10, 12], [14, 16], [18, 20]];

interface Track {
  id: number;
  firstSeen: number;
  lastSeen: number;
  fx: OneEuro;
  fy: OneEuro;
  cursor: Point;
  rawWrist: Point;
  history: { t: number; x: number; y: number }[];
  tipWeight: number;
  speed: number;
  pinched: boolean;
  pinchCount: number;
  pinchAmount: number;
  pose: Pose;
  screenLandmarks: Point[];
  role: HandState["role"];
  pressStart: number;
  pressAnchor: Point;
  /** Cursor when the pinch was confirmed: the drag deadzone is measured from here, so the drift of closing the fingers never counts as a drag. */
  pressOrigin: Point;
  lastPan: Point;
  palmStart: number | null;
  palmHold: number;
  palmArmed: boolean;
  /** Last thumb-index gap ÷ palm size. */
  ratio: number;
  /** Pinch edge this frame, if the pinch just closed or opened. */
  edge: "down" | "up" | undefined;
  stroke: Point[];
  /** Last time this hand was in the draw pose, and when the current run of it began. */
  drawSeen: number;
  drawSince: number;
  /** Raw landmarks this frame (for custom poses and recording them). */
  lm: Landmark[];
  /** The custom pose being held, since when, and whether it has fired yet. */
  custom: string | null;
  customSince: number;
  customFired: boolean;
  quiet: string | null;
  quietSince: number;
  /** The dial: since when this hand has been a fist, its angle when armed, and the last angle reported. */
  fistSince: number;
  fistSeen: number;
  dial0: number | null;
  dialLast: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class GestureRecognizer {
  readonly o: RecognizerOptions;
  private tracks: Track[] = [];
  private nextId = 1;
  private mode: RecognizerState["mode"] = "idle";
  private lastT = 0;
  private lastReset = -Infinity;
  private hoverShown = false;
  private poses: PoseLibrary | null = null;
  // two-hand bookkeeping
  private two: { a: number; b: number; d0: number; a0: number; m0: Point; d: number; ang: number; m: Point; engaged: boolean; t0: number } | null = null;

  constructor(opts: Partial<RecognizerOptions> = {}) {
    this.o = { ...DEFAULT_OPTIONS, ...opts, twoDeadzone: { ...DEFAULT_OPTIONS.twoDeadzone, ...opts.twoDeadzone } };
  }

  setSurfaceAspect(a: number) { if (a > 0 && Number.isFinite(a)) this.o.surfaceAspect = a; }
  setVideoAspect(a: number) { if (a > 0 && Number.isFinite(a)) this.o.videoAspect = a; }
  /** Recognise these custom poses too (null: none). */
  /**
   * quiet: a pose just recorded, which the hand is probably still holding. It
   * won't fire on the hands in view until each has gone a hold's length without it.
   */
  setPoses(lib: PoseLibrary | null, o: { quiet?: string } = {}) {
    this.poses = lib;
    if (o.quiet) for (const tr of this.tracks) { tr.quiet = o.quiet; tr.quietSince = this.lastT; }
  }

  /** Feed one tracker frame; returns the events it produced, in order. */
  update(frame: FrameInput): GestureEvent[] {
    const out: GestureEvent[] = [];
    const t = frame.t;
    const dt = this.lastT ? Math.max(1, t - this.lastT) : 33;
    this.lastT = t;

    this.match(frame.hands, t);
    // hands gone for good end whatever they were doing
    for (const tr of [...this.tracks]) {
      if (t - tr.lastSeen > this.o.lostMs) this.drop(tr, out);
    }

    for (const tr of this.tracks) tr.edge = undefined;
    const live = this.tracks.filter((tr) => tr.lastSeen === t);
    for (const tr of live) this.updatePinch(tr);

    this.runTwoHand(t, out);
    if (this.mode !== "two") for (const tr of this.tracks) this.runOneHand(tr, t, out);
    if (this.mode === "idle") for (const tr of this.tracks) this.runDraw(tr, t, out);
    for (const tr of [...this.tracks]) this.runDial(tr, t, out);
    for (const tr of live) this.runCustom(tr, t, out);
    for (const tr of live) this.runPalm(tr, t, dt, out);
    this.runHover(out);
    return out;
  }

  /** Forget everything (camera switched off): ends any gesture in progress. */
  clear(): GestureEvent[] {
    const out: GestureEvent[] = [];
    for (const tr of [...this.tracks]) this.drop(tr, out);
    if (this.hoverShown) { out.push({ type: "hover", at: null }); this.hoverShown = false; }
    return out;
  }

  state(): RecognizerState {
    return {
      mode: this.mode,
      hands: this.tracks.map((tr) => ({
        id: tr.id,
        cursor: { ...tr.cursor },
        pose: tr.pose,
        pinched: tr.pinched,
        pinchAmount: tr.pinchAmount,
        palmHold: tr.palmHold,
        screenLandmarks: tr.screenLandmarks,
        role: tr.role,
        stroke: tr.stroke,
        landmarks: tr.lm,
        custom: tr.custom,
        customHold: tr.custom && tr.custom === tr.quiet ? 0 : tr.custom && !tr.customFired ? clamp01((this.lastT - tr.customSince) / this.o.poseHoldMs) : tr.custom ? 1 : 0,
      })),
    };
  }

  // ── geometry ───────────────────────────────────────────────────────────────

  private toScreen(l: Landmark): Point {
    const { x0, x1, y0, y1 } = this.o.activeArea;
    const sx = this.o.mirror ? 1 - l.x : l.x;
    return { x: (sx - x0) / (x1 - x0), y: (l.y - y0) / (y1 - y0) };
  }

  /** Angle between two fingers (knuckle → tip each), in the video frame. */
  private fingerAngle(lm: Landmark[], a0: number, a1: number, b0: number, b1: number) {
    const ax = (lm[a1].x - lm[a0].x) * this.o.videoAspect, ay = lm[a1].y - lm[a0].y;
    const bx = (lm[b1].x - lm[b0].x) * this.o.videoAspect, by = lm[b1].y - lm[b0].y;
    return Math.abs(wrapAngle(Math.atan2(ay, ax) - Math.atan2(by, bx)));
  }

  /** Distance in the video frame, corrected for its aspect ratio. */
  private vdist(a: Landmark, b: Landmark) {
    return Math.hypot((a.x - b.x) * this.o.videoAspect, a.y - b.y);
  }

  /** Distance on the target surface, corrected for its aspect ratio. */
  private sdist(a: Point, b: Point) {
    return Math.hypot((a.x - b.x) * this.o.surfaceAspect, a.y - b.y);
  }

  private sangle(a: Point, b: Point) {
    return Math.atan2(b.y - a.y, (b.x - a.x) * this.o.surfaceAspect);
  }

  // ── tracking: keep a stable id per hand across frames ─────────────────────

  private match(hands: HandInput[], t: number) {
    const free = new Set(this.tracks);
    for (const h of hands) {
      if (!h.landmarks || h.landmarks.length < 21) continue;
      const w = this.toScreen(h.landmarks[WRIST]);
      let best: Track | null = null;
      let bestD = 0.35;
      for (const tr of free) {
        const d = Math.hypot(tr.rawWrist.x - w.x, tr.rawWrist.y - w.y);
        if (d < bestD) { bestD = d; best = tr; }
      }
      if (best) free.delete(best);
      const tr = best ?? this.newTrack(t);
      this.measure(tr, h.landmarks, t);
    }
  }

  private newTrack(t: number): Track {
    const tr: Track = {
      id: this.nextId++,
      firstSeen: t,
      lastSeen: t,
      fx: new OneEuro(this.o.cursorFilter),
      fy: new OneEuro(this.o.cursorFilter),
      cursor: { x: 0.5, y: 0.5 },
      rawWrist: { x: 0.5, y: 0.5 },
      history: [],
      tipWeight: 0,
      speed: 0,
      pinched: false,
      pinchCount: 0,
      pinchAmount: 0,
      pose: "other",
      screenLandmarks: [],
      role: "idle",
      pressStart: 0,
      pressAnchor: { x: 0, y: 0 },
      pressOrigin: { x: 0, y: 0 },
      lastPan: { x: 0, y: 0 },
      palmStart: null,
      palmHold: 0,
      palmArmed: true,
      ratio: 1,
      edge: undefined,
      stroke: [],
      drawSeen: 0,
      drawSince: 0,
      lm: [],
      custom: null,
      customSince: 0,
      customFired: false,
      quiet: null,
      quietSince: 0,
      fistSince: 0,
      fistSeen: 0,
      dial0: null,
      dialLast: 0,
    };
    this.tracks.push(tr);
    return tr;
  }

  private measure(tr: Track, lm: Landmark[], t: number) {
    const dt = tr.lastSeen === t ? 33 : Math.max(1, t - tr.lastSeen);
    const fresh = tr.history.length === 0;
    tr.lastSeen = t;
    tr.lm = lm;
    tr.screenLandmarks = lm.map((l) => this.toScreen(l));
    tr.rawWrist = tr.screenLandmarks[WRIST];

    const palm = Math.max(1e-4, this.vdist(lm[WRIST], lm[MIDDLE_MCP]));
    // A fist also brings thumb and index together; a real pinch keeps the
    // index reaching out from the palm. Treat a curled index as "not a pinch".
    const reach = this.vdist(lm[WRIST], lm[INDEX_TIP]) / palm;
    const ratio = reach < this.o.pinchMinReach ? 1 : this.vdist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm;
    tr.ratio = ratio;
    tr.pinchAmount = clamp01(1 - (ratio - this.o.pinchOn * 0.5) / (this.o.pinchOff * 2 - this.o.pinchOn * 0.5));

    const ext = FINGERS.map(([pip, tip]) => this.vdist(lm[WRIST], lm[tip]) > this.vdist(lm[WRIST], lm[pip]) * 1.1);
    const thumbReach = this.vdist(lm[THUMB_TIP], lm[INDEX_MCP]) / palm;
    const thumbOut = thumbReach > 0.5;
    const nExt = ext.filter(Boolean).length;
    const pose: Pose = tr.pinched ? "pinch"
      : nExt === 4 && thumbOut && ratio > this.o.pinchOff * 1.4 ? "open"
      : ext[0] && !ext[1] && !ext[2] && !ext[3] ? "point"
      // a V, not a loose hand: the two fingers clearly angled apart
      : ext[0] && ext[1] && !ext[2] && !ext[3] && this.fingerAngle(lm, INDEX_MCP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP) > this.o.drawSpread ? "draw"
      // a fist with the thumb tucked: a thumb sticking out (thumbs up) is a shape of its own
      : nExt === 0 && thumbReach < 0.7 ? "fist"
      : "other";
    tr.pose = pose;

    // Cursor anchor: the fingertip when pointing, the pinch point otherwise;
    // eased between the two so a pose change never makes the cursor jump.
    const target = pose === "point" || pose === "draw" ? 1 : 0;
    tr.tipWeight += (target - tr.tipWeight) * Math.min(1, dt / 120);
    const tip = tr.screenLandmarks[INDEX_TIP];
    const thumb = tr.screenLandmarks[THUMB_TIP];
    const mid = { x: (tip.x + thumb.x) / 2, y: (tip.y + thumb.y) / 2 };
    const raw = { x: mid.x + (tip.x - mid.x) * tr.tipWeight, y: mid.y + (tip.y - mid.y) * tr.tipWeight };
    const prev = tr.cursor;
    tr.cursor = { x: tr.fx.filter(raw.x, t), y: tr.fy.filter(raw.y, t) };
    if (!fresh) {
      const v = Math.hypot(tr.cursor.x - prev.x, tr.cursor.y - prev.y) / (dt / 1000);
      tr.speed += (v - tr.speed) * Math.min(1, dt / 100);
    }
    tr.history.push({ t, x: tr.cursor.x, y: tr.cursor.y });
    while (tr.history.length > 2 && t - tr.history[0].t > 500) tr.history.shift();
  }

  private cursorAt(tr: Track, t: number): Point {
    let p = tr.history[0];
    for (const h of tr.history) { if (h.t <= t) p = h; else break; }
    return p ? { x: p.x, y: p.y } : { ...tr.cursor };
  }

  // ── pinch with hysteresis ─────────────────────────────────────────────────

  private updatePinch(tr: Track) {
    const ratio = tr.ratio;
    const want = tr.pinched ? ratio < this.o.pinchOff : ratio < this.o.pinchOn;
    if (want !== tr.pinched) {
      tr.pinchCount++;
      if (tr.pinchCount >= this.o.pinchFrames) {
        tr.pinched = want;
        tr.pinchCount = 0;
        if (tr.pinched) tr.pose = "pinch";
        tr.edge = want ? "down" : "up";
        return;
      }
    } else {
      tr.pinchCount = 0;
    }
  }

  // ── one hand: tap = select, drag = pan ─────────────────────────────────────

  private runOneHand(tr: Track, t: number, out: GestureEvent[]) {
    const edge = tr.edge;
    if (tr.role === "blocked") {
      if (!tr.pinched) tr.role = "idle"; // let go — free again
      return;
    }
    if (edge === "down" && tr.role === "idle") {
      // only one hand drives a single-hand gesture at a time
      if (this.mode === "pan") { tr.role = "blocked"; return; }
      tr.role = "pressing";
      tr.pressStart = t;
      tr.pressAnchor = this.cursorAt(tr, t - this.o.lookbackMs - this.o.pinchFrames * 33);
      tr.pressOrigin = { ...tr.cursor };
      out.push({ type: "press", at: tr.pressAnchor });
      return;
    }
    if (tr.role === "pressing") {
      if (!tr.pinched) {
        tr.role = "idle";
        if (t - tr.pressStart <= this.o.tapMaxMs + this.o.pinchFrames * 33) out.push({ type: "select", at: tr.pressAnchor });
        return;
      }
      const moved = this.sdist(tr.cursor, tr.pressOrigin) > this.o.dragDeadzone;
      const held = !moved && t - tr.pressStart >= this.o.holdMs;
      if (moved || held) {
        tr.role = "panning";
        this.mode = "pan";
        // held: it picks up whatever was under the pinch when it closed
        const at = held ? { ...tr.pressAnchor } : { ...tr.cursor };
        tr.lastPan = { ...tr.cursor };
        out.push(held ? { type: "panstart", at, held: true } : { type: "panstart", at });
      }
      return;
    }
    if (tr.role === "panning") {
      if (!tr.pinched) {
        tr.role = "idle";
        this.mode = "idle";
        out.push({ type: "panend" });
        return;
      }
      const dx = tr.cursor.x - tr.lastPan.x;
      const dy = tr.cursor.y - tr.lastPan.y;
      tr.lastPan = { ...tr.cursor };
      if (dx || dy) out.push({ type: "pan", dx, dy, at: { ...tr.cursor } });
    }
  }

  // ── two hands: both pinched = zoom / rotate / pan ──────────────────────────

  private runTwoHand(t: number, out: GestureEvent[]) {
    if (this.two) {
      const a = this.tracks.find((x) => x.id === this.two!.a);
      const b = this.tracks.find((x) => x.id === this.two!.b);
      if (!a || !b || !a.pinched || !b.pinched || a.lastSeen !== t || b.lastSeen !== t) {
        if (a && b && (a.lastSeen !== t || b.lastSeen !== t) && a.pinched && b.pinched) return; // dropped frame: hold
        if (this.two.engaged) out.push({ type: "twoend" });
        for (const h of [a, b]) if (h) h.role = h.pinched ? "blocked" : "idle";
        this.two = null;
        this.mode = "idle";
        return;
      }
      const d = this.sdist(a.cursor, b.cursor);
      const ang = this.sangle(a.cursor, b.cursor);
      const m = { x: (a.cursor.x + b.cursor.x) / 2, y: (a.cursor.y + b.cursor.y) / 2 };
      const s = this.two;
      if (!s.engaged) {
        const dz = this.o.twoDeadzone;
        const moved = Math.abs(Math.log(d / s.d0)) > dz.scale || Math.abs(wrapAngle(ang - s.a0)) > dz.rotate
          || Math.hypot(m.x - s.m0.x, m.y - s.m0.y) > dz.move;
        const held = !moved && t - s.t0 >= this.o.holdMs;
        if (moved || held) {
          s.engaged = true;
          s.d = d; s.ang = ang; s.m = m; // start from here: no jump by the deadzone
          out.push(held ? { type: "twostart", at: m, held: true } : { type: "twostart", at: m });
        }
        return;
      }
      const ev: GestureEvent = {
        type: "transform",
        scale: d / Math.max(1e-4, s.d),
        rotate: wrapAngle(ang - s.ang),
        dx: m.x - s.m.x,
        dy: m.y - s.m.y,
        at: m,
      };
      s.d = d; s.ang = ang; s.m = m;
      out.push(ev);
      return;
    }
    const pinched = this.tracks.filter((x) => x.pinched && x.role !== "blocked" && x.lastSeen === t);
    if (pinched.length < 2) return;
    const [a, b] = pinched;
    if (this.mode === "pan") out.push({ type: "panend" });
    for (const h of this.tracks) if (h.role === "pressing" || h.role === "panning") h.role = "idle";
    a.role = "two"; b.role = "two";
    this.mode = "two";
    const d = this.sdist(a.cursor, b.cursor);
    const ang = this.sangle(a.cursor, b.cursor);
    const m = { x: (a.cursor.x + b.cursor.x) / 2, y: (a.cursor.y + b.cursor.y) / 2 };
    this.two = { a: a.id, b: b.id, d0: d, a0: ang, m0: m, d, ang, m, engaged: false, t0: t };
  }

  // ── air drawing: index + middle out ────────────────────────────────────────

  private runDraw(tr: Track, t: number, out: GestureEvent[]) {
    const drawing = tr.role === "drawing";
    if (tr.pose === "draw" && tr.lastSeen === t) {
      if (t - tr.drawSeen > this.o.drawGraceMs) tr.drawSince = t;
      tr.drawSeen = t;
    }
    if (!drawing) {
      if (tr.role !== "idle" || tr.pose !== "draw" || tr.lastSeen !== t || t - tr.drawSince < this.o.drawArmMs) return;
      tr.role = "drawing";
      tr.stroke = [{ ...tr.cursor }];
      out.push({ type: "draw", at: { ...tr.cursor } });
      return;
    }
    // a pinch takes over; a pose flicker shorter than the grace doesn't end it
    if (!tr.pinched && t - tr.drawSeen <= this.o.drawGraceMs) {
      if (tr.lastSeen === t && tr.pose === "draw") {
        const last = tr.stroke[tr.stroke.length - 1];
        if (Math.hypot(tr.cursor.x - last.x, tr.cursor.y - last.y) > 0.002) {
          tr.stroke.push({ ...tr.cursor });
          out.push({ type: "draw", at: { ...tr.cursor } });
        }
      }
      return;
    }
    this.endDraw(tr, out);
  }

  private endDraw(tr: Track, out: GestureEvent[]) {
    const path = tr.stroke;
    tr.stroke = [];
    tr.role = tr.pinched ? "blocked" : "idle";
    let len = 0;
    for (let i = 1; i < path.length; i++) len += this.sdist(path[i], path[i - 1]);
    const closed = path.length > 4 && len >= this.o.drawLoopMin && this.sdist(path[0], path[path.length - 1]) <= this.o.drawCloseDist;
    out.push({ type: "drawend", path, closed });
  }

  // ── custom poses: a recorded hand shape, held ───────────────────────────────

  private runCustom(tr: Track, t: number, out: GestureEvent[]) {
    // only a free hand, and never a shape the recogniser already means something by
    const free = this.poses && this.mode === "idle" && tr.role === "idle" && !tr.pinched
      && tr.pose === "other";
    const name = free ? this.poses!.match(tr.lm)?.name ?? null : null;
    if (name !== tr.custom) { tr.custom = name; tr.customSince = t; tr.customFired = false; }
    if (tr.quiet) {
      if (name === tr.quiet) tr.quietSince = t;
      else if (t - tr.quietSince >= this.o.poseHoldMs) tr.quiet = null;
      if (name === tr.quiet) return;
    }
    if (name && !tr.customFired && t - tr.customSince >= this.o.poseHoldMs) {
      tr.customFired = true;
      out.push({ type: "pose", name, at: { ...tr.cursor } });
    }
  }

  // ── the dial: a fist, turned like a knob ────────────────────────────────────

  /** The hand's roll on screen: wrist → middle knuckle, radians, + = clockwise. */
  private handAngle(tr: Track) {
    return this.sangle(tr.screenLandmarks[WRIST], tr.screenLandmarks[MIDDLE_MCP]);
  }

  private runDial(tr: Track, t: number, out: GestureEvent[]) {
    const isFist = tr.lastSeen === t && tr.pose === "fist";
    if (isFist) {
      if (t - tr.fistSeen > 150) tr.fistSince = t;
      tr.fistSeen = t;
    }
    if (tr.role === "dialing") {
      // a frame or two of a different pose doesn't end it; opening the hand does
      if (!isFist && t - tr.fistSeen > 150) { this.endDial(tr, out); return; }
      if (!isFist) return;
      const a = this.handAngle(tr);
      const d = wrapAngle(a - tr.dialLast);
      if (Math.abs(d) > 0.004) { tr.dialLast = a; out.push({ type: "dial", delta: d, angle: wrapAngle(a - tr.dial0!) }); }
      return;
    }
    if (!isFist || tr.role !== "idle" || this.mode === "two") { if (!isFist) tr.dial0 = null; return; }
    if (t - tr.fistSince < this.o.dialArmMs) return;
    const a = this.handAngle(tr);
    if (tr.dial0 === null) { tr.dial0 = a; return; }
    // armed: it starts when it turns, so a fist held still (or one that's just closing) does nothing
    if (Math.abs(wrapAngle(a - tr.dial0)) < this.o.dialDeadzone) return;
    tr.role = "dialing";
    tr.dialLast = a;
    out.push({ type: "dialstart", at: { ...tr.cursor } });
    out.push({ type: "dial", delta: wrapAngle(a - tr.dial0), angle: wrapAngle(a - tr.dial0) });
  }

  private endDial(tr: Track, out: GestureEvent[]) {
    tr.role = "idle";
    tr.dial0 = null;
    out.push({ type: "dialend" });
  }

  // ── open palm held still = reset ───────────────────────────────────────────

  private runPalm(tr: Track, t: number, dt: number, out: GestureEvent[]) {
    const eligible = tr.pose === "open" && tr.role === "idle" && this.mode === "idle"
      && t - tr.firstSeen >= this.o.entryGraceMs && tr.speed < this.o.palmMaxSpeed;
    if (tr.pose !== "open") tr.palmArmed = true;
    if (!eligible || !tr.palmArmed) { tr.palmStart = null; tr.palmHold = 0; return; }
    tr.palmStart ??= t - dt / 2;
    tr.palmHold = clamp01((t - tr.palmStart) / this.o.palmHoldMs);
    if (tr.palmHold >= 1 && t - this.lastReset >= this.o.resetCooldownMs) {
      out.push({ type: "reset" });
      this.lastReset = t;
      tr.palmArmed = false; // close the hand (or lower it) before another reset
      tr.palmStart = null;
      tr.palmHold = 0;
    }
  }

  // ── hover: the cursor of a free hand ──────────────────────────────────────

  private runHover(out: GestureEvent[]) {
    let at: Point | null = null;
    if (this.mode === "idle") {
      const free = this.tracks.filter((x) => x.role === "idle" && !x.pinched);
      const h = free.find((x) => x.pose === "point") ?? free[0];
      if (h) at = { ...h.cursor };
    }
    if (at) { out.push({ type: "hover", at }); this.hoverShown = true; }
    else if (this.hoverShown) { out.push({ type: "hover", at: null }); this.hoverShown = false; }
  }

  private drop(tr: Track, out: GestureEvent[]) {
    if (tr.role === "panning") { out.push({ type: "panend" }); this.mode = "idle"; }
    if (tr.role === "drawing") this.endDraw(tr, out);
    if (tr.role === "dialing") this.endDial(tr, out);
    if (this.two && (this.two.a === tr.id || this.two.b === tr.id)) {
      if (this.two.engaged) out.push({ type: "twoend" });
      const other = this.tracks.find((x) => x.id !== tr.id && (x.id === this.two!.a || x.id === this.two!.b));
      if (other) other.role = other.pinched ? "blocked" : "idle";
      this.two = null;
      this.mode = "idle";
    }
    this.tracks = this.tracks.filter((x) => x !== tr);
  }
}
