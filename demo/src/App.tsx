import { useMemo, useRef, useState } from "react";
import { CortexMap, type CortexMapHandle, type CortexMapNode } from "cortex-map";
import { CLUSTERS, makeSampleData } from "./sampleData";

export default function App() {
  const { nodes, edges } = useMemo(() => makeSampleData(), []);
  const mapRef = useRef<CortexMapHandle>(null);
  const [selected, setSelected] = useState<CortexMapNode | null>(null);

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
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#04060d" }}>
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
          href="https://github.com/NoctemJack/cortex-map"
          style={{ color: "#8fc7ff", textDecoration: "none" }}
        >
          GitHub ↗
        </a>
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>
        <CortexMap
          ref={mapRef}
          nodes={nodes}
          edges={edges}
          clusters={CLUSTERS}
          onNodeSelect={setSelected}
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
