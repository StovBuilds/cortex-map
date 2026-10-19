// Runs the on-device speech model (Whisper, via transformers.js) off the main
// thread, so tracking and rendering never stall while it thinks. Downloads the
// model once (the browser caches it); audio never leaves the device.

type In = { id: number; type: "load"; model: string; device?: "webgpu" | "wasm" } | { id: number; type: "transcribe"; audio: Float32Array };

let english = false;
let asr: ((audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>) | null = null;
let loading: Promise<void> | null = null;

const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage(m);

async function load(model: string, device?: "webgpu" | "wasm") {
  const { pipeline, env } = await import("@huggingface/transformers");
  english = /\.en$/.test(model); // English-only models take no language / task
  env.allowLocalModels = false;
  const make = (dev: "webgpu" | "wasm") => pipeline("automatic-speech-recognition", model, {
    device: dev,
    // small and quick: 8-bit weights (about 40 MB for tiny.en)
    dtype: dev === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === "progress") post({ type: "progress", file: p.file, progress: p.progress });
    },
  }) as unknown as Promise<typeof asr>;
  // WebGPU only if there's a real adapter behind it (headless and some laptops say yes, then have none)
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const hasGpu = gpu ? await gpu.requestAdapter().then((a) => !!a, () => false) : false;
  const want = device ?? (hasGpu ? "webgpu" : "wasm");
  try { asr = await make(want); }
  catch (e) { if (want === "wasm") throw e; asr = await make("wasm"); }
}

self.onmessage = async (ev: MessageEvent<In>) => {
  const m = ev.data;
  try {
    if (m.type === "load") {
      loading ??= load(m.model, m.device);
      await loading;
      post({ id: m.id, type: "ready" });
    } else {
      if (!asr) await loading;
      const out = await asr!(m.audio, english ? {} : { language: "english", task: "transcribe" });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      post({ id: m.id, type: "text", text: text.trim() });
    }
  } catch (e) {
    loading = null;
    post({ id: m.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
