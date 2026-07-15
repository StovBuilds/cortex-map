# Data format

CortexMap renders exactly what you pass — no fetching, no backend, plain JSON-
shaped objects. Three props carry the data: `nodes`, `edges`, `clusters`.

## Nodes

```ts
interface CortexMapNode {
  id: string;          // unique
  label: string;       // display name (map tooltip, search, inspector)
  cluster: string;     // must match a ClusterDef name
  type?: string;       // free-form kind shown in the inspector ("note", "person", …)
  summary?: string;    // longer text for the inspector + search
  weight?: number;     // 0..1 importance (default 0.5) — orb size, glow, pillars
  role?: "core" | "hub" | "subhub" | "leaf";
  parentId?: string;   // structural parent (see layout below)
  lastSeenAt?: number | string; // ms epoch or ISO — drives the age gradient
  data?: unknown;      // yours — handed back in onNodeSelect, never rendered
}
```

### Roles and layout

The layout is **deterministic**: the same data always produces the same map.

| role | placement |
| --- | --- |
| `core` | the centre plinth (one per map) — gold tint, tall pillar, giant ring |
| `hub` | its cluster's sector centre |
| `subhub` | ringed around its `parentId` hub |
| `leaf` (default) | ringed around its `parentId`; with no parent, a golden-angle spiral in its cluster's sector |

You can ignore roles entirely — every node then falls back to the per-cluster
spiral, which still reads as tidy labelled constellations.

### The age gradient

`lastSeenAt` is ranked into a percentile across all dated nodes (rank, not
absolute age — so the gradient is always visible even when timestamps bunch up):

- **colour** — fresh nodes glow their full cluster hue; old ones cool toward slate
- **elevation** — fresh leaves ride proud of the dome; old ones settle into it

Undated nodes sit at the midpoint. Structural nodes (core/hub/subhub) never lift.

### Weight

`weight >= theme.pillarMinWeight` (default 0.7) earns a vertical **light pillar**
whose height scales on a power curve — keep pillar-worthy nodes rare so a few
tower and the rest stay low. Weight also feeds orb size and halo scale.

## Edges

```ts
interface CortexMapEdge {
  source: string;      // node id
  target: string;      // node id
  relation?: string;   // label in the inspector ("cites", "similar to", …)
  strength?: number;   // 0..1 (default 0.8)
  origin?: string;     // "explicit" (default) or anything else = semantic
}
```

Two visual tiers, split by strength (thresholds themeable):

- **bright "thinking" tier** — arcs with travelling particles. Explicit edges
  qualify at `strength >= theme.linkBrightExplicit` (0.62), semantic ones at
  `theme.linkBrightMin` (0.9).
- **fibre web** — faint straight lines. Semantic edges below
  `theme.linkFibreMin` (0.8) aren't drawn at all (but still count for the
  inspector, tentacles, and ignite propagation).

Edges referencing unknown node ids are dropped silently. Node `degree`
(connection count — orb size, ring gating, search ranking) is computed from the
edge set for you.

## Clusters

```ts
interface ClusterDef {
  name: string;        // matches node.cluster
  color: string;       // #rrggbb
  angleDeg?: number;   // angular slot on the disc (0 = +x, 90 = +z)
  persona?: {          // motion temperament — biomes, not recoloured copies
    ringRate?: number;   // × ring spin/pulse speed (default 1)
    halo?: number;       // × glow-halo scale (default 1)
    volatility?: number; // 0 calm … 1 stormy (default 0.5)
  };
}
```

Omit `angleDeg` and clusters distribute evenly in array order. Position encodes
meaning — put related clusters next to each other and the map's geography
becomes readable at a glance.

A node whose `cluster` doesn't match any ClusterDef renders in
`theme.fallbackClusterColor` at angle 0 — fine for stragglers, but give real
clusters a definition.

## Live updates

Changing the `nodes`/`edges` props re-ingests the graph (positions stay
deterministic, so existing nodes don't move). For moment-to-moment effects use
the ref handle instead — it never rebuilds geometry:

```ts
map.current?.flash(idOrIds);  // warm pulse + sea ripple (+ storm energy)
map.current?.ignite(idOrIds); // pulse that propagates outward along edges
map.current?.focus(id);       // select + fly the camera
map.current?.clearSelection();
```
