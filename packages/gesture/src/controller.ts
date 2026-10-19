// Wires it together: a frame source (webcam tracker or a replay) → the
// recognizer → an adapter, plus the overlay. One controller per surface.

import { GestureRecognizer, type RecognizerOptions } from "./recognizer";
import { GestureOverlay } from "./overlay";
import { HandTracker, type TrackerOptions } from "./tracker";
import { Feedback } from "./feedback";
import { Dwell, type DwellOptions } from "./dwell";
import type { FrameInput, GestureAdapter, GestureEvent, Point, RecognizerState } from "./types";

export interface ControllerOptions {
  /** The element gestures act on; surface coords are normalised to its box. */
  surface: HTMLElement;
  adapter: GestureAdapter;
  overlay?: boolean;
  recognizer?: Partial<RecognizerOptions>;
  tracker?: TrackerOptions;
  /** Feedback sounds (off by default). */
  sound?: boolean;
  /** Point and hold still on something to select it, no pinch needed (accessibility). Off by default (ms 0). */
  dwell?: Partial<DwellOptions>;
}

export type ControllerListener = (events: GestureEvent[], state: RecognizerState) => void;

export class GestureController {
  readonly recognizer: GestureRecognizer;
  readonly tracker: HandTracker;
  readonly overlay: GestureOverlay | null;
  private listeners = new Set<ControllerListener>();
  private active = false;
  /** Target tracking + sounds. `feedback.sound.enabled` switches the sounds. */
  readonly feedback: Feedback;
  /** Point-and-hold select. `dwell.o.ms` = 0 switches it off. */
  readonly dwell: Dwell;
  private hoverAt: Point | null = null;

  constructor(private o: ControllerOptions) {
    this.feedback = new Feedback(o.adapter, !!o.sound);
    this.dwell = new Dwell({ ms: 0, ...o.dwell });
    this.recognizer = new GestureRecognizer(o.recognizer);
    this.tracker = new HandTracker(o.tracker);
    this.overlay = o.overlay === false ? null : new GestureOverlay(o.surface);
  }

  get running() { return this.active; }

  /** Ask for the camera and start tracking. Rejects if permission is refused. */
  async start(): Promise<void> {
    this.active = true;
    await this.tracker.start((f) => this.feed(f));
  }

  /** Track a video file instead of the camera (recorded hands). */
  async startOnVideo(src: string): Promise<void> {
    this.active = true;
    await this.tracker.startOnVideo(src, (f) => this.feed(f));
  }

  /** Push one frame (from the tracker, or a replay / synthetic source). */
  private taps = new Set<(f: FrameInput) => void>();
  /** Every frame as it arrives (to record it). Returns an unsubscribe. */
  onFrame(fn: (f: FrameInput) => void) { this.taps.add(fn); return () => { this.taps.delete(fn); }; }

  feed(f: FrameInput) {
    for (const fn of this.taps) fn(f);
    const r = this.o.surface.getBoundingClientRect();
    if (r.width && r.height) this.recognizer.setSurfaceAspect(r.width / r.height);
    if (this.tracker.video.videoWidth) this.recognizer.setVideoAspect(this.tracker.aspect);
    const events = this.recognizer.update(f);
    this.dispatch(events, f.t);
  }

  private dispatch(events: GestureEvent[], t = performance.now()) {
    for (const e of events) {
      if (e.type === "hover") this.hoverAt = e.at;
      this.o.adapter.handle(e);
      const word = flashWord(e);
      if (word) this.overlay?.flash(word);
    }
    this.feedback.after(events);
    const state = this.recognizer.state();
    // point and hold: a free hand resting on one target selects it
    if (this.dwell.o.ms) {
      const busy = state.mode !== "idle" || state.hands.some((h) => h.role !== "idle" || h.pinched);
      if (this.dwell.update(t, this.hoverAt ? this.feedback.target : null, busy) && this.hoverAt) {
        const sel: GestureEvent = { type: "select", at: { ...this.hoverAt } };
        this.o.adapter.handle(sel);
        this.overlay?.flash("select");
        this.feedback.after([sel]);
        events = [...events, sel];
      }
    }
    this.overlay?.draw(state, this.hoverAt && this.dwell.progress ? { dwell: { at: this.hoverAt, progress: this.dwell.progress } } : {});
    for (const l of this.listeners) l(events, state);
  }

  on(l: ControllerListener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  stop() {
    this.active = false;
    this.tracker.stop();
    this.dispatch(this.recognizer.clear());
    this.o.adapter.detach?.();
    this.feedback.clear();
    this.dwell.reset();
    this.hoverAt = null;
    this.overlay?.clear();
  }

  dispose() {
    this.stop();
    this.tracker.dispose();
    this.overlay?.dispose();
    this.listeners.clear();
  }
}

/** The word the cursor shows for a moment when a gesture lands (so you know it took). */
export function flashWord(e: GestureEvent): string | null {
  switch (e.type) {
    case "select": return "select";
    case "reset": return "reset";
    case "panstart": return e.held ? "pick up" : "grab";
    case "twostart": return e.held ? "spread" : "zoom · turn";
    case "drawend": return e.closed ? "loop" : e.path.length > 1 ? "path" : null;
    case "dialstart": return "dial";
    case "pose": return e.name;
    default: return null;
  }
}
