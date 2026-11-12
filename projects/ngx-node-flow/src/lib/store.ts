import { hitTest, Hit, nodeHeight } from './geometry';
import { EdgeRejectReason, FlowEdge, FlowNode, FlowPort, GraphChanges, GraphChunk, GraphSnapshot, NodeFlowConfig } from './types';

const CELL = 1024;
const GAP = 80;
const OFFSET = 2 ** 20; // grid coords shifted positive so (cx, cy) packs into one safe integer key

export const noChanges = (): GraphChanges => ({ upsertNodes: [], removeNodes: [], upsertEdges: [], removeEdges: [] });

type Ports = Pick<FlowNode, 'inputs' | 'outputs'>;
type Extra = Omit<FlowNode, 'id' | 'x' | 'y' | 'label' | 'inputs' | 'outputs'>;

function grow<T extends Float64Array | Uint32Array | Uint8Array>(a: T, size: number): T {
  if (size <= a.length) return a;
  const b = new (a.constructor as new (n: number) => T)(Math.max(size, a.length * 2));
  b.set(a);
  return b;
}

/**
 * Worker-side graph stored column-wise: positions and references live in typed arrays indexed by
 * slot, port lists and port ids are interned, and objects are only built for what is queried.
 * Edges may reference nodes that have not arrived yet: those get a placeholder slot (alive = 0).
 */
export class GraphStore {
  // nodes
  private nId: string[] = [];
  private nIdx = new Map<string, number>();
  private nLabel: string[] = [];
  private nx = new Float64Array(1024);
  private ny = new Float64Array(1024);
  private nPorts = new Uint32Array(1024);
  private nAlive = new Uint8Array(1024);
  private nSeen = new Uint32Array(1024);
  private nExtra = new Map<number, Extra>();
  // directed adjacency (edge slots): traversals follow `out` without filtering by direction
  private out: (number[] | undefined)[] = [];
  private inn: (number[] | undefined)[] = [];
  private nFree: number[] = [];
  private liveNodes = 0;
  private stamp = 0;
  // interned port lists ({inputs, outputs} combos) and port ids
  private ports: Ports[] = [];
  private portsIdx = new Map<string, number>();
  private strs: string[] = [];
  private strIdx = new Map<string, number>();
  // edges
  private eId: string[] = [];
  private eIdx = new Map<string, number>();
  private eSrc = new Uint32Array(1024);
  private eDst = new Uint32Array(1024);
  private eSp = new Uint32Array(1024);
  private eTp = new Uint32Array(1024);
  private eFree: number[] = [];
  private liveEdges = 0;
  // spatial grid: cell key -> node slots; z only for nodes brought to front
  private grid = new Map<number, number[]>();
  private z = new Map<number, number>();
  private zTop = 0;
  /** Bumped whenever a node is added, moved, replaced or removed. */
  revision = 0;
  // open transaction: state of each touched node/edge before its first change (null = did not exist)
  private tx: { nodes: Map<string, FlowNode | null>; edges: Map<string, FlowEdge | null> } | null = null;
  private txDepth = 0;

  constructor(private readonly cfg: NodeFlowConfig) {}

  get nodeCount() {
    return this.liveNodes;
  }

  get edgeCount() {
    return this.liveEdges;
  }

  // --- interning --------------------------------------------------------------

  private str(s: string): number {
    let i = this.strIdx.get(s);
    if (i === undefined) this.strIdx.set(s, (i = this.strs.push(s) - 1));
    return i;
  }

  private portsOf(n: Ports): number {
    const key = JSON.stringify([n.inputs, n.outputs]);
    let i = this.portsIdx.get(key);
    if (i === undefined) this.portsIdx.set(key, (i = this.ports.push({ inputs: n.inputs?.map((p) => ({ ...p })), outputs: n.outputs?.map((p) => ({ ...p })) }) - 1));
    return i;
  }

  // --- slots ------------------------------------------------------------------

  private slot(id: string): number {
    let s = this.nIdx.get(id);
    if (s !== undefined) return s;
    s = this.nFree.pop() ?? this.nId.length;
    const size = s + 1;
    this.nx = grow(this.nx, size);
    this.ny = grow(this.ny, size);
    this.nPorts = grow(this.nPorts, size);
    this.nAlive = grow(this.nAlive, size);
    this.nSeen = grow(this.nSeen, size);
    this.nId[s] = id;
    this.nAlive[s] = 0;
    this.out[s] = undefined;
    this.inn[s] = undefined;
    this.nIdx.set(id, s);
    return s;
  }

  private cells(s: number, fn: (key: number) => void) {
    const x = this.nx[s], y = this.ny[s];
    const x0 = Math.floor(x / CELL), x1 = Math.floor((x + this.cfg.node.width) / CELL);
    const y0 = Math.floor(y / CELL), y1 = Math.floor((y + nodeHeight(this.ports[this.nPorts[s]], this.cfg)) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn((cx + OFFSET) * 2 ** 21 + (cy + OFFSET));
  }

  private index(s: number) {
    this.cells(s, (k) => {
      const cell = this.grid.get(k);
      if (cell) cell.push(s);
      else this.grid.set(k, [s]);
    });
  }

  private unindex(s: number) {
    this.cells(s, (k) => {
      const cell = this.grid.get(k);
      if (!cell) return;
      const i = cell.indexOf(s);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) this.grid.delete(k);
    });
  }

  private setNode(n: FlowNode): number {
    const s = this.slot(n.id);
    this.touchNode(s);
    if (this.nAlive[s]) this.unindex(s);
    else this.liveNodes++;
    this.nAlive[s] = 1;
    this.nx[s] = n.x;
    this.ny[s] = n.y;
    this.nLabel[s] = n.label;
    this.nPorts[s] = this.portsOf(n);
    const { id, x, y, label, inputs, outputs, ...extra } = n;
    if (Object.keys(extra).length) this.nExtra.set(s, extra);
    else this.nExtra.delete(s);
    this.index(s);
    return s;
  }

  private mat(s: number): FlowNode {
    const p = this.ports[this.nPorts[s]];
    const n: FlowNode = { id: this.nId[s], x: this.nx[s], y: this.ny[s], label: this.nLabel[s] };
    if (p.inputs) n.inputs = p.inputs;
    if (p.outputs) n.outputs = p.outputs;
    const extra = this.nExtra.get(s);
    return extra ? Object.assign(n, extra) : n;
  }

  private setEdge(e: FlowEdge) {
    let s = this.eIdx.get(e.id);
    if (s !== undefined) this.deleteEdgeSlot(s);
    else if (this.tx && !this.tx.edges.has(e.id)) this.tx.edges.set(e.id, null);
    s = this.eFree.pop() ?? this.eId.length;
    const size = s + 1;
    this.eSrc = grow(this.eSrc, size);
    this.eDst = grow(this.eDst, size);
    this.eSp = grow(this.eSp, size);
    this.eTp = grow(this.eTp, size);
    const src = this.slot(e.source), dst = this.slot(e.target);
    this.eId[s] = e.id;
    this.eSrc[s] = src;
    this.eDst[s] = dst;
    this.eSp[s] = this.str(e.sourcePort);
    this.eTp[s] = this.str(e.targetPort);
    this.eIdx.set(e.id, s);
    (this.out[src] ??= []).push(s);
    (this.inn[dst] ??= []).push(s);
    this.liveEdges++;
  }

  /** Edge slots touching node slot `s`, each once (a self-loop is in both lists). */
  private edgesAt(s: number): number[] {
    const out = this.out[s] ?? [], inn = this.inn[s] ?? [];
    return [...inn, ...out.filter((e) => this.eDst[e] !== s)];
  }

  private matEdge(s: number): FlowEdge {
    return { id: this.eId[s], source: this.nId[this.eSrc[s]], sourcePort: this.strs[this.eSp[s]], target: this.nId[this.eDst[s]], targetPort: this.strs[this.eTp[s]] };
  }

  private deleteEdgeSlot(s: number) {
    if (this.tx && !this.tx.edges.has(this.eId[s])) this.tx.edges.set(this.eId[s], this.matEdge(s));
    for (const list of [this.out[this.eSrc[s]], this.inn[this.eDst[s]]]) {
      const i = list?.indexOf(s) ?? -1;
      if (i >= 0) list!.splice(i, 1);
    }
    this.eIdx.delete(this.eId[s]);
    this.eFree.push(s);
    this.liveEdges--;
  }

  private touchNode(s: number) {
    this.revision++;
    const id = this.nId[s];
    if (this.tx && !this.tx.nodes.has(id)) this.tx.nodes.set(id, this.nAlive[s] ? this.mat(s) : null);
  }

  // --- transactions -------------------------------------------------------------

  /** Starts recording changes; nested calls join the outer transaction. */
  begin() {
    if (this.txDepth++ === 0) this.tx = { nodes: new Map(), edges: new Map() };
  }

  /**
   * Closes the transaction. Returns what undoes it and what redoes it (both as plain GraphChanges),
   * or null while nested or when nothing changed.
   */
  end(): { undo: GraphChanges; redo: GraphChanges } | null {
    if (this.txDepth === 0 || --this.txDepth > 0 || !this.tx) return null;
    const { nodes, edges } = this.tx;
    this.tx = null;
    const undo = noChanges(), redo = noChanges();
    for (const [id, before] of nodes) {
      const now = this.node(id);
      if (before) undo.upsertNodes.push(before);
      else if (now) undo.removeNodes.push(id);
      if (now) redo.upsertNodes.push(now);
      else if (before) redo.removeNodes.push(id);
    }
    for (const [id, before] of edges) {
      const s = this.eIdx.get(id);
      const now = s === undefined ? undefined : this.matEdge(s);
      if (before) undo.upsertEdges.push(before);
      else if (now) undo.removeEdges.push(id);
      if (now) redo.upsertEdges.push(now);
      else if (before) redo.removeEdges.push(id);
    }
    const empty = (c: GraphChanges) => !c.upsertNodes.length && !c.removeNodes.length && !c.upsertEdges.length && !c.removeEdges.length;
    return empty(undo) && empty(redo) ? null : { undo, redo };
  }

  /** Applies a GraphChanges as-is (no pruning, no rules): edge removals, node removals, node upserts, edge upserts. */
  apply(ch: GraphChanges) {
    ch.removeEdges.forEach((id) => this.disconnect(id));
    ch.removeNodes.forEach((id) => this.remove(id));
    ch.upsertNodes.forEach((n) => this.setNode(n));
    ch.upsertEdges.forEach((e) => this.setEdge(e));
  }

  // --- ingestion ----------------------------------------------------------------

  reset(nodes: FlowNode[], edges: FlowEdge[]) {
    Object.assign(this, new GraphStore(this.cfg)); // fresh columns, same instance
    this.addChunk({ nodes, edges });
  }

  addChunk(chunk: GraphChunk) {
    chunk.nodes?.forEach((n) => this.setNode(n));
    chunk.edges?.forEach((e) => this.setEdge(e));
  }

  // --- queries --------------------------------------------------------------------

  node(id: string): FlowNode | undefined {
    const s = this.nIdx.get(id);
    return s !== undefined && this.nAlive[s] ? this.mat(s) : undefined;
  }

  /** The whole graph as plain arrays (placeholder slots for missing nodes are skipped). */
  snapshot(): { nodes: FlowNode[]; edges: FlowEdge[] } {
    const nodes: FlowNode[] = [], edges: FlowEdge[] = [];
    for (let s = 0; s < this.nId.length; s++) if (this.nAlive[s]) nodes.push(this.mat(s));
    for (const s of this.eIdx.values()) edges.push(this.matEdge(s));
    return { nodes, edges };
  }

  /** World bounding box of all live nodes, or null when empty. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let s = 0; s < this.nId.length; s++) {
      if (!this.nAlive[s]) continue;
      x0 = Math.min(x0, this.nx[s]);
      y0 = Math.min(y0, this.ny[s]);
      x1 = Math.max(x1, this.nx[s] + this.cfg.node.width);
      y1 = Math.max(y1, this.ny[s] + nodeHeight(this.ports[this.nPorts[s]], this.cfg));
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  /** Nodes intersecting the world rect, bottom-most first (draw order). */
  query(x0: number, y0: number, x1: number, y1: number): FlowNode[] {
    const stamp = ++this.stamp;
    const w = this.cfg.node.width;
    const hits: number[] = [];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const cell = this.grid.get((cx + OFFSET) * 2 ** 21 + (cy + OFFSET));
        if (!cell) continue;
        for (const s of cell) {
          if (this.nSeen[s] === stamp) continue;
          this.nSeen[s] = stamp;
          const x = this.nx[s], y = this.ny[s];
          if (x <= x1 && y <= y1 && x + w >= x0 && y + nodeHeight(this.ports[this.nPorts[s]], this.cfg) >= y0) hits.push(s);
        }
      }
    }
    if (this.z.size) hits.sort((a, b) => (this.z.get(a) ?? 0) - (this.z.get(b) ?? 0));
    return hits.map((s) => this.mat(s));
  }

/** Up to `limit` live nodes whose label contains `text` (case-insensitive), in slot order. */
  find(text: string, limit: number): { id: string; label: string }[] {
    const q = text.trim().toLowerCase(), out: { id: string; label: string }[] = [];
    if (!q) return out;
    for (let s = 0; s < this.nId.length && out.length < limit; s++) {
      if (this.nAlive[s] && this.nLabel[s].toLowerCase().includes(q)) out.push({ id: this.nId[s], label: this.nLabel[s] });
    }
    return out;
  }

  /** Calls `fn` with the top-left of every live node, without building node objects. */
  eachPosition(fn: (x: number, y: number) => void) {
    for (let s = 0; s < this.nId.length; s++) if (this.nAlive[s]) fn(this.nx[s], this.ny[s]);
  }

  hasEdge(id: string): boolean {
    return this.eIdx.has(id);
  }

  /** The given nodes (missing ids skipped) and only the edges running between them. */
  subgraph(ids: Iterable<string>): GraphSnapshot {
    const nodes: FlowNode[] = [], edges: FlowEdge[] = [];
    const inside = new Set<number>();
    for (const id of ids) {
      const s = this.nIdx.get(id);
      if (s !== undefined && this.nAlive[s]) inside.add(s);
    }
    for (const s of inside) {
      nodes.push(this.mat(s));
      this.out[s]?.forEach((e) => inside.has(this.eDst[e]) && edges.push(this.matEdge(e)));
    }
    return { nodes, edges };
  }

  /** Ids of every live node. */
  ids(): string[] {
    const ids: string[] = [];
    for (let s = 0; s < this.nId.length; s++) if (this.nAlive[s]) ids.push(this.nId[s]);
    return ids;
  }

  /** Edges touching any of `nodes`, each once. */
  edgesOf(nodes: Iterable<FlowNode>): FlowEdge[] {
    const seen = new Set<number>();
    for (const n of nodes) {
      const s = this.nIdx.get(n.id);
      if (s === undefined) continue;
      this.out[s]?.forEach((e) => seen.add(e));
      this.inn[s]?.forEach((e) => seen.add(e));
    }
    return [...seen].map((e) => this.matEdge(e));
  }

  /** Last edge plugged into an input port (the one a drag picks up). */
  edgeInto(nodeId: string, port: string): FlowEdge | undefined {
    const s = this.nIdx.get(nodeId);
    const p = this.strIdx.get(port);
    if (s === undefined || p === undefined) return undefined;
    const list = this.inn[s] ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (this.eTp[list[i]] === p) return this.matEdge(list[i]);
    return undefined;
  }

  /**
   * Whether `toId` can be reached from `fromId` along edge direction (a node reaches itself).
   * Iterative DFS with early exit: graphs here can be 1M deep, so no recursion. Cost is the
   * part of the graph downstream of `fromId`, worst case the whole graph (e.g. one big ring).
   */
  reaches(fromId: string, toId: string): boolean {
    const from = this.nIdx.get(fromId), to = this.nIdx.get(toId);
    if (from === undefined || to === undefined) return false;
    const stamp = ++this.stamp; // nSeen doubles as the visited set, no allocation per call
    this.nSeen[from] = stamp;
    const stack = [from];
    while (stack.length) {
      const u = stack.pop()!;
      if (u === to) return true;
      const list = this.out[u];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const v = this.eDst[list[i]];
        if (this.nSeen[v] !== stamp) {
          this.nSeen[v] = stamp;
          stack.push(v);
        }
      }
    }
    return false;
  }

  /** Edges plugged into one port of a node. */
  portLoad(nodeId: string, side: 'in' | 'out', portId: string): number {
    const s = this.nIdx.get(nodeId), p = this.strIdx.get(portId);
    if (s === undefined || p === undefined) return 0;
    const [list, col] = side === 'in' ? [this.inn[s], this.eTp] : [this.out[s], this.eSp];
    return list?.reduce((n, e) => n + +(col[e] === p), 0) ?? 0;
  }

  /**
   * Why the user may not add `edge` (null = allowed): port types, then free capacity, then cycles.
   * `cycles: false` skips the (possibly whole-graph) cycle walk, for per-frame drag hints.
   */
  check(edge: FlowEdge, cycles = true): EdgeRejectReason | null {
    const out = this.node(edge.source)?.outputs?.find((p) => p.id === edge.sourcePort);
    const inp = this.node(edge.target)?.inputs?.find((p) => p.id === edge.targetPort);
    if (!out || !inp) return null; // unknown ports: connect() decides, nothing to rule on here
    if (!typesMatch(out, inp, this.cfg.edge.compatibility)) return 'type';
    const full = (p: FlowPort, id: string, side: 'in' | 'out') => p.maxConnections !== undefined && this.portLoad(id, side, p.id) >= p.maxConnections;
    if (full(out, edge.source, 'out') || full(inp, edge.target, 'in')) return 'maxConnections';
    if (cycles && !this.cfg.edge.allowCycles && this.reaches(edge.target, edge.source)) return 'cycle';
    return null;
  }

  hit(wx: number, wy: number): Hit | null {
    const r = this.cfg.node.portRadius * 2;
    return hitTest(this.query(wx - r, wy - r, wx + r, wy + r), wx, wy, this.cfg);
  }

  // --- mutations (each returns what changed) ------------------------------------------

  bringToFront(id: string) {
    const s = this.nIdx.get(id);
    if (s !== undefined) this.z.set(s, ++this.zTop);
  }

  move(id: string, x: number, y: number): GraphChanges {
    const s = this.nIdx.get(id);
    if (s === undefined || !this.nAlive[s]) return noChanges();
    this.touchNode(s);
    this.unindex(s);
    this.nx[s] = x;
    this.ny[s] = y;
    this.index(s);
    return { ...noChanges(), upsertNodes: [this.mat(s)] };
  }

  connect(edge: FlowEdge): GraphChanges | null {
    const src = this.nIdx.get(edge.source), dst = this.nIdx.get(edge.target);
    const sp = this.strIdx.get(edge.sourcePort), tp = this.strIdx.get(edge.targetPort);
    const dup = src !== undefined && this.out[src]?.some((e) => this.eDst[e] === dst && this.eSp[e] === sp && this.eTp[e] === tp);
    if (dup) return null;
    this.setEdge(edge);
    return { ...noChanges(), upsertEdges: [edge] };
  }

  disconnect(id: string): GraphChanges {
    const s = this.eIdx.get(id);
    if (s === undefined) return noChanges();
    this.deleteEdgeSlot(s);
    return { ...noChanges(), removeEdges: [id] };
  }

  /**
   * Places `template` to the right of `id` (its x/y are ignored), connected from the source's first free
   * output (or first output) into the new node's first input.
   */
  addAfter(id: string, template: FlowNode): GraphChanges & { node?: FlowNode } {
    const from = this.node(id);
    if (!from) return noChanges();
    const w = this.cfg.node.width;
    const node: FlowNode = { ...template, x: from.x + w + GAP, y: from.y };
    const h = nodeHeight(node, this.cfg);
    // jump below everything overlapping the slot instead of probing one step at a time
    for (let hits = this.query(node.x, node.y, node.x + w, node.y + h); hits.length; hits = this.query(node.x, node.y, node.x + w, node.y + h)) {
      node.y = Math.max(...hits.map((n) => n.y + nodeHeight(n, this.cfg))) + 20;
    }
    this.setNode(node);

    const changes: GraphChanges & { node?: FlowNode } = { ...noChanges(), upsertNodes: [node], node };
    const s = this.nIdx.get(from.id)!;
    const used = new Set((this.out[s] ?? []).map((e) => this.strs[this.eSp[e]]));
    const outs = from.outputs ?? [];
    const port = (outs.find((p) => !used.has(p.id)) ?? outs[0])?.id;
    const input = node.inputs?.[0]?.id;
    if (port && input) {
      const edge = { id: `${from.id}:${port}->${node.id}:${input}`, source: from.id, sourcePort: port, target: node.id, targetPort: input };
      this.setEdge(edge);
      changes.upsertEdges.push(edge);
    }
    return changes;
  }

  /** Removes the node and its edges; neighbours are left disconnected. */
  remove(id: string): GraphChanges {
    const s = this.nIdx.get(id);
    if (s === undefined || !this.nAlive[s]) return noChanges();
    this.touchNode(s);
    const removeEdges = this.edgesAt(s).map((e) => {
      const edgeId = this.eId[e];
      this.deleteEdgeSlot(e);
      return edgeId;
    });
    this.unindex(s);
    this.nAlive[s] = 0;
    this.nIdx.delete(id);
    this.nExtra.delete(s);
    this.z.delete(s);
    this.out[s] = undefined;
    this.inn[s] = undefined;
    this.nFree.push(s);
    this.liveNodes--;
    return { ...noChanges(), removeNodes: [id], removeEdges };
  }

  /** Inserts or replaces a node, dropping its edges whose ports no longer exist. */
  upsertNode(node: FlowNode): GraphChanges {
    const s = this.setNode(node);
    const removeEdges: string[] = [];
    for (const e of this.edgesAt(s)) {
      const gone =
        (this.eSrc[e] === s && !node.outputs?.some((p) => p.id === this.strs[this.eSp[e]])) ||
        (this.eDst[e] === s && !node.inputs?.some((p) => p.id === this.strs[this.eTp[e]]));
      if (gone) {
        removeEdges.push(this.eId[e]);
        this.deleteEdgeSlot(e);
      }
    }
    return { ...noChanges(), upsertNodes: [node], removeEdges };
  }
}

/** Folds a graphChange event into plain arrays, for apps that persist the graph as arrays. */
export function applyChanges(nodes: FlowNode[], edges: FlowEdge[], ch: GraphChanges): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const upsert = <T extends { id: string }>(list: T[], remove: string[], items: T[]) => {
    const gone = new Set([...remove, ...items.map((i) => i.id)]);
    return [...list.filter((i) => !gone.has(i.id)), ...items];
  };
  return {
    nodes: upsert(nodes, ch.removeNodes, ch.upsertNodes),
    edges: upsert(edges, ch.removeEdges, ch.upsertEdges),
  };
}

/** Whether an output port may feed an input port under `edge.compatibility` (untyped ports match anything). */
export function typesMatch(out: FlowPort, inp: FlowPort, compatibility: Record<string, string[]> | undefined): boolean {
  if (!compatibility || out.type === undefined || inp.type === undefined) return true;
  const allowed = compatibility[out.type];
  return !allowed || allowed.includes(inp.type);
}

/**
 * A copy of `g` with fresh node ids, shifted by (dx, dy). Edges keep their ports and follow the new ids;
 * edges with an endpoint outside `g` are dropped.
 */
export function cloneGraph(g: GraphSnapshot, dx: number, dy: number, newId: () => string = () => crypto.randomUUID()): GraphSnapshot {
  const ids = new Map(g.nodes.map((n) => [n.id, newId()]));
  const nodes = g.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy }));
  const edges = g.edges.flatMap((e) => {
    const source = ids.get(e.source), target = ids.get(e.target);
    return source && target ? [{ ...e, id: `${source}:${e.sourcePort}->${target}:${e.targetPort}`, source, target }] : [];
  });
  return { nodes, edges };
}
