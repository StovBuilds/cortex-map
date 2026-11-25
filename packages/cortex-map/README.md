# cortex-map

A cinematic, living 3D knowledge graph for React: the "war-table" memory map. Bring your own nodes and
edges; the clusters, colours and theme are all yours.

**[▶ Live demo](https://cortex-map.pages.dev)** · **[▶ Drive it with your hands](https://cortex.jstov.uk)** ·
[Full docs on GitHub](https://github.com/StovBuilds/cortex-map)

```bash
npm install cortex-map
```

React 18+ is a peer dependency. `three` and `react-force-graph-3d` are installed with it.

```tsx
import { CortexMap, type ClusterDef, type CortexMapNode, type CortexMapEdge } from "cortex-map";

const clusters: ClusterDef[] = [
  { name: "Ideas", color: "#ffcf7a", angleDeg: 30 },
  { name: "Projects", color: "#4d8bf0", angleDeg: 150 },
];
const nodes: CortexMapNode[] = [
  { id: "core", label: "My brain", cluster: "Projects", role: "core", weight: 1 },
  { id: "i1", label: "Underwater metroidvania", cluster: "Ideas", role: "hub", parentId: "core" },
];
const edges: CortexMapEdge[] = [{ source: "core", target: "i1", relation: "anchors", strength: 0.95 }];

export function Brain() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <CortexMap nodes={nodes} edges={edges} clusters={clusters} />
    </div>
  );
}
```

The component fills its parent, so give the parent a real height.

Theming, live effects, the built-in UI and the camera API are documented in the
[main README](https://github.com/StovBuilds/cortex-map#readme). For hands, head and game-controller input,
see [cortex-gesture](https://www.npmjs.com/package/cortex-gesture).

MIT licence.
