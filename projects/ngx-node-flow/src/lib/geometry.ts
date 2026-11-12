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
  port?: { side: Side; name: string };
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
      const names = (side === 'in' ? n.inputs : n.outputs) ?? [];
      for (let p = 0; p < names.length; p++) {
        const pos = portPos(n, side, p, cfg);
        if ((pos.x - wx) ** 2 + (pos.y - wy) ** 2 <= r2) return { node: n, port: { side, name: names[p] } };
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
