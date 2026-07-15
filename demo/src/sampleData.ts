// A fictional "second brain" dataset — the memory map of an imaginary indie
// game studio. Deterministic (seeded PRNG) so the demo looks the same on every
// load and screenshots stay reproducible. No real data anywhere.
import type { ClusterDef, CortexMapEdge, CortexMapNode } from "cortex-map";

export const CLUSTERS: ClusterDef[] = [
  { name: "Ideas", color: "#ffcf7a", angleDeg: 25, persona: { ringRate: 1.3, halo: 1.25, volatility: 0.7 } },
  { name: "Projects", color: "#4d8bf0", angleDeg: 70, persona: { ringRate: 1.0, halo: 1.0, volatility: 0.5 } },
  { name: "Research", color: "#9b6cf0", angleDeg: 130, persona: { ringRate: 0.6, halo: 1.1, volatility: 0.25 } },
  { name: "People", color: "#c9d6ef", angleDeg: 185, persona: { ringRate: 0.7, halo: 1.0, volatility: 0.3 } },
  { name: "Craft", color: "#f2b24a", angleDeg: 230, persona: { ringRate: 0.8, halo: 1.05, volatility: 0.3 } },
  { name: "Tools", color: "#58d68d", angleDeg: 275, persona: { ringRate: 0.9, halo: 0.95, volatility: 0.4 } },
  { name: "Playtests", color: "#36c6d6", angleDeg: 325, persona: { ringRate: 1.7, halo: 1.2, volatility: 0.9 } },
];

// Mulberry32 — tiny deterministic PRNG.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUBS: Record<string, string[]> = {
  Ideas: ["Underwater metroidvania", "Cosy automation sim", "One-button roguelike"],
  Projects: ["Project Lanternfish", "Studio website", "Game-jam entries"],
  Research: ["Procedural generation", "Player retention", "Colour theory"],
  People: ["The team", "Playtester circle", "Publisher contacts"],
  Craft: ["Level design patterns", "Juice & game feel", "Narrative beats"],
  Tools: ["Engine pipeline", "Build automation", "Analytics stack"],
  Playtests: ["Alpha sessions", "Steam Next Fest", "Discord feedback"],
};

const LEAF_WORDS = [
  "grappling hook physics", "bioluminescent palette", "save-anywhere design", "chunk streaming",
  "difficulty curves", "onboarding funnel", "wishlist conversion", "soundtrack sketches",
  "boss telegraphing", "input buffering", "coyote time", "screenshake budget",
  "dialogue trees", "ambient storytelling", "map legibility", "fast-travel rules",
  "shader compilation", "asset hot-reload", "crash triage", "frame pacing",
  "session length data", "churn cohorts", "tutorial skip rate", "demo feedback themes",
  "art style tests", "tileset experiments", "water caustics", "particle budgets",
  "community survey", "streamer outreach", "press kit", "launch trailer beats",
  "economy balancing", "crafting loops", "inventory friction", "quest pacing",
  "accessibility pass", "colourblind modes", "control remapping", "subtitle sizing",
];

export function makeSampleData(): { nodes: CortexMapNode[]; edges: CortexMapEdge[] } {
  const rand = rng(1337);
  const nodes: CortexMapNode[] = [];
  const edges: CortexMapEdge[] = [];
  const now = Date.UTC(2026, 0, 1); // fixed epoch — deterministic demo
  const day = 86_400_000;

  nodes.push({
    id: "core",
    label: "Studio brain",
    type: "core",
    cluster: "Projects",
    summary: "The centre of the map — everything the studio knows, connected.",
    weight: 1,
    role: "core",
    lastSeenAt: now,
  });

  let leaf = 0;
  for (const def of CLUSTERS) {
    const hubs = HUBS[def.name];
    hubs.forEach((hubLabel, hi) => {
      const hubId = `${def.name}-hub-${hi}`;
      nodes.push({
        id: hubId,
        label: hubLabel,
        type: "topic",
        cluster: def.name,
        summary: `Everything gathered under “${hubLabel}”.`,
        weight: 0.75 + rand() * 0.25,
        role: "hub",
        parentId: "core",
        lastSeenAt: now - Math.floor(rand() * 40) * day,
      });
      edges.push({ source: "core", target: hubId, relation: "anchors", strength: 0.95, origin: "explicit" });

      const subCount = 1 + Math.floor(rand() * 2);
      for (let si = 0; si < subCount; si++) {
        const subId = `${hubId}-sub-${si}`;
        const subLabel = LEAF_WORDS[leaf++ % LEAF_WORDS.length];
        nodes.push({
          id: subId,
          label: subLabel,
          type: "thread",
          cluster: def.name,
          summary: `An open thread inside ${hubLabel}: ${subLabel}.`,
          weight: 0.55 + rand() * 0.25,
          role: "subhub",
          parentId: hubId,
          lastSeenAt: now - Math.floor(rand() * 90) * day,
        });
        edges.push({ source: hubId, target: subId, relation: "contains", strength: 0.85, origin: "explicit" });

        const leafCount = 3 + Math.floor(rand() * 5);
        for (let li = 0; li < leafCount; li++) {
          const leafId = `${subId}-leaf-${li}`;
          const label = LEAF_WORDS[leaf++ % LEAF_WORDS.length];
          nodes.push({
            id: leafId,
            label,
            type: "note",
            cluster: def.name,
            summary: `A captured note about ${label} (${hubLabel}).`,
            weight: 0.2 + rand() * 0.5,
            role: "leaf",
            parentId: subId,
            lastSeenAt: now - Math.floor(rand() * 240) * day,
          });
          edges.push({ source: subId, target: leafId, relation: "contains", strength: 0.7 + rand() * 0.2, origin: "explicit" });
        }
      }
    });
  }

  // cross-cluster semantic links — the "thinking" tier that arcs across the map
  const leaves = nodes.filter((n) => n.role === "leaf");
  const CROSS = 90;
  for (let i = 0; i < CROSS; i++) {
    const a = leaves[Math.floor(rand() * leaves.length)];
    const b = leaves[Math.floor(rand() * leaves.length)];
    if (!a || !b || a.id === b.id || a.cluster === b.cluster) continue;
    edges.push({
      source: a.id,
      target: b.id,
      relation: "similar to",
      strength: 0.8 + rand() * 0.19,
      origin: "semantic",
    });
  }
  // a few strong explicit cross-links between hubs (bright arcs)
  const hubs = nodes.filter((n) => n.role === "hub");
  for (let i = 0; i < 10; i++) {
    const a = hubs[Math.floor(rand() * hubs.length)];
    const b = hubs[Math.floor(rand() * hubs.length)];
    if (!a || !b || a.id === b.id) continue;
    edges.push({ source: a.id, target: b.id, relation: "feeds", strength: 0.7 + rand() * 0.3, origin: "explicit" });
  }

  return { nodes, edges };
}
