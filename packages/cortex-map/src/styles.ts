// Self-contained styles for the HUD chrome (panels, search, picker, inspector).
// Injected once per document — no Tailwind or external stylesheet required.
// Everything hangs off .cortex-map so it can't leak into the host app; the
// handful of custom properties below are the supported style override points.
import { useEffect } from "react";

const CSS = /* css */ `
.cortex-map {
  --cm-panel-bg: rgba(9, 15, 27, 0.62);
  --cm-panel-border: rgba(120, 165, 210, 0.18);
  --cm-text: rgba(226, 236, 250, 0.92);
  --cm-text-dim: rgba(148, 168, 198, 0.85);
  --cm-accent: #8fc7ff;
  --cm-hud-font: ui-sans-serif, system-ui, -apple-system, sans-serif;
  position: relative;
  overflow: hidden;
  font-family: var(--cm-hud-font);
  color: var(--cm-text);
}
.cortex-map * { box-sizing: border-box; }
.cortex-map button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }

.cm-panel {
  pointer-events: auto;
  position: absolute;
  z-index: 5;
  border: 1px solid var(--cm-panel-border);
  background: var(--cm-panel-bg);
  border-radius: 10px;
  padding: 12px;
  backdrop-filter: blur(10px);
}
.cm-title {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--cm-text-dim);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  font-size: 12px;
  border-bottom: 1px solid rgba(120, 165, 210, 0.06);
}
.cm-row:last-child { border-bottom: none; }
.cm-row .k { color: var(--cm-text-dim); }
.cm-dot { height: 8px; width: 8px; border-radius: 999px; flex-shrink: 0; }
.cm-legend-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 11px; }
.cm-legend-row .name { flex: 1; color: var(--cm-text); opacity: 0.85; }
.cm-legend-row .count { font-size: 10px; color: var(--cm-text-dim); }

.cm-controls {
  position: absolute; bottom: 12px; right: 12px; z-index: 5;
  display: flex; align-items: center; gap: 8px;
}
.cm-chip {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--cm-panel-border);
  background: var(--cm-panel-bg);
  border-radius: 999px; padding: 4px 12px;
  font-size: 11px; color: var(--cm-text);
  backdrop-filter: blur(10px);
  transition: border-color 0.15s, color 0.15s;
}
.cm-chip:hover { border-color: rgba(143, 199, 255, 0.5); }
.cm-chip:disabled { opacity: 0.5; cursor: default; }
.cm-chip kbd {
  border: 1px solid var(--cm-panel-border); border-radius: 4px;
  padding: 0 4px; font-size: 9px; letter-spacing: 0.08em; color: var(--cm-text-dim);
}

.cm-status {
  position: absolute; inset: 0; z-index: 4;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--cm-text-dim);
}

.cm-vignette {
  pointer-events: none; position: absolute; inset: 0; z-index: 2;
  background: radial-gradient(120% 90% at 50% 42%, rgba(0,0,0,0) 38%, rgba(2,4,9,0.55) 78%, rgba(2,4,9,0.92) 100%);
}

/* search palette */
.cm-scrim { position: absolute; inset: 0; z-index: 7; background: rgba(0,0,0,0.3); backdrop-filter: blur(1px); }
.cm-search {
  pointer-events: auto; position: absolute; left: 50%; top: 72px; z-index: 8;
  width: min(460px, calc(100% - 2rem)); transform: translateX(-50%);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(120,165,210,0.28); border-radius: 12px;
  background: rgba(7,12,22,0.92); backdrop-filter: blur(12px);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5);
}
.cm-search-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(120,165,210,0.14); }
.cm-search-head input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  font-size: 13px; color: var(--cm-text);
}
.cm-search-head input::placeholder { color: var(--cm-text-dim); opacity: 0.7; }
.cm-search-list { max-height: min(420px, calc(100vh - 200px)); overflow-y: auto; padding: 4px 0; }
.cm-search-empty { padding: 24px 12px; text-align: center; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-hit { display: flex; width: 100%; align-items: center; gap: 10px; padding: 8px 12px; text-align: left; transition: background 0.1s; }
.cm-hit.active { background: rgba(255,255,255,0.08); }
.cm-hit:hover { background: rgba(255,255,255,0.05); }
.cm-hit .label { display: block; font-size: 12.5px; color: var(--cm-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-hit .summary { display: block; font-size: 11px; color: var(--cm-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-hit .cluster { flex-shrink: 0; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-search-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-top: 1px solid rgba(120,165,210,0.1); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--cm-text-dim); opacity: 0.75; }

/* proximity picker */
.cm-picker {
  pointer-events: auto; position: absolute; left: 12px; top: 252px; z-index: 6;
  display: flex; flex-direction: column; width: 230px;
  max-height: min(360px, calc(100% - 280px));
  border: 1px solid rgba(120,165,210,0.22); border-radius: 10px;
  background: rgba(7,12,22,0.82); backdrop-filter: blur(12px);
}
.cm-picker-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(120,165,210,0.12); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-picker-head .n { flex: 1; }
.cm-picker-list { min-height: 0; flex: 1; overflow-y: auto; padding: 4px 0; }
.cm-picker-row { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 12px; text-align: left; font-size: 11px; }
.cm-picker-row:hover { background: rgba(255,255,255,0.05); }
.cm-picker-row.selected { background: rgba(255,255,255,0.07); }
.cm-picker-row .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cm-text); opacity: 0.9; }

/* node inspector pane */
.cm-pane {
  pointer-events: auto; position: absolute; right: 12px; top: 12px; bottom: 12px; z-index: 6;
  display: flex; flex-direction: column; width: 300px;
  border: 1px solid rgba(120,165,210,0.22); border-radius: 10px;
  background: rgba(7,12,22,0.82); backdrop-filter: blur(12px);
}
.cm-pane-head { display: flex; align-items: flex-start; gap: 8px; padding: 12px; border-bottom: 1px solid rgba(120,165,210,0.12); }
.cm-pane-head .title { font-size: 14px; line-height: 1.25; color: var(--cm-text); }
.cm-pane-head .sub { margin-top: 2px; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-pane-meta { padding: 8px 12px 0; }
.cm-pane-summary { padding: 8px 0; font-size: 11px; line-height: 1.45; color: var(--cm-text-dim); }
.cm-pane-section { margin-top: 4px; padding: 0 12px 4px; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-pane-list { min-height: 0; flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.cm-link-row { display: flex; width: 100%; align-items: flex-start; gap: 8px; border-radius: 6px; padding: 6px; text-align: left; }
.cm-link-row:hover { background: rgba(255,255,255,0.06); }
.cm-link-row .label { display: block; font-size: 12px; color: var(--cm-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-link-row .relation { display: block; margin-top: 2px; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cm-text-dim); }
.cm-link-row .summary { display: block; margin-top: 4px; font-size: 11px; line-height: 1.35; color: var(--cm-text-dim); opacity: 0.85; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cm-strength { margin-top: 5px; height: 4px; width: 36px; flex-shrink: 0; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,0.1); }
.cm-strength > span { display: block; height: 100%; border-radius: 999px; }

.cm-close { border-radius: 6px; padding: 4px; color: var(--cm-text-dim); line-height: 0; }
.cm-close:hover { background: rgba(255,255,255,0.05); color: var(--cm-text); }
`;

const STYLE_ID = "cortex-map-styles";

/** Inject the component stylesheet once per document. */
export function useCortexMapStyles(): void {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
    // deliberately never removed — other map instances share it
  }, []);
}
