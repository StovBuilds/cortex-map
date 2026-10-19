// Small geometry and graph helpers for the map gestures.

import type { Point } from "./types";

/** Is p inside the polygon (even-odd rule)? */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Fewest-hops chain from `from` to `to` (both included), or null if they aren't connected. */
export function shortestPath(from: string, to: string, neighbours: (id: string) => string[], maxNodes = 50000): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  for (let i = 0; i < queue.length && prev.size < maxNodes; i++) {
    const cur = queue[i];
    for (const n of neighbours(cur)) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        for (let k = cur; k; k = prev.get(k)!) path.push(k);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}
