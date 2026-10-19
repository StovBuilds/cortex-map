import { beforeEach, describe, expect, it } from "vitest";
import { GestureRecognizer } from "../src/recognizer";
import { reseed, synthHand, type SynthHand } from "../src/synth";
import type { GestureEvent, Point } from "../src/types";

const FPS = 30;
const DT = 1000 / FPS;

/** Drive a recognizer through `frames` (each a list of hands, or null = no hands). */
function run(r: GestureRecognizer, frames: (SynthHand[] | null)[], t0 = 1000) {
  const events: GestureEvent[] = [];
  frames.forEach((hands, i) => {
    const t = t0 + i * DT;
    events.push(...r.update({ t, hands: (hands ?? []).map((h) => ({ landmarks: synthHand(h, r.o) })) }));
  });
  return events;
}

const types = (ev: GestureEvent[]) => ev.filter((e) => e.type !== "hover" && e.type !== "press").map((e) => e.type);
const lerp = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const repeat = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

let r: GestureRecognizer;
beforeEach(() => { r = new GestureRecognizer(); reseed(7); });

describe("hover", () => {
  it("a pointing hand moves the hover cursor and does nothing else", () => {
    const ev = run(r, repeat(40, (i) => [{ at: lerp({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.6 }, i / 39), pose: "point", jitter: 0.02 }]));
    expect(types(ev)).toEqual([]);
    const last = ev.filter((e) => e.type === "hover").at(-1) as Extract<GestureEvent, { type: "hover" }>;
    expect(last.at!.x).toBeGreaterThan(0.7);
    expect(last.at!.y).toBeGreaterThan(0.5);
  });

  it("clears hover when the hand leaves", () => {
    const ev = run(r, [...repeat(10, () => [{ at: { x: 0.5, y: 0.5 }, pose: "point" as const }]), ...repeat(10, () => null)]);
    expect(ev.at(-1)).toEqual({ type: "hover", at: null });
  });
});

describe("select", () => {
  it("a quick pinch, held still, selects where the pinch began", () => {
    const at = { x: 0.4, y: 0.45 };
    const ev = run(r, [
      ...repeat(10, () => [{ at, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(6, () => [{ at, pose: "pinch" as const, pinch: 1, jitter: 0.02 }]),
      ...repeat(6, () => [{ at, pose: "pinch" as const, pinch: 0 }]),
    ]);
    expect(types(ev)).toEqual(["select"]);
    const s = ev.find((e) => e.type === "select") as Extract<GestureEvent, { type: "select" }>;
    expect(Math.abs(s.at.x - at.x)).toBeLessThan(0.01);
    expect(Math.abs(s.at.y - at.y)).toBeLessThan(0.01);
  });

  it("uses the cursor from before the fingers closed (closing drags the cursor)", () => {
    const at = { x: 0.4, y: 0.45 };
    const drift = { x: 0.43, y: 0.47 }; // fingers closing pull the pinch point ~3%
    const ev = run(r, [
      ...repeat(12, () => [{ at, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(3, (i) => [{ at: lerp(at, drift, (i + 1) / 3), pose: "pinch" as const, pinch: 0.4 + i * 0.2 }]),
      ...repeat(4, () => [{ at: drift, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(5, () => [{ at: drift, pose: "pinch" as const, pinch: 0 }]),
    ]);
    // the drift is under the drag deadzone → still a select, at the ORIGINAL spot
    expect(types(ev)).toEqual(["select"]);
    const s = ev.find((e) => e.type === "select") as Extract<GestureEvent, { type: "select" }>;
    expect(Math.abs(s.at.x - at.x)).toBeLessThan(0.012);
  });

  it("a long hold without moving is not a select", () => {
    const at = { x: 0.5, y: 0.5 };
    const ev = run(r, [
      ...repeat(5, () => [{ at, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(30, () => [{ at, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(5, () => [{ at, pose: "pinch" as const, pinch: 0 }]),
    ]);
    // held still, it becomes a "held" grab (pick up what's under it), never a select
    expect(types(ev)).toEqual(["panstart", "panend"]);
    expect(ev.find((e) => e.type === "panstart")).toMatchObject({ held: true });
  });
});

describe("pinch hysteresis", () => {
  it("a hand hovering around the pinch threshold never flickers into a pinch", () => {
    // ratio oscillates 0.33..0.42 — between pinchOn (0.30) and pinchOff (0.45)
    const ev = run(r, repeat(60, (i) => [{ at: { x: 0.5, y: 0.5 }, pose: "pinch" as const, pinch: 0.68 + 0.06 * Math.sin(i) }]));
    // whatever state it settles in, it never toggles: at most one press, no release
    expect(ev.filter((e) => e.type === "press").length).toBeLessThanOrEqual(1);
    expect(types(ev).filter((t) => t !== "panstart")).toEqual([]);
  });

  it("a single-frame dip below the threshold is ignored", () => {
    const ev = run(r, [
      ...repeat(10, () => [{ at: { x: 0.5, y: 0.5 }, pose: "pinch" as const, pinch: 0 }]),
      [{ at: { x: 0.5, y: 0.5 }, pose: "pinch", pinch: 1 }],
      ...repeat(10, () => [{ at: { x: 0.5, y: 0.5 }, pose: "pinch" as const, pinch: 0 }]),
    ]);
    expect(types(ev)).toEqual([]);
  });
});

describe("pan", () => {
  it("pinch and drag pans by the distance moved, then ends", () => {
    const a = { x: 0.3, y: 0.5 }, b = { x: 0.7, y: 0.4 };
    const ev = run(r, [
      ...repeat(5, () => [{ at: a, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(5, () => [{ at: a, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(30, (i) => [{ at: lerp(a, b, (i + 1) / 30), pose: "pinch" as const, pinch: 1, jitter: 0.015 }]),
      ...repeat(10, () => [{ at: b, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(5, () => [{ at: b, pose: "pinch" as const, pinch: 0 }]),
    ]);
    const t = types(ev);
    expect(t[0]).toBe("panstart");
    expect(t.at(-1)).toBe("panend");
    expect(t).not.toContain("select");
    const pans = ev.filter((e) => e.type === "pan") as Extract<GestureEvent, { type: "pan" }>[];
    const dx = pans.reduce((s, p) => s + p.dx, 0), dy = pans.reduce((s, p) => s + p.dy, 0);
    // everything after the deadzone is delivered (the deadzone itself is swallowed)
    expect(dx).toBeGreaterThan(0.33);
    expect(dx).toBeLessThan(0.41);
    expect(dy).toBeLessThan(-0.06);
  });

  it("a dropped frame mid-drag does not end the pan", () => {
    const a = { x: 0.3, y: 0.5 }, b = { x: 0.6, y: 0.5 };
    const ev = run(r, [
      ...repeat(5, () => [{ at: a, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, (i) => [{ at: lerp(a, b, (i + 1) / 20), pose: "pinch" as const, pinch: 1 }]),
      null,
      ...repeat(10, (i) => [{ at: lerp(a, b, (i + 11) / 20), pose: "pinch" as const, pinch: 1 }]),
    ]);
    expect(types(ev).filter((x) => x === "panstart" || x === "panend")).toEqual(["panstart"]);
  });

  it("losing the hand mid-drag ends the pan", () => {
    const a = { x: 0.3, y: 0.5 }, b = { x: 0.6, y: 0.5 };
    const ev = run(r, [
      ...repeat(5, () => [{ at: a, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, (i) => [{ at: lerp(a, b, (i + 1) / 10), pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, () => null),
    ]);
    expect(types(ev).at(-1)).toBe("panend");
  });
});

describe("two hands", () => {
  const twoHands = (sep: number, angle: number, pinch = 1): SynthHand[] => {
    const c = { x: 0.5, y: 0.5 }, h = sep / 2, asp = 16 / 9;
    const off = { x: (Math.cos(angle) * h) / asp, y: Math.sin(angle) * h };
    return [
      { at: { x: c.x - off.x, y: c.y - off.y }, pose: "pinch", pinch, palm: 0.12 },
      { at: { x: c.x + off.x, y: c.y + off.y }, pose: "pinch", pinch, palm: 0.12 },
    ];
  };

  it("spreading both pinched hands zooms in by the spread ratio", () => {
    const ev = run(r, [
      ...repeat(5, () => twoHands(0.5, 0, 0)),
      ...repeat(5, () => twoHands(0.5, 0)),
      ...repeat(30, (i) => twoHands(0.5 + 0.4 * ((i + 1) / 30), 0)),
      ...repeat(5, () => twoHands(0.9, 0)),
      ...repeat(5, () => twoHands(0.9, 0, 0)),
    ]);
    const t = types(ev);
    expect(t[0]).toBe("twostart");
    expect(t.at(-1)).toBe("twoend");
    expect(t).not.toContain("panstart");
    expect(t).not.toContain("select");
    const tf = ev.filter((e) => e.type === "transform") as Extract<GestureEvent, { type: "transform" }>[];
    const scale = tf.reduce((s, e) => s * e.scale, 1);
    // 0.5 → 0.9 = 1.8×, less the ~5% deadzone
    expect(scale).toBeGreaterThan(1.6);
    expect(scale).toBeLessThan(1.8);
    expect(Math.abs(tf.reduce((s, e) => s + e.rotate, 0))).toBeLessThan(0.05);
  });

  it("twisting both hands rotates", () => {
    const ev = run(r, [
      ...repeat(5, () => twoHands(0.6, 0)),
      ...repeat(30, (i) => twoHands(0.6, 0.6 * ((i + 1) / 30))),
      ...repeat(5, () => twoHands(0.6, 0.6, 0)),
    ]);
    const tf = ev.filter((e) => e.type === "transform") as Extract<GestureEvent, { type: "transform" }>[];
    const rot = tf.reduce((s, e) => s + e.rotate, 0);
    expect(rot).toBeGreaterThan(0.45);
    expect(rot).toBeLessThan(0.6);
    expect(Math.abs(Math.log(tf.reduce((s, e) => s * e.scale, 1)))).toBeLessThan(0.05);
  });

  it("letting go with one hand ends it, and the other must release before it can grab", () => {
    const [l, rt] = twoHands(0.6, 0);
    const ev = run(r, [
      ...repeat(5, () => twoHands(0.6, 0)),
      ...repeat(10, (i) => twoHands(0.6 + 0.2 * ((i + 1) / 10), 0)),
      // left lets go, right keeps pinching and moves — must NOT pan
      ...repeat(20, (i) => [{ ...l, pinch: 0 }, { ...rt, at: { x: rt.at.x - 0.01 * i, y: rt.at.y } }]),
      // right releases, then pinch-drags again — now it pans
      ...repeat(5, () => [{ ...l, pinch: 0 }, { ...rt, pinch: 0 }]),
      ...repeat(15, (i) => [{ ...l, pinch: 0 }, { ...rt, at: { x: rt.at.x - 0.02 * i, y: rt.at.y } }]),
    ]);
    const t = types(ev).filter((x) => x !== "pan" && x !== "transform");
    expect(t).toEqual(["twostart", "twoend", "panstart"]);
  });
});

describe("open-palm reset", () => {
  const palm = (at: Point): SynthHand[] => [{ at, pose: "open" }];

  it("an open palm held still resets once", () => {
    const ev = run(r, repeat(60, () => palm({ x: 0.5, y: 0.5 })));
    expect(types(ev)).toEqual(["reset"]);
  });

  it("a hand that just arrived open doesn't reset immediately", () => {
    const ev = run(r, repeat(Math.round((350 + 600) / DT) - 3, () => palm({ x: 0.5, y: 0.5 })));
    expect(types(ev)).toEqual([]);
  });

  it("a moving open palm (waving, reaching) never resets", () => {
    const ev = run(r, repeat(90, (i) => palm({ x: 0.5 + 0.3 * Math.sin(i / 4), y: 0.5 })));
    expect(types(ev)).toEqual([]);
  });

  it("re-arms only after the hand closes", () => {
    const ev = run(r, [
      ...repeat(60, () => palm({ x: 0.5, y: 0.5 })),
      ...repeat(10, () => [{ at: { x: 0.5, y: 0.5 }, pose: "fist" as const }]),
      ...repeat(40, () => palm({ x: 0.5, y: 0.5 })),
    ]);
    expect(types(ev)).toEqual(["reset", "reset"]);
  });
});
