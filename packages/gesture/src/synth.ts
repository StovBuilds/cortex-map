// Synthetic hands: plausible 21-point MediaPipe landmark sets for a given pose,
// position and size. Used by the tests, and by the demo's "ghost hands"
// replay so the pages can be driven with no camera (headless CI, a laptop
// with the camera off).

import type { Landmark, Point } from "./types";
import { DEFAULT_OPTIONS, type RecognizerOptions } from "./recognizer";

export type SynthPose = "open" | "point" | "pinch" | "relaxed" | "fist" | "draw" | "thumbsup" | "horns" | "call" | "three";

export interface SynthHand {
  /** Where the pinch point / fingertip should land, in SURFACE coords (0..1). */
  at: Point;
  pose: SynthPose;
  /** For "pinch": 0 = fingers apart (~0.9 palm), 1 = touching. Default 1. */
  pinch?: number;
  /** Palm size (wrist → middle knuckle) as a fraction of frame height. Default 0.14. */
  palm?: number;
  /** In-plane rotation, radians. */
  roll?: number;
  /** Per-landmark jitter, as a fraction of palm size. */
  jitter?: number;
}

type P2 = [number, number];
// Canonical hand, palm units, wrist at the origin, fingers up (-y).
const MCP: P2[] = [[-0.36, -0.95], [0, -1], [0.3, -0.95], [0.56, -0.84]];
const SPREAD = [-0.18, -0.04, 0.08, 0.2];

function finger(mcp: P2, spread: number, extended: boolean): P2[] {
  if (!extended) {
    // folded down into the palm
    return [[mcp[0], mcp[1] - 0.28], [mcp[0] + 0.02, mcp[1] - 0.1], [mcp[0] + 0.03, mcp[1] + 0.12]];
  }
  const dx = Math.sin(spread), dy = -Math.cos(spread);
  return [0.45, 0.75, 1.0].map((k) => [mcp[0] + dx * k, mcp[1] + dy * k] as P2);
}

function canonical(pose: SynthPose, pinch: number): P2[] {
  const pts: P2[] = new Array(21);
  pts[0] = [0, 0];
  const ext = pose === "open" ? [1, 1, 1, 1]
    : pose === "point" ? [1, 0, 0, 0]
    : pose === "fist" ? [0, 0, 0, 0]
    : pose === "pinch" ? [1, 1, 1, 1]
    : pose === "draw" ? [1, 1, 0, 0]
    : pose === "thumbsup" ? [0, 0, 0, 0]
    : pose === "horns" ? [1, 0, 0, 1]
    : pose === "call" ? [0, 0, 0, 1]
    : pose === "three" ? [1, 1, 1, 0]
    : [1, 1, 0, 0]; // relaxed: a loose, half-curled hand
  for (let f = 0; f < 4; f++) {
    const base = 5 + f * 4;
    pts[base] = MCP[f];
    // draw: index and middle out in a V
    const spread = pose === "open" ? SPREAD[f] * 1.6 : pose === "draw" && f < 2 ? [-0.3, 0.22][f] : SPREAD[f];
    const seg = finger(MCP[f], spread, !!ext[f]);
    pts[base + 1] = seg[0]; pts[base + 2] = seg[1]; pts[base + 3] = seg[2];
  }
  if (pose === "thumbsup") {
    // thumb straight up off a closed fist
    pts[1] = [-0.3, -0.22]; pts[2] = [-0.5, -0.5]; pts[3] = [-0.68, -1.0]; pts[4] = [-0.8, -1.6];
  } else if (pose === "call") {
    // thumb out sideways, pinky out: the "call me" hand
    pts[1] = [-0.35, -0.22]; pts[2] = [-0.65, -0.35]; pts[3] = [-0.92, -0.45]; pts[4] = [-1.15, -0.52];
  } else if (pose === "open") {
    pts[1] = [-0.35, -0.22]; pts[2] = [-0.62, -0.42]; pts[3] = [-0.84, -0.6]; pts[4] = [-1.02, -0.76];
  } else if (pose === "pinch") {
    // index bends toward the thumb; their tips meet at P, opened by `pinch`
    const P: P2 = [-0.52, -1.22];
    pts[6] = [-0.42, -1.34]; pts[7] = [-0.5, -1.36]; pts[8] = P;
    const gap = (1 - pinch) * 0.9 + 0.04;
    pts[1] = [-0.35, -0.22]; pts[2] = [-0.6, -0.5]; pts[3] = [-0.62, -0.85];
    pts[4] = [P[0] - gap * 0.7, P[1] + gap * 0.7];
  } else {
    // thumb tucked against the index knuckle / middle phalanx
    pts[1] = [-0.3, -0.22]; pts[2] = [-0.45, -0.45]; pts[3] = [-0.35, -0.65]; pts[4] = [-0.18, -0.72];
  }
  return pts;
}

let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
export function reseed(s: number) { seed = s; }

/** Convert a surface point to raw video coords under the recognizer's mapping. */
export function surfaceToVideo(p: Point, o: Pick<RecognizerOptions, "activeArea" | "mirror"> = DEFAULT_OPTIONS): Point {
  const { x0, x1, y0, y1 } = o.activeArea;
  const sx = x0 + p.x * (x1 - x0);
  return { x: o.mirror ? 1 - sx : sx, y: y0 + p.y * (y1 - y0) };
}

/** Build one hand's landmarks (raw video coords) whose cursor lands on `h.at`. */
export function synthHand(h: SynthHand, o: Pick<RecognizerOptions, "activeArea" | "mirror" | "videoAspect"> = DEFAULT_OPTIONS): Landmark[] {
  const palm = h.palm ?? 0.14;
  const pts = canonical(h.pose, h.pinch ?? 1);
  // the recognizer's cursor: index tip when pointing, pinch midpoint otherwise
  const anchor: P2 = h.pose === "point" || h.pose === "draw"
    ? pts[8]
    : [(pts[4][0] + pts[8][0]) / 2, (pts[4][1] + pts[8][1]) / 2];
  const roll = h.roll ?? 0;
  const c = Math.cos(roll), s = Math.sin(roll);
  const target = surfaceToVideo(h.at, o);
  const mirror = o.mirror ? -1 : 1;
  const j = h.jitter ?? 0;
  return pts.map(([x, y]) => {
    const lx = x - anchor[0], ly = y - anchor[1];
    const rx = (lx * c - ly * s) * palm, ry = (lx * s + ly * c) * palm;
    return {
      x: target.x + (mirror * rx) / o.videoAspect + (j ? rand() * j * palm / o.videoAspect : 0),
      y: target.y + ry + (j ? rand() * j * palm : 0),
      z: 0,
    };
  });
}
