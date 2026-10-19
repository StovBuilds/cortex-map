// Look-to-select: hold the crosshair on one thing, without steering, and it is
// selected. Selects once per target: look away (or at something else) to arm
// it again. Pure, so tests can drive it with a clock.

import type { Target } from "./types";

export interface DwellOptions {
  /** How long to hold still on a target. 0 switches dwell off. */
  ms: number;
}

export const DWELL_DEFAULTS: DwellOptions = { ms: 1000 };

export class Dwell {
  readonly o: DwellOptions;
  private id: string | null = null;
  private since = 0;
  private done: string | null = null;
  /** 0..1 towards selecting the current target (for a progress ring). */
  progress = 0;

  constructor(o: Partial<DwellOptions> = {}) { this.o = { ...DWELL_DEFAULTS, ...o }; }

  /**
   * One frame. `busy`: the input is doing something else (steering, mouth
   * open, calibrating), which pauses the clock. True = select now.
   */
  update(t: number, target: Target | null, busy: boolean): boolean {
    const id = target?.id ?? null;
    if (id !== this.id) { this.id = id; this.since = t; if (id !== this.done) this.done = null; }
    if (!this.o.ms || !id || id === this.done) { this.progress = 0; return false; }
    if (busy) { this.since = t; this.progress = 0; return false; }
    this.progress = Math.min(1, (t - this.since) / this.o.ms);
    if (this.progress < 1) return false;
    this.done = id;
    this.progress = 0;
    return true;
  }

  /** Forget everything (input switched off, view reset). */
  reset() { this.id = null; this.done = null; this.progress = 0; }
}
