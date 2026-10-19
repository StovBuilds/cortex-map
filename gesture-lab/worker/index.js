// The lab's worker: the static pages, plus /relay/<room>, a tiny WebSocket
// relay (one Durable Object per room) for shared sessions and the phone
// controller. It only passes messages along (hand landmarks, cursor and
// gesture events, names); it stores nothing and never sees video. It has no
// auth of its own: anyone with a room name can join, so deploy it behind
// Cloudflare Access (or similar) if that matters to you.

const MAX_PEERS = 8;
const MAX_MSG = 64 * 1024;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/relay\/([A-Za-z0-9_-]{4,40})$/);
    if (!m) return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return room.fetch(req);
  },
};

export class Room {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const peers = this.state.getWebSockets();
    if (peers.length >= MAX_PEERS) return new Response("room full", { status: 429 });
    const url = new URL(req.url);
    const role = url.searchParams.get("role") === "phone" ? "phone" : "peer";
    const name = (url.searchParams.get("name") || role).slice(0, 24);
    const id = crypto.randomUUID().slice(0, 8);
    const [client, server] = Object.values(new WebSocketPair());
    // hibernation: the object can sleep between messages, so an idle room costs nothing
    this.state.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, role, name });
    server.send(JSON.stringify({ type: "welcome", id, peers: peers.map((p) => p.deserializeAttachment()) }));
    this.broadcast(server, { type: "join", peer: { id, role, name } });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    const me = ws.deserializeAttachment();
    // addressed (phone → one screen) or to everyone else in the room
    const out = JSON.stringify({ ...msg, from: me.id });
    for (const p of this.state.getWebSockets()) {
      if (p === ws) continue;
      if (msg.to && p.deserializeAttachment().id !== msg.to) continue;
      try { p.send(out); } catch { /* gone */ }
    }
  }

  webSocketClose(ws) { this.leave(ws); }
  webSocketError(ws) { this.leave(ws); }

  leave(ws) {
    const me = ws.deserializeAttachment();
    try { ws.close(1000, "bye"); } catch { /* already */ }
    this.broadcast(ws, { type: "leave", id: me.id });
  }

  broadcast(from, msg) {
    const s = JSON.stringify(msg);
    for (const p of this.state.getWebSockets()) if (p !== from) { try { p.send(s); } catch { /* gone */ } }
  }
}
