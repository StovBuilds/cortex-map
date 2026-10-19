import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CortexMap, type CortexMapHandle, type CortexMapNode } from "cortex-map";
import { createCortexMapAdapter, type Point } from "cortex-gesture";
import { CLUSTERS, makeSampleData } from "../../demo/src/sampleData";
import { mountShell } from "./shell";

function App() {
  const { nodes, edges } = useMemo(() => makeSampleData(), []);
  const mapRef = useRef<CortexMapHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setSel] = useState<CortexMapNode | null>(null);

  useEffect(() => {
    const surface = wrapRef.current!;
    // a node near the middle of the view, for the ghost demo to point at
    let lastSpot: { ids: string[]; mode: string } | null = null;
    const findTarget = (): Point | null => {
      const map = mapRef.current;
      const r = surface.getBoundingClientRect();
      if (!map) return null;
      for (let ring = 0; ring < 12; ring++) {
        for (let a = 0; a < 16; a++) {
          const x = 0.5 + Math.cos((a / 16) * Math.PI * 2) * ring * 0.025;
          const y = 0.5 + Math.sin((a / 16) * Math.PI * 2) * ring * 0.03;
          if (map.nodeAt(x * r.width, y * r.height, 10)) return { x, y };
        }
      }
      return null;
    };
    // for the map-tricks ghost: a well-linked node near the middle, a neighbour, a spot to pin a card
    // for the map-tricks ghost: a cluster hub near the middle with a linked node on screen, and a spot to pin a card
    const mapSpots = () => {
      const map = mapRef.current;
      const r = surface.getBoundingClientRect();
      if (!map) return null;
      const onScreen = (p: { x: number; y: number } | null) => !!p && p.x > 80 && p.y > 80 && p.x < r.width - 80 && p.y < r.height - 80;
      let best: { id: string; d: number; link: { x: number; y: number } } | null = null;
      for (const id of map.nodeIds()) {
        const n = map.node(id), p = map.screenOf(id);
        if (!n || n.role !== "hub" || !p || !onScreen(p)) continue;
        const link = map.neighbours(id).map((x) => map.screenOf(x)).find((q) => onScreen(q) && Math.hypot(q!.x - p.x, q!.y - p.y) > 70);
        const d = Math.hypot(p.x - r.width / 2, p.y - r.height / 2);
        if (link && (!best || d < best.d)) best = { id, d, link: link! };
      }
      if (!best) return null;
      const p = map.screenOf(best.id)!;
      const node = { x: p.x / r.width, y: p.y / r.height };
      return { node, nodeId: best.id, linked: { x: best.link.x / r.width, y: best.link.y / r.height }, pinTo: { x: node.x < 0.5 ? 0.8 : 0.2, y: 0.25 } };
    };
    const shell = mountShell({
      page: "cortex",
      surface,
      findTarget,
      mapSpots,
      vocabulary: () => { const m = mapRef.current; return m ? m.nodeIds().map((id) => m.node(id)?.label ?? "").filter(Boolean) : []; },
      makeAdapter: (s) => createCortexMapAdapter(() => mapRef.current, {
        panGain: s.panGain, zoomGain: s.zoomGain, momentum: s.momentum ? {} : false,
        // accessibility mode: bigger targets
        ...(s.access ? { hoverRadius: 60, selectRadius: 72 } : {}),
        onSpotlight: (ids, mode) => { lastSpot = ids ? { ids, mode } : null; },
      }),
    });
    (window as unknown as Record<string, unknown>).__lab = { shell, map: () => mapRef.current, findTarget, mapSpots, spot: () => lastSpot };
    return () => shell.controller.dispose();
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0 }}>
      <CortexMap ref={mapRef} nodes={nodes} edges={edges} clusters={CLUSTERS} onNodeSelect={setSel} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
