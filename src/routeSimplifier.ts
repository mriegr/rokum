/**
 * Smooths a collection of raw track-segment paths (e.g. from multiple
 * direction relations of the same transit line) into a single continuous
 * centerline polyline.
 *
 * Algorithm:
 * 1. Cluster all path vertices into ~50m spatial clusters.
 * 2. Map each input path to its cluster-ID sequence.
 * 3. Build a weighted adjacency graph where edge weight = number of
 *    direction paths that traverse it (trunk edges get higher weight).
 * 4. DFS from degree-1 endpoints to find the max-weight simple path.
 * 5. Convert that path back to coordinates → single smooth route line.
 */

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function simplifyRoutePaths(
  paths: Coordinates[][],
  distanceMeters: (a: Coordinates, b: Coordinates) => number,
  clusterTolerance = 50,
): Coordinates[][] {
  if (paths.length === 0) return [];

  // --- 1. Cluster all coordinates ---
  const allPoints = paths.flat();

  const clusters: Array<{
    center: Coordinates;
    pts: Coordinates[];
  }> = [];

  for (const pt of allPoints) {
    let found: (typeof clusters)[number] | null = null;
    for (const cluster of clusters) {
      if (distanceMeters(cluster.center, pt) <= clusterTolerance) {
        found = cluster;
        break;
      }
    }
    if (found) {
      found.pts.push(pt);
      const n = found.pts.length;
      found.center = {
        latitude: found.pts.reduce((s, p) => s + p.latitude, 0) / n,
        longitude: found.pts.reduce((s, p) => s + p.longitude, 0) / n,
      };
    } else {
      clusters.push({
        center: { latitude: pt.latitude, longitude: pt.longitude },
        pts: [pt],
      });
    }
  }

  // --- 2. Map each path to a cluster-ID sequence ---
  function nearestCluster(pt: Coordinates): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = distanceMeters(pt, clusters[i]!.center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  const clusterPaths = paths
    .map((path) => {
      const seq: number[] = [];
      for (const pt of path) {
        const id = nearestCluster(pt);
        if (seq.length === 0 || seq[seq.length - 1] !== id) {
          seq.push(id);
        }
      }
      return seq;
    })
    .filter((seq) => seq.length >= 2);

  if (clusterPaths.length === 0) return [];

  // --- 3. Build adjacency graph with edge weights ---
  const adj = new Map<number, Set<number>>();
  const edgeKey = (a: number, b: number) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;
  const edgeWeight = new Map<string, number>();

  for (const cp of clusterPaths) {
    const seen = new Set<string>();
    for (let i = 0; i < cp.length - 1; i++) {
      const a = cp[i]!;
      const b = cp[i + 1]!;
      if (a === b) continue;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
      const key = edgeKey(a, b);
      if (!seen.has(key)) {
        edgeWeight.set(key, (edgeWeight.get(key) || 0) + 1);
        seen.add(key);
      }
    }
  }

  // --- 4. DFS to find the max-weight simple path ---
  const visited = new Set<number>();
  let bestWeight = 0;
  let bestPath: number[] = [];

  function dfs(current: number, path: number[], weight: number) {
    if (
      weight > bestWeight ||
      (weight === bestWeight && path.length > bestPath.length)
    ) {
      bestWeight = weight;
      bestPath = [...path];
    }
    const neighbors = adj.get(current);
    if (!neighbors) return;
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        const ew = edgeWeight.get(edgeKey(current, next)) || 0;
        dfs(next, path, weight + ew);
        path.pop();
        visited.delete(next);
      }
    }
  }

  // Start from endpoints (degree-1 nodes) to reduce search space
  const endpoints = [...adj.entries()]
    .filter(([, n]) => n.size === 1)
    .map(([id]) => id);
  const startNodes = endpoints.length > 0 ? endpoints : [...adj.keys()];

  for (const start of startNodes) {
    visited.clear();
    visited.add(start);
    dfs(start, [start], 0);
  }

  // --- 5. Convert best path back to coordinates ---
  const result: Coordinates[] = [];
  for (const id of bestPath) {
    const pt = clusters[id]!.center;
    if (
      result.length === 0 ||
      result[result.length - 1]!.latitude !== pt.latitude ||
      result[result.length - 1]!.longitude !== pt.longitude
    ) {
      result.push({ latitude: pt.latitude, longitude: pt.longitude });
    }
  }

  return result.length >= 2 ? [result] : [];
}
