// One Euro filter (Casiez, Roussel & Vogel, CHI 2012). Low cutoff while the
// signal is slow (kills jitter when the hand is still), higher cutoff as it
// speeds up (no lag on a fast swipe). The standard fix for shaky hand cursors.

export interface OneEuroOptions {
  /** Cutoff (Hz) at rest. Lower = steadier but laggier when still. */
  minCutoff: number;
  /** How fast the cutoff rises with speed. Higher = less lag on fast moves. */
  beta: number;
  /** Cutoff (Hz) for the derivative estimate. */
  dCutoff: number;
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private o: OneEuroOptions) {}

  reset() { this.x = null; this.dx = 0; }

  /** Filter value `v` sampled at time `tMs`. */
  filter(v: number, tMs: number): number {
    if (this.x == null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.o.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.o.minCutoff + this.o.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}
