import { afterEach, describe, expect, it, vi } from "vitest";
import { Dwell } from "../src/dwell";
import { pickStep } from "../src/adapters/cortexMap";
import { GamepadRecognizer, PAD } from "../src/gamepad";
import { Feedback } from "../src/feedback";
import { acquireCamera, releaseCamera, cameraStats } from "../src/camera";
import type { GestureAdapter, GestureEvent, Target } from "../src/types";

describe("look-to-select (dwell)", () => {
  const A: Target = { id: "a" }, B: Target = { id: "b" };
  const run = (d: Dwell, t0: number, ms: number, target: Target | null, busy = false) => {
    let fired = 0, t = t0;
    for (; t < t0 + ms; t += 33) if (d.update(t, target, busy)) fired++;
    return { fired, t };
  };

  it("selects after holding still on one target, once", () => {
    const d = new Dwell({ ms: 1000 });
    let x = run(d, 0, 900, A);
    expect(x.fired).toBe(0);
    expect(d.progress).toBeGreaterThan(0.8);
    x = run(d, x.t, 3000, A);
    expect(x.fired).toBe(1);
  });

  it("moving between targets restarts the clock; coming back re-arms", () => {
    const d = new Dwell({ ms: 1000 });
    let x = run(d, 0, 1200, A);
    expect(x.fired).toBe(1);
    x = run(d, x.t, 600, B);
    x = run(d, x.t, 600, A);
    expect(x.fired).toBe(0);
    x = run(d, x.t, 500, A);
    expect(x.fired).toBe(1);
  });

  it("busy (steering, mouth) pauses it, and ms 0 turns it off", () => {
    const d = new Dwell({ ms: 1000 });
    expect(run(d, 0, 3000, A, true).fired).toBe(0);
    expect(d.progress).toBe(0);
    expect(run(new Dwell({ ms: 0 }), 0, 3000, A).fired).toBe(0);
    expect(run(new Dwell(), 0, 3000, null).fired).toBe(0);
  });
});

describe("d-pad hop", () => {
  const from = { x: 500, y: 500 };
  const nodes = [
    { id: "right-near", x: 600, y: 520 },
    { id: "right-far", x: 900, y: 500 },
    { id: "up", x: 510, y: 300 },
    { id: "left-diag", x: 380, y: 620 },
  ];
  it("picks the nearest node lying that way", () => {
    expect(pickStep(from, { dx: 1, dy: 0 }, nodes)).toBe("right-near");
    expect(pickStep(from, { dx: 0, dy: -1 }, nodes)).toBe("up");
    expect(pickStep(from, { dx: -1, dy: 0 }, nodes)).toBe("left-diag");
  });
  it("nothing that way: no hop", () => {
    expect(pickStep(from, { dx: 0, dy: 1 }, nodes.slice(0, 3))).toBeNull();
    expect(pickStep(from, { dx: 1, dy: 0 }, [])).toBeNull();
  });
  it("a close node well off-axis loses to a farther one on it", () => {
    expect(pickStep(from, { dx: 1, dy: 0 }, [{ id: "off", x: 560, y: 570 }, { id: "on", x: 640, y: 505 }])).toBe("on");
  });

  it("the pad sends one step per d-pad press", () => {
    const r = new GamepadRecognizer();
    const btn = (on: number[]) => Array.from({ length: 17 }, (_, i) => (on.includes(i) ? 1 : 0));
    const steps: GestureEvent[] = [];
    let t = 0;
    for (const on of [[PAD.RIGHT], [PAD.RIGHT], [PAD.RIGHT], [], [PAD.UP], [PAD.UP], [], [PAD.LEFT], [PAD.DOWN]]) {
      steps.push(...r.update({ t: (t += 16), pad: { axes: [0, 0, 0, 0], buttons: btn(on) } }).filter((e) => e.type === "step"));
    }
    expect(steps).toEqual([
      { type: "step", dx: 1, dy: 0 },
      { type: "step", dx: 0, dy: -1 },
      { type: "step", dx: -1, dy: 0 },
      { type: "step", dx: 0, dy: 1 },
    ]);
  });
});

describe("feedback", () => {
  const adapter = (get: () => Target | null): GestureAdapter => ({ handle() {}, target: get });
  const hover: GestureEvent = { type: "hover", at: { x: 0.5, y: 0.5 } };

  it("ticks when a new target is acquired, not while it stays", () => {
    let cur: Target | null = null;
    const f = new Feedback(adapter(() => cur), true);
    f.sound.tickGapMs = 0;
    f.after([hover]);
    cur = { id: "n1", label: "One" };
    f.after([hover]);
    f.after([hover]);
    cur = { id: "n2" };
    f.after([hover]);
    expect(f.sound.log).toEqual(["target", "target"]);
    expect(f.target).toEqual({ id: "n2" });
  });

  it("only reads the target after its own hover (another input may own the hover)", () => {
    let cur: Target | null = { id: "hands-thing" };
    const f = new Feedback(adapter(() => cur), true);
    f.after([{ type: "orbit", yaw: 0.1, pitch: 0, zoom: 0, dx: 0, dy: 0 }]);
    expect(f.target).toBeNull();
    expect(f.sound.log).toEqual([]);
    cur = { id: "mine" };
    f.after([hover]);
    expect(f.target).toEqual({ id: "mine" });
  });

  it("sounds actions, and no tick straight after a select or hop", () => {
    let cur: Target | null = null;
    const f = new Feedback(adapter(() => cur), true);
    f.after([{ type: "select", at: { x: 0.5, y: 0.5 } }]);
    cur = { id: "n1" };
    f.after([hover]);
    f.after([{ type: "select", at: { x: -10, y: -10 } }, { type: "reset" }, { type: "panstart", at: { x: 0, y: 0 } }, { type: "step", dx: 1, dy: 0 }]);
    expect(f.sound.log).toEqual(["select", "clear", "reset", "grab", "step"]);
  });

  it("silent unless switched on", () => {
    const f = new Feedback(adapter(() => ({ id: "x" })));
    f.after([hover, { type: "reset" }]);
    expect(f.sound.log).toEqual([]);
    expect(f.target).toEqual({ id: "x" });
  });
});

describe("shared camera", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("hands and head share one stream; the camera stops when both let go", async () => {
    const stop = vi.fn();
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: gum } });
    const before = cameraStats.opened;
    const a = await acquireCamera();
    const b = await acquireCamera();
    expect(a).toBe(b);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(cameraStats.opened - before).toBe(1);
    releaseCamera();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    releaseCamera();
    await new Promise((r) => setTimeout(r, 0));
    expect(stop).toHaveBeenCalledTimes(1);
    await acquireCamera();
    expect(gum).toHaveBeenCalledTimes(2);
    releaseCamera();
  });

  it("a refused camera can be asked for again", async () => {
    const gum = vi.fn().mockRejectedValueOnce(new Error("NotAllowedError")).mockResolvedValue({ getTracks: () => [] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: gum } });
    await expect(acquireCamera()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await acquireCamera();
    expect(gum).toHaveBeenCalledTimes(2);
    releaseCamera();
  });
});
