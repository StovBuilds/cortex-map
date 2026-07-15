// Cluster geometry — parameterized version of the original fixed taxonomy.
// Users define clusters (name/colour/angle/persona); this module turns them
// into the spatial helpers the scene and layout use. Position encodes meaning:
// each cluster owns an angular sector around the core, nodes fill it as a
// golden-angle constellation seated on a shallow dome.

import type { ClusterDef, ClusterPersona } from "./types";

const NEUTRAL_PERSONA: ClusterPersona = { ringRate: 1, halo: 1, volatility: 0.5 };

// Golden-angle phyllotaxis: an even, gap-free spiral fill (sunflower seed-head).
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface ClusterLayout {
  names: string[];
  color(cluster: string): string;
  persona(cluster: string): ClusterPersona;
  angle(cluster: string): number;
  center(cluster: string, radius?: number): { x: number; y: number; z: number };
  /** Shallow-dome curvature: node's planar radius → y, so the disc curves away
   *  to a horizon (a world, not a diagram). Centre y=0; the rim dips below. */
  domeY(planarRadius: number): number;
  /** Deterministic constellation slot for a node inside its cluster's sector:
   *  same node index → same spot every render (the map becomes a place you
   *  learn), no overlap, no drift. */
  discPosition(
    cluster: string,
    localIndex: number,
    opts?: { sectorRadius?: number; spread?: number },
  ): { x: number; y: number; z: number };
}

export function createClusterLayout(
  clusters: ClusterDef[],
  opts: { domeRadius?: number; sectorRadius?: number; fallbackColor?: string } = {},
): ClusterLayout {
  const domeRadius = opts.domeRadius ?? 1500;
  const defaultSectorRadius = opts.sectorRadius ?? 440;
  const fallbackColor = opts.fallbackColor ?? "#7f93b0";

  const colorByName = new Map<string, string>();
  const personaByName = new Map<string, ClusterPersona>();
  const angleByName = new Map<string, number>();
  clusters.forEach((c, i) => {
    colorByName.set(c.name, c.color);
    personaByName.set(c.name, { ...NEUTRAL_PERSONA, ...c.persona });
    const deg = c.angleDeg ?? (i / Math.max(1, clusters.length)) * 360;
    angleByName.set(c.name, (deg * Math.PI) / 180);
  });

  const domeY = (planarRadius: number): number => {
    const r = Math.min(planarRadius, domeRadius);
    return Math.sqrt(Math.max(0, domeRadius * domeRadius - r * r)) - domeRadius;
  };

  const angle = (cluster: string): number => angleByName.get(cluster) ?? 0;

  const center = (cluster: string, radius = 260) => {
    const a = angle(cluster);
    return { x: Math.cos(a) * radius, y: 0, z: Math.sin(a) * radius };
  };

  return {
    names: clusters.map((c) => c.name),
    color: (cluster) => colorByName.get(cluster) ?? fallbackColor,
    persona: (cluster) => personaByName.get(cluster) ?? NEUTRAL_PERSONA,
    angle,
    center,
    domeY,
    discPosition(cluster, localIndex, o = {}) {
      const sectorRadius = o.sectorRadius ?? defaultSectorRadius;
      const spread = o.spread ?? 10;
      const c = center(cluster, sectorRadius);
      const r = spread * Math.sqrt(localIndex + 0.5);
      const a = localIndex * GOLDEN_ANGLE;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      return { x, y: domeY(Math.hypot(x, z)), z };
    },
  };
}
