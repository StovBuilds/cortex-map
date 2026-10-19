// Webcam → MediaPipe Hand Landmarker → FrameInput. Runs entirely in the
// browser: the video is read into the page and never sent anywhere. The only
// network traffic is fetching the model + WASM runtime once (self-host them
// by passing wasmBase / modelUrl).

import type { FrameInput, HandInput } from "./types";
import { acquireCamera, releaseCamera } from "./camera";
import { Pacer, type PaceOptions } from "./pacer";

export interface TrackerOptions {
  /** Folder holding MediaPipe's vision_wasm_* files. */
  wasmBase?: string;
  /** hand_landmarker.task model URL. */
  modelUrl?: string;
  numHands?: number;
  /** Requested camera resolution (the model runs at its own internal size). */
  width?: number;
  height?: number;
  /** Slow detection down while nothing is in view (default on); false = every frame always. */
  pace?: PaceOptions | false;
}

export const MEDIAPIPE_VERSION = "1.1.0";
const DEFAULT_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type Landmarker = {
  detectForVideo(v: HTMLVideoElement, ts: number): { landmarks: { x: number; y: number; z: number }[][]; handedness?: { categoryName: string }[][] };
  close(): void;
};

export class HandTracker {
  readonly video: HTMLVideoElement;
  private landmarker: Landmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private pacer: Pacer | null = null;
  /** True while nothing has been seen for a while and detection is running slow. */
  get idle() { return !!this.pacer?.idle(performance.now()); }
  /** Measured detection rate, frames / s. */
  fps = 0;

  constructor(private o: TrackerOptions = {}) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  /** Load the model (can be called early, before asking for the camera). */
  async load(): Promise<void> {
    if (this.landmarker) return;
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(this.o.wasmBase ?? DEFAULT_WASM);
    const make = (delegate: "GPU" | "CPU") => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: this.o.modelUrl ?? DEFAULT_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: this.o.numHands ?? 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try { this.landmarker = (await make("GPU")) as unknown as Landmarker; }
    catch { this.landmarker = (await make("CPU")) as unknown as Landmarker; }
  }

  /** Start the camera and call `onFrame` for every processed video frame. */
  async start(onFrame: (f: FrameInput) => void): Promise<void> {
    await this.load();
    // shared with any other tracker on the page: one camera, one permission prompt
    if (!this.stream) this.stream = await acquireCamera(this.o.width ?? 640, this.o.height ?? 480);
    this.video.srcObject = this.stream;
    await this.video.play();
    await this.runOn(onFrame);
  }

  /** Track a video that is already playing (a recording, for tests and replays). */
  async startOnVideo(src: string, onFrame: (f: FrameInput) => void): Promise<void> {
    await this.load();
    this.video.srcObject = null;
    this.video.src = src;
    this.video.loop = true;
    await this.video.play();
    await this.runOn(onFrame);
  }

  private async runOn(onFrame: (f: FrameInput) => void) {
    this.running = true;
    this.pacer = this.o.pace === false ? null : new Pacer(this.o.pace || {});
    this.pacer?.reset(performance.now());
    let frames = 0, since = performance.now();
    const tick = () => {
      if (!this.running) return;
      const v = this.video;
      const now = performance.now();
      if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime && this.landmarker && (!this.pacer || this.pacer.due(now))) {
        this.lastVideoTime = v.currentTime;
        const t = now;
        const res = this.landmarker.detectForVideo(v, t);
        this.pacer?.saw(t, res.landmarks.length > 0);
        const hands: HandInput[] = res.landmarks.map((landmarks, i) => ({
          landmarks,
          handedness: res.handedness?.[i]?.[0]?.categoryName as HandInput["handedness"],
        }));
        onFrame({ t, hands });
        frames++;
        if (t - since > 1000) { this.fps = (frames * 1000) / (t - since); frames = 0; since = t; }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Video width / height once the camera is running. */
  get aspect(): number {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) releaseCamera();
    this.stream = null;
    this.video.srcObject = null;
  }

  dispose() {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
  }
}
