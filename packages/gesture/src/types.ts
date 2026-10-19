// The module's contracts. Everything between the camera and the adapters is
// plain data, so the recognizer can be driven by a webcam, a recorded
// landmark file, or a synthetic test sequence alike.

/** One MediaPipe hand landmark, normalised to the video frame (0..1, z relative). */
export interface Landmark { x: number; y: number; z: number }

/** One detected hand: the 21 MediaPipe landmarks in the raw (un-mirrored) video frame. */
export interface HandInput {
  landmarks: Landmark[];
  /** MediaPipe's handedness guess. Unreliable frame to frame; used only as a hint. */
  handedness?: "Left" | "Right";
}

/** One tracker frame. */
export interface FrameInput {
  /** Timestamp in ms (performance.now() or a recording's clock). */
  t: number;
  hands: HandInput[];
}

/** A screen point, normalised: 0..1 across the target surface (may overshoot slightly). */
export interface Point { x: number; y: number }

export type Pose = "pinch" | "point" | "draw" | "open" | "fist" | "other";

export type GestureEvent =
  | { type: "hover"; at: Point | null }
  /** A pinch (or mouth, or button) has just closed: it may become a select or a grab. Stops any glide. */
  | { type: "press"; at: Point }
  | { type: "select"; at: Point }
  /** held: the pinch (or mouth) was held still first: "pick this thing up", not "grab the surface". */
  | { type: "panstart"; at: Point; held?: boolean }
  | { type: "pan"; dx: number; dy: number; at: Point }
  | { type: "panend" }
  /** held: both hands held still first: "pull this apart", not "zoom". */
  | { type: "twostart"; at: Point; held?: boolean }
  /** scale > 1 = hands moving apart (zoom in). rotate in radians, + = clockwise on screen. */
  | { type: "transform"; scale: number; rotate: number; dx: number; dy: number; at: Point }
  | { type: "twoend" }
  /** Drawing in the air (index + middle finger out): the stroke so far, one point per frame. */
  | { type: "draw"; at: Point }
  /** The stroke is finished. closed: it came back round to its start (a loop). */
  | { type: "drawend"; path: Point[]; closed: boolean }
  /**
   * Continuous steering from a head or a gamepad: per-frame deltas, applied as
   * they come. yaw: radians, same sense as transform.rotate (+ = turn right).
   * pitch: radians, + = rise up over the top. zoom: log factor, + = in.
   * dx / dy: pan, as in "pan" (the content moves by this much of the surface).
   */
  | { type: "orbit"; yaw: number; pitch: number; zoom: number; dx: number; dy: number }
  /**
   * Hop to the next thing in a screen direction (a gamepad's d-pad): from the
   * selection, along a link where the content has links. dx / dy: a unit
   * direction on screen, y down.
   */
  | { type: "step"; dx: number; dy: number }
  /**
   * Where the viewer's eye is, off the resting spot (head "window" mode): the
   * view shifts as if the screen were a window into the scene. x: + = moved to
   * their own right, y: + = up, z: + = closer; about -1..1 for a comfortable
   * range. Absolute, not a delta: (0, 0, 0) puts the view back.
   */
  | { type: "view"; x: number; y: number; z: number }
  /**
   * The dial: a fist, turned like a knob. dialstart when it starts turning,
   * dial per frame (delta: radians since the last one, + = clockwise on
   * screen; angle: since the start), dialend when the hand opens. Maps scrub
   * through time with it; other adapters treat it as a zoom knob.
   */
  | { type: "dialstart"; at: Point }
  | { type: "dial"; delta: number; angle: number }
  | { type: "dialend" }
  /** A custom hand shape (recorded by the user) has been held: the app decides what it means. */
  | { type: "pose"; name: string; at: Point }
  | { type: "reset" };

/** Per-hand state the overlay draws. */
export interface HandState {
  id: number;
  /** Smoothed cursor in screen space. */
  cursor: Point;
  pose: Pose;
  pinched: boolean;
  /** 0 (fully open) .. 1 (touching): how close thumb and index are. */
  pinchAmount: number;
  /** 0..1 progress of an open-palm reset hold. */
  palmHold: number;
  /** Raw landmarks mapped to screen space (mirrored + active area), for the skeleton. */
  screenLandmarks: Point[];
  /** What this hand is doing right now. */
  role: "idle" | "pressing" | "panning" | "two" | "blocked" | "drawing" | "dialing";
  /** The air-drawing stroke in progress, if any. */
  stroke: Point[];
  /** Raw landmarks (video frame), for recording custom poses. */
  landmarks: Landmark[];
  /** The custom pose this hand is making, and 0..1 of its hold (1 = fired). */
  custom: string | null;
  customHold: number;
}

export interface RecognizerState {
  hands: HandState[];
  mode: "idle" | "pan" | "two";
}

export interface GestureAdapter {
  /** Handle one event. Points are normalised to the adapter's surface. */
  handle(e: GestureEvent): void;
  /** Optional: tidy up (end gestures, clear hover) when control is switched off. */
  detach?(): void;
  /**
   * Optional: what the last hover landed on, if anything. Controllers use it
   * for feedback (a sound and a locked reticle when a target is acquired) and
   * for look-to-select.
   */
  target?(): Target | null;
}

/** Something an input is pointing at. `id` must be stable while it stays the same thing. */
export interface Target {
  id: string;
  label?: string;
  /** What it belongs to (a cluster): targets in one group share a note, so you can hear where you are. */
  group?: string;
}
