import { describe, expect, it } from "vitest";
import { PoseLibrary } from "../src/poses";
import { GestureRecognizer, DEFAULT_OPTIONS } from "../src/recognizer";
import { synthHand, reseed, type SynthHand, type SynthPose } from "../src/synth";
import type { GestureEvent, Landmark } from "../src/types";

const O = DEFAULT_OPTIONS;
const hand = (pose: SynthPose, extra: Partial<SynthHand> = {}) =>
  synthHand({ at: { x: 0.5, y: 0.5 }, pose, ...extra }, O);
/** The same hand seen as the other hand: mirrored in x about the frame's centre. */
const mirrored = (lm: Landmark[]) => lm.map((l) => ({ ...l, x: 1 - l.x }));

/** Record a pose the way the lab does: a second or so of a slightly wobbly hand. */
function record(lib: PoseLibrary, name: string, pose: SynthPose) {
  reseed(7);
  for (let i = 0; i < 30; i++) {
    lib.add(name, hand(pose, { roll: (i % 7 - 3) * 0.06, jitter: 0.04, palm: 0.12 + (i % 5) * 0.01, at: { x: 0.3 + (i % 3) * 0.2, y: 0.5 } }));
  }
}

const lib = () => new PoseLibrary({ videoAspect: O.videoAspect });

describe("custom poses: the library", () => {
  it("knows a recorded pose wherever the hand is, at any size, with a wobble", () => {
    const L = lib();
    record(L, "thumbs up", "thumbsup");
    reseed(99);
    for (const roll of [-0.2, 0, 0.2]) {
      for (const palm of [0.1, 0.18]) {
        expect(L.match(hand("thumbsup", { roll, palm, jitter: 0.05, at: { x: 0.8, y: 0.3 } }))?.name).toBe("thumbs up");
      }
    }
  });

  it("knows it from the other hand too", () => {
    const L = lib();
    record(L, "thumbs up", "thumbsup");
    expect(L.match(mirrored(hand("thumbsup", { roll: 0.1 })))?.name).toBe("thumbs up");
  });

  it("never claims the built-in shapes: palm, point, pinch, fist, a loose hand, the V", () => {
    const L = lib();
    record(L, "thumbs up", "thumbsup");
    record(L, "horns", "horns");
    for (const pose of ["open", "point", "pinch", "fist", "relaxed", "draw"] as SynthPose[]) {
      for (const roll of [-0.3, 0, 0.3]) expect(L.match(hand(pose, { roll })), `${pose} @ ${roll}`).toBeNull();
    }
  });

  it("tells two custom poses apart", () => {
    const L = lib();
    record(L, "horns", "horns");
    record(L, "call", "call");
    record(L, "three", "three");
    expect(L.match(hand("horns", { roll: 0.1 }))?.name).toBe("horns");
    expect(L.match(hand("call", { roll: -0.1 }))?.name).toBe("call");
    expect(L.match(hand("three"))?.name).toBe("three");
    expect(L.names()).toEqual(["horns", "call", "three"]);
  });

  it("a thumbs down is not a thumbs up", () => {
    const L = lib();
    record(L, "thumbs up", "thumbsup");
    expect(L.match(hand("thumbsup", { roll: Math.PI }))).toBeNull();
  });

  it("warns when a recording looks like a built-in shape", () => {
    const L = lib();
    record(L, "my fist", "fist");
    record(L, "horns", "horns");
    expect(L.clash("my fist")).toBeGreaterThan(0.3);
    expect(L.clash("horns")).toBeLessThan(0.1);
  });

  it("saves and loads; remove and rename work", () => {
    const L = lib();
    record(L, "horns", "horns");
    const json = JSON.parse(JSON.stringify(L.toJSON()));
    const M = lib();
    M.load(json);
    expect(M.count("horns")).toBe(30);
    expect(M.match(hand("horns"))?.name).toBe("horns");
    M.rename("horns", "rock");
    expect(M.match(hand("horns"))?.name).toBe("rock");
    M.remove("rock");
    expect(M.match(hand("horns"))).toBeNull();
    M.load({ v: 1, samples: [{ name: "_builtin", f: new Array(40).fill(0) }, { name: "bad", f: [1] }] });
    expect(M.names()).toEqual([]);
  });
});

describe("custom poses: the recogniser", () => {
  const run = (r: GestureRecognizer, pose: SynthPose, t0: number, ms: number, extra: Partial<SynthHand> = {}) => {
    const out: GestureEvent[] = [];
    let t = t0;
    for (; t < t0 + ms; t += 33) out.push(...r.update({ t, hands: [{ landmarks: hand(pose, extra) }] }));
    return { out, t };
  };
  const poseEvents = (es: GestureEvent[]) => es.filter((e) => e.type === "pose");

  it("fires once when the pose is held, again only after letting go", () => {
    const L = lib();
    record(L, "horns", "horns");
    const r = new GestureRecognizer();
    r.setPoses(L);
    let x = run(r, "horns", 0, 300);
    expect(poseEvents(x.out)).toHaveLength(0);
    expect(r.state().hands[0].custom).toBe("horns");
    expect(r.state().hands[0].customHold).toBeGreaterThan(0.5);
    x = run(r, "horns", x.t, 1500);
    expect(poseEvents(x.out)).toEqual([{ type: "pose", name: "horns", at: expect.any(Object) }]);
    x = run(r, "relaxed", x.t, 300);
    expect(r.state().hands[0].custom).toBeNull();
    x = run(r, "horns", x.t, 600);
    expect(poseEvents(x.out)).toHaveLength(1);
  });

  it("a pinch or a palm still does what it always did", () => {
    const L = lib();
    record(L, "horns", "horns");
    const r = new GestureRecognizer();
    r.setPoses(L);
    let x = run(r, "pinch", 0, 900);
    expect(poseEvents(x.out)).toHaveLength(0);
    expect(x.out.some((e) => e.type === "panstart")).toBe(true);
    x = run(r, "open", x.t + 400, 1200);
    expect(poseEvents(x.out)).toHaveLength(0);
    expect(x.out.some((e) => e.type === "reset")).toBe(true);
  });

  it("quiet: a shape already being held when the library is set doesn't fire until it changes", () => {
    const L = lib();
    record(L, "horns", "horns");
    const r = new GestureRecognizer();
    let x = run(r, "horns", 0, 300);
    r.setPoses(L, { quiet: "horns" });
    x = run(r, "horns", x.t, 1500);
    expect(poseEvents(x.out)).toHaveLength(0);
    x = run(r, "relaxed", x.t, 500);
    x = run(r, "horns", x.t, 600);
    expect(poseEvents(x.out)).toHaveLength(1);
  });

  it("no library, no pose events", () => {
    const r = new GestureRecognizer();
    expect(poseEvents(run(r, "horns", 0, 1500).out)).toHaveLength(0);
  });
});
