import { describe, expect, it } from "vitest";
import { HeadRecognizer, type FaceReading } from "../src/head";
import { GamepadRecognizer, PAD, NOWHERE } from "../src/gamepad";
import { readFaceMatrix } from "../src/faceTracker";
import { createOrbitAdapter } from "../src/adapters/orbitCamera";
import type { GestureEvent } from "../src/types";

const FRAME = 1000 / 30;
const rest: FaceReading = { yaw: 0.02, pitch: -0.05, roll: 0, distance: 50, jawOpen: 0.05, browUp: 0.1 };

/** Feed `ms` of frames, the face given as a function of progress 0..1. */
function run(r: HeadRecognizer, t0: number, ms: number, face: (k: number) => Partial<FaceReading> | null) {
  const out: GestureEvent[] = [];
  let t = t0;
  for (; t < t0 + ms; t += FRAME) {
    const f = face((t - t0) / ms);
    out.push(...r.update({ t, face: f ? { ...rest, ...f } : null }));
  }
  return { events: out, t };
}
const kinds = (e: GestureEvent[]) => e.filter((x) => x.type !== "hover" && x.type !== "press").map((x) => x.type);
const sum = (e: GestureEvent[], k: "yaw" | "pitch" | "zoom" | "dx" | "dy") =>
  e.reduce((s, x) => s + (x.type === "orbit" ? x[k] : x.type === "pan" && (k === "dx" || k === "dy") ? x[k] : 0), 0);

function calibrated() {
  const r = new HeadRecognizer();
  const { t } = run(r, 0, 800, () => ({}));
  return { r, t };
}

describe("head control", () => {
  it("learns the resting pose first, then a still head does nothing", () => {
    const r = new HeadRecognizer();
    const a = run(r, 0, 300, () => ({}));
    expect(r.state().calibrating).toBe(true);
    const b = run(r, a.t, 2000, () => ({ yaw: rest.yaw + 0.03, pitch: rest.pitch - 0.03 }));
    expect(kinds(b.events)).toEqual([]);
    expect(r.state().calibrating).toBe(false);
  });

  it("turning right turns the view right, harder turn = faster", () => {
    const { r, t } = calibrated();
    const small = run(r, t, 1000, () => ({ yaw: rest.yaw + 0.2 }));
    const { r: r2, t: t2 } = calibrated();
    const big = run(r2, t2, 1000, () => ({ yaw: rest.yaw + 0.4 }));
    expect(sum(small.events, "yaw")).toBeGreaterThan(0.05);
    expect(sum(big.events, "yaw")).toBeGreaterThan(sum(small.events, "yaw") * 2);
    const { r: r3, t: t3 } = calibrated();
    expect(sum(run(r3, t3, 1000, () => ({ yaw: rest.yaw - 0.3 })).events, "yaw")).toBeLessThan(-0.1);
  });

  it("head up rises over the top, head down drops under; lean in zooms", () => {
    let { r, t } = calibrated();
    expect(sum(run(r, t, 1000, () => ({ pitch: rest.pitch + 0.25 })).events, "pitch")).toBeGreaterThan(0.1);
    ({ r, t } = calibrated());
    expect(sum(run(r, t, 1000, () => ({ pitch: rest.pitch - 0.25 })).events, "pitch")).toBeLessThan(-0.1);
    ({ r, t } = calibrated());
    expect(sum(run(r, t, 1000, () => ({ distance: 38 })).events, "zoom")).toBeGreaterThan(0.1);
  });

  it("invert flips direction", () => {
    const r = new HeadRecognizer({ invertYaw: true });
    const a = run(r, 0, 800, () => ({}));
    expect(sum(run(r, a.t, 1000, () => ({ yaw: rest.yaw + 0.3 })).events, "yaw")).toBeLessThan(0);
  });

  it("a quick mouth open selects at the reticle, without steering", () => {
    const { r, t } = calibrated();
    const a = run(r, t, 250, () => ({ jawOpen: 0.6 }));
    const b = run(r, a.t, 400, () => ({}));
    const ev = [...a.events, ...b.events];
    expect(kinds(ev)).toEqual(["select"]);
    expect(ev.find((e) => e.type === "select")).toMatchObject({ at: { x: 0.5, y: 0.5 } });
  });

  it("mouth open + head move grabs and drags, and doesn't steer meanwhile", () => {
    const { r, t } = calibrated();
    const a = run(r, t, 150, () => ({ jawOpen: 0.6 }));
    const b = run(r, a.t, 800, (k) => ({ jawOpen: 0.6, yaw: rest.yaw + 0.3 * k }));
    const c = run(r, b.t, 300, () => ({ jawOpen: 0.05, yaw: rest.yaw + 0.3 }));
    const ev = [...a.events, ...b.events, ...c.events];
    const k = kinds(ev);
    expect(k[0]).toBe("panstart");
    expect(k).toContain("panend");
    expect(k).not.toContain("select");
    expect(sum(ev, "dx")).toBeGreaterThan(0.2); // turned right: the view slid right with it
    // the turn happened while grabbing, so no orbit before the release settles
    expect(ev.slice(0, ev.findIndex((e) => e.type === "panend")).some((e) => e.type === "orbit")).toBe(false);
  });

  it("eyebrows up and held resets, once", () => {
    const { r, t } = calibrated();
    const a = run(r, t, 1200, () => ({ browUp: 0.8 }));
    expect(kinds(a.events)).toEqual(["reset"]);
    const short = calibrated();
    expect(kinds(run(short.r, short.t, 400, () => ({ browUp: 0.8 })).events)).toEqual([]);
  });

  it("losing the face mid-grab ends the grab", () => {
    const { r, t } = calibrated();
    const a = run(r, t, 700, (k) => ({ jawOpen: 0.6, yaw: rest.yaw + 0.2 * k }));
    const b = run(r, a.t, 500, () => null);
    expect(kinds(a.events)).toContain("panstart");
    expect(kinds(b.events)).toEqual(["panend"]);
  });
});

describe("gamepad", () => {
  const axes = (lx = 0, ly = 0, rx = 0, ry = 0) => [lx, ly, rx, ry];
  const btn = (on: number[] = [], analog: Record<number, number> = {}) => Array.from({ length: 17 }, (_, i) => analog[i] ?? (on.includes(i) ? 1 : 0));
  function drive(r: GamepadRecognizer, t0: number, ms: number, a: number[], b: number[]) {
    const out: GestureEvent[] = [];
    let t = t0;
    for (; t < t0 + ms; t += 16) out.push(...r.update({ t, pad: { axes: a, buttons: b } }));
    return { events: out, t };
  }

  it("ignores stick drift inside the deadzone", () => {
    const r = new GamepadRecognizer();
    expect(kinds(drive(r, 0, 1000, axes(0.1, -0.08, 0.12, 0.05), btn()).events)).toEqual([]);
  });

  it("right stick turns and flies over; left stick slides; triggers zoom", () => {
    const r = new GamepadRecognizer();
    let x = drive(r, 0, 1000, axes(0, 0, 1, 0), btn());
    expect(sum(x.events, "yaw")).toBeGreaterThan(1.5);
    x = drive(r, x.t, 1000, axes(0, 0, 0, -1), btn());
    expect(sum(x.events, "pitch")).toBeGreaterThan(1);
    x = drive(r, x.t, 1000, axes(1, 0, 0, 0), btn());
    expect(sum(x.events, "dx")).toBeLessThan(-0.5);
    x = drive(r, x.t, 1000, axes(), btn([], { [PAD.RT]: 1 }));
    expect(sum(x.events, "zoom")).toBeGreaterThan(1);
    x = drive(r, x.t, 1000, axes(), btn([], { [PAD.LT]: 0.6 }));
    expect(sum(x.events, "zoom")).toBeLessThan(-0.5);
  });

  it("buttons fire once per press: A select, B clear, Y reset", () => {
    const r = new GamepadRecognizer();
    let x = drive(r, 0, 300, axes(), btn([PAD.A]));
    expect(kinds(x.events)).toEqual(["select"]);
    x = drive(r, x.t, 100, axes(), btn());
    x = drive(r, x.t, 100, axes(), btn([PAD.B]));
    expect(x.events.find((e) => e.type === "select")).toMatchObject({ at: NOWHERE });
    x = drive(r, x.t, 100, axes(), btn([PAD.Y]));
    expect(kinds(x.events)).toEqual(["reset"]);
  });
});

describe("face matrix", () => {
  // a face 50 cm in front, turned by `yaw` about y (column-major, like WebGL)
  const mat = (yaw: number, pitch = 0) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry(yaw) · Rx(-pitch): the forward axis tips up for + pitch
    const R = [[cy, -sy * sp, sy * cp], [0, cp, sp], [-sy, -cy * sp, cy * cp]];
    const d = new Array(16).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) d[c * 4 + r] = R[r][c];
    d[12] = 2; d[13] = -1; d[14] = -50; d[15] = 1;
    return d;
  };
  it("reads yaw, pitch and distance in either array order", () => {
    const a = readFaceMatrix(mat(0.3));
    expect(a.yaw).toBeCloseTo(-0.3, 5);
    expect(a.distance).toBeCloseTo(Math.hypot(2, 1, 50), 3);
    const m = mat(0.2, 0.25);
    const rowMajor = Array.from({ length: 16 }, (_, i) => m[(i % 4) * 4 + Math.floor(i / 4)]);
    const b = readFaceMatrix(rowMajor);
    expect(b.yaw).toBeCloseTo(readFaceMatrix(m).yaw, 5);
    expect(b.pitch).toBeCloseTo(0.25, 5);
  });
});

describe("orbit camera: steering", () => {
  const v3 = (x: number, y: number, z: number) => ({ x, y, z, set(a: number, b: number, c: number) { this.x = a; this.y = b; this.z = c; } });
  const view = () => {
    const camera = { position: v3(0, 0, 100), up: v3(0, 1, 0), fov: 50, lookAt() {} };
    const target = v3(0, 0, 0);
    const element = { getBoundingClientRect: () => ({ width: 1600, height: 900 }) } as unknown as HTMLElement;
    return { camera, target, element };
  };
  const orbit = (p: Partial<{ yaw: number; pitch: number; zoom: number; dx: number; dy: number }>): GestureEvent =>
    ({ type: "orbit", yaw: 0, pitch: 0, zoom: 0, dx: 0, dy: 0, ...p });

  it("pitch rises over the top and stops short of straight down", () => {
    const v = view();
    const a = createOrbitAdapter({ getView: () => v, zoomGain: 1, rotateGain: 1 });
    a.handle(orbit({ pitch: 0.6 }));
    expect(Math.atan2(v.camera.position.y, Math.hypot(v.camera.position.x, v.camera.position.z))).toBeCloseTo(0.6, 4);
    expect(Math.hypot(v.camera.position.x, v.camera.position.y, v.camera.position.z)).toBeCloseTo(100, 4);
    for (let i = 0; i < 20; i++) a.handle(orbit({ pitch: 0.3 }));
    expect(v.camera.position.y).toBeLessThan(100);
    expect(Math.atan2(v.camera.position.y, Math.hypot(v.camera.position.x, v.camera.position.z))).toBeCloseTo(1.48, 3);
  });

  it("yaw turns about the vertical; zoom moves in", () => {
    const v = view();
    const a = createOrbitAdapter({ getView: () => v, zoomGain: 1, rotateGain: 1 });
    a.handle(orbit({ yaw: Math.PI / 2 }));
    expect(Math.abs(v.camera.position.x)).toBeCloseTo(100, 3);
    expect(v.camera.position.z).toBeCloseTo(0, 3);
    a.handle(orbit({ zoom: Math.log(2) }));
    expect(Math.hypot(v.camera.position.x, v.camera.position.z)).toBeCloseTo(50, 3);
  });
});
