// What every controller does after it has applied a frame's events: notice
// when the input lands on something new (a soft tick; the HUD locks on), and
// sound the select / clear / reset / grab / hop it just did.

import { Earcons } from "./sound";
import { Announcer } from "./announce";
import type { GestureAdapter, GestureEvent, Target } from "./types";

export class Feedback {
  readonly sound: Earcons;
  /** Says what it's on and what it did (accessibility mode). Off by default. */
  readonly announce: Announcer;
  /** What the input is on right now, as the adapter reports it. */
  target: Target | null = null;
  private quietUntil = 0;
  private stepped = false;
  /** The dial's turn since its last notch. */
  private notch = 0;

  constructor(private adapter: GestureAdapter, sound = false, announce?: Announcer) {
    this.sound = new Earcons(sound);
    this.announce = announce ?? new Announcer();
  }

  after(events: GestureEvent[]) {
    let acted = false;
    for (const e of events) {
      if (e.type === "select") {
        this.sound.play(e.at.x < 0 ? "clear" : "select"); acted = true;
        this.announce.say(e.at.x < 0 ? "Cleared" : this.target?.label ? `Selected ${this.target.label}` : "Selected");
      }
      else if (e.type === "step") { this.sound.play("step"); acted = true; this.stepped = true; }
      else if (e.type === "reset") { this.sound.play("reset"); this.announce.say("View reset"); }
      else if (e.type === "pose") this.announce.say(e.name);
      else if (e.type === "panstart" || e.type === "twostart") this.sound.play("grab");
      else if (e.type === "dialstart") this.notch = 0;
      else if (e.type === "dial") {
        // a click per notch (about 12° of turn), like a knob with detents
        this.notch += e.delta;
        while (Math.abs(this.notch) >= 0.21) { this.sound.play("tick"); this.notch -= Math.sign(this.notch) * 0.21; }
      }
    }
    // read the target only right after this input's own hover: with hands and
    // head on together the adapter's hover belongs to whichever moved last
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (acted) this.quietUntil = now + 400;
    const hover = events.find((e) => e.type === "hover");
    if (!hover) return;
    const t = hover.type === "hover" && hover.at ? this.adapter.target?.() ?? null : null;
    // a hop or select lands on its target with its own sound: no tick on top
    if (t && t.id !== this.target?.id && now >= this.quietUntil) this.sound.play("target", t.group);
    // say what it's on now (a hop says where it landed)
    if (t?.label && (t.id !== this.target?.id || this.stepped)) this.announce.say(t.group ? `${t.label}, ${t.group}` : t.label);
    this.stepped = false;
    this.target = t;
  }

  clear() { this.target = null; }
}
