// Detection pacing: every video frame while something is in view, and only a
// few times a second once nothing has been seen for a while. A hand or face
// coming back is caught within one slow tick (~1/8 s) and then it's full rate
// again. Keeps a laptop cool when you've stepped away.

export interface PaceOptions {
  /** Nothing seen for this long → slow down (ms). */
  idleAfterMs?: number;
  /** While idle, run detection at most this often (ms). */
  idleIntervalMs?: number;
}

export class Pacer {
  readonly idleAfterMs: number;
  readonly idleIntervalMs: number;
  private lastSeen = -Infinity;
  private lastRun = -Infinity;

  constructor(o: PaceOptions = {}) {
    this.idleAfterMs = o.idleAfterMs ?? 2000;
    this.idleIntervalMs = o.idleIntervalMs ?? 125;
  }

  /** Start (or restart) at full rate. */
  reset(t: number) { this.lastSeen = t; this.lastRun = -Infinity; }

  /** Should detection run on the frame at time `t`? */
  due(t: number) {
    if (this.idle(t) && t - this.lastRun < this.idleIntervalMs) return false;
    this.lastRun = t;
    return true;
  }

  /** Report what a detection found. */
  saw(t: number, present: boolean) { if (present) this.lastSeen = t; }

  idle(t: number) { return t - this.lastSeen > this.idleAfterMs; }
}
