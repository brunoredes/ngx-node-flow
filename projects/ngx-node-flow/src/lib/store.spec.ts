import { DEFAULT_NODE_FLOW_CONFIG as cfg } from './config';
import { applyChanges, GraphStore } from './store';
import { FlowEdge, FlowNode } from './types';

const a = (): FlowNode => ({ id: 'a', x: 0, y: 0, label: 'A', root: true, outputs: ['o1', 'o2'] });
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
    const ch = s.addAfter('a');
    expect(ch.node).toMatchObject({ x: cfg.node.width + 80, y: 0 });
    expect(ch.upsertEdges[0]).toMatchObject({ source: 'a', sourcePort: 'o2', target: ch.node!.id, targetPort: 'in' });
  });

  it('addAfter moves down while the spot is occupied', () => {
    const s = store([a(), { ...b(), x: cfg.node.width + 80 }], []);
    expect(s.addAfter('a').node!.y).toBeGreaterThanOrEqual(cfg.node.height);
  });

  it('remove drops the node and its edges, leaving downstream nodes disconnected', () => {
    const s = store();
    const ch = s.remove('b');
    expect(ch).toMatchObject({ removeNodes: ['b'], removeEdges: ['ab', 'bc'] });
    expect([...s.nodes.keys()]).toEqual(['a', 'c']);
    expect(s.edges.size).toBe(0);
  });

  it('removing the root clears everything', () => {
    const s = store();
    expect(s.remove('a').clear).toBe(true);
    expect(s.nodes.size + s.edges.size).toBe(0);
  });

  it('upsertNode prunes edges whose port disappeared', () => {
    const s = store();
    expect(s.upsertNode({ ...b(), inputs: ['other'] }).removeEdges).toEqual(['ab']);
    expect([...s.edges.keys()]).toEqual(['bc']);
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
});

describe('applyChanges', () => {
  it('upserts, removes and clears', () => {
    const g = applyChanges([a(), b()], [ab], { upsertNodes: [{ ...a(), x: 9 }], removeNodes: ['b'], upsertEdges: [], removeEdges: ['ab'] });
    expect(g.nodes).toEqual([{ ...a(), x: 9 }]);
    expect(g.edges).toEqual([]);
    expect(applyChanges([a()], [ab], { clear: true, upsertNodes: [c()], removeNodes: [], upsertEdges: [], removeEdges: [] })).toEqual({ nodes: [c()], edges: [] });
  });
});
