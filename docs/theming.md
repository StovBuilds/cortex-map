# Theming

Right, so everything visual here funnels through two props: `clusters` (names, colours, angles, personas, all covered in [data-format.md](data-format.md)) and `theme`. Every field on the theme object is optional. Leave it all blank and you get the original war-table look, defaults and all.

## The theme object

```ts
interface CortexMapTheme {
  // colour
  background: string;            // "#04060d" — the void behind everything
  fallbackClusterColor: string;  // "#7f93b0" — nodes whose cluster isn't defined
  flashColor: string;            // "#fff4d6" — the "memory touched" pulse
  agedColor: string;             // "#33405e" — what old memories cool toward
  // age gradient
  flashMs: number;               // 2600 — how long a flash takes to fade
  ageLift: number;               // 34 — vertical spread newest↔oldest (graph units)
  // geometry
  groundRadius: number;          // 780 — the holo-table disc
  ringRadii: number[];           // [120, 280, 440, 600] — orbital guide rings
  sectorRadius: number;          // 470 — how far cluster hubs sit from the core
  labelRadius: number;           // 660 — where cluster name sprites sit
  domeRadius: number;            // 1500 — dome curvature; larger = flatter
  // camera & atmosphere
  cameraStart: {x,y,z};          // {0, 540, 1240} — low oblique, looks ACROSS the disc
  cameraLook: {x,y,z};           // {0, 36, 0}
  fogDensity: number;            // 0.0006 — depth haze (0 disables)
  toneExposure: number;          // 1.15 — ACES filmic exposure
  bloom: [number,number,number] | null; // [0.55, 0.5, 0.82] strength/radius/threshold
  // link tiers
  linkFibreMin: number;          // 0.8 — semantic edges below this aren't drawn
  linkBrightMin: number;         // 0.9 — semantic bright-tier bar
  linkBrightExplicit: number;    // 0.62 — explicit bright-tier bar
  // furniture toggles
  pillarMinWeight: number;       // 0.7 — weight bar for a light pillar
  sea: boolean;                  // the animated ocean (heaviest single item)
  nightLights: boolean;          // settlement point-field on the dome
  starfield: boolean;            // stars + nebula backdrop
  outerDisk: boolean;            // gold bezel/compass rim
  clusterLabels: boolean;        // rim name sprites
  pixelRatioCap: number;         // 1.5 — DPR cap (mobile fragment-cost guard)
}
```

## Recipes

### Change the colours

Cluster hues actually live on the ClusterDefs, not here. What the theme controls is the scene accents:

```tsx
theme={{
  background: "#0a0512",        // violet void
  flashColor: "#ffd6f4",
  agedColor: "#3a2f4e",
}}
```

The gold rim, sun-core, and core-node tint are fixed for now (the `#ffe6b0` family). PRs welcome if you fancy lifting them into the theme properly.

### Clean / minimal (dashboards, docs sites)

```tsx
theme={{ sea: false, starfield: false, nightLights: false, outerDisk: false, bloom: null }}
```

### High-energy (launch pages, screensavers)

```tsx
theme={{ bloom: [0.8, 0.6, 0.7], fogDensity: 0.0004 }}
```

Then drive `flash`/`ignite` off an interval and let it run.

### Flatter, wider table

```tsx
theme={{ domeRadius: 2600, groundRadius: 900, sectorRadius: 560, labelRadius: 780 }}
```

### Top-down "strategy map" camera

```tsx
theme={{ cameraStart: { x: 0, y: 1400, z: 260 }, cameraLook: { x: 0, y: 0, z: 0 } }}
```

## HUD chrome (panels, search, inspector)

The 2D overlay styles itself, an injected stylesheet scoped under `.cortex-map`, exposed as CSS custom properties:

```css
.cortex-map {
  --cm-panel-bg: rgba(9, 15, 27, 0.62);
  --cm-panel-border: rgba(120, 165, 210, 0.18);
  --cm-text: rgba(226, 236, 250, 0.92);
  --cm-text-dim: rgba(148, 168, 198, 0.85);
  --cm-accent: #8fc7ff;
  --cm-hud-font: ui-sans-serif, system-ui, sans-serif;
}
```

Override them on your own wrapper, they'll inherit fine:

```css
.my-brain .cortex-map { --cm-hud-font: "IBM Plex Mono", monospace; }
```

Or just hide the built-ins entirely (`search={false}`, `inspector={false}`) and build your own UI off `onNodeSelect` plus the ref handle.

## Performance knobs

Roughly, in order of cost:

1. `sea: false`, the ocean's a 128×128 displaced plane with a per-pixel shader
2. `bloom: null`, full-screen post-processing pass
3. `starfield: false`, `nightLights: false`, thousands of points each
4. `pixelRatioCap: 1`, the biggest single mobile win, honestly
5. Fewer pillar-worthy nodes (`pillarMinWeight` up, or just lower node weights)

`lite` (prop, or the built-in toggle) drops straight to a flat 2D canvas. `prefers-reduced-motion` forces it whether you ask for it or not.
