// The layout lives in the secondary entry point (ngx-node-flow/layout); tested here with the library specs.
import { layered } from '../../layout/src/layered';
import { FlowEdge, FlowNode } from './types';

const node = (id: string): FlowNode => ({ id, x: 0, y: 0, label: id });
const edge = (s: string, t: string): FlowEdge => ({ id: `${s}-${t}`, source: s, sourcePort: 'o', target: t, targetPort: 'i' });
const at = (p: { id: string; x: number; y: number }[]) => Object.fromEntries(p.map((q) => [q.id, [q.x, q.y]]));

describe('layered', () => {
  it('puts each node one layer after its furthest predecessor', () => {
    // a -> b -> c, a -> c: c goes to layer 2, not 1
    const p = at(layered([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]));
    expect(p['a'][0]).toBe(0);
    expect(p['b'][0]).toBe(240);
    expect(p['c'][0]).toBe(480);
  });

  it('stacks a layer vertically with the gap, ordered by predecessors', () => {
    // a, b sources; b's child d before a's child c? barycenter keeps c (under a) above d (under b)
    const p = at(layered([node('a'), node('b'), node('d'), node('c')], [edge('a', 'c'), edge('b', 'd')]));
    expect([p['a'][1], p['b'][1]]).toEqual([0, 80]);
    expect([p['c'][1], p['d'][1]]).toEqual([0, 80]);
  });

  it('places every node of a cycle, once', () => {
    const p = layered([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(p.map((q) => q.id).sort()).toEqual(['a', 'b', 'c']);
    expect(at(p)['c'][0]).toBe(480);
  });

  it('ignores edges to nodes outside the set and self-loops', () => {
    expect(layered([node('a')], [edge('a', 'zz'), edge('a', 'a')])).toEqual([{ id: 'a', x: 0, y: 0 }]);
  });
});
