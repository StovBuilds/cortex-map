// CortexMap — the "war-table" 3D knowledge-graph scene, extracted from the
// Jarvis Cortex page. Data comes in through props; live effects (flash/ignite/
// focus) come in through the imperative ref handle. No fetching, no backend.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClusterDef,
  CortexMapEdge,
  CortexMapHandle,
  CortexMapNode,
  CortexMapProps,
  CortexMapTheme,
} from "./types";
import { createClusterLayout, type ClusterLayout } from "./clusters";
import { computeHomeSlots, relaxLayout } from "./layout";
import {
  disableRaycast,
  hexLerp,
  makeDust,
  makeFuturesBranch,
  makeGlobe,
  makeEquatorialRing,
  makeGlowSprite,
  makeGroundPlane,
  makeNebula,
  makeNightLights,
  makeNodeGlow,
  makeNodeRing,
  makePillar,
  makeSea,
  makeStarfield,
  makeTextSprite,
  createOuterDisk,
  SEA_SRC_COUNT,
  SEA_RIPPLE_TTL,
} from "./scene";
import { useCortexMapStyles } from "./styles";

// Globe projection (prototype) helpers ───────────────────────────────────────
// Cluster "continent" centres are spread over the sphere with the same golden-
// angle spiral the disc uses for nodes, so N clusters sit evenly apart.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
function fibDir(i: number, n: number): [number, number, number] {
  const y = n <= 1 ? 0 : 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * GOLDEN;
  return [Math.cos(th) * rad, y, Math.sin(th) * rad];
}
const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (v: number[]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const DEFAULT_THEME: CortexMapTheme = {
  background: "#04060d",
  fallbackClusterColor: "#7f93b0",
  flashColor: "#fff4d6",
  flashMs: 2600,
  agedColor: "#33405e",
  ageLift: 34,
  groundRadius: 780,
  ringRadii: [120, 280, 440, 600],
  sectorRadius: 470,
  labelRadius: 660,
  domeRadius: 1500,
  cameraStart: { x: 0, y: 540, z: 1240 }, // low oblique (~24°) — looks ACROSS the disc
  cameraLook: { x: 0, y: 36, z: 0 },      // aim just above the ground for the horizon feel
  fogDensity: 0.0006,
  toneExposure: 1.15,
  bloom: [0.55, 0.5, 0.82],
  linkFibreMin: 0.8,
  linkBrightMin: 0.9,
  linkBrightExplicit: 0.62,
  pillarMinWeight: 0.7,
  sea: true,
  nightLights: true,
  starfield: true,
  outerDisk: true,
  clusterLabels: true,
  pixelRatioCap: 1.5,
  globeColor: "#122942",
  globeOpacity: 1,
  globeVisible: true,
  globeGridOutside: false,
  globeOrbsOnSurface: false,
  globeLabelRadius: 2.32,
};

// Weather — per-cluster activity accumulates into a decaying "storm energy"; a
// cluster over threshold drops a sustained disturbance at its sector centre.
const STORM_THRESHOLD = 0.7;
const STORM_MAX_CELLS = 3;
const STORM_GAIN = 0.55;
const STORM_DECAY = 0.5;

// Node ring HUD disks — spin/pulse rate scales with connection count.
const RING_RATE_BASE = 1.2;
const RING_RATE_PER_DEG = 5.0;

// Light pillars — height scales with weight on a power curve so a few hubs
// tower and the rest stay low.
const PILLAR_BASE_H = 16;
const PILLAR_SCALE = 280;
const PILLAR_CURVE = 1.6;
const PILLAR_CORE_H = 240;

// Generous invisible click targets — the visible orbs are a few units across in
// a ~1500-unit scene, so leaves would be fiddly to hit otherwise.
const HIT_RADIUS_LEAF = 11;
const HIT_RADIUS_SUBHUB = 16;
const HIT_RADIUS_HUB = 30;
const HIT_RADIUS_CORE = 60;

// Proximity picker — surface every orb packed around a click. Screen-space px
// gated by a 3D radius so a far orb that merely projects nearby can't sneak in.
const PROX_SCREEN_PX = 26;
const PROX_WORLD_MAX = 90;

const LITE_KEY = "cortexMap.lite";

// The internal node shape — a stable per-id object 3d-force-graph can hang its
// cached scene object (__threeObj) off. Degree is computed from the edge set.
export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  cluster: string;
  summary?: string | null;
  weight: number;
  degree: number;
  role?: string;
  parentId?: string | null;
  lastSeenAt?: number | string | null;
  data?: unknown;
  x?: number; y?: number; z?: number;
  fx?: number; fy?: number; fz?: number;
  __fresh?: number;
  __lift?: number;
  __src?: CortexMapNode;
}
type GraphLink = { source: any; target: any; relation: string; strength: number; origin: string };

const linkEnd = (v: any): string => (typeof v === "string" ? v : v.id);

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const CortexMap = forwardRef<CortexMapHandle, CortexMapProps>(function CortexMap(
  {
    nodes: nodesProp,
    edges: edgesProp,
    clusters,
    theme: themeProp,
    onNodeSelect,
    search = true,
    inspector = true,
    reduceMotion: reduceMotionProp,
    lite: liteProp,
    projection = "table",
    className,
    style,
  },
  handleRef,
) {
  const globe = projection === "globe";
  useCortexMapStyles();
  const T = useMemo<CortexMapTheme>(() => ({ ...DEFAULT_THEME, ...themeProp }), [themeProp]);
  const layout = useMemo<ClusterLayout>(
    () => createClusterLayout(clusters, {
      domeRadius: T.domeRadius,
      sectorRadius: T.sectorRadius,
      fallbackColor: T.fallbackClusterColor,
    }),
    [clusters, T.domeRadius, T.sectorRadius, T.fallbackClusterColor],
  );
  const clusterColor = layout.color;
  const clusterPersona = layout.persona;
  const domeY = layout.domeY;

  // bright/faint link tiering off the theme thresholds
  const isBright = useCallback(
    (l: GraphLink) => (l.origin === "explicit" ? l.strength >= T.linkBrightExplicit : l.strength >= T.linkBrightMin),
    [T.linkBrightExplicit, T.linkBrightMin],
  );

  const osReduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reduceMotion = reduceMotionProp ?? osReduceMotion;
  const smallScreen = useMediaQuery("(max-width: 820px)");
  const [litePref, setLitePref] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = window.localStorage.getItem(LITE_KEY);
    if (s != null) setLitePref(s === "1");
  }, []);
  const liteMode = liteProp ?? litePref ?? smallScreen;
  const setLite = useCallback((v: boolean) => {
    setLitePref(v);
    try { window.localStorage.setItem(LITE_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  }, []);
  const use3d = !reduceMotion && !liteMode;

  // The force-graph component, loaded client-side once we know which dimension.
  const [GraphComp, setGraphComp] = useState<any>(null);
  const threeRef = useRef<any>(null);
  const bloomCtorRef = useRef<any>(null);
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [selected, setSelectedState] = useState<GraphNode | null>(null);
  const [nearby, setNearby] = useState<GraphNode[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const setSelected = useCallback((n: GraphNode | null) => {
    setSelectedState(n);
    onNodeSelect?.(n ? (n.__src ?? null) : null);
  }, [onNodeSelect]);

  // flash bookkeeping (imperative — driven by handle.flash/ignite and clicks)
  const flashRef = useRef(new Map<string, number>());
  const [, setFlashTick] = useState(0);
  const [flashVersion, setFlashVersion] = useState(0);

  // render-on-demand: the scene is fully static (nodes pinned, no simulation),
  // so the heavy render loop SLEEPS when idle and wakes for interaction,
  // camera motion, and flashes.
  const sleepTimer = useRef<number | undefined>(undefined);
  const awakeRef = useRef(false);
  const ringClockRef = useRef({ value: 0 });
  const nodePosRef = useRef(new Map<string, { x: number; z: number; cluster: string }>());
  const nodeObjCacheRef = useRef(new Map<string, GraphNode>());
  const seaSrcRef = useRef<{ x: number; y: number; str: number; t: number }[]>([]);
  const seaSeenRef = useRef(new Set<string>());
  const stormRef = useRef(new Map<string, number>());
  const igniteTimers = useRef<number[]>([]);
  const flyTimers = useRef<number[]>([]);
  const lastClickRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });

  const wake = useCallback((hold = 700) => {
    const fg = fgRef.current;
    if (!fg?.resumeAnimation) return;
    // Re-entrancy guard: resumeAnimation runs the first tick SYNCHRONOUSLY, and
    // that tick can fire a TrackballControls "change" event whose listener is
    // this very function — wake → resume → tick → change → wake → … blows the
    // stack (observed on the first click after a sleep while the camera was
    // still settling). Once awake, later wakes only refresh the sleep timer.
    const wasAwake = awakeRef.current;
    awakeRef.current = true;
    if (!wasAwake) fg.resumeAnimation();
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = window.setTimeout(() => {
      if (flashRef.current.size > 0) { wake(700); return; } // keep flashing alive
      awakeRef.current = false;
      fgRef.current?.pauseAnimation?.();
    }, hold);
  }, []);

  // fade the flash highlights — ticks only while at least one node is glowing
  useEffect(() => {
    if (flashRef.current.size === 0) return;
    const iv = setInterval(() => {
      const now = Date.now();
      let active = false;
      for (const [id, t] of flashRef.current) {
        if (now - t > T.flashMs) flashRef.current.delete(id);
        else active = true;
      }
      setFlashTick((x) => x + 1);
      if (!active) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
  }, [flashVersion, T.flashMs]);

  // load the right force-graph build (client only)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (use3d) {
        const [mod, three, bloom] = await Promise.all([
          import("react-force-graph-3d"),
          import("three"),
          T.bloom ? import("three/examples/jsm/postprocessing/UnrealBloomPass.js") : Promise.resolve(null),
        ]);
        if (!alive) return;
        threeRef.current = three;
        bloomCtorRef.current = bloom ? (bloom as any).UnrealBloomPass : null;
        setGraphComp(() => (mod as any).default);
      } else {
        const mod = await import("react-force-graph-2d");
        if (!alive) return;
        setGraphComp(() => (mod as any).default);
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [use3d, T.bloom]);

  // track container size
  useEffect(() => {
    if (typeof window === "undefined" || !wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [GraphComp]);

  // ── shape props → force-graph data ──────────────────────────────────────────
  // Every node gets a FIXED constellation slot in its cluster's sector and is
  // pinned there (fx/fy/fz) — static labelled zones, not a swirling ball.
  const data = useMemo(() => {
    // degree from the edge set (drives orb size, ring gating, search ranking)
    const degree = new Map<string, number>();
    for (const e of edgesProp) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    // reuse one object per id so 3d-force-graph keeps each node's __threeObj
    // across flash re-renders (no full geometry rebuild).
    const cache = nodeObjCacheRef.current;
    const nodes: GraphNode[] = nodesProp.map((src) => {
      const fields = {
        id: src.id,
        label: src.label,
        type: src.type,
        cluster: src.cluster,
        summary: src.summary ?? null,
        weight: src.weight ?? 0.5,
        degree: degree.get(src.id) ?? 0,
        role: src.role,
        parentId: src.parentId ?? null,
        lastSeenAt: src.lastSeenAt ?? null,
        data: src.data,
        __src: src,
      };
      const prev = cache.get(src.id);
      if (prev) { Object.assign(prev, fields); return prev; }
      const obj: GraphNode = { ...fields };
      cache.set(src.id, obj);
      return obj;
    });
    const present = new Set(nodes.map((n) => n.id));
    if (cache.size > present.size) for (const id of [...cache.keys()]) if (!present.has(id)) cache.delete(id);

    // deterministic home slots + optional semantic-gravity relax
    const home = computeHomeSlots(nodes, layout, { sectorRadius: T.sectorRadius });
    const roleById = new Map<string, string | undefined>(nodes.map((n) => [n.id, n.role]));
    const springEdges = edgesProp.map((e) => ({
      s: e.source, t: e.target, w: Math.max(0, Math.min(1, e.strength ?? 0.8)),
    }));
    const relaxed = use3d ? relaxLayout(home, springEdges, roleById) : home;

    // recency rank (0 = oldest, 1 = newest) — a percentile, so the colour /
    // elevation gradient is always visible regardless of timestamp clustering.
    const dated = nodes
      .map((n) => {
        const v = n.lastSeenAt;
        const t = typeof v === "number" ? v : Date.parse(v ?? "");
        return { id: n.id, t };
      })
      .filter((d) => Number.isFinite(d.t))
      .sort((a, b) => a.t - b.t);
    const freshRank = new Map<string, number>();
    dated.forEach((d, i) => freshRank.set(d.id, dated.length > 1 ? i / (dated.length - 1) : 0.5));

    for (const n of nodes) {
      const p = relaxed.get(n.id) ?? home.get(n.id) ?? { x: 0, z: 0 };
      const fresh = freshRank.get(n.id) ?? 0.5;
      n.__fresh = fresh;
      if (use3d) {
        const surfaceY = domeY(Math.hypot(p.x, p.z));
        // recency topography: recent leaves ride proud of the dome, old ones
        // settle. Structural nodes stay seated so the skeleton reads clean.
        const lift = !n.role || n.role === "leaf" ? (fresh - 0.5) * T.ageLift : 0;
        n.__lift = lift;
        n.x = n.fx = p.x; n.y = n.fy = surfaceY + lift; n.z = n.fz = p.z;
      } else {
        n.__lift = 0;
        n.x = n.fx = p.x; n.y = n.fy = p.z; // 2D: fold the z-slot into vertical
      }
    }

    // Globe projection: a lit central world with the clusters floating around
    // it as their own little orbital systems (the reference look). Each cluster
    // keeps its whole disc layout, shrunk and lifted off to a golden-angle point
    // out beyond the globe, oriented to face outward. The core sits at the
    // world's centre — the globe body is its avatar.
    if (use3d && globe) {
      const R = T.groundRadius;
      const satR = R * 2.0; // how far the satellite systems orbit the globe
      const idx = new Map(layout.names.map((nm, i) => [nm, i]));
      const nC = layout.names.length;
      // per-cluster disc centroid, so a node's offset is measured from its
      // own cluster's middle (each cluster becomes a self-contained system).
      const sum = new Map<string, { x: number; z: number; n: number }>();
      for (const n of nodes) {
        const p = relaxed.get(n.id) ?? home.get(n.id) ?? { x: 0, z: 0 };
        const s = sum.get(n.cluster) ?? { x: 0, z: 0, n: 0 };
        s.x += p.x; s.z += p.z; s.n += 1; sum.set(n.cluster, s);
      }
      // Two placements: clusters orbit the world as satellites (default), or
      // their orbs cling to its outer surface as continents.
      const onSurface = T.globeOrbsOnSurface;
      const orbitR = onSurface ? R : satR;
      const patchScale = onSurface ? R / 320 : 0.62;
      for (const n of nodes) {
        n.__lift = 0;
        if (n.role === "core") { n.x = n.fx = 0; n.y = n.fy = 0; n.z = n.fz = 0; continue; }
        const p = relaxed.get(n.id) ?? home.get(n.id) ?? { x: 0, z: 0 };
        const s = sum.get(n.cluster) ?? { x: 0, z: 0, n: 1 };
        const lx = (p.x - s.x / s.n) * patchScale;
        const lz = (p.z - s.z / s.n) * patchScale;
        const d = fibDir(idx.get(n.cluster) ?? 0, nC); // cluster direction
        const up = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
        const t1 = norm(cross(up, d));   // in-plane axis
        const t2 = cross(d, t1);         // the other in-plane axis
        const px = d[0] * orbitR + t1[0] * lx + t2[0] * lz;
        const py = d[1] * orbitR + t1[1] * lx + t2[1] * lz;
        const pz = d[2] * orbitR + t1[2] * lx + t2[2] * lz;
        if (onSurface) {
          // re-project onto the sphere so orbs sit exactly on the skin
          const [ux, uy, uz] = norm([px, py, pz]);
          n.x = n.fx = ux * R; n.y = n.fy = uy * R; n.z = n.fz = uz * R;
        } else {
          n.x = n.fx = px; n.y = n.fy = py; n.z = n.fz = pz;
        }
      }
    }

    const links: GraphLink[] = edgesProp
      .filter((e) => present.has(e.source) && present.has(e.target))
      .map((e) => ({
        source: e.source, target: e.target,
        relation: e.relation ?? "relates to",
        strength: e.strength ?? 0.8,
        origin: e.origin ?? "explicit",
      }));
    // topology: draw the fibre web (explicit + semantic ≥ fibre floor);
    // linkColour/Width split it into the faint + bright tiers at render.
    const renderLinks = links.filter((l) => l.origin === "explicit" || l.strength >= T.linkFibreMin);
    return { nodes, links, renderLinks };
  }, [nodesProp, edgesProp, use3d, layout, T.sectorRadius, T.ageLift, T.linkFibreMin, T.groundRadius, T.globeOrbsOnSurface, domeY, globe]);

  // keep the node-position map current for the ambient loop
  useEffect(() => {
    const m = new Map<string, { x: number; z: number; cluster: string }>();
    for (const n of data.nodes) if (n.x != null && n.z != null) m.set(n.id, { x: n.x, z: n.z, cluster: n.cluster });
    nodePosRef.current = m;
  }, [data.nodes]);

  const flashNodes = useCallback((ids: string | string[]) => {
    const now = Date.now();
    for (const id of Array.isArray(ids) ? ids : [ids]) flashRef.current.set(id, now);
    setFlashVersion((v) => v + 1);
    wake(T.flashMs + 400);
  }, [wake, T.flashMs]);

  // activation propagation ("watch it think"): seeds ignite, then a wave
  // spreads outward along links level by level — each hop flashes warm and
  // seeds a sea ripple. Bounded in depth and count.
  const igniteFrom = useCallback((start: string | string[]) => {
    igniteTimers.current.forEach((t) => clearTimeout(t));
    igniteTimers.current = [];
    const adj = new Map<string, string[]>();
    const push = (a: string, b: string) => { const arr = adj.get(a); if (arr) arr.push(b); else adj.set(a, [b]); };
    for (const l of data.links) { const s = linkEnd(l.source), t = linkEnd(l.target); push(s, t); push(t, s); }
    const MAX_DEPTH = 4, MAX_NODES = 60, STEP_MS = 240;
    const seeds = (Array.isArray(start) ? start : [start]).filter(Boolean);
    if (!seeds.length) return;
    const seen = new Set<string>(seeds);
    let frontier = [...seeds];
    let count = 0;
    for (let depth = 0; depth <= MAX_DEPTH && frontier.length && count < MAX_NODES; depth++) {
      const wave = frontier.slice(0, MAX_NODES - count);
      count += wave.length;
      const timer = window.setTimeout(() => {
        const now = Date.now();
        for (const id of wave) flashRef.current.set(id, now);
        setFlashVersion((v) => v + 1);
        wake(T.flashMs + 400);
      }, depth * STEP_MS);
      igniteTimers.current.push(timer);
      const next: string[] = [];
      for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      frontier = next;
    }
  }, [data.links, wake, T.flashMs]);
  useEffect(() => () => igniteTimers.current.forEach((t) => clearTimeout(t)), []);

  // neighbourhood of the hovered (or selected) node → link/orb highlight
  const focusNode_ = hover ?? selected;
  const neighbourhood = useMemo(() => {
    if (!focusNode_) return null;
    const nodeIds = new Set<string>([focusNode_.id]);
    const linkKeys = new Set<string>();
    for (const l of data.links) {
      const s = linkEnd(l.source), t = linkEnd(l.target);
      if (s === focusNode_.id || t === focusNode_.id) {
        nodeIds.add(s); nodeIds.add(t);
        linkKeys.add(`${s}>${t}`);
      }
    }
    return { nodeIds, linkKeys };
  }, [focusNode_, data.links]);

  // connections of the selected node → the inspector pane
  const selectedConnections = useMemo(() => {
    if (!selected) return [];
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const out: { neighbour: GraphNode; relation: string; strength: number; origin: string }[] = [];
    for (const l of data.links) {
      const s = linkEnd(l.source), t = linkEnd(l.target);
      const otherId = s === selected.id ? t : t === selected.id ? s : null;
      if (!otherId) continue;
      const neighbour = byId.get(otherId);
      if (!neighbour) continue;
      out.push({ neighbour, relation: l.relation, strength: l.strength, origin: l.origin });
    }
    out.sort((a, b) => b.strength - a.strength);
    return out;
  }, [selected, data]);

  // 0→1 flash intensity for a node (fades out). Stable identity.
  const flashK = useCallback((id: string): number => {
    const at = flashRef.current.get(id);
    if (!at) return 0;
    return Math.max(0, 1 - (Date.now() - at) / T.flashMs);
  }, [T.flashMs]);

  // nodeVal/linkCurvature bake into GEOMETRY — 3d-force-graph rebuilds every
  // sphere/curve when the accessor IDENTITY changes, so these stay memoised.
  const nodeVal = useCallback((n: GraphNode) => {
    const base = n.role === "core" ? 48 : n.role === "hub" ? 20 : 1.5 + (n.weight || 0) * 12 + Math.min(n.degree || 0, 40) * 0.3;
    return base * (1 + flashK(n.id) * 1.2); // pop bigger as it arrives, then settle
  }, [flashK]);

  const nodeColour = useCallback((n: GraphNode) => {
    const base = n.role === "core" ? "#ffe6b0" : clusterColor(n.cluster);
    if (neighbourhood && !neighbourhood.nodeIds.has(n.id)) return "rgba(90,110,150,0.12)";
    // recency: vivid cluster hue when fresh, fading toward cold slate as it
    // ages. Keep ≥30% of the cluster colour even when ancient; the core never
    // ages out. Flash heat overrides everything.
    const fresh = n.__fresh ?? 0.5;
    const aged = n.role === "core" ? base : hexLerp(T.agedColor, base, 0.3 + 0.7 * fresh);
    const k = flashK(n.id);
    return k > 0 ? hexLerp(aged, T.flashColor, k) : aged;
  }, [neighbourhood, flashK, clusterColor, T.agedColor, T.flashColor]);

  const linkColour = useCallback((l: GraphLink) => {
    const s = linkEnd(l.source), t = linkEnd(l.target);
    const hue = l.origin === "explicit" ? "140,180,255" : "130,210,190"; // blue / teal
    // a focused node's own links blaze; everything else recedes — but keep a
    // faint trace of the surrounding web so the structure still reads.
    if (neighbourhood) {
      const on = neighbourhood.linkKeys.has(`${s}>${t}`);
      return `rgba(${hue},${(on ? 0.6 : 0.04).toFixed(3)})`;
    }
    const a = isBright(l) ? 0.32 + l.strength * 0.28 : 0.12;
    return `rgba(${hue},${a.toFixed(3)})`;
  }, [neighbourhood, isBright]);

  // ── scene composition (war-table disc) + bloom + oblique camera ─────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !GraphComp || !data.nodes.length) return;

    // Every node is pinned — REMOVE the forces entirely (null), don't just zero
    // their strength: a forceManyBody at strength 0 still builds + traverses a
    // Barnes-Hut quadtree over every node per tick (pure CPU).
    try {
      fg.d3Force("charge", null);
      fg.d3Force("link", null);
      fg.d3Force("center", null);
      fg.d3AlphaMin?.(1);
      fg.cooldownTicks?.(0);
      fg.cooldownTime?.(0);
    } catch { /* 2d/3d force API differs — best-effort */ }

    if (use3d && threeRef.current) {
      const THREE = threeRef.current;
      // filmic tone mapping — near-black surface, blooming highlights.
      if (!(fg as any).__toned) {
        try {
          const renderer = fg.renderer?.();
          if (renderer) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = T.toneExposure;
            if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
            // Cap DPR — retina renders 4–9× the pixels for a near-invisible gain.
            const dpr = Math.min(window.devicePixelRatio || 1, T.pixelRatioCap);
            renderer.setPixelRatio?.(dpr);
            fg.postProcessingComposer?.()?.setPixelRatio?.(dpr);
            (fg as any).__toned = true;
          }
        } catch { /* tone mapping is best-effort */ }
      }
      // bloom — high threshold so only emissive beams/points glow
      if (T.bloom && bloomCtorRef.current && !(fg as any).__bloom) {
        try {
          const composer = fg.postProcessingComposer?.();
          if (composer) {
            const [strength, radius, threshold] = T.bloom;
            const pass = new bloomCtorRef.current(new THREE.Vector2(size.w || 1200, size.h || 800), strength, radius, threshold);
            composer.addPass(pass);
            (fg as any).__bloom = true;
          }
        } catch { /* bloom is a nice-to-have */ }
      }

      // scene furniture — added once per graph instance
      if (!(fg as any).__decorated) {
        try {
          const scene = fg.scene?.();
          if (scene) {
            if (T.fogDensity > 0) scene.fog = new THREE.FogExp2(new THREE.Color(T.background).getHex(), T.fogDensity);
            const group = new THREE.Group();

            if (globe) {
              // Globe furniture: the lit world, its equatorial ring (the old
              // bezel), and each cluster's label floated by its satellite. The
              // disc-only pieces (sea, ground plane, ground rings) are dropped.
              if (T.globeVisible) {
                group.add(makeGlobe(THREE, T.groundRadius, {
                  color: T.globeColor, opacity: T.globeOpacity, gridOutside: T.globeGridOutside,
                }));
              }
              if (T.outerDisk) group.add(makeEquatorialRing(THREE, T.groundRadius * 1.28));
              if (T.clusterLabels) {
                const nC = layout.names.length;
                const rr = T.groundRadius * T.globeLabelRadius; // user-set label distance
                layout.names.forEach((c, i) => {
                  const d = fibDir(i, nC);
                  const spr = makeTextSprite(THREE, c.toUpperCase(), clusterColor(c));
                  spr.position.set(d[0] * rr, d[1] * rr, d[2] * rr);
                  group.add(spr);
                });
              }
            } else {
            if (T.sea) {
              const sea = makeSea(THREE, T.groundRadius * 0.975, T.domeRadius);
              group.add(sea);
              (fg as any).__sea = sea;
            }

            group.add(makeGroundPlane(THREE, T.groundRadius, domeY));
            if (T.nightLights) group.add(makeNightLights(THREE, T.groundRadius * 0.96, domeY));

            // concentric orbital rings, each seated on the dome at its radius
            for (const r of T.ringRadii) {
              const y = domeY(r);
              const pts: any[] = [];
              for (let i = 0; i <= 160; i++) {
                const a = (i / 160) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
              }
              const geo = new THREE.BufferGeometry().setFromPoints(pts);
              group.add(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x2c4a6e, transparent: true, opacity: 0.26 })));
            }

            group.add(makeGlowSprite(THREE, 320)); // sun-core at the origin

            if (T.outerDisk) {
              const outerDisk = createOuterDisk(THREE, T.groundRadius, domeY);
              group.add(outerDisk);
              (fg as any).__outerDisk = outerDisk;
            }

            if (T.clusterLabels) {
              const labelY = domeY(T.labelRadius) + 18;
              for (const c of layout.names) {
                const p = layout.center(c, T.labelRadius);
                const spr = makeTextSprite(THREE, c.toUpperCase(), clusterColor(c));
                spr.position.set(p.x, labelY, p.z);
                group.add(spr);
              }
            }
            }

            const dust = makeDust(THREE, T.groundRadius);
            scene.add(dust);
            (fg as any).__dust = dust;

            if (T.starfield) {
              const sky = new THREE.Group();
              sky.add(makeStarfield(THREE, 1800, 2800));
              sky.add(makeNebula(THREE, layout.names.map((c) => clusterColor(c))));
              scene.add(sky);
              disableRaycast(sky);
              (fg as any).__sky = sky;
            }

            scene.add(group);
            // none of the furniture is interactive — keep it out of the hover
            // raycaster (the mouse-move perf fix).
            disableRaycast(group);
            disableRaycast(dust);
            (fg as any).__decorated = true;
          }
        } catch { /* decoration is cosmetic; never block the graph */ }
      }

      // frame the disc at a low oblique angle, once
      if (!(fg as any).__framed) {
        try {
          // Globe: orbit from a little above, aimed at the world's centre, far
          // enough back to frame the satellites (they orbit at ~1.62×R).
          const camStart = globe
            ? { x: 0, y: T.groundRadius * 0.5, z: T.groundRadius * 4.2 }
            : T.cameraStart;
          const camLook = globe ? { x: 0, y: 0, z: 0 } : T.cameraLook;
          fg.cameraPosition(camStart, camLook, 0);
          // Table auto-fits to the node spread; the globe uses its explicit
          // framing (zoomToFit would ignore the world body and zoom past it).
          if (!globe) setTimeout(() => { try { fg.zoomToFit(800, 130); } catch { /* */ } }, 80);
          (fg as any).__framed = true;
        } catch { /* */ }
      }
    } else if (!(fg as any).__framed) {
      setTimeout(() => { try { fg.zoomToFit(600, 60); } catch { /* */ } }, 80);
      (fg as any).__framed = true;
    }
    wake(2200); // run through the initial frame + zoom-to-fit
  }, [GraphComp, data.nodes, use3d, size.w, size.h, wake, T, layout, clusterColor, domeY, globe]);

  // ── ambient motion — drift the dust + roll the sea; nodes stay put ──────────
  // Advances the shared clocks and feeds activity ripples/storms into the sea
  // shader; drives a throttled GL-only redraw (~25fps) while the heavy loop
  // sleeps so the water never freezes.
  useEffect(() => {
    if (!use3d || !GraphComp) return;
    let raf = 0;
    let lastDraw = 0;
    let lastT = 0;
    const AMBIENT_FRAME_MS = 40;
    const tick = (now: number) => {
      const fg = fgRef.current as any;
      if (fg) {
        const tsec = now * 0.001;
        const delta = lastT ? Math.min((now - lastT) * 0.001, 0.1) : 0;
        lastT = now;
        const dust = fg.__dust;
        if (dust) {
          dust.rotation.y = now * 0.00002;
          dust.material.opacity = 0.3 + Math.sin(now * 0.0006) * 0.12; // slow twinkle
        }
        const sky = fg.__sky;
        if (sky) sky.rotation.y = now * 0.000006;
        const sea = fg.__sea;
        if (sea?.material?.uniforms?.uTime) sea.material.uniforms.uTime.value = tsec;
        const outerDisk = fg.__outerDisk;
        if (outerDisk?.update) outerDisk.update(delta);
        ringClockRef.current.value = tsec;

        // seed a ripple from each newly-flashed node + feed its cluster's storm
        const flash = flashRef.current;
        for (const [id] of flash) {
          if (seaSeenRef.current.has(id)) continue;
          seaSeenRef.current.add(id);
          const p = nodePosRef.current.get(id);
          if (p) {
            seaSrcRef.current.push({ x: p.x, y: -p.z, str: 1.0, t: tsec });
            const cl = p.cluster;
            stormRef.current.set(cl, (stormRef.current.get(cl) ?? 0) + STORM_GAIN * clusterPersona(cl).volatility);
          }
        }
        for (const id of seaSeenRef.current) if (!flash.has(id)) seaSeenRef.current.delete(id);

        // decay storm energy; promote clusters over threshold to storm cells
        // anchored at their sector centre (re-stamped so they churn in place).
        const storms: { x: number; y: number; str: number; t: number }[] = [];
        if (stormRef.current.size) {
          for (const [cl, e] of stormRef.current) {
            const ne = e - STORM_DECAY * delta;
            if (ne <= 0.001) stormRef.current.delete(cl);
            else {
              stormRef.current.set(cl, ne);
              if (ne >= STORM_THRESHOLD) {
                const cc = layout.center(cl, T.sectorRadius);
                storms.push({ x: cc.x, y: -cc.z, str: Math.min(0.9 + ne * 0.5, 2.2), t: tsec });
              }
            }
          }
          storms.sort((a, b) => b.str - a.str);
        }

        if (seaSrcRef.current.length) {
          seaSrcRef.current = seaSrcRef.current.filter((s) => tsec - s.t < SEA_RIPPLE_TTL);
        }
        const uSrc = sea?.material?.uniforms?.uSources?.value;
        if (uSrc) {
          const stormSrc = storms.slice(0, STORM_MAX_CELLS);
          const ripples = seaSrcRef.current.slice(-(SEA_SRC_COUNT - stormSrc.length));
          const src = [...stormSrc, ...ripples];
          for (let i = 0; i < SEA_SRC_COUNT; i++) {
            const s = src[i];
            if (s) uSrc[i].set(s.x, s.y, s.str, s.t);
            else uSrc[i].set(0, 0, 0, 0);
          }
        }

        if (!awakeRef.current && now - lastDraw >= AMBIENT_FRAME_MS) {
          lastDraw = now;
          try {
            const composer = fg.postProcessingComposer?.();
            if (composer) composer.render();
            else fg.renderer?.()?.render(fg.scene?.(), fg.camera?.());
          } catch { /* ambient frame is best-effort */ }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [use3d, GraphComp, layout, clusterPersona, T.sectorRadius]);

  // ── tentacles on the selected node — its REAL connections ───────────────────
  // Sourced from the FULL link set, so even links below the drawn-fibre
  // threshold still get a tentacle. Capped so a dense hub doesn't sprout hundreds.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!use3d || !GraphComp) return;
    const fg = fgRef.current as any;
    const THREE = threeRef.current;
    const scene = fg?.scene?.();
    if (!fg || !THREE || !scene) return;
    const teardown = () => {
      const g = fg.__futures;
      if (!g) return;
      scene.remove(g);
      g.traverse?.((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      fg.__futures = null;
    };
    teardown();
    if (!selectedId) return;
    const MAX_TENTACLES = 16;
    const byStrength = new Map<string, number>();
    for (const l of data.links) {
      const s = linkEnd(l.source), t = linkEnd(l.target);
      const other = s === selectedId ? t : t === selectedId ? s : null;
      if (!other) continue;
      const prev = byStrength.get(other);
      if (prev == null || l.strength > prev) byStrength.set(other, l.strength);
    }
    const top = [...byStrength.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TENTACLES).map((e) => e[0]);
    if (!top.length) return;
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const from = byId.get(selectedId);
    if (!from || from.x == null) return;
    const color = from.role === "core" ? "#ffe6b0" : clusterColor(from.cluster);
    const p0 = new THREE.Vector3(from.x, from.y || 0, from.z);
    const born = ringClockRef.current.value;
    const group = new THREE.Group();
    top.forEach((id, i) => {
      const c = byId.get(id);
      if (!c || c.x == null) return;
      const p2 = new THREE.Vector3(c.x, c.y || 0, c.z); // terminate ON the connected orb
      group.add(makeFuturesBranch(THREE, p0, p2, color, ringClockRef.current, born, i * 0.08));
    });
    group.renderOrder = 2;
    disableRaycast(group);
    scene.add(group);
    fg.__futures = group;
    wake(1600); // draw through the grow-in
    return teardown;
    // reads data at select time (positions are static); rebuild only on selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, use3d, GraphComp]);

  // wake the render loop on interaction (render-on-demand driver)
  useEffect(() => {
    if (!use3d || !GraphComp) return;
    const el = wrapRef.current;
    if (!el) return;
    const onMove = () => wake();
    const onHold = () => wake(1500); // drags/zoom + inertia settle
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerdown", onHold, { passive: true });
    el.addEventListener("pointerup", onHold, { passive: true });
    el.addEventListener("wheel", onHold, { passive: true });
    el.addEventListener("keydown", onMove);
    const controls = fgRef.current?.controls?.();
    controls?.addEventListener?.("change", onHold);
    wake(2200);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onHold);
      el.removeEventListener("pointerup", onHold);
      el.removeEventListener("wheel", onHold);
      el.removeEventListener("keydown", onMove);
      controls?.removeEventListener?.("change", onHold);
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
    };
  }, [use3d, GraphComp, wake]);

  // focus camera (3D) / centre (2D) on a node — consistent overhead vantage
  const focusNode = (n: GraphNode) => {
    const fg = fgRef.current;
    if (!fg) return;
    wake(1600);
    if (use3d && n.x != null) {
      const up = 320, back = 110;
      fg.cameraPosition(
        { x: n.x || 0, y: (n.y || 0) + up, z: (n.z || 0) + back },
        { x: n.x || 0, y: n.y || 0, z: n.z || 0 },
        1200,
      );
    } else if (!use3d && n.x != null && n.y != null) {
      fg.centerAt?.(n.x, n.y, 1000);
      fg.zoom?.(3, 1000);
    }
  };

  // cinematic travel: rise to a high waypoint arced toward the target, then
  // descend onto an over-the-shoulder vantage. Double-click / pane rows.
  const flyTo = (n: GraphNode) => {
    const fg = fgRef.current as any;
    if (!fg) return;
    if (!use3d || n.x == null) { focusNode(n); return; }
    const look = { x: n.x || 0, y: n.y || 0, z: n.z || 0 };
    const cam = (fg.cameraPosition?.() as { x: number; y: number; z: number }) || T.cameraStart;
    const waypoint = { x: (cam.x + look.x) / 2, y: Math.max(cam.y, look.y) + 520, z: (cam.z + look.z) / 2 };
    const vantage = { x: look.x, y: look.y + 210, z: look.z + 150 };
    flyTimers.current.forEach((t) => clearTimeout(t));
    flyTimers.current = [];
    wake(2600);
    fg.cameraPosition(waypoint, look, 780);
    flyTimers.current.push(
      window.setTimeout(() => {
        try { fgRef.current?.cameraPosition(vantage, look, 1150); wake(1500); } catch { /* */ }
      }, 740),
    );
  };
  useEffect(() => () => flyTimers.current.forEach((t) => clearTimeout(t)), []);

  const pulseNode = useCallback((n: GraphNode) => { flashNodes(n.id); }, [flashNodes]);

  const onNodeClick = (n: GraphNode) => {
    setSelected(n);
    pulseNode(n);
    // double-click the same orb → cinematic fly-to; single click reveals in place
    const now = Date.now();
    const dbl = lastClickRef.current.id === n.id && now - lastClickRef.current.t < 350;
    lastClickRef.current = { id: n.id, t: now };
    if (dbl) { flyTo(n); return; }
    // proximity disambiguation: collect every orb packed around the click
    const fg = fgRef.current as any;
    if (use3d && fg?.graph2ScreenCoords && n.x != null && n.y != null && n.z != null) {
      const c = fg.graph2ScreenCoords(n.x, n.y, n.z);
      const packed = data.nodes
        .filter((o) => o.id !== n.id && o.x != null && o.y != null && o.z != null)
        .map((o) => {
          const w3 = Math.hypot((o.x as number) - n.x!, (o.y as number) - n.y!, (o.z as number) - n.z!);
          const s = fg.graph2ScreenCoords(o.x, o.y, o.z);
          return { o, w3, px: Math.hypot(s.x - c.x, s.y - c.y) };
        })
        .filter((d) => d.w3 <= PROX_WORLD_MAX && d.px <= PROX_SCREEN_PX)
        .sort((a, b) => a.px - b.px)
        .map((d) => d.o);
      setNearby(packed.length ? [n, ...packed] : []);
    } else {
      setNearby([]);
    }
  };

  const pickNearby = (n: GraphNode) => { setSelected(n); pulseNode(n); };
  const pickNode = (n: GraphNode) => { setSelected(n); setNearby([]); flyTo(n); };
  const searchPick = useCallback((n: GraphNode) => {
    setSelected(n);
    setNearby([]);
    pulseNode(n);
    flyTo(n);
    setSearchOpen(false);
    // flyTo is a stable-behaviour closure (reads fgRef); omit to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseNode, setSelected]);

  // ⌘K / Ctrl-K toggles the search palette
  useEffect(() => {
    if (!search) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  // ── imperative surface ───────────────────────────────────────────────────────
  useImperativeHandle(handleRef, (): CortexMapHandle => ({
    flash: flashNodes,
    ignite: igniteFrom,
    focus: (id: string) => {
      const n = data.nodes.find((x) => x.id === id);
      if (!n) return;
      setSelected(n);
      pulseNode(n);
      focusNode(n);
    },
    clearSelection: () => { setSelected(null); setNearby([]); },
    // focusNode reads fgRef live; data.nodes is the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [flashNodes, igniteFrom, data.nodes, pulseNode, setSelected]);

  // when a node is SELECTED, fade everything not linked to it
  const dimSetRef = useRef<Set<string> | null>(null);
  useMemo(() => {
    if (!selected) { dimSetRef.current = null; return; }
    const keep = new Set<string>([selected.id]);
    for (const l of data.links) {
      const s = linkEnd(l.source), t = linkEnd(l.target);
      if (s === selected.id) keep.add(t);
      else if (t === selected.id) keep.add(s);
    }
    const dim = new Set<string>();
    for (const n of data.nodes) if (n.role !== "core" && !keep.has(n.id)) dim.add(n.id);
    dimSetRef.current = dim;
  }, [selected, data.links, data.nodes]);

  // ring disks are the heaviest per-node decoration — gate to the structural
  // core + the top ~5% most-connected nodes (+ the selection).
  const ringDegreeMin = useMemo(() => {
    const degs = data.nodes.map((n) => n.degree || 0).filter((d) => d > 0).sort((a, b) => a - b);
    if (!degs.length) return Infinity;
    const p95 = degs[Math.min(degs.length - 1, Math.floor(degs.length * 0.95))];
    return Math.max(p95, 1);
  }, [data.nodes]);

  // per-node 3D decoration: glow halo on every node + HUD ring/pillar for the
  // prominent. MUST be identity-stable across hover re-renders (rebuilds all
  // node geometry otherwise); rebuilds on SELECT so dimmed nodes fade.
  const nodeDecor = useCallback((n: GraphNode) => {
    const THREE = threeRef.current;
    if (!THREE || !use3d) return undefined;
    const dimmed = dimSetRef.current?.has(n.id) ?? false;
    const isCore = n.role === "core";
    // Globe: the world body IS the core, so the core node itself is hidden
    // (it sits at the sphere centre and would just glow through the surface).
    if (globe && isCore) return new THREE.Group();
    const colour = isCore ? "#ffe6b0" : clusterColor(n.cluster);
    const persona = clusterPersona(n.cluster);
    const lift = n.__lift ?? 0;
    const group = new THREE.Group();
    const haloBase = isCore ? 40 : n.role === "hub" ? 24 : 6 + (n.weight || 0) * 14 + Math.min(n.degree || 0, 40) * 0.25;
    const halo = isCore ? haloBase : haloBase * persona.halo;
    const glow = makeNodeGlow(THREE, dimmed ? halo * 0.6 : halo, colour);
    if (dimmed) glow.material.opacity *= 0.14;
    group.add(glow);
    if (!dimmed) {
      const w = n.weight || 0;
      const isSel = n.id === selectedId;
      const ringed = isCore || isSel || (n.degree || 0) >= ringDegreeMin;
      if (ringed) {
        const rr = isCore ? 150 : n.role === "hub" ? 100 : n.role === "subhub" ? 56 : 40 + w * 50;
        const detail = isSel || isCore || n.role === "hub" ? 1.0 : n.role === "subhub" ? 0.6 : 0.0;
        const deg = Math.min(n.degree || 0, 40) / 40;
        const rate = (RING_RATE_BASE + deg * RING_RATE_PER_DEG + (isSel ? 3.0 : 0.0)) * persona.ringRate;
        const ring = makeNodeRing(THREE, colour, rr, detail, rate, ringClockRef.current);
        if (!globe) ring.position.y -= lift; // keep the floor disk on the dome
        group.add(ring);
      }
      // Pillars fire straight up (+y) — correct on the table, wrong on a globe
      // (they'd all point one way, not radially). Omitted in the globe prototype.
      if (!globe && isCore) {
        group.add(makePillar(THREE, PILLAR_CORE_H, 3, colour));
      } else if (!globe && w >= T.pillarMinWeight) {
        const t = (w - T.pillarMinWeight) / (1 - T.pillarMinWeight);
        const pillar = makePillar(THREE, PILLAR_BASE_H + Math.pow(t, PILLAR_CURVE) * PILLAR_SCALE, 1.5, colour);
        pillar.position.y -= lift;
        group.add(pillar);
      }
    }
    disableRaycast(group);
    // generous invisible hit target — added AFTER disableRaycast so it STAYS
    // raycastable (three keys raycasting off object.visible, not material.visible)
    const hitR = isCore ? HIT_RADIUS_CORE : n.role === "hub" ? HIT_RADIUS_HUB : n.role === "subhub" ? HIT_RADIUS_SUBHUB : HIT_RADIUS_LEAF;
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(hitR, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false, depthWrite: false }),
    );
    group.add(hit);
    return group;
  }, [use3d, selectedId, ringDegreeMin, clusterColor, clusterPersona, T.pillarMinWeight, globe]);

  // stable accessors — width/particles/curvature bake into geometry
  const linkWidth = useCallback((l: GraphLink) => (isBright(l) ? 0.7 : 0.18), [isBright]);
  const linkParticles = useCallback((l: GraphLink) => (isBright(l) ? (l.strength >= 0.92 ? 3 : 2) : 0), [isBright]);
  const linkCurvature = useCallback((l: GraphLink) => (isBright(l) ? 0.22 : 0), [isBright]);
  const linkCurveRotation = useCallback((l: GraphLink) => {
    const k = `${linkEnd(l.source)}>${linkEnd(l.target)}`;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return ((h % 360) * Math.PI) / 180;
  }, []);

  const renderGraph = useMemo(() => ({ nodes: data.nodes, links: data.renderLinks }), [data]);

  // energy surge: while nodes are flashing, particles speed up and thicken —
  // the network visibly pulses when it's thinking, then settles.
  const surge = flashRef.current.size > 0;
  const commonProps = {
    ref: fgRef,
    graphData: renderGraph,
    width: size.w || undefined,
    height: size.h || undefined,
    backgroundColor: T.background,
    nodeId: "id",
    nodeVal,
    nodeLabel: (n: GraphNode) => `${n.label}  ·  ${n.cluster}${n.summary ? `\n${n.summary}` : ""}`,
    nodeColor: nodeColour,
    nodeOpacity: 0.85,
    nodeRelSize: 2,
    nodeThreeObject: nodeDecor,
    nodeThreeObjectExtend: true,
    linkColor: linkColour,
    linkWidth,
    linkCurvature,
    linkCurveRotation,
    linkDirectionalParticles: linkParticles,
    linkDirectionalParticleWidth: surge ? 2.3 : 1.6,
    linkDirectionalParticleSpeed: surge ? 0.011 : 0.0045,
    onNodeHover: (n: GraphNode | null) => { setHover(n); wake(); },
    onNodeClick,
    onBackgroundClick: () => { setSelected(null); setNearby([]); wake(); },
    cooldownTicks: 0,
    warmupTicks: 0,
  };

  // per-cluster node counts for the legend
  const clusterCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of data.nodes) m.set(n.cluster, (m.get(n.cluster) ?? 0) + 1);
    return m;
  }, [data.nodes]);

  return (
    <div
      ref={wrapRef}
      className={`cortex-map${className ? ` ${className}` : ""}`}
      style={{ background: T.background, width: "100%", height: "100%", ...style }}
    >
      {/* Remount the graph when the projection flips OR any furniture-shaping
          globe option changes: the scene furniture and camera are set once
          behind __decorated/__framed guards on the graph instance, so a fresh
          instance is the clean way to re-run them. (Deferred theme coalesces
          slider drags, so this is one remount per settled change.) */}
      {GraphComp ? <GraphComp key={globe
        ? `globe:${T.globeVisible}:${T.globeGridOutside}:${T.globeOrbsOnSurface}:${T.globeColor}:${T.globeOpacity.toFixed(2)}:${T.globeLabelRadius.toFixed(2)}:${T.outerDisk}:${T.clusterLabels}`
        : "table"} {...commonProps} /> : (
        <div className="cm-status">initialising map…</div>
      )}

      <div className="cm-vignette" />

      {/* legend */}
      <div className="cm-panel" style={{ bottom: 12, left: 12, width: 210 }}>
        <div className="cm-title">Clusters</div>
        {layout.names.map((c) => (
          <div key={c} className="cm-legend-row">
            <span className="cm-dot" style={{ background: clusterColor(c), boxShadow: `0 0 8px ${clusterColor(c)}` }} />
            <span className="name">{c}</span>
            <span className="count">{clusterCounts.get(c) ?? 0}</span>
          </div>
        ))}
      </div>

      {/* stats */}
      <div className="cm-panel" style={{ top: 12, left: 12, width: 210 }}>
        <div className="cm-title">Map</div>
        <div className="cm-row"><span className="k">Nodes</span><span>{data.nodes.length.toLocaleString()}</span></div>
        <div className="cm-row"><span className="k">Links</span><span>{data.links.length.toLocaleString()}</span></div>
        <div className="cm-row"><span className="k">Clusters</span><span>{layout.names.length}</span></div>
        <div className="cm-row"><span className="k">Mode</span><span>{use3d ? "3D" : "2D"}</span></div>
      </div>

      {/* hovered-node card */}
      {hover && !selected && (
        <div className="cm-panel" style={{ bottom: 12, right: 12, width: 240 }}>
          <div className="cm-title">Node</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{hover.label}</div>
          <div className="cm-row"><span className="k">Cluster</span><span>{hover.cluster}</span></div>
          {hover.type && <div className="cm-row"><span className="k">Type</span><span>{hover.type}</span></div>}
          <div className="cm-row"><span className="k">Links</span><span>{hover.degree ?? 0}</span></div>
          {hover.summary && <div className="cm-pane-summary">{hover.summary}</div>}
        </div>
      )}

      {/* controls */}
      <div className="cm-controls">
        {search && (
          <button type="button" className="cm-chip" onClick={() => setSearchOpen(true)} title="Search the map (⌘K)">
            Search <kbd>⌘K</kbd>
          </button>
        )}
        <button
          type="button"
          className="cm-chip"
          onClick={() => setLite(!liteMode)}
          disabled={reduceMotion || liteProp != null}
          title={reduceMotion ? "Reduced-motion is on — lite mode is forced" : use3d ? "Switch to lite mode (flat 2D)" : "Switch to the full 3D map"}
        >
          <span className="cm-dot" style={{ height: 6, width: 6, background: use3d ? "#5ad6a0" : "#e0b450", boxShadow: `0 0 6px ${use3d ? "#5ad6a0" : "#e0b450"}` }} />
          {use3d ? "Lite mode" : "3D mode"}
        </button>
      </div>

      {/* proximity picker — when the click landed in a crowd of orbs */}
      {nearby.length > 1 && (
        <div className="cm-picker">
          <div className="cm-picker-head">
            <span className="n">{nearby.length} orbs here</span>
            <button className="cm-close" onClick={() => setNearby([])} aria-label="Close">✕</button>
          </div>
          <div className="cm-picker-list">
            {nearby.map((n) => (
              <button
                key={n.id}
                className={`cm-picker-row${n.id === selected?.id ? " selected" : ""}`}
                onClick={() => pickNearby(n)}
                title={n.summary ?? n.label}
              >
                <span className="cm-dot" style={{ background: n.role === "core" ? "#ffe6b0" : clusterColor(n.cluster), boxShadow: `0 0 6px ${n.role === "core" ? "#ffe6b0" : clusterColor(n.cluster)}` }} />
                <span className="label">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* node inspector — opens on click, lists the node's linkages */}
      {inspector && selected && (
        <div className="cm-pane">
          <div className="cm-pane-head">
            <span className="cm-dot" style={{ marginTop: 4, background: selected.role === "core" ? "#ffe6b0" : clusterColor(selected.cluster), boxShadow: `0 0 8px ${selected.role === "core" ? "#ffe6b0" : clusterColor(selected.cluster)}` }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title">{selected.label}</div>
              <div className="sub">{selected.cluster}{selected.type ? ` · ${selected.type}` : ""}</div>
            </div>
            <button className="cm-close" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <div className="cm-pane-meta">
            <div className="cm-row"><span className="k">Links</span><span>{selected.degree ?? selectedConnections.length}</span></div>
            <div className="cm-row"><span className="k">Weight</span><span>{(selected.weight ?? 0).toFixed(3)}</span></div>
            {selected.summary && <div className="cm-pane-summary">{selected.summary}</div>}
          </div>
          <div className="cm-pane-section">Linkages · {selectedConnections.length}</div>
          <div className="cm-pane-list">
            {selectedConnections.length === 0 && (
              <div style={{ padding: "8px 4px", fontSize: 11, color: "var(--cm-text-dim)" }}>No links yet.</div>
            )}
            {selectedConnections.map((c, i) => (
              <button
                key={`${c.neighbour.id}-${c.relation}-${i}`}
                className="cm-link-row"
                onClick={() => pickNode(c.neighbour)}
                title="Fly to this node"
              >
                <span className="cm-dot" style={{ marginTop: 5, background: c.neighbour.role === "core" ? "#ffe6b0" : clusterColor(c.neighbour.cluster) }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="label">{c.neighbour.label}</span>
                  <span className="relation">{c.relation} · {c.neighbour.cluster} · {Math.round(c.strength * 100)}%</span>
                  {c.neighbour.summary && <span className="summary">{c.neighbour.summary}</span>}
                </span>
                <span className="cm-strength">
                  <span style={{ width: `${Math.round(c.strength * 100)}%`, background: c.origin === "explicit" ? "#7aa2ff" : "#78c8b4" }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* search palette */}
      {search && searchOpen && (
        <CortexSearch
          nodes={data.nodes}
          clusterColor={clusterColor}
          onPick={searchPick}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
});

// ── search palette — instant client-side fuzzy match over label/summary ───────
function scoreNode(n: GraphNode, q: string): number {
  const label = n.label.toLowerCase();
  const summary = (n.summary ?? "").toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (summary.includes(q)) return 30;
  return 0;
}

function CortexSearch({
  nodes,
  clusterColor,
  onPick,
  onClose,
}: {
  nodes: GraphNode[];
  clusterColor: (c: string) => string;
  onPick: (n: GraphNode) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const hits = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return nodes
      .map((n) => ({ n, s: scoreNode(n, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || (b.n.degree ?? 0) - (a.n.degree ?? 0) || a.n.label.localeCompare(b.n.label))
      .slice(0, 12)
      .map((r) => r.n);
  }, [q, nodes]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // don't let arrows/keys drive the camera behind the palette
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const pick = hits[active]; if (pick) onPick(pick); }
  };

  return (
    <>
      <div className="cm-scrim" onClick={onClose} />
      <div className="cm-search" onKeyDown={onKeyDown}>
        <div className="cm-search-head">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name — label or detail…"
          />
          <button className="cm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {q.trim() && (
          <div ref={listRef} className="cm-search-list">
            {hits.length === 0 ? (
              <div className="cm-search-empty">no orbs match</div>
            ) : (
              hits.map((n, i) => (
                <button
                  key={n.id}
                  data-idx={i}
                  className={`cm-hit${i === active ? " active" : ""}`}
                  onClick={() => onPick(n)}
                  onMouseMove={() => setActive(i)}
                  title={n.summary ?? n.label}
                >
                  <span className="cm-dot" style={{ background: n.role === "core" ? "#ffe6b0" : clusterColor(n.cluster), boxShadow: `0 0 6px ${n.role === "core" ? "#ffe6b0" : clusterColor(n.cluster)}` }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="label">{n.label}</span>
                    {n.summary && <span className="summary">{n.summary}</span>}
                  </span>
                  <span className="cluster">{n.cluster}</span>
                </button>
              ))
            )}
          </div>
        )}
        <div className="cm-search-foot">
          <span>↵ fly to</span>
          <span>↑↓ to step · esc to close</span>
        </div>
      </div>
    </>
  );
}
