// Custom hand shapes: record a few seconds of a pose (thumbs up, rock horns,
// a "call me"), name it, and the recogniser reports it when a hand holds it.
// Nearest-neighbour over a canonical hand: wrist at the origin, palm-sized,
// left hands mirrored onto right ones. Not rotation-invariant on purpose: a
// thumbs up and a thumbs down are different gestures.
//
// The built-in shapes (open palm, point, pinch, fist, a relaxed hand, the V)
// sit in the library as negatives, so a custom pose has to look more like
// itself than like anything the recogniser already uses.

import type { Landmark } from "./types";
import { synthHand, type SynthPose } from "./synth";

export interface PoseSample { name: string; f: number[] }

export interface PoseMatch { name: string; distance: number }

export interface PoseLibraryOptions {
  /** Neighbours that vote. */
  k: number;
  /** A match must be at least this close (RMS landmark distance, in palm sizes). */
  maxDistance: number;
  /** Video width ÷ height, so features are measured undistorted. */
  videoAspect: number;
}

export const POSE_DEFAULTS: PoseLibraryOptions = { k: 5, maxDistance: 0.32, videoAspect: 16 / 9 };

/** Names starting with "_" are built-in shapes: they can win a vote, but never fire. */
export const BUILTIN = "_builtin";

const WRIST = 0, THUMB_CMC = 1, MIDDLE_MCP = 9, PINKY_MCP = 17;

/** The feature vector for one hand: 20 points relative to the wrist, in palm units, mirrored to a right hand. */
export function handFeature(lm: Landmark[], videoAspect = POSE_DEFAULTS.videoAspect): number[] {
  const w = lm[WRIST];
  const px = (l: Landmark) => (l.x - w.x) * videoAspect, py = (l: Landmark) => l.y - w.y;
  const palm = Math.max(1e-4, Math.hypot(px(lm[MIDDLE_MCP]), py(lm[MIDDLE_MCP])));
  // the thumb's side of the palm decides left vs right: flip so it's always on the left (−x)
  const across = px(lm[THUMB_CMC]) - px(lm[PINKY_MCP]);
  const up = { x: px(lm[MIDDLE_MCP]), y: py(lm[MIDDLE_MCP]) };
  // which way round the thumb sits depends on which way up the hand is: measure it across the palm's own axis
  const cross = up.x * (py(lm[THUMB_CMC]) - py(lm[PINKY_MCP])) - up.y * across;
  const flip = cross > 0 ? -1 : 1;
  const f: number[] = [];
  for (let i = 1; i < 21; i++) f.push((flip * px(lm[i])) / palm, py(lm[i]) / palm);
  return f;
}

function dist(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / (a.length / 2));
}

/** The built-in shapes at a few angles, as negatives. */
function builtins(videoAspect: number): PoseSample[] {
  const out: PoseSample[] = [];
  const poses: SynthPose[] = ["open", "point", "pinch", "fist", "relaxed", "draw"];
  const o = { activeArea: { x0: 0, x1: 1, y0: 0, y1: 1 }, mirror: false, videoAspect };
  for (const pose of poses) {
    for (const roll of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const pinch of pose === "pinch" ? [0.6, 1] : [1]) {
        out.push({ name: BUILTIN, f: handFeature(synthHand({ at: { x: 0.5, y: 0.5 }, pose, roll, pinch }, o), videoAspect) });
      }
    }
  }
  return out;
}

export class PoseLibrary {
  readonly o: PoseLibraryOptions;
  private samples: PoseSample[] = [];
  private negatives: PoseSample[];

  constructor(opts: Partial<PoseLibraryOptions> = {}) {
    this.o = { ...POSE_DEFAULTS, ...opts };
    this.negatives = builtins(this.o.videoAspect);
  }

  /** The custom pose names, in the order they were first recorded. */
  names(): string[] { return [...new Set(this.samples.map((s) => s.name))]; }

  count(name: string) { return this.samples.filter((s) => s.name === name).length; }

  /** Add one frame of a pose. Returns the closest built-in shape's distance, so a caller can warn about clashes. */
  add(name: string, lm: Landmark[]): number {
    const f = handFeature(lm, this.o.videoAspect);
    this.samples.push({ name, f });
    return Math.min(...this.negatives.map((n) => dist(n.f, f)));
  }

  remove(name: string) { this.samples = this.samples.filter((s) => s.name !== name); }

  rename(from: string, to: string) { for (const s of this.samples) if (s.name === from) s.name = to; }

  /**
   * How much a recorded pose looks like a built-in one: the share of its
   * samples that sit closer to a built-in shape than half the match radius.
   * Above ~0.3 it'll rarely fire, and a fist or a loose hand may look like it.
   */
  clash(name: string): number {
    const mine = this.samples.filter((s) => s.name === name);
    if (!mine.length) return 0;
    const near = mine.filter((s) => this.negatives.some((n) => dist(n.f, s.f) < this.o.maxDistance * 0.5));
    return near.length / mine.length;
  }

  /** The custom pose this hand is making, if any. */
  match(lm: Landmark[]): PoseMatch | null {
    if (!this.samples.length) return null;
    const f = handFeature(lm, this.o.videoAspect);
    const all = [...this.samples, ...this.negatives].map((s) => ({ name: s.name, d: dist(s.f, f) }));
    all.sort((a, b) => a.d - b.d);
    const near = all.slice(0, this.o.k);
    if (near[0].d > this.o.maxDistance) return null;
    // closer neighbours count for more
    const votes = new Map<string, number>();
    for (const n of near) votes.set(n.name, (votes.get(n.name) ?? 0) + 1 / (n.d + 0.02));
    let best = "", bestV = 0, total = 0;
    for (const [name, v] of votes) { total += v; if (v > bestV) { bestV = v; best = name; } }
    if (best === BUILTIN || bestV < total * 0.6) return null;
    return { name: best, distance: near.find((n) => n.name === best)!.d };
  }

  toJSON(): { v: 1; samples: { name: string; f: number[] }[] } {
    return { v: 1, samples: this.samples.map((s) => ({ name: s.name, f: s.f.map((x) => Math.round(x * 1000) / 1000) })) };
  }

  load(data: unknown) {
    const d = data as { v?: number; samples?: PoseSample[] } | null;
    if (!d || d.v !== 1 || !Array.isArray(d.samples)) return;
    this.samples = d.samples.filter((s) => typeof s?.name === "string" && Array.isArray(s.f) && s.f.length === 40 && !s.name.startsWith("_"));
  }
}
