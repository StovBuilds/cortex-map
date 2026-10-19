// Webcam → MediaPipe Face Landmarker → FaceFrame (head angles, distance,
// mouth + eyebrow blendshapes). Like the hand tracker, it runs entirely in the
// browser: the video is read into the page and never sent anywhere.

import type { FaceFrame, FaceReading } from "./head";
import { MEDIAPIPE_VERSION } from "./tracker";
import { acquireCamera, releaseCamera } from "./camera";
import { Pacer, type PaceOptions } from "./pacer";

export interface FaceTrackerOptions {
  /** Folder holding MediaPipe's vision_wasm_* files. */
  wasmBase?: string;
  /** face_landmarker.task model URL. */
  modelUrl?: string;
  width?: number;
  height?: number;
  /** Slow detection down while nothing is in view (default on); false = every frame always. */
  pace?: PaceOptions | false;
}

const DEFAULT_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Result = {
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { rows: number; columns: number; data: number[] }[];
};
type Landmarker = { detectForVideo(v: HTMLVideoElement, ts: number): Result; close(): void };

/**
 * Head pose from MediaPipe's 4×4 face transform (canonical face → camera
 * space, metric, y up, the camera looking down -z). The face's forward axis is
 * the matrix's third column. The flat array's order isn't documented, so read
 * it whichever way puts the translation (tens of cm in front of the camera)
 * where a translation belongs.
 */
export function readFaceMatrix(d: ArrayLike<number>): Pick<FaceReading, "yaw" | "pitch" | "roll" | "distance" | "x" | "y"> {
  const colMajor = Math.abs(d[14]) >= Math.abs(d[11]);
  const m = (r: number, c: number) => (colMajor ? d[c * 4 + r] : d[r * 4 + c]);
  const fx = m(0, 2), fy = m(1, 2), fz = m(2, 2);
  // fx > 0: the nose points to the camera's right = the person's own left
  const yaw = -Math.atan2(fx, fz);
  const pitch = Math.atan2(fy, Math.hypot(fx, fz));
  const roll = Math.atan2(m(1, 0), m(0, 0));
  const distance = Math.hypot(m(0, 3), m(1, 3), m(2, 3));
  // where the head is: camera space, so + x = the camera's right = the person's own left
  return { yaw, pitch, roll, distance, x: -m(0, 3), y: m(1, 3) };
}

export function readBlendshapes(cats: { categoryName: string; score: number }[]): Pick<FaceReading, "jawOpen" | "browUp"> {
  const g = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;
  return { jawOpen: g("jawOpen"), browUp: Math.max(g("browInnerUp"), (g("browOuterUpLeft") + g("browOuterUpRight")) / 2) };
}

export class FaceTracker {
  readonly video: HTMLVideoElement;
  private landmarker: Landmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private pacer: Pacer | null = null;
  /** True while nothing has been seen for a while and detection is running slow. */
  get idle() { return !!this.pacer?.idle(performance.now()); }
  fps = 0;

  constructor(private o: FaceTrackerOptions = {}) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  async load(): Promise<void> {
    if (this.landmarker) return;
    const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(this.o.wasmBase ?? DEFAULT_WASM);
    const make = (delegate: "GPU" | "CPU") => FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: this.o.modelUrl ?? DEFAULT_MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try { this.landmarker = (await make("GPU")) as unknown as Landmarker; }
    catch { this.landmarker = (await make("CPU")) as unknown as Landmarker; }
  }

  async start(onFrame: (f: FaceFrame) => void): Promise<void> {
    await this.load();
    // shared with any other tracker on the page: one camera, one permission prompt
    if (!this.stream) this.stream = await acquireCamera(this.o.width ?? 640, this.o.height ?? 480);
    this.video.srcObject = this.stream;
    await this.video.play();
    this.runOn(onFrame);
  }

  /** Track a video file (recorded faces, for tests). */
  async startOnVideo(src: string, onFrame: (f: FaceFrame) => void): Promise<void> {
    await this.load();
    this.video.srcObject = null;
    this.video.src = src;
    this.video.loop = true;
    await this.video.play();
    this.runOn(onFrame);
  }

  private runOn(onFrame: (f: FaceFrame) => void) {
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
        this.pacer?.saw(t, !!res.facialTransformationMatrixes?.[0]);
        const mat = res.facialTransformationMatrixes?.[0];
        const bs = res.faceBlendshapes?.[0];
        onFrame({ t, face: mat && bs ? { ...readFaceMatrix(mat.data), ...readBlendshapes(bs.categories) } : null });
        frames++;
        if (t - since > 1000) { this.fps = (frames * 1000) / (t - since); frames = 0; since = t; }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
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
