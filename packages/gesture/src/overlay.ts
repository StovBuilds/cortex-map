// The "what is it reading" layer: a faint hand skeleton where your hand is,
// and a cursor that shows the state (hover / pinched / grabbing / two-hand /
// palm-reset progress). Draws on a pointer-events:none canvas over the surface.

import type { RecognizerState } from "./types";

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export interface OverlayColors { hover: string; grab: string; reset: string; bone: string }
const COLORS: OverlayColors = { hover: "#7fd6ff", grab: "#ffc062", reset: "#7dffb0", bone: "rgba(150,210,255,0.32)" };

export class GestureOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label = "";
  /** Cursor size (accessibility: 1.6 or so for low vision). */
  scale = 1;
  /** A name shown over every cursor (whose hands these are, in a shared session). */
  tag = "";

  constructor(private surface: HTMLElement, private colors: OverlayColors = COLORS) {
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh",
      pointerEvents: "none", zIndex: "2147483000",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  private lastStroke: { pts: (readonly [number, number])[]; t: number } | null = null;
  /** Where the cursors were last seen: they fade out there instead of vanishing. */
  private lastCursors: { at: { x: number; y: number }; t: number }[] = [];
  /** How long a lost hand's cursor takes to fade (ms). */
  fadeMs = 600;

  /** Show a short word under the cursor for a moment ("select", "reset"…). */
  flash(label: string) { this.label = label; window.setTimeout(() => { if (this.label === label) this.label = ""; }, 700); }

  /** extras.dwell: a point-and-hold select filling up at `at` (hands in accessibility mode). */
  draw(state: RecognizerState, extras: { dwell?: { at: { x: number; y: number }; progress: number } } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const r = this.surface.getBoundingClientRect();
    const px = (p: { x: number; y: number }) => [r.left + p.x * r.width, r.top + p.y * r.height] as const;

    // skeletons
    c.lineWidth = 2;
    c.strokeStyle = this.colors.bone;
    for (const h of state.hands) {
      const pts = h.screenLandmarks.map(px);
      c.beginPath();
      for (const [a, b] of BONES) { if (pts[a] && pts[b]) { c.moveTo(...pts[a]); c.lineTo(...pts[b]); } }
      c.stroke();
      c.fillStyle = this.colors.bone;
      for (const p of pts) { c.beginPath(); c.arc(p[0], p[1], 2.5, 0, Math.PI * 2); c.fill(); }
    }

    // air drawing: the stroke so far, a ring where it would close into a loop,
    // and the last finished stroke fading out
    const now = performance.now();
    for (const h of state.hands) {
      if (h.stroke.length < 2) continue;
      this.lastStroke = { pts: h.stroke.map(px), t: now };
      const p0 = px(h.stroke[0]);
      c.strokeStyle = this.colors.hover;
      c.setLineDash([4, 5]); c.lineWidth = 1.5;
      c.beginPath(); c.arc(p0[0], p0[1], 0.09 * r.height, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }
    if (this.lastStroke) {
      const age = now - this.lastStroke.t;
      const live = state.hands.some((h) => h.stroke.length >= 2);
      const a = live ? 1 : Math.max(0, 1 - age / 700);
      if (a <= 0) this.lastStroke = null;
      else {
        c.save();
        c.globalAlpha = a;
        c.strokeStyle = this.colors.hover; c.lineWidth = 4; c.lineCap = "round"; c.lineJoin = "round";
        c.shadowColor = this.colors.hover; c.shadowBlur = 12;
        c.beginPath();
        this.lastStroke.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
        c.restore();
      }
    }

    // two-hand link
    const two = state.hands.filter((h) => h.role === "two");
    if (two.length === 2) {
      const [a, b] = two.map((h) => px(h.cursor));
      c.strokeStyle = this.colors.grab;
      c.setLineDash([6, 6]);
      c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
      c.setLineDash([]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
      c.beginPath(); c.arc(m[0], m[1], 5, 0, Math.PI * 2); c.fillStyle = this.colors.grab; c.fill();
    }

    // a hand that just went: its cursor fades where it was (so you can see where you lost it)
    if (state.hands.length) this.lastCursors = state.hands.map((h) => ({ at: { ...h.cursor }, t: now }));
    else if (this.lastCursors.length) {
      const k = 1 - (now - this.lastCursors[0].t) / this.fadeMs;
      if (k <= 0) this.lastCursors = [];
      else {
        c.save();
        c.globalAlpha = 0.6 * k;
        c.strokeStyle = this.colors.hover;
        c.lineWidth = 2 * this.scale;
        c.setLineDash([3, 4]);
        for (const l of this.lastCursors) { const [x, y] = px(l.at); c.beginPath(); c.arc(x, y, (18 + 10 * (1 - k)) * this.scale, 0, Math.PI * 2); c.stroke(); }
        c.restore();
      }
    }

    // cursors
    for (const h of state.hands) {
      const [x, y] = px(h.cursor);
      const grabbing = h.pinched && h.role !== "blocked";
      const col = grabbing ? this.colors.grab : this.colors.hover;
      const S = this.scale;
      const rad = (18 - 9 * h.pinchAmount) * S;
      c.lineWidth = 2.5 * S;
      c.strokeStyle = col;
      c.globalAlpha = h.role === "blocked" ? 0.35 : 1;
      c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.stroke();
      if (grabbing) { c.fillStyle = col; c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1; }
      c.fillStyle = col;
      c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
      if (h.role === "drawing") { c.fillStyle = col; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); }
      if (h.role === "panning") {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          c.beginPath(); c.moveTo(x + dx * (rad + 4), y + dy * (rad + 4)); c.lineTo(x + dx * (rad + 10), y + dy * (rad + 10)); c.stroke();
        }
      }
      if (h.palmHold > 0) {
        c.strokeStyle = this.colors.reset;
        c.lineWidth = 4;
        c.beginPath(); c.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + h.palmHold * Math.PI * 2); c.stroke();
        this.text(c, "hold to reset", x, y + 48, this.colors.reset);
      }
      if (h.custom) {
        // a custom pose: a ring that fills while it's held, with its name
        c.strokeStyle = this.colors.hover;
        c.lineWidth = 3;
        c.globalAlpha = h.customHold >= 1 ? 1 : 0.85;
        c.beginPath(); c.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + h.customHold * Math.PI * 2); c.stroke();
        this.text(c, h.custom, x, y + 48, this.colors.hover);
      }
      c.globalAlpha = 1;
      if (this.label && h === state.hands[0]) this.text(c, this.label, x, y - 30, col);
      if (this.tag) this.text(c, this.tag, x, y - 30 * this.scale - (this.label && h === state.hands[0] ? 20 : 0), col);
    }
    if (extras.dwell && extras.dwell.progress > 0) { const [x, y] = px(extras.dwell.at); this.dwellRing(c, x, y, extras.dwell.progress); }
  }

  private dwellRing(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
    const S = this.scale;
    c.strokeStyle = this.colors.hover;
    c.lineWidth = 4 * S;
    c.globalAlpha = 0.9;
    c.beginPath(); c.arc(x, y, 30 * S, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
    c.globalAlpha = 1;
  }

  private text(c: CanvasRenderingContext2D, s: string, x: number, y: number, col: string) {
    c.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "center";
    c.fillStyle = "rgba(0,0,0,0.55)";
    const w = c.measureText(s).width + 12;
    c.fillRect(x - w / 2, y - 12, w, 18);
    c.fillStyle = col;
    c.fillText(s, x, y + 1);
  }

  clear() { this.lastCursors = []; this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  dispose() { this.canvas.remove(); }
}
