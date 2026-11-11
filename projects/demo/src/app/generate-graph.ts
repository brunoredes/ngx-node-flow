import { FlowEdge, FlowNode, GraphChunk } from 'ngx-node-flow';

/**
 * Lazily generates `count` nodes laid out on a grid, wired as one random ring
 * (every in and out port connected exactly once), `chunkSize` nodes per chunk.
 * Nothing past the current chunk is built until the consumer pulls again.
 */
export async function* generateGraph(count: number, chunkSize: number, prefix = 'n'): AsyncGenerator<GraphChunk> {
  const perm = new Uint32Array(count).map((_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const next = new Uint32Array(count);
  for (let j = 0; j < count; j++) next[perm[j]] = perm[(j + 1) % count];

  for (let start = 0; start < count; start += chunkSize) {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    for (let i = start; i < Math.min(start + chunkSize, count); i++) {
      nodes.push({ id: prefix + i, x: (i % 40) * 200, y: 400 + Math.floor(i / 40) * 100, label: `Node ${i}`, inputs: ['in'], outputs: ['out'] });
      const t = prefix + next[i];
      edges.push({ id: `${prefix}${i}:out->${t}:in`, source: prefix + i, sourcePort: 'out', target: t, targetPort: 'in' });
    }
    yield { nodes, edges };
  }
}
