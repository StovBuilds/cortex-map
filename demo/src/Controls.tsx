import { useState } from "react";
import {
  DEFAULT_THEME,
  type CortexMapTheme, type ClusterDef, type ClusterPersona,
} from "cortex-map";

/**
 * Live theming panel for the demo.
 *
 * Every control writes straight into the `theme`/`clusters` props the demo
 * feeds <CortexMap/>, so the scene rebuilds as you drag — the point is to let
 * someone evaluating the library see, in their browser, what their own numbers
 * would look like before they wire it into an app. "Copy theme" hands back the
 * minimal `theme={{…}}` delta (and any changed cluster defs) so what you tuned
 * here is what you paste there.
 *
 * The panel edits nothing itself: it is a pure controlled surface over state
 * that lives in App, which is what keeps the deferred-value throttling honest.
 */

const ink = "rgba(226,236,250,0.92)";
const dim = "rgba(148,168,198,0.72)";
const line = "rgba(120,165,210,0.18)";
const font = "ui-sans-serif, system-ui, sans-serif";

// Mirrors the library's NEUTRAL_PERSONA — used to show a cluster's effective
// motion when its persona is partial or absent.
const NEUTRAL: ClusterPersona = { ringRate: 1, halo: 1, volatility: 0.5 };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${line}`, padding: "12px 14px" }}>
      <div style={{ color: dim, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label style={{ display: "block", fontSize: 12, color: ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: dim, fontVariantNumeric: "tabular-nums" }}>{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#5ad6a0", cursor: "pointer" }}
      />
    </label>
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color" value={value} onChange={(e) => onChange(e.target.value)}
      style={{ width: 26, height: 20, padding: 0, border: `1px solid ${line}`, borderRadius: 4, background: "none", cursor: "pointer" }}
    />
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: ink }}>
      <span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: dim, fontVariantNumeric: "tabular-nums", fontSize: 11 }}>{value}</span>
        <Color value={value} onChange={onChange} />
      </span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: ink, cursor: "pointer" }}>
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "#5ad6a0", cursor: "pointer" }} />
    </label>
  );
}

/** A constellation: colour swatch in the header, expandable to its motion
 *  "persona" (ring spin, glow halo, storminess) — biomes, not recoloured copies. */
function ClusterRow({
  cluster, onPatch,
}: {
  cluster: ClusterDef; onPatch: (patch: Partial<ClusterDef>) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = { ...NEUTRAL, ...cluster.persona };
  const setP = (k: keyof ClusterPersona, v: number) => onPatch({ persona: { ...p, [k]: v } });
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ font: "inherit", fontSize: 12, color: ink, background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", gap: 6, alignItems: "center" }}
        >
          <span style={{ color: dim, width: 8 }}>{open ? "▾" : "▸"}</span>{cluster.name}
        </button>
        <Color value={cluster.color} onChange={(color) => onPatch({ color })} />
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 2px 4px 14px" }}>
          <Slider label="Ring rate" value={p.ringRate} min={0} max={3} step={0.1} onChange={(v) => setP("ringRate", v)} format={(v) => `×${v.toFixed(1)}`} />
          <Slider label="Halo" value={p.halo} min={0.3} max={2} step={0.05} onChange={(v) => setP("halo", v)} format={(v) => `×${v.toFixed(2)}`} />
          <Slider label="Volatility" value={p.volatility} min={0} max={1} step={0.05} onChange={(v) => setP("volatility", v)} format={(v) => v.toFixed(2)} />
        </div>
      )}
    </div>
  );
}

/** Minimal snippet: only the theme keys that differ from the default, plus any
 *  cluster whose colour OR persona was touched — the smallest thing someone can
 *  paste and reproduce. */
function snippet(theme: CortexMapTheme, clusters: ClusterDef[], base: ClusterDef[]): string {
  const delta: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_THEME) as (keyof CortexMapTheme)[]) {
    if (JSON.stringify(theme[k]) !== JSON.stringify(DEFAULT_THEME[k])) delta[k] = theme[k];
  }
  const changed = clusters.filter((c, i) => JSON.stringify(c) !== JSON.stringify(base[i]));

  const parts: string[] = [];
  if (Object.keys(delta).length) parts.push(`theme={${JSON.stringify(delta, null, 2)}}`);
  if (changed.length) parts.push(`// changed clusters:\n${changed.map((c) => "  " + JSON.stringify(c)).join(",\n")}`);
  return parts.join("\n\n") || "// all defaults — nothing to override";
}

export interface ControlsProps {
  theme: CortexMapTheme;
  onTheme: (patch: Partial<CortexMapTheme>) => void;
  clusters: ClusterDef[];
  baseClusters: ClusterDef[];
  /** Patch any field(s) of a named cluster — colour and/or persona. */
  onCluster: (name: string, patch: Partial<ClusterDef>) => void;
  projection: "table" | "globe";
  onProjection: (p: "table" | "globe") => void;
  onReset: () => void;
}

export function Controls({ theme, onTheme, clusters, baseClusters, onCluster, projection, onProjection, onReset }: ControlsProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const bloomOn = theme.bloom !== null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet(theme, clusters, baseClusters));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (e.g. insecure context) — no-op, the panel still works */
    }
  };

  return (
    <div
      style={{
        position: "absolute", top: 58, right: 12, zIndex: 20, width: 268, maxHeight: "calc(100% - 74px)",
        display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: font,
        background: "rgba(8,13,24,0.86)", backdropFilter: "blur(8px)",
        border: `1px solid ${line}`, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          font: "inherit", color: ink, cursor: "pointer", background: "none", border: "none",
          padding: "11px 14px", fontSize: 12, letterSpacing: "0.1em",
        }}
      >
        <span>◆ CUSTOMISE</span>
        <span style={{ color: dim }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{ overflowY: "auto" }}>
          <Section title="Projection">
            <div style={{ display: "flex", gap: 6 }}>
              {(["table", "globe"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => onProjection(p)}
                  style={{
                    flex: 1, font: "inherit", fontSize: 12, cursor: "pointer", textTransform: "capitalize",
                    borderRadius: 8, padding: "6px 0", color: ink,
                    border: `1px solid ${projection === p ? "rgba(90,214,160,0.55)" : line}`,
                    background: projection === p ? "rgba(90,214,160,0.14)" : "transparent",
                  }}
                >
                  {p}{p === "globe" ? " ·β" : ""}
                </button>
              ))}
            </div>
          </Section>
          {projection === "globe" && (
            <Section title="Globe">
              <Toggle label="Show globe" value={theme.globeVisible} onChange={(v) => onTheme({ globeVisible: v })} />
              <ColorRow label="Globe colour" value={theme.globeColor} onChange={(v) => onTheme({ globeColor: v })} />
              <Slider label="Transparency" value={1 - theme.globeOpacity} min={0} max={1} step={0.05}
                onChange={(v) => onTheme({ globeOpacity: 1 - v })} format={(v) => (v === 0 ? "solid" : v.toFixed(2))} />
              <Toggle label="Grid outside globe" value={theme.globeGridOutside} onChange={(v) => onTheme({ globeGridOutside: v })} />
              <Toggle label="Orbs on surface" value={theme.globeOrbsOnSurface} onChange={(v) => onTheme({ globeOrbsOnSurface: v })} />
              <Slider label="Label distance" value={theme.globeLabelRadius} min={1.1} max={3.2} step={0.02}
                onChange={(v) => onTheme({ globeLabelRadius: v })} format={(v) => `${v.toFixed(2)}×`} />
            </Section>
          )}
          <Section title="Shape & scale">
            <Slider label="Table size" value={theme.groundRadius} min={400} max={1200} step={10}
              onChange={(v) => onTheme({ groundRadius: v })} />
            <Slider label="Dome curvature" value={theme.domeRadius} min={700} max={3200} step={25}
              onChange={(v) => onTheme({ domeRadius: v })} format={(v) => (v >= 3000 ? "flat" : String(v))} />
            <Slider label="Vertical spread" value={theme.ageLift} min={0} max={80} step={1}
              onChange={(v) => onTheme({ ageLift: v })} />
          </Section>

          <Section title="Camera (start angle)">
            <Slider label="Height" value={theme.cameraStart.y} min={120} max={1500} step={20}
              onChange={(v) => onTheme({ cameraStart: { ...theme.cameraStart, y: v } })} />
            <Slider label="Distance" value={theme.cameraStart.z} min={500} max={2600} step={20}
              onChange={(v) => onTheme({ cameraStart: { ...theme.cameraStart, z: v } })} />
          </Section>

          <Section title="Colour">
            <ColorRow label="Void" value={theme.background} onChange={(v) => onTheme({ background: v })} />
            <ColorRow label="Pulse flash" value={theme.flashColor} onChange={(v) => onTheme({ flashColor: v })} />
            <ColorRow label="Aged memory" value={theme.agedColor} onChange={(v) => onTheme({ agedColor: v })} />
          </Section>

          <Section title="Constellations — colour + motion">
            {clusters.map((c) => (
              <ClusterRow key={c.name} cluster={c} onPatch={(patch) => onCluster(c.name, patch)} />
            ))}
          </Section>

          <Section title="Links & pillars">
            <Slider label="Faint-link floor" value={theme.linkFibreMin} min={0} max={1} step={0.02}
              onChange={(v) => onTheme({ linkFibreMin: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Bright-link cutoff" value={theme.linkBrightMin} min={0} max={1} step={0.02}
              onChange={(v) => onTheme({ linkBrightMin: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Explicit bright" value={theme.linkBrightExplicit} min={0} max={1} step={0.02}
              onChange={(v) => onTheme({ linkBrightExplicit: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Light-pillar weight" value={theme.pillarMinWeight} min={0} max={1} step={0.02}
              onChange={(v) => onTheme({ pillarMinWeight: v })} format={(v) => v.toFixed(2)} />
          </Section>

          <Section title="Waves & atmosphere">
            <Toggle label="Waves (sea)" value={theme.sea} onChange={(v) => onTheme({ sea: v })} />
            <Toggle label="Glow / bloom" value={bloomOn}
              onChange={(v) => onTheme({ bloom: v ? [0.55, 0.5, 0.82] : null })} />
            {bloomOn && (
              <Slider label="Glow strength" value={theme.bloom![0]} min={0} max={1.5} step={0.05}
                onChange={(v) => onTheme({ bloom: [v, theme.bloom![1], theme.bloom![2]] })}
                format={(v) => v.toFixed(2)} />
            )}
            <Slider label="Fog depth" value={theme.fogDensity} min={0} max={0.0018} step={0.0001}
              onChange={(v) => onTheme({ fogDensity: v })} format={(v) => (v === 0 ? "off" : v.toFixed(4))} />
            <Toggle label="Starfield" value={theme.starfield} onChange={(v) => onTheme({ starfield: v })} />
            <Toggle label="Night lights" value={theme.nightLights} onChange={(v) => onTheme({ nightLights: v })} />
            <Toggle label="Gold bezel" value={theme.outerDisk} onChange={(v) => onTheme({ outerDisk: v })} />
            <Toggle label="Cluster labels" value={theme.clusterLabels} onChange={(v) => onTheme({ clusterLabels: v })} />
          </Section>

          <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderTop: `1px solid ${line}` }}>
            <button onClick={onReset} style={btn}>Reset</button>
            <button onClick={copy} style={{ ...btn, borderColor: "rgba(90,214,160,0.4)" }}>
              {copied ? "Copied ✓" : "Copy theme"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  flex: 1, font: "inherit", fontSize: 12, color: ink, cursor: "pointer",
  background: "transparent", border: `1px solid ${line}`, borderRadius: 8, padding: "7px 0",
};
