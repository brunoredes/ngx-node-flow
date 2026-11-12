import { FlowNode, NodeFlowConfig } from './types';

/** screen = world * zoom + (x, y), all in CSS pixels. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type Side = 'in' | 'out';

export interface Hit {
  node: FlowNode;
  port?: { side: Side; id: string };
}

const PORT_SPACING = 20;
const HEADER = 24;

export const toWorld = (c: Camera, sx: number, sy: number) => ({
  x: (sx - c.x) / c.zoom,
  y: (sy - c.y) / c.zoom,
});

export function zoomAt(c: Camera, sx: number, sy: number, factor: number, min: number, max: number): Camera {
  const zoom = Math.min(max, Math.max(min, c.zoom * factor));
  const w = toWorld(c, sx, sy);
  return { zoom, x: sx - w.x * zoom, y: sy - w.y * zoom };
}

export function nodeHeight(n: Pick<FlowNode, 'inputs' | 'outputs'>, cfg: NodeFlowConfig): number {
  const ports = Math.max(n.inputs?.length ?? 0, n.outputs?.length ?? 0);
  return Math.max(cfg.node.height, HEADER + ports * PORT_SPACING);
}

export function portPos(n: FlowNode, side: Side, index: number, cfg: NodeFlowConfig) {
  return {
    x: side === 'in' ? n.x : n.x + cfg.node.width,
    y: n.y + HEADER + PORT_SPACING * (index + 0.5),
  };
}

/** Top-most first (last drawn wins). Ports get a 2x radius grab area. */
export function hitTest(nodes: FlowNode[], wx: number, wy: number, cfg: NodeFlowConfig): Hit | null {
  const r2 = (cfg.node.portRadius * 2) ** 2;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    for (const side of ['in', 'out'] as const) {
      const ports = (side === 'in' ? n.inputs : n.outputs) ?? [];
      for (let p = 0; p < ports.length; p++) {
        const pos = portPos(n, side, p, cfg);
        if ((pos.x - wx) ** 2 + (pos.y - wy) ** 2 <= r2) return { node: n, port: { side, id: ports[p].id } };
      }
    }
    if (wx >= n.x && wx <= n.x + cfg.node.width && wy >= n.y && wy <= n.y + nodeHeight(n, cfg)) return { node: n };
  }
  return null;
}

/** Cubic bezier from an output port (a) to an input port (b), as a polyline. */
export function bezier(ax: number, ay: number, bx: number, by: number, segments = 24): number[] {
  const dx = Math.max(50, Math.abs(bx - ax) / 2);
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push(a * ax + b * (ax + dx) + c * (bx - dx) + d * bx, a * ay + b * ay + c * by + d * by);
  }
  return pts;
}

/** Shortest distance from (x, y) to a polyline given as flat [x0, y0, x1, y1, ...]. */
export function distToPolyline(pts: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], dx = pts[i + 2] - ax, dy = pts[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Alignment guides: the offset that lines up an edge or center of `r` with one of `others`, per axis,
 * when it is within `tol`. vx / hy are the world x of the vertical guide and y of the horizontal one.
 */
export function align(r: Rect, others: Iterable<Rect>, tol: number): { dx: number; dy: number; vx?: number; hy?: number } {
  let dx = 0, dy = 0, vx: number | undefined, hy: number | undefined, bx = tol, by = tol;
  const mine = (a: number, size: number) => [a, a + size / 2, a + size];
  for (const o of others) {
    for (const t of mine(o.x, o.w)) for (const s of mine(r.x, r.w)) if (Math.abs(t - s) < bx) [bx, dx, vx] = [Math.abs(t - s), t - s, t];
    for (const t of mine(o.y, o.h)) for (const s of mine(r.y, r.h)) if (Math.abs(t - s) < by) [by, dy, hy] = [Math.abs(t - s), t - s, t];
  }
  return { dx, dy, vx, hy };
}

/** Minimap size in CSS px (bottom-right corner). */
export const MINIMAP = { w: 200, h: 140 };

export type EdgeRouting = 'bezier' | 'step' | 'straight';

/** Polyline from an output port (a) to an input port (b) for the routing style. */
export function route(ax: number, ay: number, bx: number, by: number, routing: EdgeRouting, segments = 24): number[] {
  if (routing === 'straight') return [ax, ay, bx, by];
  if (routing === 'step') {
    const mx = (ax + bx) / 2;
    return [ax, ay, mx, ay, mx, by, bx, by];
  }
  return bezier(ax, ay, bx, by, segments);
}

/**
 * Cuts a polyline into dashes `on` long with `off` gaps (world units), starting `phase` into the pattern.
 * Returns one polyline per dash.
 */
export function dashes(pts: number[], on: number, off: number, phase = 0): number[][] {
  const out: number[][] = [];
  const period = on + off;
  let d = ((phase % period) + period) % period; // position in the pattern
  let cur: number[] | null = d < on ? [pts[0], pts[1]] : null;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const len = Math.hypot(bx - ax, by - ay);
    let t = 0;
    while (t < len) {
      const left = d < on ? on - d : period - d; // distance to the next pattern switch
      const step = Math.min(left, len - t);
      t += step;
      d += step;
      const x = ax + ((bx - ax) * t) / len, y = ay + ((by - ay) * t) / len;
      if (cur) cur.push(x, y);
      if (step === left) {
        if (cur) out.push(cur);
        if (d >= period) d -= period;
        cur = d < on ? [x, y] : null;
      }
    }
  }
  if (cur && cur.length >= 4) out.push(cur);
  return out;
}
