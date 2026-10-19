import { describe, expect, it } from "vitest";
import { Pacer } from "../src/pacer";
import { flashWord } from "../src/controller";

describe("Pacer", () => {
  it("runs every frame while something is in view", () => {
    const p = new Pacer();
    p.reset(0);
    let ran = 0;
    for (let t = 0; t < 5000; t += 16) { if (p.due(t)) { ran++; p.saw(t, true); } }
    expect(ran).toBe(Math.ceil(5000 / 16));
  });

  it("slows to a few checks a second once nothing has been seen, and is back at full rate on the next sighting", () => {
    const p = new Pacer({ idleAfterMs: 2000, idleIntervalMs: 125 });
    p.reset(0);
    const ranAt: number[] = [];
    for (let t = 0; t < 6000; t += 16) if (p.due(t)) { ranAt.push(t); p.saw(t, t >= 5000); }
    const early = ranAt.filter((t) => t < 2000).length;
    const idle = ranAt.filter((t) => t > 2200 && t < 4200).length;
    const back = ranAt.filter((t) => t > 5200).length;
    expect(early).toBeGreaterThan(120);         // full rate at the start
    expect(idle).toBeGreaterThanOrEqual(14);    // ~8 / s while idle
    expect(idle).toBeLessThanOrEqual(17);
    expect(back).toBeGreaterThan(45);           // full rate again after the hand came back
    expect(ranAt.some((t) => t >= 5000 && t < 5000 + 125)).toBe(true); // caught within one slow tick
  });
});

describe("flashWord", () => {
  it("names the gestures that land, and stays quiet for the continuous ones", () => {
    expect(flashWord({ type: "select", at: { x: 0, y: 0 } })).toBe("select");
    expect(flashWord({ type: "panstart", at: { x: 0, y: 0 }, held: true })).toBe("pick up");
    expect(flashWord({ type: "twostart", at: { x: 0, y: 0 } })).toBe("zoom · turn");
    expect(flashWord({ type: "drawend", path: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true })).toBe("loop");
    expect(flashWord({ type: "pose", name: "rock", at: { x: 0, y: 0 } })).toBe("rock");
    expect(flashWord({ type: "pan", dx: 1, dy: 0, at: { x: 0, y: 0 } })).toBeNull();
    expect(flashWord({ type: "hover", at: null })).toBeNull();
  });
});
