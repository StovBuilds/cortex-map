// Public data contract. Bring your own graph: CortexMap renders exactly what
// you pass — no fetching, no backend. Shapes intentionally mirror plain JSON.

/** One node ("memory") on the map. */
export interface CortexMapNode {
  id: string;
  /** Short display name — node label, search text, inspector title. */
  label: string;
  /** Free-form kind shown in the inspector (e.g. "note", "person", "paper"). */
  type?: string;
  /** Which cluster (constellation) the node belongs to. Must match a ClusterDef name. */
  cluster: string;
  /** Longer text for the inspector pane + search. */
  summary?: string | null;
  /**
   * Importance 0..1. Drives orb size, glow, and which nodes get a light pillar
   * (see theme.pillarMinWeight). Defaults to 0.5.
   */
  weight?: number;
  /**
   * Structural role. `core` sits at the origin (one per map), `hub` = a cluster
   * anchor, `subhub` = a hub satellite, `leaf` = everything else (default).
   * Roles shape the layout: hubs claim their cluster's sector centre and
   * children ring their parent.
   */
  role?: "core" | "hub" | "subhub" | "leaf";
  /** Parent node id (hub for a subhub, hub/subhub for a leaf). Optional. */
  parentId?: string | null;
  /**
   * Recency timestamp (ms epoch or ISO string). Drives the age gradient:
   * recently-touched nodes glow vivid and ride proud of the surface, old ones
   * cool toward slate and settle. Omit to opt the node out (treated as median).
   */
  lastSeenAt?: number | string | null;
  /** Anything you like — handed back on select, shown nowhere by default. */
  data?: unknown;
}

/** One connection between two nodes. */
export interface CortexMapEdge {
  id?: string;
  source: string;
  target: string;
  /** Short relation label for the inspector (e.g. "relates to", "cites"). */
  relation?: string;
  /**
   * 0..1. Strong edges join the bright "thinking" tier (particles, curvature);
   * weak ones render as the faint fibre web. Defaults to 0.8.
   */
  strength?: number;
  /**
   * "explicit" = user-declared (bright tier at a lower strength bar),
   * anything else = inferred/semantic. Defaults to "explicit".
   */
  origin?: string;
}

/** Per-cluster motion temperament — biomes, not recoloured copies. */
export interface ClusterPersona {
  /** × node-ring spin/pulse rate (1 = neutral). */
  ringRate: number;
  /** × glow-halo scale (1 = neutral). */
  halo: number;
  /** 0 calm … 1 stormy — how readily the domain "storms" under activity. */
  volatility: number;
}

/** One cluster (constellation zone) definition. Order matters only as the
 *  fallback for angular placement when angleDeg is omitted. */
export interface ClusterDef {
  name: string;
  /** #rrggbb hex — the cluster's hue for orbs, links, pillars, its label. */
  color: string;
  /**
   * Angular slot in degrees on the ground plane (0 = +x, 90 = +z). Position
   * encodes meaning — place related clusters near each other. Omitted = evenly
   * distributed in array order.
   */
  angleDeg?: number;
  persona?: Partial<ClusterPersona>;
}

/** Visual theme. Every field optional — defaults reproduce the original
 *  "war-table" look. See docs/theming.md for a guided tour. */
export interface CortexMapTheme {
  /** Page/void background colour behind the scene. */
  background: string;
  /** Node colour for a cluster the ClusterDef list doesn't name. */
  fallbackClusterColor: string;
  /** Warm-white a freshly-flashed node glows before fading to its cluster hue. */
  flashColor: string;
  /** How long a flash takes to fade back (ms). */
  flashMs: number;
  /** Cold slate that aged memories desaturate toward. */
  agedColor: string;
  /** Peak vertical spread (graph units) between newest and oldest nodes. */
  ageLift: number;
  /** Radius of the holo-table ground disc. */
  groundRadius: number;
  /** Concentric orbital guide rings on the plane. */
  ringRadii: number[];
  /** How far cluster hubs sit from the core. */
  sectorRadius: number;
  /** Cluster name sprites sit at this radius. */
  labelRadius: number;
  /** Dome curvature radius — larger = flatter table. */
  domeRadius: number;
  /** Camera start position (a low oblique looks ACROSS the disc). */
  cameraStart: { x: number; y: number; z: number };
  /** Camera aim point. */
  cameraLook: { x: number; y: number; z: number };
  /** Exponential fog density — atmospheric depth (0 disables). */
  fogDensity: number;
  /** ACES filmic tone-mapping exposure. */
  toneExposure: number;
  /** Bloom pass [strength, radius, threshold]; null disables bloom. */
  bloom: [number, number, number] | null;
  /** Dimmest link drawn at all (strength below = hidden). */
  linkFibreMin: number;
  /** Semantic links at/above this strength join the bright tier. */
  linkBrightMin: number;
  /** Explicit links at/above this strength join the bright tier. */
  linkBrightExplicit: number;
  /** Node weight at/above which a node earns a vertical light pillar. */
  pillarMinWeight: number;
  /** Animated sea layer under the disc (the most expensive furniture). */
  sea: boolean;
  /** Procedural night-lights point field on the dome. */
  nightLights: boolean;
  /** Starfield + nebula backdrop. */
  starfield: boolean;
  /** Gold bezel/compass outer disk. */
  outerDisk: boolean;
  /** Cluster-label text sprites. */
  clusterLabels: boolean;
  /** Cap on renderer devicePixelRatio (mobile fragment-cost guard). */
  pixelRatioCap: number;
}

/** Imperative surface exposed via ref — live-map effects. */
export interface CortexMapHandle {
  /** Flash nodes warm-white (a "memory touched" pulse) + drop a sea ripple. */
  flash(ids: string | string[]): void;
  /** Chain-reaction flash: seeds ignite, then spread along edges. */
  ignite(ids: string | string[]): void;
  /** Fly the camera to a node and select it. */
  focus(id: string): void;
  /** Clear the current selection. */
  clearSelection(): void;
}

export interface CortexMapProps {
  nodes: CortexMapNode[];
  edges: CortexMapEdge[];
  clusters: ClusterDef[];
  /** Partial theme — anything omitted keeps the war-table default. */
  theme?: Partial<CortexMapTheme>;
  /** Fired when a node is selected (click / search / focus). null = deselected. */
  onNodeSelect?: (node: CortexMapNode | null) => void;
  /** Hide the built-in search box (⌘K style) if you bring your own. */
  search?: boolean;
  /** Hide the built-in node inspector pane if you bring your own. */
  inspector?: boolean;
  /** Reduce-motion override; defaults to the user's OS preference. */
  reduceMotion?: boolean;
  /** Performance-lite mode (drops sea/bloom/starfield). Defaults to auto. */
  lite?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
