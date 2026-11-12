import { initialEdges, initialNodes, resolveResult } from './cells';

describe('resolveResult', () => {
  it('reads the three connected cells', () => {
    expect(resolveResult(initialNodes, initialEdges)).toEqual({ color: '#3b82f6', shape: 'circle', zoom: 50 });
  });

  it('drops disconnected and invalid inputs', () => {
    const nodes = initialNodes.map((n) => (n.id === 'color' ? { ...n, data: { kind: 'color', value: 'blue' } } : n));
    const edges = initialEdges.filter((e) => e.source !== 'zoom');
    expect(resolveResult(nodes, edges)).toEqual({ shape: 'circle' });
  });

  it('is null without a result cell', () => {
    expect(resolveResult(initialNodes.filter((n) => n.id !== 'result'), [])).toBeNull();
  });
});
