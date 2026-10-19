// Voice commands: the microphone → speech-to-text → a command → events.
//
// Speech-to-text runs on the device by default (Whisper tiny, in a worker; a
// ~40 MB download, once). Or bring your own key for an OpenAI-compatible
// transcription API (OpenAI, Groq, or any URL that speaks the same API): the
// key stays in this browser and is sent only to that provider, with the audio
// of each command. Nothing is listened to until you switch voice on, and it
// only acts on phrases it understands (see voiceCommands.ts).

import { parseCommand, type VoiceCommand } from "./voiceCommands";
import { Feedback } from "./feedback";
import type { GestureAdapter, GestureEvent, Point } from "./types";

export type VoiceProvider =
  | { kind: "local"; model?: string }
  | { kind: "api"; url: string; key: string; model: string };

export const VOICE_PRESETS = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
} as const;

export const LOCAL_MODEL = "onnx-community/whisper-tiny.en";

export interface VoiceOptions {
  adapter: GestureAdapter;
  provider?: VoiceProvider;
  /** Where "select" / "zoom" aim (surface coords). Default the middle. */
  reticle?: Point;
  /** Words to help an API provider spell your content (node names). */
  vocabulary?: () => string[];
  /** Feedback sounds (off by default). */
  sound?: boolean;
  /** Speech detection: RMS above the noise floor × this starts an utterance. */
  vadRatio?: number;
  /** Silence (ms) that ends an utterance. */
  endSilenceMs?: number;
}

export interface VoiceState {
  status: "off" | "loading" | "listening" | "hearing" | "thinking" | "error";
  /** 0..1 microphone level. */
  level: number;
  /** Model download progress, 0..1, while loading. */
  progress: number;
  /** The last thing heard, and what it was taken to mean. */
  heard: string;
  command: VoiceCommand | null;
  error: string;
}

type Listener = (events: GestureEvent[], s: VoiceState) => void;

/** Turn audio samples into a 16-bit PCM WAV (what transcription APIs take). */
export function encodeWav(samples: Float32Array, rate = 16000): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Linear resample to 16 kHz. */
export function to16k(input: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return input;
  const n = Math.floor((input.length * 16000) / rate);
  const out = new Float32Array(n);
  const k = rate / 16000;
  for (let i = 0; i < n; i++) {
    const x = i * k, i0 = Math.floor(x), f = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i0 + 1] ?? input[i0] ?? 0) * f;
  }
  return out;
}

/**
 * Cuts a stream of audio frames into utterances by loudness: speech starts
 * when a frame is well above the running noise floor, ends after a stretch of
 * quiet. Pure, so tests can feed it.
 */
export class Utterances {
  private floor = 0.004;
  private loudFrames = 0;
  private quietMs = 0;
  private chunks: Float32Array[] = [];
  private pre: Float32Array[] = [];
  private speaking = false;
  constructor(private o: { ratio: number; endSilenceMs: number; minMs: number; maxMs: number; frameMs: number; preMs: number }) {}
  get active() { return this.speaking; }

  /** One frame (frameMs of audio). Returns a finished utterance, if this frame ended one. */
  push(frame: Float32Array): Float32Array | null {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const loud = rms > Math.max(0.012, this.floor * this.o.ratio);
    if (!this.speaking) {
      // the floor follows the room while nobody is talking
      this.floor += (Math.min(rms, 0.05) - this.floor) * 0.05;
      this.pre.push(frame);
      while (this.pre.length * this.o.frameMs > this.o.preMs) this.pre.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= 2) { this.speaking = true; this.chunks = [...this.pre]; this.pre = []; this.quietMs = 0; }
      return null;
    }
    this.chunks.push(frame);
    this.quietMs = loud ? 0 : this.quietMs + this.o.frameMs;
    const ms = this.chunks.length * this.o.frameMs;
    if (this.quietMs >= this.o.endSilenceMs || ms >= this.o.maxMs) {
      this.speaking = false;
      this.loudFrames = 0;
      const all = this.chunks; this.chunks = [];
      if (ms - this.quietMs < this.o.minMs) return null;
      const out = new Float32Array(all.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of all) { out.set(c, o); o += c.length; }
      return out;
    }
    return null;
  }
  /** The live level, 0..1, for a meter. */
  static level(frame: Float32Array) { let m = 0; for (let i = 0; i < frame.length; i++) m = Math.max(m, Math.abs(frame[i])); return Math.min(1, m * 3); }
}

export class VoiceController {
  readonly feedback: Feedback;
  provider: VoiceProvider;
  private s: VoiceState = { status: "off", level: 0, progress: 0, heard: "", command: null, error: "" };
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private reqId = 0;
  private pending = new Map<number, { ok: (t: string) => void; fail: (e: Error) => void }>();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private cut: Utterances;
  private busy = false;
  /** Utterances heard while the last one was still being worked out (a short queue, oldest dropped). */
  private queue: Float32Array[] = [];
  private animRaf = 0;

  constructor(private o: VoiceOptions) {
    this.provider = o.provider ?? { kind: "local" };
    this.feedback = new Feedback(o.adapter, !!o.sound);
    this.cut = new Utterances({ ratio: o.vadRatio ?? 3.2, endSilenceMs: o.endSilenceMs ?? 650, minMs: 250, maxMs: 7000, frameMs: 32, preMs: 250 });
  }

  get running() { return this.s.status !== "off"; }
  state(): VoiceState { return { ...this.s }; }
  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit(events: GestureEvent[] = []) { const s = this.state(); for (const l of this.listeners) l(events, s); }
  private set(p: Partial<VoiceState>) { Object.assign(this.s, p); this.emit(); }

  /** Ask for the microphone and start listening (loading the on-device model first, if that's the provider). */
  async start() {
    if (this.running) return;
    this.set({ status: "loading", error: "", progress: 0 });
    try {
      if (this.provider.kind === "local") await this.loadLocal();
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      this.ctx = new AudioContext();
      const rate = this.ctx.sampleRate;
      const frame = Math.round(rate * 0.032);
      // a tiny worklet that hands back 32 ms frames
      const code = `registerProcessor("cg-frames", class extends AudioWorkletProcessor {
        constructor() { super(); this.buf = new Float32Array(${frame}); this.n = 0; }
        process(inputs) { const ch = inputs[0][0]; if (!ch) return true;
          for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; } }
          return true; } });`;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, "cg-frames");
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data, rate);
      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
      this.set({ status: "listening" });
    } catch (e) {
      this.stopAudio();
      const m = e instanceof Error ? e.message : String(e);
      this.set({ status: "error", error: /denied|NotAllowed/i.test(m) ? "Microphone permission was refused." : m });
      throw e;
    }
  }

  stop() {
    this.queue = [];
    this.stopAudio();
    cancelAnimationFrame(this.animRaf);
    this.feedback.clear();
    this.set({ status: "off", level: 0 });
  }

  dispose() { this.stop(); this.worker?.terminate(); this.worker = null; this.workerReady = null; this.listeners.clear(); }

  private stopAudio() {
    this.node?.disconnect(); this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.ctx?.close().catch(() => {}); this.ctx = null;
  }

  private loadLocal(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    this.worker = new Worker(new URL("./voiceWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<{ id?: number; type: string; text?: string; message?: string; progress?: number }>) => {
      const m = e.data;
      if (m.type === "progress" && this.s.status === "loading") { this.s.progress = (m.progress ?? 0) / 100; this.emit(); return; }
      const p = m.id != null ? this.pending.get(m.id) : undefined;
      if (!p) return;
      this.pending.delete(m.id!);
      if (m.type === "error") p.fail(new Error(m.message)); else p.ok(m.text ?? "");
    };
    const model = (this.provider.kind === "local" && this.provider.model) || LOCAL_MODEL;
    this.workerReady = this.ask({ type: "load", model }).then(() => {}, (e) => { this.workerReady = null; throw e; });
    return this.workerReady;
  }

  private ask(m: Record<string, unknown>, transfer: Transferable[] = []): Promise<string> {
    const id = ++this.reqId;
    return new Promise((ok, fail) => { this.pending.set(id, { ok, fail }); this.worker!.postMessage({ id, ...m }, transfer); });
  }

  private onFrame(frame: Float32Array, rate: number) {
    const level = Utterances.level(frame);
    const was = this.cut.active;
    const utt = this.cut.push(frame);
    if (this.cut.active !== was || Math.abs(level - this.s.level) > 0.05) {
      this.s.level = level;
      if (!this.busy) this.s.status = this.cut.active ? "hearing" : "listening";
      this.emit();
    }
    if (!utt) return;
    const a = to16k(utt, rate);
    if (this.busy) { this.queue.push(a); if (this.queue.length > 2) this.queue.shift(); }
    else void this.handle(a);
  }

  /** Transcribe one utterance (16 kHz mono) and act on it. Also the way in for tests and recordings. */
  async handle(audio16k: Float32Array): Promise<VoiceCommand | null> {
    this.busy = true;
    this.set({ status: "thinking" });
    try {
      const text = await this.transcribe(audio16k);
      return this.hear(text);
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      this.busy = false;
      if (this.s.status === "thinking") this.set({ status: this.stream ? "listening" : "off" });
      const next = this.queue.shift();
      if (next && this.stream) void this.handle(next);
    }
  }

  /** Act on text as if it had been said. */
  hear(text: string): VoiceCommand | null {
    const cmd = parseCommand(text);
    this.s.heard = text;
    this.s.command = cmd;
    const events = cmd ? this.toEvents(cmd) : [];
    if (cmd && events.length) this.run(events);
    else this.emit();
    return cmd;
  }

  private async transcribe(audio: Float32Array): Promise<string> {
    const p = this.provider;
    if (p.kind === "local") {
      await this.loadLocal();
      return this.ask({ type: "transcribe", audio }, [audio.buffer]);
    }
    const form = new FormData();
    form.append("file", encodeWav(audio), "speech.wav");
    form.append("model", p.model);
    form.append("response_format", "json");
    const vocab = this.o.vocabulary?.().slice(0, 60).join(", ");
    // the prompt helps the model spell names; it's only a hint
    form.append("prompt", `Voice commands for a map: fly to, connect, spread, pin, reset, zoom in.${vocab ? ` Names: ${vocab}.` : ""}`.slice(0, 800));
    const r = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
    if (!r.ok) throw new Error(`Transcription failed (${r.status}): ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { text?: string };
    return (j.text ?? "").trim();
  }

  private toEvents(c: VoiceCommand): GestureEvent[] {
    const at = this.o.reticle ?? { x: 0.5, y: 0.5 };
    switch (c.kind) {
      case "reset": return [{ type: "reset" }];
      case "clear": return [{ type: "select", at: { x: -10, y: -10 } }];
      case "select": return [{ type: "hover", at }, { type: "select", at }];
      case "stop": return [{ type: "press", at }];
      case "help": return []; // the app shows its moves (it sees the command in the state)
      // camera moves ease in over a moment, rather than jump
      case "zoom": this.glide({ zoom: 0.55 * c.dir }); return [];
      case "turn": this.glide({ yaw: 0.7 * c.dir }); return [];
      case "tilt": this.glide({ pitch: 0.4 * c.dir }); return [];
      default: return [{ type: "command", command: c }];
    }
  }

  private glide(total: { yaw?: number; pitch?: number; zoom?: number }) {
    cancelAnimationFrame(this.animRaf);
    const t0 = performance.now(), ms = 450;
    let done = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k * k * (3 - 2 * k), d = e - done;
      done = e;
      this.run([{ type: "orbit", yaw: (total.yaw ?? 0) * d, pitch: (total.pitch ?? 0) * d, zoom: (total.zoom ?? 0) * d, dx: 0, dy: 0 }]);
      if (k < 1) this.animRaf = requestAnimationFrame(tick);
    };
    this.animRaf = requestAnimationFrame(tick);
  }

  private run(events: GestureEvent[]) {
    for (const e of events) this.o.adapter.handle(e);
    this.feedback.after(events);
    const s = this.state();
    for (const l of this.listeners) l(events, s);
  }
}
