import { beforeEach, describe, expect, it } from "vitest";
import { GestureRecognizer } from "../src/recognizer";
import { reseed, synthHand, type SynthHand } from "../src/synth";
import { pointInPolygon, shortestPath } from "../src/geometry";
import { createCortexMapAdapter, type CortexMapLike } from "../src/adapters/cortexMap";
import type { GestureEvent, Point } from "../src/types";

const DT = 1000 / 30;
function run(r: GestureRecognizer, frames: (SynthHand[] | null)[], t0 = 1000) {
  const ev: GestureEvent[] = [];
  frames.forEach((hands, i) => ev.push(...r.update({ t: t0 + i * DT, hands: (hands ?? []).map((h) => ({ landmarks: synthHand(h, r.o) })) })));
  return ev;
}
const repeat = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const kinds = (ev: GestureEvent[]) => ev.filter((e) => e.type !== "hover" && e.type !== "press" && e.type !== "draw").map((e) => e.type);
const circle = (i: number, n: number): Point => ({ x: 0.5 + 0.15 * Math.cos((i / n) * Math.PI * 2), y: 0.5 + 0.2 * Math.sin((i / n) * Math.PI * 2) });

let r: GestureRecognizer;
beforeEach(() => { r = new GestureRecognizer(); reseed(3); });

describe("air drawing", () => {
  it("a V of two fingers drawn round in a circle is a closed loop", () => {
    const ev = run(r, [
      ...repeat(10, () => [{ at: circle(0, 40), pose: "draw" as const }]),
      ...repeat(41, (i) => [{ at: circle(i, 40), pose: "draw" as const }]),
      ...repeat(8, () => [{ at: circle(0, 40), pose: "relaxed" as const }]),
    ]);
    expect(kinds(ev)).toEqual(["drawend"]);
    const end = ev.find((e) => e.type === "drawend") as Extract<GestureEvent, { type: "drawend" }>;
    expect(end.closed).toBe(true);
    expect(end.path.length).toBeGreaterThan(20);
  });

  it("a straight stroke is a line, not a loop", () => {
    const ev = run(r, [
      ...repeat(10, () => [{ at: { x: 0.3, y: 0.5 }, pose: "draw" as const }]),
      ...repeat(20, (i) => [{ at: { x: 0.3 + i * 0.02, y: 0.5 }, pose: "draw" as const }]),
      ...repeat(8, () => [{ at: { x: 0.7, y: 0.5 }, pose: "point" as const }]),
    ]);
    const end = ev.find((e) => e.type === "drawend") as Extract<GestureEvent, { type: "drawend" }>;
    expect(end.closed).toBe(false);
    expect(end.path[0].x).toBeLessThan(0.35);
    expect(end.path.at(-1)!.x).toBeGreaterThan(0.65);
  });

  it("a loose hand (fingers together) never draws, and a flash of the pose doesn't start a stroke", () => {
    expect(kinds(run(r, repeat(40, (i) => [{ at: circle(i, 40), pose: "relaxed" as const }])))).toEqual([]);
    expect(kinds(run(r, [
      ...repeat(4, () => [{ at: { x: 0.5, y: 0.5 }, pose: "draw" as const }]),
      ...repeat(20, (i) => [{ at: { x: 0.5 + i * 0.01, y: 0.5 }, pose: "point" as const }]),
    ], 9000))).toEqual([]);
  });
});

describe("held grabs", () => {
  it("a pinch held still, then moved, is a held grab", () => {
    const ev = run(r, [
      ...repeat(4, () => [{ at: { x: 0.4, y: 0.4 }, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(20, () => [{ at: { x: 0.4, y: 0.4 }, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, (i) => [{ at: { x: 0.4 + i * 0.02, y: 0.4 }, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(4, () => [{ at: { x: 0.6, y: 0.4 }, pose: "pinch" as const, pinch: 0 }]),
    ]);
    expect(kinds(ev).filter((k) => k !== "pan")).toEqual(["panstart", "panend"]);
    expect(ev.find((e) => e.type === "panstart")).toMatchObject({ held: true, at: { x: expect.closeTo(0.4, 1) } });
  });
  it("a quick pinch and drag is a plain grab", () => {
    const ev = run(r, [
      ...repeat(4, () => [{ at: { x: 0.4, y: 0.4 }, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(3, () => [{ at: { x: 0.4, y: 0.4 }, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, (i) => [{ at: { x: 0.4 + i * 0.02, y: 0.4 }, pose: "pinch" as const, pinch: 1 }]),
    ]);
    expect(ev.find((e) => e.type === "panstart")).not.toHaveProperty("held");
  });
  it("both hands held still, then spread, is a held two-hand grab", () => {
    const ev = run(r, [
      ...repeat(4, () => [{ at: { x: 0.4, y: 0.5 }, pose: "pinch" as const, pinch: 0 }, { at: { x: 0.6, y: 0.5 }, pose: "pinch" as const, pinch: 0 }]),
      ...repeat(22, () => [{ at: { x: 0.4, y: 0.5 }, pose: "pinch" as const, pinch: 1 }, { at: { x: 0.6, y: 0.5 }, pose: "pinch" as const, pinch: 1 }]),
      ...repeat(10, (i) => [{ at: { x: 0.4 - i * 0.01, y: 0.5 }, pose: "pinch" as const, pinch: 1 }, { at: { x: 0.6 + i * 0.01, y: 0.5 }, pose: "pinch" as const, pinch: 1 }]),
    ]);
    expect(ev.find((e) => e.type === "twostart")).toMatchObject({ held: true });
  });
});

describe("geometry", () => {
  it("point in polygon, shortest path", () => {
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, sq)).toBe(false);
    const g: Record<string, string[]> = { a: ["b"], b: ["a", "c", "d"], c: ["b", "e"], d: ["b"], e: ["c"], z: [] };
    expect(shortestPath("a", "e", (id) => g[id])).toEqual(["a", "b", "c", "e"]);
    expect(shortestPath("a", "z", (id) => g[id])).toBeNull();
  });
});

describe("cortex adapter: map gestures", () => {
  // five nodes on a 1000 × 500 map: a-b-c chain, d linked to c, e alone
  const pos: Record<string, Point> = { a: { x: 100, y: 100 }, b: { x: 300, y: 120 }, c: { x: 500, y: 250 }, d: { x: 520, y: 280 }, e: { x: 900, y: 400 } };
  const links: [string, string][] = [["a", "b"], ["b", "c"], ["c", "d"]];
  const calls: unknown[][] = [];
  const map = (): CortexMapLike => ({
    getView: () => ({ camera: { position: { x: 0, y: 0, z: 1, set() {} }, up: { x: 0, y: 1, z: 0, set() {} }, fov: 50, lookAt() {} }, target: { x: 0, y: 0, z: 0, set() {} }, element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) } as unknown as HTMLElement }),
    nodeAt: (x, y, rad = 28) => { let best: string | null = null, bd = rad; for (const [id, p] of Object.entries(pos)) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = id; } } return best ? { id: best, cluster: best === "e" ? "far" : "near" } : null; },
    hover() {}, select: (id) => calls.push(["select", id]), focus() {}, resetView() {},
    nodeIds: () => Object.keys(pos),
    screenOf: (id) => pos[id],
    neighbours: (id) => links.flatMap(([s, t]) => (s === id ? [t] : t === id ? [s] : [])),
    node: (id) => ({ id, label: id.toUpperCase(), cluster: id === "e" ? "far" : "near" }),
    spotlight: (ids, mode) => calls.push(["spotlight", ids, mode]),
    spreadCluster: (c, k) => calls.push(["spread", c, +k.toFixed(2)]),
    spreadOf: () => 1,
  });
  const at = (id: string): Point => ({ x: pos[id].x / 1000, y: pos[id].y / 500 });

  it("a loop lights up the nodes inside it", () => {
    calls.length = 0;
    const a = createCortexMapAdapter(map, { pinboard: false });
    const loop = [{ x: 0.45, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.65 }, { x: 0.45, y: 0.65 }];
    a.handle({ type: "drawend", path: loop, closed: true });
    expect(calls).toEqual([["spotlight", ["c", "d"], "set"]]);
  });
  it("a line from one node to another lights the chain and selects the far end", () => {
    calls.length = 0;
    const a = createCortexMapAdapter(map, { pinboard: false });
    a.handle({ type: "drawend", path: [at("a"), { x: 0.3, y: 0.3 }, at("d")], closed: false });
    expect(calls).toEqual([["spotlight", ["a", "b", "c", "d"], "path"], ["select", "d"]]);
  });
  it("both hands held on a cluster then spread pulls it apart, and nothing else moves", () => {
    calls.length = 0;
    const a = createCortexMapAdapter(map, { pinboard: false });
    a.handle({ type: "twostart", at: at("c"), held: true });
    a.handle({ type: "transform", scale: 1.5, rotate: 0, dx: 0, dy: 0, at: at("c") });
    a.handle({ type: "transform", scale: 1.2, rotate: 0, dx: 0, dy: 0, at: at("c") });
    a.handle({ type: "twoend" });
    expect(calls).toEqual([["spread", "near", 1.5], ["spread", "near", 1.8]]);
  });
  it("clearing the selection clears the light", () => {
    calls.length = 0;
    const a = createCortexMapAdapter(map, { pinboard: false });
    a.handle({ type: "select", at: { x: -10, y: -10 } });
    expect(calls[0]).toEqual(["spotlight", null, "set"]);
  });
});
