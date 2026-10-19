// cortex-map adapter: the orbit camera for movement, plus the map's own
// hover card, selection and reset. Pinch a node to select it; pinch the same
// node again within a second to fly to it; pinch empty space to deselect.
// A d-pad step hops from the selection along a link, the one whose node lies
// most nearly in that direction on screen, and flies there.
//
// Map gestures on top of the camera:
//   pinch held still on a node, then drag → pull it out as a floating card
//   both hands held still in a cluster, then spread → pull that cluster apart
//   draw a loop round nodes → light them up together
//   draw a line from one node to another → light up the chain between them
//
// Structural types only, so this package doesn't depend on cortex-map.

import { createOrbitAdapter, type OrbitAdapterOptions, type OrbitView } from "./orbitCamera";
import type { GestureAdapter, GestureEvent, Point } from "../types";
import { Pinboard, type LiftedCard } from "../pinboard";
import { pointInPolygon, shortestPath } from "../geometry";
import { bestMatch } from "../voiceCommands";

export interface CortexMapLike {
  getView(): OrbitView | null;
  nodeAt(x: number, y: number, radiusPx?: number): { id: string; label?: string; cluster?: string } | null;
  hover(id: string | null): void;
  select(id: string | null): void;
  focus(id: string): void;
  resetView(): void;
  /** For d-pad hops (optional: without them a step does nothing). */
  selectedId?(): string | null;
  neighbours?(id: string): string[];
  screenOf?(id: string): { x: number; y: number } | null;
  /** For the map gestures (optional: each does nothing without its hooks). */
  nodeIds?(): string[];
  node?(id: string): { id: string; label?: string; cluster?: string; summary?: string | null; role?: string } | null;
  spotlight?(ids: string[] | null, mode?: "set" | "path"): void;
  spreadCluster?(cluster: string, factor: number): void;
  spreadOf?(cluster: string): number;
  /** For the history dial (optional: without them the dial zooms). */
  timeSpan?(): { min: number; max: number } | null;
  time?(): number | null;
  setTime?(t: number | null): void;
}

export interface CortexMapAdapterOptions {
  /** Hit radius for hover (px). Hands are less precise than a mouse. */
  hoverRadius?: number;
  /** Hit radius for select (px). */
  selectRadius?: number;
  panGain?: number;
  zoomGain?: number;
  rotateGain?: number;
  /** Notified on select, for UI ("selected X"). */
  onSelect?: (id: string | null) => void;
  /** A hop must lie within this angle of the d-pad direction (radians). Default 70°. */
  stepCone?: number;
  /** Flick to glide / spin (see createOrbitAdapter). false turns it off. */
  momentum?: OrbitAdapterOptions["momentum"];
  windowGain?: number;
  /** Where pulled-out cards go. Default: one made on first use, over the page. false: no pulling out. */
  pinboard?: Pinboard | false;
  /** Told when a loop or a line lights up nodes (ids in order for a path), and when it clears (null). */
  onSpotlight?: (ids: string[] | null, mode: "set" | "path") => void;
  /** The history dial: how far (radians) to turn to go across the whole span. Default π (half a turn). */
  dialSpan?: number;
  /** Told when the dial moves the time cursor (null = back to now). */
  onTime?: (t: number | null) => void;
}

/**
 * The best hop from `from` in screen direction `dir`: within the cone, and
 * favouring near over far and on-axis over off-axis. Exported for tests.
 */
export function pickStep(from: { x: number; y: number }, dir: { dx: number; dy: number }, candidates: { id: string; x: number; y: number }[], cone = (70 * Math.PI) / 180): string | null {
  const minCos = Math.cos(cone);
  let best: string | null = null, bestScore = Infinity;
  for (const c of candidates) {
    const vx = c.x - from.x, vy = c.y - from.y;
    const d = Math.hypot(vx, vy);
    if (d < 1) continue;
    const cos = (vx * dir.dx + vy * dir.dy) / d;
    if (cos < minCos) continue;
    const score = d / (cos * cos);
    if (score < bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

export function createCortexMapAdapter(getMap: () => CortexMapLike | null, o: CortexMapAdapterOptions = {}): GestureAdapter {
  const camera = createCameraAdapter(getMap, o);
  let board: Pinboard | null = o.pinboard || null;
  let lift: { card: LiftedCard; from: Point; last: Point } | null = null;
  let spread: { cluster: string; k: number } | null = null;
  let dial: { t: number; min: number; max: number } | null = null;
  const el = () => getMap()?.getView()?.element ?? null;
  const px = (p: Point) => { const r = el()?.getBoundingClientRect(); return r ? { x: p.x * r.width, y: p.y * r.height, cx: r.left + p.x * r.width, cy: r.top + p.y * r.height } : null; };
  const nodeNear = (p: Point, radius: number) => { const q = px(p); return q ? getMap()?.nodeAt(q.x, q.y, radius) ?? null : null; };
  const light = (ids: string[] | null, mode: "set" | "path") => { getMap()?.spotlight?.(ids, mode); o.onSpotlight?.(ids, mode); };

  return {
    handle(e: GestureEvent) {
      const map = getMap();
      switch (e.type) {
        case "panstart": {
          if (!e.held || o.pinboard === false || !map?.node) break;
          const n = nodeNear(e.at, o.selectRadius ?? 44);
          const q = px(e.at);
          if (!n || !q) break;
          const d = map.node(n.id);
          board ??= new Pinboard();
          lift = { card: board.lift({ title: d?.label ?? n.id, subtitle: d?.cluster, body: d?.summary ?? undefined }, q.cx, q.cy), from: e.at, last: e.at };
          return;
        }
        case "pan":
          if (lift) { const q = px(e.at); if (q) lift.card.move(q.cx, q.cy); lift.last = e.at; return; }
          break;
        case "panend":
          if (lift) {
            // pulled clear: pin it; barely moved: put it back
            if (Math.hypot(lift.last.x - lift.from.x, lift.last.y - lift.from.y) > 0.04) lift.card.drop(); else lift.card.cancel();
            lift = null;
            return;
          }
          break;
        case "twostart": {
          if (!e.held || !map?.spreadCluster) break;
          // the cluster between your hands: the one most of the nodes there belong to (the core belongs to none)
          const q = px(e.at);
          if (!q || !map.nodeIds || !map.screenOf || !map.node) break;
          const votes = new Map<string, number>();
          for (const id of map.nodeIds()) {
            const p = map.screenOf(id);
            if (!p || Math.hypot(p.x - q.x, p.y - q.y) > 160) continue;
            const d = map.node(id);
            if (!d?.cluster || d.role === "core") continue;
            votes.set(d.cluster, (votes.get(d.cluster) ?? 0) + 1 / (1 + Math.hypot(p.x - q.x, p.y - q.y) / 60));
          }
          const c = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (!c) break;
          spread = { cluster: c, k: map.spreadOf?.(c) ?? 1 };
          return;
        }
        case "transform":
          if (spread) { spread.k = Math.max(1, Math.min(5, spread.k * e.scale)); map?.spreadCluster?.(spread.cluster, spread.k); return; }
          break;
        case "twoend":
          if (spread) { spread = null; return; }
          break;
        case "dialstart": {
          const span = map?.setTime ? map.timeSpan?.() ?? null : null;
          if (!span) break; // no dates: a zoom knob
          dial = { t: map!.time?.() ?? span.max, ...span };
          return;
        }
        case "dial":
          if (!dial) break;
          // clockwise = forward in time; the last sliver of the span (and past it) = now
          dial.t = Math.max(dial.min, Math.min(dial.max, dial.t + (e.delta / (o.dialSpan ?? Math.PI)) * (dial.max - dial.min)));
          {
            const now = dial.t >= dial.max - (dial.max - dial.min) * 0.01;
            map?.setTime?.(now ? null : dial.t);
            o.onTime?.(now ? null : dial.t);
          }
          return;
        case "dialend":
          if (dial) { dial = null; return; }
          break;
        case "draw":
          return;
        case "drawend": {
          if (!map) return;
          if (e.closed) {
            const r = el()?.getBoundingClientRect();
            if (!r || !map.nodeIds || !map.screenOf) return;
            const ids = map.nodeIds().filter((id) => { const p = map.screenOf!(id); return p && pointInPolygon({ x: p.x / r.width, y: p.y / r.height }, e.path); });
            light(ids.length ? ids : null, "set");
            return;
          }
          // a line from one node to another: the chain between them
          if (e.path.length < 2 || !map.neighbours) return;
          const a = nodeNear(e.path[0], 50), b = nodeNear(e.path[e.path.length - 1], 50);
          if (!a || !b || a.id === b.id) return;
          // not connected: light the two ends, so you can see it looked and found no chain
          const chain = shortestPath(a.id, b.id, (id) => map.neighbours!(id));
          light(chain ?? [a.id, b.id], chain ? "path" : "set");
          if (chain) map.select(b.id);
          return;
        }
        case "command": {
          if (!map?.nodeIds || !map.node) return;
          const c = e.command;
          const all = map.nodeIds().map((id) => map.node!(id)).filter((n): n is NonNullable<typeof n> => !!n);
          const find = (name: string) => bestMatch(name, all, (n) => n.label ?? n.id)?.item ?? null;
          if (c.kind === "fly") { const n = find(c.name); if (n) { map.focus(n.id); o.onSelect?.(n.id); } return; }
          if (c.kind === "path") {
            const a = find(c.from), b = find(c.to);
            if (!a || !b || !map.neighbours) return;
            const chain = shortestPath(a.id, b.id, (id) => map.neighbours!(id));
            light(chain ?? [a.id, b.id], chain ? "path" : "set");
            if (chain) map.select(b.id);
            return;
          }
          if (c.kind === "spread") {
            // a cluster by name, or the cluster of the node named
            const clusters = [...new Set(all.map((n) => n.cluster).filter((x): x is string => !!x))];
            const cl = bestMatch(c.name, clusters, (x) => x)?.item ?? find(c.name)?.cluster;
            if (cl && map.spreadCluster) map.spreadCluster(cl, Math.max(2.2, (map.spreadOf?.(cl) ?? 1) * 1.6));
            return;
          }
          if (c.kind === "pin") {
            const n = find(c.name);
            const r = el()?.getBoundingClientRect();
            const p = n && map.screenOf?.(n.id);
            if (!n || !r || o.pinboard === false) return;
            board ??= new Pinboard();
            const card = board.lift({ title: n.label ?? n.id, subtitle: n.cluster, body: n.summary ?? undefined }, r.left + (p?.x ?? r.width / 2), r.top + (p?.y ?? r.height / 2));
            // float it up and away from the node, then pin it
            card.move(r.left + (p?.x ?? r.width / 2) + 160, r.top + (p?.y ?? r.height / 2) - 120);
            card.drop();
            return;
          }
          return;
        }
        case "select": {
          const q = px(e.at);
          if (q && board?.pressAt(q.cx, q.cy)) return; // a card's close button
          if (e.at.x < 0) light(null, "set");
          break;
        }
        case "reset":
          lift?.card.cancel(); lift = null; spread = null; dial = null;
          o.onSpotlight?.(null, "set");
          o.onTime?.(null);
          break;
      }
      camera.handle(e);
    },
    detach() { lift?.card.cancel(); lift = null; spread = null; camera.detach?.(); },
    target: () => camera.target?.() ?? null,
  };
}

function createCameraAdapter(getMap: () => CortexMapLike | null, o: CortexMapAdapterOptions): GestureAdapter {
  let hovered: string | null = null;
  let hoveredLabel: string | undefined;
  let lastSelect = { id: "", t: 0 };
  return createOrbitAdapter({
    getView: () => getMap()?.getView() ?? null,
    panGain: o.panGain,
    zoomGain: o.zoomGain,
    rotateGain: o.rotateGain,
    momentum: o.momentum,
    windowGain: o.windowGain,
    minDistance: 0.06,
    maxDistance: 3,
    onHover: (_at, px) => {
      const map = getMap();
      if (!map) return null;
      const n = px ? map.nodeAt(px.x, px.y, o.hoverRadius ?? 36) : null;
      const id = n?.id ?? null;
      if (id !== hovered) { hovered = id; map.hover(id); }
      hoveredLabel = n?.label;
      return id ? { id, label: hoveredLabel, group: n?.cluster } : null;
    },
    onStep: (dir) => {
      const map = getMap();
      if (!map?.screenOf || !map.neighbours) return;
      const from = map.selectedId?.() ?? hovered;
      const at = from ? map.screenOf(from) : null;
      let to: string | null = null;
      if (!from || !at) {
        // nothing selected: start from whatever sits nearest the middle
        const el = map.getView()?.element;
        const r = el?.getBoundingClientRect();
        to = r ? map.nodeAt(r.width / 2, r.height / 2, Math.max(r.width, r.height))?.id ?? null : null;
      } else {
        const cands = map.neighbours(from).flatMap((id) => { const p = map.screenOf!(id); return p ? [{ id, ...p }] : []; });
        to = pickStep(at, dir, cands, o.stepCone);
      }
      if (!to) return;
      map.focus(to);
      lastSelect = { id: "", t: 0 };
      o.onSelect?.(to);
    },
    onSelect: (_at, px) => {
      const map = getMap();
      if (!map) return;
      const id = map.nodeAt(px.x, px.y, o.selectRadius ?? 44)?.id ?? null;
      const now = performance.now();
      if (id && lastSelect.id === id && now - lastSelect.t < 1200) {
        map.focus(id); // second pinch on the same node: fly there
        lastSelect = { id: "", t: 0 };
      } else {
        map.select(id);
        lastSelect = { id: id ?? "", t: now };
      }
      o.onSelect?.(id);
    },
    onReset: () => {
      const map = getMap();
      map?.select(null);
      map?.resetView();
      o.onSelect?.(null);
    },
  });
}
