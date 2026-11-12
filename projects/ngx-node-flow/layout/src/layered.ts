import type { FlowEdge, FlowNode } from 'ngx-node-flow';

export interface LayeredOptions {
  /** Width of a node (config node.width). Default 160. */
  nodeWidth?: number;
  /** Height of a node. Default: the library's rule for the default config (60, or 24 + 20 per port row). */
  nodeHeight?: (n: FlowNode) => number;
  /** Horizontal gap between layers. Default 80. */
  gapX?: number;
  /** Vertical gap between nodes of a layer. Default 20. */
  gapY?: number;
}

// mirrors nodeHeight() in the library's geometry.ts for the default config (height 60, header 24, 20 per port)
const defaultHeight = (n: FlowNode) => Math.max(60, 24 + 20 * Math.max(n.inputs?.length ?? 0, n.outputs?.length ?? 0));

/**
 * Left-to-right layered layout: each node goes one layer after its furthest predecessor (Kahn's
 * algorithm), nodes in a layer are ordered by the average position of their predecessors to cut
 * crossings, and cycles are broken by placing the first remaining node of the input order.
 * O(nodes + edges) and iterative, so it handles very large graphs; run it in your own worker for
 * those, then apply the result with `flow.moveNodes(positions)` (one undo step).
 */
export function layered(nodes: FlowNode[], edges: FlowEdge[], options: LayeredOptions = {}): { id: string; x: number; y: number }[] {
  const { nodeWidth = 160, nodeHeight = defaultHeight, gapX = 80, gapY = 20 } = options;
  const n = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const out: number[][] = Array.from({ length: n }, () => []);
  const preds: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  for (const e of edges) {
    const s = index.get(e.source), t = index.get(e.target);
    if (s === undefined || t === undefined || s === t) continue; // edges outside the set and self-loops don't rank
    out[s].push(t);
    preds[t].push(s);
    indeg[t]++;
  }

  // Kahn, with forced starts for cycles; layer[v] = 1 + furthest processed predecessor
  const layer = new Int32Array(n);
  const done = new Uint8Array(n);
  const order: number[] = []; // topological (cycle-broken) order
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
  for (let next = 0; order.length < n; ) {
    if (!queue.length) {
      while (done[next]) next++; // first unplaced node (in input order) breaks a cycle
      queue.push(next);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      if (done[u]) continue;
      done[u] = 1;
      order.push(u);
      for (const v of out[u]) {
        if (done[v]) continue;
        layer[v] = Math.max(layer[v], layer[u] + 1);
        if (--indeg[v] === 0) queue.push(v);
      }
    }
    queue.length = 0;
  }

  // one barycenter sweep: within a layer, sort by the mean row of already-placed predecessors
  const layers: number[][] = [];
  for (const v of order) (layers[layer[v]] ??= []).push(v);
  const row = new Float64Array(n);
  const positions: { id: string; x: number; y: number }[] = [];
  layers.forEach((members, l) => {
    const key = members.map((v, i) => {
      const placed = preds[v].filter((p) => layer[p] < l);
      return placed.length ? placed.reduce((sum, p) => sum + row[p], 0) / placed.length : i;
    });
    const sorted = members.map((v, i) => [v, key[i]] as const).sort((a, b) => a[1] - b[1]);
    let y = 0;
    sorted.forEach(([v], r) => {
      row[v] = r;
      positions.push({ id: nodes[v].id, x: l * (nodeWidth + gapX), y });
      y += nodeHeight(nodes[v]) + gapY;
    });
  });
  return positions;
}
