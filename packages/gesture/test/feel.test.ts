import { describe, expect, it } from "vitest";
import { Momentum } from "../src/momentum";
import { HeadRecognizer, type FaceReading } from "../src/head";
import { createOrbitAdapter } from "../src/adapters/orbitCamera";
import { groupNote } from "../src/sound";
import type { GestureEvent } from "../src/types";

describe("flick (momentum)", () => {
  it("a fast release glides on and dies away", () => {
    const m = new Momentum();
    for (let t = 0; t <= 100; t += 16) m.sample(t, { dx: 0.02 }); // ~1.2 surfaces / s
    expect(m.release(110)).toBe(true);
    let total = 0, frames = 0;
    for (let t = 126; frames < 400; t += 16, frames++) { const s = m.step(t); if (!s) break; total += s.dx; }
    expect(total).toBeGreaterThan(0.2);
    expect(total).toBeLessThan(0.6);
    expect(m.moving).toBe(false);
  });

  it("stopping before letting go doesn't glide", () => {
    const m = new Momentum();
    for (let t = 0; t <= 100; t += 16) m.sample(t, { dx: 0.02 });
    for (let t = 116; t <= 300; t += 16) m.sample(t, { dx: 0 });
    expect(m.release(310)).toBe(false);
  });

  it("a twist spins on longer than a slide glides; a new sample catches it", () => {
    const m = new Momentum();
    for (let t = 0; t <= 100; t += 16) m.sample(t, { rotate: 0.05 });
    expect(m.release(110)).toBe(true);
    let n = 0;
    for (let t = 126; m.step(t); t += 16) n++;
    expect(n * 16).toBeGreaterThan(1200);
    for (let t = 0; t <= 100; t += 16) m.sample(t, { dx: 0.03 });
    m.release(110);
    expect(m.moving).toBe(true);
    m.sample(130, {});
    expect(m.moving).toBe(false);
  });
});

describe("head window mode", () => {
  const rest: FaceReading = { yaw: 0, pitch: 0, roll: 0, distance: 50, jawOpen: 0.05, browUp: 0.1, x: 0, y: 0 };
  const run = (r: HeadRecognizer, t0: number, ms: number, f: Partial<FaceReading>) => {
    const out: GestureEvent[] = [];
    let t = t0;
    for (; t < t0 + ms; t += 33) out.push(...r.update({ t, face: { ...rest, ...f } }));
    return { out, t };
  };
  it("moving your head shifts the view; it never steers", () => {
    const r = new HeadRecognizer({ mode: "window" });
    let x = run(r, 0, 800, {});
    x = run(r, x.t, 800, { x: 6, y: -3, yaw: 0.3 });
    const views = x.out.filter((e) => e.type === "view");
    const last = views.at(-1) as Extract<GestureEvent, { type: "view" }>;
    expect(last.x).toBeGreaterThan(0.4);
    expect(last.y).toBeLessThan(-0.15);
    expect(x.out.some((e) => e.type === "orbit")).toBe(false);
  });
  it("back to steering puts the view back", () => {
    const r = new HeadRecognizer({ mode: "window" });
    let x = run(r, 0, 800, {});
    x = run(r, x.t, 300, { x: 6 });
    r.o.mode = "steer";
    x = run(r, x.t, 100, { x: 6 });
    expect(x.out.find((e) => e.type === "view")).toEqual({ type: "view", x: 0, y: 0, z: 0 });
  });
});

describe("orbit camera: window + glide", () => {
  const v3 = (x: number, y: number, z: number) => ({ x, y, z, set(a: number, b: number, c: number) { this.x = a; this.y = b; this.z = c; } });
  const view = () => {
    const camera = { position: v3(0, 0, 100), up: v3(0, 1, 0), fov: 50, lookAt() {} };
    const target = v3(0, 0, 0);
    const element = { getBoundingClientRect: () => ({ width: 1600, height: 900 }) } as unknown as HTMLElement;
    return { camera, target, element };
  };
  it("a view shift moves the eye sideways and back, and other moves don't drift it", () => {
    const v = view();
    const a = createOrbitAdapter({ getView: () => v, momentum: false });
    a.handle({ type: "view", x: 1, y: 0, z: 0 });
    expect(v.camera.position.x).toBeCloseTo(35, 3); // right, by windowGain × distance
    a.handle({ type: "orbit", yaw: 0, pitch: 0, zoom: 0, dx: 0.1, dy: 0 });
    a.handle({ type: "view", x: 0, y: 0, z: 0 });
    expect(v.camera.position.x - v.target.x).toBeCloseTo(0, 3);
    expect(v.camera.position.z - v.target.z).toBeCloseTo(100, 3);
  });
  it("a flicked drag keeps moving after panend; a press stops it", async () => {
    const v = view();
    const a = createOrbitAdapter({ getView: () => v });
    a.handle({ type: "panstart", at: { x: 0.5, y: 0.5 } });
    for (let i = 0; i < 6; i++) { a.handle({ type: "pan", dx: 0.03, dy: 0, at: { x: 0.5, y: 0.5 } }); await new Promise((r) => setTimeout(r, 16)); }
    a.handle({ type: "panend" });
    const x0 = v.target.x;
    await new Promise((r) => setTimeout(r, 150));
    const x1 = v.target.x;
    expect(Math.abs(x1 - x0)).toBeGreaterThan(1);
    a.handle({ type: "press", at: { x: 0.5, y: 0.5 } });
    await new Promise((r) => setTimeout(r, 100));
    const x2 = v.target.x;
    await new Promise((r) => setTimeout(r, 100));
    expect(v.target.x).toBe(x2);
  });
});

describe("cluster tones", () => {
  it("each group has a stable note in a two-octave scale", () => {
    expect(groupNote("Craft")).toBe(groupNote("Craft"));
    const notes = new Set(["Craft", "People", "Playtests", "Ideas", "Tools", "Places"].map(groupNote));
    expect(notes.size).toBeGreaterThan(3);
    for (const n of notes) { expect(n).toBeGreaterThanOrEqual(523); expect(n).toBeLessThan(2100); }
  });
});
