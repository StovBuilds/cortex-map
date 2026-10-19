// Earcons: tiny synthesised sounds for feedback (Web Audio, no files). A soft
// tick when the crosshair or a hand lands on something (pitched by its group,
// so each cluster has its own note), chirps for select / clear / reset, a low
// thump for a grab. Quiet by design.

export type Earcon = "target" | "select" | "clear" | "reset" | "grab" | "step" | "tick";

type Ctx = AudioContext;
let shared: Ctx | null = null;
const ctx = (): Ctx | null => {
  if (shared) return shared;
  const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  shared = new AC();
  return shared;
};

// [frequency Hz, start s, length s] per note
const NOTES: Record<Earcon, { wave: OscillatorType; gain: number; notes: [number, number, number][] }> = {
  target: { wave: "sine", gain: 0.05, notes: [[1320, 0, 0.05]] },
  select: { wave: "triangle", gain: 0.09, notes: [[660, 0, 0.07], [990, 0.06, 0.1]] },
  step: { wave: "triangle", gain: 0.07, notes: [[880, 0, 0.06], [1175, 0.05, 0.08]] },
  clear: { wave: "triangle", gain: 0.07, notes: [[700, 0, 0.06], [470, 0.05, 0.09]] },
  reset: { wave: "sine", gain: 0.08, notes: [[520, 0, 0.09], [780, 0.08, 0.09], [1040, 0.16, 0.14]] },
  grab: { wave: "sine", gain: 0.1, notes: [[180, 0, 0.09]] },
  // the dial's ratchet: a dry click every notch
  tick: { wave: "square", gain: 0.018, notes: [[2400, 0, 0.018]] },
};

// a major pentatonic over two octaves: any two notes sound fine together
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
/** The note a group plays: stable per name, spread over the scale. */
export function groupNote(group: string): number {
  let h = 2166136261;
  for (let i = 0; i < group.length; i++) { h ^= group.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 523.25 * Math.pow(2, SCALE[(h >>> 0) % SCALE.length] / 12); // from C5
}

export class Earcons {
  /** Off by default: a library shouldn't make noise unless asked. */
  enabled: boolean;
  /** Minimum gap between two "target" ticks, so sweeping across a cluster doesn't buzz. */
  tickGapMs = 110;
  private lastTick = 0;
  /** Every earcon played, newest last (tests read this; capped). */
  readonly log: Earcon[] = [];

  constructor(enabled = false) { this.enabled = enabled; }

  /** `group`: pitch a "target" tick by the target's group. */
  play(e: Earcon, group?: string) {
    if (!this.enabled) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (e === "target") { if (now - this.lastTick < this.tickGapMs) return; this.lastTick = now; }
    this.log.push(e);
    if (this.log.length > 50) this.log.shift();
    const c = ctx();
    if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    const base = NOTES[e];
    // a group's tick is its own note, a touch longer so it reads as a tone
    const spec = e === "target" && group ? { ...base, gain: 0.055, notes: [[groupNote(group), 0, 0.12]] as [number, number, number][] } : base;
    const t0 = c.currentTime + 0.005;
    for (const [f, at, len] of spec.notes) {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = spec.wave;
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(spec.gain, t0 + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      osc.connect(g).connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + len + 0.02);
    }
  }
}
