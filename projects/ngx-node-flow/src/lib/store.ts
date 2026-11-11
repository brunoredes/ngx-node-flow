import { hitTest, Hit, nodeHeight } from './geometry';
import { FlowEdge, FlowNode, GraphChanges, GraphChunk, NodeFlowConfig } from './types';

const CELL = 1024;
const GAP = 80;

export const noChanges = (): GraphChanges => ({ upsertNodes: [], removeNodes: [], upsertEdges: [], removeEdges: [] });

const sameEdge = (a: FlowEdge, b: FlowEdge) =>
  a.source === b.source && a.sourcePort === b.sourcePort && a.target === b.target && a.targetPort === b.targetPort;

/**
 * Worker-side graph: Maps for O(1) lookups, adjacency for O(degree) edge work and a uniform
 * spatial grid so rendering and hit-testing only touch what is near the viewport.
 * shortcut: one JS object per node (~300-400 MB at 1M); move to typed-array columns if memory becomes the limit.
 */
export class GraphStore {
  readonly nodes = new Map<string, FlowNode>();
  readonly edges = new Map<string, FlowEdge>();
  private readonly adj = new Map<string, Set<string>>();
  private readonly grid = new Map<string, Set<FlowNode>>();
  private readonly z = new Map<string, number>();
  private zTop = 0;

  constructor(private readonly cfg: NodeFlowConfig) {}

  // --- indexing -----------------------------------------------------------

  private cells(n: FlowNode, fn: (key: string) => void) {
    const x0 = Math.floor(n.x / CELL), x1 = Math.floor((n.x + this.cfg.node.width) / CELL);
    const y0 = Math.floor(n.y / CELL), y1 = Math.floor((n.y + nodeHeight(n, this.cfg)) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn(`${cx},${cy}`);
  }

  private index(n: FlowNode) {
    this.cells(n, (k) => {
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = new Set()));
      cell.add(n);
    });
  }

  private unindex(n: FlowNode) {
    this.cells(n, (k) => {
      const cell = this.grid.get(k);
      cell?.delete(n);
      if (cell?.size === 0) this.grid.delete(k);
    });
  }

  private setNode(n: FlowNode) {
    const old = this.nodes.get(n.id);
    if (old) this.unindex(old);
    this.nodes.set(n.id, n);
    this.index(n);
  }

  private setEdge(e: FlowEdge) {
    this.edges.set(e.id, e);
    for (const id of [e.source, e.target]) {
      let set = this.adj.get(id);
      if (!set) this.adj.set(id, (set = new Set()));
      set.add(e.id);
    }
  }

  private deleteEdge(id: string): boolean {
    const e = this.edges.get(id);
    if (!e) return false;
    this.edges.delete(id);
    this.adj.get(e.source)?.delete(id);
    this.adj.get(e.target)?.delete(id);
    return true;
  }

  // --- ingestion ------------------------------------------------------------

  reset(nodes: FlowNode[], edges: FlowEdge[]) {
    this.nodes.clear();
    this.edges.clear();
    this.adj.clear();
    this.grid.clear();
    this.z.clear();
    this.addChunk({ nodes, edges });
  }

  /** Edges may point at nodes that have not arrived yet; they render once both ends exist. */
  addChunk(chunk: GraphChunk) {
    chunk.nodes?.forEach((n) => this.setNode(n));
    chunk.edges?.forEach((e) => this.setEdge(e));
  }

  // --- queries --------------------------------------------------------------

  node(id: string) {
    return this.nodes.get(id);
  }

  /** Nodes intersecting the world rect, bottom-most first (draw order). */
  query(x0: number, y0: number, x1: number, y1: number): FlowNode[] {
    const out = new Set<FlowNode>();
    const w = this.cfg.node.width;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        this.grid.get(`${cx},${cy}`)?.forEach((n) => {
          if (n.x <= x1 && n.y <= y1 && n.x + w >= x0 && n.y + nodeHeight(n, this.cfg) >= y0) out.add(n);
        });
      }
    }
    const list = [...out];
    if (this.z.size) list.sort((a, b) => (this.z.get(a.id) ?? 0) - (this.z.get(b.id) ?? 0));
    return list;
  }

  /** Edges touching any of `nodes`, each once. */
  edgesOf(nodes: Iterable<FlowNode>): FlowEdge[] {
    const ids = new Set<string>();
    for (const n of nodes) this.adj.get(n.id)?.forEach((id) => ids.add(id));
    return [...ids].map((id) => this.edges.get(id)!);
  }

  /** Last edge plugged into an input port (the one a drag picks up). */
  edgeInto(nodeId: string, port: string): FlowEdge | undefined {
    let found: FlowEdge | undefined;
    this.adj.get(nodeId)?.forEach((id) => {
      const e = this.edges.get(id)!;
      if (e.target === nodeId && e.targetPort === port) found = e;
    });
    return found;
  }

  hit(wx: number, wy: number): Hit | null {
    const r = this.cfg.node.portRadius * 2;
    return hitTest(this.query(wx - r, wy - r, wx + r, wy + r), wx, wy, this.cfg);
  }

  // --- mutations (each returns what changed) --------------------------------

  bringToFront(id: string) {
    this.z.set(id, ++this.zTop);
  }

  move(id: string, x: number, y: number): GraphChanges {
    const n = this.nodes.get(id);
    if (!n) return noChanges();
    this.unindex(n);
    n.x = x;
    n.y = y;
    this.index(n);
    return { ...noChanges(), upsertNodes: [n] };
  }

  connect(edge: FlowEdge): GraphChanges | null {
    for (const id of this.adj.get(edge.source) ?? []) if (sameEdge(this.edges.get(id)!, edge)) return null;
    this.setEdge(edge);
    return { ...noChanges(), upsertEdges: [edge] };
  }

  disconnect(id: string): GraphChanges {
    return this.deleteEdge(id) ? { ...noChanges(), removeEdges: [id] } : noChanges();
  }

  /** Adds a node to the right of `id`, connected from its first free output (or first output). */
  addAfter(id: string): GraphChanges & { node?: FlowNode } {
    const from = this.nodes.get(id);
    if (!from) return noChanges();
    const w = this.cfg.node.width;
    const node: FlowNode = { id: crypto.randomUUID(), x: from.x + w + GAP, y: from.y, label: 'Nova célula', inputs: ['in'], outputs: ['out'] };
    const h = nodeHeight(node, this.cfg);
    while (this.query(node.x, node.y, node.x + w, node.y + h).length) node.y += h + 20;
    this.setNode(node);

    const changes: GraphChanges & { node?: FlowNode } = { ...noChanges(), upsertNodes: [node], node };
    const outs = from.outputs ?? [];
    const used = new Set([...(this.adj.get(from.id) ?? [])].map((e) => this.edges.get(e)!).filter((e) => e.source === from.id).map((e) => e.sourcePort));
    const port = outs.find((p) => !used.has(p)) ?? outs[0];
    if (port) {
      const edge = { id: `${from.id}:${port}->${node.id}:in`, source: from.id, sourcePort: port, target: node.id, targetPort: 'in' };
      this.setEdge(edge);
      changes.upsertEdges.push(edge);
    }
    return changes;
  }

  /** Removing the root clears everything; otherwise downstream nodes are left disconnected. */
  remove(id: string): GraphChanges {
    const n = this.nodes.get(id);
    if (!n) return noChanges();
    if (n.root) {
      this.reset([], []);
      return { ...noChanges(), clear: true };
    }
    const removeEdges = [...(this.adj.get(id) ?? [])];
    removeEdges.forEach((e) => this.deleteEdge(e));
    this.adj.delete(id);
    this.unindex(n);
    this.nodes.delete(id);
    this.z.delete(id);
    return { ...noChanges(), removeNodes: [id], removeEdges };
  }

  /** Inserts or replaces a node, dropping its edges whose ports no longer exist. */
  upsertNode(node: FlowNode): GraphChanges {
    this.setNode(node);
    const removeEdges = [...(this.adj.get(node.id) ?? [])].filter((id) => {
      const e = this.edges.get(id)!;
      return (e.source === node.id && !node.outputs?.includes(e.sourcePort)) || (e.target === node.id && !node.inputs?.includes(e.targetPort));
    });
    removeEdges.forEach((e) => this.deleteEdge(e));
    return { ...noChanges(), upsertNodes: [node], removeEdges };
  }
}

/** Mirrors worker changes onto plain arrays (used to keep small-graph models in sync). */
export function applyChanges(nodes: FlowNode[], edges: FlowEdge[], ch: GraphChanges): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const upsert = <T extends { id: string }>(list: T[], remove: string[], items: T[]) => {
    const gone = new Set([...remove, ...items.map((i) => i.id)]);
    return [...list.filter((i) => !gone.has(i.id)), ...items];
  };
  const [n, e] = ch.clear ? [[], []] : [nodes, edges];
  return {
    nodes: upsert(n, ch.removeNodes, ch.upsertNodes),
    edges: upsert(e, ch.removeEdges, ch.upsertEdges),
  };
}
