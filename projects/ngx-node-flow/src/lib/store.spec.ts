import { DEFAULT_NODE_FLOW_CONFIG as cfg } from './config';
import { nodeHeight } from './geometry';
import { applyChanges, GraphStore } from './store';
import { FlowEdge, FlowNode } from './types';

const a = (): FlowNode => ({ id: 'a', x: 0, y: 0, label: 'A', outputs: ['o1', 'o2'] });
const tpl = (): FlowNode => ({ id: 'new', x: 0, y: 0, label: 'New', inputs: ['i'], outputs: ['o'] });
const b = (): FlowNode => ({ id: 'b', x: 300, y: 0, label: 'B', inputs: ['in'], outputs: ['out'] });
const c = (): FlowNode => ({ id: 'c', x: 600, y: 0, label: 'C', inputs: ['in'] });
const ab: FlowEdge = { id: 'ab', source: 'a', sourcePort: 'o1', target: 'b', targetPort: 'in' };
const bc: FlowEdge = { id: 'bc', source: 'b', sourcePort: 'out', target: 'c', targetPort: 'in' };

function store(nodes = [a(), b(), c()], edges = [ab, bc]) {
  const s = new GraphStore(cfg);
  s.reset(nodes, edges);
  return s;
}

describe('GraphStore', () => {
  it('addAfter places the node to the right, connected from the first free output', () => {
    const s = store([a()], [ab]);
    const ch = s.addAfter('a', tpl());
    expect(ch.node).toMatchObject({ id: 'new', label: 'New', x: cfg.node.width + 80, y: 0 });
    expect(ch.upsertEdges[0]).toMatchObject({ source: 'a', sourcePort: 'o2', target: 'new', targetPort: 'i' });
  });

  it('addAfter leaves a node without inputs unconnected', () => {
    expect(store([a()], []).addAfter('a', { ...tpl(), inputs: [] }).upsertEdges).toEqual([]);
  });

  it('addAfter moves down while the spot is occupied', () => {
    const s = store([a(), { ...b(), x: cfg.node.width + 80 }], []);
    expect(s.addAfter('a', tpl()).node!.y).toBeGreaterThanOrEqual(cfg.node.height);
  });

  it('addAfter lands in the first free gap below a dense column', () => {
    const x = cfg.node.width + 80, h = cfg.node.height;
    const column = Array.from({ length: 50 }, (_, i) => ({ ...c(), id: `k${i}`, x, y: i * (h + 20) }));
    const n = store([a(), ...column], []).addAfter('a', tpl()).node!;
    expect(n.y).toBe(50 * (h + 20));
  });

  it('remove drops the node and its edges, leaving downstream nodes disconnected', () => {
    const s = store();
    const ch = s.remove('b');
    expect(ch).toMatchObject({ removeNodes: ['b'], removeEdges: ['ab', 'bc'] });
    expect(['a', 'b', 'c'].filter((id) => s.node(id))).toEqual(['a', 'c']);
    expect(s.edgeCount).toBe(0);
  });

  it('upsertNode prunes edges whose port disappeared', () => {
    const s = store();
    expect(s.upsertNode({ ...b(), inputs: ['other'] }).removeEdges).toEqual(['ab']);
    expect(s.edgesOf([s.node('b')!, s.node('c')!]).map((e) => e.id)).toEqual(['bc']);
  });

  it('query returns only intersecting nodes, bring-to-front last', () => {
    const s = store([a(), { ...b(), x: 50 }, { ...c(), x: 50_000 }], []);
    s.bringToFront('a');
    expect(s.query(0, 0, 400, 100).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('move re-indexes the node', () => {
    const s = store();
    s.move('c', 90_000, 90_000);
    expect(s.query(500, 0, 900, 100)).toEqual([]);
    expect(s.query(90_000, 90_000, 90_100, 90_100).map((n) => n.id)).toEqual(['c']);
  });

  it('hit finds ports and bodies through the grid', () => {
    const s = store();
    expect(s.hit(310, 5)?.node.id).toBe('b');
    expect(s.hit(cfg.node.width, 24 + 10)?.port).toEqual({ side: 'out', name: 'o1' });
    expect(s.hit(-500, -500)).toBeNull();
  });

  it('accepts edges to nodes from later chunks', () => {
    const s = new GraphStore(cfg);
    s.addChunk({ nodes: [a()], edges: [{ ...ab }] });
    expect(s.edgesOf([s.node('a')!])).toEqual([ab]);
    s.addChunk({ nodes: [b()] });
    expect(s.edgesOf([s.node('b')!])).toEqual([ab]);
  });

  it('connect rejects duplicates; edgeInto finds the plugged edge', () => {
    const s = store();
    expect(s.connect({ ...ab, id: 'dup' })).toBeNull();
    expect(s.edgeInto('b', 'in')).toEqual(ab);
  });

  it('removes a self-loop once, from both directions', () => {
    const loop: FlowEdge = { id: 'bb', source: 'b', sourcePort: 'out', target: 'b', targetPort: 'in' };
    const s = store([b()], [loop]);
    expect(s.remove('b').removeEdges).toEqual(['bb']);
    expect(s.edgeCount).toBe(0);
  });
});

describe('GraphStore.reaches', () => {
  it('follows edge direction only', () => {
    const s = store(); // a -> b -> c
    expect(s.reaches('a', 'c')).toBe(true);
    expect(s.reaches('c', 'a')).toBe(false);
    expect(s.reaches('b', 'b')).toBe(true);
    expect(s.reaches('a', 'missing')).toBe(false);
  });

  it('sees edges added and removed since the last query', () => {
    const s = store();
    s.disconnect('bc');
    expect(s.reaches('a', 'c')).toBe(false);
    s.connect({ id: 'ca', source: 'c', sourcePort: 'x', target: 'a', targetPort: 'y' });
    expect(s.reaches('c', 'b')).toBe(true);
  });

  it('walks a 1M-node ring iteratively, without blowing the stack', () => {
    const n = 1_000_000;
    const s = new GraphStore(cfg);
    const nodes: FlowNode[] = [], edges: FlowEdge[] = [];
    for (let i = 0; i < n; i++) {
      nodes.push({ id: `n${i}`, x: (i % 1000) * 200, y: Math.floor(i / 1000) * 100, label: '', inputs: ['in'], outputs: ['out'] });
      edges.push({ id: `e${i}`, source: `n${i}`, sourcePort: 'out', target: `n${(i + 1) % n}`, targetPort: 'in' });
    }
    s.addChunk({ nodes, edges });
    const t = performance.now();
    expect(s.reaches('n1', 'n0')).toBe(true); // worst case: the whole ring
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(1000); // generous bound for CI; the old string-keyed adjacency took ~1.2 s
    s.disconnect('e500000');
    expect(s.reaches('n1', 'n0')).toBe(false);
  }, 30_000);
});

describe('GraphStore memory layout', () => {
  it('interns identical port lists and keeps extras only where set', () => {
    const s = store([b(), { ...b(), id: 'b2' }, { ...c(), color: 'red', data: { k: 1 } }], []);
    expect(s.node('b')!.inputs).toBe(s.node('b2')!.inputs);
    expect(s.node('c')).toEqual({ ...c(), color: 'red', data: { k: 1 } });
    expect(s.node('b')).toEqual(b());
  });

  it('reuses freed slots and keeps counts right', () => {
    const s = store();
    s.remove('c');
    s.addChunk({ nodes: [{ ...c(), id: 'd' }] });
    expect(s.nodeCount).toBe(3);
    expect(s.edgeCount).toBe(1);
    expect(s.node('c')).toBeUndefined();
    expect(s.node('d')?.x).toBe(600);
  });

  it('snapshot returns live nodes and edges, skipping placeholders and removed nodes', () => {
    const s = store();
    s.addChunk({ edges: [{ ...ab, id: 'ghost', target: 'later' }] });
    s.remove('c');
    const snap = s.snapshot();
    expect(snap.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(snap.edges.map((e) => e.id).sort()).toEqual(['ab', 'ghost']);
  });

  it('bounds covers every live node, null when empty', () => {
    expect(store().bounds()).toEqual({ x0: 0, y0: 0, x1: 600 + cfg.node.width, y1: nodeHeight(a(), cfg) });
    expect(store([], []).bounds()).toBeNull();
  });

  it('counts placeholder endpoints only once the node arrives', () => {
    const s = new GraphStore(cfg);
    s.addChunk({ edges: [ab] });
    expect(s.nodeCount).toBe(0);
    expect(s.node('a')).toBeUndefined();
  });
});

describe('applyChanges', () => {
  it('upserts and removes', () => {
    const g = applyChanges([a(), b()], [ab], { upsertNodes: [{ ...a(), x: 9 }], removeNodes: ['b'], upsertEdges: [], removeEdges: ['ab'] });
    expect(g.nodes).toEqual([{ ...a(), x: 9 }]);
    expect(g.edges).toEqual([]);
  });
});
