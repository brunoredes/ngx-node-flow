import { TestBed } from '@angular/core/testing';
import { DEFAULT_NODE_FLOW_CONFIG as cfg, NODE_FLOW_CONFIG, provideNodeFlow } from './config';
import { bezier, hitTest, portPos, toWorld, zoomAt } from './geometry';
import { FlowNode } from './types';

describe('provideNodeFlow', () => {
  it('deep-merges options over defaults', () => {
    TestBed.configureTestingModule({ providers: [provideNodeFlow({ grid: { size: 32 }, theme: { edgeColor: 'red' } })] });
    const c = TestBed.inject(NODE_FLOW_CONFIG);
    expect(c.grid).toEqual({ ...cfg.grid, size: 32 });
    expect(c.theme).toEqual({ ...cfg.theme, edgeColor: 'red' });
    expect(c.edge).toEqual(cfg.edge);
  });

  it('falls back to defaults without a provider', () => {
    expect(TestBed.inject(NODE_FLOW_CONFIG)).toBe(cfg);
  });
});

describe('geometry', () => {
  const node: FlowNode = { id: 'a', x: 100, y: 50, label: 'A', inputs: ['in'], outputs: ['out'] };

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const cam = { x: 10, y: 20, zoom: 1 };
    const before = toWorld(cam, 300, 200);
    const after = toWorld(zoomAt(cam, 300, 200, 2, 0.1, 4), 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(cam, 0, 0, 100, 0.1, 4).zoom).toBe(4);
  });

  it('hitTest finds ports before node bodies, and misses empty space', () => {
    const out = portPos(node, 'out', 0, cfg);
    expect(hitTest([node], out.x, out.y, cfg)?.port).toEqual({ side: 'out', name: 'out' });
    expect(hitTest([node], node.x + 50, node.y + 5, cfg)).toEqual({ node });
    expect(hitTest([node], 0, 0, cfg)).toBeNull();
  });

  it('hitTest returns the top-most (last) node', () => {
    const b = { ...node, id: 'b' };
    expect(hitTest([node, b], node.x + 50, node.y + 5, cfg)?.node.id).toBe('b');
  });

  it('bezier starts and ends at the ports', () => {
    const p = bezier(0, 0, 100, 40, 8);
    expect(p.length).toBe(18);
    expect(p.slice(0, 2)).toEqual([0, 0]);
    expect(p.slice(-2)).toEqual([100, 40]);
  });
});
