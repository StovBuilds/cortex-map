// The phone remote: a trackpad for a screen in the same room. It sends
// gesture events over the relay; the screen applies them at the phone's
// cursor and says back what the cursor is on.

import { Relay, type GestureEvent } from "cortex-gesture";

const params = new URLSearchParams(location.hash.slice(1));
const room = params.get("room") ?? "";
const to = params.get("to") || undefined;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const status = $<HTMLElement>("[data-ref=status]");
const on = $<HTMLElement>("[data-ref=on]");
const pad = $<HTMLElement>("[data-ref=pad]");

const relay = room ? new Relay({ url: Relay.urlFor(room), name: "phone", role: "phone" }) : null;
if (!relay) status.textContent = "No room: scan the code on the screen.";
const send = (event: GestureEvent) => relay?.send({ type: "phone", to, event });
relay?.on((m) => {
  if (m.type === "status" || m.type === "join" || m.type === "leave") {
    const screen = [...relay.peers.values()].find((p) => p.role === "peer" && (!to || p.id === to));
    status.textContent = relay.status !== "open" ? "Connecting…" : screen ? `On ${screen.name}'s screen` : "The screen isn't here (reopen the code?)";
  }
  if (m.type === "target") {
    const label = m.label ? String(m.label) : null;
    on.textContent = label ? `On: ${label}` : "Move a finger on the pad.";
    if (label) navigator.vibrate?.(8);
  }
});

// ── the trackpad ────────────────────────────────────────────────────────────
let cursor = { x: 0.5, y: 0.5 };
const pts = new Map<number, { x: number; y: number }>();
let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
let two: { d: number; a: number; m: { x: number; y: number } } | null = null;
const GAIN = 1.5;
const box = () => pad.getBoundingClientRect();
const geo = () => {
  const [a, b] = [...pts.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
};
// at most every 30 ms, and always the last position (a quick swipe mustn't stop short)
let lastHover = 0, trailing = 0;
const hover = () => {
  const now = performance.now();
  clearTimeout(trailing);
  if (now - lastHover < 30) { trailing = window.setTimeout(hover, 30 - (now - lastHover)); return; }
  lastHover = now;
  send({ type: "hover", at: { ...cursor } });
};

pad.addEventListener("pointerdown", (e) => {
  try { pad.setPointerCapture(e.pointerId); } catch { /* not a live pointer (synthetic): fine without capture */ }
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) tap = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false };
  if (pts.size === 2) { tap = null; two = geo(); send({ type: "twostart", at: { ...cursor } }); }
});
pad.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const r = box();
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 1) {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.moved = true;
    cursor = { x: Math.max(0, Math.min(1, cursor.x + (dx / r.width) * GAIN)), y: Math.max(0, Math.min(1, cursor.y + (dy / r.height) * GAIN)) };
    hover();
  } else if (pts.size === 2 && two) {
    const g = geo();
    // the content moves with the fingers, as on a trackpad
    send({ type: "transform", scale: g.d / (two.d || 1), rotate: Math.atan2(Math.sin(g.a - two.a), Math.cos(g.a - two.a)), dx: (g.m.x - two.m.x) / r.width, dy: (g.m.y - two.m.y) / r.height, at: { ...cursor } });
    two = g;
  }
});
const up = (e: PointerEvent) => {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (two && pts.size < 2) { two = null; send({ type: "twoend" }); }
  if (pts.size === 0 && tap && !tap.moved && performance.now() - tap.t < 300) send({ type: "select", at: { ...cursor } });
  if (pts.size === 0) tap = null;
};
pad.addEventListener("pointerup", up);
pad.addEventListener("pointercancel", up);

document.addEventListener("click", async (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "select") send({ type: "select", at: { ...cursor } });
  if (act === "clear") send({ type: "select", at: { x: -1, y: -1 } });
  if (act === "reset") { send({ type: "reset" }); time.value = "1000"; }
  if (act === "tilt") await toggleTilt(e.target as HTMLButtonElement);
});

// ── time: the slider is the dial ────────────────────────────────────────────
const time = $<HTMLInputElement>("[data-ref=time]");
let timeLast: number | null = null;
time.addEventListener("pointerdown", () => { timeLast = Number(time.value); send({ type: "dialstart", at: { ...cursor } }); });
time.addEventListener("input", () => {
  if (timeLast === null) { timeLast = Number(time.value); send({ type: "dialstart", at: { ...cursor } }); }
  // the whole slider = half a turn of the dial (the map's whole time span)
  const d = ((Number(time.value) - timeLast) / 1000) * Math.PI;
  timeLast = Number(time.value);
  if (d) send({ type: "dial", delta: d, angle: d });
});
time.addEventListener("change", () => { if (timeLast !== null) { send({ type: "dialend" }); timeLast = null; } });

// ── tilt to steer: the phone's angle drives the view, like the head does ────
let tilt: { base: { b: number; g: number } | null; last: { b: number; g: number }; iv: number } | null = null;
const onOrient = (e: DeviceOrientationEvent) => {
  if (!tilt || e.beta == null || e.gamma == null) return;
  tilt.last = { b: e.beta, g: e.gamma };
  tilt.base ??= { ...tilt.last };
};
async function toggleTilt(btn: HTMLButtonElement) {
  if (tilt) {
    clearInterval(tilt.iv); tilt = null;
    window.removeEventListener("deviceorientation", onOrient);
    btn.textContent = "Tilt to steer: off"; btn.setAttribute("aria-pressed", "false");
    return;
  }
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (D.requestPermission && (await D.requestPermission().catch(() => "denied")) !== "granted") { status.textContent = "Tilt needs motion access."; return; }
  tilt = { base: null, last: { b: 0, g: 0 }, iv: 0 };
  window.addEventListener("deviceorientation", onOrient);
  const rate = (deg: number) => { const a = Math.abs(deg); return a < 6 ? 0 : Math.sign(deg) * Math.pow((a - 6) / 30, 1.5) * 0.04; };
  tilt.iv = window.setInterval(() => {
    if (!tilt?.base) return;
    // tip the top away = fly over the top; tilt right = turn right
    const yaw = rate(tilt.last.g - tilt.base.g), pitch = rate(tilt.base.b - tilt.last.b);
    if (yaw || pitch) send({ type: "orbit", yaw, pitch, zoom: 0, dx: 0, dy: 0 });
  }, 33);
  btn.textContent = "Tilt to steer: on (hold it how it is now = still)"; btn.setAttribute("aria-pressed", "true");
}

(window as unknown as Record<string, unknown>).__phone = { relay, cursor: () => cursor };
