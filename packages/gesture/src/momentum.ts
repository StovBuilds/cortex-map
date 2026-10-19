// Flick to spin: let go of a grab while still moving and the view carries on,
// slowing down naturally. Pinch (or press) again to catch it. Pure: samples in,
// per-frame deltas out, so tests can drive it with a clock.

export interface MomentumOptions {
  /** Samples this recent (ms) count towards the release velocity. */
  windowMs: number;
  /** Decay time constants (s): how long a glide / spin / zoom carries on. */
  tau: { pan: number; rotate: number; zoom: number };
  /** Release speeds below these (per second) don't glide: you let go, you didn't flick. */
  min: { pan: number; rotate: number; zoom: number };
}

export const MOMENTUM_DEFAULTS: MomentumOptions = {
  windowMs: 110,
  tau: { pan: 0.32, rotate: 0.9, zoom: 0.25 },
  min: { pan: 0.25, rotate: 0.8, zoom: 0.6 },
};

/** One frame's motion: pan in surface fractions, rotate in radians, zoom as a log factor. */
export interface Motion { dx: number; dy: number; rotate: number; zoom: number }

export class Momentum {
  readonly o: MomentumOptions;
  private samples: { t: number; m: Motion }[] = [];
  private v: Motion | null = null;
  private lastT = 0;

  constructor(o: Partial<MomentumOptions> = {}) {
    this.o = { ...MOMENTUM_DEFAULTS, ...o, tau: { ...MOMENTUM_DEFAULTS.tau, ...o.tau }, min: { ...MOMENTUM_DEFAULTS.min, ...o.min } };
  }

  get moving() { return !!this.v; }

  /** Record a grab's movement (per event). Catches any glide in progress. */
  sample(t: number, m: Partial<Motion>) {
    this.v = null;
    this.samples.push({ t, m: { dx: 0, dy: 0, rotate: 0, zoom: 0, ...m } });
    while (this.samples.length && this.samples[0].t < t - this.o.windowMs * 3) this.samples.shift();
  }

  /** The grab ended at `t`. True = it was a flick and a glide has started. */
  release(t: number): boolean {
    const recent = this.samples.filter((s) => s.t >= t - this.o.windowMs);
    this.samples = [];
    if (recent.length < 2) return false;
    const span = Math.max(16, t - recent[0].t + 16) / 1000;
    const sum = recent.reduce((a, s) => ({ dx: a.dx + s.m.dx, dy: a.dy + s.m.dy, rotate: a.rotate + s.m.rotate, zoom: a.zoom + s.m.zoom }), { dx: 0, dy: 0, rotate: 0, zoom: 0 });
    const v = { dx: sum.dx / span, dy: sum.dy / span, rotate: sum.rotate / span, zoom: sum.zoom / span };
    const keepPan = Math.hypot(v.dx, v.dy) >= this.o.min.pan;
    const keepRot = Math.abs(v.rotate) >= this.o.min.rotate;
    const keepZoom = Math.abs(v.zoom) >= this.o.min.zoom;
    if (!keepPan && !keepRot && !keepZoom) return false;
    this.v = { dx: keepPan ? v.dx : 0, dy: keepPan ? v.dy : 0, rotate: keepRot ? v.rotate : 0, zoom: keepZoom ? v.zoom : 0 };
    this.lastT = t;
    return true;
  }

  /** Advance the glide to `t`: this frame's motion, or null once it has died away. */
  step(t: number): Motion | null {
    if (!this.v) return null;
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    const d = (k: keyof MomentumOptions["tau"]) => Math.exp(-dt / this.o.tau[k]);
    const v = this.v;
    const out = { dx: v.dx * dt, dy: v.dy * dt, rotate: v.rotate * dt, zoom: v.zoom * dt };
    v.dx *= d("pan"); v.dy *= d("pan"); v.rotate *= d("rotate"); v.zoom *= d("zoom");
    if (Math.hypot(v.dx, v.dy) < 0.01 && Math.abs(v.rotate) < 0.02 && Math.abs(v.zoom) < 0.01) this.v = null;
    return out;
  }

  stop() { this.v = null; this.samples = []; }
}

/** requestAnimationFrame where there is one (a timer elsewhere: tests, workers). */
export const nextFrame = (f: () => void): number =>
  typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(f) : (setTimeout(f, 16) as unknown as number);
export const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(id);
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};
