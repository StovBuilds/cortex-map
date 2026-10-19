// Shared sessions and the phone remote, over the lab's private relay.
//
// Together: everyone in a room sees everyone's hands on the same page; each
// person's hand landmarks (only those: no video, no sound) go to the others,
// whose browsers run them through a recogniser of their own.
//
// Phone: a phone opens phone.html for this room and becomes a trackpad
// remote for this screen. It sends gesture events; we apply them and tell it
// what the cursor is on.

import { PEER_COLORS, Relay, RemoteHands, type FrameInput, type GestureAdapter, type GestureController, type GestureEvent, type Point, type RelayMessage } from "cortex-gesture";

const SEND_MS = 50; // hands at up to 20 fps
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ShareUI {
  join(room: string): void;
  leave(): void;
  relay(): Relay | null;
  room(): string | null;
  remotes(): string[];
}

export function mountShare(o: {
  sheet: HTMLElement;
  surface: HTMLElement;
  page: string;
  controller: GestureController;
  adapter: GestureAdapter;
  say: (s: string) => void;
}): ShareUI {
  let relay: Relay | null = null;
  let room: string | null = null;
  let lastSent = 0;
  let offFrame: (() => void) | null = null;
  const remotes = new Map<string, RemoteHands>();
  const phones = new Map<string, { el: HTMLElement; at: Point; target: string | null }>();
  const name = () => (localStorage.getItem("gesture-lab:name") || "").trim() || "Someone";

  o.sheet.innerHTML = `<summary>Together</summary>
    <p class="gl-tip">Share this page with someone (they see your hands on it, you see theirs), or use your phone as a remote. Only hand points and gestures are sent, never video or sound.</p>
    <label class="gl-field"><span>Your name</span><input data-ref="share-name" type="text" maxlength="24" autocomplete="off" placeholder="Someone"></label>
    <div class="gl-row gl-recrow">
      <button class="gl-btn gl-small" data-share="start">Start a shared session</button>
      <button class="gl-btn gl-small" data-share="leave" hidden>Leave</button>
    </div>
    <div data-ref="share-on" hidden>
      <p class="gl-tip">Send this link: <input class="gl-link" data-ref="share-link" readonly aria-label="Session link"> <button class="gl-btn gl-small" data-share="copy">Copy</button></p>
      <p class="gl-tip" data-ref="share-peers" aria-live="polite"></p>
      <p class="gl-tip"><b>Phone remote:</b> scan this on your phone (same sign-in), or open the link below on it.</p>
      <div class="gl-qr" data-ref="share-qr"></div>
      <p class="gl-tip"><input class="gl-link" data-ref="phone-link" readonly aria-label="Phone remote link"></p>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => o.sheet.querySelector(s) as T;
  const nameIn = $<HTMLInputElement>("[data-ref=share-name]");
  nameIn.value = localStorage.getItem("gesture-lab:name") ?? "";
  nameIn.addEventListener("change", () => { try { localStorage.setItem("gesture-lab:name", nameIn.value.trim()); } catch { /* private mode */ } });

  const pageUrl = (r: string) => `${location.origin}${location.pathname}#room=${r}`;
  const phoneUrl = (r: string) => `${location.origin}${location.pathname.replace(/[^/]*$/, "")}phone.html#room=${r}&to=${relay?.id ?? ""}`;
  const render = () => {
    const on = !!relay;
    $<HTMLElement>("[data-share=start]").hidden = on;
    $<HTMLElement>("[data-share=leave]").hidden = !on;
    $<HTMLElement>("[data-ref=share-on]").hidden = !on;
    if (!relay || !room) return;
    $<HTMLInputElement>("[data-ref=share-link]").value = pageUrl(room);
    const people = [...relay.peers.values()].filter((p) => p.role === "peer").map((p) => p.name);
    const ph = [...relay.peers.values()].filter((p) => p.role === "phone").length;
    $<HTMLElement>("[data-ref=share-peers]").textContent = relay.status !== "open" ? "Connecting…"
      : `${people.length ? `Here with you: ${people.join(", ")}` : "Nobody else here yet."}${ph ? ` · ${ph} phone remote${ph > 1 ? "s" : ""}` : ""}`;
    if (relay.id) {
      const link = phoneUrl(room);
      const input = $<HTMLInputElement>("[data-ref=phone-link]");
      if (input.value !== link) {
        input.value = link;
        // the QR code library loads only when a session starts
        void import("qrcode-generator").then(({ default: QR }) => {
          if (input.value !== link) return;
          const qr = QR(0, "M");
          qr.addData(link);
          qr.make();
          $<HTMLElement>("[data-ref=share-qr]").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
        });
      }
    }
  };

  const colorOf = (id: string) => PEER_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length];

  const phoneCursor = (id: string) => {
    let p = phones.get(id);
    if (p) return p;
    const el = document.createElement("div");
    el.className = "gl-phone-cursor";
    el.style.setProperty("--c", colorOf(id));
    el.innerHTML = `<i></i><span>${(relay?.peers.get(id)?.name ?? "phone").replace(/[<&>"]/g, "")}</span>`;
    document.body.appendChild(el);
    p = { el, at: { x: 0.5, y: 0.5 }, target: null };
    phones.set(id, p);
    return p;
  };
  const placeCursor = (p: { el: HTMLElement; at: Point }) => {
    const r = o.surface.getBoundingClientRect();
    p.el.style.transform = `translate(${r.left + p.at.x * r.width}px, ${r.top + p.at.y * r.height}px)`;
  };

  const onMessage = (m: RelayMessage) => {
    if (m.type === "status" || m.type === "join") { render(); return; }
    if (m.type === "leave") {
      const id = String(m.id);
      remotes.get(id)?.dispose(); remotes.delete(id);
      phones.get(id)?.el.remove(); phones.delete(id);
      render();
      return;
    }
    const from = String(m.from ?? "");
    if (m.type === "hands" && from) {
      let rh = remotes.get(from);
      if (!rh) {
        rh = new RemoteHands({ surface: o.surface, adapter: o.adapter, name: relay?.peers.get(from)?.name ?? "someone", color: colorOf(from), recognizer: { mirror: true } });
        remotes.set(from, rh);
      }
      rh.feed(m.frame as FrameInput, Number(m.aspect) || undefined);
      return;
    }
    if (m.type === "phone" && from) {
      // a gesture from a phone remote: its cursor is ours to draw, the rest goes to the adapter
      const e = m.event as GestureEvent;
      const p = phoneCursor(from);
      if (e.type === "hover" && e.at) {
        p.at = { x: Math.max(0, Math.min(1, e.at.x)), y: Math.max(0, Math.min(1, e.at.y)) };
        placeCursor(p);
        // hover through the adapter so the card shows, then tell the phone what it's on
        o.adapter.handle({ type: "hover", at: p.at });
        const t = o.adapter.target?.() ?? null;
        const label = t?.label ?? null;
        if (label !== p.target) { p.target = label; relay?.send({ type: "target", to: from, label }); }
        return;
      }
      if (e.type === "select" && e.at.x >= 0) o.adapter.handle({ type: "select", at: { ...p.at } });
      else if ("at" in e && e.at && e.type !== "select") o.adapter.handle({ ...e, at: { ...p.at } } as GestureEvent);
      else o.adapter.handle(e);
      if (e.type === "select" || e.type === "reset") p.el.animate([{ scale: 1.6 }, { scale: 1 }], { duration: 260 });
    }
  };

  const ui: ShareUI = {
    join(r) {
      ui.leave();
      room = r;
      relay = new Relay({ url: Relay.urlFor(r), name: name() });
      relay.on(onMessage);
      // send our hands (landmarks only), throttled
      offFrame = o.controller.onFrame((f) => {
        const now = performance.now();
        if (!relay || now - lastSent < SEND_MS || (!f.hands.length && lastSent < 0)) return;
        lastSent = f.hands.length ? now : -1; // one empty frame when the hands go, then quiet
        relay.send({ type: "hands", aspect: o.controller.recognizer.o.videoAspect, frame: { t: Math.round(f.t), hands: f.hands.map((h) => ({ landmarks: h.landmarks.map((l) => ({ x: r3(l.x), y: r3(l.y), z: r3(l.z) })) })) } });
      });
      if (location.hash !== `#room=${r}`) history.replaceState(null, "", `#room=${r}`);
      render();
      o.say(`Together: joined room ${r}.`);
    },
    leave() {
      offFrame?.(); offFrame = null;
      relay?.close(); relay = null;
      for (const rh of remotes.values()) rh.dispose();
      remotes.clear();
      for (const p of phones.values()) p.el.remove();
      phones.clear();
      if (room && location.hash.startsWith("#room=")) history.replaceState(null, "", location.pathname + location.search);
      room = null;
      render();
    },
    relay: () => relay,
    room: () => room,
    remotes: () => [...remotes.keys()],
  };

  o.sheet.addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>("[data-share]")?.dataset.share;
    if (k === "start") ui.join(Relay.newRoom());
    else if (k === "leave") { ui.leave(); o.say("Together: left the session."); }
    else if (k === "copy") { void navigator.clipboard?.writeText(pageUrl(room!)).then(() => o.say("Together: link copied.")); }
  });
  // opened from a shared link
  const m = location.hash.match(/^#room=([a-z0-9]{6,40})$/);
  if (m) { (o.sheet as HTMLDetailsElement).open = true; ui.join(m[1]); }
  window.addEventListener("resize", () => { for (const p of phones.values()) placeCursor(p); });
  render();
  return ui;
}
