import { FlowEdge, FlowNode } from 'ngx-node-flow';
import { resolveResult } from './cells';

// the demo starts empty, so the cells under test live here
const initialNodes: FlowNode[] = [
  { id: 'color', x: 40, y: 40, label: 'Cor', outputs: [{ id: 'cor', type: 'color' }], data: { kind: 'color', value: '#3b82f6' } },
  { id: 'shape', x: 40, y: 150, label: 'Forma', outputs: [{ id: 'forma', type: 'shape' }], data: { kind: 'shape', value: 'circle' } },
  { id: 'zoom', x: 40, y: 260, label: 'Zoom', outputs: [{ id: 'zoom', type: 'zoom' }], data: { kind: 'zoom', value: 50 } },
  { id: 'result', x: 360, y: 130, label: 'Resultado', inputs: [{ id: 'cor' }, { id: 'forma' }, { id: 'zoom' }], data: { kind: 'result' } },
];
const initialEdges: FlowEdge[] = [
  { id: 'e-color', source: 'color', sourcePort: 'cor', target: 'result', targetPort: 'cor' },
  { id: 'e-shape', source: 'shape', sourcePort: 'forma', target: 'result', targetPort: 'forma' },
  { id: 'e-zoom', source: 'zoom', sourcePort: 'zoom', target: 'result', targetPort: 'zoom' },
];

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
