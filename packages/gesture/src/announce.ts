// Says what the input is on, for people who can't see the screen well (or
// at all): a polite aria-live region that screen readers read out, and,
// optionally, the browser's own speech. Short phrases, throttled, newest wins.

export interface AnnouncerOptions {
  /** Also speak through speechSynthesis (for people without a screen reader running). */
  speak: boolean;
  /** Speech rate (1 = normal). */
  rate: number;
  /** Don't repeat the same phrase within this long. */
  repeatMs: number;
}

export const ANNOUNCE_DEFAULTS: AnnouncerOptions = { speak: false, rate: 1.1, repeatMs: 1500 };

export class Announcer {
  readonly o: AnnouncerOptions;
  /** Off until switched on: a library shouldn't talk unless asked. */
  enabled = false;
  private el: HTMLElement | null = null;
  private last = { text: "", t: 0 };
  /** Every phrase announced, newest last (tests read this; capped). */
  readonly log: string[] = [];

  constructor(o: Partial<AnnouncerOptions> = {}) { this.o = { ...ANNOUNCE_DEFAULTS, ...o }; }

  private region(): HTMLElement | null {
    if (this.el || typeof document === "undefined") return this.el;
    const el = document.createElement("div");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    el.dataset.gestureAnnouncer = "";
    // visually hidden, still read
    Object.assign(el.style, { position: "fixed", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap", left: "0", top: "0" } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  say(text: string) {
    if (!this.enabled || !text) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (text === this.last.text && now - this.last.t < this.o.repeatMs) return;
    this.last = { text, t: now };
    this.log.push(text);
    if (this.log.length > 50) this.log.shift();
    const el = this.region();
    if (el) el.textContent = text;
    if (this.o.speak && typeof speechSynthesis !== "undefined") {
      // newest wins: a long label shouldn't hold up the next one
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.o.rate;
      speechSynthesis.speak(u);
    }
  }

  dispose() { this.el?.remove(); this.el = null; }
}
