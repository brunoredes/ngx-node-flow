import { parseClipboard, toClipboard } from './clipboard';
import { GraphSnapshot } from './types';

const g: GraphSnapshot = {
  nodes: [
    { id: 'a', x: 0, y: 0, label: 'A', outputs: [{ id: 'o', type: 't' }], data: { k: 1 } },
    { id: 'b', x: 1, y: 2, label: 'B', inputs: [{ id: 'i', maxConnections: 1 }], locked: true },
  ],
  edges: [{ id: 'e', source: 'a', sourcePort: 'o', target: 'b', targetPort: 'i' }],
};

describe('clipboard', () => {
  it('round-trips a graph', () => {
    expect(parseClipboard(toClipboard(g))).toEqual(g);
  });

  it('refuses text that is not our format', () => {
    expect(parseClipboard('hello')).toBeNull();
    expect(parseClipboard('{"nodes":[],"edges":[]}')).toBeNull();
    expect(parseClipboard('null')).toBeNull();
  });

  it('refuses malformed nodes, ports and edges', () => {
    const bad = (patch: object) => parseClipboard(JSON.stringify({ format: 'ngx-node-flow/v1', nodes: [], edges: [], ...patch }));
    expect(bad({ nodes: [{ id: 'a', x: '0', y: 0, label: 'A' }] })).toBeNull();
    expect(bad({ nodes: [{ id: 'a', x: 0, y: 0, label: 'A', inputs: ['in'] }] })).toBeNull();
    expect(bad({ nodes: [{ id: 'a', x: 0, y: 0, label: 'A', data: [] }] })).toBeNull();
    expect(bad({ edges: [{ id: 'e', source: 'a' }] })).toBeNull();
  });
});
