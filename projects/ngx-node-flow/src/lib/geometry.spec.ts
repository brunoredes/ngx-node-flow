import { TestBed } from '@angular/core/testing';
import { DEFAULT_NODE_FLOW_CONFIG as cfg, NODE_FLOW_CONFIG, provideNodeFlow } from './config';
import { align, bezier, dashes, distToPolyline, hitTest, portPos, route, toWorld, zoomAt } from './geometry';
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
  const node: FlowNode = { id: 'a', x: 100, y: 50, label: 'A', inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] };

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
    expect(hitTest([node], out.x, out.y, cfg)?.port).toEqual({ side: 'out', id: 'out' });
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

describe('distToPolyline', () => {
  it('measures to the nearest segment, clamped to its ends', () => {
    const pts = [0, 0, 10, 0, 10, 10];
    expect(distToPolyline(pts, 5, 3)).toBe(3);
    expect(distToPolyline(pts, 13, 5)).toBe(3);
    expect(distToPolyline(pts, -4, 3)).toBe(5);
  });

  it('handles a degenerate segment', () => {
    expect(distToPolyline([1, 1, 1, 1], 4, 5)).toBe(5);
  });
});

describe('align', () => {
  const o = { x: 100, y: 100, w: 160, h: 60 };
  it('snaps the closest edge or center within tolerance, per axis', () => {
    expect(align({ x: 103, y: 300, w: 160, h: 60 }, [o], 6)).toEqual({ dx: -3, dy: 0, vx: 100, hy: undefined });
    // x edges 200, 280, 360 are all >= 20 px from 100, 180, 260: no vertical guide
    expect(align({ x: 200, y: 98, w: 160, h: 60 }, [o], 6)).toEqual({ dx: 0, dy: 2, vx: undefined, hy: 100 });
  });

  it('ignores anything farther than the tolerance', () => {
    expect(align({ x: 120, y: 200, w: 160, h: 60 }, [o], 6)).toEqual({ dx: 0, dy: 0, vx: undefined, hy: undefined });
  });
});

describe('route', () => {
  it('draws straight, step and bezier polylines between the ports', () => {
    expect(route(0, 0, 100, 50, 'straight')).toEqual([0, 0, 100, 50]);
    expect(route(0, 0, 100, 50, 'step')).toEqual([0, 0, 50, 0, 50, 50, 100, 50]);
    expect(route(0, 0, 100, 50, 'bezier', 8)).toEqual(bezier(0, 0, 100, 50, 8));
  });
});

describe('dashes', () => {
  it('cuts a line into on/off pieces', () => {
    expect(dashes([0, 0, 25, 0], 5, 5)).toEqual([[0, 0, 5, 0], [10, 0, 15, 0], [20, 0, 25, 0]]);
  });

  it('carries dashes across polyline corners', () => {
    expect(dashes([0, 0, 3, 0, 3, 4], 5, 100)).toEqual([[0, 0, 3, 0, 3, 2]]);
  });

  it('starts mid-pattern with a phase', () => {
    expect(dashes([0, 0, 10, 0], 5, 5, 7)).toEqual([[3, 0, 8, 0]]);
  });
});
