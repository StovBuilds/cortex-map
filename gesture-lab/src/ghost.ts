// "Ghost hands": a scripted, synthetic performance of every gesture, fed
// through the real recognizer and adapter. Lets the pages be tried without a
// camera, and is what the headless end-to-end test drives.

import { synthHand, type SynthPose, type FaceReading, type GamepadController, type GestureController, type HeadController, type Point, type SynthHand } from "cortex-gesture";

type Step = { ms: number; at: (k: number) => SynthHand[] };
const lerp = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const ease = (k: number) => k * k * (3 - 2 * k);

export function ghostScript(target: Point | null, aspect: number): Step[] {
  const tgt = target ?? { x: 0.5, y: 0.45 };
  const start = { x: 0.25, y: 0.35 };
  const two = (sep: number, ang: number, pinch: number): SynthHand[] => {
    const c = { x: 0.5, y: 0.5 }, h = sep / 2;
    const off = { x: (Math.cos(ang) * h) / aspect, y: Math.sin(ang) * h };
    return [
      { at: { x: c.x - off.x, y: c.y - off.y }, pose: "pinch", pinch, palm: 0.12, roll: 0.3 },
      { at: { x: c.x + off.x, y: c.y + off.y }, pose: "pinch", pinch, palm: 0.12, roll: -0.3 },
    ];
  };
  const pin = (at: Point, pinch: number): SynthHand[] => [{ at, pose: "pinch", pinch, jitter: 0.01 }];
  return [
    // point and sweep onto a node: hover card appears
    { ms: 1400, at: (k) => [{ at: lerp(start, tgt, ease(k)), pose: "point", jitter: 0.01 }] },
    { ms: 500, at: () => [{ at: tgt, pose: "point", jitter: 0.01 }] },
    // pinch it: select
    { ms: 250, at: (k) => pin(tgt, 0.2 * k) },
    { ms: 160, at: (k) => pin(tgt, 0.3 + 0.7 * k) },
    { ms: 200, at: () => pin(tgt, 1) },
    { ms: 250, at: () => pin(tgt, 0) },
    { ms: 900, at: (k) => [{ at: lerp(tgt, { x: 0.35, y: 0.6 }, ease(k)), pose: "relaxed", jitter: 0.01 }] },
    // grab and drag
    { ms: 200, at: (k) => pin({ x: 0.35, y: 0.6 }, k) },
    { ms: 1400, at: (k) => pin(lerp({ x: 0.35, y: 0.6 }, { x: 0.62, y: 0.5 }, ease(k)), 1) },
    { ms: 300, at: () => pin({ x: 0.62, y: 0.5 }, 0) },
    // both hands: spread to zoom, then twist
    { ms: 400, at: () => two(0.32, 0, 0) },
    { ms: 200, at: (k) => two(0.32, 0, k) },
    { ms: 1400, at: (k) => two(0.32 + 0.3 * ease(k), 0, 1) },
    { ms: 1400, at: (k) => two(0.62, 0.55 * ease(k), 1) },
    { ms: 300, at: () => two(0.62, 0.55, 0) },
    // open palm held still: reset
    { ms: 1500, at: () => [{ at: { x: 0.5, y: 0.5 }, pose: "open" }] },
    { ms: 400, at: () => [] },
  ];
}

/** Where the map tricks happen: a node, one it links to, and a free spot to pin a card. */
export interface MapSpots { node: Point; nodeId?: string; linked: Point | null; pinTo: Point }

/** Map tricks: pull a node out as a card, draw to a linked node, loop round it, pull its cluster apart, reset. */
export function mapGhostScript(s: MapSpots, aspect: number): Step[] {
  const { node, linked, pinTo } = s;
  const pin = (at: Point, pinch: number): SynthHand[] => [{ at, pose: "pinch", pinch, jitter: 0.006 }];
  const two = (half: number, pinch: number): SynthHand[] => [
    { at: { x: node.x - half / aspect, y: node.y }, pose: "pinch", pinch, palm: 0.12, roll: 0.3 },
    { at: { x: node.x + half / aspect, y: node.y }, pose: "pinch", pinch, palm: 0.12, roll: -0.3 },
  ];
  const loop = (k: number): Point => {
    const a = -Math.PI / 2 + k * Math.PI * 2.08; // a touch past the start, so it closes
    return { x: node.x + (0.16 * Math.cos(a)) / aspect, y: node.y + 0.16 * Math.sin(a) };
  };
  const draw = (at: Point): SynthHand[] => [{ at, pose: "draw", jitter: 0.004 }];
  const steps: Step[] = [
    // pinch the node and hold still: it lifts out; carry it off and let go
    { ms: 700, at: (k) => [{ at: lerp({ x: 0.3, y: 0.3 }, node, ease(k)), pose: "point" }] },
    { ms: 400, at: () => [{ at: node, pose: "point" }] },
    { ms: 200, at: (k) => pin(node, k) },
    { ms: 800, at: () => pin(node, 1) },
    { ms: 1100, at: (k) => pin(lerp(node, pinTo, ease(k)), 1) },
    { ms: 250, at: () => pin(pinTo, 0) },
    { ms: 500, at: () => [] },
  ];
  if (linked) steps.push(
    // a V of two fingers from the node to one it links to: the chain lights up
    { ms: 400, at: () => draw(node) },
    { ms: 1200, at: (k) => draw(lerp(node, linked, ease(k))) },
    { ms: 300, at: () => draw(linked) },
    { ms: 400, at: () => [{ at: linked, pose: "relaxed" }] },
    { ms: 500, at: () => [] },
  );
  steps.push(
    // round the node: a loop lights up everything inside
    { ms: 400, at: () => draw(loop(0)) },
    { ms: 1800, at: (k) => draw(loop(k)) },
    { ms: 400, at: () => [{ at: loop(1), pose: "relaxed" }] },
    { ms: 500, at: () => [] },
    // both hands on the cluster, held still, then spread: it comes apart
    { ms: 300, at: () => two(0.06, 0) },
    { ms: 200, at: (k) => two(0.06, k) },
    { ms: 800, at: () => two(0.06, 1) },
    { ms: 1300, at: (k) => two(0.06 + 0.14 * ease(k), 1) },
    { ms: 250, at: () => two(0.2, 0) },
    { ms: 800, at: () => [] },
    // a fist turned back like a knob: the map as it was a few months ago
    ...dialGhostScript(-0.9, { x: 0.5, y: 0.6 }),
    { ms: 1500, at: () => [{ at: { x: 0.5, y: 0.5 }, pose: "open" }] },
    { ms: 400, at: () => [] },
  );
  return steps;
}

/**
 * Play a script into a controller at 30 fps. Time is VIRTUAL (33 ms a frame,
 * whatever the wall clock does), so a busy main thread slows the show down
 * but never skips or squashes a gesture. Resolves when done.
 */
/** A fist turned like a knob by `turn` radians (+ = clockwise on screen: forward in time / zoom in), then opened. */
export function dialGhostScript(turn: number, at: Point = { x: 0.5, y: 0.55 }): Step[] {
  return [
    { ms: 300, at: () => [{ at, pose: "relaxed", jitter: 0.004 }] },
    { ms: 450, at: () => [{ at, pose: "fist", jitter: 0.004 }] },
    { ms: 1600, at: (k) => [{ at, pose: "fist", roll: turn * ease(k), jitter: 0.004 }] },
    { ms: 700, at: () => [{ at, pose: "fist", roll: turn, jitter: 0.004 }] },
    { ms: 400, at: () => [{ at, pose: "relaxed", roll: turn, jitter: 0.004 }] },
    { ms: 300, at: () => [] },
  ];
}

/** One hand holding a shape (for recording or trying a custom gesture), drifting a little so it isn't frozen. */
export function poseGhostScript(pose: SynthPose, ms: number, at: Point = { x: 0.5, y: 0.5 }, wobble = 1): Step[] {
  const w = wobble;
  return [
    { ms: 300, at: () => [{ at, pose: "relaxed", jitter: 0.01 }] },
    { ms, at: (k) => [{ at: { x: at.x + 0.05 * w * Math.sin(k * 7), y: at.y + 0.03 * w * Math.cos(k * 5) }, pose, roll: 0.12 * w * Math.sin(k * 4), jitter: 0.02 * Math.max(0.3, w) }] },
    { ms: 400, at: () => [{ at, pose: "relaxed", jitter: 0.01 }] },
  ];
}

export function playGhost(c: GestureController, steps: Step[], signal?: AbortSignal): Promise<void> {
  const FRAME = 1000 / 30;
  const total = steps.reduce((s, x) => s + x.ms, 0);
  return new Promise((resolve) => {
    let vt = 0;
    const t0 = performance.now();
    const iv = window.setInterval(() => {
      if (signal?.aborted || vt >= total) {
        window.clearInterval(iv);
        c.feed({ t: t0 + vt + 1000, hands: [] }); // let the hands go
        resolve();
        return;
      }
      let i = 0, into = vt;
      while (i < steps.length - 1 && into >= steps[i].ms) { into -= steps[i].ms; i++; }
      const hands = steps[i].at(Math.min(1, into / steps[i].ms));
      c.feed({ t: t0 + vt, hands: hands.map((h) => ({ landmarks: synthHand(h, c.recognizer.o) })) });
      vt += FRAME;
    }, FRAME);
  });
}

// ── head + gamepad ghosts: the same idea, synthetic face / pad readings ──────

type Seg<T> = { ms: number; at: (k: number) => T };

function playVirtual<T>(segs: Seg<T>[], feed: (t: number, v: T | null) => void, signal?: AbortSignal): Promise<void> {
  const FRAME = 1000 / 30;
  const total = segs.reduce((s, x) => s + x.ms, 0);
  return new Promise((resolve) => {
    let vt = 0;
    const t0 = performance.now();
    const iv = window.setInterval(() => {
      if (signal?.aborted || vt >= total) {
        window.clearInterval(iv);
        feed(t0 + vt + 1000, null);
        resolve();
        return;
      }
      let i = 0, into = vt;
      while (i < segs.length - 1 && into >= segs[i].ms) { into -= segs[i].ms; i++; }
      feed(t0 + vt, segs[i].at(Math.min(1, into / segs[i].ms)));
      vt += FRAME;
    }, FRAME);
  });
}

const REST: FaceReading = { yaw: 0, pitch: 0, roll: 0, distance: 50, jawOpen: 0.04, browUp: 0.1 };
const face = (p: Partial<FaceReading>): FaceReading => ({ ...REST, ...p });
const swing = (k: number) => Math.sin(k * Math.PI); // out and back

/** Head: settle, turn right, look up (over the top), look down, lean in, quick mouth = select, mouth-grab drag, brows = reset. */
export function headGhostScript(): Seg<FaceReading>[] {
  return [
    { ms: 900, at: () => face({}) },
    { ms: 1600, at: (k) => face({ yaw: 0.36 * swing(k) }) },
    { ms: 1400, at: (k) => face({ pitch: 0.3 * swing(k) }) },
    { ms: 1000, at: (k) => face({ pitch: -0.26 * swing(k) }) },
    { ms: 1200, at: (k) => face({ distance: 50 - 12 * swing(k) }) },
    { ms: 400, at: () => face({}) },
    { ms: 220, at: () => face({ jawOpen: 0.6 }) },
    { ms: 500, at: () => face({}) },
    { ms: 150, at: () => face({ jawOpen: 0.6 }) },
    { ms: 1000, at: (k) => face({ jawOpen: 0.6, yaw: -0.2 * k, pitch: 0.08 * k }) },
    { ms: 300, at: () => face({ yaw: -0.2, pitch: 0.08 }) },
    { ms: 700, at: (k) => face({ yaw: -0.2 * (1 - k), pitch: 0.08 * (1 - k) }) },
    { ms: 1100, at: () => face({ browUp: 0.8 }) },
    { ms: 400, at: () => face({}) },
  ];
}

export async function playHeadGhost(c: HeadController, signal?: AbortSignal) {
  // the script steers: show it in steer mode, whatever the panel is set to
  const mode = c.recognizer.o.mode;
  c.recognizer.o.mode = "steer";
  c.recenter();
  try { await playVirtual(headGhostScript(), (t, f) => c.feed({ t, face: f }), signal); }
  finally { c.recognizer.o.mode = mode; }
}

type Pad = { axes: number[]; buttons: number[] };
const pad = (ax: number[] = [0, 0, 0, 0], on: Record<number, number> = {}): Pad => ({ axes: ax, buttons: Array.from({ length: 17 }, (_, i) => on[i] ?? 0) });

/** Pad: turn with the right stick, fly over the top, slide with the left, zoom on RT, A select, Y reset. */
export function padGhostScript(): Seg<Pad>[] {
  return [
    { ms: 300, at: () => pad() },
    { ms: 1200, at: (k) => pad([0, 0, 0.8 * swing(k), 0]) },
    { ms: 1200, at: (k) => pad([0, 0, 0, -0.85 * swing(k)]) },
    { ms: 1000, at: (k) => pad([0.7 * swing(k), -0.4 * swing(k), 0, 0]) },
    { ms: 900, at: (k) => pad([0, 0, 0, 0], { 7: swing(k) }) },
    { ms: 300, at: () => pad() },
    { ms: 150, at: () => pad([0, 0, 0, 0], { 0: 1 }) },
    { ms: 600, at: () => pad() },
    { ms: 150, at: () => pad([0, 0, 0, 0], { 3: 1 }) },
    { ms: 1200, at: () => pad() },
  ];
}

export function playPadGhost(c: GamepadController, signal?: AbortSignal) {
  return playVirtual(padGhostScript(), (t, p) => c.feed({ t, pad: p }), signal);
}
