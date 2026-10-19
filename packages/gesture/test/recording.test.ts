import { describe, expect, it } from "vitest";
import { Recorder, replay, parseRecording } from "../src/recording";
import { GestureRecognizer } from "../src/recognizer";
import { synthHand } from "../src/synth";
import type { FrameInput, GestureEvent } from "../src/types";
import type { FaceFrame } from "../src/head";

/** A source a test can push frames through, like a controller's onFrame. */
function source<F>() {
  const fns = new Set<(f: F) => void>();
  return { onFrame: (fn: (f: F) => void) => { fns.add(fn); return () => { fns.delete(fn); }; }, push: (f: F) => fns.forEach((fn) => fn(f)) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("record and replay", () => {
  it("records landmarks (rounded) and head readings; nothing else, and nothing after stop", async () => {
    const hands = source<FrameInput>(), head = source<FaceFrame>();
    const rec = new Recorder();
    rec.start({ hands, head }, "test");
    hands.push({ t: 5, hands: [{ landmarks: synthHand({ at: { x: 0.5, y: 0.5 }, pose: "point" }).map((l) => ({ ...l, x: l.x + 1e-7 })) }] });
    await wait(20);
    head.push({ t: 9, face: { yaw: 0.123456, pitch: 0, roll: 0, distance: 50, jawOpen: 0, browUp: 0 } });
    const r = rec.stop()!;
    hands.push({ t: 50, hands: [] });
    expect(r.kind).toBe("cortex-gesture-recording");
    expect(r.where).toBe("test");
    expect(r.hands).toHaveLength(1);
    expect(r.head).toHaveLength(1);
    expect(r.head![0].face!.yaw).toBe(0.1235);
    expect(r.head![0].t).toBeGreaterThan(r.hands![0].t); // recorder's own clock
    expect(String(r.hands![0].hands[0].landmarks[0].x).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
    expect(r.ms).toBeGreaterThanOrEqual(15);
    expect(() => parseRecording(JSON.parse(JSON.stringify(r)))).not.toThrow();
  });

  it("a replay drives a recogniser to the same gestures as the original", { timeout: 10000 }, async () => {
    // the original: a tap, then a drag
    const frames: FrameInput[] = [];
    const at = (x: number) => ({ x, y: 0.5 });
    let t = 0;
    const push = (pose: "point" | "pinch", x: number, n: number, pinch = 1) => { for (let i = 0; i < n; i++) frames.push({ t: (t += 33), hands: [{ landmarks: synthHand({ at: at(x), pose, pinch }) }] }); };
    push("point", 0.4, 8); push("pinch", 0.4, 4); push("point", 0.4, 8);
    push("pinch", 0.4, 3); for (let i = 0; i < 12; i++) push("pinch", 0.4 + i * 0.02, 1); push("point", 0.64, 6);
    const kinds = (ev: GestureEvent[]) => ev.filter((e) => !["hover", "press", "pan"].includes(e.type)).map((e) => e.type);
    // record it at about its own pace
    const src = source<FrameInput>(), rec = new Recorder();
    rec.start({ hands: src });
    for (const f of frames) { src.push(f); await wait(30); }
    const r = rec.stop()!;
    // what those recorded frames do fed straight in
    const live = new GestureRecognizer();
    const liveEv = r.hands!.flatMap((f) => live.update(f));
    // replay it, twice as fast
    const again = new GestureRecognizer();
    const ev: GestureEvent[] = [];
    await replay(r, { hands: (f) => ev.push(...again.update(f)) }, { speed: 2 });
    expect(kinds(ev)).toEqual(kinds(liveEv));
    expect(kinds(ev)).toContain("panstart");
  });

  it("refuses files that aren't recordings", () => {
    expect(() => parseRecording({ hello: 1 })).toThrow(/not a gesture recording/);
    expect(() => parseRecording({ v: 1, kind: "cortex-gesture-recording", hands: [{ t: 1, hands: [{ landmarks: [] }] }] })).toThrow(/21 landmarks/);
  });

  it("stops early when aborted, and lets the hands go", async () => {
    const r = { v: 1 as const, kind: "cortex-gesture-recording" as const, recordedAt: "", ms: 5000, hands: Array.from({ length: 150 }, (_, i) => ({ t: i * 33, hands: [{ landmarks: synthHand({ at: { x: 0.5, y: 0.5 }, pose: "point" }) }] })) };
    const ac = new AbortController();
    const got: FrameInput[] = [];
    const p = replay(r, { hands: (f) => got.push(f) }, { signal: ac.signal });
    await wait(100);
    ac.abort();
    await p;
    expect(got.length).toBeLessThan(30);
    expect(got.at(-1)!.hands).toEqual([]);
  });
});
