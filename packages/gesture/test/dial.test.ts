import { describe, expect, it } from "vitest";
import { GestureRecognizer } from "../src/recognizer";
import { synthHand, type SynthHand, type SynthPose } from "../src/synth";
import type { GestureEvent } from "../src/types";
import { createCortexMapAdapter, type CortexMapLike } from "../src/adapters/cortexMap";

const at = { x: 0.5, y: 0.5 };
function run(r: GestureRecognizer, t0: number, ms: number, hand: (k: number) => Partial<SynthHand> & { pose: SynthPose } | null) {
  const out: GestureEvent[] = [];
  let t = t0;
  for (; t < t0 + ms; t += 33) {
    const h = hand((t - t0) / ms);
    out.push(...r.update({ t, hands: h ? [{ landmarks: synthHand({ at, ...h }) }] : [] }));
  }
  return { out, t };
}
const kinds = (es: GestureEvent[]) => es.filter((e) => e.type.startsWith("dial")).map((e) => e.type);
const turned = (es: GestureEvent[]) => es.reduce((s, e) => s + (e.type === "dial" ? e.delta : 0), 0);

describe("the dial (a fist turned like a knob)", () => {
  it("a fist turned clockwise dials clockwise, and opening the hand ends it", () => {
    const r = new GestureRecognizer();
    let x = run(r, 0, 400, () => ({ pose: "fist" }));
    expect(kinds(x.out)).toEqual([]);
    x = run(r, x.t, 900, (k) => ({ pose: "fist", roll: 0.9 * k }));
    expect(kinds(x.out)[0]).toBe("dialstart");
    // the screen is mirrored, so check against the recogniser's own sense: + = clockwise on screen
    const cw = turned(x.out);
    expect(Math.abs(cw)).toBeGreaterThan(0.7);
    x = run(r, x.t, 600, (k) => ({ pose: "fist", roll: 0.9 - 0.9 * k }));
    expect(Math.sign(turned(x.out))).toBe(-Math.sign(cw));
    x = run(r, x.t, 400, () => ({ pose: "relaxed", roll: 0 }));
    expect(kinds(x.out)).toEqual(["dialend"]);
    expect(r.state().hands[0].role).toBe("idle");
  });

  it("a fist held still does nothing (closing your hand isn't a dial)", () => {
    const r = new GestureRecognizer();
    const x = run(r, 0, 2000, (k) => ({ pose: "fist", roll: 0.05 * Math.sin(k * 20) }));
    expect(kinds(x.out)).toEqual([]);
  });

  it("a thumbs up isn't a fist: it never dials", () => {
    const r = new GestureRecognizer();
    run(r, 0, 300, () => ({ pose: "thumbsup" }));
    expect(r.state().hands[0].pose).not.toBe("fist");
    const x = run(r, 300, 1200, (k) => ({ pose: "thumbsup", roll: 0.9 * k }));
    expect(kinds(x.out)).toEqual([]);
  });

  it("losing the hand mid-turn ends the dial", () => {
    const r = new GestureRecognizer();
    let x = run(r, 0, 400, () => ({ pose: "fist" }));
    x = run(r, x.t, 600, (k) => ({ pose: "fist", roll: 0.6 * k }));
    x = run(r, x.t, 400, () => null);
    expect(kinds(x.out)).toEqual(["dialend"]);
  });

  it("no hover while dialing (the fist isn't a cursor)", () => {
    const r = new GestureRecognizer();
    let x = run(r, 0, 400, () => ({ pose: "fist" }));
    x = run(r, x.t, 600, (k) => ({ pose: "fist", roll: 0.6 * k }));
    const after = x.out.slice(x.out.findIndex((e) => e.type === "dialstart"));
    expect(after.some((e) => e.type === "hover" && e.at)).toBe(false);
  });
});

describe("the dial on a map: scrubbing through time", () => {
  const fake = (span: { min: number; max: number } | null) => {
    let cur: number | null = null;
    const set: (number | null)[] = [];
    const map: CortexMapLike = {
      getView: () => null, nodeAt: () => null, hover: () => {}, select: () => {}, focus: () => {}, resetView: () => { cur = null; },
      timeSpan: () => span, time: () => cur, setTime: (t) => { cur = t; set.push(t); },
    };
    return { map, set, cur: () => cur };
  };

  it("anticlockwise goes back, clockwise comes forward, past the newest is now", () => {
    const f = fake({ min: 0, max: 1000 });
    const a = createCortexMapAdapter(() => f.map, { pinboard: false });
    a.handle({ type: "dialstart", at: { x: 0.5, y: 0.5 } });
    a.handle({ type: "dial", delta: -Math.PI / 4, angle: -Math.PI / 4 });
    expect(f.cur()).toBeCloseTo(750);
    a.handle({ type: "dial", delta: -Math.PI, angle: -Math.PI });
    expect(f.cur()).toBe(0); // clamped at the oldest
    a.handle({ type: "dialend" });
    // a second turn carries on from where the first left it
    a.handle({ type: "dialstart", at: { x: 0.5, y: 0.5 } });
    a.handle({ type: "dial", delta: Math.PI / 2, angle: Math.PI / 2 });
    expect(f.cur()).toBeCloseTo(500);
    a.handle({ type: "dial", delta: Math.PI, angle: Math.PI });
    expect(f.cur()).toBeNull();
  });

  it("no dates: the dial doesn't touch time", () => {
    const f = fake(null);
    const a = createCortexMapAdapter(() => f.map, { pinboard: false });
    a.handle({ type: "dialstart", at: { x: 0.5, y: 0.5 } });
    a.handle({ type: "dial", delta: -1, angle: -1 });
    a.handle({ type: "dialend" });
    expect(f.set).toEqual([]);
  });
});
