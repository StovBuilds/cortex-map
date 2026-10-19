import { describe, expect, it } from "vitest";
import { bestMatch, nameScore, parseCommand } from "../src/voiceCommands";
import { encodeWav, to16k, Utterances } from "../src/voice";

describe("voice: what was said → a command", () => {
  const cases: [string, unknown][] = [
    ["Fly to Engine pipeline.", { kind: "fly", name: "engine pipeline" }],
    ["OK, take me to the build automation node please", { kind: "fly", name: "build automation" }],
    ["Show me analytics stack", { kind: "fly", name: "analytics stack" }],
    ["How is engine pipeline connected to soundtrack sketches?", { kind: "path", from: "engine pipeline", to: "soundtrack sketches" }],
    ["Connect playtests and people", { kind: "path", from: "playtests", to: "people" }],
    ["Spread the tools cluster", { kind: "spread", name: "tools" }],
    ["Pull apart research", { kind: "spread", name: "research" }],
    ["Pin grappling hook physics", { kind: "pin", name: "grappling hook physics" }],
    ["Reset.", { kind: "reset" }],
    ["Go home", { kind: "reset" }],
    ["Clear the selection", { kind: "clear" }],
    ["Select this one", { kind: "select" }],
    ["Zoom in", { kind: "zoom", dir: 1 }],
    ["Zoom out.", { kind: "zoom", dir: -1 }],
    ["Turn left", { kind: "turn", dir: -1 }],
    ["Look up", { kind: "tilt", dir: 1 }],
    ["Stop", { kind: "stop" }],
    ["Help.", { kind: "help" }],
    ["What can I say?", { kind: "help" }],
    ["Show me the moves", { kind: "help" }],
    ["show me the engine", { kind: "fly", name: "engine" }],
    // what Whisper tiny actually heard for "fly to engine pipeline"
    ["Flight Engine Pipeline", { kind: "fly", name: "engine pipeline" }],
    ["Fly engine pipeline", { kind: "fly", name: "engine pipeline" }],
  ];
  for (const [text, want] of cases) it(JSON.stringify(text), () => expect(parseCommand(text)).toEqual(want));
  it("ignores everything else (it only acts on commands)", () => {
    for (const t of ["", "I think this is lovely", "and so my fellow Americans", "what time is it", "pin this"]) expect(parseCommand(t)).toBeNull();
  });
});

describe("voice: names, misheard", () => {
  const labels = ["Engine pipeline", "Build automation", "Analytics stack", "grappling hook physics", "soundtrack sketches", "Studio brain"];
  it("finds the right name through typical speech-to-text slips", () => {
    expect(bestMatch("engine pipe line", labels, (x) => x)?.item).toBe("Engine pipeline");
    expect(bestMatch("grappling hook physic", labels, (x) => x)?.item).toBe("grappling hook physics");
    expect(bestMatch("sound track sketches", labels, (x) => x)?.item).toBe("soundtrack sketches");
    expect(bestMatch("studio brian", labels, (x) => x)?.item).toBe("Studio brain");
    expect(bestMatch("analytics", labels, (x) => x)?.item).toBe("Analytics stack");
  });
  it("won't guess when nothing is close", () => {
    expect(bestMatch("banana bread", labels, (x) => x)).toBeNull();
    expect(nameScore("x", "Engine pipeline")).toBeLessThan(0.3);
  });
});

describe("voice: audio plumbing", () => {
  const tone = (ms: number, amp: number, rate = 16000) => Float32Array.from({ length: Math.round((rate * ms) / 1000) }, (_, i) => amp * Math.sin((i / rate) * 2 * Math.PI * 220));
  it("cuts speech out of silence, with a little lead-in", () => {
    const u = new Utterances({ ratio: 3, endSilenceMs: 300, minMs: 200, maxMs: 5000, frameMs: 32, preMs: 128 });
    const frame = 512, frames: Float32Array[] = [];
    const add = (s: Float32Array) => { for (let i = 0; i + frame <= s.length; i += frame) frames.push(s.slice(i, i + frame)); };
    add(tone(1000, 0.002)); add(tone(800, 0.3)); add(tone(800, 0.002));
    const outs = frames.map((f) => u.push(f)).filter(Boolean) as Float32Array[];
    expect(outs).toHaveLength(1);
    const ms = (outs[0].length / 16000) * 1000;
    expect(ms).toBeGreaterThan(900);   // 800 ms of speech + lead-in + the tail of silence
    expect(ms).toBeLessThan(1400);
  });
  it("a click is too short to be speech", () => {
    const u = new Utterances({ ratio: 3, endSilenceMs: 300, minMs: 200, maxMs: 5000, frameMs: 32, preMs: 128 });
    const outs = [...Array(20)].map((_, i) => u.push(i >= 10 && i < 12 ? tone(32, 0.5) : tone(32, 0.002))).filter(Boolean);
    expect(outs).toHaveLength(0);
  });
  it("resamples to 16 kHz and writes a valid WAV", async () => {
    const x = to16k(tone(1000, 0.5, 48000), 48000);
    expect(x.length).toBe(16000);
    const wav = encodeWav(x);
    expect(wav.size).toBe(44 + 32000);
    const head = new Uint8Array(await wav.arrayBuffer()).slice(0, 12);
    expect(String.fromCharCode(...head.slice(0, 4), ...head.slice(8, 12))).toBe("RIFFWAVE");
  });
});
