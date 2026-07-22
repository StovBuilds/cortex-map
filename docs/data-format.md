# Data format

Right, so CortexMap doesn't fetch anything, doesn't talk to a backend, none of that. You give it plain JSON-shaped objects and it renders exactly what you handed over. Nothing clever going on behind the scenes. Three props do all the work: `nodes`, `edges`, `clusters`. That's it, honestly.

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

The layout is **deterministic**, which is just a fancy way of saying: same data in, same map out. Every time. No surprises.

| role | placement |
| --- | --- |
| `core` | the centre plinth (one per map), gold tint, tall pillar, giant ring |
| `hub` | its cluster's sector centre |
| `subhub` | ringed around its `parentId` hub |
| `leaf` (default) | ringed around its `parentId`; with no parent, a golden-angle spiral in its cluster's sector |

You can honestly just ignore roles altogether. Every node falls back to the per-cluster spiral then, and it still looks tidy, like proper little labelled constellations. I quite like that fallback, actually.

### The age gradient

`lastSeenAt` gets ranked into a percentile across all your dated nodes. Rank, not absolute age, so the gradient still shows up even when your timestamps are all bunched together in one week or whatever.

- **colour**, fresh nodes glow their full cluster hue; old ones cool toward slate
- **elevation**, fresh leaves ride proud of the dome; old ones settle into it

Undated nodes just sit at the midpoint, no drama. And structural nodes, your core/hub/subhub lot, never lift at all.

### Weight

Anything with `weight >= theme.pillarMinWeight` (default 0.7) earns itself a vertical **light pillar**, and the height scales on a power curve. So keep the pillar-worthy nodes rare, yeah? A few towering and the rest staying low reads way better than everything shouting at once. Weight also feeds orb size and halo scale, for what it's worth.

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

There are two visual tiers here, split by strength (the thresholds are themeable, so don't panic):

- **bright "thinking" tier**, arcs with travelling particles. Explicit edges qualify at `strength >= theme.linkBrightExplicit` (0.62), semantic ones need `theme.linkBrightMin` (0.9).
- **fibre web**, faint straight lines. Semantic edges below `theme.linkFibreMin` (0.8) don't even get drawn (they still count for the inspector, tentacles, and ignite propagation, though, so they're not gone).

Edges pointing at unknown node ids just get dropped silently, no error, nothing. And node `degree` (connection count, feeds orb size, ring gating, search ranking) gets computed from the edge set automatically. You don't touch it.

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

Skip `angleDeg` and clusters just distribute evenly in array order. Position actually encodes meaning here, so put related clusters next to each other and the whole map's geography reads properly at a glance. Worth the five minutes of thought.

A node whose `cluster` doesn't match any ClusterDef renders in `theme.fallbackClusterColor` at angle 0. Fine for the odd straggler. But give your real clusters proper definitions, don't be lazy about it.

## Live updates

Changing the `nodes`/`edges` props re-ingests the whole graph, but positions stay deterministic, so existing nodes don't go leaping about. For moment-to-moment stuff, use the ref handle instead, it never rebuilds the geometry:

```ts
map.current?.flash(idOrIds);  // warm pulse + sea ripple (+ storm energy)
map.current?.ignite(idOrIds); // pulse that propagates outward along edges
map.current?.focus(id);       // select + fly the camera
map.current?.clearSelection();
```

Anyway. That's the whole shape of it.
