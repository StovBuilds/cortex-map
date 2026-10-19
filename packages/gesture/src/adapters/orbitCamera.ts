// Gesture events → a three.js perspective camera orbiting a target point,
// y-up. Works with any scene: pass a function returning the live camera and
// target (OrbitControls.target, TrackballControls.target, or your own Vector3).
//
//   grab-drag      → slide the ground plane under your hand (it sticks to it)
//   two-hand pinch → spread = zoom, twist = turn the table, move = slide
//   orbit (head / gamepad) → turn, rise over the top / drop under, zoom, slide
//   flick (let go mid-move) → the table glides / spins on, slowing; press to catch it
//   view (head window mode) → the eye shifts off-centre, the scene stays put
//
// No three import: it only needs { position, up, fov, lookAt } and a target.

import type { GestureAdapter, GestureEvent, Point, Target } from "../types";
import { Momentum, cancelFrame, nextFrame, type MomentumOptions } from "../momentum";

export interface Vec3 { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

export interface OrbitView {
  camera: { position: Vec3; up: Vec3; fov: number; lookAt(x: number, y: number, z: number): void };
  target: Vec3;
  element: HTMLElement;
  /** Called after every camera change (re-render / re-sync controls). */
  sync?(): void;
  wake?(holdMs?: number): void;
}

export interface OrbitAdapterOptions {
  getView: () => OrbitView | null;
  /** Pan gain: 1 = the ground under your hand follows it exactly. */
  panGain?: number;
  /** Zoom gain: exponent on the two-hand spread ratio. */
  zoomGain?: number;
  /** Rotate gain on the two-hand twist. */
  rotateGain?: number;
  /** Camera-target distance limits, as multiples of the distance when first used. */
  minDistance?: number;
  maxDistance?: number;
  /** Highest / lowest the camera may orbit, radians above / below the target. Default 1.48 (~85°). */
  maxElevation?: number;
  /** Return what the point landed on (if anything) to enable target feedback and look-to-select. */
  onHover?: (at: Point | null, px: { x: number; y: number } | null) => Target | null | void;
  onSelect?: (at: Point, px: { x: number; y: number }) => void;
  onReset?: () => void;
  /** A spoken command about the content (see the "command" event). */
  onCommand?: (c: import("../voiceCommands").VoiceCommand) => void;
  /** A d-pad hop (see the "step" event). Nothing moves unless you handle it. */
  onStep?: (dir: { dx: number; dy: number }) => void;
  /** Flick to glide / spin. false turns it off. */
  momentum?: Partial<MomentumOptions> | false;
  /** Window mode: how far the eye moves for a full head shift, as a fraction of the camera's distance. Default 0.35. */
  windowGain?: number;
}

export function createOrbitAdapter(o: OrbitAdapterOptions): GestureAdapter {
  const panGain = o.panGain ?? 1;
  const zoomGain = o.zoomGain ?? 1.4;
  const rotateGain = o.rotateGain ?? 1.2;
  let baseDist = 0;
  let hovered: Target | null = null;
  const momentum = o.momentum === false ? null : new Momentum(o.momentum || {});
  let glideRaf = 0;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  // window mode: the eye offset currently added to the camera (world units), taken
  // off before anything else moves the camera and put back after
  let eye = { x: 0, y: 0, z: 0 };
  let eyeWant = { x: 0, y: 0, z: 0 };
  let eyeHoldUntil = 0;

  const toPx = (v: OrbitView, p: Point) => {
    const r = v.element.getBoundingClientRect();
    return { x: p.x * r.width, y: p.y * r.height };
  };

  const pan = (v: OrbitView, dx: number, dy: number) => {
    const { camera, target, element } = v;
    const ox = camera.position.x - target.x, oy = camera.position.y - target.y, oz = camera.position.z - target.z;
    const dist = Math.hypot(ox, oy, oz);
    const r = element.getBoundingClientRect();
    const aspect = r.width / Math.max(1, r.height);
    const worldH = 2 * dist * Math.tan(((camera.fov || 50) * Math.PI) / 360);
    // ground-plane basis: forward (away from the camera) and right
    let fx = -ox, fz = -oz;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;
    // looking down steeply, a screen-height covers less ground than looking across
    const pitch = Math.max(0.35, Math.abs(oy) / (dist || 1));
    const mx = -dx * worldH * aspect * panGain;
    const mz = (dy * worldH * panGain) / pitch;
    const wx = rx * mx + fx * mz, wz = rz * mx + fz * mz;
    camera.position.set(camera.position.x + wx, camera.position.y, camera.position.z + wz);
    target.set(target.x + wx, target.y, target.z + wz);
  };

  const zoomRotate = (v: OrbitView, scale: number, rotate: number) => {
    const { camera, target } = v;
    let ox = camera.position.x - target.x, oy = camera.position.y - target.y, oz = camera.position.z - target.z;
    const dist = Math.hypot(ox, oy, oz) || 1;
    if (!baseDist) baseDist = dist;
    const next = Math.min(baseDist * (o.maxDistance ?? 4), Math.max(baseDist * (o.minDistance ?? 0.08), dist / Math.pow(scale, zoomGain)));
    const k = next / dist;
    ox *= k; oy *= k; oz *= k;
    // turn the table: orbit the camera about the vertical through the target
    const a = rotate * rotateGain;
    const c = Math.cos(a), s = Math.sin(a);
    const nx = ox * c + oz * s, nz = -ox * s + oz * c;
    camera.position.set(target.x + nx, target.y + oy, target.z + nz);
  };

  // rise over the top (+) or drop underneath (-): orbit about the horizontal
  // axis through the target, stopping short of straight up / down
  const elevate = (v: OrbitView, pitch: number) => {
    const { camera, target } = v;
    const ox = camera.position.x - target.x, oy = camera.position.y - target.y, oz = camera.position.z - target.z;
    const dist = Math.hypot(ox, oy, oz) || 1;
    const h = Math.hypot(ox, oz);
    const lim = o.maxElevation ?? 1.48;
    const el = Math.max(-lim, Math.min(lim, Math.atan2(oy, h) + pitch));
    // straight on, there's no horizontal direction to keep: use the view's
    const ux = h > 1e-6 ? ox / h : 0, uz = h > 1e-6 ? oz / h : 1;
    camera.position.set(target.x + ux * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + uz * Math.cos(el) * dist);
  };

  const commit = (v: OrbitView, hold = 900) => {
    v.camera.up.set(0, 1, 0);
    v.camera.lookAt(v.target.x, v.target.y, v.target.z);
    v.sync?.();
    v.wake?.(hold);
  };

  const stopGlide = () => { momentum?.stop(); if (glideRaf) cancelFrame(glideRaf); glideRaf = 0; };
  const glide = () => {
    glideRaf = 0;
    const v = o.getView();
    const m = momentum?.step(now());
    if (!v || !m) return;
    withEye(v, () => {
      if (m.zoom || m.rotate) zoomRotate(v, Math.exp(m.zoom), m.rotate);
      if (m.dx || m.dy) pan(v, m.dx, m.dy);
    });
    commit(v, 300);
    glideRaf = nextFrame(glide);
  };

  // the eye offset lives in the camera's own right / up / back axes
  const eyeBasis = (v: OrbitView) => {
    const { camera, target } = v;
    let bx = camera.position.x - target.x, by = camera.position.y - target.y, bz = camera.position.z - target.z;
    const dist = Math.hypot(bx, by, bz) || 1;
    bx /= dist; by /= dist; bz /= dist;
    // right = up × back, normalised; up' = back × right
    let rx = 1 * bz - 0 * by, ry = 0 * bx - 0 * bz, rz = 0 * by - 1 * bx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = by * rz - bz * ry, uy = bz * rx - bx * rz, uz = bx * ry - by * rx;
    return { dist, r: [rx, ry, rz], u: [ux, uy, uz], b: [bx, by, bz] };
  };
  const shiftEye = (v: OrbitView, sign: 1 | -1) => {
    if (!eye.x && !eye.y && !eye.z) return;
    const p = v.camera.position;
    p.set(p.x + sign * eye.x, p.y + sign * eye.y, p.z + sign * eye.z);
  };
  /** Run a camera move on the "real" (un-shifted) camera, then re-apply the eye. */
  const withEye = (v: OrbitView, f: () => void) => {
    shiftEye(v, -1);
    f();
    placeEye(v);
  };
  const placeEye = (v: OrbitView) => {
    if (now() < eyeHoldUntil) return;
    const B = eyeBasis(v);
    const k = (o.windowGain ?? 0.35) * B.dist;
    const w = eyeWant;
    // moving right shows more of the left side: the eye goes right, still looking at the target
    eye = {
      x: (B.r[0] * w.x + B.u[0] * w.y - B.b[0] * w.z * 0.6) * k,
      y: (B.r[1] * w.x + B.u[1] * w.y - B.b[1] * w.z * 0.6) * k,
      z: (B.r[2] * w.x + B.u[2] * w.y - B.b[2] * w.z * 0.6) * k,
    };
    shiftEye(v, 1);
  };

  // the app's own camera flights (reset, fly-to) set the camera outright: take the
  // eye off first and keep it off until they land
  const dropEye = (v: OrbitView | null) => {
    if (v) shiftEye(v, -1);
    eye = { x: 0, y: 0, z: 0 };
    eyeHoldUntil = now() + 1400;
  };
  // camera moves made by this adapter: done on the real camera, eye put back after
  const MOVES = new Set<GestureEvent["type"]>(["pan", "transform", "orbit", "panstart", "twostart", "dial"]);

  const move = (v: OrbitView | null, e: GestureEvent) => {
    switch (e.type) {
      case "press":
        stopGlide();
        return;
      case "view":
        eyeWant = { x: e.x, y: e.y, z: e.z };
        if (!v || now() < eyeHoldUntil) return;
        shiftEye(v, -1);
        placeEye(v);
        commit(v, 600);
        return;
      case "hover":
        hovered = o.onHover?.(e.at, e.at && v ? toPx(v, e.at) : null) ?? null;
        return;
      case "command":
        stopGlide();
        dropEye(v);
        o.onCommand?.(e.command);
        return;
      case "step":
        stopGlide();
        dropEye(v);
        o.onStep?.({ dx: e.dx, dy: e.dy });
        return;
      case "select":
        stopGlide();
        if (!v) return;
        dropEye(v); // a second select flies there
        o.onSelect?.(e.at, toPx(v, e.at));
        return;
      case "reset":
        stopGlide();
        dropEye(v);
        o.onReset?.();
        return;
      case "panstart":
      case "twostart":
        stopGlide();
        if (v) { const d = Math.hypot(v.camera.position.x - v.target.x, v.camera.position.y - v.target.y, v.camera.position.z - v.target.z); if (!baseDist) baseDist = d; v.wake?.(1500); }
        return;
      case "dialstart":
        stopGlide();
        return;
      case "dial":
        // with nothing to scrub, the dial is a zoom knob: clockwise = in
        if (!v) return;
        zoomRotate(v, Math.exp(e.delta * 0.8), 0);
        return;
      case "pan":
        if (!v) return;
        momentum?.sample(now(), { dx: e.dx, dy: e.dy });
        pan(v, e.dx, e.dy);
        return;
      case "transform":
        if (!v) return;
        momentum?.sample(now(), { dx: e.dx, dy: e.dy, rotate: e.rotate, zoom: Math.log(e.scale || 1) });
        zoomRotate(v, e.scale, e.rotate);
        pan(v, e.dx, e.dy);
        return;
      case "orbit":
        if (!v) return;
        if (!baseDist) baseDist = Math.hypot(v.camera.position.x - v.target.x, v.camera.position.y - v.target.y, v.camera.position.z - v.target.z);
        stopGlide();
        // the speed knobs (gains) apply to steering too
        if (e.zoom || e.yaw) zoomRotate(v, Math.exp(e.zoom), e.yaw);
        if (e.pitch) elevate(v, e.pitch);
        if (e.dx || e.dy) pan(v, e.dx, e.dy);
        return;
      case "panend":
      case "twoend":
        v?.wake?.(1200);
        if (momentum?.release(now()) && !glideRaf) glideRaf = nextFrame(glide);
        return;
    }
  };

  return {
    handle(e: GestureEvent) {
      const v = o.getView();
      if (v && MOVES.has(e.type)) {
        withEye(v, () => move(v, e));
        commit(v, e.type === "orbit" ? 600 : 900);
        return;
      }
      move(v, e);
    },
    detach() {
      stopGlide();
      const v = o.getView();
      if (v && (eye.x || eye.y || eye.z)) { shiftEye(v, -1); eye = { x: 0, y: 0, z: 0 }; commit(v); }
      eyeWant = { x: 0, y: 0, z: 0 };
      o.onHover?.(null, null); hovered = null;
    },
    target: () => hovered,
  };
}
