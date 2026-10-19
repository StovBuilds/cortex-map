// Someone else's hands, arriving over a relay as landmarks: run through a
// recogniser of their own and applied to the same adapter, so their pinches
// and drags move the shared view. Their hover only moves their cursor (yours
// keeps the hover card). Drawn in their colour, with their name.

import { GestureRecognizer, type RecognizerOptions } from "./recognizer";
import { GestureOverlay, type OverlayColors } from "./overlay";
import type { FrameInput, GestureAdapter, GestureEvent } from "./types";

/** Distinct, readable cursor colours for other people. */
export const PEER_COLORS = ["#ff8fd1", "#b8f27c", "#ffd36b", "#a9a2ff", "#6fe7d8", "#ff9f7a"];

export class RemoteHands {
  readonly recognizer: GestureRecognizer;
  private overlay: GestureOverlay;

  constructor(private o: { surface: HTMLElement; adapter: GestureAdapter; name: string; color: string; recognizer?: Partial<RecognizerOptions> }) {
    this.recognizer = new GestureRecognizer(o.recognizer);
    const colors: OverlayColors = { hover: o.color, grab: o.color, reset: o.color, bone: `${o.color}55` };
    this.overlay = new GestureOverlay(o.surface, colors);
    this.overlay.tag = o.name;
  }

  /** One frame of their hands (`videoAspect` from their camera). Returns the events it applied. */
  feed(f: FrameInput, videoAspect?: number): GestureEvent[] {
    const r = this.o.surface.getBoundingClientRect();
    if (r.width && r.height) this.recognizer.setSurfaceAspect(r.width / r.height);
    if (videoAspect) this.recognizer.setVideoAspect(videoAspect);
    const events = this.recognizer.update(f);
    for (const e of events) if (e.type !== "hover") this.o.adapter.handle(e);
    this.overlay.draw(this.recognizer.state());
    return events;
  }

  /** They left: end whatever they were doing. */
  dispose() {
    for (const e of this.recognizer.clear()) if (e.type !== "hover") this.o.adapter.handle(e);
    this.overlay.dispose();
  }
}
