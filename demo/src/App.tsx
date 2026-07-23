import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  CortexMap, DEFAULT_THEME,
  type ClusterDef, type CortexMapHandle, type CortexMapNode, type CortexMapTheme,
} from "cortex-map";
import { CLUSTERS, makeSampleData } from "./sampleData";
import { Controls } from "./Controls";

export default function App() {
  const { nodes, edges } = useMemo(() => makeSampleData(), []);
  const mapRef = useRef<CortexMapHandle>(null);
  const [selected, setSelected] = useState<CortexMapNode | null>(null);

  // Live theming state. The controls write here; the map reads a DEFERRED copy
  // so dragging a slider stays smooth — React coalesces the rapid updates and
  // only rebuilds the (expensive) scene once the input settles, instead of on
  // every intermediate value.
  const [theme, setTheme] = useState<CortexMapTheme>(() => ({ ...DEFAULT_THEME }));
  const [clusters, setClusters] = useState<ClusterDef[]>(() => CLUSTERS.map((c) => ({ ...c })));
  const deferredTheme = useDeferredValue(theme);
  const deferredClusters = useDeferredValue(clusters);

  const patchTheme = (patch: Partial<CortexMapTheme>) => setTheme((t) => ({ ...t, ...patch }));
  const patchCluster = (name: string, patch: Partial<ClusterDef>) =>
    setClusters((cs) => cs.map((c) => (c.name === name ? { ...c, ...patch } : c)));
  const reset = () => {
    setTheme({ ...DEFAULT_THEME });
    setClusters(CLUSTERS.map((c) => ({ ...c })));
  };

  // "live brain" simulation — flash a random node every few seconds so the
  // map ripples and storms like it does over a real event stream.
  const [live, setLive] = useState(false);
  const liveTimer = useRef<number | null>(null);
  const toggleLive = () => {
    if (liveTimer.current) {
      window.clearInterval(liveTimer.current);
      liveTimer.current = null;
      setLive(false);
      return;
    }
    liveTimer.current = window.setInterval(() => {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      if (Math.random() < 0.2) mapRef.current?.ignite(n.id);
      else mapRef.current?.flash(n.id);
    }, 2600);
    setLive(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: theme.background }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", zIndex: 10,
          borderBottom: "1px solid rgba(120,165,210,0.14)", color: "rgba(226,236,250,0.92)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 13,
        }}
      >
        <strong style={{ letterSpacing: "0.18em", fontSize: 12 }}>CORTEX-MAP</strong>
        <span style={{ opacity: 0.6 }}>demo — a fictional game studio's second brain</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={toggleLive}
          style={{
            font: "inherit", color: "inherit", cursor: "pointer", borderRadius: 999,
            border: "1px solid rgba(120,165,210,0.3)", background: live ? "rgba(90,214,160,0.15)" : "transparent",
            padding: "4px 14px",
          }}
        >
          {live ? "■ stop the stream" : "▶ simulate a live brain"}
        </button>
        <a
          href="https://github.com/StovBuilds/cortex-map"
          style={{ color: "#8fc7ff", textDecoration: "none" }}
        >
          GitHub ↗
        </a>
      </header>
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <CortexMap
          ref={mapRef}
          nodes={nodes}
          edges={edges}
          clusters={deferredClusters}
          theme={deferredTheme}
          onNodeSelect={setSelected}
        />
        <Controls
          theme={theme}
          onTheme={patchTheme}
          clusters={clusters}
          baseClusters={CLUSTERS}
          onCluster={patchCluster}
          onReset={reset}
        />
      </main>
      {selected && (
        <footer
          style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 10,
            color: "rgba(148,168,198,0.9)", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 11,
          }}
        >
          selected via onNodeSelect: <strong>{selected.label}</strong>
        </footer>
      )}
    </div>
  );
}
