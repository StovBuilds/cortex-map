// Deterministic constellation layout. Core at origin · hubs at their sector
// centre · sub-hubs ringed around their hub · leaves around their parent;
// golden-angle spiral fill with a stable id-sort. Pure and deterministic —
// same nodes → same slots, so the map becomes a place you learn.

import type { ClusterLayout } from "./clusters";

export interface SlotNode {
  id: string;
  cluster: string;
  role?: string;
  parentId?: string | null;
}

export function computeHomeSlots(
  nodes: SlotNode[],
  layout: ClusterLayout,
  opts: { sectorRadius?: number; subhubSpread?: number; leafSpread?: number } = {},
): Map<string, { x: number; z: number }> {
  const SECTOR_R = opts.sectorRadius ?? 470;
  const SUBHUB_SPREAD = opts.subhubSpread ?? 24;
  const LEAF_SPREAD = opts.leafSpread ?? 7;
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  const place = new Map<string, { x: number; z: number }>();
  const childrenOf = new Map<string, SlotNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push(n);
  }
  const ring = (parentId: string, spread: number, roleFilter: string) => {
    const pp = place.get(parentId);
    if (!pp) return;
    const kids = (childrenOf.get(parentId) ?? [])
      .filter((k) => k.role === roleFilter)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    kids.forEach((k, i) => {
      const r = spread * Math.sqrt(i + 0.6);
      const a = i * GOLD;
      place.set(k.id, { x: pp.x + Math.cos(a) * r, z: pp.z + Math.sin(a) * r });
    });
  };
  // The singular core sits on the centre plinth.
  const core = nodes.find((n) => n.role === "core");
  if (core) place.set(core.id, { x: 0, z: 0 });
  for (const n of nodes) if (n.role === "hub") {
    const c = layout.center(n.cluster, SECTOR_R);
    place.set(n.id, { x: c.x, z: c.z });
  }
  for (const n of nodes) if (n.role === "hub") ring(n.id, SUBHUB_SPREAD, "subhub");
  for (const n of nodes) if (n.role === "hub" || n.role === "subhub") ring(n.id, LEAF_SPREAD, "leaf");
  // fallback per-cluster spiral for any unplaced node
  const fallbackIdx = new Map<string, number>();
  for (const n of nodes) {
    if (place.has(n.id)) continue;
    const i = fallbackIdx.get(n.cluster) ?? 0;
    fallbackIdx.set(n.cluster, i + 1);
    const d = layout.discPosition(n.cluster, i);
    place.set(n.id, { x: d.x, z: d.z });
  }
  return place;
}

// Semantic gravity — a one-time, DETERMINISTIC edge-spring relaxation seeded
// from the home slots: linked nodes attract (× link strength) while a per-role
// tether holds every node near home, so clusters stay anchored and the result
// is stable (same data → same layout; no randomness, no live simulation). The
// core never moves; hubs barely; leaves roam most.
export function relaxLayout(
  home: Map<string, { x: number; z: number }>,
  edges: { s: string; t: string; w: number }[],
  roleById: Map<string, string | undefined>,
  gravity = 0,
): Map<string, { x: number; z: number }> {
  // gravity: 0 = off (pure deterministic slots) … 1 = full pull. The original
  // ships with 0 — the effect didn't add enough to justify nudging the clean
  // sector layout — but the machinery is a one-line dial-up if wanted.
  if (gravity <= 0.001) return new Map(home);
  const ITER = 70;
  const ATTRACT = 0.05 * gravity; // pull along an edge, × its strength × master knob
  const TETHER = 0.04; // base spring back to home (keeps clusters in place)
  const MAX_STEP = 14; // clamp per-iteration displacement so nothing snaps/explodes
  const MAX_DRIFT = 170; // hard cap on distance from home — keeps clusters readable
  const lockFor = (r?: string) => (r === "core" ? 1 : r === "hub" ? 0.6 : r === "subhub" ? 0.3 : 0.08);
  const pos = new Map<string, { x: number; z: number }>();
  for (const [id, p] of home) pos.set(id, { x: p.x, z: p.z });
  const valid = edges.filter((e) => pos.has(e.s) && pos.has(e.t));
  for (let it = 0; it < ITER; it++) {
    const dispX = new Map<string, number>();
    const dispZ = new Map<string, number>();
    for (const e of valid) {
      const a = pos.get(e.s)!, b = pos.get(e.t)!;
      const f = ATTRACT * e.w;
      const dx = (b.x - a.x) * f, dz = (b.z - a.z) * f;
      dispX.set(e.s, (dispX.get(e.s) ?? 0) + dx); dispZ.set(e.s, (dispZ.get(e.s) ?? 0) + dz);
      dispX.set(e.t, (dispX.get(e.t) ?? 0) - dx); dispZ.set(e.t, (dispZ.get(e.t) ?? 0) - dz);
    }
    for (const [id, p] of pos) {
      const h = home.get(id)!;
      const lock = lockFor(roleById.get(id));
      let dx = (dispX.get(id) ?? 0) + (h.x - p.x) * (TETHER + lock);
      let dz = (dispZ.get(id) ?? 0) + (h.z - p.z) * (TETHER + lock);
      const m = Math.hypot(dx, dz);
      if (m > MAX_STEP) { dx = (dx / m) * MAX_STEP; dz = (dz / m) * MAX_STEP; }
      p.x += dx; p.z += dz;
    }
  }
  // final drift clamp: a strongly cross-linked leaf can't stray so far it reads
  // as belonging to the wrong cluster.
  for (const [id, p] of pos) {
    const h = home.get(id)!;
    const dx = p.x - h.x, dz = p.z - h.z;
    const m = Math.hypot(dx, dz);
    if (m > MAX_DRIFT) { p.x = h.x + (dx / m) * MAX_DRIFT; p.z = h.z + (dz / m) * MAX_DRIFT; }
  }
  return pos;
}
