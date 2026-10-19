// Record and replay: the landmark streams (hand points, head angles, pad
// sticks), never the video. A recording is plain JSON, small enough to save
// or send, and replays through the real recognisers, so a session can be
// watched again, shared as a bug report, or kept as a regression test.

import type { FrameInput } from "./types";
import type { FaceFrame } from "./head";
import type { PadFrame } from "./gamepad";

export interface Recording {
  v: 1;
  kind: "cortex-gesture-recording";
  recordedAt: string;
  /** Length, ms. */
  ms: number;
  /** Where it was recorded (free text: a page, an app). */
  where?: string;
  /** Frame times are ms from the start. */
  hands?: FrameInput[];
  head?: FaceFrame[];
  pad?: PadFrame[];
}

type Source<F> = { onFrame(fn: (f: F) => void): () => void };
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r1 = (v: number) => Math.round(v * 10) / 10;

export class Recorder {
  private t0 = 0;
  private offs: (() => void)[] = [];
  private rec: Recording | null = null;

  get recording() { return !!this.rec; }
  /** ms since start. */
  get elapsed() { return this.rec ? (typeof performance !== "undefined" ? performance.now() : Date.now()) - this.t0 : 0; }

  start(src: { hands?: Source<FrameInput>; head?: Source<FaceFrame>; pad?: Source<PadFrame> }, where?: string) {
    this.stop();
    this.t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const rec: Recording = { v: 1, kind: "cortex-gesture-recording", recordedAt: new Date().toISOString(), ms: 0, where };
    this.rec = rec;
    // frame clocks differ per source: time everything by this recorder's clock
    const at = () => r1((typeof performance !== "undefined" ? performance.now() : Date.now()) - this.t0);
    if (src.hands) {
      rec.hands = [];
      this.offs.push(src.hands.onFrame((f) => rec.hands!.push({
        t: at(),
        hands: f.hands.map((h) => ({ landmarks: h.landmarks.map((l) => ({ x: r4(l.x), y: r4(l.y), z: r4(l.z) })), ...(h.handedness ? { handedness: h.handedness } : {}) })),
      })));
    }
    if (src.head) {
      rec.head = [];
      this.offs.push(src.head.onFrame((f) => rec.head!.push({
        t: at(),
        face: f.face ? (Object.fromEntries(Object.entries(f.face).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v])) as FaceFrame["face"]) : null,
      })));
    }
    if (src.pad) {
      rec.pad = [];
      // pads are polled every frame: keep only the frames with a pad in them
      this.offs.push(src.pad.onFrame((f) => { if (f.pad) rec.pad!.push({ t: at(), pad: { axes: f.pad.axes.map(r4), buttons: f.pad.buttons.map(r4) } }); }));
    }
  }

  /** Stop and hand back what was recorded (null if nothing was). */
  stop(): Recording | null {
    for (const off of this.offs) off();
    this.offs = [];
    const rec = this.rec;
    this.rec = null;
    if (!rec) return null;
    rec.ms = r1(this.elapsedFrom(rec));
    for (const k of ["hands", "head", "pad"] as const) if (rec[k] && !rec[k]!.length) delete rec[k];
    return rec;
  }

  private elapsedFrom(rec: Recording) {
    const last = Math.max(0, ...[rec.hands, rec.head, rec.pad].map((a) => (a?.length ? a[a.length - 1].t : 0)));
    return Math.max(last, (typeof performance !== "undefined" ? performance.now() : Date.now()) - this.t0);
  }
}

/** Check a parsed file is a recording (throws with a reason if not). */
export function parseRecording(data: unknown): Recording {
  const d = data as Partial<Recording> | null;
  if (!d || d.kind !== "cortex-gesture-recording" || d.v !== 1) throw new Error("not a gesture recording");
  const ok = (a: unknown) => a === undefined || (Array.isArray(a) && a.every((f) => typeof f?.t === "number"));
  if (!ok(d.hands) || !ok(d.head) || !ok(d.pad)) throw new Error("recording frames are malformed");
  if (d.hands?.some((f) => !Array.isArray(f.hands) || f.hands.some((h) => !Array.isArray(h.landmarks) || h.landmarks.length !== 21))) throw new Error("hand frames need 21 landmarks each");
  return d as Recording;
}

export interface ReplaySinks {
  hands?: (f: FrameInput) => void;
  head?: (f: FaceFrame) => void;
  pad?: (f: PadFrame) => void;
}

/**
 * Play a recording into the controllers at its own pace (speed 2 = twice as
 * fast). Frame times are moved onto the current clock. Resolves when it's
 * done or `signal` aborts; either way the hands are let go of at the end.
 */
export function replay(rec: Recording, sinks: ReplaySinks, o: { signal?: AbortSignal; speed?: number; onProgress?: (k: number) => void } = {}): Promise<void> {
  type Item = { t: number; run: (base: number) => void };
  const items: Item[] = [];
  if (sinks.hands) for (const f of rec.hands ?? []) items.push({ t: f.t, run: (b) => sinks.hands!({ ...f, t: b + f.t }) });
  if (sinks.head) for (const f of rec.head ?? []) items.push({ t: f.t, run: (b) => sinks.head!({ ...f, t: b + f.t }) });
  if (sinks.pad) for (const f of rec.pad ?? []) items.push({ t: f.t, run: (b) => sinks.pad!({ ...f, t: b + f.t }) });
  items.sort((a, b) => a.t - b.t);
  const speed = o.speed ?? 1;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const start = now();
  // base on the frame clock: recorded t (ms from start) lands at base + t
  const base = start;
  let i = 0;
  return new Promise((resolve) => {
    const finish = () => {
      clearInterval(iv);
      const end = base + (rec.ms || (items.at(-1)?.t ?? 0)) + 500;
      sinks.hands?.({ t: end, hands: [] });
      sinks.head?.({ t: end, face: null });
      o.onProgress?.(1);
      resolve();
    };
    const iv = setInterval(() => {
      if (o.signal?.aborted) return finish();
      const vt = (now() - start) * speed;
      // run every frame that's due, in order (a slow tick catches up rather than skipping)
      while (i < items.length && items[i].t <= vt) items[i++].run(base);
      o.onProgress?.(rec.ms ? Math.min(1, vt / rec.ms) : 0);
      if (i >= items.length) finish();
    }, 8);
  });
}
