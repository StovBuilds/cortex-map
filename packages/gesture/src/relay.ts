// A room on a WebSocket relay (the lab's worker/index.js): shared sessions
// (everyone's hands on one map) and the phone remote. Messages are small
// JSON; the relay adds `from` and passes them on. Reconnects on its own.

export interface RelayPeer { id: string; role: "peer" | "phone"; name: string }

export type RelayMessage = { type: string; from?: string; to?: string; [k: string]: unknown };

export interface RelayOptions {
  /** ws(s)://…/relay/<room> */
  url: string;
  name: string;
  role?: "peer" | "phone";
  /** Make the socket (tests pass a fake). */
  socket?: (url: string) => WebSocket;
}

type Listener = (msg: RelayMessage) => void;

export class Relay {
  readonly peers = new Map<string, RelayPeer>();
  /** This end's id in the room, once welcomed. */
  id: string | null = null;
  status: "connecting" | "open" | "closed" = "connecting";
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: RelayOptions) { this.connect(); }

  /** A random room name: hard to guess, easy to put in a link. */
  static newRoom() {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  }

  /** The relay URL for a room on this page's origin. */
  static urlFor(room: string, origin = location.origin) {
    return `${origin.replace(/^http/, "ws")}/relay/${encodeURIComponent(room)}`;
  }

  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  send(msg: RelayMessage) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close(1000, "bye");
    this.status = "closed";
    this.peers.clear();
    this.emit({ type: "status" });
  }

  private connect() {
    const q = new URLSearchParams({ name: this.o.name, role: this.o.role ?? "peer" });
    const ws = (this.o.socket ?? ((u) => new WebSocket(u)))(`${this.o.url}?${q}`);
    this.ws = ws;
    this.status = "connecting";
    ws.onmessage = (e) => {
      let msg: RelayMessage;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === "welcome") {
        this.id = String(msg.id);
        this.status = "open";
        this.retry = 0;
        this.peers.clear();
        for (const p of (msg.peers as RelayPeer[]) ?? []) this.peers.set(p.id, p);
        this.emit({ type: "status" });
        return;
      }
      if (msg.type === "join") { const p = msg.peer as RelayPeer; this.peers.set(p.id, p); }
      if (msg.type === "leave") this.peers.delete(String(msg.id));
      this.emit(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const gone = [...this.peers.keys()];
      this.peers.clear();
      for (const id of gone) this.emit({ type: "leave", id });
      if (this.closed) return;
      this.status = "connecting";
      this.emit({ type: "status" });
      // back off: 0.5 s, 1 s, 2 s … up to 10 s
      this.timer = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
    };
  }

  private emit(msg: RelayMessage) { for (const l of this.listeners) l(msg); }
}
